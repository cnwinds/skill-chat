---
name: xlsx
description: 生成和处理 Excel 文件，适合表格整理、CSV 转换和简单图表。
entrypoint: scripts/run.py
runtime: python
timeout_sec: 120
references:
  - usage.md
---

# XLSX Skill

## 触发条件

当用户请求 Excel、XLSX、表格、CSV 转换时触发。

## 输出约束

- 输出文件必须写入 `outputs/`
- 默认生成一个工作簿，可包含数据 sheet 和摘要 sheet
