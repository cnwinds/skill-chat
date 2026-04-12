---
name: pdf
description: 生成和处理 PDF 文件，适合报告、周报、摘要文档。
entrypoint: scripts/run.py
runtime: python
timeout_sec: 120
references:
  - usage.md
starter_prompts:
  - 帮我生成一份本周销售报告 PDF
  - 把这段内容整理成一份可下载 PDF
  - 根据上传材料生成一份摘要 PDF
---

# PDF Skill

## 触发条件

当用户请求生成 PDF、报告、周报、日报或可下载文档时触发。

## 执行步骤

1. 读取当前请求和已上传文件摘要。
2. 先整理出最终文档内容，再调用 `run_skill`。
3. 调用 `scripts/run.py` 生成 PDF。
4. 将结果写入当前会话的 `outputs/` 目录。

## 调用约定

- `run_skill.prompt` 只放简短执行说明，例如“渲染最终文档为 PDF”。
- 最终文档正文优先放在 `run_skill.arguments.documentMarkdown`。
- 标题放在 `run_skill.arguments.title`。
- 摘要可放在 `run_skill.arguments.summary`。
- 可选 `run_skill.arguments.fileName` 指定输出文件名。
- 不要把“请生成”“文档要求”“输出约束”这类任务说明直接当作 PDF 正文。

## 输出约束

- 输出文件必须位于 `outputs/`
- 单次生成一个主 PDF 文件
- 默认使用中文可用字体
- 优先输出具备标题、摘要、分节标题、列表和页脚页码的正式文档
