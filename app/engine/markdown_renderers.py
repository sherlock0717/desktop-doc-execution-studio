"""Render validated JSON payloads into user-facing markdown."""

from __future__ import annotations

from collections import defaultdict

from .schema_definitions import InterviewPackPayload, JobBriefPayload, ResumeDeltaPayload


def _clean_line(value: object) -> str:
    return str(value or "").strip()


def _bullets(lines: list[str]) -> str:
    cleaned = [_clean_line(x) for x in lines if _clean_line(x)]
    return "\n".join(f"- {x}" for x in cleaned)


def _section(title: str, body: str) -> list[str]:
    if not body.strip():
        return []
    return [f"## {title}", body.strip(), ""]


def render_job_brief_md(payload: JobBriefPayload) -> str:
    lines = ["# 岗位理解卡", ""]
    lines.extend(_section("岗位重点", _bullets(payload.job_focus)))
    lines.extend(_section("当前匹配点", _bullets(payload.match_points)))
    lines.extend(_section("当前缺口", _bullets(payload.gaps)))
    lines.extend(_section("下一步补强建议", _bullets(payload.next_steps)))
    return "\n".join(lines).strip() + "\n"


def render_resume_delta_md(payload: ResumeDeltaPayload) -> str:
    by_cat: dict[str, list[str]] = defaultdict(list)
    sec_labels = {
        "basic_info": "基本信息",
        "education": "教育经历",
        "projects": "项目经历",
        "internships": "实习与实践",
        "skills": "技能",
        "summary": "个人总结",
        "general": "整体表达",
    }
    for it in payload.items:
        text = _clean_line(getattr(it, "text", ""))
        if not text:
            continue
        sec = sec_labels.get(getattr(it, "target_section", "general"), "整体表达")
        by_cat[getattr(it, "category", "strengthen")].append(f"{text}（目标区块：{sec}）")

    order = ["strengthen", "add_expression", "weaken", "rewrite_direction"]
    titles = {
        "strengthen": "建议强化",
        "add_expression": "建议补充",
        "weaken": "建议弱化",
        "rewrite_direction": "改写方向",
    }
    lines = ["# 简历修改建议", ""]
    for cat in order:
        body = _bullets(by_cat.get(cat, []))
        lines.extend(_section(titles[cat], body))
    return "\n".join(lines).strip() + "\n"


def render_interview_pack_md(payload: InterviewPackPayload) -> str:
    lines = ["# 面试准备包", ""]
    lines.extend(_section("最值得主动讲的内容", _bullets(payload.highlight_topics)))
    lines.extend(_section("可能被继续追问的问题", _bullets(payload.followup_risks)))
    lines.extend(_section("需要补证据的地方", _bullets(payload.need_more_evidence)))
    lines.extend(_section("当前仍缺少的输入", _bullets(payload.missing_inputs)))
    return "\n".join(lines).strip() + "\n"
