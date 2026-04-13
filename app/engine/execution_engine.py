"""Case runtime: execution state, working drafts, comparisons, goal-mode truncation."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .schema_definitions import InterviewPackPayload, JobBriefPayload, ResumeDeltaPayload


def case_runtime_dir(root: Path, case_id: str) -> Path:
    return root / "outputs" / "case_runtime" / case_id


def normalize_text(t: str) -> str:
    return " ".join((t or "").split())


def apply_goal_mode_truncation(
    goal_mode: str,
    job: JobBriefPayload,
    resume: ResumeDeltaPayload,
    interview: InterviewPackPayload,
) -> Tuple[JobBriefPayload, ResumeDeltaPayload, InterviewPackPayload]:
    """Post-process: enforce simplified packs for non-primary modes."""

    def cap_list(lst: List[str], n: int) -> List[str]:
        return [x for x in lst if str(x).strip()][:n]

    if goal_mode == "delivery":
        interview = InterviewPackPayload(
            highlight_topics=cap_list(interview.highlight_topics, 2),
            followup_risks=cap_list(interview.followup_risks, 2),
            need_more_evidence=cap_list(interview.need_more_evidence, 2),
            missing_inputs=cap_list(interview.missing_inputs, 2),
            cited_snippet_ids=interview.cited_snippet_ids[:8],
        )
        return job, resume, interview

    if goal_mode == "interview":
        job = JobBriefPayload(
            job_focus=cap_list(job.job_focus, 2),
            match_points=cap_list(job.match_points, 2),
            gaps=cap_list(job.gaps, 2),
            next_steps=cap_list(job.next_steps, 2),
            cited_snippet_ids=job.cited_snippet_ids[:8],
        )
        capped_items = resume.items[:8] if len(resume.items) > 8 else resume.items
        resume = ResumeDeltaPayload(
            items=capped_items,
            cited_snippet_ids=resume.cited_snippet_ids[:8],
        )
        return job, resume, interview

    return job, resume, interview


def new_generation_id() -> str:
    return "gen_" + hashlib.sha256(str(datetime.now().timestamp()).encode()).hexdigest()[:10]


ACCENT_PALETTE = [
    "#b84a5f",
    "#2a7a8c",
    "#6b4f9e",
    "#b8860b",
    "#2e7d4a",
    "#c06040",
    "#3d6a8a",
    "#8b4d6b",
]


def _split_suggestion_text(text: str, max_len: int = 96) -> List[str]:
    """Avoid one huge suggestion: split into smaller actionable items."""
    t = (text or "").strip()
    if not t:
        return []
    if len(t) <= max_len:
        return [t]
    parts = re.split(r"(?<=[。！？])\s*|\n+", t)
    out: List[str] = []
    buf = ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        cand = (buf + p).strip() if buf else p
        if len(cand) <= max_len:
            buf = cand
        else:
            if buf:
                out.append(buf)
            buf = p
    if buf:
        out.append(buf)
    if not out:
        return [t[:max_len]]
    return out


def resume_payload_to_suggestion_items(resume: ResumeDeltaPayload, generation_id: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    n = 0
    for it in resume.items:
        chunks = _split_suggestion_text(it.text or "")
        for ch in chunks:
            n += 1
            items.append(
                {
                    "id": f"rs_{generation_id}_{n:03d}",
                    "generation_id": generation_id,
                    "category": it.category,
                    "text": ch,
                    "target_section": it.target_section,
                    "status": "pending",
                    "applied_to_draft": False,
                    "accent_color": ACCENT_PALETTE[(n - 1) % len(ACCENT_PALETTE)],
                }
            )
    return items


def merge_suggestion_status(prev_items: List[Dict[str, Any]], new_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    prev_map = {normalize_text(x.get("text", "")): x for x in prev_items}
    out: List[Dict[str, Any]] = []
    for ni in new_items:
        key = normalize_text(ni.get("text", ""))
        if key in prev_map:
            p = prev_map[key]
            ni = {
                **ni,
                "status": p.get("status", "pending"),
                "applied_to_draft": p.get("applied_to_draft", False),
            }
            if not ni.get("target_section") and p.get("target_section"):
                ni["target_section"] = p["target_section"]
            if ni.get("applied_to_draft") and p.get("applied_at"):
                ni["applied_at"] = p.get("applied_at")
            if p.get("pre_apply_section_body"):
                ni["pre_apply_section_body"] = p.get("pre_apply_section_body")
            if p.get("accent_color"):
                ni["accent_color"] = p.get("accent_color")
        out.append(ni)
    return out


def build_comparison_summary(
    *,
    generation_id: str,
    previous_generation_id: Optional[str],
    prev_files: List[str],
    new_files: List[str],
    prev_missing: List[str],
    new_missing: List[str],
    prev_suggestions: List[Dict[str, Any]],
    new_suggestions: List[Dict[str, Any]],
) -> Dict[str, Any]:
    ps, ns = set(prev_files), set(new_files)
    old_texts = {normalize_text(s.get("text", "")) for s in prev_suggestions if s.get("text")}
    new_texts = {normalize_text(s.get("text", "")) for s in new_suggestions if s.get("text")}

    added_s = [s["text"] for s in new_suggestions if normalize_text(s.get("text", "")) not in old_texts]
    removed_s = [t for t in old_texts if t and t not in new_texts]

    return {
        "generation_id": generation_id,
        "previous_generation_id": previous_generation_id,
        "new_input_files": sorted(ns - ps),
        "removed_input_files": sorted(ps - ns),
        "gap_changes": {
            "added": [x for x in new_missing if x not in prev_missing],
            "removed": [x for x in prev_missing if x not in new_missing],
        },
        "suggestions": {
            "added": added_s,
            "removed": removed_s,
            "unchanged_count": len(old_texts & new_texts),
        },
    }


def load_execution_state(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_execution_state(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def working_draft_paths(runtime: Path) -> Tuple[Path, Path]:
    return runtime / "resume_working_draft.md", runtime / "interview_talking_draft.md"


def ensure_interview_talking_draft(interview_path: Path, interview_text: str) -> None:
    if interview_path.exists() and interview_path.stat().st_size > 20:
        return
    body = (interview_text or "").strip() or "（可在此整理面试叙事、故事线与要点。）"
    content = "\n".join(
        [
            "# 面试表达工作稿",
            "",
            "## 原始参考（来自材料，可编辑）",
            "",
            body,
            "",
            "## 已采纳要点（由操作区写入，可改）",
            "",
            "_暂无_",
            "",
        ]
    )
    interview_path.parent.mkdir(parents=True, exist_ok=True)
    interview_path.write_text(content, encoding="utf-8")


def working_draft_status(resume_p: Path, interview_p: Path) -> Dict[str, Any]:
    def stat_one(p: Path, key: str) -> Dict[str, Any]:
        if not p.exists():
            return {"exists": False, "chars": 0, "key": key}
        c = read_safe(p)
        return {"exists": True, "chars": len(c), "key": key}

    return {
        "resume": stat_one(resume_p, "resume"),
        "interview": stat_one(interview_p, "interview"),
    }


def read_safe(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except Exception:
        return ""
