"""Interview practice: question generation, scoring and report persistence."""

from __future__ import annotations

import json
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import ValidationError

from .coaching_generator import PERSONA_HINTS
from .llm_provider import extract_json_object, get_active_model_label, get_provider
from .schema_definitions import (
    InterviewComprehensiveReport,
    InterviewPracticePayload,
    InterviewReportDimensions,
    InterviewScoreResult,
)

_PRACTICE_PATH = "interview_practice.json"


def _fallback_questions() -> InterviewPracticePayload:
    questions = [
        {
            "id": "fx_intro",
            "category": "general",
            "category_label": "开场",
            "question": "请用 1 分钟介绍自己，并说明你和目标岗位最相关的经历。",
            "reference_answer": "我会先用一句话交代自己的背景，再选一个和岗位最相关的项目说明我的职责、动作和结果。回答重点不是罗列经历，而是让面试官快速听到我能解决什么问题。",
        },
        {
            "id": "fx_resume_project",
            "category": "resume_depth",
            "category_label": "简历深挖",
            "question": "简历里最能代表你能力的一段经历是什么？请讲清楚背景、你的动作和结果。",
            "reference_answer": "我会选择最贴近岗位要求的一段经历，按背景、任务、行动、结果来讲。重点放在我实际负责的部分，以及最终带来的指标、效率或协作结果。",
        },
        {
            "id": "fx_role_fit",
            "category": "role_fit",
            "category_label": "岗位匹配",
            "question": "为什么你认为自己适合这个岗位？请用证据链说明。",
            "reference_answer": "我会把岗位要求拆成两到三个关键能力，再逐一对应自己的经历。每一点都用具体项目、产出或指标支撑，避免只说性格优势。",
        },
        {
            "id": "fx_gap",
            "category": "role_fit",
            "category_label": "风险补强",
            "question": "你觉得自己目前和这个岗位相比还有什么短板？你准备怎么补？",
            "reference_answer": "我会承认一个真实但可补齐的短板，说明它对岗位的影响，再给出已经在做的补强动作，例如学习、复盘、请教或用小项目练习。",
        },
        {
            "id": "fx_closing",
            "category": "company_motivation",
            "category_label": "收尾反问",
            "question": "你有什么想反问我们的？请给出 2 个高质量问题。",
            "reference_answer": "我会围绕岗位成功标准和团队当前挑战来提问，例如这个岗位前三个月最重要的工作成果是什么，以及团队现在最希望新人补上的能力是什么。",
        },
    ]
    return InterviewPracticePayload(questions=questions)


def _build_context_blob(documents: List[Dict[str, Any]], text_map: Dict[str, str]) -> str:
    lines: List[str] = []
    for d in documents or []:
        name = d.get("name", "")
        label = d.get("label", "") or d.get("type", "")
        body = (text_map or {}).get(name, "")[:12000]
        if body.strip():
            lines.append(f"【{label or name}】{name}\n{body}")
    return "\n\n---\n\n".join(lines) if lines else "暂无可用材料正文。"


def messages_interview_practice(*, context_blob: str) -> List[Dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "你是严格但务实的面试官。请基于候选人材料生成个性化面试练习题。"
                "题目要符合真实面试顺序：开场、简历深挖、岗位匹配、风险补强、收尾反问。"
                "参考回答必须假设回答者就是候选人本人，不能出现 xx、某某、占位符或空泛模板。"
                "只输出 JSON：{\"questions\":[{\"id\":\"q1\",\"category\":\"general|resume_depth|role_fit|company_motivation\",\"category_label\":\"中文标签\",\"question\":\"题目\",\"reference_answer\":\"完整参考回答\"}]}。"
            ),
        },
        {"role": "user", "content": f"候选人材料：\n{context_blob}"},
    ]


def _clean_question(q: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(q)
    out["id"] = out.get("id") or f"llm_{uuid.uuid4().hex[:8]}"
    out["category"] = out.get("category") or "general"
    out["category_label"] = out.get("category_label") or "面试题"
    out["question"] = (out.get("question") or "").strip() or "请介绍一段你最相关的经历。"
    ref = (out.get("reference_answer") or "").strip()
    for token in ("xx", "XX", "××", "某某", "请参见以下问题"):
        ref = ref.replace(token, "")
    out["reference_answer"] = ref or "请结合自己的真实经历，按背景、行动和结果回答。"
    return out


def order_practice_questions(questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not questions:
        return []
    intro = [q for q in questions if q.get("id") == "fx_intro" or "介绍" in (q.get("question") or "")]
    closing = [q for q in questions if q.get("id") == "fx_closing" or "反问" in (q.get("question") or "")]
    used = {id(x) for x in intro + closing}
    middle = [q for q in questions if id(q) not in used]
    random.shuffle(middle)
    ordered = (intro[:1] or questions[:1]) + middle
    if closing:
        ordered += closing[:1]
    return ordered[:24]


def generate_interview_practice_pack(*, documents: List[Dict[str, Any]], text_map: Dict[str, str]) -> InterviewPracticePayload:
    raw = get_provider().complete(messages_interview_practice(context_blob=_build_context_blob(documents, text_map)), json_mode=True)
    data = extract_json_object(raw)
    payload = InterviewPracticePayload.model_validate(data)
    base = [_clean_question(q.model_dump()) for q in _fallback_questions().questions]
    extra = [_clean_question(q.model_dump()) for q in payload.questions]
    seen: set[str] = set()
    merged: List[Dict[str, Any]] = []
    for q in base + extra:
        qid = q["id"]
        if qid in seen:
            q["id"] = f"q_{uuid.uuid4().hex[:8]}"
        seen.add(q["id"])
        merged.append(q)
    return InterviewPracticePayload(questions=order_practice_questions(merged))


def generate_interview_practice_pack_safe(*, documents: List[Dict[str, Any]], text_map: Dict[str, str]) -> InterviewPracticePayload:
    try:
        return generate_interview_practice_pack(documents=documents, text_map=text_map)
    except (ValueError, ValidationError, OSError, RuntimeError, KeyError):
        return _fallback_questions()


def messages_interview_score(*, question: str, user_answer: str, reference_answer: str = "", persona_hint: str = "") -> List[Dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "你是严格的面试评分员。结合题目、参考回答和候选人作答评分。"
                "明显过短、跑题、敷衍、只有“我不知道”的回答必须低分。"
                "只输出 JSON：{\"score\":1-10,\"comment\":\"结合题目的点评\",\"improvement\":\"具体改进建议\"}。"
            ),
        },
        {
            "role": "user",
            "content": f"面试官风格：{persona_hint}\n题目：{question}\n候选人作答：{user_answer}\n参考回答：{reference_answer}",
        },
    ]


def _rule_cap(user_answer: str) -> int:
    ua = (user_answer or "").strip()
    bad = ("不知道", "不清楚", "没想", "没有准备", "不了解", "不好说", "没考虑", "随便", "不会")
    if len(ua) < 8:
        return 1
    if any(x in ua for x in bad):
        return 2
    if len(ua) < 20:
        return 3
    if len(ua) < 45:
        return 5
    return 10


def _rule_score(question: str, user_answer: str, reference_answer: str) -> int:
    ua = (user_answer or "").strip()
    ref = (reference_answer or "").strip()
    cap = _rule_cap(ua)
    if cap <= 3:
        return cap
    score = 5
    if len(ref) > 80 and len(ua) >= max(50, len(ref) // 4):
        score += 2
    if any(mark in ua for mark in ("。", "；", "\n", "，")):
        score += 1
    if any(word in ua for word in ("负责", "推动", "结果", "指标", "复盘", "因为", "所以")):
        score += 1
    return min(cap, max(1, min(10, score)))


def score_interview_answer(*, question: str, user_answer: str, reference_answer: str = "", persona_id: str = "calm_rational") -> InterviewScoreResult:
    if not (user_answer or "").strip():
        return InterviewScoreResult(score=1, comment="作答过短，无法评估。", improvement="请先写满两三句再评分。")
    rule = _rule_score(question, user_answer, reference_answer)
    cap = _rule_cap(user_answer)
    hint = PERSONA_HINTS.get(persona_id, PERSONA_HINTS["calm_rational"])
    raw = get_provider().complete(
        messages_interview_score(question=question, user_answer=user_answer.strip(), reference_answer=reference_answer, persona_hint=hint),
        json_mode=True,
    )
    data = extract_json_object(raw)
    result = InterviewScoreResult.model_validate(data)
    blended = max(1, min(cap, round(result.score * 0.3 + rule * 0.7)))
    return result.model_copy(update={"score": blended})


def messages_interview_full_report(*, context_blob: str, qa_blob: str) -> List[Dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "你是资深 HRBP 和业务面试官。基于候选人材料与整套作答输出综合分析。"
                "维度分必须逐项判断，不能默认全 5 分。只输出 JSON："
                "{\"overall\":\"总体评价\",\"per_question_summary\":[\"逐题摘要\"],\"top_gaps\":\"补强点\","
                "\"role_fit_judgement\":\"岗位匹配判断\",\"hire_risk_and_highlights\":\"风险与亮点\","
                "\"dimensions\":{\"expression_clarity\":1,\"logic\":1,\"role_match\":1,\"authenticity\":1,\"professionalism\":1,\"persuasion\":1}}。"
            ),
        },
        {"role": "user", "content": f"材料摘要：\n{context_blob}\n\n整套问答：\n{qa_blob}"},
    ]


def submit_practice_full_report_safe(*, documents: List[Dict[str, Any]], text_map: Dict[str, str], questions: List[Dict[str, Any]], answers: Dict[str, str]) -> InterviewComprehensiveReport:
    lines: List[str] = []
    for q in questions:
        qid = q.get("id", "")
        ans = (answers.get(qid, "") or "").strip()
        if _rule_cap(ans) <= 3:
            raise ValueError("报告暂未生成成功，请补全答案后重试。")
        lines.append(f"【{qid}】{q.get('question')}\n作答：{ans}")
    raw = get_provider().complete(
        messages_interview_full_report(context_blob=_build_context_blob(documents, text_map)[:14000], qa_blob="\n\n".join(lines)[:24000]),
        json_mode=True,
    )
    data = extract_json_object(raw)
    return InterviewComprehensiveReport.model_validate(data)


def save_practice_pack(
    runtime_dir: Path,
    payload: InterviewPracticePayload,
    answers: Optional[Dict[str, str]] = None,
    full_report: Optional[Dict[str, Any]] = None,
) -> None:
    p = runtime_dir / _PRACTICE_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    prev = load_practice_pack(runtime_dir) or {}
    doc: Dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model_hint": get_active_model_label(),
        "questions": [q.model_dump() for q in payload.questions],
        "answers": answers if answers is not None else prev.get("answers", {}),
        "full_report": full_report,
    }
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def load_practice_pack(runtime_dir: Path) -> Optional[Dict[str, Any]]:
    p = runtime_dir / _PRACTICE_PATH
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None
