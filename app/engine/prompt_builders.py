"""Separate system/user prompts per result pack; evidence = snippet_id only."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Dict, List

from .product_constants import PROMPT_VERSION
from .snippet_extractor import SnippetRecord

_MAX_CHARS_PER_BLOCK = int(os.getenv("LLM_CONTEXT_CHARS_PER_FILE", "14000"))


@dataclass
class ImportContext:
    """Labeled text blocks + snippet catalog for the model."""

    jd: str
    resume: str
    interview: str
    supporting: str
    has_jd: bool
    has_resume: bool
    has_interview: bool
    has_supporting: bool
    filenames_by_type: Dict[str, List[str]]
    snippet_catalog: List[SnippetRecord]
    goal_mode: str


def _clip(text: str) -> str:
    t = (text or "").strip()
    if len(t) <= _MAX_CHARS_PER_BLOCK:
        return t
    return t[:_MAX_CHARS_PER_BLOCK] + "\n\n[… 正文过长，已截断 …]"


def build_import_context(
    documents: List[Dict],
    text_map: Dict[str, str],
    snippet_catalog: List[SnippetRecord],
    goal_mode: str = "both",
) -> ImportContext:
    by_type: Dict[str, List[str]] = {
        "jd": [],
        "resume": [],
        "interview_note": [],
        "supporting_material": [],
    }
    for doc in documents:
        by_type.setdefault(doc.get("type", "supporting_material"), []).append(doc["name"])

    def join_type(t: str) -> str:
        names = by_type.get(t, [])
        parts = []
        for name in names:
            parts.append(f"### 文件: {name}\n{_clip(text_map.get(name, ''))}")
        return "\n\n".join(parts) if parts else ""

    jd_text = join_type("jd")
    resume_text = join_type("resume")
    interview_text = join_type("interview_note")
    support_text = join_type("supporting_material")

    return ImportContext(
        jd=jd_text,
        resume=resume_text,
        interview=interview_text,
        supporting=support_text,
        has_jd=bool(jd_text.strip()),
        has_resume=bool(resume_text.strip()),
        has_interview=bool(interview_text.strip()),
        has_supporting=bool(support_text.strip()),
        filenames_by_type={k: v[:] for k, v in by_type.items()},
        snippet_catalog=snippet_catalog,
        goal_mode=goal_mode,
    )


def _catalog_json_block(catalog: List[SnippetRecord]) -> str:
    """IDs + full text for reasoning; model must only cite ids in output JSON."""
    slim = [
        {
            "snippet_id": x["snippet_id"],
            "source_file": x["source_file"],
            "snippet_text": x["snippet_text"],
        }
        for x in catalog
    ]
    return json.dumps(slim, ensure_ascii=False, indent=2)


_SHARED_RULES = f"""你是「求职材料整理」助手，用于固定工作流下的结构化输出。
【硬性规则】
1. 只能依据下方「材料正文」与「证据片段候选清单」作答；禁止编造未出现在清单中的片段或文件。
2. 禁止引用任何应用、产品、系统自身的介绍；禁止讨论 ChatGPT、本工具与聊天机器人对比等元话题。
3. 若某类材料未提供，对应结论写「未提供」，不得虚构公司与岗位细节。
4. 输出单个 JSON 对象；证据只允许输出候选清单里存在的 snippet_id 到 cited_snippet_ids 字段，不得输出自由文本证据、不得自拟文件名或摘录。
5. 不要输出 markdown，不要代码围栏。
6. 当前提示版本：{PROMPT_VERSION}。"""


def _strategy_job_brief(goal_mode: str) -> str:
    if goal_mode == "delivery":
        return """【生成策略 · 投递优化】
本包是本轮主交付之一：岗位理解要写得足够可执行，便于逐条对照 JD 改简历。
每条要点短而具体，避免空泛总结。"""
    if goal_mode == "interview":
        return """【生成策略 · 面试准备】
本包本轮降权：仅输出与面试叙事直接相关的岗位要点摘要。
每个数组最多 2 条要点，宁可少而准，不要展开成长篇。"""
    return """【生成策略 · 双模式】
岗位理解卡按完整深度输出（与简历修改、面试准备并列主交付）。"""


def _strategy_resume_delta(goal_mode: str) -> str:
    if goal_mode == "delivery":
        return """【生成策略 · 投递优化】
简历修改单是本轮核心交付：四条分类下每条建议必须可操作、可单独执行（便于后续勾选采纳）。
避免泛泛而谈；写清「改哪里、怎么改、对齐什么岗位信息」。"""
    if goal_mode == "interview":
        return """【生成策略 · 面试准备】
简历修改单本轮降权：仅保留最关键修改，每栏最多 2 条，总条数不超过 8。
优先服务「面试时要讲的故事线」，而非全面改简历。"""
    return """【生成策略 · 双模式】
简历修改单按完整深度输出。"""


def _strategy_interview_pack(goal_mode: str) -> str:
    if goal_mode == "delivery":
        return """【生成策略 · 投递优化】
面试准备包本轮为辅助：每个数组最多 2 条要点，总要点不超过 6 条。
只保留与「投递材料打磨」强相关的面试提示，不要展开成全案辅导。"""
    if goal_mode == "interview":
        return """【生成策略 · 面试准备】
面试准备包是本轮主交付：每条写清可演练的叙述与追问预案。
四个数组都要写满可用内容，仍须遵守证据 snippet_id 规则。"""
    return """【生成策略 · 双模式】
面试准备包按完整深度输出。"""


def messages_job_brief(ctx: ImportContext) -> List[Dict[str, str]]:
    user = f"""{_SHARED_RULES}

【目标模式】{ctx.goal_mode}
{_strategy_job_brief(ctx.goal_mode)}

【用户导入的材料正文】

【岗位说明 JD】
{ctx.jd if ctx.has_jd else "未提供"}

【简历】
{ctx.resume if ctx.has_resume else "未提供"}

【面试记录】
{ctx.interview if ctx.has_interview else "未提供"}

【补充材料】
{ctx.supporting if ctx.has_supporting else "未提供"}

【证据片段候选清单】（仅允许引用其中的 snippet_id）
{_catalog_json_block(ctx.snippet_catalog)}

请输出 JSON：
{{
  "job_focus": ["…"],
  "match_points": ["…"],
  "gaps": ["…"],
  "next_steps": ["…"],
  "cited_snippet_ids": ["s0001", "s0002"]
}}
cited_snippet_ids 至少 1 个（材料极少时选最少必要 id）；不得引用清单外的 id。"""

    return [
        {"role": "system", "content": "你只输出合法 JSON，键名使用英文如下所示。"},
        {"role": "user", "content": user},
    ]


def messages_resume_delta(ctx: ImportContext) -> List[Dict[str, str]]:
    user = f"""{_SHARED_RULES}

【目标模式】{ctx.goal_mode}
{_strategy_resume_delta(ctx.goal_mode)}

【用户导入的材料正文】

【岗位说明 JD】
{ctx.jd if ctx.has_jd else "未提供"}

【简历】
{ctx.resume if ctx.has_resume else "未提供"}

【面试记录】
{ctx.interview if ctx.has_interview else "未提供"}

【补充材料】
{ctx.supporting if ctx.has_supporting else "未提供"}

【证据片段候选清单】（仅允许引用其中的 snippet_id）
{_catalog_json_block(ctx.snippet_catalog)}

请输出 JSON（每条建议必须带 target_section，无法判断时用 general）：
{{
  "items": [
    {{
      "category": "strengthen",
      "text": "单条可操作正文",
      "target_section": "projects"
    }}
  ],
  "cited_snippet_ids": ["s0001"]
}}
category 取值：strengthen | add_expression | weaken | rewrite_direction
target_section 取值：basic_info | education | projects | internships | skills | summary | general
items 必须输出 10～22 条；综合使用 JD、简历、面试记录、补充材料，不得只依据简历。
每条 text 控制在约 90 字以内，只写一个小改动点；禁止用一条建议覆盖整段简历或多段经历。
items 内多条并列，勿把多条合并成一段长文。"""

    return [
        {"role": "system", "content": "你只输出合法 JSON。"},
        {"role": "user", "content": user},
    ]


def messages_interview_pack(ctx: ImportContext) -> List[Dict[str, str]]:
    user = f"""{_SHARED_RULES}

【目标模式】{ctx.goal_mode}
{_strategy_interview_pack(ctx.goal_mode)}

【用户导入的材料正文】

【岗位说明 JD】
{ctx.jd if ctx.has_jd else "未提供"}

【简历】
{ctx.resume if ctx.has_resume else "未提供"}

【面试记录】
{ctx.interview if ctx.has_interview else "未提供"}

【补充材料】
{ctx.supporting if ctx.has_supporting else "未提供"}

【证据片段候选清单】（仅允许引用其中的 snippet_id）
{_catalog_json_block(ctx.snippet_catalog)}

请输出 JSON：
{{
  "highlight_topics": ["…"],
  "followup_risks": ["…"],
  "need_more_evidence": ["…"],
  "missing_inputs": ["…"],
  "cited_snippet_ids": ["s0001"]
}}
若没有面试记录，followup_risks 等须如实写依据不足 / 未提供，不得编造面试对话。"""

    return [
        {"role": "system", "content": "你只输出合法 JSON。"},
        {"role": "user", "content": user},
    ]
