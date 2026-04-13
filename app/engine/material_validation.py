"""Validate uploaded materials before running parse / LLM."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

MIN_BODY_CHARS = 60
MIN_TOTAL_EXTRACT = 40


def _combined_extracted_text(documents: List[Dict[str, Any]], text_map: Dict[str, str]) -> str:
    parts: List[str] = []
    for d in documents or []:
        name = d.get("name", "")
        t = (text_map or {}).get(name, "") or ""
        if t.strip():
            parts.append(t.strip())
    return "\n\n".join(parts)


def validate_materials_for_parse(documents: List[Dict[str, Any]], text_map: Dict[str, str]) -> Tuple[bool, str]:
    if not documents:
        return False, "请先导入至少一份材料。"
    total = _combined_extracted_text(documents, text_map)
    plain = re.sub(r"\s+", "", total)
    if len(plain) < MIN_TOTAL_EXTRACT:
        return False, "当前文件内容过少或无法抽取正文。请上传包含可读文字的 txt / md / docx / pdf。"

    resume_text = ""
    for d in documents:
        if d.get("type") == "resume":
            resume_text += "\n" + ((text_map or {}).get(d.get("name", ""), "") or "")
    if len(re.sub(r"\s+", "", resume_text)) < MIN_BODY_CHARS:
        return False, "当前材料不足以解析。请至少导入并确认一份正文较完整的简历。"
    return True, "材料可用于解析。"
