"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { BookOpen, Check, ChevronRight, CircleAlert, FileDown, FileText, LayoutDashboard, LoaderCircle, MessageSquareText, Plus, RefreshCw, Search, Settings2, Sparkles, Trash2, Upload, Wifi, WifiOff } from "lucide-react";
import { API_URL, api, Artifact, Customer, Health, Knowledge, Prompt } from "@/lib/api";

type View = "workspace" | "knowledge" | "prompts";
const artifactOrder = ["research", "requirements", "capabilities", "solution", "script"];
const stepLabels: Record<string, string> = { research: "客户摸底", requirements: "需求拆解", capabilities: "能力匹配", solution: "初步方案", script: "拜访话术" };

function JsonView({ value, level = 0 }: { value: unknown; level?: number }) {
  if (Array.isArray(value)) return <div className="value-list">{value.map((item, index) => typeof item === "object" ? <div className="object-item" key={index}><JsonView value={item} level={level + 1} /></div> : <div className="list-item" key={index}><span className="dot" /><span>{String(item)}</span></div>)}</div>;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.label === "string" && "value" in record) {
      const sourceUrl = typeof record.source_url === "string" ? record.source_url : "";
      return <div className="fact-row"><div><h5>{record.label}</h5><p>{String(record.value ?? "待补充")}</p></div><div className="fact-meta">{(record.status != null || record.confidence != null) && <span className="confidence-badge">{String(record.status ?? record.confidence)}</span>}{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">查看来源</a>}</div></div>;
    }
    return <div className={level ? "nested-grid" : "result-grid"}>{Object.entries(record).map(([key, item]) => <section className="result-section" key={key}><h4>{key}</h4><JsonView value={item} level={level + 1} /></section>)}</div>;
  }
  return <p>{String(value ?? "")}</p>;
}

export default function Home() {
  const [view, setView] = useState<View>("workspace");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
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
  const [draftJson, setDraftJson] = useState("");
  const selected = customers.find((x) => x.id === selectedId);
  const confirmedCount = artifacts.filter((x) => x.confirmed).length;
  const allConfirmed = artifacts.length === 5 && confirmedCount === artifacts.length;

  const loadBase = async () => {
    try {
      const [cs, ks, ps, hs] = await Promise.all([api.customers(), api.knowledge(), api.prompts(), api.health()]);
      setCustomers(cs); setKnowledge(ks); setPrompts(ps); setHealth(hs);
      if (!selectedId && cs[0]) setSelectedId(cs[0].id);
    } catch (e) { setError(e instanceof Error ? e.message : "后端服务暂不可用"); }
  };

  useEffect(() => { void loadBase(); }, []);
  useEffect(() => { if (selectedId) api.artifacts(selectedId).then(setArtifacts).catch(() => setArtifacts([])); else setArtifacts([]); }, [selectedId]);
  useEffect(() => {
    const context = typeof document === "undefined" ? undefined : document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "start_visit_preparation",
      title: "发起拜访准备",
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

  const runAll = async () => {
    if (!selectedId) return setError("请先新建或选择客户");
    if (artifacts.length > 0 && !window.confirm("重新生成会创建新版本，并取消当前五项材料的确认状态。是否继续？")) return;
    setBusy(true); setError(""); setProgress(2);
    try {
      const task = await api.runAll(selectedId, { communication, visit_type: visitType, customer_role: customerRole, style });
      const timer = window.setInterval(async () => {
        try {
          const latest = await api.task(task.id); setProgress(latest.progress);
          if (latest.status === "completed" || latest.status === "failed") {
            window.clearInterval(timer); setBusy(false);
            if (latest.status === "failed") setError(latest.error || "生成失败");
            else setArtifacts(await api.artifacts(selectedId));
          }
        } catch { window.clearInterval(timer); setBusy(false); setError("无法获取任务进度"); }
      }, 900);
    } catch (e) { setBusy(false); setError(e instanceof Error ? e.message : "生成失败"); }
  };

  const runResearch = async () => {
    if (!selectedId) return setError("请先新建或选择客户");
    const existing = artifacts.find((item) => item.type === "research");
    if (existing && !window.confirm("重新联网摸底会创建新版本，并将客户摸底恢复为待确认。是否继续？")) return;
    setBusy(true); setError(""); setProgress(2);
    try {
      const task = await api.runResearch(selectedId);
      const timer = window.setInterval(async () => {
        try {
          const latest = await api.task(task.id); setProgress(latest.progress);
          if (latest.status === "completed" || latest.status === "failed") {
            window.clearInterval(timer); setBusy(false);
            if (latest.status === "failed") setError(latest.error || "客户摸底生成失败");
            else setArtifacts(await api.artifacts(selectedId));
          }
        } catch { window.clearInterval(timer); setBusy(false); setError("无法获取任务进度"); }
      }, 900);
    } catch (e) { setBusy(false); setError(e instanceof Error ? e.message : "客户摸底生成失败"); }
  };

  const confirm = async (artifact: Artifact) => {
    try { const updated = await api.confirmArtifact(artifact.id); setArtifacts(artifacts.map((x) => x.id === updated.id ? updated : x)); } catch (e) { setError(e instanceof Error ? e.message : "确认失败"); }
  };

  const saveEdit = async (artifact: Artifact) => {
    try {
      const content = JSON.parse(draftJson) as Record<string, unknown>;
      const updated = await api.updateArtifact(artifact.id, content);
      setArtifacts(artifacts.map((x) => x.id === updated.id ? updated : x));
      setEditingId(""); setDraftJson("");
    } catch (e) { setError(e instanceof SyntaxError ? "编辑内容不是有效的 JSON 格式" : e instanceof Error ? e.message : "保存失败"); }
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
    try {
      await api.deleteKnowledge(document.id);
      setKnowledge((items) => items.filter((item) => item.id !== document.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除知识库资料失败");
    } finally {
      setBusy(false);
    }
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
      <nav>
        <button className={view === "workspace" ? "active" : ""} onClick={() => setView("workspace")}><LayoutDashboard size={19} />拜访工作台</button>
        <button className={view === "knowledge" ? "active" : ""} onClick={() => setView("knowledge")}><BookOpen size={19} />能力知识库<span className="nav-count">{knowledge.length}</span></button>
        <button className={view === "prompts" ? "active" : ""} onClick={() => setView("prompts")}><Settings2 size={19} />提示词管理</button>
      </nav>
      <div className="sidebar-status"><span className={health ? "status-dot online" : "status-dot"} />{health ? <><span>服务已连接</span><small>{health.model === "demo-rules" ? "演示生成模式" : health.model}</small></> : <><span>等待后端服务</span><small>请启动 API</small></>}</div>
      <p className="security-note">单一共享工作空间<br />仅限受控网络使用</p>
    </aside>

    <section className="main-area">
      <header className="topbar"><div><p className="eyebrow">{view === "workspace" ? "VISIT PREPARATION" : view === "knowledge" ? "KNOWLEDGE CENTER" : "PROMPT STUDIO"}</p><h1>{view === "workspace" ? "拜访准备工作台" : view === "knowledge" ? "移动能力知识库" : "提示词管理"}</h1></div><div className="connection">{health ? <Wifi size={16} /> : <WifiOff size={16} />} {health ? <>{health.model_status === "configured" ? health.model : "大模型演示模式"} · {health.research === "deepseek-web" ? `公开检索 ${health.research_model || "已启用"}` : "公开检索演示模式"}</> : "等待服务"}</div></header>

      {error && <div className="error-banner"><CircleAlert size={18} /><span>{error}</span><button onClick={() => setError("")}>关闭</button></div>}

      {view === "workspace" && <div className="workspace">
        <section className="control-panel">
          <div className="panel-head"><div><span className="section-index">01</span><h2>选择客户</h2></div><span className="shared-badge">共享空间</span></div>
          <label>已有客户<select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}><option value="">请选择</option>{customers.map((x) => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
          <details className="new-customer"><summary><Plus size={16} />新建客户档案</summary><div className="form-grid"><label className="wide">单位名称<input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} placeholder="输入政企客户完整名称" /></label><label>所属行业<input value={newCustomer.industry} onChange={(e) => setNewCustomer({ ...newCustomer, industry: e.target.value })} placeholder="如：政务、制造" /></label><label>所在地区<input value={newCustomer.region} onChange={(e) => setNewCustomer({ ...newCustomer, region: e.target.value })} placeholder="省 / 市" /></label><button className="secondary wide" onClick={createCustomer} disabled={busy}>保存客户档案</button></div></details>
          <div className="divider" />
          <div className="panel-head compact"><div><span className="section-index">02</span><h2>输入沟通背景</h2></div></div>
          <label>前期沟通记录<textarea value={communication} onChange={(e) => setCommunication(e.target.value)} rows={8} placeholder="粘贴聊天记录、会议纪要或客户描述……" /></label>
          <div className="form-grid"><label>拜访类型<select value={visitType} onChange={(e) => setVisitType(e.target.value)}><option>首次拜访</option><option>方案沟通</option><option>高层拜访</option><option>项目跟进</option></select></label><label>客户角色<select value={customerRole} onChange={(e) => setCustomerRole(e.target.value)}><option>业务负责人</option><option>信息化负责人</option><option>单位领导</option><option>采购负责人</option></select></label><label className="wide">表达风格<select value={style} onChange={(e) => setStyle(e.target.value)}><option>专业务实</option><option>简洁直接</option><option>顾问式沟通</option></select></label></div>
          <div className="generation-actions"><button className="primary" onClick={runAll} disabled={busy || !selectedId || allConfirmed}>{busy ? <><LoaderCircle className="spin" size={18} />正在生成 {progress}%</> : allConfirmed ? <><Check size={18} />材料已确认，请在右侧导出</> : artifacts.length > 0 ? <><RefreshCw size={18} />重新生成全部材料</> : <><Sparkles size={18} />一键生成拜访材料</>}</button><button className="secondary research-only" onClick={runResearch} disabled={busy || !selectedId}><Search size={16} />仅生成客户摸底</button></div>
          {artifacts.length > 0 && !allConfirmed && <p className="regenerate-note">重新生成会创建新版本，并将全部材料恢复为待确认。</p>}
          {busy && <div className="progress"><span style={{ width: `${progress}%` }} /></div>}
        </section>

        <section className="results-panel">
          <div className="results-head"><div><p className="eyebrow">PREPARATION PACK</p><h2>{selected?.name || "尚未选择客户"}</h2></div><div className="export-actions"><button onClick={() => exportFile("docx")} disabled={!allConfirmed}><FileDown size={16} />Word</button><button onClick={() => exportFile("pdf")} disabled={!allConfirmed}><FileDown size={16} />PDF</button></div></div>
          <div className="step-strip">{artifactOrder.map((type, index) => { const item = artifacts.find((x) => x.type === type); const stateClass = item?.confirmed ? "step done" : item ? "step ready" : "step"; return <div className={stateClass} key={type}><span>{item?.confirmed ? <Check className="step-check" size={14} strokeWidth={2.4} /> : index + 1}</span><small>{stepLabels[type]}</small>{index < 4 && <ChevronRight size={14} />}</div>; })}</div>
          {!artifacts.length ? <div className="empty-state"><div className="empty-orbit"><Search size={28} /></div><h3>从客户信息开始准备</h3><p>系统会依次完成客户摸底、需求拆解、能力匹配、方案与话术生成。</p></div> : <div className="artifact-list">{artifactOrder.map((type) => { const item = artifacts.find((x) => x.type === type); if (!item) return null; return <article className="artifact-card" key={item.id}><header><div><span className="artifact-number">{String(artifactOrder.indexOf(type) + 1).padStart(2, "0")}</span><h3>{stepLabels[type]}</h3><span className="version">V{item.version}</span></div><button className={item.confirmed ? "confirmed" : "confirm"} onClick={() => confirm(item)}>{item.confirmed ? <><Check size={15} />已确认</> : "确认本项"}</button></header><JsonView value={item.content} />{item.citations.length > 0 && <details className="citations"><summary>查看 {item.citations.length} 条引用来源</summary>{item.citations.map((c, i) => <a href={c.url || "#"} target="_blank" rel="noreferrer" key={i}>{c.title || c.filename || "内部资料"}</a>)}</details>}</article>; })}</div>}
          {!!artifacts.length && <div className="manual-editor"><div className="manual-editor-head"><div><p className="eyebrow">MANUAL REVIEW</p><h3>人工修改结构化材料</h3></div><select value={editingId} onChange={(e) => { const item = artifacts.find((x) => x.id === e.target.value); setEditingId(e.target.value); setDraftJson(item ? JSON.stringify(item.content, null, 2) : ""); }}><option value="">选择要修改的材料</option>{artifacts.map((item) => <option key={item.id} value={item.id}>{stepLabels[item.type]} · V{item.version}</option>)}</select></div>{editingId && <><textarea value={draftJson} onChange={(e) => setDraftJson(e.target.value)} rows={13} aria-label="编辑结构化材料" /><div className="editor-actions"><p>保存后版本号递增，并需要重新人工确认。</p><button className="confirm" onClick={() => { const item = artifacts.find((x) => x.id === editingId); if (item) void saveEdit(item); }}>保存修改</button></div></>}</div>}
          {!!artifacts.length && <div className="review-footer"><div className="review-meter"><span>{confirmedCount}/5 已确认</span><div><i style={{ width: `${confirmedCount * 20}%` }} /></div></div><p>{allConfirmed ? "全部材料已人工确认，可以导出正式文件。" : "逐项核对事实、能力边界和表达后确认。"}</p></div>}
        </section>
      </div>}

      {view === "knowledge" && <div className="single-view"><section className="library-summary"><div><p className="eyebrow">INTERNAL EVIDENCE</p><h2>上传公司正式资料</h2><p>只有知识库中有明确依据的产品、服务和案例，才会进入能力匹配结果。</p></div><label className="upload-button"><Upload size={18} />上传资料<input type="file" accept=".pdf,.docx,.pptx,.xlsx,.txt,.md" onChange={upload} hidden /></label></section><div className="document-grid">{knowledge.map((doc) => <article key={doc.id}><div className="doc-icon"><FileText size={22} /></div><div><h3>{doc.filename}</h3><p>{doc.category} · V{doc.version}</p></div><div className="doc-actions"><span>{doc.status === "ready" ? "可检索" : doc.status}</span><button type="button" onClick={() => void deleteKnowledge(doc)} disabled={busy} aria-label={`删除 ${doc.filename}`} title="删除资料"><Trash2 size={15} /></button></div></article>)}{!knowledge.length && <div className="library-empty"><BookOpen size={28} /><p>知识库尚为空，请上传移动产品、行业方案或案例资料。</p></div>}</div></div>}

      {view === "prompts" && <div className="single-view"><div className="prompt-intro"><p>提示词按任务独立管理。修改后将应用于后续生成，不会自动改写已有材料。</p></div><div className="prompt-list">{prompts.map((prompt) => <article key={prompt.id}><header><div><MessageSquareText size={19} /><h3>{stepLabels[prompt.task_type] || prompt.name}</h3></div><span>V{prompt.version} · {prompt.enabled ? "启用" : "停用"}</span></header><textarea value={prompt.content} onChange={(e) => setPrompts(prompts.map((p) => p.id === prompt.id ? { ...p, content: e.target.value } : p))} rows={4} /><button className="secondary" onClick={async () => { try { const updated = await api.updatePrompt(prompt.task_type, { name: prompt.name, content: prompt.content, version: prompt.version, enabled: prompt.enabled }); setPrompts(prompts.map((p) => p.id === updated.id ? updated : p)); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } }}><RefreshCw size={15} />保存当前版本</button></article>)}</div></div>}
    </section>
  </main>;
}
