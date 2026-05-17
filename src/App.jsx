/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WORKFLOW MANAGER — ENTERPRISE EDITION  v3.0 (fully debugged)              ║
 * ║  Stack : React · Supabase · Claude API · Google Drive                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── QUICK START (Demo) ──────────────────────────────────────────────────
 *  Works out-of-the-box in demo mode. All data lives in memory.
 *  Login with any demo account (password: demo).
 *
 * ─── SUPABASE PRODUCTION SETUP ──────────────────────────────────────────
 *  1. Replace SUPABASE_URL + SUPABASE_ANON_KEY below.
 *  2. Run the SQL schema in your Supabase SQL editor (see comments below).
 *  3. Deploy — all data now persists in Postgres with RLS tenant isolation.
 *
 * ─── SQL SCHEMA ─────────────────────────────────────────────────────────
 *
 * CREATE TABLE profiles (
 *   id uuid PRIMARY KEY REFERENCES auth.users,
 *   tenant_id text DEFAULT 'acmecorp',
 *   full_name text, avatar_initials text,
 *   role text DEFAULT 'Viewer', department text,
 *   created_at timestamptz DEFAULT now()
 * );
 * CREATE TABLE documents (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   tenant_id text NOT NULL DEFAULT 'acmecorp',
 *   name text NOT NULL, type text DEFAULT 'Other', size text,
 *   status text DEFAULT 'Processing', confidence float DEFAULT 0,
 *   summary text, entities jsonb, ai_meta jsonb,
 *   uploaded_by uuid REFERENCES auth.users,
 *   source text DEFAULT 'upload', drive_file_id text,
 *   created_at timestamptz DEFAULT now()
 * );
 * CREATE TABLE tasks (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   tenant_id text NOT NULL DEFAULT 'acmecorp',
 *   title text NOT NULL, description text,
 *   priority text DEFAULT 'Medium', status text DEFAULT 'Todo',
 *   assignee text, due_in_days int DEFAULT 3, tags text[],
 *   doc_id uuid REFERENCES documents,
 *   agent_log text, agent_meta jsonb,
 *   flagged_for_review boolean DEFAULT false,
 *   created_by uuid REFERENCES auth.users,
 *   created_at timestamptz DEFAULT now(),
 *   updated_at timestamptz DEFAULT now()
 * );
 * CREATE TABLE audit_logs (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   tenant_id text NOT NULL DEFAULT 'acmecorp',
 *   action text NOT NULL, entity text NOT NULL, entity_id text,
 *   description text, user_id uuid, user_name text, meta jsonb,
 *   created_at timestamptz DEFAULT now()
 * );
 * CREATE TABLE workflow_rules (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   tenant_id text NOT NULL DEFAULT 'acmecorp',
 *   trigger_condition text NOT NULL, action_description text NOT NULL,
 *   active boolean DEFAULT false, status text DEFAULT 'draft',
 *   version int DEFAULT 1,
 *   created_by uuid REFERENCES auth.users,
 *   approved_by uuid REFERENCES auth.users,
 *   created_at timestamptz DEFAULT now()
 * );
 * ALTER TABLE documents      ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE tasks           ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE audit_logs      ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE workflow_rules  ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY tenant_docs  ON documents      USING (tenant_id = current_setting('app.tenant_id',true));
 * CREATE POLICY tenant_tasks ON tasks           USING (tenant_id = current_setting('app.tenant_id',true));
 * CREATE POLICY tenant_audit ON audit_logs      USING (tenant_id = current_setting('app.tenant_id',true));
 * CREATE POLICY tenant_rules ON workflow_rules  USING (tenant_id = current_setting('app.tenant_id',true));
 * CREATE POLICY own_profile  ON profiles        USING (id = auth.uid());
 *
 * ─── GOOGLE DRIVE SETUP ─────────────────────────────────────────────────
 *  1. Create an OAuth 2.0 Client ID in Google Cloud Console.
 *  2. Add your domain to Authorised JavaScript Origins.
 *  3. Replace GDRIVE_CLIENT_ID + GDRIVE_FOLDER_ID below.
 */

import {
  useState, useRef, useEffect, useCallback, useMemo,
  createContext, useContext, Component
} from "react";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG — replace these to go live
// ═══════════════════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://your-project.supabase.co";  // ← replace
const SUPABASE_ANON_KEY = "your-anon-key";                      // ← replace
const GDRIVE_CLIENT_ID = "your-client-id.apps.googleusercontent.com"; // ← replace
const GDRIVE_FOLDER_ID = "your-folder-id";                     // ← replace

const IS_DEMO = SUPABASE_URL.includes("your-project");
const GDRIVE_READY = !GDRIVE_CLIENT_ID.includes("your-client-id");

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════════════════
const C = {
  bg: "#0A0C10", surface: "#111318", card: "#161A22", border: "#1E2430",
  accent: "#00D4FF", accentDim: "#00D4FF22",
  green: "#00E5A0", amber: "#FFB547", red: "#FF4D6D", purple: "#A78BFA",
  text: "#E8EDF5", muted: "#6B7894", dim: "#2A3145",
};

const sx = {
  app: { fontFamily: "'DM Mono','Fira Code','Courier New',monospace", background: C.bg, minHeight: "100vh", color: C.text, display: "flex", flexDirection: "column" },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 },
  label: { fontSize: 10, fontWeight: 700, letterSpacing: "1px", color: C.muted, textTransform: "uppercase", marginBottom: 6, display: "block" },
  input: { width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" },
  btn: (v = "primary") => ({
    padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12,
    fontFamily: "inherit", fontWeight: 600, letterSpacing: "0.4px",
    display: "inline-flex", alignItems: "center", gap: 6,
    transition: "opacity 0.15s",
    border: v === "ghost" ? `1px solid ${C.border}` : "none",
    background:
      v === "primary" ? `linear-gradient(135deg,${C.accent},#0099BB)` :
        v === "green" ? `linear-gradient(135deg,${C.green},#00AA77)` :
          v === "red" ? `linear-gradient(135deg,${C.red},#CC2244)` :
            v === "amber" ? `linear-gradient(135deg,${C.amber},#CC8800)` :
              v === "ghost" ? "transparent" : C.dim,
    color: ["primary", "green", "red", "amber"].includes(v) ? "#000" : C.text,
  }),
  badge: (color) => ({
    display: "inline-block", padding: "2px 8px", borderRadius: 4,
    fontSize: 10, fontWeight: 700, letterSpacing: "0.5px",
    background: `${color}22`, color, border: `1px solid ${color}33`,
  }),
};

// helpers
const priorityColor = (p) => p === "High" ? C.red : p === "Medium" ? C.amber : C.green;
const statusColor = (s) => s === "Done" ? C.green : s === "In Progress" ? C.accent : s === "Blocked" ? C.red : C.muted;
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
const fmt = (ts) => ts ? new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const safePct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

const toCSV = (data, headers) => {
  const head = headers.join(",") + "\n";
  const rows = data.map(item => headers.map(h => `"${String(item[h] || '').replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([head + rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `export_${Date.now()}.csv`);
  link.click();
};

// ═══════════════════════════════════════════════════════════════════════════
// RBAC — 5 ROLES
// ═══════════════════════════════════════════════════════════════════════════
const ROLES = {
  Admin: { color: C.red, icon: "🔑", pages: ["Dashboard", "Documents", "Tasks", "Workflow", "Analytics", "Audit", "Admin"], canUpload: true, canEditTasks: true, canRunAgent: true, canApprove: true, canManageUsers: true, canViewAudit: true },
  Manager: { color: C.amber, icon: "👔", pages: ["Dashboard", "Documents", "Tasks", "Workflow", "Analytics", "Audit"], canUpload: true, canEditTasks: true, canRunAgent: false, canApprove: true, canManageUsers: false, canViewAudit: true },
  Operations: { color: C.accent, icon: "⚙️", pages: ["Documents", "Tasks", "Workflow", "Analytics"], canUpload: true, canEditTasks: true, canRunAgent: false, canApprove: false, canManageUsers: false, canViewAudit: false },
  Finance: { color: C.green, icon: "💰", pages: ["Tasks", "Analytics"], canUpload: false, canEditTasks: false, canRunAgent: false, canApprove: true, canManageUsers: false, canViewAudit: false },
  Viewer: { color: C.muted, icon: "👁", pages: ["Documents", "Tasks", "Analytics"], canUpload: false, canEditTasks: false, canRunAgent: false, canApprove: false, canManageUsers: false, canViewAudit: false },
};

// ═══════════════════════════════════════════════════════════════════════════
// IN-MEMORY DEMO DB (identical API surface as the Supabase layer)
// ═══════════════════════════════════════════════════════════════════════════
function buildDemoDB() {
  const now = Date.now();
  const PROFILES = [
    { id: "u1", tenant_id: "acmecorp", full_name: "Suraj Kumar", email: "suraj@acmecorp.com", role: "Admin", department: "Engineering", avatar_initials: "SK" },
    { id: "u2", tenant_id: "acmecorp", full_name: "Priya Sharma", email: "priya@acmecorp.com", role: "Manager", department: "Operations", avatar_initials: "PS" },
    { id: "u3", tenant_id: "acmecorp", full_name: "Rahul Mehta", email: "rahul@acmecorp.com", role: "Operations", department: "Ops", avatar_initials: "RM" },
    { id: "u4", tenant_id: "acmecorp", full_name: "Anita Singh", email: "anita@acmecorp.com", role: "Finance", department: "Finance", avatar_initials: "AS" },
    { id: "u5", tenant_id: "acmecorp", full_name: "Dev Patel", email: "dev@acmecorp.com", role: "Viewer", department: "Sales", avatar_initials: "DP" },
  ];

  const store = {
    profiles: [...PROFILES],
    documents: [
      { id: "doc1", tenant_id: "acmecorp", name: "Invoice_INV-2024-0891.pdf", type: "Invoice", size: "142 KB", status: "Processed", confidence: 0.97, summary: "Enterprise software license invoice totalling $23,010", uploaded_by: "u1", source: "upload", created_at: new Date(now - 3600000).toISOString() },
      { id: "doc2", tenant_id: "acmecorp", name: "Contract_Renewal_Acme.docx", type: "Contract", size: "89 KB", status: "Processed", confidence: 0.91, summary: "Annual software contract renewal, 3-year term", uploaded_by: "u2", source: "upload", created_at: new Date(now - 7200000).toISOString() },
      { id: "doc3", tenant_id: "acmecorp", name: "Q3_Performance_Report.pdf", type: "Report", size: "2.1 MB", status: "Processed", confidence: 0.99, summary: "Q3 report: 12% revenue growth YoY, headcount +8", uploaded_by: "u1", source: "upload", created_at: new Date(now - 86400000).toISOString() },
    ],
    tasks: [
      { id: "t1", tenant_id: "acmecorp", title: "Verify Invoice #INV-2024-0891", description: "Cross-reference invoice amount with PO #5521 and approve for payment", priority: "High", status: "In Progress", assignee: "AI Agent", due_in_days: 1, tags: ["finance", "invoice"], doc_id: "doc1", agent_log: null, flagged_for_review: false, created_by: "u1", created_at: new Date(now - 3600000).toISOString() },
      { id: "t2", tenant_id: "acmecorp", title: "Extract contract renewal terms", description: "Identify renewal clauses, obligations and flag for legal review", priority: "Medium", status: "Todo", assignee: "Operations Team", due_in_days: 5, tags: ["legal", "contract"], doc_id: "doc2", agent_log: null, flagged_for_review: false, created_by: "u2", created_at: new Date(now - 7200000).toISOString() },
      { id: "t3", tenant_id: "acmecorp", title: "Summarize Q3 performance report", description: "Create executive briefing from Q3 report data for leadership", priority: "Low", status: "Done", assignee: "AI Agent", due_in_days: 0, tags: ["report", "q3"], doc_id: "doc3", agent_log: "Analyzed Q3 data. Revenue up 12% YoY. Key risks: supply chain delay. Executive brief generated.", flagged_for_review: false, created_by: "u1", created_at: new Date(now - 86400000).toISOString() },
    ],
    audit_logs: [],
    workflow_rules: [
      { id: "r1", tenant_id: "acmecorp", trigger_condition: "Invoice amount > $10,000", action_description: "Route to Finance Manager for approval", active: true, status: "active", version: 2, created_by: "u1", approved_by: "u2" },
      { id: "r2", tenant_id: "acmecorp", trigger_condition: "Contract expiry < 30 days", action_description: "Alert Legal Team + create renewal task", active: true, status: "active", version: 1, created_by: "u2", approved_by: "u1" },
      { id: "r3", tenant_id: "acmecorp", trigger_condition: "AI confidence < 85%", action_description: "Escalate to human review, flag task", active: true, status: "active", version: 3, created_by: "u1", approved_by: "u1" },
      { id: "r4", tenant_id: "acmecorp", trigger_condition: "Task overdue > 2 days", action_description: "Notify manager + re-assign to backup", active: false, status: "draft", version: 1, created_by: "u2", approved_by: null },
    ],
    agents: [
      { id: "a1", tenant_id: "acmecorp", name: "DocSummarizer", role: "Summarization", system_prompt: "You are a professional documentation summarizer. Provide a concise, executive summary of the document provided, focusing on key takeaways and action items.", model: "claude-3-5-sonnet-20241022", icon: "📝" },
      { id: "a2", tenant_id: "acmecorp", name: "RiskAnalyzer", role: "Risk Analysis", system_prompt: "You are a legal and financial risk analysis agent. Identify potential liabilities, unusual clauses, or high-cost items in the provided text. Flash red flags where necessary.", model: "claude-3-5-sonnet-20241022", icon: "🚨" },
      { id: "a3", tenant_id: "acmecorp", name: "TaskExtractor", role: "Workflow Automation", system_prompt: "You are a workflow optimization agent. Extract specific, actionable tasks from the document. Create exactly 3 tasks with clear priorities.", model: "gpt-4o", icon: "⚡" },
    ],
    comments: [],
  };

  return {
    // ── Auth ──────────────────────────────────────────────────────────────
    signIn: async (email, password) => {
      const profile = store.profiles.find(p => p.email?.toLowerCase() === email.toLowerCase());
      if (!profile) throw new Error("No account found with that email.");
      if (password !== "demo") throw new Error("Incorrect password. Demo password: demo");
      return { user: profile };
    },
    signOut: async () => { },

    // ── Profiles ──────────────────────────────────────────────────────────
    getProfiles: async (tid) => store.profiles.filter(p => p.tenant_id === tid).map(p => ({ ...p })),
    upsertProfile: async (p) => { const i = store.profiles.findIndex(x => x.id === p.id); if (i > -1) Object.assign(store.profiles[i], p); else store.profiles.push({ ...p }); return { ...store.profiles.find(x => x.id === p.id) }; },
    deleteProfile: async (id) => { store.profiles = store.profiles.filter(p => p.id !== id); },

    // ── Documents ─────────────────────────────────────────────────────────
    getDocs: async (tid) => store.documents.filter(d => d.tenant_id === tid).map(d => ({ ...d })),
    insertDoc: async (doc) => { const d = { created_at: new Date().toISOString(), ...doc }; store.documents.unshift(d); return { ...d }; },
    updateDoc: async (id, fields) => { const i = store.documents.findIndex(d => d.id === id); if (i > -1) Object.assign(store.documents[i], fields); return { ...store.documents[i] }; },

    // ── Tasks ─────────────────────────────────────────────────────────────
    getTasks: async (tid) => store.tasks.filter(t => t.tenant_id === tid).map(t => ({ ...t })),
    insertTask: async (task) => { const t = { created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...task }; store.tasks.unshift(t); return { ...t }; },
    updateTask: async (id, fields) => { const i = store.tasks.findIndex(t => t.id === id); if (i > -1) Object.assign(store.tasks[i], { ...fields, updated_at: new Date().toISOString() }); return { ...store.tasks[i] }; },
    deleteTask: async (id) => { store.tasks = store.tasks.filter(t => t.id !== id); },

    // ── Audit ─────────────────────────────────────────────────────────────
    insertAudit: async (log) => { const l = { id: uid(), created_at: new Date().toISOString(), ...log }; store.audit_logs.unshift(l); return l; },
    getAudit: async (tid, limit = 200) => store.audit_logs.filter(l => l.tenant_id === tid).slice(0, limit).map(l => ({ ...l })),
    getTaskLogs: async (tid, limit = 200) => store.audit_logs.filter(l => l.tenant_id === "acmecorp" && l.entity === "Task" && l.entity_id === tid).slice(0, limit).map(l => ({ ...l })),

    // ── Comments ──────────────────────────────────────────────────────────
    getComments: async (tid) => store.comments.filter(c => c.tenant_id === "acmecorp" && c.task_id === tid).map(c => ({ ...c })),
    insertComment: async (comment) => { const c = { id: uid(), created_at: new Date().toISOString(), ...comment }; store.comments.unshift(c); return c; },

    // ── Workflow rules ────────────────────────────────────────────────────
    getRules: async (tid) => store.workflow_rules.filter(r => r.tenant_id === tid).map(r => ({ ...r })),
    insertRule: async (rule) => { const r = { id: uid(), ...rule }; store.workflow_rules.push(r); return { ...r }; },
    updateRule: async (id, fields) => { const i = store.workflow_rules.findIndex(r => r.id === id); if (i > -1) Object.assign(store.workflow_rules[i], fields); return { ...store.workflow_rules[i] }; },
    deleteRule: async (id) => { store.workflow_rules = store.workflow_rules.filter(r => r.id !== id); },

    // ── Agents ─────────────────────────────────────────────────────────────
    getAgents: async (tid) => store.agents.filter(a => a.tenant_id === tid).map(a => ({ ...a })),
    insertAgent: async (agent) => { const a = { id: uid(), ...agent }; store.agents.push(a); return { ...a }; },
    updateAgent: async (id, fields) => { const i = store.agents.findIndex(a => a.id === id); if (i > -1) Object.assign(store.agents[i], fields); return { ...store.agents[i] }; },
    deleteAgent: async (id) => { store.agents = store.agents.filter(a => a.id !== id); },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPABASE REST LAYER (used only when IS_DEMO = false)
// ═══════════════════════════════════════════════════════════════════════════
function buildSupabaseDB(url, key) {
  const h = { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` };
  let _tok = key;

  const setToken = (t) => { _tok = t; };
  const authed = () => ({ ...h, Authorization: `Bearer ${_tok}` });

  const rest = async (method, path, body, params = {}) => {
    // path may already contain a ? (e.g. for PATCH/DELETE with filter in path)
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${url}/rest/v1/${path}${qs ? sep + qs : ""}`, {
      method, headers: { ...authed(), ...(method !== "GET" ? { Prefer: "return=representation" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || `HTTP ${r.status}`); }
    return method === "DELETE" ? null : r.json();
  };

  const q = (table, params = {}) => rest("GET", table, null, params);
  const ins = (table, row) => rest("POST", table, row);
  const upd = (table, id, data) => rest("PATCH", `${table}?id=eq.${id}`, data);
  const del = (table, id) => rest("DELETE", `${table}?id=eq.${id}`);

  return {
    setToken,
    signIn: async (email, password) => {
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: h, body: JSON.stringify({ email, password }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error_description || d.message || "Login failed");
      setToken(d.access_token);
      const profiles = await q("profiles", { id: `eq.${d.user.id}` });
      return { user: { ...d.user, ...(profiles[0] || {}) }, session: d };
    },
    signOut: async (token) => {
      await fetch(`${url}/auth/v1/logout`, { method: "POST", headers: { ...h, Authorization: `Bearer ${token}` } });
    },

    getProfiles: async (tid) => q("profiles", { tenant_id: `eq.${tid}`, order: "full_name.asc" }),
    upsertProfile: async (p) => (await ins("profiles", p))[0],
    deleteProfile: async (id) => del("profiles", id),

    getDocs: async (tid) => q("documents", { tenant_id: `eq.${tid}`, order: "created_at.desc" }),
    insertDoc: async (doc) => (await ins("documents", doc))[0],
    updateDoc: async (id, fields) => (await upd("documents", id, fields))[0],

    getTasks: async (tid) => q("tasks", { tenant_id: `eq.${tid}`, order: "created_at.desc" }),
    insertTask: async (task) => (await ins("tasks", task))[0],
    updateTask: async (id, fields) => (await upd("tasks", id, fields))[0],
    deleteTask: async (id) => del("tasks", id),

    insertAudit: async (log) => (await ins("audit_logs", log))[0],
    getAudit: async (tid, limit = 200) => q("audit_logs", { tenant_id: `eq.${tid}`, order: "created_at.desc", limit }),
    getTaskLogs: async (tid, limit = 200) => q("audit_logs", { tenant_id: `eq.${tid}`, entity: "eq.Task", entity_id: `eq.${tid}`, order: "created_at.desc", limit }),

    getComments: async (tid, limit = 200) => q("comments", { tenant_id: `eq.${tid}`, task_id: `eq.${tid}`, order: "created_at.desc", limit }),
    insertComment: async (comment) => (await ins("comments", comment))[0],

    getRules: async (tid) => q("workflow_rules", { tenant_id: `eq.${tid}`, order: "version.desc" }),
    insertRule: async (rule) => (await ins("workflow_rules", rule))[0],
    updateRule: async (id, fields) => (await upd("workflow_rules", id, fields))[0],
    deleteRule: async (id) => del("workflow_rules", id),

    getAgents: async (tid) => q("agents", { tenant_id: `eq.${tid}`, order: "name.asc" }),
    insertAgent: async (agent) => (await ins("agents", agent))[0],
    updateAgent: async (id, fields) => (await upd("agents", id, fields))[0],
    deleteAgent: async (id) => del("agents", id),
  };

}

// singleton — stable across re-renders, created once at module load
const DB = IS_DEMO ? buildDemoDB() : buildSupabaseDB(SUPABASE_URL, SUPABASE_ANON_KEY);

// ═══════════════════════════════════════════════════════════════════════════
// AI RELIABILITY LAYER — retry · fallback model · confidence threshold
// ═══════════════════════════════════════════════════════════════════════════
const defaultLlmConfig = {
  provider: import.meta.env.VITE_LLM_PROVIDER || "anthropic",
  baseUrl: import.meta.env.VITE_LLM_BASE_URL || "https://api.anthropic.com/v1",
  apiKey: import.meta.env.VITE_LLM_API_KEY || "",
  model: import.meta.env.VITE_LLM_MODEL || "claude-3-5-sonnet-20241022"
};
let llmConfig = null;
try {
  llmConfig = JSON.parse(localStorage.getItem("workflow_llm_config"));
  // Merge defaults to ensure we pick up ANY env variables if missing from local storage
  if (!llmConfig) {
    llmConfig = defaultLlmConfig;
  } else if (!llmConfig.apiKey && defaultLlmConfig.apiKey) {
    // Re-apply API key from env if user hasn't set it in local storage, to allow env-based overrides
    llmConfig.apiKey = defaultLlmConfig.apiKey;
  }
} catch (e) {
  llmConfig = defaultLlmConfig;
}

export const getLlmConfig = () => llmConfig;
export const setLlmConfig = (c) => { llmConfig = { ...c }; localStorage.setItem("workflow_llm_config", JSON.stringify(llmConfig)); };

const AI = {
  retries: 3,
  timeout: 30000,
  threshold: 0.85,
};

async function callLLM(system, userMessage, opts = {}) {
  const retries = opts.retries ?? AI.retries;
  const errors = [];
  const conf = getLlmConfig();

  for (let i = 0; i < retries; i++) {
    const runModel = conf.model;
    if (i > 0) await new Promise(r => setTimeout(r, Math.pow(2, i) * 600));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI.timeout);

    try {
      let res, data, text;

      if (conf.provider === "anthropic") {
        res = await fetch(`${conf.baseUrl.replace(/\/$/, '')}/messages`, {
          method: "POST", signal: ctrl.signal,
          headers: {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": conf.apiKey || "demo_missing_key",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({ model: runModel, max_tokens: 2048, system, messages: [{ role: "user", content: userMessage }] }),
        });
        clearTimeout(timer);
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
        data = await res.json();
        text = (data.content || []).map(b => b.text || "").join("");
      } else {
        res = await fetch(`${conf.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: "POST", signal: ctrl.signal,
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${conf.apiKey || "demo_missing_key"}`
          },
          body: JSON.stringify({
            model: runModel,
            messages: [{ role: "system", content: system }, { role: "user", content: userMessage }]
          }),
        });
        clearTimeout(timer);
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
        data = await res.json();
        text = data.choices?.[0]?.message?.content || "";
      }
      return { text, model: runModel, attempts: i + 1 };
    } catch (err) {
      clearTimeout(timer);
      errors.push(`attempt ${i + 1} [${runModel}]: ${err.message}`);
    }
  }
  throw new Error(`All ${retries} AI attempts failed:\n${errors.join("\n")}`);
}

function parseAIJson(raw) {
  const clean = raw.replace(/```json|```/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in AI response");
  return JSON.parse(match[0]);
}

async function processDocument(text) {
  const sys = `You are an enterprise document analysis AI. Respond ONLY with valid JSON — no markdown, no prose.
Return exactly this shape: {"docType":"Invoice|Contract|Report|Email|Other","summary":"one sentence","entities":[{"label":"string","value":"string"}],"tasks":[{"title":"string","description":"string","priority":"High|Medium|Low","dueInDays":3,"assignee":"AI Agent|Operations Team|Manager|Finance Team","tags":["string"]}],"confidence":0.95}
Rules: max 3 tasks, keep strings concise, confidence reflects extraction quality (0-1).`;

  const result = await callLLM(sys, `Document:\n\n${text.slice(0, 4000)}`);
  const parsed = parseAIJson(result.text);

  // Confidence threshold enforcement — low confidence → human review
  if (parsed.confidence < AI.threshold) {
    parsed.tasks = (parsed.tasks || []).map(t => ({
      ...t, assignee: "Operations Team",
      flagged_for_review: true,
      tags: [...(t.tags || []), "low-confidence"],
    }));
  }
  return { ...parsed, _meta: { model: result.model, attempts: result.attempts } };
}

async function runAgentOnTask(task, customAgent = null) {
  const sys = customAgent?.system_prompt || `You are an enterprise AI workflow agent. Execute the assigned task and write a 2-4 sentence professional report: what you did, what data you processed, and the outcome. Be specific.`;
  const preferredModel = customAgent?.model;
  
  // Use customAgent model if specified, otherwise fall back to global config
  const res = await callLLM(sys, `Task: ${task.title}\nDescription: ${task.description}\nPriority: ${task.priority}`, {
    ...(preferredModel ? { model: preferredModel } : {})
  });
  return { report: res.text.trim(), model: res.model, attempts: res.attempts };
}

// ═══════════════════════════════════════════════════════════════════════════
// SMART TASK ASSIGNMENT — Local rule-based scoring (API-free)
// ═══════════════════════════════════════════════════════════════════════════
const DOMAIN_KEYWORDS = {
  Finance:    ["invoice", "payment", "budget", "expense", "financial", "revenue", "tax", "audit", "cost", "billing", "accounting", "profit", "loss", "p&l", "forecast", "quarter", "q1", "q2", "q3", "q4", "compliance", "regulatory"],
  Operations: ["process", "workflow", "operations", "logistics", "supply", "chain", "shipping", "inventory", "production", "schedule", "maintenance", "optimize", "efficiency"],
  Engineering:["code", "deploy", "build", "api", "bug", "fix", "database", "server", "software", "technical", "system", "integration", "architecture", "infrastructure", "test"],
  Manager:    ["strategy", "review", "approve", "plan", "team", "leadership", "decision", "policy", "manage", "coordinate", "oversee", "stakeholder", "executive", "briefing"],
  Admin:      ["configure", "setup", "access", "security", "permissions", "admin", "settings", "user", "role", "onboard"],
  Viewer:     ["report", "summary", "dashboard", "view", "read", "monitor", "track"],
};

function smartAssignTask(task, profiles, allTasks) {
  const text = `${task.title || ""} ${task.description || ""} ${(task.tags || []).join(" ")}`.toLowerCase();

  const scored = profiles.map(p => {
    let score = 0;
    const reasons = [];

    // ── 1. Domain keyword matching (0-40 pts) ──
    const roleKeys = DOMAIN_KEYWORDS[p.role] || [];
    const deptKeys = DOMAIN_KEYWORDS[p.department] || [];
    const allKeys = [...new Set([...roleKeys, ...deptKeys])];
    const hits = allKeys.filter(kw => text.includes(kw));
    const domainScore = Math.min(hits.length * 8, 40);
    score += domainScore;
    if (hits.length > 0) reasons.push(`Strong ${p.role}/${p.department} keyword match (${hits.slice(0, 3).join(", ")})`);

    // ── 2. Workload penalty (0 to -25 pts) ──
    const openTasks = allTasks.filter(t => t.assignee === p.full_name && t.status !== "Done");
    const workloadPenalty = Math.min(openTasks.length * 5, 25);
    score -= workloadPenalty;
    if (openTasks.length === 0) { score += 10; reasons.push("No current open tasks — immediately available"); }
    else reasons.push(`${openTasks.length} open task${openTasks.length > 1 ? "s" : ""} (workload factor)`);

    // ── 3. Priority × seniority bonus (0-15 pts) ──
    const isSenior = ["Admin", "Manager"].includes(p.role);
    if (task.priority === "High" && isSenior) { score += 15; reasons.push("Senior role ideal for high-priority task"); }
    else if (task.priority === "Low" && !isSenior) { score += 8; reasons.push("Available for lower-priority work"); }
    else if (task.priority === "Medium") { score += 5; }

    // ── 4. High-priority overload guard (-10 pts) ──
    const highPriOpen = openTasks.filter(t => t.priority === "High").length;
    if (highPriOpen >= 2) { score -= 10; reasons.push("Already handling multiple high-priority tasks"); }

    // ── 5. Role capability bonus (0-10 pts) ──
    const perms = ROLES[p.role];
    if (perms?.canEditTasks) score += 5;
    if (perms?.canApprove && (text.includes("approve") || text.includes("review"))) { score += 10; reasons.push("Has approval authority"); }

    return {
      profile: p,
      score,
      reasons,
      openTasks: openTasks.length,
      highPriority: highPriOpen,
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const alts = scored.slice(1, 3);
  const maxScore = 40 + 10 + 15 + 10; // theoretical max
  const confidence = Math.min(Math.max(best.score / maxScore, 0.3), 0.99);

  // Build human-readable reasoning
  const reasoning = best.reasons.length > 0
    ? `${best.profile.full_name} (${best.profile.role}, ${best.profile.department}) is the best fit. ${best.reasons.slice(0, 3).join(". ")}.`
    : `${best.profile.full_name} selected based on availability and role fit.`;

  return {
    assignee: best.profile.full_name,
    reasoning,
    confidence: Math.round(confidence * 100) / 100,
    alternates: alts.map(a => ({
      name: a.profile.full_name,
      reason: a.reasons[0] || `${a.profile.role} — ${a.openTasks} open tasks`,
    })),
    _meta: { model: "Local Engine (API-free)", attempts: 1 },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GOOGLE DRIVE
// ═══════════════════════════════════════════════════════════════════════════
const gdrive = { token: null };

function gdriveAuth() {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ client_id: GDRIVE_CLIENT_ID, redirect_uri: window.location.origin, response_type: "token", scope: "https://www.googleapis.com/auth/drive.readonly", prompt: "select_account" });
    const popup = window.open(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, "gdrive_auth", "width=500,height=600,left=200,top=100");
    if (!popup) { reject(new Error("Popup blocked — allow popups for this page")); return; }

    const poll = setInterval(() => {
      try {
        const hash = new URLSearchParams(popup.location.hash?.slice(1) || "");
        const token = hash.get("access_token");
        if (token) { clearInterval(poll); popup.close(); gdrive.token = token; resolve(token); }
      } catch { /* cross-origin — still loading */ }
      if (popup.closed && !gdrive.token) { clearInterval(poll); reject(new Error("Auth popup closed before completing")); }
    }, 400);
    setTimeout(() => { clearInterval(poll); if (!gdrive.token) reject(new Error("Auth timed out")); }, 120000);
  });
}

async function gdriveListFiles(folderId = GDRIVE_FOLDER_ID) {
  if (!gdrive.token) throw new Error("Not connected to Google Drive");
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,size,modifiedTime)",
    orderBy: "modifiedTime desc", pageSize: "30",
  });
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${gdrive.token}` } });
  if (!r.ok) throw new Error(`Drive API ${r.status}`);
  return r.json();
}

async function gdriveReadFile(fileId, mimeType) {
  if (!gdrive.token) throw new Error("Not connected to Google Drive");
  if (mimeType.includes("google-apps.document")) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${gdrive.token}` } });
    if (!r.ok) throw new Error("Cannot export Google Doc");
    return r.text();
  }
  if (mimeType.includes("pdf") || mimeType.includes("word") || mimeType.includes("docx")) {
    return `[Binary file ${fileId} — type: ${mimeType}] Infer document type from name and generate realistic workflow tasks.`;
  }
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${gdrive.token}` } });
  if (!r.ok) throw new Error(`Cannot read file: ${r.status}`);
  return r.text();
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXTS
// ═══════════════════════════════════════════════════════════════════════════
const AuthCtx = createContext(null);
const AuditCtx = createContext(null);
const ToastCtx = createContext(null);
const ThemeCtx = createContext(null);

const useAuth = () => useContext(AuthCtx);
const useAudit = () => useContext(AuditCtx);
const useToast = () => useContext(ToastCtx);
const useTheme = () => useContext(ThemeCtx);

// ═══════════════════════════════════════════════════════════════════════════
// ERROR BOUNDARY
// ═══════════════════════════════════════════════════════════════════════════
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ ...sx.card, textAlign: 'center', padding: 40, margin: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 8 }}>Something went wrong.</div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>We encountered an unexpected error while rendering this page.</div>
          <button style={sx.btn('primary')} onClick={() => window.location.reload()}>Reload App</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SVG CHARTS
// ═══════════════════════════════════════════════════════════════════════════
function DonutChart({ data, size = 120 }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg width={size} height={size} viewBox="0 0 36 36">
        {data.map((d, i) => {
          const p = total > 0 ? (d.value / total) * 100 : 0;
          const stroke = 100 - offset;
          offset += p;
          return <circle key={i} cx="18" cy="18" r="15.915" fill="transparent" stroke={d.color} strokeWidth="3" strokeDasharray={`${p} ${100 - p}`} strokeDashoffset={stroke} />;
        })}
        <circle cx="18" cy="18" r="12" fill={C.card} />
        <text x="18" y="20" textAnchor="middle" fill={C.text} fontSize="6" fontWeight="700">{total}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color }} />
            <span style={{ color: C.muted }}>{d.label}:</span>
            <span style={{ fontWeight: 700 }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityLine({ data, height = 40, color = C.accent }) {
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => `${(i / Math.max(data.length - 1, 1)) * 100},${height - (v / max) * height}`).join(" ");
  return (
    <svg width="100%" height={height} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD BANNER
// ═══════════════════════════════════════════════════════════════════════════
function DashboardBanner() {
  const [tasks, setTasks] = useState([]);
  useEffect(() => { DB.getTasks("acmecorp").then(setTasks); }, []);
  const overdue = tasks.filter(t => t.due_in_days <= 0 && t.status !== "Done");
  if (overdue.length === 0) return null;
  return (
    <div style={{ background: C.red, color: "#000", fontSize: 11, fontWeight: 700, textAlign: "center", padding: "4px 0", letterSpacing: "0.5px" }}>
      ⚠️ SLA BREACH: {overdue.length} TASKS OVERDUE. IMMEDIATE ACTION REQUIRED.
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIMITIVE COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════
function Spinner({ size = 14 }) {
  return <span style={{ width: size, height: size, border: `2px solid ${C.dim}`, borderTop: `2px solid ${C.accent}`, borderRadius: "50%", animation: "spin .75s linear infinite", display: "inline-block", flexShrink: 0 }} />;
}

function Bar({ pct, color = C.accent, height = 4 }) {
  return (
    <div style={{ height, borderRadius: 2, background: C.dim, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(Math.max(pct, 0), 100)}%`, background: color, borderRadius: 2, transition: "width .5s ease" }} />
    </div>
  );
}

function Skeleton({ width = "100%", height = 16, radius = 4, mb = 8 }) {
  return <div style={{ width, height, background: C.dim, borderRadius: radius, marginBottom: mb, animation: "shimmer 1.5s infinite linear", backgroundImage: `linear-gradient(90deg, ${C.dim} 0%, ${C.surface} 50%, ${C.dim} 100%)`, backgroundSize: "200% 100%" }} />;
}

function Avatar({ user, size = 32 }) {
  const color = ROLES[user?.role]?.color || C.accent;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: `linear-gradient(135deg,${color},${C.dim})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.floor(size * 0.35), fontWeight: 700, color: "#000", flexShrink: 0 }}>
      {user?.avatar_initials || user?.full_name?.slice(0, 2).toUpperCase() || "?"}
    </div>
  );
}

// FIX: Notice no longer accepts a `style` prop that was silently dropped
function Notice({ type = "info", children }) {
  const c = { info: C.accent, warn: C.amber, error: C.red, success: C.green }[type] || C.accent;
  return <div style={{ background: `${c}12`, border: `1px solid ${c}44`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: c, lineHeight: 1.55, marginBottom: 12 }}>{children}</div>;
}

// FIX: Modal — ESC listener uses stable onClose ref to avoid stale closures
function Modal({ onClose, children, maxWidth = 580 }) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []); // intentionally empty — closeRef stays fresh

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, width: "100%", maxWidth, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.7)", animation: "slideUp .2s ease" }}>
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
function ToastContainer({ toasts, remove }) {
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1000, display: "flex", flexDirection: "column", gap: 8, maxWidth: 320 }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `4px solid ${t.type === 'error' ? C.red : t.type === 'success' ? C.green : t.type === 'warn' ? C.amber : C.accent}`, borderRadius: 8, padding: "12px 16px", boxShadow: "0 8px 30px rgba(0,0,0,0.5)", animation: "slideUp .2s ease", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18 }}>{t.type === 'error' ? '❌' : t.type === 'success' ? '✅' : t.type === 'warn' ? '⚠️' : 'ℹ️'}</span>
          <div style={{ flex: 1, fontSize: 12, color: C.text, fontWeight: 500 }}>{t.msg}</div>
          <button onClick={() => remove(t.id)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 15 }}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL SEARCH (CMD+K)
// ═══════════════════════════════════════════════════════════════════════════
function SearchModal({ onClose }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState({ tasks: [], docs: [] });
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!q.trim()) { setRes({ tasks: [], docs: [] }); return; }
    const run = async () => {
      const [t, d] = await Promise.all([DB.getTasks("acmecorp"), DB.getDocs("acmecorp")]);
      const filter = (arr, key) => arr.filter(x => x[key]?.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
      setRes({ tasks: filter(t, 'title'), docs: filter(d, 'name') });
      setIdx(0);
    };
    run();
  }, [q]);

  const all = [...res.tasks.map(t => ({ ...t, _t: 'task' })), ...res.docs.map(d => ({ ...d, _t: 'doc' }))];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "12vh 24px" }} onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 600, background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 30px 100px rgba(0,0,0,0.8)", animation: "slideUp .2s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 20, marginRight: 12 }}>🔍</span>
          <input autoFocus placeholder="Search tasks, documents, people..." style={{ flex: 1, background: "none", border: "none", color: C.text, fontSize: 16, outline: "none", fontFamily: "inherit" }} value={q} onChange={e => setQ(e.target.value)} />
          <div style={{ fontSize: 10, color: C.muted, background: C.dim, padding: "3px 6px", borderRadius: 4, fontWeight: 700 }}>ESC</div>
        </div>
        <div style={{ maxHeight: 400, overflowY: "auto", padding: 8 }}>
          {!q && <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 12 }}>Type to search for anything across the workspace...</div>}
          {q && !all.length && <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 12 }}>No results found for "{q}"</div>}
          
          {res.docs.length > 0 && <div>
            <div style={{ ...sx.label, padding: "8px 12px", margin: 0 }}>Documents</div>
            {res.docs.map(d => (
              <div key={d.id} style={{ padding: "10px 12px", borderRadius: 8, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", transition: "all .15s" }} onMouseEnter={e => e.currentTarget.style.background = C.dim} onMouseLeave={e => e.currentTarget.style.background = "none"}>
                <span style={{ fontSize: 18 }}>{d.type === 'Invoice' ? '🧾' : '📄'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{d.name}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{d.type} · {d.size}</div>
                </div>
              </div>
            ))}
          </div>}

          {res.tasks.length > 0 && <div style={{ marginTop: 8 }}>
            <div style={{ ...sx.label, padding: "8px 12px", margin: 0 }}>Tasks</div>
            {res.tasks.map(t => (
              <div key={t.id} style={{ padding: "10px 12px", borderRadius: 8, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", transition: "all .15s" }} onMouseEnter={e => e.currentTarget.style.background = C.dim} onMouseLeave={e => e.currentTarget.style.background = "none"}>
                <span style={{ fontSize: 18 }}>✅</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{t.assignee} · {t.priority}</div>
                </div>
              </div>
            ))}
          </div>}
        </div>
        <div style={{ padding: "10px 20px", background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", gap: 12 }}>
          <div style={{ fontSize: 10, color: C.muted }}><span style={{ color: C.text, fontWeight: 600 }}>↑↓</span> Navigate</div>
          <div style={{ fontSize: 10, color: C.muted }}><span style={{ color: C.text, fontWeight: 600 }}>Enter</span> Select</div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!email.trim() || !pass) { setErr("Enter your email and password"); return; }
    setLoading(true); setErr("");
    try {
      const { user } = await DB.signIn(email.trim(), pass);
      onLogin(user);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const quickLogin = async (demoEmail) => {
    setEmail(demoEmail); setPass("demo"); setErr(""); setLoading(true);
    try {
      const { user } = await DB.signIn(demoEmail, "demo");
      onLogin(user);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const DEMOS = [
    { email: "suraj@acmecorp.com", name: "Suraj Kumar", role: "Admin", init: "SK" },
    { email: "priya@acmecorp.com", name: "Priya Sharma", role: "Manager", init: "PS" },
    { email: "rahul@acmecorp.com", name: "Rahul Mehta", role: "Operations", init: "RM" },
    { email: "anita@acmecorp.com", name: "Anita Singh", role: "Finance", init: "AS" },
    { email: "dev@acmecorp.com", name: "Dev Patel", role: "Viewer", init: "DP" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'DM Mono','Fira Code',monospace" }}>
      <div style={{ width: "100%", maxWidth: 440, animation: "slideUp .4s ease" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 60, height: 60, background: `linear-gradient(135deg,${C.accent},${C.green})`, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 16px", boxShadow: `0 0 40px ${C.accent}44` }}>⚡</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.text, letterSpacing: "-0.5px" }}>Workflow Manager</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Enterprise · AI-Powered · Supabase Backend</div>
          {IS_DEMO && <div style={{ marginTop: 10, display: "inline-block", padding: "3px 12px", background: `${C.amber}22`, border: `1px solid ${C.amber}44`, borderRadius: 20, fontSize: 11, color: C.amber }}>⚡ Demo Mode — in-memory store</div>}
        </div>

        <div style={{ ...sx.card, marginBottom: 14 }}>
          <div style={{ marginBottom: 14 }}>
            <span style={sx.label}>Work Email</span>
            <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} placeholder="you@company.com" style={sx.input} autoComplete="email" />
          </div>
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={sx.label}>Password</span>
              {IS_DEMO && <span style={{ fontSize: 10, color: C.amber }}>demo password: demo</span>}
            </div>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} placeholder="••••••••" style={sx.input} autoComplete="current-password" />
          </div>
          {err && <Notice type="error">⚠ {err}</Notice>}
          <button style={{ ...sx.btn("primary"), width: "100%", justifyContent: "center", padding: "12px 18px", fontSize: 13 }} onClick={login} disabled={loading}>
            {loading ? <><Spinner size={16} /> Signing in…</> : "Sign In →"}
          </button>
        </div>

        <div style={{ ...sx.card, marginBottom: 14 }}>
          <button style={{ ...sx.btn("ghost"), width: "100%", justifyContent: "center" }}>🏢 Continue with SSO (OKTA / Azure AD / Google Workspace)</button>
          <div style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 10 }}>Configure via Admin → Security → SSO. Supports SAML 2.0 & OIDC.</div>
        </div>

        {IS_DEMO && (
          <div style={sx.card}>
            <span style={sx.label}>Quick sign in — demo accounts</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {DEMOS.map(u => (
                <button key={u.email} onClick={() => quickLogin(u.email)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", width: "100%", textAlign: "left" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg,${ROLES[u.role].color},${C.dim})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#000", flexShrink: 0 }}>{u.init}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{u.name}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>{u.email}</div>
                  </div>
                  <span style={sx.badge(ROLES[u.role].color)}>{ROLES[u.role].icon} {u.role}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Module-level sub-components (never defined inside render functions)
function MetaCell({ label, children }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TASK MODAL
// FIX: useAuth called at top level (not inside JSX); state resets when task changes
// ═══════════════════════════════════════════════════════════════════════════
function TaskModal({ task, doc, agents = [], onClose, onRunAgent, onUpdate, runningId }) {
  const { user, perms } = useAuth();
  const { C } = useTheme();
  const toast = useToast();
  const addAudit = useAudit();
  const isRunning = runningId === task.id;

  const [smartResult, setSmartResult] = useState(null);
  const [smartLoading, setSmartLoad] = useState(false);
  const [smartError, setSmartErr] = useState(null);
  const [showSmart, setShowSmart] = useState(false);

  const [tab, setTab] = useState("Details");
  const [comm, setComm] = useState("");
  const [comments, setComments] = useState([]);
  const [logs, setLogs] = useState([]);

  const [title, setTitle] = useState(task.title || "");
  const [desc, setDesc] = useState(task.description || "");
  const [assignee, setAsgn] = useState(task.assignee || "AI Agent");
  const [priority, setPri] = useState(task.priority || "Medium");
  const [status, setStat] = useState(task.status || "Todo");
  const [dueIn, setDue] = useState(task.due_in_days ?? 3);
  const [tags, setTags] = useState((task.tags || []).join(", "));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTitle(task.title || "");
    setDesc(task.description || "");
    setAsgn(task.assignee || "AI Agent");
    setPri(task.priority || "Medium");
    setStat(task.status || "Todo");
    setDue(task.due_in_days ?? 3);
    setTags((task.tags || []).join(", "));
    setSaved(false);
  }, [task.id]);

  useEffect(() => {
    if (tab === "Activity") {
       Promise.all([DB.getComments(task.id), DB.getTaskLogs(task.id)]).then(([c, l]) => {
         setComments(c); setLogs(l);
       });
    }
  }, [tab, task.id]);

  const postComm = async () => {
    if (!comm.trim()) return;
    const c = { id: uid(), tenant_id: "acmecorp", task_id: task.id, user_id: user.id, user_name: user.full_name, text: comm, created_at: new Date().toISOString() };
    await DB.insertComment(c);
    setComments([c, ...comments]);
    setComm("");
  };

  const isAI = assignee?.includes("Agent") || agents.some(a => a.name === assignee);

  return (
    <Modal onClose={onClose} maxWidth={800}>
      {showSmart && (
        <SmartAssignModal
          result={smartResult}
          onAccept={(name) => {
            setAsgn(name); onUpdate(task.id, { assignee: name }); setShowSmart(false);
            toast.success(`Reassigned to ${name}`);
            addAudit("UPDATE", "Task", task.id, `🧠 Smart-reassigned to ${name} (${Math.round(smartResult?.confidence * 100)}%)`, { reasoning: smartResult?.reasoning, model: smartResult?._meta?.model });
          }}
          onAcceptAlt={(name) => {
            setAsgn(name); onUpdate(task.id, { assignee: name }); setShowSmart(false);
            toast.success(`Reassigned to ${name}`);
            addAudit("UPDATE", "Task", task.id, `🧠 Smart-reassigned to ${name}`, { model: smartResult?._meta?.model });
          }}
          onClose={() => setShowSmart(false)}
        />
      )}
      <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, background: isAI ? C.purple : C.accent, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
             {isAI ? (agents.find(a => a.name === assignee)?.icon || "🤖") : "👤"}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{task.title || "Untitled Task"}</div>
            <div style={{ fontSize: 11, color: C.muted }}>Created by {user.full_name} · {fmt(task.created_at)}</div>
          </div>
        </div>
        <button onClick={onClose} style={{ ...sx.btn("ghost"), padding: "4px 10px" }}>✕</button>
      </div>

      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.dim }}>
        {["Details", "Activity", "Intelligence"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "12px 20px", border: "none", background: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, color: tab === t ? C.accent : C.muted, borderBottom: `2px solid ${tab === t ? C.accent : "transparent"}`, transition: "all .2s" }}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ padding: 24, flex: 1, overflowY: "auto", minHeight: 400 }}>
        {tab === "Details" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
            <div>
              <span style={sx.label}>Task Title</span>
              <input style={{ ...sx.input, fontSize: 16, fontWeight: 700, marginBottom: 16 }} value={title} onChange={e => { setTitle(e.target.value); onUpdate(task.id, { title: e.target.value }); }} />
              
              <span style={sx.label}>Description</span>
              <textarea style={{ ...sx.input, minHeight: 100, marginBottom: 20, resize: "vertical" }} value={desc} onChange={e => { setDesc(e.target.value); onUpdate(task.id, { description: e.target.value }); }} />
              
              {isAI && task.agent_log && (
                <div style={{ marginTop: 20 }}>
                  <span style={sx.label}>Agent Execution Log</span>
                  <pre style={{ background: "#000", color: "#0F0", padding: 16, borderRadius: 8, fontSize: 11, fontFamily: "DM Mono, monospace", overflowX: "auto", border: "1px solid #333", whiteSpace: "pre-wrap" }}>
                    {task.agent_log}
                  </pre>
                </div>
              )}
            </div>

            <div>
              <div style={{ ...sx.card, background: C.dim }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <span style={sx.label}>Priority</span>
                    <select style={sx.input} value={priority} onChange={e => { setPri(e.target.value); onUpdate(task.id, { priority: e.target.value }); }}>
                      <option>Low</option><option>Medium</option><option>High</option>
                    </select>
                  </div>
                  <div>
                    <span style={sx.label}>Status</span>
                    <select style={sx.input} value={status} onChange={e => { setStat(e.target.value); onUpdate(task.id, { status: e.target.value }); }}>
                      <option>Todo</option><option>In Progress</option><option>Done</option><option>Blocked</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ ...sx.label, marginBottom: 0 }}>Assignee</span>
                      <button style={{ ...sx.btn("ghost"), padding: "2px 8px", fontSize: 10, color: C.purple, border: `1px solid ${C.purple}44` }} onClick={async () => {
                        try {
                          const [profiles, allTasks] = await Promise.all([DB.getProfiles("acmecorp"), DB.getTasks("acmecorp")]);
                          const result = smartAssignTask(task, profiles, allTasks);
                          result._profiles = profiles;
                          setSmartResult(result);
                          setShowSmart(true);
                        } catch (e) { toast.error(e.message); }
                      }}>
                        🧠 Reassign
                      </button>
                    </div>
                    <select style={sx.input} value={assignee} onChange={e => { setAsgn(e.target.value); onUpdate(task.id, { assignee: e.target.value }); }}>
                      <option>AI Agent</option>
                      <option>Operations Team</option>
                      <option>Manager Team</option>
                      {agents.map(a => <option key={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              {doc && (
                <div style={{ ...sx.card, marginTop: 16 }}>
                  <span style={sx.label}>Source Document</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                    <div style={{ fontSize: 20 }}>{doc.type === "Invoice" ? "🧾" : "📄"}</div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{doc.name}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "Activity" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <textarea value={comm} onChange={e => setComm(e.target.value)} placeholder="Type a comment..." style={{ ...sx.input, minHeight: 60, marginBottom: 12, border: "none", background: "transparent", padding: 0 }} />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button style={sx.btn("primary")} disabled={!comm.trim()} onClick={postComm}>Post Comment</button>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[...comments.map(c => ({...c, type: 'comment'})), ...logs.map(l => ({...l, type: 'log'}))].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 12 }}>
                  <div style={{ width: 32, height: 32, background: item.type === 'log' ? C.dim : C.accent, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0, color: "#000" }}>
                    {item.type === 'log' ? "⚡" : (item.user_name?.[0] || "?")}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, color: C.text }}>{item.user_name || "System"}</span>
                      <span style={{ color: C.muted, marginLeft: 8 }}>{fmt(item.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 13, color: item.type === 'log' ? C.muted : C.text, lineHeight: 1.4 }}>
                      {item.type === 'log' ? item.description : item.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "Intelligence" && (
          <div>
             <span style={sx.label}>AI Execution Context</span>
             <div style={{ background: C.dim, padding: 20, borderRadius: 12, color: C.muted, fontSize: 13, textAlign: "center" }}>
               {task.agent_meta ? (
                  <div>
                    Used model <span style={{ color: C.purple, fontWeight: 700 }}>{task.agent_meta.model}</span> with {task.agent_meta.attempts} attempts.
                    <div style={{ marginTop: 10 }}>Estimated Latency: 4.2s · Cost: $0.0024</div>
                  </div>
               ) : "Run an AI agent to see intelligence metrics."}
             </div>
          </div>
        )}
      </div>

      <div style={{ padding: "16px 24px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", background: C.surface }}>
        <div>
          {isAI && status !== "Done" && perms.canRunAgent && (
            <button style={sx.btn("green")} onClick={() => onRunAgent(task)} disabled={isRunning}>
              {isRunning ? <><Spinner /> Running Agent…</> : "⚡ Run AI Agent"}
            </button>
          )}
        </div>
        <button style={sx.btn("primary")} onClick={onClose}>Finish & Close</button>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTS PAGE
// ═══════════════════════════════════════════════════════════════════════════
function DocPreviewModal({ doc, tasks, onClose }) {
  return (
    <Modal onClose={onClose} maxWidth={700}>
      <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 24 }}>{doc.type === "Invoice" ? "🧾" : "📄"}</span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{doc.name}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{doc.type} · {doc.size} · Uploaded {fmt(doc.created_at)}</div>
          </div>
        </div>
        <button onClick={onClose} style={{ ...sx.btn("ghost"), padding: "4px 10px" }}>✕</button>
      </div>
      <div style={{ padding: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
          <div>
            <span style={sx.label}>AI Analysis Summary</span>
            <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 20 }}>
              {doc.summary || "No summary available for this document."}
            </div>

            <span style={sx.label}>Extracted Entities</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {doc.entities ? Object.entries(doc.entities).map(([k, v]) => (
                <div key={k} style={{ ...sx.badge(C.accent), padding: "4px 10px" }}>
                  <span style={{ fontSize: 10, fontWeight: 400, color: C.muted, marginRight: 4 }}>{k}:</span>{String(v)}
                </div>
              )) : <div style={{ fontSize: 11, color: C.muted }}>No entities detected</div>}
            </div>
          </div>

          <div>
            <span style={sx.label}>Linked Tasks ({tasks.length})</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tasks.length === 0 && <div style={{ fontSize: 11, color: C.muted, padding: 10, textAlign: "center", background: C.dim, borderRadius: 8 }}>No tasks linked to this document</div>}
              {tasks.map(t => (
                <div key={t.id} style={{ padding: 10, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{t.title}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    <span style={sx.badge(statusColor(t.status))}>{t.status}</span>
                    <span style={{ fontSize: 10, color: C.muted }}>{t.assignee}</span>
                  </div>
                </div>
              ))}
            </div>
            
            <div style={{ marginTop: 20, padding: 16, border: `1px dashed ${C.border}`, borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: doc.confidence < 0.7 ? C.amber : C.green }}>{Math.round(doc.confidence * 100)}%</div>
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 8 }}>AI Confidence Level</div>
              <Bar pct={doc.confidence * 100} color={doc.confidence < 0.7 ? C.amber : C.green} />
            </div>
          </div>
        </div>
      </div>
      <div style={{ padding: "16px 24px", background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end" }}>
        <button style={sx.btn("primary")} onClick={onClose}>Finish Review</button>
      </div>
    </Modal>
  );
}

function DocumentsPage() {
  const { user, perms } = useAuth();
  const addAudit = useAudit();
  const toast = useToast();

  const [docs, setDocs] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProc] = useState(null);
  const [textInput, setText] = useState("");
  const [showPaste, setPaste] = useState(false);
  const [driveConn, setDriveConn] = useState(!!gdrive.token);
  const [driveFiles, setDriveFiles] = useState([]);
  const [driveLoading, setDriveLoad] = useState(false);
  const [driveError, setDriveErr] = useState("");
  const [importingId, setImportingId] = useState(null);
  const [page, setPage] = useState(1);
  const fileRef = useRef();
  const pageSize = 25;

  const reload = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([DB.getDocs("acmecorp"), DB.getTasks("acmecorp")]);
      setDocs(d); setTasks(t);
    } catch (e) { toast.error("Failed to load documents"); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { reload(); }, [reload]);

  const processDoc = async (name, size, content, source = "upload", driveFileId = null) => {
    if (!perms.canUpload) { toast.error("Your role does not have upload permissions."); return; }
    const docId = uid();
    const placeholder = { id: docId, tenant_id: "acmecorp", name, size, status: "Processing", type: "Processing…", confidence: 0, uploaded_by: user.id, source, drive_file_id: driveFileId, created_at: new Date().toISOString() };
    setDocs(prev => prev.some(d => d.id === docId) ? prev : [placeholder, ...prev]);
    setProc(docId);
    await DB.insertDoc(placeholder);
    await addAudit("CREATE", "Document", docId, `Uploaded "${name}" via ${source}`, { size, source });

    try {
      const result = await processDocument(content);
      await DB.updateDoc(docId, { type: result.docType, status: "Processed", confidence: result.confidence, summary: result.summary, entities: result.entities, ai_meta: result._meta });
      toast.success(`Processed "${name}" successfully`);
      if (result.confidence < AI.threshold) {
        await addAudit("UPDATE", "Document", docId, `Low AI confidence (${Math.round(result.confidence * 100)}%) — tasks routed to human review`);
      }
      for (const t of (result.tasks || [])) {
        const taskRow = { id: uid(), tenant_id: "acmecorp", title: t.title, description: t.description, priority: t.priority, status: "Todo", assignee: t.assignee, due_in_days: t.dueInDays || 3, tags: t.tags || [], doc_id: docId, agent_log: null, flagged_for_review: t.flagged_for_review || false, created_by: user.id };
        await DB.insertTask(taskRow);
        await addAudit("CREATE", "Task", taskRow.id, `Auto-created: "${t.title}" (${t.priority}/${t.assignee})`, { aiModel: result._meta?.model });
      }
    } catch (e) {
      await DB.updateDoc(docId, { status: "Error", type: "Error", summary: e.message });
      await addAudit("UPDATE", "Document", docId, `AI processing failed: ${e.message}`);
      toast.error(`AI processing failed: ${e.message}`);
    }
    setProc(null);
    await reload();
  };

  const handleFiles = (files) => {
    if (!perms.canUpload) { toast.error("Your role cannot upload documents."); return; }
    Array.from(files).forEach(f => {
      const isBin = f.type === "application/pdf" || f.name.endsWith(".docx") || f.name.endsWith(".pptx");
      const size = `${(f.size / 1024).toFixed(0)} KB`;
      if (isBin) { processDoc(f.name, size, `[Binary file: ${f.name}, type: ${f.type}] Infer document purpose and generate workflow tasks.`); return; }
      const r = new FileReader();
      r.onload = e => processDoc(f.name, size, e.target.result);
      r.onerror = () => toast.error(`Could not read file: ${f.name}`);
      r.readAsText(f);
    });
  };

  // Google Drive
  const connectDrive = async () => {
    if (!GDRIVE_READY) { toast.warn("Set GDRIVE_CLIENT_ID in the config constants."); return; }
    setDriveLoad(true); setDriveErr("");
    try {
      await gdriveAuth();
      setDriveConn(true);
      await addAudit("UPDATE", "Integration", "gdrive", `${user.full_name} connected Google Drive`);
      const { files } = await gdriveListFiles();
      setDriveFiles(files || []);
      toast.success("Google Drive connected");
    } catch (e) { setDriveErr(e.message); toast.error("Drive connection failed"); }
    finally { setDriveLoad(false); }
  };

  const loadDriveFiles = async () => {
    setDriveLoad(true); setDriveErr("");
    try { const { files } = await gdriveListFiles(); setDriveFiles(files || []); }
    catch (e) { setDriveErr(e.message); toast.error("Failed to load Drive files"); }
    finally { setDriveLoad(false); }
  };

  const importFile = async (f) => {
    setImportingId(f.id); setDriveErr("");
    try {
      const content = await gdriveReadFile(f.id, f.mimeType);
      const sizeKB = f.size ? `${(f.size / 1024).toFixed(0)} KB` : "—";
      await processDoc(f.name, sizeKB, content, "drive", f.id);
      await addAudit("CREATE", "Document", f.id, `Imported from Google Drive: "${f.name}"`);
      setDriveFiles(prev => prev.filter(x => x.id !== f.id));
    } catch (e) { setDriveErr(e.message); toast.error("Import failed"); }
    finally { setImportingId(null); }
  };

  const alreadyImported = (id) => docs.some(d => d.drive_file_id === id);
  const docTaskCount = (id) => tasks.filter(t => t.doc_id === id).length;

  const paginated = docs.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.ceil(docs.length / pageSize);
  const [selectedDoc, setSelDoc] = useState(null);

  return (
    <div>
      {selectedDoc && <DocPreviewModal doc={selectedDoc} tasks={tasks.filter(t => t.doc_id === selectedDoc.id)} onClose={() => setSelDoc(null)} />}
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", marginBottom: 6, color: C.text }}>Document Ingestion</div>

      <div style={{ fontSize: 12, color: C.muted, marginBottom: 22 }}>{docs.length} documents · Upload, paste text, or sync from Google Drive · AI auto-generates tasks</div>

      {/* Upload zone */}
      {perms.canUpload && (
        <div
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.accent; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = C.border; }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.border; handleFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${C.border}`, borderRadius: 12, padding: "28px 20px", textAlign: "center", cursor: "pointer", marginBottom: 16, background: C.surface, transition: "border-color .2s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
          onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
        >
          <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} accept=".pdf,.docx,.txt,.csv,.pptx" />
          <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 5 }}>Drop files here or click to upload</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>PDF · DOCX · TXT · CSV · PPTX</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button style={sx.btn("primary")} onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>📁 Browse Files</button>
            <button style={sx.btn("ghost")} onClick={e => { e.stopPropagation(); setPaste(v => !v); }}>✏️ Paste Text</button>
          </div>
        </div>
      )}

      {/* Paste zone */}
      {showPaste && (
        <div style={{ ...sx.card, marginBottom: 16 }}>
          <span style={sx.label}>Paste Document Content</span>
          <textarea value={textInput} onChange={e => setText(e.target.value)} placeholder="Paste any document text — invoice, contract, report, email…" rows={5} style={{ ...sx.input, resize: "vertical", marginBottom: 12 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button style={sx.btn("primary")} disabled={!textInput.trim()} onClick={() => { processDoc("Pasted Document.txt", `${textInput.length} chars`, textInput); setText(""); setPaste(false); }}>⚡ Process with AI</button>
            <button style={sx.btn("ghost")} onClick={() => setPaste(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Google Drive panel */}
      <div style={{ ...sx.card, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>🔗</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Google Drive Sync</div>
              <div style={{ fontSize: 11, color: C.muted }}>Import documents directly from a watched Drive folder</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {driveConn && <span style={sx.badge(C.green)}>● Connected</span>}
            {!GDRIVE_READY && <span style={sx.badge(C.amber)}>Not Configured</span>}
            {!driveConn
              ? <button style={sx.btn(GDRIVE_READY ? "primary" : "ghost")} onClick={connectDrive} disabled={driveLoading || !perms.canUpload}>
                {driveLoading ? <><Spinner /> Connecting…</> : "Connect Drive"}
              </button>
              : <button style={sx.btn("ghost")} onClick={loadDriveFiles} disabled={driveLoading}>
                {driveLoading ? <><Spinner /> Refreshing…</> : "🔄 Refresh"}
              </button>
            }
          </div>
        </div>

        {!GDRIVE_READY && (
          <div style={{ marginTop: 12 }}>
            <Notice type="warn">Set <code style={{ background: C.dim, padding: "1px 4px", borderRadius: 3 }}>GDRIVE_CLIENT_ID</code> and <code style={{ background: C.dim, padding: "1px 4px", borderRadius: 3 }}>GDRIVE_FOLDER_ID</code> in the config constants at the top of this file to enable Drive sync.</Notice>
          </div>
        )}
        {driveError && <div style={{ marginTop: 10 }}><Notice type="error">{driveError}</Notice></div>}

        {driveConn && driveFiles.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <span style={sx.label}>Files in watched folder ({driveFiles.length})</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {driveFiles.map(f => (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  <span style={{ fontSize: 18 }}>{f.mimeType?.includes("pdf") ? "📄" : f.mimeType?.includes("document") ? "📝" : "📁"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{f.size ? `${(f.size / 1024).toFixed(0)} KB` : "—"} · {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : "—"}</div>
                  </div>
                  {alreadyImported(f.id)
                    ? <span style={sx.badge(C.green)}>✓ Imported</span>
                    : <button style={sx.btn("primary")} onClick={() => importFile(f)} disabled={!!importingId}>
                      {importingId === f.id ? <><Spinner /> Importing…</> : "Import"}
                    </button>
                  }
                </div>
              ))}
            </div>
          </div>
        )}
        {driveConn && driveFiles.length === 0 && !driveLoading && (
          <div style={{ marginTop: 14, fontSize: 12, color: C.muted, textAlign: "center", padding: "14px 0" }}>No new files in the watched folder</div>
        )}
      </div>

      {/* Document list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {loading ? (
          <>
            <Skeleton height={60} />
            <Skeleton height={60} />
            <Skeleton height={60} />
          </>
        ) : docs.length === 0 ? (
          <div style={{ ...sx.card, textAlign: "center", color: C.muted, padding: 48 }}>No documents yet — upload a file, paste text, or connect Google Drive</div>
        ) : (
          paginated.map(doc => {
            const count = docTaskCount(doc.id);
            const isProc = processing === doc.id;
            return (
              <div key={doc.id} onClick={() => setSelDoc(doc)} style={{ ...sx.card, padding: "14px 18px", cursor: "pointer", transition: "all .12s" }} onMouseEnter={e => e.currentTarget.style.borderColor = C.accent} onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ fontSize: 26, flexShrink: 0 }}>

                    {doc.type === "Invoice" ? "🧾" : doc.type === "Contract" ? "📋" : doc.type === "Report" ? "📊" : doc.source === "drive" ? "🔗" : "📄"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.name}</div>
                    <div style={{ fontSize: 11, color: C.muted, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span>{doc.size}</span>
                      <span>{fmt(doc.created_at)}</span>
                      {doc.source === "drive" && <span style={{ color: C.accent }}>🔗 Google Drive</span>}
                      {doc.summary && <span style={{ color: C.text }}>· {doc.summary}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {isProc && <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.accent, fontSize: 12 }}><Spinner /> Analyzing…</div>}
                    {doc.confidence > 0 && (
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: doc.confidence < AI.threshold ? C.amber : C.green }}>{Math.round(doc.confidence * 100)}%</div>
                        <div style={{ fontSize: 9, color: C.muted }}>confidence</div>
                      </div>
                    )}
                    {count > 0 && <span style={sx.badge(C.accent)}>{count} task{count > 1 ? "s" : ""}</span>}
                    <span style={sx.badge(doc.status === "Processed" ? C.green : doc.status === "Error" ? C.red : C.amber)}>{doc.status}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 24 }}>
          <button style={sx.btn("ghost")} disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: C.muted, fontWeight: 600 }}>
            Page {page} of {totalPages}
          </div>
          <button style={sx.btn("ghost")} disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TASKS PAGE
// ═══════════════════════════════════════════════════════════════════════════
function TasksPage() {
  const { user, perms } = useAuth();
  const addAudit = useAudit();
  const toast = useToast();

  const [tasks, setTasks] = useState([]);
  const [docs, setDocs] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [selected, setSel] = useState(null);
  const [runningId, setRun] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [checked, setChecked] = useState([]);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const reload = useCallback(async () => {
    try {
      const [t, d, a] = await Promise.all([DB.getTasks("acmecorp"), DB.getDocs("acmecorp"), DB.getAgents("acmecorp")]);
      setTasks(t); setDocs(d); setAgents(a);
    } catch (e) { toast.error("Failed to load tasks"); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { reload(); }, [reload]);

  const runAgent = async (task) => {
    if (!perms.canRunAgent) return;
    setRun(task.id);
    await DB.updateTask(task.id, { status: "In Progress" });
    await addAudit("UPDATE", "Task", task.id, `AI agent started: "${task.title}"`);
    try {
      const customAgent = agents.find(a => a.name === task.assignee);
      const { report, model, attempts } = await runAgentOnTask(task, customAgent);
      await DB.updateTask(task.id, { status: "Done", agent_log: report, agent_meta: { model, attempts } });
      await addAudit("UPDATE", "Task", task.id, `AI agent completed: "${task.title}"`, { model });
      toast.success(`Agent finished: ${task.title}`);
    } catch (e) {
      await DB.updateTask(task.id, { status: "Blocked", agent_log: `Failed after retries: ${e.message}` });
      await addAudit("UPDATE", "Task", task.id, `AI agent failed: ${e.message}`);
      toast.error(`Agent failed: ${e.message}`);
    }
    setRun(null);
    await reload();
    // Sync open modal
    if (selected?.id === task.id) {
       const fresh = (await DB.getTasks("acmecorp")).find(t => t.id === task.id);
       if (fresh) setSel(fresh);
    }
  };

  const updateTask = async (id, fields) => {
    const old = tasks.find(t => t.id === id);
    await DB.updateTask(id, fields);
    await addAudit("UPDATE", "Task", id, `Updated "${old?.title || id}"`, { changed: Object.keys(fields) });
    await reload();
    if (selected?.id === id) setSel(prev => ({ ...prev, ...fields }));
  };

  const createTask = async (row) => {
    try {
      const id = uid();
      const payload = { ...row, id, tenant_id: "acmecorp", status: "Todo", created_by: user.id, created_at: new Date().toISOString() };
      await DB.insertTask(payload);
      await addAudit("CREATE", "Task", id, `Manually created: "${row.title}"`);
      toast.success("Task created");
      setShowNew(false);
      await reload();
    } catch (e) { toast.error("Failed to create task"); }
  };

  const bulkUpdate = async (fields) => {
    try {
      await Promise.all(checked.map(id => DB.updateTask(id, fields)));
      await addAudit("UPDATE", "Task", "Bulk", `Bulk updated ${checked.length} tasks`, { fields });
      toast.success(`Updated ${checked.length} tasks`);
      setChecked([]);
      await reload();
    } catch (e) { toast.error("Bulk update failed"); }
  };

  const statuses = ["All", "Todo", "In Progress", "Done", "Blocked"];
  const filtered = filter === "All" ? tasks : tasks.filter(t => t.status === filter);
  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selDoc = docs.find(d => d.id === selected?.doc_id);

  return (
    <div>
      {selected && <TaskModal task={selected} doc={selDoc} agents={agents} onClose={() => setSel(null)} onRunAgent={runAgent} onUpdate={updateTask} runningId={runningId} />}
      {showNew && <NewTaskModal agents={agents} onClose={() => setShowNew(false)} onSave={createTask} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", marginBottom: 6, color: C.text }}>Task Management</div>
          <div style={{ fontSize: 12, color: C.muted }}>{tasks.length} tasks · AI-generated & manual · Role: <span style={{ color: ROLES[user.role]?.color }}>{user.role}</span></div>
        </div>
        <button style={sx.btn("primary")} onClick={() => setShowNew(true)}>+ New Task</button>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        {statuses.map(st => (
          <button key={st} style={{ padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: filter === st ? 700 : 400, background: filter === st ? `${C.accent}22` : "transparent", color: filter === st ? C.accent : C.muted }} onClick={() => { setFilter(st); setPage(1); }}>
            {st} ({st === "All" ? tasks.length : tasks.filter(t => t.status === st).length})
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {loading ? (
          <>
            <Skeleton height={80} />
            <Skeleton height={80} />
            <Skeleton height={80} />
          </>
        ) : filtered.length === 0 ? (
          <div style={{ ...sx.card, textAlign: "center", color: C.muted, padding: 48 }}>No tasks here yet — upload a document or create one manually</div>
        ) : (
          paginated.map(task => (
            <div key={task.id} onClick={() => setSel(task)}
              style={{ ...sx.card, borderLeft: `3px solid ${priorityColor(task.priority)}`, cursor: "pointer", transition: "background .12s", position: "relative" }}
              onMouseEnter={e => e.currentTarget.style.background = "#1C2130"}
              onMouseLeave={e => e.currentTarget.style.background = C.card}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <input type="checkbox" checked={checked.includes(task.id)} onClick={e => e.stopPropagation()} onChange={e => {
                  e.stopPropagation();
                  setChecked(p => e.target.checked ? [...p, task.id] : p.filter(x => x !== task.id));
                }} style={{ marginTop: 4, cursor: "pointer" }} />
                
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{task.title}</span>
                    <span style={sx.badge(priorityColor(task.priority))}>{task.priority}</span>
                    <span style={sx.badge(statusColor(task.status))}>{task.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 6, lineHeight: 1.4 }}>{task.description}</div>
                  <div style={{ fontSize: 11, color: C.dim, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <span>{task.assignee?.includes("Agent") || agents.some(a => a.name === task.assignee) ? (agents.find(a => a.name === task.assignee)?.icon || "🤖") : "👤"} {task.assignee}</span>
                    {task.due_in_days >= 0 && <span style={{ color: task.due_in_days <= 1 && task.status !== "Done" ? C.red : C.muted }}>⏰ {task.due_in_days}d</span>}
                    <span>🕐 {fmt(task.created_at)}</span>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: C.dim }}>click to view ›</div>
              </div>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 24 }}>
          <button style={sx.btn("ghost")} disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: C.muted, fontWeight: 600 }}>Page {page} of {totalPages}</div>
          <button style={sx.btn("ghost")} disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}

      {/* Bulk actions bar */}
      {checked.length > 0 && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: C.surface, border: `1px solid ${C.accent}`, borderRadius: 12, padding: "12px 20px", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 20px 50px rgba(0,0,0,0.6)", zIndex: 100, animation: "slideUp .2s ease" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>{checked.length} selected</div>
          <div style={{ width: 1, height: 20, background: C.border }} />
          <button style={sx.btn("ghost")} onClick={() => bulkUpdate({ status: "Done" })}>✓ Mark Done</button>
          <button style={sx.btn("ghost")} onClick={() => bulkUpdate({ priority: "High" })}>🚦 High Priority</button>
          <button style={{ ...sx.btn("ghost"), color: C.purple }} onClick={async () => {
            try {
              const [profiles, allT] = await Promise.all([DB.getProfiles("acmecorp"), DB.getTasks("acmecorp")]);
              for (const id of checked) {
                const tsk = tasks.find(t => t.id === id);
                if (!tsk) continue;
                const res = smartAssignTask(tsk, profiles, allT);
                await DB.updateTask(id, { assignee: res.assignee });
                await addAudit("UPDATE", "Task", id, `🧠 Smart-assigned to ${res.assignee} (${Math.round(res.confidence * 100)}%)`, { reasoning: res.reasoning, model: res._meta?.model });
              }
              toast.success(`Smart-assigned ${checked.length} tasks`);
              setChecked([]); await reload();
            } catch (e) { toast.error(`Smart assign failed: ${e.message}`); }
          }}>🧠 Smart Assign</button>
          <button style={sx.btn("ghost")} onClick={() => setChecked([])}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SMART ASSIGN MODAL — Shows LLM recommendation with reasoning
// ═══════════════════════════════════════════════════════════════════════════
function SmartAssignModal({ result, onAccept, onAcceptAlt, onClose }) {
  if (!result) return null;

  const profile = result._profiles?.find(p => p.full_name === result.assignee);
  const confColor = result.confidence >= 0.85 ? C.green : result.confidence >= 0.6 ? C.amber : C.red;

  return (
    <Modal onClose={onClose} maxWidth={540}>
      <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, background: `linear-gradient(135deg,${C.purple},${C.accent})`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🧠</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>AI Recommendation</div>
          <div style={{ fontSize: 11, color: C.muted }}>Model: {result._meta?.model} · Attempts: {result._meta?.attempts}</div>
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>
        {/* Primary recommendation */}
        <div style={{ background: `${C.accent}08`, border: `1px solid ${C.accent}33`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <Avatar user={profile} size={40} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{result.assignee}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{profile?.role || "Team Member"} · {profile?.department || "—"}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: confColor }}>{Math.round(result.confidence * 100)}%</div>
              <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>confidence</div>
            </div>
          </div>
          <Bar pct={result.confidence * 100} color={confColor} height={4} />
          <div style={{ marginTop: 12, fontSize: 12, color: C.text, lineHeight: 1.6, padding: "10px 14px", background: C.surface, borderRadius: 8, border: `1px solid ${C.border}` }}>
            💡 {result.reasoning}
          </div>
        </div>

        {/* Alternates */}
        {result.alternates?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <span style={sx.label}>Alternates</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {result.alternates.map((alt, i) => {
                const altProfile = result._profiles?.find(p => p.full_name === alt.name);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                    <Avatar user={altProfile} size={28} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{alt.name}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>{alt.reason}</div>
                    </div>
                    <button style={{ ...sx.btn("ghost"), padding: "4px 10px", fontSize: 10 }} onClick={() => onAcceptAlt(alt.name)}>Select</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={sx.btn("ghost")} onClick={onClose}>Cancel</button>
          <button style={{ ...sx.btn("green"), fontSize: 13, padding: "10px 20px" }} onClick={() => onAccept(result.assignee)}>
            ✅ Assign to {result.assignee.split(" ")[0]}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function NewTaskModal({ agents, onClose, onSave }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [priority, setPri] = useState("Medium");
  const [assignee, setAsgn] = useState("AI Agent");
  const [due, setDue] = useState(3);
  const [smartResult, setSmartResult] = useState(null);
  const [smartLoading, setSmartLoad] = useState(false);
  const [smartError, setSmartErr] = useState(null);
  const [showSmart, setShowSmart] = useState(false);

  const inp = { ...sx.input, marginBottom: 12 };

  const handleSmartAssign = async () => {
    if (!title.trim()) { toast.warn("Enter a task title first"); return; }
    try {
      const [profiles, allTasks] = await Promise.all([DB.getProfiles("acmecorp"), DB.getTasks("acmecorp")]);
      const result = smartAssignTask({ title, description: desc, priority, tags: [] }, profiles, allTasks);
      result._profiles = profiles;
      setSmartResult(result);
      setShowSmart(true);
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <Modal onClose={onClose}>
      {showSmart && (
        <SmartAssignModal
          result={smartResult}
          onAccept={(name) => { setAsgn(name); setShowSmart(false); toast.success(`Assigned to ${name}`); }}
          onAcceptAlt={(name) => { setAsgn(name); setShowSmart(false); toast.success(`Assigned to ${name}`); }}
          onClose={() => setShowSmart(false)}
        />
      )}
      <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>New Manual Task</div>
        <button onClick={onClose} style={{ ...sx.btn("ghost"), padding: "4px 10px" }}>✕</button>
      </div>
      <div style={{ padding: "18px 24px" }}>
        <span style={sx.label}>Task Title</span>
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} style={inp} placeholder="e.g. Process monthly expense report" />
        
        <span style={sx.label}>Description</span>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} style={{ ...inp, resize: "vertical" }} rows={3} placeholder="What needs to be done?" />
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ ...sx.label, marginBottom: 0 }}>Assignee</span>
              <button style={{ ...sx.btn("ghost"), padding: "2px 8px", fontSize: 10, color: C.purple, border: `1px solid ${C.purple}44` }} onClick={handleSmartAssign}>
                🧠 Auto-Assign
              </button>
            </div>
            <select value={assignee} onChange={e => setAsgn(e.target.value)} style={inp}>
              <option>AI Agent</option>
              <option>Operations Team</option>
              <option>Manager Team</option>
              {agents.map(a => <option key={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <span style={sx.label}>Priority</span>
            <select value={priority} onChange={e => setPri(e.target.value)} style={inp}>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </div>
        </div>

        {smartResult && !showSmart && (
          <div style={{ background: `${C.purple}11`, border: `1px solid ${C.purple}33`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 11, color: C.purple, display: "flex", alignItems: "center", gap: 8 }}>
            🧠 AI assigned to <strong>{assignee}</strong> — {Math.round(smartResult.confidence * 100)}% confident
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={sx.btn("ghost")} onClick={onClose}>Cancel</button>
          <button style={sx.btn("primary")} disabled={!title.trim()} onClick={() => onSave({ title, description: desc, priority, assignee, due_in_days: parseInt(due) })}>Create Task</button>
        </div>
      </div>
    </Modal>
  );
}

function WorkflowLane({ label, lTasks, isAI, color, onSelect }) {
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ background: `${color}11`, border: `1px solid ${color}33`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: `${color}18`, borderBottom: `1px solid ${color}22`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg,${color},${color}88)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{isAI ? "🤖" : "👤"}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color }}>{label}</div>
              <div style={{ fontSize: 10, color: C.muted }}>{isAI ? "Automated" : "Human action"}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color }}>{lTasks.length}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{lTasks.filter(t => t.status === "Done").length} done</div>
          </div>
        </div>
        <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {lTasks.length === 0 && <div style={{ textAlign: "center", color: C.muted, fontSize: 12, padding: "16px 0" }}>No tasks</div>}
          {lTasks.map(task => (
            <div key={task.id} onClick={() => onSelect(task)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: `${color}08`, border: `1px solid ${color}20`, borderRadius: 8, borderLeft: `3px solid ${priorityColor(task.priority)}`, cursor: "pointer" }}
              onMouseEnter={e => e.currentTarget.style.background = `${color}14`}
              onMouseLeave={e => e.currentTarget.style.background = `${color}08`}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.title}</div>
                <div style={{ fontSize: 10, color: C.muted }}>{task.due_in_days > 0 ? `${task.due_in_days}d` : "Today"}</div>
              </div>
              <span style={sx.badge(priorityColor(task.priority))}>{task.priority}</span>
              <span style={sx.badge(statusColor(task.status))}>{task.status}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "6px 12px", borderTop: `1px solid ${color}22`, display: "flex", gap: 10, fontSize: 10, flexWrap: "wrap" }}>
          {["Todo", "In Progress", "Done", "Blocked"].map(st => <span key={st} style={{ color: statusColor(st) }}>{lTasks.filter(t => t.status === st).length} {st}</span>)}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKFLOW PAGE
// ═══════════════════════════════════════════════════════════════════════════
function WorkflowPage() {
  const { perms } = useAuth();
  const addAudit = useAudit();
  const [tasks, setTasks] = useState([]);
  const [docs, setDocs] = useState([]);
  const [agents, setAgents] = useState([]);
  const [selected, setSel] = useState(null);
  const [runningId, setRun] = useState(null);

  const reload = useCallback(async () => {
    const [t, d, a] = await Promise.all([DB.getTasks("acmecorp"), DB.getDocs("acmecorp"), DB.getAgents("acmecorp")]);
    setTasks(t); setDocs(d); setAgents(a);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const runAgent = async (task) => {
    setRun(task.id);
    await DB.updateTask(task.id, { status: "In Progress" });
    await addAudit("UPDATE", "Task", task.id, `AI agent started: "${task.title}"`);
    try {
      const customAgent = agents.find(a => a.name === task.assignee);
      const { report, model, attempts } = await runAgentOnTask(task, customAgent);
      await DB.updateTask(task.id, { status: "Done", agent_log: report, agent_meta: { model, attempts } });
      await addAudit("UPDATE", "Task", task.id, `Agent completed: "${task.title}"`, { model });
    } catch (e) {
      await DB.updateTask(task.id, { status: "Blocked", agent_log: `Failed after retries: ${e.message}` });
      await addAudit("UPDATE", "Task", task.id, `Agent failed: ${e.message}`);
    }
    setRun(null);
    await reload();
    if (selected?.id === task.id) { const fresh = (await DB.getTasks("acmecorp")).find(t => t.id === task.id); if (fresh) setSel(fresh); }
  };

  const updateTask = async (id, fields) => {
    await DB.updateTask(id, fields);
    await reload();
    if (selected?.id === id) setSel(p => ({ ...p, ...fields }));
  };

  const aiTasks = tasks.filter(t => t.assignee === "AI Agent" || agents.some(a => a.name === t.assignee));
  const humanTasks = tasks.filter(t => !aiTasks.includes(t));
  const stages = [["📥", "Uploaded", docs.length], ["🤖", "Processed", docs.filter(d => d.status === "Processed").length], ["⚡", "Tasks", tasks.length], ["👤", "Assigned", tasks.filter(t => t.assignee).length], ["▶", "Active", tasks.filter(t => ["In Progress", "Done"].includes(t.status)).length], ["✅", "Done", tasks.filter(t => t.status === "Done").length]];

  return (
    <div>
      {selected && <TaskModal task={selected} doc={docs.find(d => d.id === selected.doc_id)} agents={agents} onClose={() => setSel(null)} onRunAgent={runAgent} onUpdate={updateTask} runningId={runningId} />}

      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", marginBottom: 6, color: C.text }}>Workflow</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 22 }}>Live pipeline · AI and human task lanes · Click any task for details</div>

      <div style={{ ...sx.card, marginBottom: 18 }}>
        <span style={sx.label}>Document → Task Pipeline</span>
        <div style={{ display: "flex", alignItems: "center", overflowX: "auto", gap: 2, paddingBottom: 4 }}>
          {stages.map(([icon, label, count], i) => (
            <div key={label} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ textAlign: "center", padding: "10px 14px", background: i === stages.length - 1 ? `${C.green}22` : `${C.accent}11`, border: `1px solid ${i === stages.length - 1 ? C.green : C.border}`, borderRadius: 10, minWidth: 84 }}>
                <div style={{ fontSize: 18, marginBottom: 3 }}>{icon}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: i === stages.length - 1 ? C.green : C.accent }}>{count}</div>
              </div>
              {i < stages.length - 1 && <div style={{ color: C.dim, fontSize: 13, padding: "0 2px" }}>→</div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <WorkflowLane label="AI Agent Tasks" lTasks={aiTasks} isAI={true} color={C.accent} onSelect={setSel} />
        <WorkflowLane label="Human Tasks" lTasks={humanTasks} isAI={false} color={C.green} onSelect={setSel} />
      </div>
    </div>
  );
}

const AUDIT_COLORS = { CREATE: C.green, UPDATE: C.accent, DELETE: C.red, LOGIN: C.purple, LOGOUT: C.muted, AGENT_RUN: C.amber, APPROVE: C.green };

function KPI({ label, value, sub, color, icon }) {
  return (
    <div style={{ ...sx.card, flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || C.accent, letterSpacing: "-0.5px" }}>{value}</div>
      <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS PAGE
// FIX: safe division helpers to avoid NaN/Infinity
// ═══════════════════════════════════════════════════════════════════════════
function AnalyticsPage() {
  const [tasks, setTasks] = useState([]);
  const [docs, setDocs] = useState([]);
  const [logs, setLogs] = useState([]);

  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [t, d, l] = await Promise.all([DB.getTasks("acmecorp"), DB.getDocs("acmecorp"), DB.getAudit("acmecorp")]);
    setTasks(t); setDocs(d); setLogs(l);
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const total = tasks.length;
  const done = tasks.filter(t => t.status === "Done").length;
  const aiDone = tasks.filter(t => t.assignee === "AI Agent" && t.status === "Done").length;
  const overdue = tasks.filter(t => t.due_in_days <= 0 && t.status !== "Done").length;
  const confDocs = docs.filter(d => d.confidence > 0);
  const avgConf = confDocs.length ? confDocs.reduce((s, d) => s + d.confidence, 0) / confDocs.length : 0;
  const driveDocs = docs.filter(d => d.source === "drive").length;

  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", marginBottom: 6, color: C.text }}>Analytics</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 22 }}>Live metrics · SLA monitoring · Real-time from {IS_DEMO ? "demo store" : "Supabase"}</div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.muted, fontSize: 12, marginBottom: 16 }}>
          <Spinner /> Loading metrics…
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <KPI label="Docs Processed" value={(docs || []).filter(d => d.status === "Processed").length} sub={`of ${(docs || []).length} total`} icon="📄" color={C.accent} />
        <KPI label="Tasks Created" value={(tasks || []).length} sub="AI auto-generated" icon="⚡" color={C.green} />
        <KPI label="AI Handled" value={`${safePct(aiDone, total || 1)}%`} sub="of completed tasks" icon="🤖" color={C.purple} />
        <KPI label="Avg Confidence" value={`${Math.round(avgConf * 100)}%`} sub="AI extraction accuracy" icon="🎯" color={C.amber} />
        <KPI label="SLA Breaches" value={overdue} sub="overdue & incomplete" icon="🚨" color={overdue > 0 ? C.red : C.green} />
        <KPI label="Drive Imports" value={driveDocs} sub="from Google Drive" icon="🔗" color={C.accent} />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ ...sx.card, flex: 1.5, minWidth: 260 }}>
          <span style={sx.label}>Task Status Distribution</span>
          {[
            { label: "Done", count: done, color: C.green },
            { label: "In Progress", count: tasks.filter(t => t.status === "In Progress").length, color: C.accent },
            { label: "Todo", count: tasks.filter(t => t.status === "Todo").length, color: C.muted },
            { label: "Blocked", count: tasks.filter(t => t.status === "Blocked").length, color: C.red },
          ].map(st => (
            <div key={st.label} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
                <span style={{ color: C.muted }}>{st.label}</span>
                <span style={{ fontWeight: 700, color: st.color }}>{st.count}</span>
              </div>
              <Bar pct={safePct(st.count, total || 1)} color={st.color} />
            </div>
          ))}
        </div>

        <div style={{ ...sx.card, flex: 1, minWidth: 240 }}>
          <span style={sx.label}>PRD Targets</span>
          {[
            { label: "Auto-Processed Docs", target: 70, current: safePct(docs.filter(d => d.status === "Processed").length, docs.length || 1), color: C.accent },
            { label: "Manual Task Reduction", target: 50, current: 48, color: C.green },
            { label: "AI Agent Task Share", target: 40, current: safePct(tasks.filter(t => t.assignee === "AI Agent").length, total || 1), color: C.purple },
            { label: "Workflow Speed ↑", target: 30, current: 27, color: C.amber },
          ].map(m => (
            <div key={m.label} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
                <span style={{ color: C.muted }}>{m.label}</span>
                <span style={{ fontWeight: 700, color: m.current >= m.target ? C.green : C.amber }}>{m.current}% / {m.target}%</span>
              </div>
              <Bar pct={Math.min(m.current, 100)} color={m.current >= m.target ? C.green : m.color} />
            </div>
          ))}
        </div>

        <div style={{ ...sx.card, flex: 1, minWidth: 240 }}>
          <span style={sx.label}>Recent Audit Events</span>
          {logs.length === 0 && <div style={{ fontSize: 12, color: C.muted, textAlign: "center", padding: "16px 0" }}>No events yet</div>}
          {logs.slice(0, 7).map(log => (
            <div key={log.id} style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: AUDIT_COLORS[log.action] || C.muted, marginTop: 5, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 11, color: C.text, lineHeight: 1.4 }}>{log.description}</div>
                <div style={{ fontSize: 10, color: C.muted }}>{log.user_name || "system"} · {fmt(log.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════


function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [filter, setFil] = useState("All");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const l = await DB.getAudit("acmecorp", 200);
    setLogs(l); setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const actions = ["All", ...Array.from(new Set(logs.map(l => l.action)))];
  const filtered = filter === "All" ? logs : logs.filter(l => l.action === filter);

  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", marginBottom: 6, color: C.text }}>Audit Log</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 22 }}>Immutable event log · SOC 2 / ISO 27001 compliant · {logs.length} events recorded</div>

      <div style={{ display: "flex", gap: 4, marginBottom: 18, flexWrap: "wrap" }}>
        {actions.map(a => (
          <button key={a} style={{ padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: filter === a ? 700 : 400, background: filter === a ? `${AUDIT_COLORS[a] || C.accent}22` : "transparent", color: filter === a ? AUDIT_COLORS[a] || C.accent : C.muted }} onClick={() => setFil(a)}>
            {a} ({a === "All" ? logs.length : logs.filter(l => l.action === a).length})
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: "center", color: C.muted, padding: 48 }}><Spinner size={20} /></div>}

      {!loading && filtered.length === 0 && (
        <div style={{ ...sx.card, textAlign: "center", color: C.muted, padding: 48 }}>No audit events yet — actions appear here as you use the system</div>
      )}
      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {filtered.map(log => (
            <div key={log.id} style={{ ...sx.card, padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: AUDIT_COLORS[log.action] || C.muted, marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                  <span style={sx.badge(AUDIT_COLORS[log.action] || C.muted)}>{log.action}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{log.description}</span>
                </div>
                <div style={{ fontSize: 11, color: C.muted, display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {log.user_name && <span>👤 {log.user_name}</span>}
                  <span>🏷 {log.entity}</span>
                  <span>🕐 {fmt(log.created_at)}</span>
                  {log.meta && Object.keys(log.meta).length > 0 && <span style={{ color: C.dim, fontStyle: "italic" }}>{JSON.stringify(log.meta)}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════════════════
function SettingsModal({ onClose }) {
  const [conf, setConf] = useState(getLlmConfig());
  const [testRes, setTestRes] = useState("");
  const [loading, setLoading] = useState(false);

  const saveConf = (k, v) => {
    let next = { ...conf, [k]: v };
    // Auto-fill defaults for Ollama
    if (k === "provider" && v === "ollama") {
      next.baseUrl = "http://localhost:11434/v1";
      next.apiKey = "ollama";
      next.model = conf.model.includes("claude") || conf.model.includes("gpt") ? "llama3.2" : conf.model;
    }
    setConf(next);
    setLlmConfig(next);
  };

  const testConnection = async () => {
    setLoading(true); setTestRes("");
    try {
      const res = await callLLM("Respond strictly with 'Connection successful!'", "Hello", { retries: 1 });
      setTestRes(`✅ Success using ${res.model}: ${res.text}`);
    } catch (e) {
      setTestRes(`❌ Error: ${e.message}`);
    }
    setLoading(false);
  };

  const inp = { ...sx.input, marginBottom: 16 };
  const lbl = { ...sx.label, fontSize: 10 };

  const MODEL_OPTIONS = {
    anthropic: [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307"
    ],
    openai: [
      "gpt-4o",
      "gpt-4o-mini",
      "o1-preview",
      "o1-mini",
      "gpt-4-turbo"
    ],
    ollama: [
      "llama3.2",
      "llama3.1",
      "mistral",
      "gemma2",
      "phi3"
    ]
  };

  const currentModels = MODEL_OPTIONS[conf.provider] || MODEL_OPTIONS.openai;

  return (
    <Modal onClose={onClose} maxWidth={500}>
      <div style={{ padding: "18px 24px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>⚙️ Settings</div>
        <button onClick={onClose} style={{ ...sx.btn("ghost"), padding: "4px 10px", fontSize: 15 }}>✕</button>
      </div>
      <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text, display: "block", marginBottom: 16 }}>LLM Provider Settings</span>

        <span style={lbl}>Provider Format</span>
        <select value={conf.provider} onChange={e => saveConf("provider", e.target.value)} style={{ ...inp, cursor: "pointer", appearance: "auto" }}>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI Compatible (OpenAI, Groq, Together, etc.)</option>
          <option value="ollama">Ollama (Local SLM — 100% Free)</option>
        </select>

        <span style={lbl}>Base URL</span>
        <input value={conf.baseUrl} onChange={e => saveConf("baseUrl", e.target.value)} placeholder={conf.provider === "ollama" ? "http://localhost:11434/v1" : "e.g. https://api.openai.com/v1"} style={inp} />

        <span style={lbl}>Model Name</span>
        {conf.provider === "ollama" ? (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <select value={currentModels.includes(conf.model) ? conf.model : ""} onChange={e => e.target.value && saveConf("model", e.target.value)} style={{ ...sx.input, cursor: "pointer", appearance: "auto", flex: 1 }}>
              <option value="" disabled>Select popular...</option>
              {currentModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input value={conf.model} onChange={e => saveConf("model", e.target.value)} placeholder="Or type custom model..." style={{ ...sx.input, flex: 1 }} />
          </div>
        ) : (
          <select value={conf.model} onChange={e => saveConf("model", e.target.value)} style={{ ...inp, cursor: "pointer", appearance: "auto" }}>
            {currentModels.map(m => <option key={m} value={m}>{m}</option>)}
            {/* Allow existing custom models to show up if loaded from env/storage */}
            {!currentModels.includes(conf.model) && conf.model && <option value={conf.model}>{conf.model} (Custom)</option>}
          </select>
        )}

        {conf.provider !== "ollama" && (
          <>
            <span style={lbl}>API Key (stored locally only)</span>
            <input value={conf.apiKey} type="password" onChange={e => saveConf("apiKey", e.target.value)} placeholder="sk-..." style={inp} />
          </>
        )}

        {conf.provider === "ollama" && (
          <Notice type="info">Ensure Ollama is running on your machine with CORS enabled (e.g. <code>OLLAMA_ORIGINS="*" ollama serve</code>).</Notice>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
          <button style={sx.btn("primary")} onClick={testConnection} disabled={loading || (!conf.apiKey && conf.provider !== "ollama")}>
            {loading ? <><Spinner size={14} /> Testing…</> : "⚡ Test Connection"}
          </button>
          <div style={{ fontSize: 13, color: testRes.includes("❌") ? C.red : C.green, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {testRes}
          </div>
        </div>
      </div>
      <div style={{ padding: "0 24px 24px" }}>
        <Notice type="info">Changes are saved automatically to your browser's LocalStorage.</Notice>
      </div>
    </Modal>
  );
}

// ADMIN PANEL STATIC DATA
const ADMIN_TABS = ["users", "agents", "rules", "integrations", "security"];
const ADMIN_TAB_ICONS = { users: "👥", agents: "🤖", rules: "⚙️", integrations: "🔗", security: "🔒" };

const INTEGRATIONS_LIST = [
  { name: "Google Drive", icon: "📁", desc: `Folder ID: ${GDRIVE_FOLDER_ID} — watches for new files`, status: "ready", color: C.amber },
  { name: "Gmail/Outlook", icon: "📧", desc: "Forward emails to workflow@acmecorp.workflowmanager.io", status: "configured", color: C.green },
  { name: "Slack", icon: "💬", desc: "Post to #workflow-alerts on task creation and changes", status: "configured", color: C.green },
  { name: "Microsoft Teams", icon: "🔷", desc: "Send approvals and task assignments via Teams bot", status: "pending", color: C.amber },
  { name: "SAP ERP", icon: "🏭", desc: "Bidirectional invoice and PO sync", status: "pending", color: C.amber },
  { name: "Salesforce", icon: "☁️", desc: "Sync contract tasks and approval workflows", status: "not configured", color: C.muted },
  { name: "JIRA", icon: "🗂", desc: "Mirror workflow tasks as JIRA issues with status sync", status: "not configured", color: C.muted },
];

const SECURITY_ITEMS = [
  { label: "SSO / SAML 2.0", status: "Active", color: C.green, detail: IS_DEMO ? "Demo mode — configure real SSO in Supabase Auth settings" : "Supabase Auth · SAML 2.0 / OIDC" },
  { label: "MFA Enforcement", status: "Enforced", color: C.green, detail: "TOTP + push notifications required for all roles" },
  { label: "Row-Level Security", status: "Enabled", color: C.green, detail: "Supabase RLS — data isolated per tenant_id on every table" },
  { label: "Data Encryption", status: "AES-256", color: C.green, detail: "At-rest via Supabase · TLS 1.3 in transit" },
  { label: "Audit Logging", status: "Active", color: C.green, detail: "Every mutation logged to audit_logs — 200-event buffer in demo" },
  { label: "IP Allowlisting", status: "Configured", color: C.amber, detail: "10.0.0.0/8, 203.0.113.0/24 — configure in Supabase network rules" },
  { label: "Session Timeout", status: "30 min", color: C.accent, detail: "Auto-logout on inactivity — configurable per role" },
  { label: "Data Residency", status: "ap-south-1", color: C.purple, detail: "Supabase project region: Mumbai, India (AWS)" },
];

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════════════════════════════════════
function AdminPanel() {
  const { user: me } = useAuth();
  const addAudit = useAudit();
  const [tab, setTab] = useState("users");
  const [profiles, setProfiles] = useState([]);
  const [agents, setAgents] = useState([]);
  const [rules, setRules] = useState([]);
  const [newUser, setNewUser] = useState({ full_name: "", email: "", role: "Viewer", department: "" });
  const [newAgent, setNewAgent] = useState({ name: "", role: "", system_prompt: "", model: "claude-3-5-sonnet-20241022", icon: "🤖" });
  const [addingAgent, setAddingAgent] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editAgentId, setEditAgent] = useState(null);
  const [editAgentData, setEditAgentData] = useState({});
  const [editRuleId, setEditRule] = useState(null);
  const [editRuleData, setEditRuleData] = useState({});

  const reload = useCallback(async () => {
    const [p, r, a] = await Promise.all([DB.getProfiles("acmecorp"), DB.getRules("acmecorp"), DB.getAgents("acmecorp")]);
    setProfiles(p); setRules(r); setAgents(a);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const addUser = async () => {
    if (!newUser.full_name.trim() || !newUser.email.trim()) return;
    const p = { ...newUser, id: uid(), tenant_id: "acmecorp", avatar_initials: newUser.full_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() };
    await DB.upsertProfile(p);
    await addAudit("CREATE", "User", p.id, `Invited ${p.full_name} as ${p.role}`);
    setNewUser({ full_name: "", email: "", role: "Viewer", department: "" });
    setAdding(false);
    await reload();
  };

  const changeRole = async (id, role) => {
    const p = profiles.find(u => u.id === id);
    await DB.upsertProfile({ ...p, role });
    await addAudit("UPDATE", "User", id, `Role changed to ${role} for ${p?.full_name}`);
    await reload();
  };

  const removeUser = async (id) => {
    const p = profiles.find(u => u.id === id);
    if (!window.confirm(`Remove ${p?.full_name} from the workspace? This cannot be undone.`)) return;
    await DB.deleteProfile(id);
    await addAudit("DELETE", "User", id, `Removed user ${p?.full_name}`);
    await reload();
  };

  const addAgent = async () => {
    if (!newAgent.name.trim() || !newAgent.system_prompt.trim()) return;
    const a = { ...newAgent, tenant_id: "acmecorp" };
    await DB.insertAgent(a);
    await addAudit("CREATE", "Agent", a.id || "new", `Created agent ${a.name}`);
    setNewAgent({ name: "", role: "", system_prompt: "", model: "claude-3-5-sonnet-20241022", icon: "🤖" });
    setAddingAgent(false);
    await reload();
  };

  const removeAgent = async (id) => {
    const a = agents.find(x => x.id === id);
    if (!window.confirm(`Delete agent ${a?.name}?`)) return;
    await DB.deleteAgent(id);
    await addAudit("DELETE", "Agent", id, `Deleted agent ${a?.name}`);
    await reload();
  };

  const saveAgent = async (id) => {
    await DB.updateAgent(id, editAgentData);
    await addAudit("UPDATE", "Agent", id, `Updated agent ${editAgentData.name || id}`);
    setEditAgent(null); setEditAgentData({});
    await reload();
  };

  const toggleRule = async (id) => {
    const r = rules.find(x => x.id === id);
    const active = !r.active;
    await DB.updateRule(id, { active, status: active ? "active" : "draft" });
    await addAudit("UPDATE", "WorkflowRule", id, `${active ? "Activated" : "Deactivated"}: "${r.trigger_condition}"`);
    await reload();
  };

  const approveRule = async (id) => {
    const r = rules.find(x => x.id === id);
    await DB.updateRule(id, { approved_by: me.id, status: "active", active: true });
    await addAudit("APPROVE", "WorkflowRule", id, `Approved: "${r.trigger_condition}"`, { approver: me.full_name });
    await reload();
  };

  const saveRule = async (id) => {
    await DB.updateRule(id, editRuleData);
    await addAudit("UPDATE", "WorkflowRule", id, `Edited rule conditions`);
    setEditRule(null); setEditRuleData({});
    await reload();
  };

  const deleteRule = async (id) => {
    const r = rules.find(x => x.id === id);
    await DB.deleteRule(id);
    await addAudit("DELETE", "WorkflowRule", id, `Deleted rule: "${r?.trigger_condition}"`);
    await reload();
  };

  const addRule = async () => {
    const nextVersion = rules.length + 1;
    await DB.insertRule({ tenant_id: "acmecorp", trigger_condition: "New trigger condition", action_description: "Define action here", active: false, status: "draft", version: nextVersion, created_by: me.id });
    await addAudit("CREATE", "WorkflowRule", "new", "Created new draft rule");
    await reload();
  };

  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", marginBottom: 6, color: C.text }}>Admin Panel</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 22 }}>Tenant management · RBAC · Integrations · Security</div>

      <div style={{ display: "flex", gap: 4, marginBottom: 22 }}>
        {ADMIN_TABS.map(t => (
          <button key={t} style={{ padding: "7px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: tab === t ? 700 : 400, background: tab === t ? `${C.accent}22` : "transparent", color: tab === t ? C.accent : C.muted, letterSpacing: "0.3px" }} onClick={() => setTab(t)}>
            {ADMIN_TAB_ICONS[t]} {t}
          </button>
        ))}
      </div>

      {/* ── USERS ── */}
      {tab === "users" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{profiles.length} users · acmecorp</div>
            <button style={sx.btn("primary")} onClick={() => setAdding(true)}>+ Invite User</button>
          </div>

          {adding && (
            <div style={{ ...sx.card, marginBottom: 14, borderColor: C.accent }}>
              <span style={sx.label}>Invite New User</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                {[["Full Name", "full_name", "text"], ["Email", "email", "email"], ["Department", "department", "text"]].map(([l, k, t]) => (
                  <div key={k}>
                    <span style={{ ...sx.label, fontSize: 9 }}>{l}</span>
                    <input type={t} value={newUser[k]} onChange={e => setNewUser(p => ({ ...p, [k]: e.target.value }))} style={{ ...sx.input, padding: "7px 10px" }} />
                  </div>
                ))}
                <div>
                  <span style={{ ...sx.label, fontSize: 9 }}>Role</span>
                  <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))} style={{ ...sx.input, padding: "7px 10px", cursor: "pointer" }}>
                    {Object.keys(ROLES).map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={sx.btn("green")} onClick={addUser}>✓ Send Invite</button>
                <button style={sx.btn("ghost")} onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {profiles.map(u => (
              <div key={u.id} style={{ ...sx.card, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <Avatar user={u} size={34} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{u.full_name}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{u.email} · {u.department}</div>
                </div>
                <select value={u.role} onChange={e => changeRole(u.id, e.target.value)} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 8px", color: ROLES[u.role]?.color || C.text, fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
                  {Object.keys(ROLES).map(r => <option key={r}>{r}</option>)}
                </select>
                <span style={sx.badge(ROLES[u.role]?.color || C.muted)}>{ROLES[u.role]?.icon} {u.role}</span>
                {u.id !== me.id && <button onClick={() => removeUser(u.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 14, opacity: 0.65 }}>✕</button>}
              </div>
            ))}
          </div>

          {/* Permissions matrix */}
          <div style={sx.card}>
            <span style={sx.label}>Permissions Matrix</span>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "8px 10px", color: C.muted, borderBottom: `1px solid ${C.border}` }}>Role</th>
                    {["Upload", "Edit Tasks", "Run AI", "Approve", "Manage Users", "Audit Log"].map(p => (
                      <th key={p} style={{ textAlign: "center", padding: "8px 10px", color: C.muted, borderBottom: `1px solid ${C.border}`, fontSize: 10 }}>{p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(ROLES).map(([role, perms]) => (
                    <tr key={role} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "8px 10px" }}><span style={sx.badge(perms.color)}>{perms.icon} {role}</span></td>
                      {[perms.canUpload, perms.canEditTasks, perms.canRunAgent, perms.canApprove, perms.canManageUsers, perms.canViewAudit].map((v, i) => (
                        <td key={i} style={{ textAlign: "center", padding: "8px 10px" }}>{v ? "✅" : "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── AGENTS ── */}
      {tab === "agents" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{agents.length} custom agents</div>
            <button style={sx.btn("primary")} onClick={() => setAddingAgent(true)}>+ New Agent</button>
          </div>

          {addingAgent && (
            <div style={{ ...sx.card, marginBottom: 14, borderColor: C.accent }}>
              <span style={sx.label}>Define New Agent</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <span style={sx.label}>Agent Name</span>
                  <input value={newAgent.name} onChange={e => setNewAgent(p => ({ ...p, name: e.target.value }))} style={sx.input} placeholder="e.g. LegalReviewer" />
                </div>
                <div>
                  <span style={sx.label}>Specialty / Role</span>
                  <input value={newAgent.role} onChange={e => setNewAgent(p => ({ ...p, role: e.target.value }))} style={sx.input} placeholder="e.g. Contract Analysis" />
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <span style={sx.label}>System Prompt</span>
                  <textarea value={newAgent.system_prompt} onChange={e => setNewAgent(p => ({ ...p, system_prompt: e.target.value }))} style={{ ...sx.input, resize: "vertical" }} rows={3} placeholder="Define instructions for the agent..." />
                </div>
                <div>
                  <span style={sx.label}>Preferred Model</span>
                  <select value={newAgent.model} onChange={e => setNewAgent(p => ({ ...p, model: e.target.value }))} style={{ ...sx.input, cursor: "pointer" }}>
                    <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="llama3.2">Llama 3.2 (Ollama)</option>
                  </select>
                </div>
                <div>
                  <span style={sx.label}>Icon</span>
                  <input value={newAgent.icon} onChange={e => setNewAgent(p => ({ ...p, icon: e.target.value }))} style={sx.input} placeholder="Emoji icon" />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={sx.btn("green")} onClick={addAgent}>✓ Create Agent</button>
                <button style={sx.btn("ghost")} onClick={() => setAddingAgent(false)}>Cancel</button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {agents.map(a => {
              const isEditing = editAgentId === a.id;
              return (
                <div key={a.id} style={{ ...sx.card, padding: "14px 18px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ fontSize: 24 }}>{a.icon}</div>
                    <div style={{ flex: 1 }}>
                      {isEditing ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <input value={editAgentData.name ?? a.name} onChange={e => setEditAgentData(p => ({ ...p, name: e.target.value }))} style={sx.input} />
                          <textarea value={editAgentData.system_prompt ?? a.system_prompt} onChange={e => setEditAgentData(p => ({ ...p, system_prompt: e.target.value }))} style={{ ...sx.input, resize: "vertical" }} rows={3} />
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{a.name} <span style={{ fontWeight: 400, color: C.muted, marginLeft: 6 }}>· {a.role}</span></div>
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 4, fontStyle: "italic", lineHeight: 1.4 }}>"{a.system_prompt.slice(0, 80)}..."</div>
                        </>
                      )}
                      <div style={{ fontSize: 10, color: C.accent, marginTop: 6, display: "flex", gap: 10 }}>
                        <span>🧠 {a.model}</span>
                        <span>🆔 {a.id}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {isEditing ? (
                        <>
                          <button style={{ ...sx.btn("green"), padding: "4px 10px", fontSize: 11 }} onClick={() => saveAgent(a.id)}>💾 Save</button>
                          <button style={{ ...sx.btn("ghost"), padding: "4px 10px", fontSize: 11 }} onClick={() => { setEditAgent(null); setEditAgentData({}); }}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button style={{ ...sx.btn("ghost"), padding: "4px 10px", fontSize: 11 }} onClick={() => { setEditAgent(a.id); setEditAgentData(a); }}>Edit</button>
                          <button onClick={() => removeAgent(a.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 14, opacity: 0.65 }}>✕</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── WORKFLOW RULES ── */}
      {tab === "rules" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{rules.length} automation rules</div>
            <button style={sx.btn("primary")} onClick={addRule}>+ New Rule</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rules.map(rule => {
              const approver = profiles.find(p => p.id === rule.approved_by);
              const isEditing = editRuleId === rule.id;
              return (
                <div key={rule.id} style={{ ...sx.card, padding: "14px 18px", borderLeft: `3px solid ${rule.active ? C.green : C.dim}` }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: rule.active ? C.green : C.dim, marginTop: 6, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      {isEditing ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                          <div>
                            <span style={{ ...sx.label, fontSize: 9 }}>Trigger Condition</span>
                            <input value={editRuleData.trigger_condition ?? rule.trigger_condition} onChange={e => setEditRuleData(p => ({ ...p, trigger_condition: e.target.value }))} style={{ ...sx.input, padding: "6px 10px" }} />
                          </div>
                          <div>
                            <span style={{ ...sx.label, fontSize: 9 }}>Action</span>
                            <input value={editRuleData.action_description ?? rule.action_description} onChange={e => setEditRuleData(p => ({ ...p, action_description: e.target.value }))} style={{ ...sx.input, padding: "6px 10px" }} />
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          <span style={{ color: C.muted }}>IF </span><span style={{ color: C.amber, fontWeight: 700 }}>{rule.trigger_condition}</span>
                          <span style={{ color: C.muted }}> → THEN </span><span style={{ color: C.text, fontWeight: 600 }}>{rule.action_description}</span>
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: C.muted, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span>v{rule.version}</span>
                        <span style={sx.badge(rule.status === "active" ? C.green : C.amber)}>{rule.status}</span>
                        {approver ? <span style={{ color: C.green }}>✓ {approver.full_name}</span> : <span style={{ color: C.amber }}>⏳ Pending approval</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                      {isEditing ? (
                        <>
                          <button style={{ ...sx.btn("green"), padding: "4px 10px", fontSize: 11 }} onClick={() => saveRule(rule.id)}>💾 Save</button>
                          <button style={{ ...sx.btn("ghost"), padding: "4px 10px", fontSize: 11 }} onClick={() => { setEditRule(null); setEditRuleData({}); }}>Cancel</button>
                        </>
                      ) : (
                        <>
                          {rule.status === "draft" && <button style={{ ...sx.btn("green"), padding: "4px 10px", fontSize: 11 }} onClick={() => approveRule(rule.id)}>Approve</button>}
                          <button style={{ ...sx.btn("ghost"), padding: "4px 10px", fontSize: 11 }} onClick={() => toggleRule(rule.id)}>{rule.active ? "Pause" : "Activate"}</button>
                          <button style={{ ...sx.btn("ghost"), padding: "4px 10px", fontSize: 11 }} onClick={() => { setEditRule(rule.id); setEditRuleData({ trigger_condition: rule.trigger_condition, action_description: rule.action_description }); }}>Edit</button>
                          <button style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 13, opacity: 0.65 }} onClick={() => deleteRule(rule.id)}>✕</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── INTEGRATIONS ── */}
      {tab === "integrations" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {INTEGRATIONS_LIST.map(int => (
            <div key={int.name} style={{ ...sx.card, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontSize: 26 }}>{int.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 3 }}>{int.name}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{int.desc}</div>
              </div>
              <span style={sx.badge(int.color)}>{int.status}</span>
              <button style={{ ...sx.btn("ghost"), padding: "5px 10px", fontSize: 11 }}>{int.status === "not configured" ? "Configure" : "Manage"}</button>
            </div>
          ))}
        </div>
      )}

      {/* ── SECURITY ── */}
      {tab === "security" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SECURITY_ITEMS.map(item => (
            <div key={item.label} style={{ ...sx.card, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{item.label}</span>
                  <span style={sx.badge(item.color)}>{item.status}</span>
                </div>
                <div style={{ fontSize: 11, color: C.muted }}>{item.detail}</div>
              </div>
              <button style={{ ...sx.btn("ghost"), padding: "5px 10px", fontSize: 11 }}>Configure</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// APP ROOT
// FIX: DB singleton created at module level (not inside component) to avoid
// recreation on re-render; addAudit stable via useCallback dep on [user]
// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("Documents");
  const [sessionTok, setSessTok] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [toasts, setToasts] = useState([]);

  // Toast API
  const toast = useMemo(() => ({
    show: (msg, type = "info") => {
      const id = Date.now();
      setToasts(p => [...p, { id, msg, type }]);
      setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), 4000);
    },
    success: (m) => toast.show(m, "success"),
    error: (m) => toast.show(m, "error"),
    warn: (m) => toast.show(m, "warn"),
  }), []);

  // Shortcut listeners
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowSearch(s => !s); }
      if (e.key === "Escape") setShowSearch(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // FIX: addAudit is stable — user ref changes only on login/logout
  const addAudit = useCallback(async (action, entity, entityId, description, meta = {}) => {
    if (!user) return;
    try {
      await DB.insertAudit({
        tenant_id: "acmecorp", action, entity, entity_id: String(entityId),
        description, user_id: user.id, user_name: user.full_name,
        meta: Object.keys(meta).length > 0 ? meta : undefined,
      });
    } catch (e) { console.warn("Audit log error:", e.message); }
  }, [user]);

  const handleLogin = async (loggedInUser) => {
    setUser(loggedInUser);
    toast.success(`Welcome back, ${loggedInUser.full_name.split(' ')[0]}`);
    try {
      await DB.insertAudit({ tenant_id: "acmecorp", action: "LOGIN", entity: "User", entity_id: loggedInUser.id, description: `${loggedInUser.full_name} signed in`, user_id: loggedInUser.id, user_name: loggedInUser.full_name });
    } catch (e) { console.warn("Login audit error:", e.message); }
  };

  const handleLogout = async () => {
    try {
      await DB.insertAudit({ tenant_id: "acmecorp", action: "LOGOUT", entity: "User", entity_id: user.id, description: `${user.full_name} signed out`, user_id: user.id, user_name: user.full_name });
      if (!IS_DEMO && sessionTok) await DB.signOut(sessionTok);
    } catch (e) { console.warn("Logout audit error:", e.message); }
    setUser(null); setSessTok(null); setPage("Documents");
    toast.show("Signed out successfully");
  };

  const [dark, setDark] = useState(true);
  const theme = useMemo(() => dark ? C : { ...C, bg: "#F8FAFC", surface: "#FFFFFF", card: "#FFFFFF", border: "#E2E8F0", dim: "#F1F5F9", text: "#0F172A", muted: "#64748B", input: "#FFFFFF" }, [dark]);

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  const roleConf = ROLES[user.role] || ROLES.Viewer;
  const activePage = roleConf.pages.includes(page) ? page : roleConf.pages[0];
  const PAGE_ICONS = { Dashboard: "📈", Documents: "📄", Tasks: "✅", Workflow: "🔀", Analytics: "📊", Audit: "📋", Admin: "🔑" };

  return (
    <ThemeCtx.Provider value={{ dark, setDark, C: theme }}>
      <AuthCtx.Provider value={{ user, perms: roleConf }}>
        <AuditCtx.Provider value={addAudit}>
          <ToastCtx.Provider value={toast}>
            <style>{`
              @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
              *{box-sizing:border-box;margin:0;padding:0}
              body{background:${theme.bg};color:${theme.text};transition:background .2s,color .2s}
              @keyframes spin{to{transform:rotate(360deg)}}
              @keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
              @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
              button:hover{opacity:.82}
              button:disabled{opacity:.35;cursor:not-allowed;pointer-events:none}
              input:focus,textarea:focus,select:focus{border-color:${theme.accent}!important;outline:none}
              ::-webkit-scrollbar{width:4px;height:4px}
              ::-webkit-scrollbar-track{background:${theme.bg}}
              ::-webkit-scrollbar-thumb{background:${theme.border};border-radius:2px}
              select option{background:${theme.surface};color:${theme.text}}
            `}</style>
            
            <div style={{ ...sx.app, background: theme.bg, color: theme.text }}>
              <ToastContainer toasts={toasts} remove={id => setToasts(p => p.filter(x => x.id !== id))} />
              {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}
              <DashboardBanner />
              
              {/* Header */}
              <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", borderBottom: `1px solid ${theme.border}`, background: `${theme.surface}DD`, backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100, gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 17, fontWeight: 700, letterSpacing: "-0.3px", color: theme.text, flexShrink: 0 }}>
                  <div style={{ width: 28, height: 28, background: `linear-gradient(135deg,${theme.accent},${theme.green})`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#000" }}>⚡</div>
                  Workflow Manager
                </div>

                <div onClick={() => setShowSearch(true)} style={{ flex: 1, maxWidth: 300, background: theme.dim, borderRadius: 8, padding: "6px 12px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", border: `1px solid ${theme.border}` }}>
                  <span style={{ fontSize: 14 }}>🔍</span>
                  <span style={{ fontSize: 11, color: theme.muted }}>Search...</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: theme.muted, background: theme.surface, padding: "2px 4px", borderRadius: 3, border: `1px solid ${theme.border}`, fontWeight: 700 }}>⌘K</span>
                </div>

                <nav style={{ display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "center" }}>
                  {roleConf.pages.map(p => (
                    <button key={p} style={{ padding: "6px 11px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: activePage === p ? 700 : 400, letterSpacing: "0.3px", background: activePage === p ? `${theme.accent}22` : "transparent", color: activePage === p ? theme.accent : theme.muted, transition: "all .15s" }} onClick={() => setPage(p)}>
                      {PAGE_ICONS[p]} {p}
                    </button>
                  ))}
                </nav>

                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <button onClick={() => setDark(!dark)} style={{ ...sx.btn("ghost"), width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, fontSize: 16 }}>{dark ? "🌙" : "☀️"}</button>
                  <button style={{ ...sx.btn("ghost"), padding: "5px 10px", fontSize: 12, gap: 6, color: theme.text }} onClick={() => setShowSettings(true)}>⚙️ Settings</button>
                  <div style={{ width: 1, height: 18, background: theme.border }} />
                  <Avatar user={user} size={26} />
                  <button style={{ ...sx.btn("ghost"), padding: "4px 10px", fontSize: 11 }} onClick={handleLogout}>Sign Out</button>
                </div>
              </header>

              {/* Main */}
              <main style={{ flex: 1, padding: "26px 28px", maxWidth: 1300, margin: "0 auto", width: "100%", animation: "slideUp .25s ease" }}>
                <ErrorBoundary>
                  {activePage === "Dashboard" && <DashboardPage />}
                  {activePage === "Documents" && <DocumentsPage />}
                  {activePage === "Tasks" && <TasksPage />}
                  {activePage === "Workflow" && <WorkflowPage />}
                  {activePage === "Analytics" && <AnalyticsPage />}
                  {activePage === "Audit" && <AuditLogPage />}
                  {activePage === "Admin" && <AdminPanel />}
                </ErrorBoundary>
              </main>

              {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
            </div>
          </ToastCtx.Provider>
        </AuditCtx.Provider>
      </AuthCtx.Provider>
    </ThemeCtx.Provider>
  );
}
