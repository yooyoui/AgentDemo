export const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export type Customer = { id: string; name: string; industry: string; nature: string; region: string; notes: string; created_at: string };
export type Task = { id: string; status: "queued" | "running" | "completed" | "failed"; progress: number; error: string };
export type Artifact = { id: string; customer_id: string; type: "research" | "requirements" | "capabilities" | "solution" | "script"; title: string; content: Record<string, unknown>; citations: Array<Record<string, string>>; version: number; confirmed: boolean; updated_at: string };
export type Knowledge = { id: string; filename: string; category: string; version: string; status: string; created_at: string };
export type Prompt = { id: string; task_type: string; name: string; content: string; version: string; enabled: boolean; updated_at: string };
export type Health = { status: string; provider: "deepseek" | "demo"; model: string; model_status: "configured" | "demo"; research: string; research_model?: string; external_data_transmission: "enabled" | "blocked" };
export type ModelTest = { status: "ok" | "failed" | "demo"; provider: string; model: string; latency_ms: number | null; error: string };
export type WorkspaceOption = { id: string; kind: "visit_type" | "customer_role" | "style"; label: string; is_builtin: boolean; sort_order: number; created_at: string };
export type OrganizationEvidence = { title: string; url: string; excerpt: string; source_type: string };
export type OrganizationCandidate = { canonical_name: string; entity_type: string; region: string; industry: string; official_url: string | null; registration_code: string | null; evidence: OrganizationEvidence[]; score: number; confidence: "high" | "medium" | "low"; match_reasons: string[] };
export type OrganizationResolution = { candidates: OrganizationCandidate[]; cache_hit: boolean; auto_selected_index: number | null; searched_at: string };
export type OrganizationIdentity = { id: string; customer_id: string; entered_name: string; canonical_name: string; entity_type: string; region: string; industry: string; official_url: string | null; registration_code: string | null; verification_status: "verified" | "unverified"; evidence: OrganizationEvidence[]; confirmed_at: string };
export type CustomerSearchResult = { customer: Customer; score: number; match_reason: string; verification_status: string | null };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let message = "";
    try {
      const payload = raw ? JSON.parse(raw) as { detail?: unknown } : {};
      if (typeof payload.detail === "string") message = payload.detail;
      else if (Array.isArray(payload.detail)) message = payload.detail.map((item) => item && typeof item === "object" && "msg" in item ? String(item.msg) : String(item)).join("；");
    } catch { /* A proxy may return an HTML/plain-text error page. */ }
    throw new Error(message || `请求失败（HTTP ${response.status}），请稍后重试`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<Health>("/health"),
  testModel: () => request<ModelTest>("/model/test", { method: "POST" }),
  customers: () => request<Customer[]>("/customers"),
  searchCustomers: (query: string, signal?: AbortSignal) => request<CustomerSearchResult[]>(`/v1/customers/search?q=${encodeURIComponent(query)}&limit=3`, { signal }),
  createCustomer: (body: Omit<Customer, "id" | "created_at">) => request<Customer>("/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  deleteCustomer: (id: string, confirmationName: string) => request<void>(`/customers/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation_name: confirmationName }) }),
  workspaceOptions: () => request<WorkspaceOption[]>("/workspace-options"),
  createWorkspaceOption: (body: Pick<WorkspaceOption, "kind" | "label">) => request<WorkspaceOption>("/workspace-options", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  deleteWorkspaceOption: (id: string) => request<void>(`/workspace-options/${id}`, { method: "DELETE" }),
  resolveOrganization: (body: { name: string; region: string; industry: string }) => request<OrganizationResolution>("/v1/organization-identities/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  organizationIdentity: (customerId: string, signal?: AbortSignal) => request<OrganizationIdentity>(`/v1/customers/${customerId}/identity`, { signal }),
  confirmOrganizationIdentity: (customerId: string, body: { entered_name: string; candidate?: OrganizationCandidate; use_entered_name?: boolean }) => request<OrganizationIdentity>(`/v1/customers/${customerId}/identity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  runResearch: (id: string) => request<Task>(`/customers/${id}/research`, { method: "POST" }),
  runAll: (id: string, body: object) => request<Task>(`/customers/${id}/run-all`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  task: (id: string) => request<Task>(`/tasks/${id}`),
  artifacts: (customerId: string, signal?: AbortSignal) => request<Artifact[]>(`/artifacts?customer_id=${customerId}`, { signal }),
  updateArtifact: (id: string, content: Record<string, unknown>) => request<Artifact>(`/artifacts/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }),
  confirmArtifact: (id: string) => request<Artifact>(`/artifacts/${id}/confirm`, { method: "POST" }),
  knowledge: () => request<Knowledge[]>("/knowledge"),
  uploadKnowledge: (form: FormData) => request<Knowledge>("/knowledge", { method: "POST", body: form }),
  deleteKnowledge: (id: string) => request<void>(`/knowledge/${id}`, { method: "DELETE" }),
  prompts: () => request<Prompt[]>("/prompts"),
  updatePrompt: (taskType: string, body: Omit<Prompt, "id" | "task_type" | "updated_at">) => request<Prompt>(`/prompts/${taskType}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
};
