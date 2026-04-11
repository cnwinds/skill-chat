#!/usr/bin/env python3
import argparse
import json
import os
import re
from datetime import datetime

from docx import Document


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def safe_name(value, default):
    cleaned = re.sub(r'[\\/:*?"<>|]+', "_", value or default).strip()
    return cleaned or default


def read_request(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def read_preview(file_path):
    if not os.path.exists(file_path):
        return None
    if not any(file_path.lower().endswith(ext) for ext in [".txt", ".md", ".csv", ".json"]):
        return None
    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            content = handle.read(1000).strip()
            return content[:300]
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args()

    request_payload = read_request(args.request)
    output_dir = request_payload["session"]["outputDir"]
    os.makedirs(output_dir, exist_ok=True)

    title = request_payload["input"]["arguments"].get("title") or "SkillChat 文档"
    files = request_payload["input"].get("files", [])

    emit({"type": "progress", "message": "正在创建 DOCX 文档", "percent": 20})
    document = Document()
    document.add_heading(title, 0)
    document.add_paragraph(f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    document.add_heading("请求摘要", level=1)
    document.add_paragraph(request_payload["input"]["prompt"])

    document.add_heading("输入文件", level=1)
    if files:
        for file_info in files:
            paragraph = document.add_paragraph(style="List Bullet")
            paragraph.add_run(file_info["name"])
            preview = read_preview(file_info["path"])
            if preview:
                document.add_paragraph(preview)
    else:
        document.add_paragraph("无输入文件。")

    document.add_heading("备注", level=1)
    document.add_paragraph("本文件由 SkillChat DOCX Skill 自动生成。")

    output_name = f"{safe_name(title, 'document')}.docx"
    output_path = os.path.join(output_dir, output_name)

    emit({"type": "progress", "message": "正在写入 DOCX 文件", "percent": 80})
    document.save(output_path)

    emit({"type": "artifact", "path": os.path.relpath(output_path, request_payload["session"]["workDir"]), "label": output_name})
    emit({"type": "result", "message": "DOCX 生成完成"})


if __name__ == "__main__":
    main()
