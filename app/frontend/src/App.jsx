import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const PRODUCT_NAME = "求职材料执行台";
const TAGLINE = "解析材料 · 确认主稿 · 查看解析结果 · 面试闭环";
const ONBOARDING_STORAGE_KEY = "jms_onboarding_v1_done";

const GOAL_LABELS = {
  delivery: "投递优化",
  interview: "面试准备",
  both: "投递 + 面试",
};

const DOC_TYPE_OPTIONS = [
  { value: "jd", label: "岗位说明" },
  { value: "resume", label: "简历" },
  { value: "interview_note", label: "面试记录" },
  { value: "supporting_material", label: "补充材料" },
];

const SUGGEST_CATEGORY_LABELS = {
  strengthen: "应强化",
  add_expression: "应补表达",
  weaken: "应弱化",
  rewrite_direction: "改写方向",
};

const TARGET_SECTION_LABELS = {
  basic_info: "基本信息",
  education: "教育背景",
  projects: "项目经历",
  internships: "实习经历",
  skills: "技能/工具",
  summary: "自我总结/求职",
  general: "通用",
};

const SUGGESTION_FILTER_OPTIONS = [
  { value: "all", label: "全部区块" },
  { value: "basic_info", label: "基本信息" },
  { value: "education", label: "教育背景" },
  { value: "projects", label: "项目经历" },
  { value: "internships", label: "实习经历" },
  { value: "skills", label: "技能/工具" },
  { value: "summary", label: "自我总结" },
  { value: "general", label: "通用" },
];

const STAGE_LABELS = ["材料", "建议", "工作稿", "解析后"];

const BUSY_STEPS_PACK = ["正在整理材料与上下文…", "正在生成建议与解析结果…", "正在写入解析记录与依据…"];
const BUSY_STEPS_PARSE = ["正在校验材料类型…", "正在解析材料内容…", "正在准备解析后内容…"];
const BUSY_STEPS_REFINED = ["正在读取当前工作稿…", "正在生成独立润色稿…", "正在保存对照信息…"];
const BUSY_STEPS_UPLOAD = ["正在导入文件…", "正在更新案例…"];
const DEMO_LOADING_STEPS = ["正在加载示例案例", "正在读取示例材料", "正在准备案例内容"];

function excerptOneLine(text, max = 80) {
  if (!text) return "—";
  const line = String(text).replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function previewSummary(content, max = 120) {
  if (content == null) return "";
  const t = String(content).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function suggestionTitle(s) {
  const raw = (s.text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "（无摘要）";
  return raw.length > 56 ? `${raw.slice(0, 56)}…` : raw;
}

function formatSuggestionStatus(s) {
  if (s.applied_to_draft) return "已完成";
  if (s.status === "accepted") return "已接受 · 待写入";
  if (s.status === "pending") return "待处理";
  return "—";
}

function cleanReferenceAnswer(text) {
  const t = String(text || "")
    .replace(/x{2,}|X{2,}|脳脳|××|某某/g, "")
    .replace(/请参见以下问题/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t || "暂无可靠参考回答。";
}

function deriveWorkflowStage(loading, docCount, generationId, overallReady) {
  if (loading) return 0;
  if (docCount === 0) return 1;
  if (!generationId) return 2;
  if (!overallReady) return 3;
  return 4;
}

/** Single contiguous change region in newStr vs oldStr (P0 heuristic). */
function computeChangeRange(oldStr, newStr) {
  if (oldStr == null || newStr == null || oldStr === newStr) return null;
  const a = String(oldStr);
  const b = String(newStr);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  if (start > endB) return null;
  return { start, end: endB + 1 };
}

function buildLineMeta(text) {
  const lines = text.split("\n");
  let offset = 0;
  return lines.map((line) => {
    const o = offset;
    offset += line.length + 1;
    return { line, start: o, end: o + line.length };
  });
}

const RADAR_KEYS = [
  ["expression_clarity", "表达清晰"],
  ["logic", "逻辑性"],
  ["role_match", "岗位匹配"],
  ["authenticity", "真实性"],
  ["professionalism", "专业度"],
  ["persuasion", "说服力"],
];

function InterviewRadar({ dims }) {
  if (!dims) return null;
  const pts = RADAR_KEYS.map(([k], i) => {
    const v = Math.min(10, Math.max(1, Number(dims[k] ?? 5)));
    const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    const r = (v / 10) * 70;
    return [100 + r * Math.cos(angle), 100 + r * Math.sin(angle)];
  });
  const pointsAttr = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <div className="studio-radar-wrap">
      <svg viewBox="0 0 200 200" className="studio-radar-svg" aria-hidden>
        <polygon points={pointsAttr} fill="rgba(150, 80, 110, 0.2)" stroke="rgba(190, 120, 145, 0.85)" strokeWidth="1.2" />
        {RADAR_KEYS.map(([k, lab], i) => {
          const v = Math.min(10, Math.max(1, Number(dims[k] ?? 5)));
          const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
          const x = 100 + 88 * Math.cos(angle);
          const y = 100 + 88 * Math.sin(angle);
          return (
            <text key={k} x={x} y={y} className="studio-radar-lbl" textAnchor="middle" fontSize="9">
              {lab}
              {v}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function App() {
  const fileInputRef = useRef(null);
  const compareWrapRef = useRef(null);
  const draftReadScrollRef = useRef(null);
  const draftEditRef = useRef(null);

  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [outputDetail, setOutputDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [caseTitleDraft, setCaseTitleDraft] = useState("");
  const [draftTab, setDraftTab] = useState("resume");
  const [draftContent, setDraftContent] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSections, setDraftSections] = useState([]);
  const [draftResumeSections, setDraftResumeSections] = useState([]);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftViewMode, setDraftViewMode] = useState("read");
  const [suggestionFilter, setSuggestionFilter] = useState("all");
  const [applyingId, setApplyingId] = useState(null);
  const [refinedCompare, setRefinedCompare] = useState(null);
  const [refinedGenerating, setRefinedGenerating] = useState(false);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const [deletingName, setDeletingName] = useState("");
  const [busyStepIndex, setBusyStepIndex] = useState(0);
  const [busyKind, setBusyKind] = useState(null);
  const [lastWriteRange, setLastWriteRange] = useState(null);
  const preApplyDraftRef = useRef("");

  /** 解析结果：ZIP 保存选项 */
  const [resultPackModalOpen, setResultPackModalOpen] = useState(false);
  const [includeInterviewInZip, setIncludeInterviewInZip] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [interviewExpressionMd, setInterviewExpressionMd] = useState("");
  const [practicePack, setPracticePack] = useState(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceGenerating, setPracticeGenerating] = useState(false);
  const [userPracticeAnswers, setUserPracticeAnswers] = useState({});
  const [practiceScores, setPracticeScores] = useState({});
  const [scoringQuestionId, setScoringQuestionId] = useState(null);
  const [practiceReportError, setPracticeReportError] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [capabilityNoticeDismissed, setCapabilityNoticeDismissed] = useState(false);

  const [detailModal, setDetailModal] = useState(null);
  const [refinedModalLoading, setRefinedModalLoading] = useState(false);
  const [refinedModalBody, setRefinedModalBody] = useState("");

  const [helpOpen, setHelpOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  const [aiStatus, setAiStatus] = useState({ checking: true, available: null, model: "", backend: "" });
  const [materialPreview, setMaterialPreview] = useState(null);
  const [hrPersonaModalOpen, setHrPersonaModalOpen] = useState(false);

  const busyVisible = generating || refinedGenerating || uploading || practiceGenerating || exportingZip;

  function clearTransientCaseState() {
    setSelectedOutputId("");
    setOutputDetail(null);
    setMaterialPreview(null);
    setInterviewExpressionMd("");
    setPracticePack(null);
    setUserPracticeAnswers({});
    setPracticeScores({});
    setPracticeReportError("");
    setDraftContent("");
    setDraftSections([]);
    setDraftResumeSections([]);
    setDraftDirty(false);
    setLastWriteRange(null);
    setDetailModal(null);
    setRefinedCompare(null);
    setCapabilityNoticeDismissed(false);
  }

  useEffect(() => {
    loadCaseData();
  }, []);

  useEffect(() => {
    let id;
    function poll() {
      fetch(`${API}/api/ai-status`)
        .then((res) => (res.ok ? res.json() : null))
        .then((d) => {
          if (d)
            setAiStatus({
              checking: false,
              available: d.available,
              model: d.model || "",
              backend: d.backend || "",
              affected: d.affected_when_unavailable || [],
            });
        })
        .catch(() => setAiStatus((s) => ({ ...s, checking: false, available: false })));
    }
    poll();
    id = setInterval(poll, 20000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const rid = caseData?.execution?.refined_draft_preview?.refined_id;
    if (!rid) {
      setRefinedCompare(null);
      return;
    }
    fetch(`${API}/api/refined-draft/compare`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => setRefinedCompare(data))
      .catch(() => setRefinedCompare(null));
  }, [caseData?.execution?.refined_draft_preview?.refined_id]);

  useEffect(() => {
    setEvidenceExpanded(false);
  }, [selectedOutputId]);

  useEffect(() => {
    if (caseData?.title != null) {
      setCaseTitleDraft(caseData.title);
    }
  }, [caseData?.title]);

  useEffect(() => {
    if (!caseData?.case_id || loading) return;
    if (draftTab === "none") {
      setDraftContent("");
      setDraftSections([]);
      setDraftResumeSections([]);
      setDraftDirty(false);
      return;
    }
    if (draftTab === "practice") {
      loadPracticePack();
      return;
    }
    if (draftTab === "interview") {
      setDraftContent("");
      setDraftSections([]);
      setDraftResumeSections([]);
      setDraftDirty(false);
      return;
    }
    loadWorkingDraft(draftTab);
  }, [caseData?.case_id, draftTab, loading]);

  useEffect(() => {
    setDraftViewMode("read");
    setLastWriteRange(null);
  }, [draftTab]);

  useEffect(() => {
    if (draftTab !== "interview" || loading || !caseData?.case_id) return;
    fetch(`${API}/api/interview-expression`)
      .then(async (res) => {
        if (!res.ok) return { content: "" };
        return res.json();
      })
      .then((d) => setInterviewExpressionMd(d.content || ""))
      .catch(() => setInterviewExpressionMd(""));
  }, [draftTab, loading, caseData?.case_id]);

  useEffect(() => {
    const ex = caseData?.execution;
    const locked = ex?.hr_persona?.locked;
    if (!caseData?.case_id || loading) return;
    if ((draftTab === "interview" || draftTab === "practice") && !locked) {
      setHrPersonaModalOpen(true);
    } else {
      setHrPersonaModalOpen(false);
    }
  }, [draftTab, caseData?.case_id, caseData?.execution?.hr_persona?.locked, loading]);

  useEffect(() => {
    if (!busyVisible) {
      setBusyStepIndex(0);
      setBusyKind(null);
      return;
    }
    if (generating && busyKind !== "parse") setBusyKind("pack");
    else if (refinedGenerating) setBusyKind("refined");
    else if (uploading) setBusyKind("upload");
    const t = setInterval(() => {
      setBusyStepIndex((i) => i + 1);
    }, 2200);
    return () => clearInterval(t);
  }, [busyVisible, generating, refinedGenerating, uploading, busyKind]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
  }, []);

  useEffect(() => {
    if (detailModal?.type !== "compare" || !detailModal.scrollKey) return;
    const key = detailModal.scrollKey;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const wrap = compareWrapRef.current;
        if (!wrap) return;
        const el = wrap.querySelector(`[data-section-key="${CSS.escape(key)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  }, [detailModal]);

  function finishOnboarding() {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
    }
    setOnboardingOpen(false);
  }

  function openHelp() {
    setHelpOpen(true);
  }

  function replayTutorial() {
    setHelpOpen(false);
    setOnboardingStep(0);
    setOnboardingOpen(true);
  }

  function loadCaseData(preferredOutputId = "", options = {}) {
    const silent = options.silent === true;
    if (!silent) setLoading(true);
    return fetch(`${API}/api/current-case`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("读取案例失败");
        }
        return res.json();
      })
      .then((data) => {
        setCaseData(data);
        setErrorText("");
        if (!silent) setLoading(false);

        if (data?.mode === "blank") {
          setSelectedOutputId("");
          setOutputDetail(null);
          setMaterialPreview(null);
          return data;
        }

        const outputs = data?.outputs || [];
        if (outputs.length === 0) {
          setOutputDetail(null);
          return data;
        }

        if (data?.mode === "demo") {
          setMaterialPreview(null);
        }

        const nextItem =
          outputs.find((item) => item.id === preferredOutputId) || outputs[0];

        setSelectedOutputId(nextItem.id);

        if (nextItem.status === "ready") {
          loadOutputDetail(nextItem.id);
        } else {
          setOutputDetail({
            title: nextItem.name,
            format: nextItem.format,
            content: "尚未完成解析：点击顶部「开始解析」。",
            evidence: [],
            generation_meta: null,
            acceptance: null,
          });
        }
        return data;
      })
      .catch(() => {
        setErrorText("无法连接后端（请确认本机 8000 服务已启动）。");
        if (!silent) setLoading(false);
      });
  }

  function loadOutputDetail(outputId) {
    setDetailLoading(true);
    fetch(`${API}/api/current-output/${outputId}`)
      .then(async (res) => {
        if (!res.ok) {
          let message = "读取解析结果失败";
          try {
            const err = await res.json();
            if (err?.detail) {
              message = err.detail;
            }
          } catch {}
          throw new Error(message);
        }
        return res.json();
      })
      .then((data) => {
        setOutputDetail(data);
        setDetailLoading(false);
      })
      .catch((err) => {
        setOutputDetail({
          title: "预览不可用",
          format: "text",
          content: err.message || "暂时无法预览解析结果。",
          evidence: [],
          generation_meta: null,
          acceptance: null,
        });
        setDetailLoading(false);
      });
  }

  function handleSelectOutput(item) {
    setSelectedOutputId(item.id);

    if (item.status !== "ready") {
      setOutputDetail({
        title: item.name,
        format: item.format,
        content: "尚未完成解析：点击顶部「开始解析」。",
        evidence: [],
        generation_meta: null,
        acceptance: null,
      });
      return;
    }

    loadOutputDetail(item.id);
  }

  function handleOpenFilePicker() {
    fileInputRef.current?.click();
  }

  function handleFileChange(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const formData = new FormData();
    files.forEach((file) => {
      formData.append("files", file);
    });

    setUploading(true);
    setActionMessage("");
    clearTransientCaseState();
    setDraftTab("resume");

    fetch(`${API}/api/upload-documents`, {
      method: "POST",
      body: formData,
    })
      .then(async (res) => {
        if (!res.ok) {
          let message = "导入失败";
          try {
            const err = await res.json();
            if (err?.detail) {
              message = err.detail;
            }
          } catch {}
          throw new Error(message);
        }
        return res.json();
      })
      .then((data) => {
        setActionMessage(data.message || "文件已导入。");
        setCapabilityNoticeDismissed(false);
        loadCaseData("job_brief");
      })
      .catch((err) => {
        setActionMessage(err.message || "文件导入失败。");
      })
      .finally(() => {
        setUploading(false);
        event.target.value = "";
      });
  }

  /** 阶段 A：开始解析（校验材料 + 生成建议与工作稿依据） */
  function handleParseMaterials() {
    if (caseData?.mode !== "uploaded") return;
    if ((caseData?.input_capabilities?.unconfirmed_type_count || 0) > 0) {
      setActionMessage("请先确认全部材料类型，再开始解析。");
      return;
    }
    setGenerating(true);
    setBusyKind("parse");
    setActionMessage("");
    fetch(`${API}/api/parse-materials`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          let message = "解析失败";
          try {
            const err = await res.json();
            if (err?.detail) message = err.detail;
          } catch {}
          throw new Error(message);
        }
        return res.json();
      })
      .then((data) => {
        setActionMessage(data.message || "解析完成。");
        setMaterialPreview(null);
        setDraftViewMode("read");
        const gm = caseData?.goal_mode || "both";
        if (gm === "interview") setDraftTab(showInterviewTabs ? "interview" : "none");
        else setDraftTab("resume");
        return loadCaseData("job_brief", { silent: true }).then((nextCase) => {
          const parsed = Boolean(nextCase?.execution?.generation_id || nextCase?.workflow_phase === "parsed");
          const hasOutputs = (nextCase?.outputs || []).some((item) => item.status === "ready");
          if (!parsed || !hasOutputs) {
            setActionMessage("解析已完成，但暂未生成可展示内容。请检查材料类型或重试解析。");
          }
          if ((gm === "delivery" || gm === "both") && nextCase?.case_id) {
            loadWorkingDraft("resume");
          }
        });
      })
      .catch((err) => setActionMessage(err.message || "解析失败。"))
      .finally(() => {
        setGenerating(false);
        setBusyKind(null);
      });
  }

  async function saveZipBlob(blob) {
    const base = (caseTitleDraft || "求职材料").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80) || "case";
    const filename = `${base}_解析结果.zip`;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const buf = new Uint8Array(await blob.arrayBuffer());
      const path = await save({
        defaultPath: filename,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });
      if (path) {
        await writeFile(path, buf);
        setActionMessage("解析结果已保存到所选路径。");
      }
    } catch (err) {
      console.error("saveZipBlob", err);
      try {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        setActionMessage("已下载解析结果（浏览器回退）。");
      } catch (e2) {
        console.error(e2);
        setActionMessage(err?.message || "保存解析结果失败，请重试。");
      }
    }
  }

  /** 阶段 B：导出解析结果（ZIP，含主稿与正式内容） */
  function handleExportResultPack() {
    setResultPackModalOpen(true);
  }

  async function confirmExportResultPack() {
    setExportingZip(true);
    setResultPackModalOpen(false);
    try {
      const res = await fetch(`${API}/api/export/result-pack-zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ include_interview_report: includeInterviewInZip }),
      });
      if (!res.ok) {
        let msg = "导出失败";
        try {
          const err = await res.json();
          if (err?.detail) msg = err.detail;
        } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      await saveZipBlob(blob);
    } catch (e) {
      setActionMessage(e.message || "导出失败");
    } finally {
      setExportingZip(false);
    }
  }

  function handleResetDemo() {
    clearTransientCaseState();
    setDraftTab("resume");
    setLoadingDemo(true);
    setActionMessage("");
    setCaseData((prev) => ({
      ...(prev || {}),
      mode: "blank",
      case_id: null,
      title: "",
      documents: [],
      outputs: [],
      execution: null,
    }));
    setCaseTitleDraft("");
    fetch(`${API}/api/reset-demo`, {
      method: "POST",
    })
      .then(async (res) => {
        if (!res.ok) {
          let message = "重置失败";
          try {
            const err = await res.json();
            if (err?.detail) {
              message = err.detail;
            }
          } catch {}
          throw new Error(message);
        }
        return res.json();
      })
      .then((data) => {
        setActionMessage(data.message || "已加载示例案例。");
        return loadCaseData("job_brief", { silent: true });
      })
      .catch((err) => {
        setActionMessage(err.message || "加载示例失败。");
      })
      .finally(() => setLoadingDemo(false));
  }

  function handleGoalModeChange(event) {
    const value = event.target.value;
    if (caseData?.mode === "demo") return;
    fetch(`${API}/api/case`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal_mode: value }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("更新模式失败");
        return res.json();
      })
      .then(() => loadCaseData(selectedOutputId))
      .catch((err) => setActionMessage(err.message));
  }

  function handleTitleBlur() {
    if (caseData?.mode === "demo") return;
    const t = caseTitleDraft.trim();
    if (!t || t === caseData?.title) return;
    fetch(`${API}/api/case`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("更新标题失败");
        return res.json();
      })
      .then(() => loadCaseData(selectedOutputId))
      .catch((err) => setActionMessage(err.message));
  }

  function handleDocTypeChange(doc, value) {
    if (caseData?.mode === "demo") return;
    fetch(`${API}/api/documents/${encodeURIComponent(doc.name)}/type`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_type: value }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("更新类型失败");
        return res.json();
      })
      .then(() => {
        setCapabilityNoticeDismissed(false);
        loadCaseData(selectedOutputId);
      })
      .catch((err) => setActionMessage(err.message));
  }

  function handleDeleteDocument(doc) {
    if (caseData?.mode === "demo") {
      setActionMessage("示例案例不可删除材料。");
      return;
    }
    if (!window.confirm(`从当前案例中移除「${doc.name}」？`)) return;
    setDeletingName(doc.name);
    fetch(`${API}/api/documents/${encodeURIComponent(doc.name)}`, {
      method: "DELETE",
    })
      .then(async (res) => {
        if (!res.ok) {
          let message = "移除失败";
          try {
            const err = await res.json();
            if (err?.detail) message = err.detail;
          } catch {}
          throw new Error(message);
        }
        return res.json();
      })
      .then((data) => {
        setActionMessage(data.message || "已移除该材料。");
        loadCaseData(selectedOutputId);
      })
      .catch((err) => setActionMessage(err.message || "移除失败。"))
      .finally(() => setDeletingName(""));
  }

  function loadPracticePack() {
    setPracticeLoading(true);
    fetch(`${API}/api/interview-practice`)
      .then(async (res) => {
        if (!res.ok) {
          setPracticePack(null);
          return null;
        }
        return res.json();
      })
      .then((data) => setPracticePack(data))
      .catch(() => setPracticePack(null))
      .finally(() => setPracticeLoading(false));
  }

  function generatePracticePack() {
    const docCount = caseData?.documents?.length ?? 0;
    if (docCount === 0) {
      setActionMessage("请先导入材料。");
      return;
    }
    setPracticeGenerating(true);
    fetch(`${API}/api/interview-practice/generate`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          let msg = "生成失败";
          try {
            const err = await res.json();
            if (err?.detail) msg = err.detail;
          } catch {}
          throw new Error(msg);
        }
        return res.json();
      })
      .then((data) => {
        setPracticePack(data);
        setUserPracticeAnswers({});
        setPracticeScores({});
        setPracticeReportError("");
        setActionMessage("面试练习题已生成。");
      })
      .catch((err) => setActionMessage(err.message || "生成失败。"))
      .finally(() => setPracticeGenerating(false));
  }

  function scorePracticeAnswer(q) {
    const ans = (userPracticeAnswers[q.id] || "").trim();
    if (!ans) {
      setActionMessage("请先填写「我的作答」。");
      return;
    }
    setScoringQuestionId(q.id);
    fetch(`${API}/api/interview-practice/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: q.question,
        user_answer: ans,
        reference_answer: q.reference_answer || "",
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          let msg = "评分失败";
          try {
            const err = await res.json();
            if (err?.detail) msg = err.detail;
          } catch {}
          throw new Error(msg);
        }
        return res.json();
      })
      .then((data) => {
        setPracticeScores((prev) => ({ ...prev, [q.id]: data }));
      })
      .catch((err) => setActionMessage(err.message || "评分失败。"))
      .finally(() => setScoringQuestionId(null));
  }

  function submitAllPracticeAnswers() {
    const qs = practicePack?.questions || [];
    const ans = { ...userPracticeAnswers };
    setPracticeReportError("");
    for (const q of qs) {
      if (!(ans[q.id] || "").trim()) {
        setPracticeReportError(`未全部作答，无法生成综合分析报告。请先完成题目：${q.id}`);
        return;
      }
    }
    setSubmittingReport(true);
    setActionMessage("正在生成综合分析报告…");
    fetch(`${API}/api/interview-practice/submit-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: ans }),
    })
      .then(async (res) => {
        if (!res.ok) {
          let msg = "提交失败";
          try {
            const err = await res.json();
            if (err?.detail) msg = err.detail;
          } catch {}
          throw new Error(msg);
        }
        return res.json();
      })
      .then((data) => {
        setPracticePack((prev) => ({ ...prev, full_report: data.full_report, answers: ans }));
        setPracticeReportError("");
        setActionMessage("综合分析报告已生成。");
      })
      .catch((err) => {
        setPracticePack((prev) => (prev ? { ...prev, full_report: null } : prev));
        setPracticeReportError(err.message || "报告暂未生成成功，请检查答案或重试。");
        setActionMessage("综合分析报告生成失败。");
      })
      .finally(() => setSubmittingReport(false));
  }

  function loadWorkingDraft(which) {
    setDraftLoading(true);
    return fetch(`${API}/api/working-drafts/${which}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("读取工作稿失败");
        return res.json();
      })
      .then((data) => {
        setDraftContent(data.content || "");
        setDraftDirty(false);
        setDraftSections(Array.isArray(data.sections) ? data.sections : []);
        if (which === "resume") {
          setDraftResumeSections(Array.isArray(data.resume_sections) ? data.resume_sections : []);
        } else {
          setDraftResumeSections([]);
        }
        return data;
      })
      .catch(() => {
        setDraftContent("");
        setDraftSections([]);
        setDraftResumeSections([]);
        return null;
      })
      .finally(() => setDraftLoading(false));
  }

  function saveWorkingDraft() {
    if (draftTab === "practice") return;
    setDraftSaving(true);
    fetch(`${API}/api/working-drafts/${draftTab}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: draftContent }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("保存失败");
        return res.json();
      })
      .then(() => {
        setActionMessage("工作稿已保存。");
        setDraftDirty(false);
        setLastWriteRange(null);
        loadCaseData(selectedOutputId);
        loadWorkingDraft(draftTab);
      })
      .catch((err) => setActionMessage(err.message || "保存失败"))
      .finally(() => setDraftSaving(false));
  }

  function acceptSuggestion(id) {
    setActionMessage("正在接受并写入工作稿…");
    applySuggestionToDraft(id);
  }

  function ignoreSuggestion(id) {
    fetch(`${API}/api/suggestions/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then(async (res) => {
        if (!res.ok) throw new Error("忽略失败");
        return res.json();
      })
      .then(() => {
        setActionMessage("已忽略该建议。");
        return Promise.all([loadCaseData(selectedOutputId, { silent: true }), loadWorkingDraft("resume")]);
      })
      .catch((err) => setActionMessage(err.message));
  }

  function openOriginalCompare() {
    fetch(`${API}/api/original-resume-snapshot`)
      .then(async (res) => {
        if (!res.ok) throw new Error("无法读取原文快照");
        return res.json();
      })
      .then((d) =>
        setDetailModal({
          type: "original_compare",
          title: "对比原文（解析时快照）",
          sections: d.sections || {},
        }),
      )
      .catch((err) => setActionMessage(err.message || "读取失败"));
  }

  function generateRefinedDraft() {
    if (caseData?.mode === "demo") {
      setActionMessage("示例案例不生成润色稿；请新建案例后使用。");
      return;
    }
    setRefinedGenerating(true);
    setActionMessage("");
    fetch(`${API}/api/refined-draft/generate`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          let msg = "生成失败";
          try {
            const err = await res.json();
            if (err?.detail) msg = err.detail;
          } catch {}
          throw new Error(msg);
        }
        return res.json();
      })
      .then(() => {
        setActionMessage("独立润色稿已生成：可在右侧查看参考，不会改动主稿。");
        loadCaseData(selectedOutputId, { silent: true });
      })
      .catch((err) => setActionMessage(err.message || "润色稿生成失败。"))
      .finally(() => setRefinedGenerating(false));
  }

  function applySuggestionToDraft(id) {
    preApplyDraftRef.current = draftContent;
    setApplyingId(id);
    setActionMessage("正在写入工作稿…");
    fetch(`${API}/api/suggestions/${encodeURIComponent(id)}/apply-to-draft`, {
      method: "POST",
    })
      .then(async (res) => {
        if (!res.ok) {
          let msg = "写入失败";
          try {
            const err = await res.json();
            if (err?.detail) msg = err.detail;
          } catch {}
          throw new Error(msg);
        }
        return res.json();
      })
      .then((data) => {
        const ts = data?.applied_at ? `（${data.applied_at}）` : "";
        setActionMessage(`已写入工作稿对应区块${ts}`);
        return Promise.all([loadCaseData(selectedOutputId, { silent: true }), loadWorkingDraft("resume")]).then(([, loaded]) => {
          const before = preApplyDraftRef.current;
          const after = loaded?.content ?? "";
          const range = computeChangeRange(before, after);
          setLastWriteRange(range);
          setDraftViewMode("read");
          if (range) {
            window.setTimeout(() => setLastWriteRange(null), 3800);
          }
        });
      })
      .catch((err) => {
        setDraftContent(preApplyDraftRef.current || draftContent);
        setActionMessage(err.message || "写入失败，已保留原工作稿。");
      })
      .finally(() => setApplyingId(null));
  }

  function handleConfirmType(doc) {
    if (caseData?.mode === "demo") return;
    fetch(`${API}/api/documents/${encodeURIComponent(doc.name)}/confirm-type`, {
      method: "POST",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("确认失败");
        return res.json();
      })
      .then(() => {
        setCapabilityNoticeDismissed(false);
        loadCaseData(selectedOutputId);
      })
      .catch((err) => setActionMessage(err.message));
  }

  function scrollToSuggestionTarget(s) {
    const secs = draftResumeSections.length > 0 ? draftResumeSections : execution?.resume_sections || [];
    if (!secs.length) {
      setActionMessage("暂无区块对照，请先生成并写入简历相关建议。");
      return;
    }
    const key = s.target_section || "general";
    if (draftTab !== "resume") {
      setDraftTab("resume");
      setTimeout(() => scrollToSuggestionTarget(s), 120);
      return;
    }
    setDetailModal({ type: "compare", title: "区块对照", scrollKey: key });
  }

  function switchDraftView(next) {
    const fromRead = draftViewMode === "read";
    const readEl = draftReadScrollRef.current;
    const editEl = draftEditRef.current;
    if (fromRead && next === "edit") {
      const top = readEl?.scrollTop ?? 0;
      setDraftViewMode("edit");
      requestAnimationFrame(() => {
        if (editEl) editEl.scrollTop = top;
      });
    } else if (!fromRead && next === "read") {
      const top = editEl?.scrollTop ?? 0;
      setDraftViewMode("read");
      requestAnimationFrame(() => {
        if (readEl) readEl.scrollTop = top;
      });
    }
  }

  function openOutputDetailModal() {
    if (!outputDetail) return;
    setDetailModal({
      type: "output",
      title: outputDetail.title || "解析结果预览",
      format: outputDetail.format,
      content: outputDetail.content,
      meta: outputDetail.generation_meta,
    });
  }

  function openCompareDetailModal() {
    setDetailModal({ type: "compare", title: "区块对照", scrollKey: null });
  }

  async function openRefinedDetailModal() {
    setDetailModal({ type: "refined_summary", title: "对照摘要", compare: refinedCompare });
    setRefinedModalLoading(true);
    setRefinedModalBody("");
    try {
      const res = await fetch(`${API}/api/refined-draft`);
      if (!res.ok) throw new Error("无法读取润色稿");
      const data = await res.json();
      setRefinedModalBody(data?.markdown_body || data?.content || "");
    } catch {
      setRefinedModalBody("");
    } finally {
      setRefinedModalLoading(false);
    }
  }

  function openRefinedFullModal() {
    setDetailModal({ type: "refined_full", title: "独立润色稿全文" });
    setRefinedModalLoading(true);
    setRefinedModalBody("");
    fetch(`${API}/api/refined-draft`)
      .then(async (res) => {
        if (!res.ok) throw new Error("无法读取");
        return res.json();
      })
      .then((data) => {
        setRefinedModalBody(data?.markdown_body || "");
      })
      .catch(() => setRefinedModalBody(""))
      .finally(() => setRefinedModalLoading(false));
  }

  function copyModalText(text) {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => setActionMessage("已复制到剪贴板。"));
  }

  function handlePreviewMaterial(doc) {
    fetch(`${API}/api/document-preview/${encodeURIComponent(doc.name)}`)
      .then(async (res) => {
        if (!res.ok) {
          let msg = "无法读取文件";
          try {
            const err = await res.json();
            if (err?.detail) msg = err.detail;
          } catch {}
          throw new Error(msg);
        }
        return res.json();
      })
      .then((d) => setMaterialPreview({ name: d.name, content: d.content || "" }))
      .catch((e) => setActionMessage(e.message || "读取失败"));
  }

  function submitHrPersona(personaId, label) {
    fetch(`${API}/api/hr-persona`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona_id: personaId, label }),
    })
      .then(async (res) => {
        if (!res.ok) {
          let msg = "设置失败";
          try {
            const err = await res.json();
            if (err?.detail) msg = err.detail;
          } catch {}
          throw new Error(msg);
        }
        return res.json();
      })
      .then(() => {
        setHrPersonaModalOpen(false);
        setActionMessage("已锁定本轮 HR 风格，表达辅导与评分将按此口径。");
        loadCaseData("", { silent: true }).then(() => {
          if (draftTab === "interview") {
            fetch(`${API}/api/interview-expression`)
              .then((r) => (r.ok ? r.json() : { content: "" }))
              .then((d) => setInterviewExpressionMd(d.content || ""));
          }
        });
      })
      .catch((e) => setActionMessage(e.message || "设置失败"));
  }

  useEffect(() => {
    const gm = caseData?.goal_mode || "both";
    if (gm === "delivery" && (draftTab === "interview" || draftTab === "practice")) setDraftTab("resume");
    else if (gm === "interview" && draftTab === "resume") setDraftTab("interview");
  }, [caseData?.goal_mode]);

  const isDemo = caseData?.mode === "demo";
  const isBlank = !caseData || caseData?.mode === "blank";
  const goalMode = caseData?.goal_mode || "both";
  const inputCaps = caseData?.input_capabilities || {};
  const unconfirmedTypeCount = inputCaps.unconfirmed_type_count || 0;
  const parseBlockedByTypes = caseData?.mode === "uploaded" && unconfirmedTypeCount > 0;
  const hasInterviewSource = (caseData?.documents || []).some((d) =>
    ["resume", "jd", "interview_note"].includes(d.type || d.auto_type),
  );
  const showResumeTab = !isBlank && (goalMode === "delivery" || goalMode === "both");
  const showInterviewTabs =
    !isBlank && hasInterviewSource && inputCaps.can_generate_interview_prep && (goalMode === "interview" || goalMode === "both");
  const execution = caseData?.execution;
  const comparisonSummary = execution?.comparison_summary;
  const wd = execution?.working_drafts;
  const draftApplySummary = execution?.draft_apply_summary;
  const readiness = execution?.readiness_summary;
  const hints = caseData?.acceptance_hints;

  const filteredSuggestions = useMemo(() => {
    const items = (execution?.suggestion_items || []).filter((s) => !s.applied_to_draft);
    if (suggestionFilter === "all") return items;
    return items.filter((s) => (s.target_section || "general") === suggestionFilter);
  }, [execution?.suggestion_items, suggestionFilter]);

  const isFirstGenerationCompare =
    execution?.generation_id && comparisonSummary && !comparisonSummary.previous_generation_id;

  const resumeCompareSections = useMemo(() => {
    const raw = draftResumeSections.length > 0 ? draftResumeSections : execution?.resume_sections || [];
    return raw.filter((sec) => sec.show_in_compare);
  }, [draftResumeSections, execution?.resume_sections]);

  const evidenceForDisplay = useMemo(() => {
    const ev = outputDetail?.evidence || [];
    if (!ev.length) return [];
    return evidenceExpanded ? ev : ev.slice(0, 2);
  }, [outputDetail?.evidence, evidenceExpanded]);

  const evidenceTotalCount = outputDetail?.evidence?.length ?? 0;

  const docCount = caseData?.documents?.length ?? 0;
  const workflowParsed = Boolean(execution?.workflow_phase === "parsed" || execution?.generation_id);
  const primaryIsParse = caseData?.mode === "uploaded" && !workflowParsed && docCount > 0;
  const stageIndex = deriveWorkflowStage(
    loading,
    docCount,
    execution?.generation_id,
    readiness?.overall_ready,
  );

  const readinessLine = useMemo(() => {
    if (loading) return "…";
    if (!readiness) return "生成后可查看准备度";
  return (
      (readiness.summary_lines && readiness.summary_lines[0]) ||
      (readiness.overall_ready ? "可按规则投递" : "尚有事项需处理")
    );
  }, [loading, readiness]);

  const nextStepAdvice = useMemo(() => {
    if (loading) return "正在加载案例…";
    if (errorText) return "请先确认本机后端服务已启动。";
    if (docCount === 0) return "下一步：导入材料，或打开示例案例。";
    if (parseBlockedByTypes) return "请先确认全部材料类型，再开始解析。";
    const unconfirmed = hints?.unconfirmed_type_count ?? 0;
    if (unconfirmed > 0) return `下一步：确认 ${unconfirmed} 个材料的类型，便于准确生成。`;
    if (!execution?.generation_id)
      return "下一步：点击「开始解析」，校验材料并生成建议与工作稿依据。";
    const pendingApply = draftApplySummary?.pending_apply_ids?.length ?? 0;
    const hasSuggestions = (execution?.suggestion_items || []).length > 0;
    if (hasSuggestions && pendingApply > 0) {
      return "下一步：在右侧处理建议，将接受的条目写入工作稿。";
    }
    if (draftDirty) return "下一步：保存工作稿，避免改动丢失。";
    if (readiness && !readiness.overall_ready) return "下一步：根据右侧进度检查，补齐事项后再投递。";
    return "下一步：确认主稿后可导出解析结果 ZIP；面试练习可生成综合分析。";
  }, [
    loading,
    errorText,
    docCount,
    hints?.unconfirmed_type_count,
    execution?.generation_id,
    execution?.suggestion_items,
    draftApplySummary?.pending_apply_ids,
    draftDirty,
    readiness,
  ]);

  const busySteps = useMemo(() => {
    if (busyKind === "parse") return BUSY_STEPS_PARSE;
    if (busyKind === "refined") return BUSY_STEPS_REFINED;
    if (busyKind === "upload") return BUSY_STEPS_UPLOAD;
    return BUSY_STEPS_PACK;
  }, [busyKind]);

  const busyLabel = busySteps[busyStepIndex % busySteps.length];
  const centerMode = loadingDemo
    ? "demoLoading"
    : isBlank
      ? "blank"
    : materialPreview
      ? "material"
      : draftTab === "practice" && showInterviewTabs
        ? "practice"
        : draftTab === "interview" && showInterviewTabs
          ? "interview"
          : showResumeTab
            ? "resume"
            : "empty";
  const centerTitle =
    centerMode === "blank"
      ? "开始一个案例"
      : centerMode === "demoLoading"
        ? "正在加载示例案例"
      : centerMode === "material"
        ? "材料预览"
        : centerMode === "practice"
          ? "面试练习"
          : centerMode === "interview"
            ? "面试表达辅导"
            : "当前工作稿";
  const centerSub =
    centerMode === "blank"
      ? "导入你自己的材料，或点击左侧示例查看完整流程。"
      : centerMode === "demoLoading"
        ? "正在读取示例材料，并准备案例内容。"
      : centerMode === "material"
        ? "只读查看当前材料；关闭预览后回到主工作区。"
        : centerMode === "practice"
          ? "正式题目、作答、参考回答与评分在这里完成。"
          : centerMode === "interview"
            ? "这里是面试官看完材料后的表达批注，不是材料正文。"
            : "主稿保存在本案例；保存不会覆盖左侧原始材料。";

  const ONBOARDING_STEPS = [
    {
      title: "欢迎使用求职材料执行台",
      body: "同一案例内完成：导入材料 → 解析 → 主稿与建议 → 接受 / 写入 / 忽略 → 解析结果 ZIP → 面试表达辅导与练习（先锁定 HR 风格）→ 提交作答 → 导出报告或解析结果。",
    },
    {
      title: "1. 导入材料",
      body: "在左侧导入简历、岗位说明等；案例名默认取首个文件名，你可再改。顶栏可查看 AI 是否可用。",
    },
    {
      title: "2. 开始解析",
      body: "按「目标」只生成相关板块：仅投递时侧重简历建议；仅面试时侧重面试包与练习；两者兼顾则三块都生成。材料会合并进同一次分析。",
    },
    {
      title: "3. 建议：接受 / 写入 / 忽略",
      body: "接受后在对应区块上方插入「本次改进」批注；写入时用模型结合全部材料改写正文；忽略会撤销该条对正文的影响（含已写入）。",
    },
    {
      title: "4. 查看解析结果",
      body: "解析完成后可查看解析摘要、依据材料和修改记录，也可导出 ZIP，文件名与案例名一致；可选附带面试综合分析。",
    },
    {
      title: "5. 面试与 HR 风格",
      body: "首次进入面试相关页签时需选择面试官风格，选定后本案例不可改。辅导与评分口吻一致。",
    },
    {
      title: "可以开始了",
      body: "左侧可点击文件名查看材料原文。右上角「帮助」可随时回看。",
    },
  ];

  return (
    <div className="studio-app">
      {busyVisible && (
        <div className="studio-busy-overlay" role="alertdialog" aria-busy="true" aria-live="polite">
          <div className="studio-busy-card">
            <div className="studio-busy-title">
              {exportingZip
                ? "正在准备解析结果"
                : practiceGenerating
                  ? "正在生成面试练习题"
                  : generating
                    ? busyKind === "parse"
                      ? "正在解析材料"
                      : "正在处理"
                    : refinedGenerating
                      ? "正在生成润色稿"
                      : "正在处理"}
            </div>
            <div className="studio-busy-bar" aria-hidden>
              <div className="studio-busy-bar-indeterminate" />
            </div>
            <p className="studio-busy-step">{busyLabel}</p>
            <p className="studio-busy-hint">请勿关闭窗口，完成后将自动恢复。</p>
          </div>
        </div>
      )}

      <header className="studio-topbar">
        <div className="studio-topbar-left">
          <div className="studio-brand-block">
            <div className="studio-brand-row">
              <span className="studio-brand">{PRODUCT_NAME}</span>
              <span className="studio-topbar-sep" aria-hidden>
                /
          </span>
              <span className="studio-case-name" title={caseTitleDraft || "—"}>
                {loading ? "…" : isBlank ? "未开始" : caseTitleDraft || "未命名案例"}
          </span>
        </div>
            <p className="studio-tagline">{TAGLINE}</p>
          </div>
        </div>
        <div className="studio-topbar-center">
          <p className="studio-next-advice">{nextStepAdvice}</p>
        </div>
        <div className="studio-topbar-right">
          <button type="button" className="studio-btn studio-btn-ghost studio-btn-sm" onClick={openHelp}>
            帮助
          </button>
          <span className="studio-mini-stat">材料 {docCount} 份</span>
          <button
            type="button"
            className="studio-btn studio-btn-primary"
            onClick={() => {
              if (primaryIsParse) handleParseMaterials();
              else handleExportResultPack();
            }}
            disabled={
              generating ||
              exportingZip ||
              !caseData ||
              isBlank ||
              parseBlockedByTypes ||
              (primaryIsParse && docCount === 0) ||
              (isDemo && primaryIsParse)
            }
            title={parseBlockedByTypes ? "请先确认全部材料类型，再开始解析。" : isDemo && primaryIsParse ? "示例已解析" : ""}
          >
            {generating ? "处理中…" : primaryIsParse ? "开始解析" : "导出解析结果"}
          </button>
          <span
            className={`studio-backend-dot ${errorText ? "is-off" : "is-on"}`}
            title={errorText || "后端已连接"}
          >
            {errorText ? "未连接" : "已连接"}
          </span>
          <span
            className={`studio-ai-dot ${aiStatus.checking ? "is-wait" : aiStatus.available ? "is-on" : "is-off"}`}
            title={
              aiStatus.checking
                ? "检测模型…"
                : aiStatus.available
                  ? `AI 可用 · ${aiStatus.model || ""}`
                  : `AI 不可用：${(aiStatus.affected || []).join("；")}`
            }
          >
            {aiStatus.checking ? "AI 检测" : aiStatus.available ? "AI 可用" : "AI 不可用"}
          </span>
        </div>
      </header>

      <div className="studio-stagebar" aria-label="流程阶段">
        <span className="studio-stagebar-readiness" title="准备度摘要">
          {loading ? "…" : readinessLine}
        </span>
        <div className="studio-stagebar-steps">
          {STAGE_LABELS.map((label, i) => {
            const n = i + 1;
            const active = !loading && stageIndex === n;
            const done = !loading && stageIndex > n;
            return (
              <div
                key={label}
                className={`studio-stage-step ${active ? "is-active" : ""} ${done ? "is-done" : ""}`}
              >
                <span className="studio-stage-dot" />
                <span>{label}</span>
              </div>
            );
          })}
        </div>
          </div>

      {actionMessage ? <div className="studio-toast">{actionMessage}</div> : null}
      {parseBlockedByTypes ? <div className="studio-static-notice">请先确认全部材料类型，再开始解析。</div> : null}
      {!isBlank && !workflowParsed && inputCaps.summary && !capabilityNoticeDismissed && unconfirmedTypeCount === 0 ? (
        <div className="studio-static-notice studio-static-notice-info">
          <span>{inputCaps.summary}</span>
          <button type="button" onClick={() => setCapabilityNoticeDismissed(true)}>知道了</button>
        </div>
      ) : null}

      <div className="studio-main">
        <aside className="studio-col studio-col-left">
          <div className="studio-panel-h">当前案例</div>
          <input
            className="studio-input"
            value={caseTitleDraft}
            disabled={isDemo || isBlank}
            onChange={(e) => setCaseTitleDraft(e.target.value)}
            onBlur={handleTitleBlur}
            placeholder="案例名称"
            aria-label="案例名称"
          />
          <label className="studio-field-label">目标</label>
          <select
            className="studio-select"
            value={caseData?.goal_mode || "both"}
            disabled={isDemo || isBlank}
            onChange={handleGoalModeChange}
          >
            <option value="delivery">{GOAL_LABELS.delivery}</option>
            <option value="interview">{GOAL_LABELS.interview}</option>
            <option value="both">{GOAL_LABELS.both}</option>
          </select>

          <div className="studio-import-row">
              <button
              type="button"
              className="studio-btn studio-btn-sm studio-btn-primary"
                onClick={handleOpenFilePicker}
              disabled={uploading || loadingDemo}
              >
              {uploading ? "导入中…" : "导入"}
              </button>
            <button type="button" className="studio-btn studio-btn-sm studio-btn-ghost" onClick={handleResetDemo} disabled={loadingDemo}>
              {loadingDemo ? "加载中…" : "示例"}
              </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="studio-hidden-file"
              onChange={handleFileChange}
            />
          </div>
          <p className="studio-hint-muted">支持 txt / md；docx / pdf 可归档并尝试抽取正文。</p>

          {loading && <div className="studio-muted">读取材料…</div>}
          {!loading && errorText && <div className="studio-error">{errorText}</div>}

          <div className="studio-doc-list">
            {!loading &&
              !errorText &&
              caseData?.documents?.map((doc, index) => (
                <div className="studio-doc-card" key={`${doc.name}-${index}`}>
                  <div className="studio-doc-card-head">
                    <button
                      type="button"
                      className="studio-doc-title studio-doc-title-btn"
                      onClick={() => handlePreviewMaterial(doc)}
                      title="在中间区域查看此文件原文"
                    >
                      {doc.name}
                    </button>
                    <button
                      type="button"
                      className="studio-icon-btn"
                      disabled={isDemo || deletingName === doc.name}
                      onClick={() => handleDeleteDocument(doc)}
                      title={isDemo ? "示例不可删除" : "移除此文件"}
                    >
                      {deletingName === doc.name ? "…" : "移除"}
                    </button>
                    </div>
                  <div className="studio-doc-meta">
                    识别：{doc.auto_type ? DOC_TYPE_OPTIONS.find((o) => o.value === doc.auto_type)?.label || doc.auto_type : "—"}
                    {doc.extractable ? " · 可抽取" : " · 抽取弱"}
                  </div>
                  <div className="studio-doc-type-row">
                      <select
                      className="studio-select studio-select-compact"
                        value={doc.type}
                        disabled={isDemo}
                        onChange={(e) => handleDocTypeChange(doc, e.target.value)}
                      >
                        {DOC_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                      className={`studio-mini-tag ${doc.type_confirmed ? "is-done" : ""}`}
                        disabled={isDemo || doc.type_confirmed}
                        onClick={() => handleConfirmType(doc)}
                      >
                      {doc.type_confirmed ? "已确认" : "确认"}
                      </button>
                  </div>
                </div>
              ))}
            {!loading && !errorText && docCount === 0 && (
              <div className="studio-muted">暂无材料：导入文件或打开示例。</div>
            )}
          </div>
        </aside>

        <section className="studio-col studio-col-center">
          <header className="studio-center-head">
            <div>
              <h1 className="studio-h1">{centerTitle}</h1>
              <p className="studio-sub">{centerSub}</p>
          </div>
            <div className="studio-draft-tabs">
              {showResumeTab && (
                <button
                  type="button"
                  className={`studio-tab ${draftTab === "resume" ? "is-on" : ""}`}
                  onClick={() => {
                    setMaterialPreview(null);
                    setDraftTab("resume");
                  }}
                >
                  简历稿
                </button>
              )}
              {showInterviewTabs && (
                <>
                  <button
                    type="button"
                    className={`studio-tab ${draftTab === "interview" ? "is-on" : ""}`}
                    onClick={() => {
                      setMaterialPreview(null);
                      setDraftTab("interview");
                    }}
                  >
                    面试表达辅导
                  </button>
                  <button
                    type="button"
                    className={`studio-tab ${draftTab === "practice" ? "is-on" : ""}`}
                    onClick={() => {
                      setMaterialPreview(null);
                      setDraftTab("practice");
                    }}
                  >
                    面试练习
                  </button>
                </>
              )}
                </div>
          </header>

          {centerMode === "material" ? (
            <div className="studio-material-preview studio-material-preview-main">
              <div className="studio-material-preview-head">
                <span>材料文件：{materialPreview.name}</span>
                <button type="button" className="studio-btn studio-btn-sm studio-btn-ghost" onClick={() => setMaterialPreview(null)}>
                  关闭
                </button>
                </div>
              <pre className="studio-material-preview-body">{materialPreview.content}</pre>
                </div>
          ) : centerMode === "demoLoading" ? (
            <div className="studio-case-loading" role="status" aria-live="polite">
              <div className="studio-case-loading-title">正在加载示例案例</div>
              <div className="studio-case-loading-bar" aria-hidden>
                <span />
              </div>
              <div className="studio-case-loading-steps">
                {DEMO_LOADING_STEPS.map((step) => (
                  <div key={step}>{step}</div>
                ))}
              </div>
            </div>
          ) : centerMode === "blank" ? (
            <div className="studio-empty-state">
              <h2>先导入材料，或打开示例</h2>
              <p>这里不会自动加载小何案例。导入文件后会创建你的当前案例；点击示例才会进入演示案例。</p>
              <div className="studio-empty-actions">
                <button type="button" className="studio-btn studio-btn-primary" onClick={handleOpenFilePicker}>
                  导入材料
                </button>
                <button type="button" className="studio-btn studio-btn-ghost" onClick={handleResetDemo}>
                  查看示例
                </button>
              </div>
            </div>
          ) : centerMode === "practice" ? (
            <div className="studio-practice-root">
              {practiceLoading ? (
                <div className="studio-muted studio-pad">加载练习题…</div>
              ) : !practicePack?.questions?.length ? (
                <div className="studio-practice-empty">
                  <p className="studio-muted">
                    尚未生成练习题。需要简历、岗位说明，以及面试记录或项目补充材料。
                  </p>
                  <button
                    type="button"
                    className="studio-btn studio-btn-primary"
                    disabled={practiceGenerating || docCount === 0 || !inputCaps.can_generate_practice}
                    onClick={generatePracticePack}
                  >
                    {practiceGenerating ? "生成中…" : "生成面试练习题"}
                  </button>
                  <button type="button" className="studio-btn studio-btn-ghost" onClick={() => setDraftTab(showResumeTab ? "resume" : "none")}>
                    关闭练习
                  </button>
                </div>
                ) : (
                  <>
                  <div className="studio-practice-toolbar">
                    <span className="studio-muted">
                      {practicePack.questions.length} 道题
                      {practicePack.generated_at ? (
                        <span className="studio-practice-ts"> · {practicePack.generated_at}</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="studio-btn studio-btn-sm"
                      disabled={practiceGenerating || docCount === 0 || !inputCaps.can_generate_practice}
                      onClick={generatePracticePack}
                    >
                      {practiceGenerating ? "生成中…" : "重新生成"}
                    </button>
                    <button type="button" className="studio-btn studio-btn-sm studio-btn-ghost" onClick={() => setDraftTab(showResumeTab ? "resume" : "none")}>
                      关闭
                    </button>
                    </div>
                  <div className="studio-practice-list">
                    {practicePack.questions.map((q) => (
                      <article className="studio-practice-card" key={q.id}>
                        <div className="studio-practice-qhead">
                          <span className="studio-practice-cat">{q.category_label || q.category}</span>
                          <h3 className="studio-practice-q">{q.question}</h3>
              </div>
                        <details className="studio-practice-block">
                          <summary>我的作答</summary>
                          <div className="studio-practice-block-body">
                            <textarea
                              className="studio-practice-ta"
                              rows={5}
                              value={userPracticeAnswers[q.id] || ""}
                              onChange={(e) => {
                                setPracticeReportError("");
                                setUserPracticeAnswers((prev) => ({ ...prev, [q.id]: e.target.value }));
                              }}
                              placeholder="先写出你的回答，再请求评分…"
                              spellCheck={false}
                            />
                            <div className="studio-practice-actions">
                              <button
                                type="button"
                                className="studio-btn studio-btn-sm studio-btn-primary"
                                disabled={scoringQuestionId === q.id}
                                onClick={() => scorePracticeAnswer(q)}
                              >
                                {scoringQuestionId === q.id ? "评分中…" : "AI 评分"}
                              </button>
                  </div>
                            {practiceScores[q.id] ? (
                              <div className="studio-practice-score">
                                <div className="studio-practice-score-num">
                                  得分 {practiceScores[q.id].score ?? "—"}/10
                  </div>
                                <p className="studio-practice-score-comment">{practiceScores[q.id].comment}</p>
                                <p className="studio-practice-score-improve">{practiceScores[q.id].improvement}</p>
                </div>
                            ) : null}
                  </div>
                        </details>
                        <details className="studio-practice-block">
                          <summary>参考回答</summary>
                          <div className="studio-practice-block-body">
                            <div className="studio-practice-ref">{cleanReferenceAnswer(q.reference_answer)}</div>
              </div>
                        </details>
                      </article>
                    ))}
                  </div>
                  <div className="studio-practice-submit-row">
                <button
                  type="button"
                      className="studio-btn studio-btn-primary"
                      disabled={submittingReport || !practicePack?.questions?.length}
                      onClick={submitAllPracticeAnswers}
                >
                      {submittingReport ? "生成报告中…" : "提交整套作答并生成综合分析"}
                </button>
              </div>
                  {submittingReport ? (
                    <div className="studio-report-pending" role="status" aria-live="polite">
                      <div className="studio-report-pending-title">正在生成综合分析报告</div>
                      <div className="studio-report-pending-bar"><span /></div>
                      <p>正在读取整套作答并生成维度评分，请稍候。</p>
                    </div>
                  ) : null}
                  {practiceReportError ? (
                    <div className="studio-report-error" role="alert">
                      <div className="studio-report-error-title">综合分析报告未生成</div>
                      <p>综合分析报告暂未生成成功。</p>
                      <ul className="studio-report-error-list">
                        <li>当前答案不完整或过短</li>
                        <li>当前输入不足以支撑完整分析</li>
                        <li>当前 AI 生成阶段受限，请稍后重试</li>
                      </ul>
                      <p className="studio-report-error-detail">{practiceReportError}</p>
                      <button type="button" className="studio-btn studio-btn-sm" onClick={submitAllPracticeAnswers}>
                        重试生成
                      </button>
                    </div>
                  ) : null}
                  {practicePack?.full_report ? (
                    <div className="studio-practice-report">
                      <h3 className="studio-practice-report-h">综合分析报告</h3>
                      {practicePack.full_report.dimensions ? (
                        <InterviewRadar dims={practicePack.full_report.dimensions} />
                      ) : null}
                      <p className="studio-practice-report-p">{practicePack.full_report.overall}</p>
                      <h4 className="studio-practice-report-h4">岗位匹配</h4>
                      <p className="studio-practice-report-p">{practicePack.full_report.role_fit_judgement}</p>
                      <h4 className="studio-practice-report-h4">风险与亮点</h4>
                      <p className="studio-practice-report-p">{practicePack.full_report.hire_risk_and_highlights}</p>
                      <h4 className="studio-practice-report-h4">补强点</h4>
                      <p className="studio-practice-report-p">{practicePack.full_report.top_gaps}</p>
            </div>
                  ) : null}
                </>
          )}
          </div>
          ) : centerMode === "interview" ? (
            <div className="studio-expression-panel studio-expression-main">
              <div className="studio-expression-head">
                <div className="studio-expression-h">面试表达辅导</div>
                <button type="button" className="studio-btn studio-btn-sm studio-btn-ghost" onClick={() => setDraftTab(showResumeTab ? "resume" : "none")}>
                  关闭
                </button>
              </div>
              {interviewExpressionMd ? (
                <pre className="studio-expression-pre">{interviewExpressionMd}</pre>
              ) : (
                <div className="studio-muted studio-pad">暂无表达辅导。请先导入材料并完成解析。</div>
              )}
            </div>
          ) : centerMode === "empty" ? (
            <div className="studio-empty-state">
              <h2>当前目标下暂无可显示内容</h2>
              <p>请先导入材料，或切换目标模式后再继续。</p>
            </div>
          ) : (
            <>
              <div className="studio-draft-toolbar">
                <div className="studio-draft-status">
                  <span>{draftTab === "resume" ? "简历稿" : "面试话术"}</span>
                  <span className="studio-dot-sep">·</span>
                  <span>{draftLoading ? "加载中…" : `${draftContent.length} 字`}</span>
                  <span className="studio-dot-sep">·</span>
                  <span>{draftDirty ? "未保存" : "已保存"}</span>
                </div>
                <div className="studio-draft-view-toggle">
                  {draftTab === "resume" ? (
                    <button type="button" className="studio-view-chip" onClick={openOriginalCompare}>
                      对比原文
                    </button>
                  ) : null}
                    <button
                      type="button"
                    className={`studio-view-chip ${draftViewMode === "read" ? "is-on" : ""}`}
                    onClick={() => switchDraftView("read")}
                    >
                    阅读查看
                    </button>
                  <button
                    type="button"
                    className={`studio-view-chip ${draftViewMode === "edit" ? "is-on" : ""}`}
                    onClick={() => switchDraftView("edit")}
                  >
                    编辑原文
                  </button>
                </div>
              </div>

              {lastWriteRange && draftViewMode === "read" && (
                <div className="studio-write-banner">
                  <div className="studio-write-banner-main">
                    <span className="studio-write-banner-label">本次改动</span>
                    <span>已在正文中标出修改位置。</span>
                    </div>
                  <button type="button" className="studio-linkish-inline" onClick={() => setLastWriteRange(null)}>
                    收起提示
                  </button>
                        </div>
              )}

              {draftLoading ? (
                <div className="studio-muted studio-pad">加载工作稿…</div>
              ) : (
                <>
                  {draftViewMode === "read" ? (
                    <div className="studio-draft-read" ref={draftReadScrollRef}>
                      <DraftReadBody text={draftContent} highlightRange={lastWriteRange} />
                    </div>
                  ) : (
                    <textarea
                      ref={draftEditRef}
                      className="studio-draft-editor"
                      value={draftContent}
                      onChange={(e) => {
                        setDraftContent(e.target.value);
                        setDraftDirty(true);
                        setLastWriteRange(null);
                      }}
                      spellCheck={false}
                      placeholder="在此编辑 Markdown 原文…"
                    />
                  )}

                  <div className="studio-draft-actions">
                    <button
                      type="button"
                      className="studio-btn studio-btn-primary"
                      disabled={draftSaving}
                      onClick={saveWorkingDraft}
                    >
                      {draftSaving ? "保存中…" : "保存工作稿"}
                    </button>
                              </div>

                  {draftTab === "resume" && resumeCompareSections.length > 0 && (
                    <div className="studio-inline-summary">
                      <span className="studio-muted">区块对照 · {resumeCompareSections.length} 个区块</span>
                      <button type="button" className="studio-btn studio-btn-sm" onClick={openCompareDetailModal}>
                        查看详情
                      </button>
                          </div>
                  )}

                  {draftTab === "interview" && draftSections.length > 0 && (
                    <div className="studio-inline-summary">
                      <span className="studio-muted">话术分段 · {draftSections.length} 段</span>
                            <button
                              type="button"
                        className="studio-btn studio-btn-sm"
                        onClick={() =>
                          setDetailModal({ type: "interview_sections", title: "面试话术分段", sections: draftSections })
                        }
                      >
                        查看详情
                            </button>
                    </div>
                          )}
                        </>
              )}
            </>
          )}
        </section>

        <aside className="studio-col studio-col-right">
          <div className="studio-panel-h">检查与参考</div>
          {isBlank ? (
            <div className="studio-empty-side">暂无案例。导入材料或打开示例后，这里才显示建议、依据和解析结果。</div>
          ) : (
            <>

          <details className="studio-rpanel">
            <summary>
              待处理建议
                        {filteredSuggestions.length > 0 && (
                <span className="studio-rpanel-count">({filteredSuggestions.length})</span>
                        )}
                      </summary>
            <div className="studio-rpanel-body">
                        <select
                className="studio-select studio-select-full"
                          value={suggestionFilter}
                          onChange={(e) => setSuggestionFilter(e.target.value)}
                        >
                          {SUGGESTION_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
              <div className="studio-suggest-list">
                        {(execution?.suggestion_items || []).length === 0 ? (
                  <div className="studio-muted">解析完成后，这里会出现修改建议。</div>
                        ) : filteredSuggestions.length === 0 ? (
                  <div className="studio-muted">当前筛选下没有建议。</div>
                        ) : (
                          filteredSuggestions.map((s) => (
                    <div
                      className={`studio-suggest-item status-${s.status}`}
                      key={s.id}
                      style={
                        s.accent_color
                          ? { borderLeftWidth: 3, borderLeftStyle: "solid", borderLeftColor: s.accent_color }
                          : undefined
                      }
                      role="button"
                      tabIndex={0}
                      onClick={() => scrollToSuggestionTarget(s)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          scrollToSuggestionTarget(s);
                        }
                      }}
                    >
                      <div className="studio-suggest-title">{suggestionTitle(s)}</div>
                      <div className="studio-suggest-meta">
                        <span>{TARGET_SECTION_LABELS[s.target_section] || s.target_section || "通用"}</span>
                        <span className={`studio-suggest-st ${s.applied_to_draft ? "is-applied" : ""}`}>
                          {formatSuggestionStatus(s)}
                                </span>
                              </div>
                      <div className="studio-suggest-cat">{SUGGEST_CATEGORY_LABELS[s.category] || s.category}</div>
                      <div className="studio-suggest-actions">
                        <button
                          type="button"
                          className="studio-sbtn ok"
                          disabled={applyingId === s.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            acceptSuggestion(s.id);
                          }}
                        >
                          {applyingId === s.id ? "写入中…" : "接受并写入"}
                        </button>
                                <button
                                  type="button"
                          className="studio-sbtn no"
                          onClick={(e) => {
                            e.stopPropagation();
                            ignoreSuggestion(s.id);
                          }}
                        >
                          忽略
                                </button>
                              </div>
                      {applyingId === s.id ? (
                        <div className="studio-inline-loading">
                          <span>正在写入工作稿</span>
                          <i />
                        </div>
                      ) : null}
                            </div>
                          ))
                        )}
              </div>
                      </div>
                    </details>

          <details className="studio-rpanel">
            <summary>
              依据材料
              {evidenceTotalCount > 0 && <span className="studio-rpanel-count">({evidenceTotalCount})</span>}
            </summary>
            <div className="studio-rpanel-body">
              {!outputDetail || evidenceTotalCount === 0 ? (
                <div className="studio-muted">选择解析结果条目后，可在此查看引用依据摘要。</div>
              ) : (
                <>
                  <div className="studio-evidence-list">
                    {evidenceForDisplay.map((item, index) => (
                      <div className="studio-evidence-row" key={index}>
                        <div className="studio-evidence-file">{item.source_file}</div>
                        <div className="studio-evidence-line">{excerptOneLine(item.snippet, 96)}</div>
              </div>
                    ))}
                  </div>
                  {evidenceTotalCount > 2 && (
                  <button
                    type="button"
                      className="studio-linkish"
                      onClick={() => setEvidenceExpanded(!evidenceExpanded)}
                  >
                      {evidenceExpanded ? "收起" : `展开其余 ${evidenceTotalCount - 2} 条`}
                  </button>
                  )}
                </>
              )}
            </div>
          </details>

          <details className="studio-rpanel">
            <summary>解析结果预览</summary>
            <div className="studio-rpanel-body">
              <div className="studio-pack-switch">
                {(caseData?.outputs || []).map((item, index) => (
                  <button
                    type="button"
                    className={`studio-pack-chip ${selectedOutputId === item.id ? "is-on" : ""}`}
                    key={index}
                    onClick={() => handleSelectOutput(item)}
                  >
                    {item.name}
                    <span className="studio-pack-fmt">{item.format}</span>
                  </button>
                ))}
                </div>
              {detailLoading ? (
                <div className="studio-muted">加载预览…</div>
              ) : outputDetail ? (
                <>
                  <div className="studio-pack-head">
                    <span className="studio-pack-title">{outputDetail.title}</span>
                    <span className="studio-pack-pill">{outputDetail.format === "json" ? "JSON" : "Markdown"}</span>
                  </div>
                  <p className="studio-pack-summary">{previewSummary(outputDetail.content)}</p>
                  <button type="button" className="studio-btn studio-btn-sm" onClick={openOutputDetailModal}>
                    查看详情
                      </button>
                </>
              ) : (
                <div className="studio-muted">暂无解析结果。</div>
              )}
                    </div>
          </details>

          <details className="studio-rpanel">
            <summary>修改记录</summary>
            <div className="studio-rpanel-body studio-progress-body">
              <div className="studio-progress-row">
                <span className="studio-progress-k">进度检查</span>
                {!readiness ? (
                  <span className="studio-muted">加载中…</span>
                ) : (
                  <span className={readiness.overall_ready ? "studio-ok" : "studio-warn"}>
                    {readiness.overall_ready ? "可投递（按规则）" : "尚有事项"}
                                  </span>
                )}
                                </div>
              <div className="studio-progress-row">
                <span className="studio-progress-k">工作稿摘要</span>
                <span className="studio-muted">
                  简历 {wd?.resume?.exists ? `${wd.resume.chars} 字` : "—"} · 面试{" "}
                  {wd?.interview?.exists ? `${wd.interview.chars} 字` : "—"}
                </span>
                                  </div>
              {draftApplySummary && (
                <div className="studio-progress-row">
                  <span className="studio-progress-k">建议应用</span>
                  <span className="studio-muted">
                    已写入 {draftApplySummary.applied_suggestion_ids?.length || 0} · 已接受但未写入{" "}
                    {draftApplySummary.pending_apply_ids?.length || 0}
                  </span>
                          </div>
                        )}
              {!execution?.generation_id ? (
                <p className="studio-muted">尚未完成解析。</p>
              ) : !comparisonSummary ? (
                <p className="studio-muted">暂无版本对比。</p>
              ) : isFirstGenerationCompare ? (
                <p className="studio-muted">首次生成已建立基准，下次生成将对比变化。</p>
              ) : (
                <div className="studio-version-lines">
                  {(comparisonSummary.new_input_files || []).length > 0 && (
                    <div>新材料：{comparisonSummary.new_input_files.join("、")}</div>
                  )}
                  {(comparisonSummary.suggestions?.added || []).length > 0 && (
                    <div>新增建议 {comparisonSummary.suggestions.added.length} 条</div>
                  )}
                          </div>
                        )}
            </div>
          </details>
            </>
          )}
        </aside>
      </div>

      {detailModal && (
        <div
          className="studio-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailModal(null);
          }}
        >
          <div className="studio-modal" role="dialog" aria-modal="true" aria-labelledby="studio-modal-title">
            <div className="studio-modal-head">
              <h2 id="studio-modal-title" className="studio-modal-title">
                {detailModal.title}
              </h2>
              <button type="button" className="studio-modal-close" onClick={() => setDetailModal(null)} aria-label="关闭">
                ×
                          </button>
                        </div>
            <div className="studio-modal-body">
              {detailModal.type === "output" && (
                <>
                  <div className="studio-modal-actions">
                    <button type="button" className="studio-btn studio-btn-sm" onClick={() => copyModalText(detailModal.content)}>
                      复制全文
                    </button>
                  </div>
                  <pre className="studio-modal-pre">{detailModal.content}</pre>
                      </>
                    )}
              {detailModal.type === "original_compare" && detailModal.sections && (
                <div className="studio-modal-compare-wrap">
                  {Object.keys(detailModal.sections).length === 0 ? (
                    <p className="studio-muted">暂无原文快照，请先完成「开始解析」。</p>
                  ) : (
                    Object.entries(detailModal.sections).map(([key, text]) => (
                      <article className="studio-compare-card" key={key}>
                        <div className="studio-compare-head">
                          <h3 className="studio-compare-h">{TARGET_SECTION_LABELS[key] || key}</h3>
                        </div>
                        <pre className="studio-modal-pre studio-pane-body-tall">{text || "—"}</pre>
                      </article>
                    ))
                  )}
                    </div>
              )}
              {detailModal.type === "compare" && (
                <>
                  <div ref={compareWrapRef} className="studio-modal-compare-wrap">
                    {resumeCompareSections.length === 0 ? (
                      <p className="studio-muted">暂无已写入的区块差异：写入工作稿且与原文不同后，会出现在此。</p>
                    ) : (
                      resumeCompareSections.map((sec) => (
                      <article className="studio-compare-card" key={sec.section_key} data-section-key={sec.section_key}>
                        <div className="studio-compare-head">
                          <h3 className="studio-compare-h">{sec.section_title}</h3>
                        </div>
                        <div className="studio-compare-cols">
                          <div className="studio-compare-pane">
                            <div className="studio-pane-label">原来的内容</div>
                            <pre className="studio-pane-body studio-pane-body-tall">{sec.original_content || "—"}</pre>
                          </div>
                          <div className="studio-compare-pane studio-pane-current">
                            <div className="studio-pane-label">修改后的内容</div>
                            <pre className="studio-pane-body studio-pane-body-tall">{sec.current_draft_content || "—"}</pre>
                          </div>
                        </div>
                      </article>
                      ))
                    )}
                  </div>
                </>
              )}
              {detailModal.type === "refined_summary" && refinedCompare && (
                <>
                  <div className="studio-modal-actions">
                      <button
                        type="button"
                      className="studio-btn studio-btn-sm"
                      onClick={() =>
                        copyModalText(
                          `${refinedCompare.working_draft_excerpt || ""}\n---\n${refinedCompare.refined_draft_excerpt || ""}`,
                        )
                      }
                    >
                      复制对照摘要
                      </button>
                    <button type="button" className="studio-btn studio-btn-sm studio-btn-primary" onClick={openRefinedFullModal}>
                      查看润色稿全文
                    </button>
                    </div>
                  <div className="studio-refined-grid studio-modal-refined-grid">
                          <div>
                      <div className="studio-refined-lbl">工作稿摘录</div>
                      <pre className="studio-modal-pre studio-modal-pre-tall">{refinedCompare.working_draft_excerpt || "—"}</pre>
                          </div>
                          <div>
                      <div className="studio-refined-lbl">润色稿摘录</div>
                      <pre className="studio-modal-pre studio-modal-pre-tall refined">{refinedCompare.refined_draft_excerpt || "—"}</pre>
                          </div>
                        </div>
                        {(refinedCompare.refinement_focus || []).length > 0 && (
                    <div className="studio-refined-focus">
                      <div className="studio-refined-lbl">润色重点</div>
                      <ul>
                              {refinedCompare.refinement_focus.map((line, i) => (
                                <li key={i}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                  {refinedModalLoading && <p className="studio-muted">正在加载全文…</p>}
                  {!refinedModalLoading && refinedModalBody && (
                    <>
                      <div className="studio-refined-lbl" style={{ marginTop: 12 }}>
                        润色稿全文
                      </div>
                      <pre className="studio-modal-pre">{refinedModalBody}</pre>
                    </>
                  )}
                </>
              )}
              {detailModal.type === "refined_full" && (
                <>
                  <div className="studio-modal-actions">
                    <button type="button" className="studio-btn studio-btn-sm" onClick={() => copyModalText(refinedModalBody)}>
                      复制全文
                    </button>
                          </div>
                  {refinedModalLoading ? (
                    <p className="studio-muted">加载中…</p>
                  ) : (
                    <pre className="studio-modal-pre">{refinedModalBody || "暂无内容"}</pre>
                  )}
                </>
              )}
              {detailModal.type === "interview_sections" && detailModal.sections && (
                <div className="studio-modal-interview">
                  {detailModal.sections.map((sec, idx) => (
                    <article key={`${sec.title}-${idx}`} className="studio-interview-card">
                      <h3 className="studio-interview-h">{sec.title}</h3>
                      <pre className="studio-interview-body">{sec.body || " "}</pre>
                    </article>
                  ))}
                      </div>
                    )}
            </div>
          </div>
        </div>
      )}

      {hrPersonaModalOpen && (
        <div
          className="studio-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setHrPersonaModalOpen(false);
          }}
        >
          <div
            className="studio-modal studio-modal-narrow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hr-persona-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="studio-modal-head">
              <h2 id="hr-persona-title" className="studio-modal-title">
                选择本轮 HR / 面试官风格
              </h2>
              <button type="button" className="studio-modal-close" onClick={() => setHrPersonaModalOpen(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="studio-modal-body">
              <p className="studio-save-prompt-text">
                面试表达辅导与面试练习的点评口吻将与此一致。选定后<strong>本案例不可再改</strong>，如需更换请新建案例并重新导入材料。
              </p>
              <div className="studio-hr-grid">
                {[
                  ["strict_professional", "严厉专业型"],
                  ["calm_rational", "冷静理性型"],
                  ["high_pressure", "高压追问型"],
                  ["friendly", "友好沟通型"],
                  ["skeptical", "挑战质疑型"],
                ].map(([id, lab]) => (
                  <button key={id} type="button" className="studio-btn studio-btn-sm" onClick={() => submitHrPersona(id, lab)}>
                    {lab}
                  </button>
                ))}
              </div>
            </div>
          </div>
                  </div>
                )}

      {helpOpen && (
        <div
          className="studio-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setHelpOpen(false);
          }}
        >
          <div className="studio-modal studio-modal-narrow" role="dialog" aria-modal="true">
            <div className="studio-modal-head">
              <h2 className="studio-modal-title">帮助</h2>
              <button type="button" className="studio-modal-close" onClick={() => setHelpOpen(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="studio-modal-body studio-help-body">
              <p>
                <strong>流程：</strong>
                导入材料 →「开始解析」→ 查看主稿与建议 → 接受并写入工作稿 → 查看解析结果 → 面试表达辅导与面试练习（先锁定 HR 风格）→ 提交整套作答 → 导出报告或解析结果。
              </p>
              <p>
                <strong>AI 状态：</strong>顶栏显示模型是否可用；不可用时解析、改写、辅导、出题、评分与综合报告会受限。
              </p>
              <p className="studio-help-muted">
                区块对照仅展示已写入且与快照有差异的区块。左侧可点击文件名查看材料原文，解析完成后会自动回到主内容区。
              </p>
              <div className="studio-help-actions">
                <button type="button" className="studio-btn studio-btn-primary" onClick={replayTutorial}>
                  再看一遍引导
                </button>
                <button type="button" className="studio-btn" onClick={() => setHelpOpen(false)}>
                  关闭
                </button>
              </div>
            </div>
              </div>
            </div>
          )}

      {resultPackModalOpen && (
        <div
          className="studio-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setResultPackModalOpen(false);
          }}
        >
          <div
            className="studio-modal studio-modal-narrow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rp-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="studio-modal-head">
              <h2 id="rp-title" className="studio-modal-title">
                导出解析结果
              </h2>
              <button type="button" className="studio-modal-close" onClick={() => setResultPackModalOpen(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="studio-modal-body">
              <p className="studio-save-prompt-text">
                将导出 ZIP，内含主稿与解析后内容（Word 可直接打开）。可选择是否附带面试综合分析报告。
              </p>
              <label className="studio-checkbox-row">
                <input
                  type="checkbox"
                  checked={includeInterviewInZip}
                  onChange={(e) => setIncludeInterviewInZip(e.target.checked)}
                />
                打包面试综合分析报告（需已在面试练习中生成报告）
              </label>
              <div className="studio-modal-actions studio-save-prompt-actions">
                <button type="button" className="studio-btn studio-btn-primary" onClick={() => confirmExportResultPack()}>
                  选择保存位置并导出…
                </button>
                <button type="button" className="studio-btn" onClick={() => setResultPackModalOpen(false)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {onboardingOpen && (
        <div className="studio-onboard-overlay" role="dialog" aria-modal="true" aria-labelledby="ob-title">
          <div className="studio-onboard-card">
            <h2 id="ob-title" className="studio-onboard-title">
              {ONBOARDING_STEPS[onboardingStep].title}
            </h2>
            <p className="studio-onboard-body">{ONBOARDING_STEPS[onboardingStep].body}</p>
            <div className="studio-onboard-footer">
              <span className="studio-onboard-stepnum">
                {onboardingStep + 1} / {ONBOARDING_STEPS.length}
              </span>
              <div className="studio-onboard-btns">
                {onboardingStep > 0 && (
                  <button type="button" className="studio-btn" onClick={() => setOnboardingStep((s) => s - 1)}>
                    上一步
                  </button>
                )}
                {onboardingStep < ONBOARDING_STEPS.length - 1 ? (
                  <button type="button" className="studio-btn studio-btn-primary" onClick={() => setOnboardingStep((s) => s + 1)}>
                    下一步
                  </button>
                ) : (
                  <button type="button" className="studio-btn studio-btn-primary" onClick={finishOnboarding}>
                    开始使用
                  </button>
                )}
                <button type="button" className="studio-btn studio-btn-ghost" onClick={finishOnboarding}>
                  跳过
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DraftReadBody({ text, highlightRange }) {
  const lines = useMemo(() => buildLineMeta(text || ""), [text]);
  const hl = highlightRange;

  const firstHlIdx = useMemo(() => {
    if (!hl || hl.start >= hl.end) return null;
    for (let i = 0; i < lines.length; i++) {
      const { start, end } = lines[i];
      if (!(hl.end <= start || hl.start >= end)) return i;
    }
    return null;
  }, [hl, lines]);

  return (
    <div className="studio-read-root">
      {lines.map(({ line, start, end }, idx) => {
        let lineHl = false;
        if (hl && hl.start < hl.end) {
          lineHl = !(hl.end <= start || hl.start >= end);
        }
        const inner = renderReadLine(line, `l-${idx}`);
        const showTag = lineHl && firstHlIdx === idx;
        return (
          <div key={`line-${idx}`} className={lineHl ? "studio-read-line-wrap is-highlight" : "studio-read-line-wrap"}>
            {showTag ? <span className="studio-change-pill">本次改动</span> : null}
            <div className="studio-read-line-inner">{inner}</div>
          </div>
        );
      })}
    </div>
  );
}

function renderReadLine(line, key) {
  const trimmed = line.trimEnd();
  const hm = trimmed.match(/^(#{1,6})\s+(.*)$/);
  if (hm) {
    const level = Math.min(hm[1].length, 6);
    const cls = `studio-md-h studio-md-h${level}`;
    const content = hm[2];
    if (level === 1) return <h1 key={key} className={cls}>{content}</h1>;
    if (level === 2) return <h2 key={key} className={cls}>{content}</h2>;
    if (level === 3) return <h3 key={key} className={cls}>{content}</h3>;
    if (level === 4) return <h4 key={key} className={cls}>{content}</h4>;
    if (level === 5) return <h5 key={key} className={cls}>{content}</h5>;
    return <h6 key={key} className={cls}>{content}</h6>;
  }
  if (/^[-*]\s+/.test(trimmed)) {
    return (
      <div key={key} className="studio-md-li">
        {trimmed.replace(/^[-*]\s+/, "")}
      </div>
    );
  }
  if (trimmed === "") {
    return <div key={key} className="studio-read-spacer" />;
  }
  return (
    <p key={key} className="studio-md-p">
      {trimmed}
    </p>
  );
}

export default App;
