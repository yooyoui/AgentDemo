export const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export type Customer = { id: string; name: string; industry: string; nature: string; region: string; notes: string; created_at: string };
export type Task = { id: string; status: "queued" | "running" | "completed" | "failed"; progress: number; error: string };
export type Artifact = { id: string; customer_id: string; type: "research" | "requirements" | "capabilities" | "solution" | "script"; title: string; content: Record<string, unknown>; citations: Array<Record<string, string>>; version: number; confirmed: boolean; updated_at: string };
export type Knowledge = { id: string; filename: string; category: string; version: string; status: string; created_at: string };
export type Prompt = { id: string; task_type: string; name: string; content: string; version: string; enabled: boolean; updated_at: string };
export type Health = { status: string; provider: "deepseek" | "demo"; model: string; model_status: "configured" | "demo"; research: string; research_model?: string };
export type ModelTest = { status: "ok" | "failed" | "demo"; provider: string; model: string; latency_ms: number | null; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "请求失败，请稍后重试");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<Health>("/health"),
  testModel: () => request<ModelTest>("/model/test", { method: "POST" }),
  customers: () => request<Customer[]>("/customers"),
  createCustomer: (body: Omit<Customer, "id" | "created_at">) => request<Customer>("/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  runResearch: (id: string) => request<Task>(`/customers/${id}/research`, { method: "POST" }),
  runAll: (id: string, body: object) => request<Task>(`/customers/${id}/run-all`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  task: (id: string) => request<Task>(`/tasks/${id}`),
  artifacts: (customerId: string) => request<Artifact[]>(`/artifacts?customer_id=${customerId}`),
  updateArtifact: (id: string, content: Record<string, unknown>) => request<Artifact>(`/artifacts/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }),
  confirmArtifact: (id: string) => request<Artifact>(`/artifacts/${id}/confirm`, { method: "POST" }),
  knowledge: () => request<Knowledge[]>("/knowledge"),
  uploadKnowledge: (form: FormData) => request<Knowledge>("/knowledge", { method: "POST", body: form }),
  deleteKnowledge: (id: string) => request<void>(`/knowledge/${id}`, { method: "DELETE" }),
  prompts: () => request<Prompt[]>("/prompts"),
  updatePrompt: (taskType: string, body: Omit<Prompt, "id" | "task_type" | "updated_at">) => request<Prompt>(`/prompts/${taskType}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
};
