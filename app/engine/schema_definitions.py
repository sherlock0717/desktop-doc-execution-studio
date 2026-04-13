"""Structured JSON payloads for result packs (validated before markdown render)."""

from __future__ import annotations

from typing import List

from pydantic import BaseModel, Field, field_validator

_VALID_TS = {"basic_info", "education", "projects", "internships", "skills", "summary", "general"}


class JobBriefPayload(BaseModel):
    """岗位理解卡 — LLM JSON."""

    job_focus: List[str] = Field(default_factory=list, description="岗位重点")
    match_points: List[str] = Field(default_factory=list, description="当前匹配点")
    gaps: List[str] = Field(default_factory=list, description="当前缺口")
    next_steps: List[str] = Field(default_factory=list, description="下一步补强建议")
    cited_snippet_ids: List[str] = Field(
        default_factory=list,
        description="仅引用下方候选清单中的 snippet_id",
    )


class ResumeLineItem(BaseModel):
    """单条简历修改建议（含目标区块）。"""

    category: str = Field(
        ...,
        description="strengthen | add_expression | weaken | rewrite_direction",
    )
    text: str = Field(..., description="建议正文")
    target_section: str = Field(
        default="general",
        description="basic_info | education | projects | internships | skills | summary | general",
    )

    @field_validator("target_section", mode="before")
    @classmethod
    def _norm_sec(cls, v: object) -> str:
        t = str(v or "").strip().lower()
        return t if t in _VALID_TS else "general"

    @field_validator("category", mode="before")
    @classmethod
    def _norm_cat(cls, v: object) -> str:
        s = str(v or "").strip()
        allowed = {"strengthen", "add_expression", "weaken", "rewrite_direction"}
        return s if s in allowed else "strengthen"


class ResumeDeltaPayload(BaseModel):
    """简历修改单 — LLM JSON（结构化条目）。"""

    items: List[ResumeLineItem] = Field(default_factory=list, description="逐条建议")
    cited_snippet_ids: List[str] = Field(default_factory=list)


class RefinedResumePayload(BaseModel):
    """独立润色稿 — LLM JSON；不落盘到 resume_working_draft.md。"""

    refined_resume_markdown: str = Field(
        ...,
        description="完整润色后简历正文（Markdown），更像可投递版本但仍为建议稿",
    )
    refinement_focus: List[str] = Field(
        default_factory=list,
        description="本次润色重点，3～7 条短句",
    )
    polish_notes: str = Field(
        default="",
        description="提醒用户本稿为建议润色稿，需人工确认后再投递",
    )


class InterviewPackPayload(BaseModel):
    """面试准备包 — LLM JSON."""

    highlight_topics: List[str] = Field(
        default_factory=list,
        description="最值得主动讲的内容",
    )
    followup_risks: List[str] = Field(
        default_factory=list,
        description="可能被继续追问的问题",
    )
    need_more_evidence: List[str] = Field(
        default_factory=list,
        description="需要补证据的地方",
    )
    missing_inputs: List[str] = Field(
        default_factory=list,
        description="当前仍缺哪些输入",
    )
    cited_snippet_ids: List[str] = Field(default_factory=list)


class InterviewPracticeItem(BaseModel):
    """单道面试练习题（结构化）。"""

    id: str = Field(..., description="稳定 id")
    category: str = Field(
        ...,
        description="general | resume_depth | role_fit | company_motivation",
    )
    category_label: str = Field(..., description="中文短标签")
    question: str = Field(..., description="面试问题全文")
    reference_answer: str = Field(..., description="参考回答，完整段落")


class InterviewPracticePayload(BaseModel):
    questions: List[InterviewPracticeItem] = Field(default_factory=list, max_length=40)


class InterviewReportDimensions(BaseModel):
    """雷达维度 1–10，用于前端多边形图。"""

    expression_clarity: int = Field(ge=1, le=10, description="表达清晰度")
    logic: int = Field(ge=1, le=10, description="逻辑性")
    role_match: int = Field(ge=1, le=10, description="岗位匹配")
    authenticity: int = Field(ge=1, le=10, description="真实性")
    professionalism: int = Field(ge=1, le=10, description="专业度")
    persuasion: int = Field(ge=1, le=10, description="说服力")


class InterviewComprehensiveReport(BaseModel):
    overall: str = Field(default="", description="总体评价")
    per_question_summary: List[str] = Field(default_factory=list)
    top_gaps: str = Field(default="", description="最需要补强")
    role_fit_judgement: str = Field(default="", description="岗位匹配度判断")
    hire_risk_and_highlights: str = Field(default="", description="录用风险与亮点")
    dimensions: InterviewReportDimensions


class InterviewScoreResult(BaseModel):
    score: int = Field(ge=1, le=10)
    comment: str = Field(default="", max_length=800)
    improvement: str = Field(default="", max_length=1600)
