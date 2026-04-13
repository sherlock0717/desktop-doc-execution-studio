"""Deterministic demo payloads — same schema as LLM outputs, unified render path."""

from __future__ import annotations

from typing import List, Tuple

from .schema_definitions import InterviewPackPayload, JobBriefPayload, ResumeDeltaPayload, ResumeLineItem
from .snippet_extractor import SnippetRecord


def build_demo_payloads(catalog: List[SnippetRecord]) -> Tuple[JobBriefPayload, ResumeDeltaPayload, InterviewPackPayload]:
    ids = [c["snippet_id"] for c in catalog[:6]]
    cite = ids[:4] if len(ids) >= 4 else ids

    job = JobBriefPayload(
        job_focus=[
            "把岗位材料里的要求拆成可逐项对照的清单，让每次投递前复跑同一套检查，而不是临时问一次 AI。",
            "优先抓取「职责/要求/交付物/协作」等可写进简历与面试叙述的硬信息。",
        ],
        match_points=[
            "当材料中出现可对照的经历线索时，输出应能落到具体片段（证据 id）以便复核。",
        ],
        gaps=[
            "若某类输入缺失，缺口应明确标记为「未提供」，避免用泛化描述凑字数。",
        ],
        next_steps=[
            "补齐缺失输入后再次生成，形成可追溯的版本迭代与归档记录。",
        ],
        cited_snippet_ids=cite,
    )

    resume = ResumeDeltaPayload(
        items=[
            ResumeLineItem(
                category="strengthen",
                text="把项目写成「背景—动作—结果—证据」结构，并与目标岗位关键词对齐。",
                target_section="projects",
            ),
            ResumeLineItem(
                category="add_expression",
                text="补充可验证的细节：指标、范围、协作角色、工具链与时间窗口。",
                target_section="skills",
            ),
            ResumeLineItem(
                category="weaken",
                text="弱化与岗位无关的泛化形容词与空泛职责列表。",
                target_section="summary",
            ),
            ResumeLineItem(
                category="rewrite_direction",
                text="以固定版式输出修改方向，便于你本地反复改稿与留痕，而不是一次性聊天建议。",
                target_section="general",
            ),
        ],
        cited_snippet_ids=cite[:3] if cite else [],
    )

    interview = InterviewPackPayload(
        highlight_topics=[
            "主动讲述与岗位交付相关的案例，并用材料中的片段作为可复核证据。",
        ],
        followup_risks=[
            "若缺少面试记录，追问清单只能基于简历/JD 做弱依据推演；建议补充复盘材料后再生成。",
        ],
        need_more_evidence=[
            "对关键结论准备量化或第三方可验证材料（链接、截图、样例）以支撑叙述。",
        ],
        missing_inputs=[
            "未提供的材料类型会在缺口区列出；请按清单补齐后再复跑生成。",
        ],
        cited_snippet_ids=cite[:4] if cite else [],
    )

    return job, resume, interview
