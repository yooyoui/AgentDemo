"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { BookOpen, Check, ChevronRight, CircleAlert, Edit3, FileDown, FileText, LayoutDashboard, LoaderCircle, MessageSquareText, Plus, RefreshCw, Search, Settings2, SlidersHorizontal, Sparkles, Trash2, Upload, Wifi, WifiOff, X } from "lucide-react";
import { ArtifactEditor, ArtifactRenderer, SourceDrawer, type SourceInfo } from "@/components/artifacts";
import { API_URL, api, Artifact, Customer, Health, Knowledge, Prompt, WorkspaceOption } from "@/lib/api";

type View = "workspace" | "knowledge" | "prompts";
type OptionKind = WorkspaceOption["kind"];
const artifactOrder: Artifact["type"][] = ["research", "requirements", "capabilities", "solution", "script"];
const stepLabels: Record<string, string> = { research: "客户摸底", requirements: "需求拆解", capabilities: "能力匹配", solution: "初步方案", script: "拜访话术" };
const optionLabels: Record<OptionKind, string> = { visit_type: "拜访类型", customer_role: "客户角色", style: "表达风格" };

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
  const [communication, setCommunication] = useState("客户希望提升跨部门协同效率，目前资料由人工汇总，耗时且缺少统一数据口径。希望先了解可快速落地的建设方案，并关注数据安全和投入周期。");
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
  const selected = customers.find((item) => item.id === selectedId);
  const confirmedCount = artifacts.filter((item) => item.confirmed).length;
  const allConfirmed = artifacts.length === 5 && confirmedCount === artifacts.length;
  const capabilityNames = useMemo(() => {
    const content = artifacts.find((item) => item.type === "capabilities")?.content;
    const matches = Array.isArray(content?.["匹配结果"]) ? content["匹配结果"] : [];
    return matches.map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>)["能力"] || "") : "").filter(Boolean);
  }, [artifacts]);

  const loadBase = async () => {
    try {
      const [cs, ks, ps, hs, os] = await Promise.all([api.customers(), api.knowledge(), api.prompts(), api.health(), api.workspaceOptions()]);
      setCustomers(cs); setKnowledge(ks); setPrompts(ps); setHealth(hs); setOptions(os);
      if (!selectedId && cs[0]) setSelectedId(cs[0].id);
    } catch (e) { setError(e instanceof Error ? e.message : "后端服务暂不可用"); }
  };

  useEffect(() => { void loadBase(); }, []);
  useEffect(() => { setEditingId(""); setSource(null); if (selectedId) api.artifacts(selectedId).then(setArtifacts).catch(() => setArtifacts([])); else setArtifacts([]); }, [selectedId]);
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
    setBusy(true); setError("");
    try {
      const customer = await api.createCustomer({ ...newCustomer, industry: newCustomer.industry || "待补充", nature: newCustomer.nature || "待补充", region: newCustomer.region || "待补充" });
      setCustomers([customer, ...customers]); setSelectedId(customer.id); setNewCustomer({ name: "", industry: "", nature: "", region: "", notes: "" });
    } catch (e) { setError(e instanceof Error ? e.message : "创建失败"); } finally { setBusy(false); }
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

  const poll = (taskId: string, failure: string) => {
    const timer = window.setInterval(async () => {
      try {
        const latest = await api.task(taskId); setProgress(latest.progress);
        if (latest.status === "completed" || latest.status === "failed") {
          window.clearInterval(timer); setBusy(false);
          if (latest.status === "failed") setError(latest.error || failure);
          else setArtifacts(await api.artifacts(selectedId));
        }
      } catch { window.clearInterval(timer); setBusy(false); setError("无法获取任务进度"); }
    }, 900);
  };

  const runAll = async () => {
    if (!selectedId) return setError("请先新建或选择客户");
    if (artifacts.length > 0 && !window.confirm("重新生成会创建新版本，并取消当前五项材料的确认状态。是否继续？")) return;
    setBusy(true); setError(""); setProgress(2);
    try { poll((await api.runAll(selectedId, { communication, visit_type: visitType, customer_role: customerRole, style })).id, "生成失败"); }
    catch (e) { setBusy(false); setError(e instanceof Error ? e.message : "生成失败"); }
  };

  const runResearch = async () => {
    if (!selectedId) return setError("请先新建或选择客户");
    if (artifacts.some((item) => item.type === "research") && !window.confirm("重新联网摸底会创建新版本，并将客户摸底恢复为待确认。是否继续？")) return;
    setBusy(true); setError(""); setProgress(2);
    try { poll((await api.runResearch(selectedId)).id, "客户摸底生成失败"); }
    catch (e) { setBusy(false); setError(e instanceof Error ? e.message : "客户摸底生成失败"); }
  };

  const confirm = async (artifact: Artifact) => {
    try { const updated = await api.confirmArtifact(artifact.id); setArtifacts((items) => items.map((item) => item.id === updated.id ? updated : item)); }
    catch (e) { setError(e instanceof Error ? e.message : "确认失败"); }
  };

  const saveEdit = async (artifact: Artifact, content: Record<string, unknown>) => {
    try {
      const updated = await api.updateArtifact(artifact.id, content);
      setArtifacts((items) => items.map((item) => item.id === updated.id ? updated : item)); setEditingId("");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
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
    const response = await fetch(`${API_URL}/customers/${selectedId}/export/${format}`, { method: "POST" });
    if (!response.ok) return setError((await response.json().catch(() => ({}))).detail || "导出失败");
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${selected?.name || "客户"}拜访准备材料.${format}`; anchor.click(); URL.revokeObjectURL(url);
  };

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={20} /></div><div><strong>政企拜访助手</strong><span>AI 工作台</span></div></div>
      <nav><button className={view === "workspace" ? "active" : ""} onClick={() => setView("workspace")}><LayoutDashboard size={19} />拜访工作台</button><button className={view === "knowledge" ? "active" : ""} onClick={() => setView("knowledge")}><BookOpen size={19} />能力知识库<span className="nav-count">{knowledge.length}</span></button><button className={view === "prompts" ? "active" : ""} onClick={() => setView("prompts")}><Settings2 size={19} />提示词管理</button></nav>
      <div className="sidebar-status"><span className={health ? "status-dot online" : "status-dot"} />{health ? <><span>服务已连接</span><small>{health.model === "demo-rules" ? "演示生成模式" : health.model}</small></> : <><span>等待后端服务</span><small>请启动 API</small></>}</div><p className="security-note">单一共享工作空间<br />仅限受控网络使用</p>
    </aside>
    <section className="main-area">
      <header className="topbar"><div><p className="eyebrow">{view === "workspace" ? "VISIT PREPARATION" : view === "knowledge" ? "KNOWLEDGE CENTER" : "PROMPT STUDIO"}</p><h1>{view === "workspace" ? "拜访准备工作台" : view === "knowledge" ? "移动能力知识库" : "提示词管理"}</h1></div><div className="connection">{health ? <Wifi size={16} /> : <WifiOff size={16} />} {health ? <>{health.model_status === "configured" ? health.model : "大模型演示模式"} · {health.research === "deepseek-web" ? `公开检索 ${health.research_model || "已启用"}` : "公开检索演示模式"}</> : "等待服务"}</div></header>
      {error && <div className="error-banner"><CircleAlert size={18} /><span>{error}</span><button onClick={() => setError("")}>关闭</button></div>}
      {view === "workspace" && <div className="workspace">
        <section className="control-panel">
          <div className="panel-head"><div><span className="section-index">01</span><h2>选择客户</h2></div><span className="shared-badge">共享空间</span></div>
          <label>已有客户<div className="customer-select-row"><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">请选择</option>{customers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button type="button" className="danger-icon" disabled={!selected || busy} onClick={() => { setDeleteName(""); setDeleteOpen(true); }} title="删除当前客户"><Trash2 size={17} /></button></div></label>
          <details className="new-customer"><summary><Plus size={16} />新建客户档案</summary><div className="form-grid"><label className="wide">单位名称<input value={newCustomer.name} onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })} placeholder="输入政企客户完整名称" /></label><label>所属行业<input value={newCustomer.industry} onChange={(event) => setNewCustomer({ ...newCustomer, industry: event.target.value })} placeholder="如：政务、制造" /></label><label>所在地区<input value={newCustomer.region} onChange={(event) => setNewCustomer({ ...newCustomer, region: event.target.value })} placeholder="省 / 市" /></label><button className="secondary wide" onClick={createCustomer} disabled={busy}>保存客户档案</button></div></details>
          <div className="divider" /><div className="panel-head compact"><div><span className="section-index">02</span><h2>输入沟通背景</h2></div></div>
          <label>前期沟通记录<textarea value={communication} onChange={(event) => setCommunication(event.target.value)} rows={8} placeholder="粘贴聊天记录、会议纪要或客户描述……" /></label>
          <div className="form-grid">{([
            ["拜访类型", "visit_type", visitType, setVisitType], ["客户角色", "customer_role", customerRole, setCustomerRole], ["表达风格", "style", style, setStyle],
          ] as const).map(([label, kind, value, setter], index) => <label className={index === 2 ? "wide" : ""} key={kind}><span className="label-with-action">{label}<button type="button" onClick={() => { setOptionKind(kind); setNewOption(""); }}><SlidersHorizontal size={13} />管理选项</button></span><select value={value} onChange={(event) => setter(event.target.value)}>{optionValues(kind).map((item) => <option key={item.id}>{item.label}</option>)}</select></label>)}</div>
          <div className="generation-actions"><button className="primary" onClick={runAll} disabled={busy || !selectedId || allConfirmed}>{busy ? <><LoaderCircle className="spin" size={18} />正在生成 {progress}%</> : allConfirmed ? <><Check size={18} />材料已确认，请在右侧导出</> : artifacts.length > 0 ? <><RefreshCw size={18} />重新生成全部材料</> : <><Sparkles size={18} />一键生成拜访材料</>}</button><button className="secondary research-only" onClick={runResearch} disabled={busy || !selectedId}><Search size={16} />仅生成客户摸底</button></div>
          {artifacts.length > 0 && !allConfirmed && <p className="regenerate-note">重新生成会创建新版本，并将全部材料恢复为待确认。</p>}{busy && <div className="progress"><span style={{ width: `${progress}%` }} /></div>}
        </section>
        <section className="results-panel">
          <div className="results-head"><div><p className="eyebrow">PREPARATION PACK</p><h2>{selected?.name || "尚未选择客户"}</h2></div><div className="export-actions"><button onClick={() => exportFile("docx")} disabled={!allConfirmed}><FileDown size={16} />Word</button><button onClick={() => exportFile("pdf")} disabled={!allConfirmed}><FileDown size={16} />PDF</button></div></div>
          <div className="step-strip">{artifactOrder.map((type, index) => { const item = artifacts.find((entry) => entry.type === type); return <div className={item?.confirmed ? "step done" : item ? "step ready" : "step"} key={type}><span>{item?.confirmed ? <Check className="step-check" size={14} strokeWidth={2.4} /> : index + 1}</span><small>{stepLabels[type]}</small>{index < 4 && <ChevronRight size={14} />}</div>; })}</div>
          {!artifacts.length ? <div className="empty-state"><div className="empty-orbit"><Search size={28} /></div><h3>从客户信息开始准备</h3><p>系统会依次完成客户摸底、需求拆解、能力匹配、方案与话术生成。</p></div> : <div className="artifact-list">{artifactOrder.map((type) => {
            const item = artifacts.find((entry) => entry.type === type); if (!item) return null; const editing = editingId === item.id;
            return <article className="artifact-card" key={item.id}><header><div><span className="artifact-number">{String(artifactOrder.indexOf(type) + 1).padStart(2, "0")}</span><h3>{stepLabels[type]}</h3><span className="version">V{item.version}</span></div><div className="artifact-actions"><button className="edit-button" onClick={() => setEditingId(editing ? "" : item.id)}>{editing ? <><X size={14} />取消</> : <><Edit3 size={14} />编辑</>}</button><button className={item.confirmed ? "confirmed" : "confirm"} disabled={editing} onClick={() => confirm(item)}>{item.confirmed ? <><Check size={15} />已确认</> : "确认本项"}</button></div></header>{editing ? <ArtifactEditor artifact={item} options={options} capabilityNames={capabilityNames} onCancel={() => setEditingId("")} onSave={(content) => saveEdit(item, content)} /> : <ArtifactRenderer artifact={item} onSource={setSource} onSave={(content) => saveEdit(item, content)} />}</article>;
          })}</div>}
          {!!artifacts.length && <div className="review-footer"><div className="review-meter"><span>{confirmedCount}/5 已确认</span><div><i style={{ width: `${confirmedCount * 20}%` }} /></div></div><p>{allConfirmed ? "全部材料已人工确认，可以导出正式文件。" : "可在各模块内编辑事实、能力边界和表达，再逐项确认。"}</p></div>}
        </section>
      </div>}
      {view === "knowledge" && <div className="single-view"><section className="library-summary"><div><p className="eyebrow">INTERNAL EVIDENCE</p><h2>上传公司正式资料</h2><p>只有知识库中有明确依据的产品、服务和案例，才会进入能力匹配结果。</p></div><label className="upload-button"><Upload size={18} />上传资料<input type="file" accept=".pdf,.docx,.pptx,.xlsx,.txt,.md" onChange={upload} hidden /></label></section><div className="document-grid">{knowledge.map((doc) => <article key={doc.id}><div className="doc-icon"><FileText size={22} /></div><div><h3>{doc.filename}</h3><p>{doc.category} · V{doc.version}</p></div><div className="doc-actions"><span>{doc.status === "ready" ? "可检索" : doc.status}</span><button type="button" onClick={() => void deleteKnowledge(doc)} disabled={busy} aria-label={`删除 ${doc.filename}`} title="删除资料"><Trash2 size={15} /></button></div></article>)}{!knowledge.length && <div className="library-empty"><BookOpen size={28} /><p>知识库尚为空，请上传移动产品、行业方案或案例资料。</p></div>}</div></div>}
      {view === "prompts" && <div className="single-view"><div className="prompt-intro"><p>提示词按任务独立管理。修改后将应用于后续生成，不会自动改写已有材料。</p></div><div className="prompt-list">{prompts.map((prompt) => <article key={prompt.id}><header><div><MessageSquareText size={19} /><h3>{stepLabels[prompt.task_type] || prompt.name}</h3></div><span>V{prompt.version} · {prompt.enabled ? "启用" : "停用"}</span></header><textarea value={prompt.content} onChange={(event) => setPrompts(prompts.map((item) => item.id === prompt.id ? { ...item, content: event.target.value } : item))} rows={4} /><button className="secondary" onClick={async () => { try { const updated = await api.updatePrompt(prompt.task_type, { name: prompt.name, content: prompt.content, version: prompt.version, enabled: prompt.enabled }); setPrompts(prompts.map((item) => item.id === updated.id ? updated : item)); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } }}><RefreshCw size={15} />保存当前版本</button></article>)}</div></div>}
    </section>
    {deleteOpen && selected && <div className="modal-mask"><div className="modal-card"><header><h3>彻底删除客户</h3><button onClick={() => setDeleteOpen(false)}><X size={18} /></button></header><p>将删除客户、五类成果、任务历史、导出记录及对应 Word/PDF 文件，此操作不可恢复。</p><label>输入完整客户名称确认<input autoFocus value={deleteName} onChange={(event) => setDeleteName(event.target.value)} placeholder={selected.name} /></label><div className="modal-actions"><button className="secondary" onClick={() => setDeleteOpen(false)}>取消</button><button className="danger-button" disabled={deleteName !== selected.name || busy} onClick={() => void deleteCustomer()}>确认彻底删除</button></div></div></div>}
    {optionKind && <div className="modal-mask"><div className="modal-card option-manager"><header><div><small>共享工作空间</small><h3>管理{optionLabels[optionKind]}</h3></div><button onClick={() => setOptionKind(null)}><X size={18} /></button></header><div className="option-create"><input value={newOption} maxLength={50} onChange={(event) => setNewOption(event.target.value)} placeholder="输入自定义选项" /><button className="confirm" disabled={!newOption.trim()} onClick={() => void addOption()}><Plus size={14} />添加</button></div><div className="option-list">{optionValues(optionKind).map((item) => <div key={item.id}><span>{item.label}</span>{item.is_builtin ? <small>默认项</small> : <button onClick={() => void removeOption(item)}><Trash2 size={14} />删除</button>}</div>)}</div></div></div>}
    <SourceDrawer source={source} onClose={() => setSource(null)} />
  </main>;
}
