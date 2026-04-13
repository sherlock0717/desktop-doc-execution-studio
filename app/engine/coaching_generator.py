"""LLM-generated interview expression coaching (human HR tone, no markdown headings)."""

from __future__ import annotations

from typing import Dict, List

from .llm_provider import get_provider

PERSONA_HINTS: Dict[str, str] = {
    "strict_professional": "严厉专业：短句、抓漏洞、强调证据与岗位匹配。",
    "calm_rational": "冷静理性：结构化、重逻辑、少情绪词。",
    "high_pressure": "高压追问：连环追问语气、要求细节与复盘。",
    "friendly": "友好沟通：鼓励但指出改进点，语气克制。",
    "skeptical": "挑战质疑：对自述保持怀疑、要求佐证与反例。",
}


def generate_interview_coaching_markdown(
    *,
    materials_blob: str,
    persona_id: str = "calm_rational",
) -> str:
    hint = PERSONA_HINTS.get(persona_id, PERSONA_HINTS["calm_rational"])
    messages: List[Dict[str, str]] = [
        {
            "role": "system",
            "content": (
                "你是一位真实企业的 HR / 业务面试官，正在给候选人写「面试表达辅导」批注。"
                "用自然中文分段，不要用井号标题、不要用 Markdown 列表符号刷屏、不要输出 JSON。"
                "禁止占位符（如某某、这里填入、见上文）。要结合材料里的公司与项目信息具体说。"
                "语气贴合所选风格说明。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"风格说明：{hint}\n\n"
                "请覆盖这些方向（融在叙述里，不必逐条编号）：自我介绍怎么开口；项目经历怎么讲清贡献；"
                "亮点与风险点怎么表达；岗位动机怎么说；哪些说法显得幼稚要避免；怎样听起来像成熟候选人。\n\n"
                f"候选人材料如下：\n{materials_blob}"
            ),
        },
    ]
    provider = get_provider()
    text = provider.complete(messages, json_mode=False)
    return (text or "").strip()
