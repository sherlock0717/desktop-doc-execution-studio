"""Resume working draft helpers for the v0.1 local prototype."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

SECTION_KEYS_ORDER: List[str] = ["basic_info", "education", "projects", "internships", "skills", "summary"]

SECTION_TITLES: Dict[str, str] = {
    "basic_info": "基本信息",
    "education": "教育背景",
    "projects": "项目经历",
    "internships": "实习经历",
    "skills": "技能与工具",
    "summary": "个人总结",
}

VALID_TARGET_SECTIONS = set(SECTION_KEYS_ORDER) | {"general"}
EMPTY_LINE = ""


def normalize_target_section(raw: str) -> str:
    t = (raw or "").strip().lower()
    if t in VALID_TARGET_SECTIONS:
        return t
    aliases = {
        "basic": "basic_info",
        "info": "basic_info",
        "edu": "education",
        "project": "projects",
        "intern": "internships",
        "internship": "internships",
        "skill": "skills",
        "self": "summary",
    }
    return aliases.get(t, "general")


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def _clean_line(line: str) -> str:
    s = line.strip()
    s = re.sub(r"^#{1,6}\s*", "", s)
    s = re.sub(r"^>\s*", "", s)
    return s


def partition_resume_coarse(text: str) -> Dict[str, str]:
    t = (text or "").strip()
    buckets: Dict[str, List[str]] = {k: [] for k in SECTION_KEYS_ORDER}
    if not t:
        return {k: "" for k in SECTION_KEYS_ORDER}

    current = "basic_info"
    patterns = {
        "education": re.compile(r"教育|学历|学校|专业|本科|硕士|博士|毕业|GPA|学位"),
        "projects": re.compile(r"项目|作品|课题|竞赛|开源|GitHub|github"),
        "internships": re.compile(r"实习|工作经历|任职|公司|岗位|职责"),
        "skills": re.compile(r"技能|工具|证书|熟练|掌握|Python|Java|SQL|Excel"),
        "summary": re.compile(r"自我|评价|总结|求职|意向|概述|简介"),
        "basic_info": re.compile(r"姓名|手机|电话|邮箱|微信|地址|年龄|性别"),
    }
    header_like = re.compile(r"^[#\s]*(基本信息|教育背景|项目经历|实习经历|工作经历|技能|个人总结|自我评价)")
    for raw in t.splitlines():
        line = _clean_line(raw)
        if not line:
            continue
        if header_like.search(line):
            for key, pat in patterns.items():
                if pat.search(line):
                    current = key
                    break
            continue
        for key, pat in patterns.items():
            if pat.search(line) and (len(line) < 80 or key != "basic_info"):
                current = key
                break
        buckets[current].append(line)

    return {k: "\n".join(v).strip() for k, v in buckets.items()}


def build_clean_from_parts(parts: Dict[str, str]) -> str:
    lines: List[str] = ["# 简历", ""]
    for key in SECTION_KEYS_ORDER:
        body = (parts.get(key) or "").strip()
        if not body:
            continue
        lines.extend([f"## {SECTION_TITLES[key]}", "", body, ""])
    if len(lines) <= 2:
        return ""
    return "\n".join(lines).rstrip() + "\n"


def build_structured_resume_draft_markdown(resume_text: str) -> str:
    return build_clean_from_parts(partition_resume_coarse(resume_text)) or (resume_text or "").strip()


def migrate_old_template_to_clean(markdown: str) -> str:
    md = markdown or ""
    md = re.sub(r"<!--JMS_IMP_START:[^>]+-->[\s\S]*?<!--JMS_IMP_END:[^>]+-->", "", md)
    md = md.replace("简历工作稿（区块对照改稿台）", "简历")
    md = re.sub(r"(?m)^#{1,6}\s*(原始内容|已应用建议.*|本次改进).*?$", "", md)
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return md


def ensure_structured_resume_draft(resume_path: Path, resume_text: str) -> None:
    resume_path.parent.mkdir(parents=True, exist_ok=True)
    if not resume_path.exists() or resume_path.stat().st_size < 30:
        body = build_structured_resume_draft_markdown(resume_text)
        resume_path.write_text(body, encoding="utf-8")
        return
    raw = _read(resume_path)
    clean = migrate_old_template_to_clean(raw)
    if clean != raw:
        resume_path.write_text(clean, encoding="utf-8")


def _section_header_line(key: str) -> str:
    return f"## {SECTION_TITLES[key]}"


def improvement_block_markers(suggestion_id: str) -> tuple[str, str]:
    sid = (suggestion_id or "").strip() or "unknown"
    return (f"<!--JMS_IMP_START:{sid}-->", f"<!--JMS_IMP_END:{sid}-->")


def strip_improvement_blocks_for_llm(body: str) -> str:
    return re.sub(r"<!--JMS_IMP_START:[^>]+-->[\s\S]*?<!--JMS_IMP_END:[^>]+-->", "", body or "").strip()


def remove_improvement_block(raw: str, suggestion_id: str) -> str:
    start_m, end_m = improvement_block_markers(suggestion_id)
    pattern = re.escape(start_m) + r"[\s\S]*?" + re.escape(end_m)
    return re.sub(r"\n{3,}", "\n\n", re.sub(pattern, "", raw or "", count=1)).strip() + "\n"


def insert_improvement_block_near_section_header(raw: str, *, section_key: str, suggestion_id: str, summary_line: str) -> str:
    # Kept for compatibility. v0.1 no longer inserts visible suggestion blocks into the draft.
    return raw or ""


def _target_key(section_key: str) -> str:
    key = normalize_target_section(section_key)
    return "summary" if key == "general" else key


def get_section_body_text(raw: str, section_key: str) -> str:
    key = _target_key(section_key)
    md = migrate_old_template_to_clean(raw or "")
    header = _section_header_line(key)
    pos = md.find(header)
    if pos < 0:
        return ""
    sec_end = md.find("\n## ", pos + len(header))
    if sec_end < 0:
        sec_end = len(md)
    return md[pos + len(header) : sec_end].strip()


def replace_section_body_in_raw(raw: str, section_key: str, new_body: str) -> str:
    key = _target_key(section_key)
    md = migrate_old_template_to_clean(raw or "")
    header = _section_header_line(key)
    if header not in md:
        md = md.rstrip() + f"\n\n{header}\n\n"
    pos = md.find(header)
    sec_end = md.find("\n## ", pos + len(header))
    if sec_end < 0:
        sec_end = len(md)
    body = (new_body or "").strip()
    return (md[:pos] + f"{header}\n\n{body}\n" + md[sec_end:]).strip() + "\n"


def replace_section_body_in_file(resume_path: Path, section_key: str, new_body: str) -> None:
    raw = _read(resume_path)
    resume_path.write_text(replace_section_body_in_raw(raw, section_key, new_body), encoding="utf-8")


def apply_suggestion_to_resume_draft(resume_path: Path, *, target_section: str, suggestion_id: str, category: str, text: str) -> str:
    _ = suggestion_id, category
    raw = _read(resume_path)
    current = get_section_body_text(raw, target_section)
    merged = (current + "\n" + (text or "").strip()).strip()
    replace_section_body_in_file(resume_path, target_section, merged)
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def extract_section_bodies_map(markdown: str) -> Dict[str, str]:
    md = migrate_old_template_to_clean(markdown or "")
    out = {k: "" for k in SECTION_KEYS_ORDER}
    for key in SECTION_KEYS_ORDER:
        out[key] = get_section_body_text(md, key)
    return out


def save_original_resume_snapshot(runtime_dir: Path, resume_markdown: str) -> None:
    p = runtime_dir / "resume_original_sections.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(extract_section_bodies_map(resume_markdown), ensure_ascii=False, indent=2), encoding="utf-8")


def load_original_resume_snapshot(runtime_dir: Path) -> Dict[str, str]:
    p = runtime_dir / "resume_original_sections.json"
    if not p.is_file():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def build_resume_section_views(markdown: str, suggestion_items: Optional[List[Dict[str, Any]]] = None, original_sections: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
    orig = original_sections or {}
    current = extract_section_bodies_map(markdown)
    counts: Dict[str, int] = {}
    for s in suggestion_items or []:
        if not s.get("applied_to_draft"):
            continue
        key = _target_key(s.get("target_section") or "general")
        counts[key] = counts.get(key, 0) + 1
    out = []
    for key in SECTION_KEYS_ORDER:
        old = orig.get(key, "")
        new = current.get(key, "")
        changed = " ".join(old.split()) != " ".join(new.split())
        out.append(
            {
                "section_key": key,
                "section_title": SECTION_TITLES[key],
                "original_content": old,
                "current_draft_content": new,
                "applied_suggestion_count": counts.get(key, 0),
                "has_real_diff": changed,
                "show_in_compare": changed and bool(new.strip()),
            }
        )
    return out


def parse_resume_draft_sections(markdown: str) -> List[Dict[str, str]]:
    md = migrate_old_template_to_clean(markdown or "")
    out: List[Dict[str, str]] = []
    for key in SECTION_KEYS_ORDER:
        body = get_section_body_text(md, key)
        if body:
            out.append({"title": SECTION_TITLES[key], "body": body})
    return out


def build_draft_apply_summary(suggestion_items: List[Dict[str, Any]]) -> Dict[str, Any]:
    applied = [s for s in suggestion_items if s.get("applied_to_draft")]
    accepted = [s for s in suggestion_items if s.get("status") == "accepted"]
    accepted_not_applied = [s for s in accepted if not s.get("applied_to_draft")]
    still_open = [s for s in suggestion_items if not s.get("applied_to_draft") and s.get("status") in ("accepted", "pending")]
    sections_touched = sorted({_target_key(s.get("target_section") or "general") for s in applied})
    return {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sections_with_applications": [x for x in sections_touched if x and x != "general"],
        "applied_suggestion_ids": [s["id"] for s in applied],
        "pending_apply_ids": [s["id"] for s in accepted_not_applied],
        "not_applied_yet_ids": [s["id"] for s in still_open],
    }


def save_draft_apply_summary(runtime_dir: Path, suggestion_items: List[Dict[str, Any]]) -> None:
    p = runtime_dir / "draft_apply_summary.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(build_draft_apply_summary(suggestion_items), ensure_ascii=False, indent=2), encoding="utf-8")
