---
name: docx
description: 生成和处理 Word 文档，适合方案、纪要、合同草稿和说明文档。
entrypoint: scripts/run.py
runtime: python
timeout_sec: 120
references:
  - usage.md
---

# DOCX Skill

## 触发条件

当用户请求 Word、DOCX、方案、纪要、合同或文档草稿时触发。

## 输出约束

- 输出文件必须写入 `outputs/`
- 生成的文档应包含标题、摘要与输入文件列表
