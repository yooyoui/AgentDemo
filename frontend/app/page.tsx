"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, ChevronUp, CircleAlert, Edit3, FileDown, FileText, LayoutDashboard, LoaderCircle, MessageSquareText, PanelLeftClose, PanelLeftOpen, Plus, Presentation, RefreshCw, Search, Settings2, SlidersHorizontal, Sparkles, Trash2, Upload, Wifi, WifiOff, X } from "lucide-react";
import { ArtifactEditor, ArtifactRenderer, SourceDrawer, type SourceInfo } from "@/components/artifacts";
import { WorkspaceOverview } from "@/components/workspace-overview";
import { API_URL, api, Artifact, Customer, CustomerSearchResult, Health, Knowledge, OrganizationCandidate, OrganizationIdentity, Prompt, WorkspaceOption } from "@/lib/api";

type View = "workspace" | "knowledge" | "prompts";
type OptionKind = WorkspaceOption["kind"];
const artifactOrder: Artifact["type"][] = ["research", "requirements", "capabilities", "solution", "script"];
const stepLabels: Record<string, string> = { research: "客户摸底", requirements: "需求拆解", capabilities: "能力匹配", solution: "初步方案", script: "拜访话术" };
const optionLabels: Record<OptionKind, string> = { visit_type: "拜访类型", customer_role: "客户角色", style: "表达风格" };
const progressLabel = (value: number) => value < 8 ? "正在创建任务" : value < 28 ? "客户摸底：联网检索与结构化整理" : value < 48 ? "需求拆解" : value < 66 ? "能力匹配与内部引用校验" : value < 82 ? "初步方案" : value < 100 ? "拜访话术" : "生成完成";

export default function Home() {
  const [view, setView] = useState<View>("workspace");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [options, setOptions] = useState<WorkspaceOption[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [communication, setCommunication] = useState("");
  const [visitType, setVisitType] = useState("首次拜访");
  const [customerRole, setCustomerRole] = useState("业务负责人");
  const [style, setStyle] = useState("专业务实");
  const [newCustomer, setNewCustomer] = useState({ name: "", industry: "", nature: "", region: "", notes: "" });
  const [editingId, setEditingId] = useState("");
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [optionKind, setOptionKind] = useState<OptionKind | null>(null);
  const [newOption, setNewOption] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerMatches, setCustomerMatches] = useState<CustomerSearchResult[]>([]);
  const [identity, setIdentity] = useState<OrganizationIdentity | null>(null);
  const [resolutionTarget, setResolutionTarget] = useState<"selected" | "new" | null>(null);
  const [resolutionEntered, setResolutionEntered] = useState("");
  const [candidates, setCandidates] = useState<OrganizationCandidate[]>([]);
  const [resolutionBusy, setResolutionBusy] = useState(false);
  const [pendingNewIdentity, setPendingNewIdentity] = useState<{ entered_name: string; candidate?: OrganizationCandidate; use_entered_name?: boolean } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const [setupExpanded, setSetupExpanded] = useState(true);
  const [showTopButton, setShowTopButton] = useState(false);
  const [collapsedArtifacts, setCollapsedArtifacts] = useState<Set<Artifact["type"]>>(new Set());
  const [activeArtifact, setActiveArtifact] = useState<Artifact["type"] | "">("");
  const selectedIdRef = useRef("");
  const pollTimerRef = useRef<number | null>(null);
  const backendOnlineRef = useRef(false);
  const setupRef = useRef<HTMLElement | null>(null);
  const selected = customers.find((item) => item.id === selectedId);
  const confirmedCount = artifacts.filter((item) => item.confirmed).length;
  const allConfirmed = artifacts.length === 5 && confirmedCount === artifacts.length;
  const capabilityNames = useMemo(() => {
    const content = artifacts.find((item) => item.type === "capabilities")?.content;
    const matches = Array.isArray(content?.["匹配结果"]) ? content["匹配结果"] : [];
    return matches.map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>)["能力"] || "") : "").filter(Boolean);
  }, [artifacts]);

  const loadBase = async () => {
    const [cs, ks, ps, hs, os] = await Promise.allSettled([api.customers(), api.knowledge(), api.prompts(), api.health(), api.workspaceOptions()]);
    if (cs.status === "fulfilled") { setCustomers(cs.value); if (!selectedIdRef.current && cs.value[0]) setSelectedId(cs.value[0].id); }
    if (ks.status === "fulfilled") setKnowledge(ks.value);
    if (ps.status === "fulfilled") setPrompts(ps.value);
    if (hs.status === "fulfilled") {
      backendOnlineRef.current = true;
      setHealth(hs.value);
    } else {
      backendOnlineRef.current = false;
      setHealth(null);
    }
    if (os.status === "fulfilled") setOptions(os.value);
    const failed = [cs, ks, ps, hs, os].filter((item) => item.status === "rejected").length;
    if (failed) setError(`有 ${failed} 项基础数据加载失败，可刷新后重试`);
  };

  useEffect(() => { void loadBase(); return () => { if (pollTimerRef.current) window.clearInterval(pollTimerRef.current); }; }, []);
  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem("ui:sidebar-collapsed") === "true");
    setPresentationMode(window.localStorage.getItem("ui:presentation-mode") === "true");
    const onScroll = () => setShowTopButton(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    let active = true;
    const checkBackend = async () => {
      try {
        const status = await api.health();
        if (!active) return;
        const recovered = !backendOnlineRef.current;
        backendOnlineRef.current = true;
        setHealth(status);
        if (recovered) void loadBase();
      } catch {
        if (!active) return;
        backendOnlineRef.current = false;
        setHealth(null);
      }
    };
    const timer = window.setInterval(() => { void checkBackend(); }, 5000);
    const handleFocus = () => { void checkBackend(); };
    window.addEventListener("focus", handleFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    setEditingId(""); setSource(null); setArtifacts([]);
    setCommunication(selectedId ? window.localStorage.getItem(`visit-communication:${selectedId}`) || "" : "");
    setIdentity(null);
    if (!selectedId) return;
    const controller = new AbortController();
    api.artifacts(selectedId, controller.signal).then((items) => {
      if (selectedIdRef.current === selectedId) {
        setArtifacts(items);
        setCollapsedArtifacts(new Set(items.filter((item) => item.confirmed).map((item) => item.type)));
        setSetupExpanded(items.length === 0);
      }
    }).catch((reason) => { if (reason?.name !== "AbortError" && selectedIdRef.current === selectedId) setArtifacts([]); });
    api.organizationIdentity(selectedId, controller.signal).then((item) => { if (selectedIdRef.current === selectedId) setIdentity(item); }).catch(() => undefined);
    return () => controller.abort();
  }, [selectedId]);
  useEffect(() => {
    if (!customerQuery.trim()) { setCustomerMatches([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => api.searchCustomers(customerQuery, controller.signal).then(setCustomerMatches).catch((reason) => { if (reason?.name !== "AbortError") setCustomerMatches([]); }), 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [customerQuery]);
  useEffect(() => {
    if (!artifacts.length || view !== "workspace") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const type = visible?.target.getAttribute("data-artifact-type") as Artifact["type"] | null;
      if (type) setActiveArtifact(type);
    }, { rootMargin: "-22% 0px -62% 0px", threshold: [0, .15, .4] });
    document.querySelectorAll("[data-artifact-type]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [artifacts, collapsedArtifacts, view]);
  useEffect(() => {
    const context = typeof document === "undefined" ? undefined : document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "start_visit_preparation", title: "发起拜访准备",
      description: "填入客户基本信息并打开拜访准备工作台，等待使用者补充沟通记录后生成。",
      inputSchema: { type: "object", properties: { name: { type: "string", minLength: 2 }, industry: { type: "string" }, region: { type: "string" } }, required: ["name"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        const value = input as { name?: unknown; industry?: unknown; region?: unknown };
        if (typeof value.name !== "string" || value.name.trim().length < 2) throw new Error("客户名称至少需要两个字符");
        setView("workspace");
        setNewCustomer({ name: value.name.trim(), industry: typeof value.industry === "string" ? value.industry : "", nature: "", region: typeof value.region === "string" ? value.region : "", notes: "" });
        return { status: "staged", customerName: value.name.trim(), next: "请在页面补充信息并保存客户档案" };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const createCustomer = async () => {
    if (!newCustomer.name.trim()) return setError("请填写客户单位名称");
    if (!pendingNewIdentity || pendingNewIdentity.entered_name !== newCustomer.name.trim()) return setError("请先识别客户主体，并选择候选或明确沿用输入名称");
    setBusy(true); setError("");
    try {
      const createName = pendingNewIdentity.candidate?.canonical_name || newCustomer.name.trim();
      let customer = await api.createCustomer({ ...newCustomer, name: createName, industry: newCustomer.industry || "待补充", nature: newCustomer.nature || "待补充", region: newCustomer.region || "待补充" });
      const confirmedIdentity = await api.confirmOrganizationIdentity(customer.id, pendingNewIdentity);
      customer = { ...customer, name: confirmedIdentity.canonical_name, region: confirmedIdentity.region || customer.region, industry: confirmedIdentity.industry || customer.industry };
      setIdentity(confirmedIdentity); setCustomers([customer, ...customers]); setSelectedId(customer.id); setNewCustomer({ name: "", industry: "", nature: "", region: "", notes: "" }); setPendingNewIdentity(null);
    } catch (e) { setError(e instanceof Error ? e.message : "创建失败"); } finally { setBusy(false); }
  };

  const startResolution = async (target: "selected" | "new") => {
    const source = target === "selected" ? selected : newCustomer;
    if (!source?.name.trim()) return setError("请先填写客户单位名称");
    setResolutionTarget(target); setResolutionEntered(source.name.trim()); setCandidates([]); setResolutionBusy(true); setError("");
    try {
      const result = await api.resolveOrganization({ name: source.name.trim(), region: source.region || "", industry: source.industry || "" });
      setCandidates(result.candidates);
    } catch (e) { setError(e instanceof Error ? `${e.message}；仍可明确沿用输入名称` : "主体识别失败"); }
    finally { setResolutionBusy(false); }
  };

  const chooseIdentity = async (candidate?: OrganizationCandidate) => {
    const payload = { entered_name: resolutionEntered, ...(candidate ? { candidate } : { use_entered_name: true }) };
    if (resolutionTarget === "new") {
      setPendingNewIdentity(payload); setResolutionTarget(null); return;
    }
    if (!selected) return;
    setResolutionBusy(true); setError("");
    try {
      const confirmed = await api.confirmOrganizationIdentity(selected.id, payload); setIdentity(confirmed);
      setCustomers((items) => items.map((item) => item.id === selected.id ? { ...item, name: confirmed.canonical_name, region: confirmed.region, industry: confirmed.industry } : item));
      setResolutionTarget(null);
    } catch (e) { setError(e instanceof Error ? e.message : "主体确认失败"); }
    finally { setResolutionBusy(false); }
  };

  const deleteCustomer = async () => {
    if (!selected || deleteName !== selected.name) return;
    setBusy(true); setError("");
    try {
      await api.deleteCustomer(selected.id, deleteName);
      const remaining = customers.filter((item) => item.id !== selected.id);
      setCustomers(remaining); setSelectedId(remaining[0]?.id || ""); setArtifacts([]); setDeleteOpen(false); setDeleteName("");
    } catch (e) { setError(e instanceof Error ? e.message : "删除客户失败"); } finally { setBusy(false); }
  };

  const updateCommunication = (value: string) => {
    setCommunication(value);
    if (selectedId) window.localStorage.setItem(`visit-communication:${selectedId}`, value);
  };

  const poll = (taskId: string, customerId: string, failure: string) => {
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const latest = await api.task(taskId);
        if (selectedIdRef.current === customerId) setProgress(latest.progress);
        if (latest.status === "completed" || latest.status === "failed") {
          if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null; setBusy(false);
          if (latest.status === "failed") setError(latest.error || failure);
          else if (selectedIdRef.current === customerId) {
            setArtifacts(await api.artifacts(customerId));
            setCollapsedArtifacts(new Set());
            setSetupExpanded(false);
          }
        }
      } catch { if (pollTimerRef.current) window.clearInterval(pollTimerRef.current); pollTimerRef.current = null; setBusy(false); setError("无法获取任务进度，请刷新页面恢复"); }
    }, 900);
  };

  const runAll = async () => {
    if (!selectedId) return setError("请先新建或选择客户");
    if (!identity) return setError("请先点击“识别主体”，选择可信候选或明确沿用输入名称");
    if (artifacts.length > 0 && !window.confirm("重新生成会创建新版本，并取消当前五项材料的确认状态。是否继续？")) return;
    setBusy(true); setError(""); setProgress(2);
    try { const customerId = selectedId; poll((await api.runAll(customerId, { communication, visit_type: visitType, customer_role: customerRole, style })).id, customerId, "生成失败"); }
    catch (e) { setBusy(false); setError(e instanceof Error ? e.message : "生成失败"); }
  };

  const runResearch = async () => {
    if (!selectedId) return setError("请先新建或选择客户");
    if (!identity) return setError("请先点击“识别主体”，选择可信候选或明确沿用输入名称");
    if (artifacts.some((item) => item.type === "research") && !window.confirm("重新联网摸底会创建新版本，并将客户摸底恢复为待确认。是否继续？")) return;
    setBusy(true); setError(""); setProgress(2);
    try { const customerId = selectedId; poll((await api.runResearch(customerId)).id, customerId, "客户摸底生成失败"); }
    catch (e) { setBusy(false); setError(e instanceof Error ? e.message : "客户摸底生成失败"); }
  };

  const confirm = async (artifact: Artifact) => {
    try {
      const updated = await api.confirmArtifact(artifact.id);
      setArtifacts((items) => items.map((item) => item.id === updated.id ? updated : item));
      setCollapsedArtifacts((items) => new Set(items).add(artifact.type));
    }
    catch (e) { setError(e instanceof Error ? e.message : "确认失败"); }
  };

  const saveEdit = async (artifact: Artifact, content: Record<string, unknown>) => {
    try {
      const updated = await api.updateArtifact(artifact.id, content);
      setArtifacts((items) => items.map((item) => item.id === updated.id ? updated : item)); setEditingId("");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
  };

  const toggleSidebar = () => setSidebarCollapsed((value) => {
    window.localStorage.setItem("ui:sidebar-collapsed", String(!value));
    return !value;
  });
  const togglePresentation = () => setPresentationMode((value) => {
    window.localStorage.setItem("ui:presentation-mode", String(!value));
    return !value;
  });
  const toggleArtifact = (type: Artifact["type"]) => setCollapsedArtifacts((items) => {
    const next = new Set(items);
    if (next.has(type)) next.delete(type); else next.add(type);
    return next;
  });
  const scrollToArtifact = (type: Artifact["type"]) => {
    setCollapsedArtifacts((items) => { const next = new Set(items); next.delete(type); return next; });
    window.setTimeout(() => document.getElementById(`artifact-${type}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const optionValues = (kind: OptionKind) => options.filter((item) => item.kind === kind);
  const addOption = async () => {
    if (!optionKind || !newOption.trim()) return;
    try { const created = await api.createWorkspaceOption({ kind: optionKind, label: newOption }); setOptions([...options, created]); setNewOption(""); }
    catch (e) { setError(e instanceof Error ? e.message : "添加选项失败"); }
  };
  const removeOption = async (option: WorkspaceOption) => {
    try {
      await api.deleteWorkspaceOption(option.id);
      const remaining = options.filter((item) => item.id !== option.id); setOptions(remaining);
      const fallback = remaining.find((item) => item.kind === option.kind && item.is_builtin)?.label || "";
      if (option.kind === "visit_type" && visitType === option.label) setVisitType(fallback);
      if (option.kind === "customer_role" && customerRole === option.label) setCustomerRole(fallback);
      if (option.kind === "style" && style === option.label) setStyle(fallback);
    } catch (e) { setError(e instanceof Error ? e.message : "删除选项失败"); }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    const form = new FormData(); form.append("file", file); form.append("category", "产品"); form.append("version", "1.0");
    setBusy(true); setError("");
    try { const doc = await api.uploadKnowledge(form); setKnowledge([doc, ...knowledge]); } catch (e) { setError(e instanceof Error ? e.message : "上传失败"); } finally { setBusy(false); event.target.value = ""; }
  };
  const deleteKnowledge = async (document: Knowledge) => {
    if (!window.confirm(`确认删除“${document.filename}”吗？删除后该资料将不再参与后续能力匹配。`)) return;
    setBusy(true); setError("");
    try { await api.deleteKnowledge(document.id); setKnowledge((items) => items.filter((item) => item.id !== document.id)); }
    catch (e) { setError(e instanceof Error ? e.message : "删除知识库资料失败"); } finally { setBusy(false); }
  };
  const exportFile = async (format: "docx" | "pdf") => {
    if (!selectedId || !allConfirmed) return setError("请先逐项确认全部五份材料");
    try {
      const response = await fetch(`${API_URL}/customers/${selectedId}/export/${format}`, { method: "POST" });
      if (!response.ok) return setError((await response.json().catch(() => ({}))).detail || "导出失败");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${selected?.name || "客户"}拜访准备材料.${format}`; anchor.click(); URL.revokeObjectURL(url);
    } catch { setError("导出网络请求失败，请稍后重试"); }
  };

  return <main className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${presentationMode ? " presentation-mode" : ""}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={20} /></div><div><strong>政企拜访助手</strong><span>AI 工作台</span></div><button className="sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "展开导航栏" : "收起导航栏"} title={sidebarCollapsed ? "展开导航栏" : "收起导航栏"}>{sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button></div>
      <nav aria-label="主导航"><button aria-label="拜访工作台" title="拜访工作台" className={view === "workspace" ? "active" : ""} onClick={() => setView("workspace")}><LayoutDashboard size={20} /><span>拜访工作台</span></button><button aria-label="能力知识库" title="能力知识库" className={view === "knowledge" ? "active" : ""} onClick={() => setView("knowledge")}><BookOpen size={20} /><span>能力知识库</span><span className="nav-count">{knowledge.length}</span></button><button aria-label="提示词管理" title="提示词管理" className={view === "prompts" ? "active" : ""} onClick={() => setView("prompts")}><Settings2 size={20} /><span>提示词管理</span></button></nav>
      <div className="sidebar-status"><span className={health ? "status-dot online" : "status-dot"} />{health ? <><span>服务已连接</span><small>{health.model === "demo-rules" ? "演示生成模式" : health.model}</small></> : <><span>等待后端服务</span><small>请启动 API</small></>}</div><p className="security-note">单一共享工作空间<br />仅限受控网络使用</p>
    </aside>
    <section className="main-area">
      <header className="topbar"><div><p className="eyebrow">{view === "workspace" ? "VISIT PREPARATION" : view === "knowledge" ? "KNOWLEDGE CENTER" : "PROMPT STUDIO"}</p><h1>{view === "workspace" ? "拜访准备工作台" : view === "knowledge" ? "移动能力知识库" : "提示词管理"}</h1></div><div className="topbar-actions"><button className={presentationMode ? "presentation-toggle active" : "presentation-toggle"} onClick={togglePresentation} aria-pressed={presentationMode} title="切换投屏演示字号"><Presentation size={18} /><span>{presentationMode ? "退出演示" : "演示模式"}</span></button><div className="connection">{health ? <Wifi size={17} /> : <WifiOff size={17} />} {health ? <>{health.model_status === "configured" ? health.model : "大模型演示模式"} · {health.research === "tavily" ? `Tavily ${health.research_model || ""}${health.research_fallback ? ` / 备用 ${health.research_fallback}` : ""}` : health.research === "deepseek-web" ? `检索 ${health.research_model || "已启用"}` : "检索演示模式"}</> : "等待服务"}</div></div></header>
      {error && <div className="error-banner" role="alert"><CircleAlert size={20} /><span>{error}</span><button onClick={() => setError("")} aria-label="关闭错误提示">关闭</button></div>}
      {view === "workspace" && <div className="workspace">
        <section ref={setupRef} className={`control-panel setup-panel${setupExpanded ? "" : " collapsed"}`} id="visit-setup">
          <header className="setup-header"><div><span className="section-index">准备信息</span><h2>本次拜访设置</h2></div><div><span className="shared-badge">共享空间</span><button className="setup-toggle" onClick={() => setSetupExpanded((value) => !value)} aria-expanded={setupExpanded}>{setupExpanded ? <><ChevronUp size={18} />收起</> : <><Edit3 size={18} />编辑准备信息</>}</button></div></header>
          {!setupExpanded && <div className="setup-summary"><strong>{selected?.name || "尚未选择客户"}</strong><span>{visitType}</span><span>{customerRole}</span><span>{style}</span><small>{communication.trim() ? `已录入 ${communication.trim().length} 字沟通背景` : "尚未录入沟通背景"}</small></div>}
          {setupExpanded && <div className="setup-content"><div className="setup-grid">
            <section className="setup-section customer-setup"><div className="panel-head compact"><div><span className="section-index">01</span><h3>选择客户</h3></div></div>
              <label>搜索已有客户<input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="输入简称或名称，优先匹配本地客户" /></label>
              {!!customerMatches.length && <div className="customer-matches">{customerMatches.map((match) => <button key={match.customer.id} onClick={() => { setSelectedId(match.customer.id); setCustomerQuery(""); setCustomerMatches([]); }}><span><strong>{match.customer.name}</strong><small>{match.match_reason} · {match.score}%</small></span><em>{match.verification_status === "verified" ? "已核实" : match.verification_status === "unverified" ? "未核实" : "待识别"}</em></button>)}</div>}
              <div className="customer-select-row"><select aria-label="选择客户" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">请选择</option>{customers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button type="button" className="danger-icon" disabled={!selected || busy} onClick={() => { setDeleteName(""); setDeleteOpen(true); }} aria-label="删除当前客户" title="删除当前客户"><Trash2 size={19} /></button></div>
              {selected && <div className={`identity-status ${identity?.verification_status || "missing"}`}><div><span>{identity?.verification_status === "verified" ? "主体已核实" : identity?.verification_status === "unverified" ? "主体未核实（已明确沿用输入）" : "尚未确认组织主体"}</span>{identity && <small>输入：{identity.entered_name} · 标准名称：{identity.canonical_name}</small>}</div><button type="button" className="identity-button" disabled={busy || resolutionBusy} onClick={() => void startResolution("selected")}><Search size={16} />{identity ? "重新识别" : "识别主体"}</button></div>}
              <details className="new-customer"><summary><Plus size={18} />新建客户档案</summary><div className="form-grid"><label className="wide">单位名称<input value={newCustomer.name} onChange={(event) => { setNewCustomer({ ...newCustomer, name: event.target.value }); setPendingNewIdentity(null); }} placeholder="可输入简称，随后识别主体" /></label><label>所属行业<input value={newCustomer.industry} onChange={(event) => { setNewCustomer({ ...newCustomer, industry: event.target.value }); setPendingNewIdentity(null); }} placeholder="如：政务、制造" /></label><label>所在地区<input value={newCustomer.region} onChange={(event) => { setNewCustomer({ ...newCustomer, region: event.target.value }); setPendingNewIdentity(null); }} placeholder="省 / 市" /></label><button className="secondary wide" onClick={() => void startResolution("new")} disabled={busy || !newCustomer.name.trim()}><Search size={17} />识别客户主体（最多 3 个候选）</button>{pendingNewIdentity && <p className="wide identity-choice">{pendingNewIdentity.candidate ? `已选择：${pendingNewIdentity.candidate.canonical_name}` : "已选择：沿用输入名称（未核实）"}</p>}<button className="secondary wide" onClick={createCustomer} disabled={busy || !pendingNewIdentity}>保存客户档案</button></div></details>
            </section>
            <section className="setup-section communication-setup"><div className="panel-head compact"><div><span className="section-index">02</span><h3>输入沟通背景</h3></div></div>
              <label>前期沟通记录<textarea value={communication} onChange={(event) => updateCommunication(event.target.value)} rows={7} placeholder="粘贴当前客户的聊天记录、会议纪要或客户描述……" /></label>
              <div className="visit-options">{([
                ["拜访类型", "visit_type", visitType, setVisitType], ["客户角色", "customer_role", customerRole, setCustomerRole], ["表达风格", "style", style, setStyle],
              ] as const).map(([label, kind, value, setter]) => <label key={kind}><span className="label-with-action">{label}<button type="button" onClick={() => { setOptionKind(kind); setNewOption(""); }}><SlidersHorizontal size={15} />管理</button></span><select value={value} onChange={(event) => setter(event.target.value)}>{optionValues(kind).map((item) => <option key={item.id}>{item.label}</option>)}</select></label>)}</div>
            </section>
          </div>
          <div className="generation-bar"><div><div className="generation-actions"><button className="primary" onClick={runAll} disabled={busy || !selectedId || allConfirmed}>{busy ? <><LoaderCircle className="spin" size={20} />{progressLabel(progress)} · {progress}%</> : allConfirmed ? <><Check size={20} />材料已确认，可以导出</> : artifacts.length > 0 ? <><RefreshCw size={20} />重新生成全部材料</> : <><Sparkles size={20} />一键生成拜访材料</>}</button><button className="secondary research-only" onClick={runResearch} disabled={busy || !selectedId}><Search size={18} />仅生成客户摸底</button></div>{artifacts.length > 0 && !allConfirmed && <p className="regenerate-note">重新生成会创建新版本，并将全部材料恢复为待确认。</p>}</div>{busy && <div className="progress-block"><span>{progressLabel(progress)}</span><strong>{progress}%</strong><div className="progress"><i style={{ width: `${progress}%` }} /></div></div>}</div>
          </div>}
        </section>
        {!!artifacts.length && <WorkspaceOverview artifacts={artifacts} confirmedCount={confirmedCount} knowledgeCount={knowledge.length} />}
        <section className="results-panel">
          <div className="results-head"><div><p className="eyebrow">PREPARATION PACK</p><h2>{selected?.name || "尚未选择客户"}</h2>{selected && <span className={`pack-identity ${identity?.verification_status || "missing"}`}>{identity?.verification_status === "verified" ? "主体已核实" : identity?.verification_status === "unverified" ? "主体未核实" : "主体待识别"}</span>}</div><div className="export-actions"><button onClick={() => exportFile("docx")} disabled={!allConfirmed}><FileDown size={16} />Word</button><button onClick={() => exportFile("pdf")} disabled={!allConfirmed}><FileDown size={16} />PDF</button></div></div>
          <nav className="step-strip" aria-label="拜访材料章节">{artifactOrder.map((type, index) => { const item = artifacts.find((entry) => entry.type === type); return <button className={`${item?.confirmed ? "step done" : item ? "step ready" : "step"}${activeArtifact === type ? " active" : ""}`} disabled={!item} onClick={() => scrollToArtifact(type)} key={type}><span>{item?.confirmed ? <Check className="step-check" size={16} strokeWidth={2.4} /> : index + 1}</span><small>{stepLabels[type]}</small>{index < 4 && <ChevronRight size={16} />}</button>; })}</nav>
          {!artifacts.length ? <div className="empty-state"><div className="empty-orbit"><Search size={28} /></div><h3>从客户信息开始准备</h3><p>系统会依次完成客户摸底、需求拆解、能力匹配、方案与话术生成。</p></div> : <div className="artifact-list">{artifactOrder.map((type) => {
            const item = artifacts.find((entry) => entry.type === type); if (!item) return null; const editing = editingId === item.id;
            const collapsed = collapsedArtifacts.has(type);
            return <article id={`artifact-${type}`} data-artifact-type={type} className={`artifact-card artifact-${type}${collapsed ? " collapsed" : ""}`} key={item.id}><header><button className="artifact-heading" onClick={() => toggleArtifact(type)} aria-expanded={!collapsed}><span className="artifact-number">{String(artifactOrder.indexOf(type) + 1).padStart(2, "0")}</span><h3>{stepLabels[type]}</h3><span className="version">V{item.version}</span>{collapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}</button><div className="artifact-actions"><button className="edit-button" onClick={() => { setCollapsedArtifacts((items) => { const next = new Set(items); next.delete(type); return next; }); setEditingId(editing ? "" : item.id); }}>{editing ? <><X size={16} />取消</> : <><Edit3 size={16} />编辑</>}</button><button className={item.confirmed ? "confirmed" : "confirm"} disabled={editing} onClick={() => confirm(item)}>{item.confirmed ? <><Check size={17} />已确认</> : "确认本项"}</button></div></header>{!collapsed && (editing ? <ArtifactEditor artifact={item} options={options} capabilityNames={capabilityNames} onCancel={() => setEditingId("")} onSave={(content) => saveEdit(item, content)} /> : <ArtifactRenderer artifact={item} onSource={setSource} onSave={(content) => saveEdit(item, content)} />)}</article>;
          })}</div>}
          {!!artifacts.length && <div className="review-footer"><div className="review-meter"><span>{confirmedCount}/5 已确认</span><div><i style={{ width: `${confirmedCount * 20}%` }} /></div></div><p>{allConfirmed ? "全部材料已人工确认，可以导出正式文件。" : "可在各模块内编辑事实、能力边界和表达，再逐项确认。"}</p></div>}
        </section>
      </div>}
      {view === "knowledge" && <div className="single-view"><section className="library-summary"><div><p className="eyebrow">INTERNAL EVIDENCE</p><h2>上传公司正式资料</h2><p>只有知识库中有明确依据的产品、服务和案例，才会进入能力匹配结果。</p></div><label className="upload-button"><Upload size={18} />上传资料<input type="file" accept=".pdf,.docx,.pptx,.xlsx,.txt,.md" onChange={upload} hidden /></label></section><div className="document-grid">{knowledge.map((doc) => <article key={doc.id}><div className="doc-icon"><FileText size={22} /></div><div><h3>{doc.filename}</h3><p>{doc.category} · V{doc.version}</p></div><div className="doc-actions"><span>{doc.status === "ready" ? "可检索" : doc.status}</span><button type="button" onClick={() => void deleteKnowledge(doc)} disabled={busy} aria-label={`删除 ${doc.filename}`} title="删除资料"><Trash2 size={15} /></button></div></article>)}{!knowledge.length && <div className="library-empty"><BookOpen size={28} /><p>知识库尚为空，请上传移动产品、行业方案或案例资料。</p></div>}</div></div>}
      {view === "prompts" && <div className="single-view"><div className="prompt-intro"><p>提示词按任务独立管理。修改后将应用于后续生成，不会自动改写已有材料。</p></div><div className="prompt-list">{prompts.map((prompt) => <article key={prompt.id}><header><div><MessageSquareText size={19} /><h3>{stepLabels[prompt.task_type] || prompt.name}</h3></div><span>V{prompt.version} · {prompt.enabled ? "启用" : "停用"}</span></header><textarea value={prompt.content} onChange={(event) => setPrompts(prompts.map((item) => item.id === prompt.id ? { ...item, content: event.target.value } : item))} rows={4} /><button className="secondary" onClick={async () => { try { const updated = await api.updatePrompt(prompt.task_type, { name: prompt.name, content: prompt.content, version: prompt.version, enabled: prompt.enabled }); setPrompts(prompts.map((item) => item.id === updated.id ? updated : item)); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } }}><RefreshCw size={15} />保存当前版本</button></article>)}</div></div>}
    </section>
    {view === "workspace" && showTopButton && <button className="back-to-top" onClick={() => setupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} aria-label="回到拜访准备信息" title="回到顶部"><ArrowUp size={22} /><span>顶部</span></button>}
    {deleteOpen && selected && <div className="modal-mask"><div className="modal-card"><header><h3>彻底删除客户</h3><button onClick={() => setDeleteOpen(false)}><X size={18} /></button></header><p>将删除客户、五类成果、任务历史、导出记录及对应 Word/PDF 文件，此操作不可恢复。</p><label>输入完整客户名称确认<input autoFocus value={deleteName} onChange={(event) => setDeleteName(event.target.value)} placeholder={selected.name} /></label><div className="modal-actions"><button className="secondary" onClick={() => setDeleteOpen(false)}>取消</button><button className="danger-button" disabled={deleteName !== selected.name || busy} onClick={() => void deleteCustomer()}>确认彻底删除</button></div></div></div>}
    {optionKind && <div className="modal-mask"><div className="modal-card option-manager"><header><div><small>共享工作空间</small><h3>管理{optionLabels[optionKind]}</h3></div><button onClick={() => setOptionKind(null)}><X size={18} /></button></header><div className="option-create"><input value={newOption} maxLength={50} onChange={(event) => setNewOption(event.target.value)} placeholder="输入自定义选项" /><button className="confirm" disabled={!newOption.trim()} onClick={() => void addOption()}><Plus size={14} />添加</button></div><div className="option-list">{optionValues(optionKind).map((item) => <div key={item.id}><span>{item.label}</span>{item.is_builtin ? <small>默认项</small> : <button onClick={() => void removeOption(item)}><Trash2 size={14} />删除</button>}</div>)}</div></div></div>}
    {resolutionTarget && <div className="modal-mask"><div className="modal-card resolution-modal"><header><div><small>组织主体消歧</small><h3>选择最可信的主体</h3></div><button onClick={() => setResolutionTarget(null)}><X size={18} /></button></header><p>输入名称：{resolutionEntered}。联网仅执行这一轮综合查询，最多展示 3 个候选。</p>{resolutionBusy ? <div className="resolution-loading"><LoaderCircle className="spin" size={20} />正在核对权威公开来源…</div> : <div className="candidate-list">{candidates.map((candidate) => <button key={`${candidate.canonical_name}-${candidate.registration_code || "none"}`} onClick={() => void chooseIdentity(candidate)}><span className={`confidence ${candidate.confidence}`}>{candidate.confidence === "high" ? "高可信" : candidate.confidence === "medium" ? "中可信" : "低可信"}</span><strong>{candidate.canonical_name}</strong><small>{candidate.entity_type} · {candidate.region} · {candidate.industry}</small><small>{candidate.match_reasons.join("、")} · 匹配分 {candidate.score}</small><em>{candidate.evidence.length} 个公开来源</em></button>)}{!candidates.length && <p className="candidate-empty">未找到可可靠辨认的候选，可沿用输入名称并标记为未核实。</p>}</div>}<button className="secondary use-entered" disabled={resolutionBusy} onClick={() => void chooseIdentity()}>都不是，沿用输入名称（未核实）</button></div></div>}
    <SourceDrawer source={source} onClose={() => setSource(null)} />
  </main>;
}
