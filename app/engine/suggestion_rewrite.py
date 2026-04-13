"""LLM: rewrite a resume section as final resume copy, with quality guards."""

from __future__ import annotations

import re
from typing import Dict, List

from .llm_provider import extract_json_object, get_provider

BAD_TOKENS = (
    "未提供",
    "请参见以下",
    "这里可以补充",
    "你可以这样回答",
    "某公司",
    "某项目",
    "xx",
    "XX",
    "××",
)
ANALYSIS_PHRASES = ("建议补充", "可进一步说明", "可以考虑", "这里建议", "应当强调", "改写建议")
INTERNAL_TOKENS = ("general", "education", "projects", "accomplishments", "Certifications", "programming languages")


def clean_resume_section_body(body: str) -> str:
    lines: List[str] = []
    for raw in (body or "").splitlines():
        line = raw.strip()
        if not line:
            lines.append("")
            continue
        line = re.sub(r"^#{1,6}\s*", "", line)
        line = re.sub(r"^>\s*", "", line)
        line = re.sub(r"^[-*]\s+", "", line)
        if any(tok in line for tok in BAD_TOKENS):
            continue
        if any(tok in line for tok in INTERNAL_TOKENS):
            continue
        if any(tok in line for tok in ANALYSIS_PHRASES):
            continue
        lines.append(line)
    out = "\n".join(lines)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out


def is_degraded_rewrite(original: str, rewritten: str) -> bool:
    old = clean_resume_section_body(original)
    new = clean_resume_section_body(rewritten)
    compact_new = re.sub(r"\s+", "", new)
    compact_old = re.sub(r"\s+", "", old)
    if len(compact_new) < 20:
        return True
    if compact_old and len(compact_new) < max(20, int(len(compact_old) * 0.45)):
        return True
    if any(tok in compact_new for tok in BAD_TOKENS):
        return True
    return False


def messages_rewrite_resume_section(
    *,
    section_title: str,
    current_section_body: str,
    suggestion_text: str,
    materials_blob: str,
) -> List[Dict[str, str]]:
    user = f"""你是中文简历编辑。请把当前简历小节改写成可直接放进正式简历的最终正文。

硬性要求：
- 只返回该小节的正式简历文本。
- 不要返回标题、Markdown、解释、建议、注释、内部标签。
- 不要写“未提供”“某公司”“某项目”“xx”这类占位内容。
- 不要为了改写而编造事实；材料不足时保留原表达并做轻微润色。
- 输出必须比原文更清楚，不能变短成空壳。

【小节】{section_title}

【当前小节正文】
{current_section_body}

【本条修改建议】
{suggestion_text}

【用户全部材料】
{materials_blob}

只输出 JSON：{{"rewritten_section_body":"正式简历正文"}}"""
    return [
        {"role": "system", "content": "你只输出合法 JSON，键名必须是 rewritten_section_body。"},
        {"role": "user", "content": user},
    ]


def rewrite_resume_section_with_llm(
    *,
    section_title: str,
    current_section_body: str,
    suggestion_text: str,
    materials_blob: str,
) -> str:
    messages = messages_rewrite_resume_section(
        section_title=section_title,
        current_section_body=current_section_body,
        suggestion_text=suggestion_text,
        materials_blob=materials_blob,
    )
    raw = get_provider().complete(messages, json_mode=True)
    data = extract_json_object(raw)
    body = clean_resume_section_body(data.get("rewritten_section_body") or "")
    if is_degraded_rewrite(current_section_body, body):
        return clean_resume_section_body(current_section_body)
    return body
