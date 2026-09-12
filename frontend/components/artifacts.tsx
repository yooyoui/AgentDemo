"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Plus, Trash2, X } from "lucide-react";
import type { Artifact, WorkspaceOption } from "@/lib/api";

export type SourceInfo = {
  title?: string;
  filename?: string;
  url?: string;
  source_type?: string;
  collected_at?: string;
  excerpt?: string;
  quote?: string;
  historical?: boolean;
  history?: Array<Record<string, unknown>>;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const records = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value) ? value.map(record) : [];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const text = (value: unknown, fallback = "待补充") => typeof value === "string" && value.trim() ? value : fallback;

function BulletList({ value }: { value: unknown }) {
  const items = strings(value);
  return items.length ? <ul className="clean-list">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="muted-copy">暂无内容</p>;
}

function SectionCard({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return <section className={wide ? "content-card span-all" : "content-card"}><h4>{title}</h4>{children}</section>;
}

function sourceFromFact(fact: Record<string, unknown>): SourceInfo | null {
  const active = records(fact.sources)[0];
  const history = records(fact.edit_history);
  if (active && Object.keys(active).length) return { ...active, history };
  if (typeof fact.source_url === "string" && fact.source_url) return { url: fact.source_url, title: text(fact.label, "公开来源"), history };
  if (history.length) {
    const old = records(history[history.length - 1]?.sources)[0];
    return { ...(old || {}), url: text(old?.url, text(history[history.length - 1]?.source_url, "")), historical: true, history };
  }
  return null;
}

function ResearchView({ artifact, onSource, onSave }: { artifact: Artifact; onSource: (source: SourceInfo) => void; onSave: (content: Record<string, unknown>) => Promise<void> }) {
  const content = record(artifact.content);
  const facts = records(content["结构化档案"]);
  const [editingFact, setEditingFact] = useState<number | null>(null);
  const [factValue, setFactValue] = useState("");
  const saveFact = async (index: number) => {
    const next = JSON.parse(JSON.stringify(artifact.content)) as Record<string, unknown>;
    records(next["结构化档案"])[index].value = factValue;
    await onSave(next);
    setEditingFact(null);
  };
  return <div className="artifact-content">
    <div className="identity-bar"><span>客户单位</span><strong>{text(content["客户"])}</strong></div>
    <div className="fact-grid">{facts.map((fact, index) => {
      const source = sourceFromFact(fact);
      return <section className="fact-card" key={text(fact.key, `fact-${index}`)}>
        <div className="fact-card-head"><h4>{text(fact.label, "信息项")}</h4><span className="confidence-badge">{text(fact.status, text(fact.confidence, "待确认"))}</span></div>
        {editingFact === index ? <div className="quick-fact-edit"><textarea autoFocus rows={3} value={factValue} onChange={(event) => setFactValue(event.target.value)} /><div><button onClick={() => setEditingFact(null)}>取消</button><button className="confirm" onClick={() => void saveFact(index)}>保存</button></div></div> : <>
          <p>{text(fact.value)}</p><div className="fact-links"><button className="text-action" onClick={() => { setFactValue(text(fact.value, "")); setEditingFact(index); }}>编辑本项</button>{source && <button className="text-action" onClick={() => onSource(source)}>{source.historical ? "查看修改记录" : "查看来源"}</button>}</div>
        </>}
      </section>;
    })}</div>
    <div className="section-grid">
      <SectionCard title="潜在信息化方向"><BulletList value={content["潜在信息化方向"]} /></SectionCard>
      <SectionCard title="待补充"><BulletList value={content["待补充"]} /></SectionCard>
      {content["冲突说明"] != null && strings(content["冲突说明"]).length > 0 && <SectionCard title="主体冲突说明" wide><BulletList value={content["冲突说明"]} /></SectionCard>}
    </div>
  </div>;
}

function RequirementsView({ artifact }: { artifact: Artifact }) {
  const content = record(artifact.content);
  return <div className="artifact-content section-grid">{["显性需求", "隐性痛点", "建设期望", "关注事项", "待确认问题", "原文依据"].map((key) =>
    <SectionCard title={key} key={key}><BulletList value={content[key]} /></SectionCard>)}</div>;
}

type CitationMatch = { citation?: Record<string, string>; status: "matched" | "ambiguous" | "missing" };

export function findCapabilityCitation(item: Record<string, unknown>, citations: Array<Record<string, string>>): CitationMatch {
  const quote = text(item["引用"], "");
  const documentId = text(item.document_id, "");
  if (!quote) return { status: "missing" };
  if (documentId) {
    const citation = citations.find((entry) => entry.document_id === documentId && entry.excerpt?.includes(quote));
    return citation ? { citation, status: "matched" } : { status: "missing" };
  }
  const exactMatches = citations.filter((entry) => entry.excerpt?.includes(quote));
  if (!exactMatches.length) return { status: "missing" };
  if (exactMatches.length === 1) return { citation: exactMatches[0], status: "matched" };
  const documentIds = new Set(exactMatches.map((entry) => entry.document_id).filter(Boolean));
  if (documentIds.size === 1 && exactMatches.every((entry) => Boolean(entry.document_id))) return { citation: exactMatches[0], status: "matched" };
  return { status: "ambiguous" };
}

function CapabilitiesView({ artifact, onSource }: { artifact: Artifact; onSource: (source: SourceInfo) => void }) {
  const content = record(artifact.content);
  const matches = records(content["匹配结果"]);
  return <div className="artifact-content">
    {matches.length ? <div className="capability-grid">{matches.map((item, index) => {
      const quote = text(item["引用"], "");
      const evidence = findCapabilityCitation(item, artifact.citations);
      const citation = evidence.citation;
      return <section className="capability-card" key={`${text(item["能力"])}-${index}`}>
        <div className="card-title-row"><h4>{text(item["能力"], "待确认能力")}</h4><span>{text(item["类别"], "未分类")}</span></div>
        <dl><dt>匹配理由</dt><dd>{text(item["匹配理由"])}</dd><dt>适用条件</dt><dd>{text(item["适用条件"])}</dd></dl>
        <blockquote>{text(item["引用"], "暂无可定位原文")}</blockquote>
        {citation ? <button className="text-action" onClick={() => onSource({ ...citation, quote })}>查看证据</button> : <p className="evidence-missing">{evidence.status === "ambiguous" ? "引用关联不明确，请重新生成能力匹配" : "引用原文已不存在或资料已删除"}</p>}
      </section>;
    })}</div> : <div className="empty-inline">{text(content["提示"], "当前没有可引用的内部能力依据。")}</div>}
  </div>;
}

function SolutionView({ artifact }: { artifact: Artifact }) {
  const content = record(artifact.content);
  return <div className="artifact-content section-grid">
    <SectionCard title="客户现状" wide><p>{text(content["客户现状"])}</p></SectionCard>
    {["建设目标", "方案组合", "建设思路", "预期价值", "风险边界"].map((key) => <SectionCard title={key} key={key}><BulletList value={content[key]} /></SectionCard>)}
  </div>;
}

function ScriptView({ artifact }: { artifact: Artifact }) {
  const content = record(artifact.content);
  const settings = record(content["拜访设置"]);
  const stages = records(content["阶段"]);
  return <div className="artifact-content">
    <div className="setting-chips">{["类型", "客户角色", "表达风格"].map((key) => <span key={key}><small>{key}</small>{text(settings[key])}</span>)}</div>
    <div className="stage-grid">{stages.map((stage, index) => <section className="stage-card" key={text(stage["名称"], String(index))}>
      <div className="stage-number">{String(index + 1).padStart(2, "0")}</div><h4>{text(stage["名称"], `阶段 ${index + 1}`)}</h4>
      <strong>目标</strong><p>{text(stage["目标"])}</p><strong>推荐表达</strong><p>{text(stage["推荐表达"])}</p>
      {strings(stage["问题"]).length > 0 && <><strong>建议问题</strong><BulletList value={stage["问题"]} /></>}
    </section>)}</div>
    <SectionCard title="风险与禁止承诺" wide><BulletList value={content["禁止承诺"]} /></SectionCard>
  </div>;
}

export function ArtifactRenderer({ artifact, onSource, onSave }: { artifact: Artifact; onSource: (source: SourceInfo) => void; onSave: (content: Record<string, unknown>) => Promise<void> }) {
  if (artifact.type === "research") return <ResearchView artifact={artifact} onSource={onSource} onSave={onSave} />;
  if (artifact.type === "requirements") return <RequirementsView artifact={artifact} />;
  if (artifact.type === "capabilities") return <CapabilitiesView artifact={artifact} onSource={onSource} />;
  if (artifact.type === "solution") return <SolutionView artifact={artifact} />;
  return <ScriptView artifact={artifact} />;
}

function ListEditor({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  return <fieldset className="list-editor"><legend>{label}</legend>{value.map((item, index) => <div className="edit-row" key={index}>
    <textarea rows={2} value={item} onChange={(event) => onChange(value.map((entry, i) => i === index ? event.target.value : entry))} />
    <button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))} aria-label={`删除${label}第${index + 1}项`}><Trash2 size={15} /></button>
  </div>)}<button type="button" className="add-row" onClick={() => onChange([...value, ""])}><Plus size={14} />添加一项</button></fieldset>;
}

export function ArtifactEditor({
  artifact, options, capabilityNames, onCancel, onSave,
}: {
  artifact: Artifact;
  options: WorkspaceOption[];
  capabilityNames: string[];
  onCancel: () => void;
  onSave: (content: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    const initial = JSON.parse(JSON.stringify(artifact.content)) as Record<string, unknown>;
    if (artifact.type === "solution") {
      initial["方案组合"] = strings(initial["方案组合"]).filter((item) => capabilityNames.includes(item));
    }
    return initial;
  });
  const mutate = (callback: (next: Record<string, unknown>) => void) => setDraft((current) => {
    const next = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    callback(next);
    return next;
  });
  const setList = (key: string, value: string[]) => mutate((next) => { next[key] = value; });
  const commonLists = artifact.type === "requirements" ? ["显性需求", "隐性痛点", "建设期望", "关注事项", "待确认问题", "原文依据"] : ["建设目标", "建设思路", "预期价值", "风险边界"];

  return <div className="structured-editor">
    {artifact.type === "research" && <>
      <div className="readonly-field"><span>客户单位（只读）</span><strong>{text(draft["客户"])}</strong></div>
      <div className="edit-fact-grid">{records(draft["结构化档案"]).map((fact, index) => <label key={text(fact.key, String(index))}>{text(fact.label)}
        <textarea rows={3} value={text(fact.value, "")} onChange={(event) => mutate((next) => { records(next["结构化档案"])[index].value = event.target.value; })} />
        <small>当前状态：{text(fact.status, text(fact.confidence))}</small>
      </label>)}</div>
      <div className="editor-grid"><ListEditor label="潜在信息化方向" value={strings(draft["潜在信息化方向"])} onChange={(value) => setList("潜在信息化方向", value)} /><ListEditor label="待补充" value={strings(draft["待补充"])} onChange={(value) => setList("待补充", value)} /></div>
    </>}
    {artifact.type === "requirements" && <div className="editor-grid">{commonLists.map((key) => <ListEditor key={key} label={key} value={strings(draft[key])} onChange={(value) => setList(key, value)} />)}</div>}
    {artifact.type === "capabilities" && <div className="editor-grid">{records(draft["匹配结果"]).map((item, index) => <section className="protected-editor" key={index}>
      <h4>{text(item["能力"])}</h4><p>{text(item["类别"])} · 名称、类别与证据只读</p>
      <label>匹配理由<textarea rows={4} value={text(item["匹配理由"], "")} onChange={(event) => mutate((next) => { records(next["匹配结果"])[index]["匹配理由"] = event.target.value; })} /></label>
      <label>适用条件<textarea rows={3} value={text(item["适用条件"], "")} onChange={(event) => mutate((next) => { records(next["匹配结果"])[index]["适用条件"] = event.target.value; })} /></label>
    </section>)}</div>}
    {artifact.type === "solution" && <>
      <label>客户现状<textarea rows={4} value={text(draft["客户现状"], "")} onChange={(event) => mutate((next) => { next["客户现状"] = event.target.value; })} /></label>
      <fieldset className="combination-editor"><legend>方案组合（仅可选已匹配能力）</legend>{capabilityNames.length ? capabilityNames.map((name) => <label key={name}><input type="checkbox" checked={strings(draft["方案组合"]).includes(name)} onChange={(event) => setList("方案组合", event.target.checked ? [...strings(draft["方案组合"]), name] : strings(draft["方案组合"]).filter((item) => item !== name))} />{name}</label>) : <p>暂无可选能力</p>}</fieldset>
      <div className="editor-grid">{commonLists.map((key) => <ListEditor key={key} label={key} value={strings(draft[key])} onChange={(value) => setList(key, value)} />)}</div>
    </>}
    {artifact.type === "script" && <>
      <div className="editor-grid">{([["类型", "visit_type"], ["客户角色", "customer_role"], ["表达风格", "style"]] as const).map(([label, kind]) => <label key={kind}>{label}<select value={text(record(draft["拜访设置"])[label], "")} onChange={(event) => mutate((next) => { record(next["拜访设置"])[label] = event.target.value; })}>{options.filter((item) => item.kind === kind).map((item) => <option key={item.id}>{item.label}</option>)}</select></label>)}</div>
      <div className="editor-grid">{records(draft["阶段"]).map((stage, index) => <section className="protected-editor" key={index}><h4>{text(stage["名称"])}</h4>
        <label>目标<textarea rows={2} value={text(stage["目标"], "")} onChange={(event) => mutate((next) => { records(next["阶段"])[index]["目标"] = event.target.value; })} /></label>
        <label>推荐表达<textarea rows={4} value={text(stage["推荐表达"], "")} onChange={(event) => mutate((next) => { records(next["阶段"])[index]["推荐表达"] = event.target.value; })} /></label>
        <ListEditor label="建议问题" value={strings(stage["问题"])} onChange={(value) => mutate((next) => { records(next["阶段"])[index]["问题"] = value; })} />
      </section>)}</div>
      <ListEditor label="风险与禁止承诺" value={strings(draft["禁止承诺"])} onChange={(value) => setList("禁止承诺", value)} />
    </>}
    <div className="inline-editor-actions"><p>保存后版本号递增，并恢复为待确认。</p><button type="button" className="secondary" onClick={onCancel}>取消</button><button type="button" className="confirm" onClick={() => void onSave(draft)}>保存修改</button></div>
  </div>;
}

function Highlight({ excerpt, quote }: { excerpt: string; quote?: string }) {
  if (!quote) return <>{excerpt}</>;
  const index = excerpt.indexOf(quote);
  if (index < 0) return <>{excerpt}</>;
  return <>{excerpt.slice(0, index)}<mark>{quote}</mark>{excerpt.slice(index + quote.length)}</>;
}

export function SourceDrawer({ source, onClose }: { source: SourceInfo | null; onClose: () => void }) {
  useEffect(() => {
    if (!source) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [source, onClose]);
  if (!source) return null;
  return <div className="drawer-mask" onMouseDown={onClose}><aside className="source-drawer" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><small>{source.source_type || (source.filename ? "内部资料" : "公开来源")}</small><h3>{source.title || source.filename || "来源详情"}</h3></div><button onClick={onClose} aria-label="关闭来源侧栏"><X size={19} /></button></header>
    {source.historical && <div className="history-warning">原始来源，不代表修改后值</div>}
    <dl className="source-meta">{source.filename && <><dt>文件名</dt><dd>{source.filename}</dd></>}{source.collected_at && <><dt>采集时间</dt><dd>{new Date(source.collected_at).toLocaleString("zh-CN")}</dd></>}</dl>
    {source.url && <a className="source-link" href={source.url} target="_blank" rel="noreferrer">打开原始网页<ExternalLink size={14} /></a>}
    <section><h4>原文片段</h4><blockquote><Highlight excerpt={source.excerpt || source.quote || "暂无可展示的原文片段"} quote={source.quote} /></blockquote></section>
    {!!source.history?.length && <section><h4>修改记录</h4>{source.history.map((item, index) => <div className="history-item" key={index}><strong>原值：{text(item.value)}</strong><p>原状态：{text(item.status, "待确认")}</p><small>{item.edited_at ? new Date(String(item.edited_at)).toLocaleString("zh-CN") : ""}</small></div>)}</section>}
  </aside></div>;
}
