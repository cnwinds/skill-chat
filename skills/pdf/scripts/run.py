#!/usr/bin/env python3
import argparse
import json
import os
import re
from datetime import datetime
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def safe_name(value, default):
    cleaned = re.sub(r'[\\/:*?"<>|]+', "_", value or default).strip()
    return cleaned or default


def read_request(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def preview_text(file_path):
    if not os.path.exists(file_path):
        return []
    lower = file_path.lower()
    if not any(lower.endswith(ext) for ext in [".txt", ".md", ".csv", ".json"]):
        return []
    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            content = handle.read(2000)
            lines = [line.strip() for line in content.splitlines() if line.strip()]
            return lines[:8]
    except Exception:
        return []


def as_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    return ""


def is_non_empty_text(value):
    return isinstance(value, str) and value.strip() != ""


def first_non_empty(*values):
    for value in values:
        if is_non_empty_text(value):
            return value.strip()
    return ""


def normalize_whitespace(value):
    return re.sub(r"\n{3,}", "\n\n", value.strip())


def looks_like_request_brief(value):
    if not value:
        return False
    return (
        re.search(r"请生成|文档要求|输出到|结构建议|请在|核心观点|结尾加一句|适合.*阅读", value) is not None
        or re.search(r"\n\s*\d+\.\s", value) is not None
    )


def infer_title(prompt):
    match = re.search(r"[《\"]([^》\"]+)[》\"]", prompt)
    if match:
        return match.group(1).strip()

    match = re.search(r"(?:主题|标题)[为：:\s]+([^\n]+)", prompt)
    if match:
        return match.group(1).strip("。；;，, ")

    compact = re.sub(r"\s+", " ", prompt).strip()
    if not compact:
        return "SkillChat 报告"
    return compact[:24]


def sections_to_markdown(sections):
    blocks = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        heading = as_text(section.get("heading") or section.get("title"))
        body = as_text(section.get("body") or section.get("content"))
        if heading:
            blocks.append(f"## {heading}")
        if body:
            blocks.append(body)
    return "\n\n".join(blocks).strip()


def fallback_markdown(prompt, files, title):
    intro = [
        "## 当前请求",
        prompt or "未提供明确正文内容。",
        "",
        "## 已知信息",
        f"- 标题：{title}",
    ]

    if files:
        for file_info in files:
            intro.append(f"- {file_info['name']}")
            for snippet in preview_text(file_info["path"]):
                intro.append(f"  - {snippet}")
    else:
        intro.append("- 无上传文件")

        intro.extend([
        "",
        "## 下一步建议",
        "- 如果需要正式成稿，请传入 `documentMarkdown`。",
        "- 如果需要更强版式，请在正文中使用标题和列表组织内容。",
    ])
    return "\n".join(intro), f"根据当前请求自动整理的《{title}》初版内容。"


def build_document_payload(request_payload):
    prompt = as_text(request_payload["input"].get("prompt"))
    arguments = request_payload["input"].get("arguments", {}) or {}
    files = request_payload["input"].get("files", [])

    title = first_non_empty(arguments.get("title"), arguments.get("fileName")) or infer_title(prompt) or "SkillChat 报告"
    summary = as_text(arguments.get("summary"))
    source_note = as_text(arguments.get("sourceNote"))

    document_markdown = first_non_empty(
        arguments.get("documentMarkdown"),
        arguments.get("contentMarkdown"),
        arguments.get("bodyMarkdown"),
        arguments.get("documentText"),
        arguments.get("content"),
    )

    if not document_markdown and isinstance(arguments.get("sections"), list):
        document_markdown = sections_to_markdown(arguments.get("sections"))

    if not document_markdown:
        document_markdown, fallback_summary = fallback_markdown(prompt, files, title)
        if not summary:
            summary = fallback_summary
    elif not summary and looks_like_request_brief(prompt):
        summary = "基于当前会话中已整理出的最终内容渲染为 PDF。"

    if not summary:
        summary = "根据当前会话内容生成的结构化 PDF 文档。"

    return {
        "title": title,
        "summary": summary,
        "source_note": source_note,
        "document_markdown": normalize_whitespace(document_markdown),
        "file_name": as_text(arguments.get("fileName")),
        "files": files,
    }


def build_styles():
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "SkillTitle",
        parent=styles["Title"],
        fontName="STSong-Light",
        fontSize=22,
        leading=30,
        textColor=colors.HexColor("#1F2A44"),
        spaceAfter=8,
    )
    meta_style = ParagraphStyle(
        "SkillMeta",
        parent=styles["Normal"],
        fontName="STSong-Light",
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#6B7280"),
        spaceAfter=10,
    )
    section_title_style = ParagraphStyle(
        "SkillSectionTitle",
        parent=styles["Heading2"],
        fontName="STSong-Light",
        fontSize=15,
        leading=22,
        textColor=colors.HexColor("#183153"),
        spaceBefore=8,
        spaceAfter=6,
    )
    subheading_style = ParagraphStyle(
        "SkillSubheading",
        parent=styles["Heading3"],
        fontName="STSong-Light",
        fontSize=12,
        leading=18,
        textColor=colors.HexColor("#243B53"),
        spaceBefore=6,
        spaceAfter=4,
    )
    body_style = ParagraphStyle(
        "SkillBody",
        parent=styles["BodyText"],
        fontName="STSong-Light",
        fontSize=10.5,
        leading=18,
        textColor=colors.HexColor("#20262E"),
        spaceAfter=6,
    )
    summary_style = ParagraphStyle(
        "SkillSummary",
        parent=body_style,
        backColor=colors.HexColor("#F3F6FB"),
        borderColor=colors.HexColor("#D7E3F4"),
        borderWidth=0.6,
        borderPadding=8,
        borderRadius=6,
        spaceAfter=10,
    )
    bullet_style = ParagraphStyle(
        "SkillBullet",
        parent=body_style,
        leftIndent=10,
        firstLineIndent=0,
        spaceAfter=2,
    )

    return {
        "title": title_style,
        "meta": meta_style,
        "section_title": section_title_style,
        "subheading": subheading_style,
        "body": body_style,
        "summary": summary_style,
        "bullet": bullet_style,
    }


def format_inline_markup(text):
    escaped = escape(text.strip())
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"`([^`]+)`", '<font backColor="#EEF2F7">\\1</font>', escaped)
    return escaped.replace("\n", "<br/>")


def flush_list(story, items, styles, ordered=False):
    if not items:
        return
    list_items = [
        ListItem(Paragraph(format_inline_markup(item), styles["bullet"]))
        for item in items
    ]
    story.append(ListFlowable(
        list_items,
        bulletType="1" if ordered else "bullet",
        start="1",
        leftIndent=14,
    ))
    story.append(Spacer(1, 4))


def append_markdown_story(story, markdown, styles):
    blocks = re.split(r"\n\s*\n", markdown.strip())
    for raw_block in blocks:
        block = raw_block.strip()
        if not block:
            continue

        lines = [line.rstrip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue

        if len(lines) == 1 and lines[0].startswith("# "):
            story.append(Paragraph(format_inline_markup(lines[0][2:]), styles["section_title"]))
            continue

        if len(lines) == 1 and lines[0].startswith("## "):
            story.append(Paragraph(format_inline_markup(lines[0][3:]), styles["section_title"]))
            continue

        if len(lines) == 1 and lines[0].startswith("### "):
            story.append(Paragraph(format_inline_markup(lines[0][4:]), styles["subheading"]))
            continue

        if all(re.match(r"^[-*]\s+", line) for line in lines):
            flush_list(story, [re.sub(r"^[-*]\s+", "", line) for line in lines], styles, ordered=False)
            continue

        if all(re.match(r"^\d+\.\s+", line) for line in lines):
            flush_list(story, [re.sub(r"^\d+\.\s+", "", line) for line in lines], styles, ordered=True)
            continue

        if lines[0].startswith("## "):
            story.append(Paragraph(format_inline_markup(lines[0][3:]), styles["section_title"]))
            remaining = "\n".join(lines[1:]).strip()
            if remaining:
                story.append(Paragraph(format_inline_markup(remaining), styles["body"]))
            continue

        if lines[0].startswith("### "):
            story.append(Paragraph(format_inline_markup(lines[0][4:]), styles["subheading"]))
            remaining = "\n".join(lines[1:]).strip()
            if remaining:
                story.append(Paragraph(format_inline_markup(remaining), styles["body"]))
            continue

        story.append(Paragraph(format_inline_markup("\n".join(lines)), styles["body"]))


def build_story(document_payload):
    styles = build_styles()
    story = []
    now_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    story.append(Paragraph(format_inline_markup(document_payload["title"]), styles["title"]))
    story.append(Paragraph(format_inline_markup(f"生成时间：{now_text}"), styles["meta"]))
    story.append(Paragraph(format_inline_markup("文档类型：SkillChat PDF 报告"), styles["meta"]))

    story.append(Paragraph("摘要", styles["section_title"]))
    story.append(Paragraph(format_inline_markup(document_payload["summary"]), styles["summary"]))

    story.append(Paragraph("输入文件列表", styles["section_title"]))
    if document_payload["files"]:
        file_lines = []
        for file_info in document_payload["files"]:
            file_lines.append(f"- {file_info['name']}")
            for snippet in preview_text(file_info["path"]):
                file_lines.append(f"  - {snippet}")
        append_markdown_story(story, "\n".join(file_lines), styles)
    else:
        story.append(Paragraph("无上传文件；依据当前会话内容整理。", styles["body"]))

    story.append(Spacer(1, 4))
    append_markdown_story(story, document_payload["document_markdown"], styles)

    if document_payload["source_note"]:
        story.append(Paragraph("补充说明", styles["section_title"]))
        story.append(Paragraph(format_inline_markup(document_payload["source_note"]), styles["body"]))

    story.append(Spacer(1, 10))
    story.append(Paragraph(
        format_inline_markup("本文件由 SkillChat PDF Skill 自动生成。"),
        styles["meta"],
    ))
    return story


def draw_page_footer(canvas_obj, doc):
    canvas_obj.saveState()
    canvas_obj.setStrokeColor(colors.HexColor("#D7E3F4"))
    canvas_obj.line(doc.leftMargin, 14 * mm, A4[0] - doc.rightMargin, 14 * mm)
    canvas_obj.setFont("STSong-Light", 9)
    canvas_obj.setFillColor(colors.HexColor("#6B7280"))
    canvas_obj.drawString(doc.leftMargin, 9 * mm, "SkillChat PDF")
    canvas_obj.drawRightString(A4[0] - doc.rightMargin, 9 * mm, f"第 {canvas_obj.getPageNumber()} 页")
    canvas_obj.restoreState()


def draw_document(target_path, document_payload):
    doc = SimpleDocTemplate(
        target_path,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=22 * mm,
        title=document_payload["title"],
    )
    story = build_story(document_payload)
    doc.build(story, onFirstPage=draw_page_footer, onLaterPages=draw_page_footer)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args()

    request_payload = read_request(args.request)
    output_dir = request_payload["session"]["outputDir"]
    os.makedirs(output_dir, exist_ok=True)

    emit({"type": "progress", "message": "正在整理内容", "percent": 15})
    document_payload = build_document_payload(request_payload)

    output_name = document_payload["file_name"] or f"{safe_name(document_payload['title'], 'report')}.pdf"
    if not output_name.lower().endswith(".pdf"):
        output_name = f"{output_name}.pdf"
    output_path = os.path.join(output_dir, output_name)

    emit({"type": "progress", "message": "正在渲染版式", "percent": 45})
    draw_document(output_path, document_payload)

    emit({"type": "artifact", "path": os.path.relpath(output_path, request_payload["session"]["workDir"]), "label": output_name})
    emit({"type": "result", "message": "PDF 生成完成"})


if __name__ == "__main__":
    main()
