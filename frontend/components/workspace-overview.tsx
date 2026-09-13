"use client";

import { ArrowRight, CheckCircle2, Database, FileCheck2, Link2 } from "lucide-react";
import type { Artifact } from "@/lib/api";
import { findCapabilityCitation } from "@/components/artifacts";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asRecords = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.map(asRecord) : [];
const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];

function compact(items: string[], limit = 3) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

export function WorkspaceOverview({
  artifacts,
  confirmedCount,
  knowledgeCount,
}: {
  artifacts: Artifact[];
  confirmedCount: number;
  knowledgeCount: number;
}) {
  const research = artifacts.find((item) => item.type === "research");
  const requirements = artifacts.find((item) => item.type === "requirements");
  const capabilities = artifacts.find((item) => item.type === "capabilities");
  const solution = artifacts.find((item) => item.type === "solution");
  const facts = asRecords(research?.content?.["结构化档案"]);
  const completedFacts = facts.filter((fact) => {
    const value = String(fact.value || "").trim();
    return value && !["待补充", "待确认", "暂无"].includes(value);
  }).length;
  const profilePercent = facts.length ? Math.round(completedFacts / facts.length * 100) : 0;
  const matches = asRecords(capabilities?.content?.["匹配结果"]);
  const evidenceCount = capabilities
    ? matches.filter((item) => findCapabilityCitation(item, capabilities.citations).status === "matched").length
    : 0;
  const requirementItems = compact([
    ...asStrings(requirements?.content?.["显性需求"]),
    ...asStrings(requirements?.content?.["隐性痛点"]),
  ]);
  const capabilityItems = compact(matches.map((item) => String(item["能力"] || "")));
  const valueItems = compact(asStrings(solution?.content?.["预期价值"]));
  const hasJourney = requirementItems.length + capabilityItems.length + valueItems.length > 0;

  return <section className="workspace-overview" aria-labelledby="overview-title">
    <div className="overview-heading">
      <div><span className="section-index">概览</span><h2 id="overview-title">拜访准备态势</h2></div>
      <p>所有指标均由当前结构化成果实时计算</p>
    </div>
    <div className="metric-grid">
      <article className="metric-card metric-profile">
        <span className="metric-icon"><Database size={20} /></span>
        <div><small>客户档案完整度</small><strong>{profilePercent}%</strong><p>{completedFacts}/{facts.length || 10} 项已有内容</p></div>
        <div className="metric-track" aria-label={`客户档案完整度 ${profilePercent}%`}><i style={{ width: `${profilePercent}%` }} /></div>
      </article>
      <article className="metric-card metric-evidence">
        <span className="metric-icon"><Link2 size={20} /></span>
        <div><small>内部证据覆盖</small><strong>{matches.length ? `${evidenceCount}/${matches.length}` : "0"}</strong><p>能力建议可定位原文</p></div>
      </article>
      <article className="metric-card metric-review">
        <span className="metric-icon"><CheckCircle2 size={20} /></span>
        <div><small>人工确认进度</small><strong>{confirmedCount}/5</strong><p>{confirmedCount === 5 ? "可以导出正式材料" : `还有 ${5 - confirmedCount} 项待确认`}</p></div>
      </article>
      <article className="metric-card metric-knowledge">
        <span className="metric-icon"><FileCheck2 size={20} /></span>
        <div><small>知识库资料</small><strong>{knowledgeCount}</strong><p>份资料参与能力匹配</p></div>
      </article>
    </div>
    {hasJourney && <div className="value-journey" aria-label="需求到价值链路">
      {[
        { label: "客户需求与痛点", items: requirementItems, tone: "need" },
        { label: "匹配移动能力", items: capabilityItems, tone: "capability" },
        { label: "预期业务价值", items: valueItems, tone: "value" },
      ].map((group, index) => <div className="journey-segment" key={group.label}>
        <article className={`journey-card ${group.tone}`}>
          <small>{String(index + 1).padStart(2, "0")}</small><h3>{group.label}</h3>
          {group.items.length ? <ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>等待对应材料生成</p>}
        </article>
        {index < 2 && <ArrowRight className="journey-arrow" size={22} aria-hidden="true" />}
      </div>)}
    </div>}
  </section>;
}
