import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowUpRight, Bot, Check, ChevronDown, ChevronRight, CircleHelp, Command, Cpu, Crosshair,
  Download, FileCode2, FileText, Filter, Globe2, Layers3, LayoutDashboard, LockKeyhole, Menu, MessageSquareText,
  Pencil, Play, Plus, RefreshCw, Search, Send, Server, Settings2, ShieldCheck, Sparkles, TerminalSquare, Trash2,
  TriangleAlert, UserRound, Wifi, X, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import DOMPurify from "dompurify";
import { marked } from "marked";

/* ------------------------------------------------------------------ types */
type Area = "overview" | "chat" | "targets" | "findings" | "scope" | "reports" | "providers";
type Severity = "critical" | "high" | "medium" | "low" | "info";
type FindingStatus = "open" | "verified" | "fixed" | "wontfix";
type Kind = "pentest" | "ctf" | "lab";

type Engagement = { id: number; name: string; kind: Kind; scope_notes: string; created_at: string };
type Target = { id: number; engagement_id: number; value: string; notes: string; created_at: string };
type ToolRun = { id: number; target_id: number; tool: string; args: string; output: string; exit_code: number; started_at: string; finished_at: string | null };
type Finding = { id: number; engagement_id: number; title: string; severity: Severity; status: FindingStatus; description: string; evidence: string; remediation: string; created_at: string };
type Provider = { name: string; model: string; base_url: string; context_tokens?: number; hasKey: boolean; state: "active" | "ready" | "offline"; latency: string };
type ChatMessage = { role: "user" | "assistant"; content: string; created_at: string; error?: boolean };
type ProviderResponse = { active: string; providers: Record<string, { base_url: string; api_key: string; model: string; context_tokens?: number }> };
type CtxInfo = { used?: number; budget?: number; tokens?: number; source: string; note: string; dropped_turns?: number };

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const STATUSES: FindingStatus[] = ["open", "verified", "fixed", "wontfix"];
const sevRank = (s: Severity) => SEVERITIES.indexOf(s);

const navItems: { id: Area; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "chat", label: "AI copilot", icon: MessageSquareText },
  { id: "targets", label: "Targets & tools", icon: Crosshair },
  { id: "findings", label: "Findings", icon: ShieldCheck },
  { id: "scope", label: "Scope notes", icon: FileText },
];

const severityMeta: Record<Severity, { label: string; color: string; bg: string; icon: LucideIcon }> = {
  critical: { label: "Critical", color: "text-[#ff6b6b]", bg: "bg-[#ff6b6b]/10 border-[#ff6b6b]/25", icon: AlertCircle },
  high: { label: "High", color: "text-[#ffab5c]", bg: "bg-[#ffab5c]/10 border-[#ffab5c]/25", icon: TriangleAlert },
  medium: { label: "Medium", color: "text-[#f3d56b]", bg: "bg-[#f3d56b]/10 border-[#f3d56b]/25", icon: AlertCircle },
  low: { label: "Low", color: "text-[#79d6aa]", bg: "bg-[#79d6aa]/10 border-[#79d6aa]/25", icon: Check },
  info: { label: "Info", color: "text-[#7db6ff]", bg: "bg-[#7db6ff]/10 border-[#7db6ff]/25", icon: CircleHelp },
};

const PRESETS: { label: string; name: string; base_url: string; model: string }[] = [
  { label: "Ollama", name: "ollama", base_url: "http://localhost:11434/v1", model: "" },
  { label: "LM Studio", name: "lmstudio", base_url: "http://localhost:1234/v1", model: "" },
  { label: "OpenCode Zen (DeepSeek)", name: "opencode-deepseek", base_url: "https://opencode.ai/zen/v1", model: "deepseek-v4.1-flash" },
];

/* ---------------------------------------------------------------- helpers */
// The backend stores naive UTC timestamps; treat them as UTC.
const toDate = (iso?: string | null) => (iso ? new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : `${iso}Z`) : null);
const ago = (iso?: string | null) => {
  const d = toDate(iso);
  if (!d || isNaN(d.getTime())) return "—";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};
const clock = (iso?: string | null) => toDate(iso)?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "";
const nowClock = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const renderMd = (text: string) => DOMPurify.sanitize(marked.parse(text, { async: false }) as string);

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* keep the HTTP status */
    }
    throw new Error(detail);
  }
  return response.json();
};

/* ------------------------------------------------------- small components */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}
function IconButton({ label, children, onClick, className = "" }: { label: string; children: React.ReactNode; onClick?: () => void; className?: string }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}
function KindBadge({ kind }: { kind: Kind }) {
  return <span className={`kind-badge ${kind}`}><span className="kind-dot" />{kind}</span>;
}
function SeverityBadge({ severity }: { severity: Severity }) {
  const meta = severityMeta[severity] ?? severityMeta.info;
  return <span className={`severity-badge ${meta.bg} ${meta.color}`}><meta.icon size={11} strokeWidth={2.5} />{meta.label}</span>;
}
function StatusBadge({ status }: { status: FindingStatus }) {
  const labels: Record<FindingStatus, string> = { open: "Open", verified: "Verified", fixed: "Fixed", wontfix: "Won't fix" };
  return <span className={`status-badge ${status}`}><span className="status-dot" />{labels[status] ?? status}</span>;
}
function Empty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: React.ReactNode }) {
  return <div className="empty-state"><Icon size={21} /><strong>{title}</strong>{text && <span>{text}</span>}{action}</div>;
}
function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-card"><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label="Close dialog" onClick={onClose}><X size={16} /></IconButton></div>{children}</div></div>;
}
function DetailBlock({ label, value, icon: Icon, wide = false, code = false }: { label: string; value: string; icon: LucideIcon; wide?: boolean; code?: boolean }) {
  return <div className={`detail-block ${wide ? "wide" : ""}`}><div className="detail-label"><Icon size={13} />{label}</div><div className={code ? "evidence-block" : "detail-value"}>{value || "—"}</div></div>;
}

/* ------------------------------------------------------------------- Home */
export default function Home() {
  const [backend, setBackend] = useState<"loading" | "ok" | "error">("loading");
  const [backendError, setBackendError] = useState("");
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [counts, setCounts] = useState<Record<number, { targets: number; findings: number }>>({});
  const [activeId, setActiveId] = useState<number | null>(null);
  const [area, setArea] = useState<Area>("overview");
  const [targets, setTargets] = useState<Target[]>([]);
  const [runs, setRuns] = useState<ToolRun[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProvider, setActiveProvider] = useState("");
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [loadingChat, setLoadingChat] = useState(false);
  const [ctxInfo, setCtxInfo] = useState<CtxInfo | null>(null);
  const [runningTarget, setRunningTarget] = useState<number | null>(null);
  const [scopeDraft, setScopeDraft] = useState("");
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [showEngagements, setShowEngagements] = useState(false);
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [modal, setModal] = useState<
    | { type: "engagement" } | { type: "target" } | { type: "command" } | { type: "report" }
    | { type: "finding"; finding?: Finding; evidence?: string; title?: string }
    | { type: "provider"; provider?: Provider }
    | null
  >(null);
  const latestId = useRef<number | null>(null);

  const activeEngagement = engagements.find((e) => e.id === activeId) ?? null;
  const activeProviderData = providers.find((p) => p.name === activeProvider) ?? providers[0] ?? null;

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.setTimeout(() => setToast(null), error ? 5000 : 2600);
  }, []);

  /* ---- loading ---- */
  const loadProviders = useCallback(async () => {
    const data = await api<ProviderResponse>("/api/providers");
    setActiveProvider(data.active);
    setProviders((prev) => Object.entries(data.providers).map(([name, p]) => ({
      name, model: p.model, base_url: p.base_url, context_tokens: p.context_tokens, hasKey: !!p.api_key,
      state: name === data.active ? "active" : prev.find((x) => x.name === name)?.state === "offline" ? "offline" : "ready",
      latency: prev.find((x) => x.name === name)?.latency ?? "—",
    })));
  }, []);

  const loadEngagements = useCallback(async (selectId?: number) => {
    const list = await api<Engagement[]>("/api/engagements");
    setEngagements(list);
    setActiveId((cur) => selectId ?? (list.some((e) => e.id === cur) ? cur : list[0]?.id ?? null));
    const entries = await Promise.all(list.map(async (e) => {
      try {
        const [t, f] = await Promise.all([api<Target[]>(`/api/engagements/${e.id}/targets`), api<Finding[]>(`/api/engagements/${e.id}/findings`)]);
        return [e.id, { targets: t.length, findings: f.length }] as const;
      } catch { return [e.id, { targets: 0, findings: 0 }] as const; }
    }));
    setCounts(Object.fromEntries(entries));
  }, []);

  const boot = useCallback(async () => {
    setBackend("loading");
    try {
      await Promise.all([loadEngagements(), loadProviders(), api<{ tools: string[] }>("/api/tools/allowed").then((r) => setAllowedTools(r.tools))]);
      setBackend("ok");
    } catch (e) {
      setBackendError(errText(e));
      setBackend("error");
    }
  }, [loadEngagements, loadProviders]);

  useEffect(() => { boot(); }, [boot]);

  const loadWorkspace = useCallback(async (id: number) => {
    latestId.current = id;
    try {
      const [t, f, h] = await Promise.all([
        api<Target[]>(`/api/engagements/${id}/targets`),
        api<Finding[]>(`/api/engagements/${id}/findings`),
        api<{ role: "user" | "assistant"; content: string; created_at: string }[]>(`/api/chat/history?engagement_id=${id}`),
      ]);
      const r = (await Promise.all(t.map((x) => api<ToolRun[]>(`/api/tools/runs/${x.id}`)))).flat();
      if (latestId.current !== id) return;
      setTargets(t); setFindings(f); setRuns(r);
      setChat(h.map((m) => ({ role: m.role, content: m.content, created_at: clock(m.created_at) })));
      setCounts((c) => ({ ...c, [id]: { targets: t.length, findings: f.length } }));
    } catch (e) {
      notify(errText(e), true);
    }
  }, [notify]);

  useEffect(() => {
    if (activeId === null) { setTargets([]); setFindings([]); setRuns([]); setChat([]); return; }
    loadWorkspace(activeId);
  }, [activeId, loadWorkspace]);

  useEffect(() => { setScopeDraft(activeEngagement?.scope_notes ?? ""); }, [activeEngagement?.id, activeEngagement?.scope_notes]);

  /* ---- derived ---- */
  const filteredFindings = useMemo(() => findings.filter((f) => `${f.title} ${f.description}`.toLowerCase().includes(search.toLowerCase())), [findings, search]);
  const filteredTargets = useMemo(() => targets.filter((t) => `${t.value} ${t.notes}`.toLowerCase().includes(search.toLowerCase())), [targets, search]);
  const openFindings = findings.filter((f) => f.status === "open" || f.status === "verified").length;
  const highCount = findings.filter((f) => (f.severity === "critical" || f.severity === "high") && f.status !== "fixed" && f.status !== "wontfix").length;

  /* ---- actions ---- */
  const navigate = (next: Area) => { setArea(next); setMobileNav(false); setSearch(""); };

  const selectEngagement = (id: number) => { setActiveId(id); setArea("overview"); setShowEngagements(false); };

  const createEngagement = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const created = await api<Engagement>("/api/engagements", { method: "POST", body: JSON.stringify({ name: String(f.get("name")), kind: String(f.get("kind")), scope_notes: String(f.get("scope") || "") }) });
      setModal(null);
      await loadEngagements(created.id);
      setArea("overview");
      notify("Engagement created");
    } catch (err) { notify(errText(err), true); }
  };

  const deleteEngagement = async () => {
    if (!activeEngagement || !window.confirm(`Delete "${activeEngagement.name}" and all its targets, findings and runs?`)) return;
    try {
      await api(`/api/engagements/${activeEngagement.id}`, { method: "DELETE" });
      setActiveId(null);
      await loadEngagements();
      notify("Engagement deleted");
    } catch (err) { notify(errText(err), true); }
  };

  const saveScope = async () => {
    if (!activeEngagement) return;
    try {
      await api(`/api/engagements/${activeEngagement.id}/scope`, { method: "PUT", body: JSON.stringify({ scope_notes: scopeDraft }) });
      setEngagements((cur) => cur.map((e) => (e.id === activeEngagement.id ? { ...e, scope_notes: scopeDraft } : e)));
      notify("Scope notes saved");
    } catch (err) { notify(errText(err), true); }
  };

  const addTarget = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeId) return;
    const f = new FormData(e.currentTarget);
    try {
      await api(`/api/engagements/${activeId}/targets`, { method: "POST", body: JSON.stringify({ value: String(f.get("value")).trim(), notes: String(f.get("notes") || "") }) });
      setModal(null);
      await loadWorkspace(activeId);
      notify("Target added");
    } catch (err) { notify(errText(err), true); }
  };

  const deleteTarget = async (t: Target) => {
    if (!window.confirm(`Delete target ${t.value} and its run history?`)) return;
    try {
      await api(`/api/engagements/targets/${t.id}`, { method: "DELETE" });
      if (activeId) await loadWorkspace(activeId);
      notify("Target deleted");
    } catch (err) { notify(errText(err), true); }
  };

  const runTool = async (target: Target, tool: string, args: string) => {
    setRunningTarget(target.id);
    try {
      const run = await api<ToolRun>(`/api/tools/run/${target.id}`, { method: "POST", body: JSON.stringify({ tool, args }) });
      setRuns((cur) => [run, ...cur]);
      notify(run.exit_code === 0 ? `${tool} finished` : `${tool} exited with code ${run.exit_code}: see output`, run.exit_code !== 0);
    } catch (err) { notify(errText(err), true); }
    finally { setRunningTarget(null); }
  };

  const saveFinding = async (e: React.FormEvent<HTMLFormElement>, existing?: Finding) => {
    e.preventDefault();
    if (!activeId) return;
    const f = new FormData(e.currentTarget);
    const body = JSON.stringify(Object.fromEntries(["title", "severity", "status", "description", "evidence", "remediation"].map((k) => [k, String(f.get(k) ?? "")])));
    try {
      if (existing) await api(`/api/engagements/findings/${existing.id}`, { method: "PATCH", body });
      else await api(`/api/engagements/${activeId}/findings`, { method: "POST", body });
      setModal(null);
      await loadWorkspace(activeId);
      notify(existing ? "Finding updated" : "Finding added");
    } catch (err) { notify(errText(err), true); }
  };

  const setFindingStatus = async (f: Finding, status: FindingStatus) => {
    try {
      await api(`/api/engagements/findings/${f.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setFindings((cur) => cur.map((x) => (x.id === f.id ? { ...x, status } : x)));
    } catch (err) { notify(errText(err), true); }
  };

  const deleteFinding = async (f: Finding) => {
    if (!window.confirm(`Delete finding "${f.title}"?`)) return;
    try {
      await api(`/api/engagements/findings/${f.id}`, { method: "DELETE" });
      if (activeId) await loadWorkspace(activeId);
      notify("Finding deleted");
    } catch (err) { notify(errText(err), true); }
  };

  const refreshCtx = useCallback(async () => {
    try {
      const c = await api<{ tokens: number; source: string; note: string }>("/api/chat/context");
      setCtxInfo((prev) => ({ ...(prev ?? {}), budget: c.tokens, source: c.source, note: c.note, used: prev?.used }));
    } catch { /* indicator is optional */ }
  }, []);
  useEffect(() => { refreshCtx(); }, [refreshCtx, activeProvider]);

  const clearChat = async () => {
    if (!activeId || !window.confirm("Clear this engagement's chat history? Findings, targets and scans are kept.")) return;
    try {
      await api(`/api/chat/history?engagement_id=${activeId}`, { method: "DELETE" });
      setChat([]);
      setCtxInfo((c) => (c ? { ...c, used: undefined, dropped_turns: 0 } : c));
      notify("Chat cleared");
    } catch (err) { notify(errText(err), true); }
  };

  const sendMessage = async () => {
    const trimmed = message.trim();
    if (!trimmed || loadingChat || !activeId) return;
    setChat((c) => [...c, { role: "user", content: trimmed, created_at: nowClock() }]);
    setMessage("");
    setArea("chat");
    setLoadingChat(true);
    try {
      const r = await api<{ reply: string; context?: CtxInfo }>("/api/chat", { method: "POST", body: JSON.stringify({ message: trimmed, engagement_id: activeId }) });
      setChat((c) => [...c, { role: "assistant", content: r.reply, created_at: nowClock() }]);
      if (r.context) setCtxInfo(r.context);
      // A chat-triggered scan adds a target / tool run: refresh the panels and counts.
      if (r.reply.startsWith("**Ran `")) loadWorkspace(activeId);
    } catch (err) {
      setChat((c) => [...c, { role: "assistant", error: true, created_at: nowClock(), content: `**Couldn't get a reply.**\n\n${errText(err)}\n\nCheck that your model server (Ollama / LM Studio) is running and that the active provider's URL and model are right.` }]);
    } finally { setLoadingChat(false); }
  };

  const activateProvider = async (name: string) => {
    try {
      await api(`/api/providers/${encodeURIComponent(name)}/activate`, { method: "POST" });
      await loadProviders();
      setShowProviderMenu(false);
      notify(`${name} is now the active provider`);
    } catch (err) { notify(errText(err), true); }
  };

  const testProvider = async (name: string) => {
    const t0 = performance.now();
    try {
      const r = await api<{ models: string[] }>(`/api/providers/${encodeURIComponent(name)}/models`);
      const ms = `${Math.round(performance.now() - t0)} ms`;
      setProviders((cur) => cur.map((p) => (p.name === name ? { ...p, latency: ms, state: p.name === activeProvider ? "active" : "ready" } : p)));
      notify(`${name}: reachable, ${r.models.length} model${r.models.length === 1 ? "" : "s"}${r.models.length ? ` (${r.models.slice(0, 3).join(", ")}${r.models.length > 3 ? ", …" : ""})` : ""}`);
    } catch (err) {
      setProviders((cur) => cur.map((p) => (p.name === name ? { ...p, latency: "—", state: "offline" } : p)));
      notify(`${name}: ${errText(err)}`, true);
    }
  };

  const saveProvider = async (e: React.FormEvent<HTMLFormElement>, existing?: Provider) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const key = String(f.get("api_key") ?? "");
    try {
      await api("/api/providers", { method: "PUT", body: JSON.stringify({ name: existing?.name ?? String(f.get("name")).trim(), base_url: String(f.get("base_url")).trim(), model: String(f.get("model")).trim(), api_key: key === "" && existing?.hasKey ? "***" : key, context_tokens: Number(f.get("context_tokens")) || null }) });
      refreshCtx();
      setModal(null);
      await loadProviders();
      notify("Provider saved");
    } catch (err) { notify(errText(err), true); }
  };

  const deleteProvider = async (name: string) => {
    if (!window.confirm(`Remove provider "${name}"?`)) return;
    try { await api(`/api/providers/${encodeURIComponent(name)}`, { method: "DELETE" }); await loadProviders(); notify("Provider removed"); }
    catch (err) { notify(errText(err), true); }
  };

  const exportReport = async (pdf = false) => {
    if (!activeEngagement) return;
    try {
      const r = await fetch(`/api/reports/${activeEngagement.id}/export?pdf=${pdf}`, { method: "POST" });
      if (!r.ok) {
        let d = `Export failed (${r.status})`;
        try { d = (await r.json()).detail || d; } catch { /* keep status */ }
        throw new Error(d);
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${activeEngagement.name.replace(/[^\w-]+/g, "_")}.${pdf ? "pdf" : "md"}`;
      a.click();
      URL.revokeObjectURL(a.href);
      notify(`${pdf ? "PDF" : "Markdown"} report exported`);
    } catch (err) { notify(errText(err), true); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setModal({ type: "command" }); }
      if (e.key === "Escape") setModal((m) => (m ? null : m));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- render ---- */
  const shown = activeEngagement;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><span>H</span><span className="brand-mark-scan" /></div>
          <div><div className="brand-name">Hacker<span>-AI</span></div><div className="brand-sub">operator console</div></div>
          <IconButton label="Close navigation" className="mobile-close" onClick={() => setMobileNav(false)}><X size={16} /></IconButton>
        </div>

        <div className="local-chip"><span className="online-dot" /><span>LOCAL INSTANCE</span><span className="chip-address">{window.location.host}</span></div>

        <button className="engagement-switcher" onClick={() => setShowEngagements((s) => !s)}>
          <div className="switcher-icon"><Crosshair size={15} /></div>
          <div className="switcher-copy"><SectionLabel>Active engagement</SectionLabel><strong>{shown?.name ?? "None yet"}</strong></div>
          <ChevronDown size={15} className={showEngagements ? "rotate-180" : ""} />
        </button>
        {showEngagements && (
          <div className="engagement-menu">
            {engagements.map((e) => (
              <button key={e.id} className={`engagement-option ${e.id === activeId ? "selected" : ""}`} onClick={() => selectEngagement(e.id)}>
                <div><strong>{e.name}</strong><small>{plural(counts[e.id]?.targets ?? 0, "target")} <span>·</span> {plural(counts[e.id]?.findings ?? 0, "finding")}</small></div>
                {e.id === activeId && <Check size={14} />}
              </button>
            ))}
            <button className="new-engagement-link" onClick={() => { setShowEngagements(false); setModal({ type: "engagement" }); }}><Plus size={14} /> New engagement</button>
          </div>
        )}

        <div className="sidebar-nav">
          <SectionLabel>Workspace</SectionLabel>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${area === id ? "active" : ""}`} onClick={() => navigate(id)}>
              <Icon size={16} /><span>{label}</span>
              {id === "findings" && findings.length > 0 && <span className="nav-count">{findings.length}</span>}
              {area === id && <span className="nav-active-line" />}
            </button>
          ))}
          <SectionLabel>Manage</SectionLabel>
          <button className={`nav-item ${area === "reports" ? "active" : ""}`} onClick={() => navigate("reports")}><FileCode2 size={16} /><span>Reports</span></button>
          <button className={`nav-item ${area === "providers" ? "active" : ""}`} onClick={() => navigate("providers")}><Cpu size={16} /><span>LLM providers</span><span className="nav-status" /></button>
        </div>

        <div className="sidebar-bottom">
          <div className="usage-card">
            <div className="usage-head"><span>Backend</span><span className="usage-value">{backend === "ok" ? "Online" : backend === "loading" ? "…" : "Offline"}</span></div>
            <div className="health-meter"><span style={{ width: backend === "ok" ? "100%" : backend === "loading" ? "40%" : "8%" }} /></div>
            <div className="usage-foot"><span>{plural(engagements.length, "engagement")}</span><span>{activeProviderData?.name ?? "no provider"}</span></div>
          </div>
          <div className="sidebar-footer">
            <button onClick={() => notify("Ctrl+K opens the command palette")}><CircleHelp size={15} /> Help</button>
            <button onClick={() => navigate("providers")}><Settings2 size={15} /> Settings</button>
            <div className="avatar"><UserRound size={13} /></div>
          </div>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <IconButton label="Open navigation" className="mobile-menu" onClick={() => setMobileNav(true)}><Menu size={18} /></IconButton>
            <div className="crumb"><span>Engagements</span><ChevronRight size={13} /><strong>{shown?.name ?? "—"}</strong></div>
          </div>
          <div className="topbar-actions">
            <button className="command-trigger" onClick={() => setModal({ type: "command" })}><Search size={15} /><span>Search everything</span><kbd>Ctrl K</kbd></button>
            <div className="provider-wrap">
              <button className="provider-pill" onClick={() => setShowProviderMenu((s) => !s)}><span className="provider-signal" /><span>{activeProviderData?.name ?? "No provider"}</span><ChevronDown size={13} /></button>
              {showProviderMenu && (
                <div className="provider-menu">
                  {providers.map((p) => (
                    <button key={p.name} onClick={() => activateProvider(p.name)} className={activeProvider === p.name ? "selected" : ""}>
                      <span className={`provider-signal ${p.state}`} /><span><strong>{p.name}</strong><small>{p.model || "no model set"}</small></span>{activeProvider === p.name && <Check size={14} />}
                    </button>
                  ))}
                  <div className="provider-menu-foot" onClick={() => { setShowProviderMenu(false); navigate("providers"); }}><Settings2 size={13} /> Manage providers <ArrowUpRight size={12} /></div>
                </div>
              )}
            </div>
            <IconButton label="Command palette" onClick={() => setModal({ type: "command" })}><Command size={17} /></IconButton>
            <IconButton label="Reload data" onClick={() => { boot(); if (activeId) loadWorkspace(activeId); }}><RefreshCw size={16} /></IconButton>
          </div>
        </header>

        <div className="workspace">
          {backend === "error" && (
            <div className="content-panel"><Empty icon={Server} title="Can't reach the Hacker-AI backend" text={backendError} action={<button className="primary-button" onClick={boot}><RefreshCw size={14} /> Retry</button>} /></div>
          )}
          {backend === "loading" && <div className="content-panel"><Empty icon={Activity} title="Connecting…" /></div>}

          {backend === "ok" && !shown && area !== "providers" && (
            <div className="content-panel"><Empty icon={Crosshair} title="No engagements yet" text="Create one to start tracking targets, findings and tool runs." action={<button className="primary-button" onClick={() => setModal({ type: "engagement" })}><Plus size={15} /> New engagement</button>} /></div>
          )}

          {backend === "ok" && (shown || area === "providers") && (
            <>
              {shown && (
                <div className="workspace-header">
                  <div>
                    <div className="title-kicker"><span className="kicker-code">PT-{String(shown.id).padStart(3, "0")}</span><span className="slash">/</span><KindBadge kind={shown.kind} /><span className="status-pulse" /> <span className="live-label">CONNECTED</span></div>
                    <h1>{shown.name}</h1>
                    <p className="workspace-description">
                      <span>{shown.kind === "pentest" ? "Penetration test workspace" : shown.kind === "ctf" ? "Capture-the-flag challenge workspace" : "Hands-on lab practice environment"}</span>
                      <span className="description-divider" /><span>Created {ago(shown.created_at)}</span>
                    </p>
                  </div>
                  <div className="header-buttons">
                    <button className="quiet-button" onClick={deleteEngagement}><Trash2 size={15} /> Delete</button>
                    <button className="quiet-button" onClick={() => setModal({ type: "report" })}><FileText size={15} /> Report</button>
                    <button className="primary-button" onClick={() => navigate("chat")}><Sparkles size={15} /> Ask AI</button>
                  </div>
                </div>
              )}

              {shown && area !== "reports" && area !== "providers" && (
                <div className="stats-grid">
                  <div className="stat-card"><div className="stat-icon lime"><Crosshair size={16} /></div><div><span>Targets</span><strong>{targets.length}</strong></div><span className="stat-trend neutral">{new Set(runs.map((r) => r.target_id)).size} <small>scanned</small></span></div>
                  <div className="stat-card"><div className="stat-icon red"><ShieldCheck size={16} /></div><div><span>Open findings</span><strong>{openFindings}</strong></div><span className={`stat-trend ${highCount ? "warn" : "neutral"}`}>{highCount} <small>high / critical</small></span></div>
                  <div className="stat-card"><div className="stat-icon blue"><TerminalSquare size={16} /></div><div><span>Tool runs</span><strong>{runs.length}</strong></div><span className="stat-trend neutral">{runs.filter((r) => r.exit_code !== 0).length} <small>non-zero exit</small></span></div>
                  <div className="stat-card"><div className="stat-icon amber"><Bot size={16} /></div><div><span>AI provider</span><strong className="stat-provider">{activeProviderData?.name ?? "—"}</strong></div><span className="stat-trend up"><Wifi size={12} /> {activeProviderData?.model || "no model"}</span></div>
                </div>
              )}

              {shown && area === "overview" && <Overview navigate={navigate} findings={findings} targets={targets} runs={runs} allowedTools={allowedTools} provider={activeProviderData} />}
              {shown && area === "chat" && <ChatPanel chat={chat} message={message} setMessage={setMessage} onSend={sendMessage} loading={loadingChat} provider={activeProviderData} counts={{ targets: targets.length, findings: findings.length, runs: runs.length }} hasScope={!!shown.scope_notes.trim()} ctx={ctxInfo} onClear={clearChat} />}
              {shown && area === "targets" && <TargetsPanel targets={filteredTargets} runs={runs} allowedTools={allowedTools} search={search} setSearch={setSearch} runTool={runTool} running={runningTarget} onAdd={() => setModal({ type: "target" })} onDelete={deleteTarget} onSaveFinding={(r, t) => setModal({ type: "finding", title: `${r.tool} result: ${t.value}`, evidence: r.output.slice(0, 4000) })} />}
              {shown && area === "findings" && <FindingsPanel findings={filteredFindings} search={search} setSearch={setSearch} onAdd={() => setModal({ type: "finding" })} onEdit={(f) => setModal({ type: "finding", finding: f })} onDelete={deleteFinding} onStatus={setFindingStatus} />}
              {shown && area === "scope" && <ScopePanel draft={scopeDraft} setDraft={setScopeDraft} save={saveScope} engagementId={shown.id} targetCount={targets.length} allowedTools={allowedTools} />}
              {shown && area === "reports" && <ReportsPanel engagement={shown} findings={findings} targets={targets} runs={runs} provider={activeProviderData} onPreview={() => setModal({ type: "report" })} onExport={exportReport} />}
              {area === "providers" && <ProvidersPanel providers={providers} active={activeProvider} onActivate={activateProvider} onTest={testProvider} onAdd={() => setModal({ type: "provider" })} onEdit={(p) => setModal({ type: "provider", provider: p })} onDelete={deleteProvider} />}
            </>
          )}
        </div>
      </main>

      {modal?.type === "engagement" && (
        <Modal title="New engagement" onClose={() => setModal(null)}>
          <form className="form-stack" onSubmit={createEngagement}>
            <label>Engagement name<input name="name" placeholder="e.g. Product red team" autoFocus required /></label>
            <label>Type<select name="kind" defaultValue="pentest"><option value="pentest">Pentest</option><option value="ctf">CTF</option><option value="lab">Lab</option></select></label>
            <label>Scope notes<textarea name="scope" placeholder="Authorization, in-scope assets, rules of engagement…" rows={4} /></label>
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button"><Plus size={15} /> Create engagement</button></div>
          </form>
        </Modal>
      )}
      {modal?.type === "target" && (
        <Modal title="Add target" subtitle="Only add systems you're authorized to test." onClose={() => setModal(null)}>
          <form className="form-stack" onSubmit={addTarget}>
            <label>Host, IP, URL or CIDR<input name="value" placeholder="app.example.local" autoFocus required /></label>
            <label>Notes<textarea name="notes" rows={3} /></label>
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button"><Plus size={15} /> Add target</button></div>
          </form>
        </Modal>
      )}
      {modal?.type === "finding" && (
        <Modal title={modal.finding ? "Edit finding" : "New finding"} onClose={() => setModal(null)}>
          <form className="form-stack" onSubmit={(e) => saveFinding(e, modal.finding)}>
            <label>Title<input name="title" defaultValue={modal.finding?.title ?? modal.title ?? ""} autoFocus required /></label>
            <div className="form-row-2">
              <label>Severity<select name="severity" defaultValue={modal.finding?.severity ?? "info"}>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select></label>
              <label>Status<select name="status" defaultValue={modal.finding?.status ?? "open"}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
            </div>
            <label>Description<textarea name="description" rows={3} defaultValue={modal.finding?.description ?? ""} /></label>
            <label>Evidence<textarea name="evidence" rows={5} defaultValue={modal.finding?.evidence ?? modal.evidence ?? ""} style={{ fontFamily: "ui-monospace, Menlo, monospace" }} /></label>
            <label>Remediation<textarea name="remediation" rows={3} defaultValue={modal.finding?.remediation ?? ""} /></label>
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button"><Check size={15} /> Save finding</button></div>
          </form>
        </Modal>
      )}
      {modal?.type === "provider" && <ProviderModal provider={modal.provider} onClose={() => setModal(null)} onSubmit={saveProvider} />}
      {modal?.type === "report" && activeEngagement && <ReportModal engagement={activeEngagement} onClose={() => setModal(null)} onExport={exportReport} />}
      {modal?.type === "command" && <CommandModal engagements={engagements} onClose={() => setModal(null)} onNavigate={(a) => { navigate(a); setModal(null); }} onSelect={(id) => { selectEngagement(id); setModal(null); }} onNew={() => setModal({ type: "engagement" })} />}
      {toast && <div className={`toast ${toast.error ? "error" : ""}`}>{toast.error ? <TriangleAlert size={15} /> : <Check size={15} />} {toast.text}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- Overview */
function Overview({ navigate, findings, targets, runs, allowedTools, provider }: { navigate: (a: Area) => void; findings: Finding[]; targets: Target[]; runs: ToolRun[]; allowedTools: string[]; provider: Provider | null }) {
  const priority = [...findings].filter((f) => f.status !== "fixed" && f.status !== "wontfix").sort((a, b) => sevRank(a.severity) - sevRank(b.severity)).slice(0, 3);
  const latestRun = [...runs].sort((a, b) => (toDate(b.started_at)?.getTime() ?? 0) - (toDate(a.started_at)?.getTime() ?? 0))[0];
  const scanned = new Set(runs.map((r) => r.target_id)).size;
  const pct = targets.length ? Math.round((scanned / targets.length) * 100) : 0;
  const events = [
    ...findings.map((f) => ({ icon: ShieldCheck, tone: f.severity === "critical" || f.severity === "high" ? "red" : "amber", at: f.created_at, title: "Finding recorded", detail: f.title })),
    ...runs.map((r) => ({ icon: TerminalSquare, tone: "blue", at: r.finished_at ?? r.started_at, title: `${r.tool} ${r.exit_code === 0 ? "completed" : `exited ${r.exit_code}`}`, detail: r.args || "no arguments" })),
    ...targets.map((t) => ({ icon: Crosshair, tone: "lime", at: t.created_at, title: "Target added", detail: t.value })),
  ].sort((a, b) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0)).slice(0, 5);
  const targetValue = (id: number) => targets.find((t) => t.id === id)?.value ?? `target ${id}`;

  return (
    <div className="overview-grid">
      <section className="overview-main">
        <div className="overview-hero">
          <div className="hero-grid" />
          <div className="hero-content">
            <div className="hero-top"><span className="hero-icon"><Sparkles size={17} /></span><span>AI-assisted workflow</span><span className="hero-rule" /><span className="hero-model">{provider?.model || provider?.name || "no provider"}</span></div>
            <h2>Make the next move<br /><em>with context.</em></h2>
            <p>Your scope, targets, findings and tool output are injected into every copilot prompt, so answers stay grounded in this engagement.</p>
            <button className="hero-action" onClick={() => navigate("chat")}>Open AI copilot <ArrowUpRight size={15} /></button>
          </div>
          <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-glow" />
        </div>

        <div className="panel-header"><div><SectionLabel>Priority findings</SectionLabel><h3>Needs attention</h3></div><button className="text-button" onClick={() => navigate("findings")}>View all findings <ArrowUpRight size={13} /></button></div>
        <div className="findings-table">
          {priority.map((f, i) => (
            <div className="finding-row" key={f.id}>
              <span className="finding-index">0{i + 1}</span>
              <div className="finding-title"><strong>{f.title}</strong><span>{f.description || "No description"}</span></div>
              <SeverityBadge severity={f.severity} /><StatusBadge status={f.status} />
              <span className="finding-date">{ago(f.created_at)}</span><ChevronRight size={15} className="row-arrow" />
            </div>
          ))}
          {priority.length === 0 && <Empty icon={ShieldCheck} title="No open findings" text="Add findings as you work, or run a tool against a target." />}
        </div>

        <div className="overview-lower">
          <div className="mini-panel">
            <div className="mini-panel-head"><div><SectionLabel>Target coverage</SectionLabel><h3>{targets.length} target{targets.length === 1 ? "" : "s"}</h3></div></div>
            <div className="coverage-visual">
              <div className="coverage-ring" style={{ background: `conic-gradient(var(--lime) 0deg ${pct * 3.6}deg, rgba(255,255,255,.08) ${pct * 3.6}deg 360deg)` }}><div><strong>{pct}</strong><span>% scanned</span></div></div>
              <div className="coverage-legend"><div><span className="legend-dot lime" />Scanned <strong>{scanned}</strong></div><div><span className="legend-dot amber" />Not scanned <strong>{targets.length - scanned}</strong></div></div>
            </div>
          </div>
          <div className="mini-panel">
            <div className="mini-panel-head"><div><SectionLabel>Latest tool run</SectionLabel><h3>{latestRun ? latestRun.tool : "No runs yet"}</h3></div>{latestRun && <span className="running-chip"><span /> {latestRun.exit_code === 0 ? "Completed" : `Exit ${latestRun.exit_code}`}</span>}</div>
            {latestRun ? (
              <div className="run-card"><div className="run-icon"><TerminalSquare size={15} /></div><div className="run-copy"><strong>{latestRun.tool} {latestRun.args}</strong><span>{targetValue(latestRun.target_id)}</span></div><div className="run-time">{ago(latestRun.finished_at ?? latestRun.started_at)}</div></div>
            ) : <Empty icon={TerminalSquare} title="Nothing run yet" text="Pick a target and launch a tool." />}
            <button className="run-link" onClick={() => navigate("targets")}>Open targets & tools <ArrowUpRight size={13} /></button>
          </div>
        </div>
      </section>

      <aside className="activity-rail">
        <div className="rail-head"><div><SectionLabel>Activity stream</SectionLabel><h3>What changed</h3></div></div>
        <div className="activity-timeline">
          {events.map((e, i) => <ActivityItem key={i} icon={e.icon} tone={e.tone} time={ago(e.at)} title={e.title} detail={e.detail} />)}
          {events.length === 0 && <Empty icon={Activity} title="No activity yet" />}
        </div>
        <div className="rail-footer"><div className="rail-footer-icon"><LockKeyhole size={15} /></div><div><strong>Whitelisted tools only</strong><span>{allowedTools.length ? allowedTools.join(", ") : "No tools allowed"}. Edit allowed_tools in backend/config.py.</span></div></div>
        <div className="quick-links"><SectionLabel>Quick actions</SectionLabel><button onClick={() => navigate("targets")}><Play size={13} /> Run a tool</button><button onClick={() => navigate("reports")}><Download size={13} /> Generate report</button></div>
      </aside>
    </div>
  );
}

function ActivityItem({ icon: Icon, tone, time, title, detail }: { icon: LucideIcon; tone: string; time: string; title: string; detail: string }) {
  return <div className="activity-item"><div className={`activity-icon ${tone}`}><Icon size={14} /></div><div className="activity-copy"><div><strong>{title}</strong><time>{time}</time></div><span>{detail}</span></div></div>;
}

/* ------------------------------------------------------------------- Chat */
function ChatPanel({ chat, message, setMessage, onSend, loading, provider, counts, hasScope, ctx, onClear }: { ctx: CtxInfo | null; onClear: () => void; chat: ChatMessage[]; message: string; setMessage: (m: string) => void; onSend: () => void; loading: boolean; provider: Provider | null; counts: { targets: number; findings: number; runs: number }; hasScope: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = end.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [chat.length, loading]);
  return (
    <div className="chat-layout">
      <section className="chat-panel">
        <div className="chat-header"><div><SectionLabel>Context-aware assistant</SectionLabel><h2>AI copilot</h2></div><div className="chat-model"><span className="provider-signal" />{provider?.name ?? "no provider"}<span className="chat-model-divider" />{provider?.model || "no model"}</div></div>
        <div className="chat-context"><div className="context-icon"><Layers3 size={15} /></div><div><strong>Engagement context injected</strong><span>{hasScope ? "Scope" : "No scope notes"} · {plural(counts.targets, "target")} · {plural(counts.findings, "finding")} · {plural(counts.runs, "tool run")}</span></div></div>
        <div className="chat-messages">
          {chat.length === 0 && !loading && <Empty icon={MessageSquareText} title="Ask anything about this engagement" text="Summarize findings, interpret tool output, plan the next step or draft a writeup." />}
          {chat.map((item, i) => (
            <div className={`chat-message ${item.role}`} key={i}>
              <div className="message-avatar">{item.role === "assistant" ? <Sparkles size={14} /> : <UserRound size={14} />}</div>
              <div className="message-body">
                <div className="message-meta"><strong>{item.role === "assistant" ? "Hacker-AI" : "You"}</strong><time>{item.created_at}</time></div>
                {item.role === "assistant" ? <div className="message-bubble md" style={item.error ? { borderColor: "rgba(255,123,118,.4)" } : undefined} dangerouslySetInnerHTML={{ __html: renderMd(item.content) }} /> : <div className="message-bubble" style={{ whiteSpace: "pre-wrap" }}>{item.content}</div>}
              </div>
            </div>
          ))}
          {loading && <div className="chat-message assistant"><div className="message-avatar"><Sparkles size={14} /></div><div className="message-body"><div className="message-meta"><strong>Hacker-AI</strong><time>thinking…</time></div><div className="message-bubble typing"><span /><span /><span /></div></div></div>}
          <div ref={end} />
        </div>
        <div className="chat-composer">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }} placeholder="Ask about this engagement…" rows={2} />
          <div className="composer-foot"><span><kbd>↵</kbd> send <kbd>⇧ ↵</kbd> new line{ctx?.budget ? <span className="ctx-meter" title={ctx.note || ctx.source}> · context {ctx.used ? `≈${(ctx.used / 1000).toFixed(1)}k / ` : ""}{(ctx.budget / 1000).toFixed(1)}k ({ctx.source}){ctx.dropped_turns ? ` · ${ctx.dropped_turns} old turns condensed` : ""}</span> : null}{chat.length > 0 && <button type="button" className="link-button" onClick={onClear}> · clear chat</button>}</span><button className="send-button" disabled={!message.trim() || loading} onClick={onSend}><Send size={15} /></button></div>
        </div>
      </section>
      <aside className="chat-sidebar">
        <SectionLabel>Suggested prompts</SectionLabel>
        <button onClick={() => setMessage("Summarize my open findings and rank them by risk.")}><span>Summarize findings</span><ArrowUpRight size={13} /></button>
        <button onClick={() => setMessage("Based on the tool output so far, what should I test next?")}><span>Plan next step</span><ArrowUpRight size={13} /></button>
        <button onClick={() => setMessage("Draft remediation guidance for my most severe open finding.")}><span>Draft remediation</span><ArrowUpRight size={13} /></button>
        <div className="chat-side-note"><Bot size={15} /><p>Replies can take 30+ seconds with a local model. You can keep using the rest of the workspace while it runs.</p></div>
      </aside>
    </div>
  );
}

/* ---------------------------------------------------------------- Targets */
function TargetsPanel({ targets, runs, allowedTools, search, setSearch, runTool, running, onAdd, onDelete, onSaveFinding }: { targets: Target[]; runs: ToolRun[]; allowedTools: string[]; search: string; setSearch: (v: string) => void; runTool: (t: Target, tool: string, args: string) => void; running: number | null; onAdd: () => void; onDelete: (t: Target) => void; onSaveFinding: (r: ToolRun, t: Target) => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tool, setTool] = useState("");
  const [args, setArgs] = useState("");
  const [openRun, setOpenRun] = useState<number | null>(null);
  const selected = targets.find((t) => t.id === selectedId) ?? targets[0] ?? null;
  useEffect(() => { if (!tool && allowedTools.length) setTool(allowedTools[0]); }, [allowedTools, tool]);
  const targetRuns = selected ? runs.filter((r) => r.target_id === selected.id).sort((a, b) => (toDate(b.started_at)?.getTime() ?? 0) - (toDate(a.started_at)?.getTime() ?? 0)) : [];
  const runCount = (id: number) => runs.filter((r) => r.target_id === id).length;

  return (
    <div className="content-panel">
      <div className="content-toolbar"><div><SectionLabel>Attack surface</SectionLabel><h2>Targets & tools</h2><p>Run whitelisted recon tools and keep output attached to each target.</p></div><button className="primary-button" onClick={onAdd}><Plus size={15} /> Add target</button></div>
      <div className="split-content">
        <div className="target-list">
          <div className="list-toolbar"><div className="inline-search"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter targets" /></div><button className="filter-button" tabIndex={-1}><Filter size={14} /></button></div>
          {targets.map((t) => (
            <button key={t.id} className={`target-item ${selected?.id === t.id ? "selected" : ""}`} onClick={() => setSelectedId(t.id)}>
              <div className={`target-state ${runCount(t.id) ? "online" : "unknown"}`}><Globe2 size={15} /></div>
              <div className="target-copy"><strong>{t.value}</strong><span>{t.notes || "No notes"}</span></div>
              <div className="target-meta"><span>{runCount(t.id)} runs</span><small>{ago(t.created_at)}</small></div>
              <ChevronRight size={15} className="row-arrow" />
            </button>
          ))}
          {targets.length === 0 && <Empty icon={Crosshair} title="No targets" text="Add a host, IP, URL or CTF instance you're authorized to test." />}
        </div>
        <div className="target-detail">
          {selected ? (
            <>
              <div className="detail-top">
                <div><div className="target-detail-title"><div className={`target-state ${runCount(selected.id) ? "online" : "unknown"}`}><Globe2 size={17} /></div><div><SectionLabel>Target {String(selected.id).padStart(2, "0")}</SectionLabel><h3>{selected.value}</h3></div></div><p>{selected.notes}</p></div>
                <IconButton label="Delete target" onClick={() => onDelete(selected)}><Trash2 size={16} /></IconButton>
              </div>
              <div className="tool-launcher">
                <div><SectionLabel>Run a whitelisted tool</SectionLabel><h3>Recon launcher</h3></div>
                <div className="tool-buttons">{allowedTools.map((t) => <button key={t} className={tool === t ? "active" : ""} style={tool === t ? { color: "var(--lime)", borderColor: "rgba(199,238,131,.5)" } : undefined} onClick={() => setTool(t)}><Zap size={14} /> {t}</button>)}</div>
                <label className="args-label">Arguments (the target is appended automatically)<input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-sV -T4" /></label>
                <button className="run-tool-button" disabled={!tool || running !== null} onClick={() => runTool(selected, tool, args)}><Play size={14} /> {running === selected.id ? "Running…" : `Run ${tool || "tool"}`} <span>{running === selected.id ? "Blocking run, can take minutes" : "Blocking run · output saved"}</span></button>
              </div>
              <div className="runs-section">
                <div className="panel-header"><div><SectionLabel>Run history</SectionLabel><h3>{targetRuns.length ? "Recent executions" : "No executions yet"}</h3></div></div>
                <div className="run-history">
                  {targetRuns.map((r) => (
                    <div key={r.id}>
                      <div className="history-row" style={{ cursor: "pointer" }} onClick={() => setOpenRun(openRun === r.id ? null : r.id)}>
                        <div className="run-icon small"><TerminalSquare size={14} /></div>
                        <div><strong>{r.tool} {r.args}</strong><span>{r.output.split("\n")[0] || "no output"}</span></div>
                        <span className="history-status"><span />exit {r.exit_code}</span>
                        <div className="history-time">{ago(r.started_at)}</div>
                        <ChevronRight size={14} className="row-arrow" />
                      </div>
                      {openRun === r.id && (
                        <div style={{ padding: "8px 0 12px" }}>
                          <div className="evidence-block" style={{ maxHeight: 320, overflow: "auto" }}>{r.output || "(no output)"}</div>
                          <button className="quiet-button" style={{ marginTop: 8 }} onClick={() => onSaveFinding(r, selected)}><ShieldCheck size={14} /> Save as finding</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : <Empty icon={Crosshair} title="Select a target" text="Choose an asset to run tools and see its history." />}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Findings */
function FindingsPanel({ findings, search, setSearch, onAdd, onEdit, onDelete, onStatus }: { findings: Finding[]; search: string; setSearch: (v: string) => void; onAdd: () => void; onEdit: (f: Finding) => void; onDelete: (f: Finding) => void; onStatus: (f: Finding, s: FindingStatus) => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const visible = findings.filter((f) => filter === "all" || f.severity === filter).sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
  const selected = visible.find((f) => f.id === selectedId) ?? visible[0] ?? null;
  return (
    <div className="content-panel">
      <div className="content-toolbar"><div><SectionLabel>Risk register</SectionLabel><h2>Findings</h2><p>Evidence-backed issues for this engagement, from critical to informational.</p></div><button className="primary-button" onClick={onAdd}><Plus size={15} /> Add finding</button></div>
      <div className="finding-toolbar"><div className="inline-search"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or description" /></div><div className="filter-pills">{(["all", ...SEVERITIES] as const).map((s) => <button key={s} className={filter === s ? "active" : ""} onClick={() => setFilter(s)}>{s === "all" ? "All" : s}</button>)}</div></div>
      <div className="findings-split">
        <div className="finding-list">
          {visible.map((f) => (
            <button key={f.id} className={`finding-list-item ${selected?.id === f.id ? "selected" : ""}`} onClick={() => setSelectedId(f.id)}>
              <div className="finding-list-top"><SeverityBadge severity={f.severity} /><StatusBadge status={f.status} /></div>
              <strong>{f.title}</strong><span>{f.description || "No description"}</span><small>{ago(f.created_at)}</small>
            </button>
          ))}
          {visible.length === 0 && <Empty icon={ShieldCheck} title="No findings" text={findings.length ? "Nothing matches the current filter." : "Capture evidence as you work."} />}
        </div>
        <div className="finding-detail">
          {selected ? (
            <>
              <div className="detail-top">
                <div><div className="detail-breadcrumb">Finding #{selected.id} <span>·</span> {ago(selected.created_at)}</div><h3>{selected.title}</h3><div className="detail-badges"><SeverityBadge severity={selected.severity} /><StatusBadge status={selected.status} /></div></div>
                <IconButton label="Delete finding" onClick={() => onDelete(selected)}><Trash2 size={15} /></IconButton>
              </div>
              <div className="finding-detail-grid">
                <DetailBlock label="Description" value={selected.description} icon={FileText} wide />
                <DetailBlock label="Evidence" value={selected.evidence} icon={TerminalSquare} code wide />
                <DetailBlock label="Remediation" value={selected.remediation} icon={ShieldCheck} wide />
              </div>
              <div className="detail-actions">
                <select value={selected.status} onChange={(e) => onStatus(selected, e.target.value as FindingStatus)} className="quiet-button" style={{ background: "transparent", color: "inherit" }}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                <button className="primary-button" onClick={() => onEdit(selected)}><Pencil size={14} /> Edit finding</button>
              </div>
            </>
          ) : <Empty icon={ShieldCheck} title="Select a finding" text="Choose an issue to inspect evidence and remediation." />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Scope */
function ScopePanel({ draft, setDraft, save, engagementId, targetCount, allowedTools }: { draft: string; setDraft: (v: string) => void; save: () => void; engagementId: number; targetCount: number; allowedTools: string[] }) {
  const key = `hai-checklist-${engagementId}`;
  const items = ["Written authorization on file", "Every target is in scope", "Destructive actions ruled out", "Rate limits agreed"];
  const [done, setDone] = useState<boolean[]>(items.map(() => false));
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(key) || "null"); setDone(Array.isArray(v) && v.length === items.length ? v : items.map(() => false)); } catch { setDone(items.map(() => false)); } }, [key]);
  const toggle = (i: number) => setDone((cur) => { const n = cur.map((v, j) => (j === i ? !v : v)); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  return (
    <div className="content-panel scope-panel">
      <div className="content-toolbar"><div><SectionLabel>Rules of engagement</SectionLabel><h2>Scope notes</h2><p>Keep authorization, boundaries and test conditions attached to the workspace.</p></div><button className="primary-button" onClick={save}><Check size={15} /> Save notes</button></div>
      <div className="scope-grid">
        <div className="scope-editor">
          <div className="editor-toolbar"><span><FileText size={14} /> scope.md</span><span>Sent to the AI as context</span></div>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="editor-foot"><span><LockKeyhole size={12} /> Stored in your local SQLite database</span><span>{draft.length} characters</span></div>
        </div>
        <div className="scope-checklist">
          <SectionLabel>Personal checklist</SectionLabel><h3>Before you run a tool</h3>
          {items.map((label, i) => <div key={label} className="scope-check" style={{ cursor: "pointer" }} onClick={() => toggle(i)}><span className={done[i] ? "done" : "pending"}>{done[i] ? <Check size={11} /> : <span />}</span><span>{label}</span></div>)}
          <div className="scope-callout"><ShieldCheck size={16} /><span>This checklist is a reminder for you and isn't enforced. The backend only restricts <strong>which tools</strong> can run ({allowedTools.length ? allowedTools.join(", ") : "none"}), not which targets. This engagement has {targetCount} target{targetCount === 1 ? "" : "s"}.</span></div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Reports */
function ReportsPanel({ engagement, findings, targets, runs, provider, onPreview, onExport }: { engagement: Engagement; findings: Finding[]; targets: Target[]; runs: ToolRun[]; provider: Provider | null; onPreview: () => void; onExport: (pdf?: boolean) => void }) {
  const c = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  const max = Math.max(1, ...Object.values(c));
  return (
    <div className="content-panel reports-panel">
      <div className="content-toolbar"><div><SectionLabel>Deliverables</SectionLabel><h2>Reports</h2><p>Generate a markdown report from findings, evidence and tool runs.</p></div><div className="header-buttons"><button className="quiet-button" onClick={() => onExport(false)}><Download size={14} /> Export .md</button><button className="primary-button" onClick={() => onExport(true)}><Download size={14} /> Export .pdf</button></div></div>
      <div className="report-card">
        <div className="report-cover"><div className="report-mark"><FileCode2 size={23} /></div><SectionLabel>Security assessment</SectionLabel><h3>{engagement.name}</h3><p>Generated {new Date().toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}</p><div className="report-cover-rule" /><div className="report-mini-meta"><span>PT-{String(engagement.id).padStart(3, "0")}</span><span>{engagement.kind.toUpperCase()}</span><span>{findings.length} findings</span></div></div>
        <div className="report-summary">
          <div className="report-summary-head"><div><SectionLabel>Preview</SectionLabel><h3>At a glance</h3></div><button className="text-button" onClick={onPreview}>Open full preview <ArrowUpRight size={13} /></button></div>
          <p>{findings.length ? <>This engagement has <strong>{findings.length} finding{findings.length === 1 ? "" : "s"}</strong> across {targets.length} target{targets.length === 1 ? "" : "s"}; {c.critical + c.high} rated high or critical.</> : "No findings recorded yet. The report will list targets and tool runs only."}</p>
          <div className="severity-bars">{(["critical", "high", "medium", "low"] as Severity[]).map((s) => <div key={s}><span style={{ textTransform: "capitalize" }}>{s}</span><div><i className={s} style={{ width: `${(c[s] / max) * 100}%`, background: s === "low" ? "var(--lime)" : undefined }} /></div><strong>{c[s]}</strong></div>)}</div>
          <div className="report-meta-grid"><div><span>Targets</span><strong>{targets.length}</strong></div><div><span>Tool runs</span><strong>{runs.length} saved</strong></div><div><span>Provider</span><strong>{provider?.name ?? "—"}</strong></div></div>
        </div>
      </div>
      <div className="report-format-row"><div className="format-icon md">MD</div><div><strong>Markdown source</strong><span>Also saved to the backend's reports folder</span></div><button className="quiet-button" onClick={() => onExport(false)}>Download <Download size={13} /></button><div className="format-icon pdf">PDF</div><div><strong>PDF export</strong><span>Needs WeasyPrint installed on the backend</span></div><button className="quiet-button" onClick={() => onExport(true)}>Download <Download size={13} /></button></div>
    </div>
  );
}

function ReportModal({ engagement, onClose, onExport }: { engagement: Engagement; onClose: () => void; onExport: (pdf?: boolean) => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api<{ markdown: string }>(`/api/reports/${engagement.id}/preview`).then((r) => setHtml(renderMd(r.markdown))).catch((e) => setErr(errText(e))); }, [engagement.id]);
  return (
    <Modal title="Report preview" subtitle={`${engagement.name} · generated just now`} onClose={onClose}>
      <div className="report-preview" style={{ maxHeight: "60vh", overflow: "auto" }}>
        {err ? <div className="preview-callout"><TriangleAlert size={15} /><span>{err}</span></div> : html === null ? <p>Loading…</p> : <div className="md" dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
      <div className="modal-actions"><button className="quiet-button" onClick={() => onExport(false)}><Download size={14} /> Export markdown</button><button className="primary-button" onClick={() => onExport(true)}><Download size={14} /> Export PDF</button></div>
    </Modal>
  );
}

/* ------------------------------------------------------------- Providers */
function ProvidersPanel({ providers, active, onActivate, onTest, onAdd, onEdit, onDelete }: { providers: Provider[]; active: string; onActivate: (n: string) => void; onTest: (n: string) => void; onAdd: () => void; onEdit: (p: Provider) => void; onDelete: (n: string) => void }) {
  return (
    <div className="content-panel providers-panel">
      <div className="content-toolbar"><div><SectionLabel>Runtime routing</SectionLabel><h2>LLM providers</h2><p>Switch between local and hosted models without restarting anything.</p></div><button className="primary-button" onClick={onAdd}><Plus size={15} /> Add provider</button></div>
      <div className="provider-grid">
        {providers.map((p) => (
          <div className={`provider-card ${active === p.name ? "active" : ""}`} key={p.name}>
            <div className="provider-card-top"><div className={`provider-logo ${p.name}`}>{p.name[0]?.toUpperCase()}</div><span className={`mini-state ${p.state}`}>{p.state === "active" ? "Active" : p.state}</span></div>
            <h3>{p.name}</h3><p>{p.model || "no model set"}</p>
            <div className="provider-url"><Server size={12} />{p.base_url || "no base URL"}</div>
            <div className="provider-card-foot">
              <span><span className={`provider-signal ${p.state}`} />{p.latency === "—" ? "Not tested" : p.latency}{p.hasKey ? " · key set" : ""}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onTest(p.name)}>Test</button>
                <button onClick={() => onEdit(p)}>Edit</button>
                {active !== p.name && <button onClick={() => onDelete(p.name)} aria-label={`Remove ${p.name}`}><Trash2 size={13} /></button>}
                <button onClick={() => onActivate(p.name)}>{active === p.name ? <><Check size={13} /> Active</> : "Activate"}</button>
              </div>
            </div>
          </div>
        ))}
        {providers.length === 0 && <Empty icon={Cpu} title="No providers" text="Add Ollama, LM Studio or another OpenAI-compatible endpoint." />}
      </div>
      <div className="provider-note"><LockKeyhole size={15} /><div><strong>Keys stay on this machine</strong><span>API keys are stored by the backend in data/providers.json and are never sent back to the browser.</span></div></div>
    </div>
  );
}

function ProviderModal({ provider, onClose, onSubmit }: { provider?: Provider; onClose: () => void; onSubmit: (e: React.FormEvent<HTMLFormElement>, existing?: Provider) => void }) {
  const [preset, setPreset] = useState<(typeof PRESETS)[number] | null>(null);
  const v = (k: "name" | "base_url" | "model") => (provider ? provider[k] : preset ? preset[k] : "");
  return (
    <Modal title={provider ? `Edit ${provider.name}` : "Add provider"} subtitle="Any OpenAI-compatible /v1 endpoint works." onClose={onClose}>
      {!provider && <div className="tool-buttons" style={{ marginTop: 14 }}>{PRESETS.map((p) => <button key={p.name} type="button" onClick={() => setPreset(p)}>{p.label}</button>)}</div>}
      <form className="form-stack" key={preset?.name ?? provider?.name ?? "new"} onSubmit={(e) => onSubmit(e, provider)}>
        {!provider && <label>Name<input name="name" defaultValue={v("name")} placeholder="ollama-gemma" required /></label>}
        <label>Base URL<input name="base_url" defaultValue={v("base_url")} placeholder="http://localhost:11434/v1" required /></label>
        <label>Model id<input name="model" defaultValue={v("model")} placeholder="exact id shown by your server" required /></label>
        <label>Context tokens (blank = auto-detect; Ollama default 8192)<input name="context_tokens" type="number" min={1024} step={1024} defaultValue={provider?.context_tokens ?? ""} placeholder="auto" /></label>
        <label>API key {provider?.hasKey ? "(leave blank to keep the saved key)" : "(blank for local servers)"}<input name="api_key" type="password" autoComplete="off" /></label>
        <div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button"><Check size={15} /> Save provider</button></div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------- Command */
function CommandModal({ engagements, onClose, onNavigate, onSelect, onNew }: { engagements: Engagement[]; onClose: () => void; onNavigate: (a: Area) => void; onSelect: (id: number) => void; onNew: () => void }) {
  const [q, setQ] = useState("");
  const all: { label: string; hint: string; icon: LucideIcon; action: () => void }[] = [
    { label: "Open AI copilot", hint: "Workspace", icon: Sparkles, action: () => onNavigate("chat") },
    { label: "Browse targets & tools", hint: "Workspace", icon: Crosshair, action: () => onNavigate("targets") },
    { label: "Review findings", hint: "Workspace", icon: ShieldCheck, action: () => onNavigate("findings") },
    { label: "Edit scope notes", hint: "Workspace", icon: FileText, action: () => onNavigate("scope") },
    { label: "Reports", hint: "Deliverables", icon: FileCode2, action: () => onNavigate("reports") },
    { label: "LLM providers", hint: "Manage", icon: Cpu, action: () => onNavigate("providers") },
    { label: "Create engagement", hint: "Manage", icon: Plus, action: onNew },
    ...engagements.map((e) => ({ label: `Switch to ${e.name}`, hint: e.kind, icon: Crosshair, action: () => onSelect(e.id) })),
  ];
  const actions = all.filter((a) => a.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="command-modal">
        <div className="command-search"><Search size={16} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && actions[0]) actions[0].action(); if (e.key === "Escape") onClose(); }} placeholder="Search commands and engagements…" /><kbd>ESC</kbd></div>
        <div className="command-section"><SectionLabel>Actions</SectionLabel>{actions.map(({ label, hint, icon: Icon, action }) => <button className="command-item" key={label} onClick={action}><span className="command-icon"><Icon size={15} /></span><span>{label}</span><small>{hint}</small><ArrowUpRight size={13} /></button>)}{actions.length === 0 && <Empty icon={Search} title="No matches" />}</div>
        <div className="command-foot"><span><kbd>↵</kbd> run first result</span><span><kbd>esc</kbd> close</span></div>
      </div>
    </div>
  );
}
