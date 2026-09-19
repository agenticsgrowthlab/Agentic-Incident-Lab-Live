"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Cloud,
  Database,
  Eye,
  FileSearch,
  FileText,
  LoaderCircle,
  MessageCircle,
  GitBranch,
  LockKeyhole,
  Network,
  Play,
  Printer,
  RefreshCcw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Timer,
  Upload,
  UserCheck,
  X,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Framework = "LangGraph" | "CrewAI" | "AutoGen";
type RunState = "ready" | "running" | "complete" | "approved" | "error";
type BackendState = "checking" | "ready" | "configuration_required" | "unreachable";

type AgentFinding = {
  name: string;
  role: string;
  finding: string;
  status: string;
};

type Evidence = {
  id: string;
  title: string;
  type: string;
  score: number;
  excerpt: string;
};

type AnalysisResult = {
  run_id: string;
  framework: Framework;
  model: string;
  live: boolean;
  latency_ms: number;
  retrieval_mode: string;
  retrieval_notice?: string | null;
  citation_coverage: number;
  token_usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  agents: AgentFinding[];
  evidence: Evidence[];
  recommendation: {
    summary: string;
    likely_cause: string;
    primary_control: string;
    escalation: string;
    confidence: number;
    rationale: string;
    human_approval_required: boolean;
    evidence_used: string[];
  };
};

type AttachmentMeta = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
};

type IncidentRecord = {
  id: string;
  incident_name: string;
  incident_text: string;
  severity: string;
  status: string;
  framework: Framework;
  analysis: AnalysisResult;
  human_approved: boolean;
  attachments: AttachmentMeta[];
  final_root_cause?: string | null;
  resolution?: string | null;
  lessons_learned?: string | null;
  created_at: string;
  updated_at: string;
};

type KnowledgeDocument = {
  id: string;
  title: string;
  filename: string;
  content_type: string;
  doc_type: string;
  incident_id?: string | null;
  chunk_count: number;
  created_at: string;
  status: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  incident_matches?: { id: string; name: string; created_at: string; rail?: string }[];
};

type WizardData = {
  rail: string;
  otherRail: string;
  symptom: string;
  startedAt: string;
  affectedCount: string;
  failureRate: string;
  recentChange: string;
  errorDetails: string;
  customerImpact: string;
  queueState: string;
  retryState: string;
  actionsTaken: string;
};

const API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || "/api/analyze";

const DEFAULT_INCIDENT =
  "ACH payments are failing intermittently. Processor timeouts rose after the 14:02 deployment. Failure rate is 18.4%, 1,842 payment instructions are affected, retry volume is 6.2× normal, and the oldest queued message is 47 minutes old. Some customers have attempted payment more than once.";

const PAYMENT_RAIL_OPTIONS = [
  "ACH",
  "Wire / Fedwire",
  "FedNow",
  "RTP (The Clearing House)",
  "Cross-Border / International FX",
  "Debit Card Processing",
  "Credit Card Processing",
  "Zelle / P2P",
  "Other",
] as const;

const frameworkCopy: Record<
  Framework,
  { label: string; pattern: string; color: string }
> = {
  LangGraph: {
    label: "Controlled state graph",
    pattern: "Deterministic routing + checkpoints",
    color: "cyan",
  },
  CrewAI: {
    label: "Role-based crew",
    pattern: "Delegation + specialized expertise",
    color: "violet",
  },
  AutoGen: {
    label: "Conversational team",
    pattern: "Message passing + group consensus",
    color: "amber",
  },
};

const waitingAgents: AgentFinding[] = [
  {
    name: "Lindsay",
    role: "Incident Commander",
    finding: "Waiting for live analysis…",
    status: "waiting",
  },
  {
    name: "Payments SME",
    role: "Rail & settlement",
    finding: "Waiting for retrieved evidence…",
    status: "waiting",
  },
  {
    name: "Platform Agent",
    role: "API & queue health",
    finding: "Waiting for retrieved evidence…",
    status: "waiting",
  },
  {
    name: "Scout",
    role: "Customer impact",
    finding: "Waiting for retrieved evidence…",
    status: "waiting",
  },
  {
    name: "Risk Agent",
    role: "Controls & compliance",
    finding: "Waiting for retrieved evidence…",
    status: "waiting",
  },
];

const architectureLayers = [
  {
    icon: Cloud,
    title: "Experience & access",
    items: "Vercel · Next.js · protected Python API",
    accent: "#39d9e6",
  },
  {
    icon: GitBranch,
    title: "Agent orchestration",
    items: "LangGraph · CrewAI · AutoGen",
    accent: "#9f8cff",
  },
  {
    icon: Sparkles,
    title: "Models & intelligence",
    items: "OpenAI chat models · structured outputs",
    accent: "#ffb55e",
  },
  {
    icon: Database,
    title: "Knowledge & state",
    items: "OpenAI embeddings · Neon pgvector",
    accent: "#6ee7a7",
  },
  {
    icon: CircleGauge,
    title: "Operations & assurance",
    items: "Run IDs · tokens · latency · evidence lineage",
    accent: "#ff7185",
  },
];

export default function Home() {
  const [framework, setFramework] = useState<Framework>("LangGraph");
  const [incident, setIncident] = useState(DEFAULT_INCIDENT);
  const [incidentName, setIncidentName] = useState("ACH Processor Timeouts");
  const [severity, setSeverity] = useState("SEV-2");

  const [runState, setRunState] = useState<RunState>("ready");
  const [backendState, setBackendState] =
    useState<BackendState>("checking");

  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [priorFiles, setPriorFiles] = useState<File[]>([]);
  const [savedIncidentId, setSavedIncidentId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [selectedIncident, setSelectedIncident] =
    useState<IncidentRecord | null>(null);

  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [knowledgeUploadState, setKnowledgeUploadState] =
    useState<"idle" | "uploading" | "indexed" | "error">("idle");
  const [knowledgeMessage, setKnowledgeMessage] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState("incident");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>({
    rail: "ACH",
    otherRail: "",
    symptom: "",
    startedAt: "",
    affectedCount: "",
    failureRate: "",
    recentChange: "",
    errorDetails: "",
    customerImpact: "",
    queueState: "",
    retryState: "",
    actionsTaken: "",
  });

  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "I’m Chatty. I can read the current incident context, saved incidents in Neon, and indexed incident evidence. Ask me what to check next or whether this has happened before.",
    },
  ]);

  const selectedRail =
    wizardData.rail === "Other"
      ? wizardData.otherRail.trim() || "Other payment rail"
      : wizardData.rail;

  const wizardSummary = () => {
    const lines = [
      `Payment rail / service: ${selectedRail}.`,
      wizardData.symptom && `Observed behavior: ${wizardData.symptom}.`,
      wizardData.startedAt && `Incident began: ${wizardData.startedAt}.`,
      wizardData.affectedCount && `Affected transactions/customers: ${wizardData.affectedCount}.`,
      wizardData.failureRate && `Observed failure rate: ${wizardData.failureRate}.`,
      wizardData.recentChange && `Recent change/deployment/configuration: ${wizardData.recentChange}.`,
      wizardData.errorDetails && `Errors / response codes / processor messages: ${wizardData.errorDetails}.`,
      wizardData.customerImpact && `Customer/member impact: ${wizardData.customerImpact}.`,
      wizardData.queueState && `Queue / settlement / acknowledgment state: ${wizardData.queueState}.`,
      wizardData.retryState && `Retry / duplicate behavior: ${wizardData.retryState}.`,
      wizardData.actionsTaken && `Actions already taken: ${wizardData.actionsTaken}.`,
    ].filter(Boolean);

    return lines.join(" ");
  };

  const finishWizard = () => {
    const summary = wizardSummary();
    setIncident(summary);
    setIncidentName(
      `${selectedRail} - ${wizardData.symptom.trim() || "Payment Incident"}`.slice(
        0,
        120
      )
    );
    setResult(null);
    setSavedIncidentId(null);
    setWizardOpen(false);
    setWizardStep(0);
    setActiveTab("incident");
  };

  const sendChat = async () => {
    const message = chatInput.trim();
    if (!message || chatBusy) return;

    const nextMessages: ChatMessage[] = [
      ...chatMessages,
      { role: "user", content: message },
    ];
    setChatMessages(nextMessages);
    setChatInput("");
    setChatBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          screen_context: {
            active_tab: activeTab,
            incident_name: incidentName,
            incident_text: incident,
            severity,
            framework,
            current_analysis: result,
            selected_incident: selectedIncident,
            saved_incident_id: savedIncidentId,
          },
          history: nextMessages.slice(-8).map(({ role, content }) => ({
            role,
            content,
          })),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload.detail || "Chatty could not respond"));
      }

      setChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: String(payload.answer || "No answer returned."),
          incident_matches: payload.incident_matches || [],
        },
      ]);
    } catch (cause) {
      setChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            cause instanceof Error
              ? `I hit an error: ${cause.message}`
              : "I hit an unexpected error.",
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  const openIncidentFromChat = async (incidentId: string) => {
    try {
      const response = await fetch(`/api/incidents/${incidentId}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const record = (await response.json()) as IncidentRecord;
      setSelectedIncident(record);
      setActiveTab("history");
      setChatOpen(false);
    } catch {
      // Keep Chatty open if the record could not be loaded.
    }
  };

  const inferDocType = (filename: string) => {
    const lower = filename.toLowerCase();
    if (lower.includes("rca") || lower.includes("postmortem")) return "RCA";
    if (lower.includes("runbook")) return "RUNBOOK";
    if (lower.includes("schema") || lower.includes("data-model") || lower.includes("data_model")) return "DATA_MODEL";
    if (lower.includes("telemetry") || lower.includes("log")) return "INCIDENT_TELEMETRY";
    return "INCIDENT_EVIDENCE";
  };

  const loadKnowledgeDocuments = async () => {
    try {
      const response = await fetch("/api/knowledge", { cache: "no-store" });
      if (!response.ok) return;
      setKnowledgeDocuments((await response.json()) as KnowledgeDocument[]);
    } catch {
      // Keep the current list if the backend is temporarily unavailable.
    }
  };

  const uploadPriorFiles = async (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;

    const additions = Array.from(incoming);
    setPriorFiles((current) => {
      const seen = new Set(
        current.map((file) => `${file.name}:${file.size}:${file.lastModified}`)
      );
      return [
        ...current,
        ...additions.filter(
          (file) => !seen.has(`${file.name}:${file.size}:${file.lastModified}`)
        ),
      ];
    });

    setKnowledgeUploadState("uploading");
    setKnowledgeMessage(`Uploading and indexing ${additions.length} file${additions.length === 1 ? "" : "s"}…`);

    try {
      for (const file of additions) {
        const form = new FormData();
        form.append("file", file);
        form.append("doc_type", inferDocType(file.name));
        if (savedIncidentId) form.append("incident_id", savedIncidentId);

        const response = await fetch("/api/knowledge/upload", {
          method: "POST",
          body: form,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(
            String(payload.detail || `Upload failed for ${file.name}`)
          );
        }
      }

      await loadKnowledgeDocuments();
      setKnowledgeUploadState("indexed");
      setKnowledgeMessage(
        `${additions.length} file${additions.length === 1 ? "" : "s"} stored in Neon and indexed in pgvector.`
      );
    } catch (cause) {
      setKnowledgeUploadState("error");
      setKnowledgeMessage(
        cause instanceof Error ? cause.message : "Knowledge upload failed"
      );
    }
  };

  const removePriorFile = (index: number) => {
    setPriorFiles((current) =>
      current.filter((_, itemIndex) => itemIndex !== index)
    );
  };

  useEffect(() => {
    let active = true;

    fetch(API_URL, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unreachable");
        return response.json() as Promise<{ configured?: boolean }>;
      })
      .then((data) => {
        if (active) {
          setBackendState(
            data.configured ? "ready" : "configuration_required"
          );
        }
      })
      .catch(() => {
        if (active) setBackendState("unreachable");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (runState !== "running") return;

    const timer = window.setInterval(
      () =>
        setProgress((value) =>
          Math.min(
            92,
            value + Math.max(2, Math.round((94 - value) / 7))
          )
        ),
      900
    );

    return () => window.clearInterval(timer);
  }, [runState]);

  const runAnalysis = async () => {
    setRunState("running");
    setProgress(8);
    setResult(null);
    setError(null);
    setSavedIncidentId(null);
    setSelectedIncident(null);
    setSaveState("idle");

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ framework, incident }),
      });

      const payload = (await response
        .json()
        .catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        throw new Error(
          String(
            payload.detail ||
              payload.error ||
              `Agent API returned ${response.status}`
          )
        );
      }

      setResult(payload as AnalysisResult);
      setProgress(100);
      setBackendState("ready");
      setRunState("complete");
    } catch (cause) {
      setProgress(0);
      setError(
        cause instanceof Error
          ? cause.message
          : "The live agent run failed"
      );
      setRunState("error");
    }
  };

  const resetRun = () => {
    setRunState("ready");
    setProgress(0);
    setResult(null);
    setError(null);
    setSavedIncidentId(null);
    setSelectedIncident(null);
    setSaveState("idle");
  };

  const loadIncidents = async () => {
    try {
      const response = await fetch("/api/incidents", {
        cache: "no-store",
      });

      if (!response.ok) return;

      const rows = (await response.json()) as IncidentRecord[];
      setIncidents(rows);
    } catch {
      // keep current list
    }
  };

  const saveIncident = async () => {
    if (!result || incidentName.trim().length < 3) return;

    setSaveState("saving");

    const body = {
      incident_name: incidentName.trim(),
      incident_text: incident,
      severity,
      status: runState === "approved" ? "Mitigated" : "Investigating",
      framework,
      analysis: result,
      human_approved: runState === "approved",
      attachments: priorFiles.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      })),
    };

    try {
      const response = await fetch(
        savedIncidentId
          ? `/api/incidents/${savedIncidentId}`
          : "/api/incidents",
        {
          method: savedIncidentId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) throw new Error("save failed");

      const saved = (await response.json()) as IncidentRecord;

      setSavedIncidentId(saved.id);
      setSelectedIncident(saved);
      setSaveState("saved");

      await loadIncidents();
    } catch {
      setSaveState("error");
    }
  };

  const printIncident = (record: IncidentRecord) => {
    const rec = record.analysis?.recommendation;
    const evidenceRows = (record.analysis?.evidence || [])
      .map(
        (item) =>
          `<li><strong>${item.title}</strong> — ${Math.round(
            item.score * 100
          )}% match</li>`
      )
      .join("");

    const popup = window.open(
      "",
      "_blank",
      "width=900,height=900"
    );

    if (!popup) return;

    popup.document.write(`<!doctype html>
<html>
<head>
  <title>${record.id} - ${record.incident_name}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      color: #111827;
      max-width: 820px;
      margin: 40px auto;
      line-height: 1.5;
      padding: 0 24px;
    }
    h1 { font-size: 28px; margin-bottom: 4px; }
    h2 {
      font-size: 16px;
      margin-top: 28px;
      border-bottom: 1px solid #ddd;
      padding-bottom: 6px;
    }
    .meta { color: #4b5563; font-size: 13px; }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 30px;
    }
    .box {
      background: #f8fafc;
      padding: 12px;
      border-radius: 8px;
    }
    ul { padding-left: 20px; }
    @media print {
      body { margin: 0; max-width: none; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="text-align:right">
    <button onclick="window.print()">Print / Save as PDF</button>
  </div>

  <h1>${record.incident_name}</h1>
  <div class="meta">
    ${record.id} · ${new Date(record.created_at).toLocaleString()} ·
    ${record.severity} · ${record.status}
  </div>

  <h2>Incident description</h2>
  <p>${record.incident_text}</p>

  <h2>Investigation</h2>
  <div class="grid">
    <div class="box">
      <strong>Framework</strong><br>
      ${record.framework}
    </div>
    <div class="box">
      <strong>Run ID</strong><br>
      ${record.analysis?.run_id || "—"}
    </div>
  </div>

  <h2>AI recommendation</h2>
  <p><strong>${rec?.summary || "—"}</strong></p>
  <p>${rec?.rationale || ""}</p>

  <div class="grid">
    <div class="box">
      <strong>Likely cause</strong><br>
      ${rec?.likely_cause || "—"}
    </div>
    <div class="box">
      <strong>Primary control</strong><br>
      ${rec?.primary_control || "—"}
    </div>
    <div class="box">
      <strong>Escalation</strong><br>
      ${rec?.escalation || "—"}
    </div>
    <div class="box">
      <strong>Confidence</strong><br>
      ${
        rec
          ? Math.round(rec.confidence * 100) + "%"
          : "—"
      }
    </div>
  </div>

  <h2>Agent findings</h2>
  <ul>${(record.analysis?.agents || []).map((agent) =>
    `<li><strong>${agent.name}</strong> <em>(${agent.role})</em><br>${agent.finding}</li>`
  ).join("") || "<li>No agent findings recorded.</li>"}</ul>

  <h2>Evidence reviewed</h2>
  <ul>${evidenceRows || "<li>No retrieved evidence recorded.</li>"}</ul>

  <h2>Human decision</h2>
  <p>${
    record.human_approved
      ? "Recommendation approved."
      : "Approval not recorded."
  }</p>

  ${
    record.final_root_cause
      ? `<h2>Final root cause</h2><p>${record.final_root_cause}</p>`
      : ""
  }

  ${
    record.resolution
      ? `<h2>Resolution</h2><p>${record.resolution}</p>`
      : ""
  }

  ${
    record.lessons_learned
      ? `<h2>Lessons learned</h2><p>${record.lessons_learned}</p>`
      : ""
  }
</body>
</html>`);

    popup.document.close();
  };

  const statusLabel = useMemo(() => {
    if (runState === "running") {
      return progress < 30
        ? "Retrieving evidence"
        : progress < 62
        ? "Running specialist agents"
        : "Synthesizing recommendation";
    }

    if (runState === "complete") return "Live analysis complete";
    if (runState === "approved")
      return "Human approval recorded locally";
    if (runState === "error") return "Run needs attention";

    return "Ready for live analysis";
  }, [runState, progress]);

  const agents = result?.agents || waitingAgents;
  const evidence = result?.evidence || [];
  const recommendation = result?.recommendation;
  const confidence = recommendation
    ? Math.round(recommendation.confidence * 100)
    : 0;

  const backendLabel =
    backendState === "ready"
      ? "Live AI configured"
      : backendState === "configuration_required"
      ? "API key required"
      : backendState === "checking"
      ? "Checking AI backend"
      : "Backend deploy pending";

  return (
    <main className="min-h-screen bg-[#071017] text-[#f2f7f8]">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#071017]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-5 px-5 py-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
              <Network className="size-5" />
            </div>

            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold tracking-[0.08em]">
                AGENTIC INCIDENT LAB
              </div>
              <div className="text-xs text-slate-400">
                Live multi-framework AI · Nicole Chernow-Martinez
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-slate-300 sm:flex">
            <span
              className={`size-2 rounded-full ${
                backendState === "ready"
                  ? "bg-emerald-400 shadow-[0_0_12px_#34d399]"
                  : backendState === "checking"
                  ? "animate-pulse bg-amber-300"
                  : "bg-red-400"
              }`}
            />
            {backendLabel}
          </div>
        </div>
      </header>

      <div className="mx-auto mt-4 max-w-[1500px] px-4 lg:px-8">
        <button
          type="button"
          onClick={() => {
            setWizardStep(0);
            setWizardOpen(true);
          }}
          className="flex w-full items-center justify-between rounded-xl border border-amber-300/30 bg-amber-300/[0.08] px-4 py-3 text-left transition hover:bg-amber-300/[0.12]"
        >
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg border border-amber-300/25 bg-amber-300/[0.08] text-amber-200">
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-wide text-amber-100">
                START HERE
              </div>
              <div className="mt-0.5 text-xs text-amber-100/65">
                Guided incident intake — capture the right payment details without having to remember the process.
              </div>
            </div>
          </div>
          <ChevronRight className="size-4 text-amber-200" />
        </button>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="mx-auto max-w-[1500px] gap-0 px-4 pb-12 pt-5 lg:px-8"
      >
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto overflow-y-hidden border-b border-white/10 pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <TabsTrigger
            value="incident"
            className="px-4 pb-3 text-slate-400 data-[state=active]:text-cyan-200"
          >
            Incident room
          </TabsTrigger>

          <TabsTrigger
            value="prior-data"
            onClick={loadKnowledgeDocuments}
            className="px-4 pb-3 text-slate-400 data-[state=active]:text-cyan-200"
          >
            Prior Incident Data &amp; Data Models
          </TabsTrigger>

          <TabsTrigger
            value="history"
            onClick={loadIncidents}
            className="px-4 pb-3 text-slate-400 data-[state=active]:text-cyan-200"
          >
            Incident History
          </TabsTrigger>

          <TabsTrigger
            value="architecture"
            className="px-4 pb-3 text-slate-400 data-[state=active]:text-cyan-200"
          >
            Live architecture
          </TabsTrigger>

          <TabsTrigger
            value="frameworks"
            className="px-4 pb-3 text-slate-400 data-[state=active]:text-cyan-200"
          >
            Framework lab
          </TabsTrigger>

          <TabsTrigger
            value="governance"
            className="px-4 pb-3 text-slate-400 data-[state=active]:text-cyan-200"
          >
            Governance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="incident" className="pt-6">
          <section className="mb-5 grid gap-4 xl:grid-cols-[1.45fr_.75fr]">
            <div className="signal-card relative overflow-hidden p-5 sm:p-6">
              <div className="absolute right-0 top-0 h-full w-1 bg-gradient-to-b from-red-400 via-amber-300 to-transparent" />

              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold tracking-[0.1em] text-slate-400">
                <span className="rounded border border-red-400/30 bg-red-400/10 px-2 py-1 text-red-300">
                  INCIDENT INPUT
                </span>
                <span>LIVE MODEL ANALYSIS</span>
              </div>

              <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                What is happening?
              </h1>

              <p className="mt-2 text-sm leading-6 text-slate-400">
                Describe the operational symptoms, timing, volume and known
                changes. The selected framework will retrieve relevant
                evidence and analyze this text.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_150px]">
                <input
                  value={incidentName}
                  onChange={(event) =>
                    setIncidentName(event.target.value)
                  }
                  placeholder="Incident name"
                  className="h-10 rounded-md border border-white/15 bg-black/20 px-3 text-sm text-white outline-none focus:border-cyan-300/60"
                />

                <select
                  value={severity}
                  onChange={(event) =>
                    setSeverity(event.target.value)
                  }
                  className="h-10 rounded-md border border-white/15 bg-[#0b161e] px-3 text-sm text-white"
                >
                  <option>SEV-1</option>
                  <option>SEV-2</option>
                  <option>SEV-3</option>
                  <option>SEV-4</option>
                </select>
              </div>

              <Textarea
                value={incident}
                onChange={(event) =>
                  setIncident(event.target.value)
                }
                disabled={runState === "running"}
                aria-label="Incident description"
                className="mt-5 min-h-36 resize-y border-white/15 bg-black/20 text-base leading-6 text-slate-100 placeholder:text-slate-600 focus-visible:border-cyan-300/60 focus-visible:ring-cyan-300/20"
              />

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/[0.08] px-4 py-2.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/45 hover:bg-cyan-300/[0.12]">
                  <Upload className="size-4" />
                  Add prior incident data or data model
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.yaml,.yml"
                    className="sr-only"
                    onChange={(event) => {
                      void uploadPriorFiles(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>

                {priorFiles.length > 0 && (
                  <span className="text-xs text-slate-500">
                    {priorFiles.length} file
                    {priorFiles.length === 1 ? "" : "s"} staged
                  </span>
                )}
              </div>
            </div>

            <div className="signal-card p-5 sm:p-6">
              <div className="eyebrow">CONTROL DESK</div>

              <h2 className="mt-2 text-lg font-semibold">
                Choose the real orchestration runtime
              </h2>

              <div className="mt-4 grid gap-2">
                {(Object.keys(frameworkCopy) as Framework[]).map(
                  (item) => (
                    <button
                      key={item}
                      onClick={() => {
                        setFramework(item);
                        resetRun();
                      }}
                      disabled={runState === "running"}
                      className={`framework-choice ${
                        framework === item
                          ? "framework-choice-active"
                          : ""
                      }`}
                      aria-pressed={framework === item}
                    >
                      <span
                        className={`framework-dot framework-${frameworkCopy[item].color}`}
                      />

                      <span className="min-w-0 text-left">
                        <span className="block font-semibold text-white">
                          {item}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {frameworkCopy[item].label}
                        </span>
                      </span>

                      {framework === item && (
                        <Check className="ml-auto size-4 text-cyan-200" />
                      )}
                    </button>
                  )
                )}
              </div>

              <Button
                onClick={runAnalysis}
                disabled={
                  runState === "running" ||
                  incident.trim().length < 20
                }
                className="mt-4 h-11 w-full bg-cyan-300 font-semibold text-[#061218] hover:bg-cyan-200"
              >
                {runState === "running" ? (
                  <>
                    <RefreshCcw className="animate-spin" />
                    Running live agents
                  </>
                ) : (
                  <>
                    <Play className="fill-current" />
                    Run {framework} analysis
                  </>
                )}
              </Button>

              <p className="mt-3 text-xs leading-5 text-slate-500">
                Calls the deployed Python backend. Model usage may incur
                API charges.
              </p>
            </div>
          </section>

          {error && (
            <div className="mb-4 flex gap-3 rounded-xl border border-red-400/25 bg-red-400/[0.07] p-4 text-sm text-red-100">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-300" />

              <div>
                <div className="font-semibold">
                  Live run did not complete
                </div>

                <div className="mt-1 text-red-100/75">
                  {error}
                </div>

                {error.includes("OPENAI_API_KEY") && (
                  <div className="mt-2 text-xs text-red-100/60">
                    Add OPENAI_API_KEY in Vercel → Project Settings →
                    Environment Variables, then redeploy.
                  </div>
                )}
              </div>
            </div>
          )}

          <section className="grid gap-4 xl:grid-cols-[1.45fr_.75fr]">
            <div className="grid gap-4">
              <div className="signal-card p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="eyebrow">
                      LIVE ORCHESTRATION TRACE
                    </div>
                    <h2 className="mt-2 text-lg font-semibold">
                      {frameworkCopy[framework].pattern}
                    </h2>
                  </div>

                  <span className="status-chip">
                    <span
                      className={
                        runState === "running"
                          ? "pulse-dot"
                          : "steady-dot"
                      }
                    />
                    {statusLabel}
                  </span>
                </div>

                <Progress
                  value={progress}
                  className="mt-5 h-1.5 bg-white/10 [&_[data-slot=progress-indicator]]:bg-cyan-300"
                />

                <div className="mt-5 grid gap-2">
                  {agents.map((agent, index) => {
                    const icons = [
                      Activity,
                      Zap,
                      Network,
                      Eye,
                      ShieldCheck,
                    ];
                    const Icon =
                      icons[index % icons.length];
                    const active =
                      runState === "running" ||
                      agent.status === "complete";

                    return (
                      <div
                        key={`${agent.name}-${index}`}
                        className={`agent-row ${
                          active
                            ? "agent-row-active"
                            : ""
                        }`}
                      >
                        <div className="agent-icon">
                          <Icon className="size-4" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-semibold text-white">
                              {agent.name}
                            </span>
                            <span className="text-xs text-slate-500">
                              {agent.role}
                            </span>
                          </div>

                          <p className="mt-1 text-sm leading-5 text-slate-400">
                            {runState === "running" &&
                            !result
                              ? "Agent execution in progress…"
                              : agent.finding}
                          </p>
                        </div>

                        {agent.status === "complete" ? (
                          <CheckCircle2 className="size-4 shrink-0 text-emerald-300" />
                        ) : (
                          <Timer className="size-4 shrink-0 text-slate-600" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div
                className={`recommendation-card ${
                  recommendation
                    ? "opacity-100"
                    : "opacity-45"
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                  <ShieldCheck className="size-4" />
                  LIVE RECOMMENDATION{" "}
                  {recommendation
                    ? `· ${confidence}% CONFIDENCE`
                    : "· PENDING"}
                </div>

                <h2 className="mt-3 text-xl font-semibold">
                  {recommendation?.summary ||
                    "Run the agents to generate an evidence-grounded response."}
                </h2>

                {recommendation && (
                  <>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {recommendation.rationale}
                    </p>

                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div>
                        <span className="detail-label">
                          Likely cause
                        </span>
                        <p>
                          {recommendation.likely_cause}
                        </p>
                      </div>

                      <div>
                        <span className="detail-label">
                          Primary control
                        </span>
                        <p>
                          {recommendation.primary_control}
                        </p>
                      </div>

                      <div>
                        <span className="detail-label">
                          Escalation
                        </span>
                        <p>
                          {recommendation.escalation}
                        </p>
                      </div>
                    </div>
                  </>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
                  <Button
                    onClick={() =>
                      setRunState("approved")
                    }
                    disabled={runState !== "complete"}
                    className="bg-emerald-300 text-emerald-950 hover:bg-emerald-200"
                  >
                    <UserCheck />
                    {runState === "approved"
                      ? "Approval recorded"
                      : "Approve recommendation"}
                  </Button>

                  <Button
                    onClick={saveIncident}
                    disabled={
                      !result ||
                      saveState === "saving"
                    }
                    variant="outline"
                    className="border-cyan-300/25 bg-cyan-300/[0.06] text-cyan-100 hover:bg-cyan-300/[0.12]"
                  >
                    <Save />
                    {saveState === "saving"
                      ? "Saving…"
                      : savedIncidentId
                      ? "Update incident"
                      : "Save incident"}
                  </Button>

                  {selectedIncident && (
                    <Button
                      onClick={() =>
                        printIncident(selectedIncident)
                      }
                      variant="outline"
                      className="border-white/15 bg-transparent text-slate-200 hover:bg-white/10 hover:text-white"
                    >
                      <Printer />
                      View / Print summary
                    </Button>
                  )}

                  <Button
                    onClick={resetRun}
                    variant="outline"
                    className="border-white/15 bg-transparent text-slate-200 hover:bg-white/10 hover:text-white"
                  >
                    <RefreshCcw />
                    Reset
                  </Button>

                  {saveState === "saved" && (
                    <span className="text-xs text-emerald-300">
                      Saved {savedIncidentId}
                    </span>
                  )}

                  {saveState === "error" && (
                    <span className="text-xs text-red-300">
                      Incident save failed
                    </span>
                  )}
                </div>
              </div>
            </div>

            <aside className="grid content-start gap-4">
              <div className="signal-card p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="eyebrow">
                      RAG EVIDENCE
                    </div>
                    <h2 className="mt-2 font-semibold">
                      Retrieved sources
                    </h2>
                  </div>

                  <FileSearch className="size-5 text-cyan-200" />
                </div>

                <div className="mt-4 grid gap-2">
                  {evidence.length ? (
                    evidence.map((item) => (
                      <div
                        key={item.id}
                        className="evidence-row"
                      >
                        <div className="min-w-0">
                          <span className="block text-[11px] font-semibold tracking-[0.08em] text-cyan-300">
                            {item.type}
                          </span>

                          <span className="mt-1 block truncate text-sm text-slate-200">
                            {item.title}
                          </span>
                        </div>

                        <span className="font-mono text-xs text-slate-500">
                          {Math.round(item.score * 100)}%
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-white/10 p-4 text-sm leading-6 text-slate-500">
                      Evidence will appear after the
                      embedding search completes.
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-500">
                  <Braces className="mr-2 inline size-3.5 text-violet-300" />
                  {result?.retrieval_mode ||
                    "Embeddings → vector similarity → cited context → agent reasoning"}
                </div>

                {result?.retrieval_notice && (
                  <p className="mt-2 text-xs text-amber-300/70">
                    {result.retrieval_notice}
                  </p>
                )}
              </div>

              <div className="signal-card p-5">
                <div className="eyebrow">
                  MEASURED RUN TELEMETRY
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  {[
                    [
                      result
                        ? `${(
                            result.latency_ms / 1000
                          ).toFixed(1)} s`
                        : "—",
                      "Latency",
                    ],
                    [
                      result
                        ? result.token_usage.total_tokens.toLocaleString()
                        : "—",
                      "Tokens",
                    ],
                    [
                      result
                        ? `${Math.round(
                            result.citation_coverage *
                              100
                          )}%`
                        : "—",
                      "Citation coverage",
                    ],
                    [
                      result?.model || "—",
                      "Model",
                    ],
                  ].map(([value, label]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-white/10 bg-white/[0.025] p-3"
                    >
                      <div
                        className="truncate font-mono text-base text-white"
                        title={value}
                      >
                        {value}
                      </div>

                      <div className="mt-1 text-xs text-slate-500">
                        {label}
                      </div>
                    </div>
                  ))}
                </div>

                {result && (
                  <div className="mt-3 font-mono text-[11px] text-slate-600">
                    {result.run_id}
                  </div>
                )}
              </div>
            </aside>
          </section>
        </TabsContent>

        <TabsContent value="prior-data" className="pt-6">
          <section className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
            <div className="signal-card p-5 sm:p-6">
              <div className="eyebrow">
                INSTITUTIONAL INCIDENT MEMORY
              </div>

              <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                Prior Incident Data &amp; Data Models
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
                Stage historical RCAs, postmortems,
                runbooks, schemas, data models and
                structured incident evidence so
                investigations can be grounded in what
                your organization already knows.
              </p>

              <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-cyan-300/25 bg-cyan-300/[0.035] px-6 py-10 text-center transition hover:border-cyan-300/50 hover:bg-cyan-300/[0.06]">
                <div className="grid size-12 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-200">
                  <Upload className="size-5" />
                </div>

                <div className="mt-4 font-semibold">
                  Add prior incident evidence
                </div>

                <div className="mt-2 text-xs leading-5 text-slate-500">
                  PDF, DOCX, TXT, Markdown, CSV, JSON,
                  YAML · multiple files supported
                </div>

                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.yaml,.yml"
                  className="sr-only"
                  onChange={(event) => {
                    void uploadPriorFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>

              <div className={`mt-4 rounded-lg border p-3 text-xs leading-5 ${
                knowledgeUploadState === "error"
                  ? "border-red-300/20 bg-red-300/[0.05] text-red-200"
                  : "border-emerald-300/20 bg-emerald-300/[0.05] text-emerald-100/80"
              }`}>
                <div className="flex items-center gap-2">
                  {knowledgeUploadState === "uploading" && (
                    <LoaderCircle className="size-4 animate-spin" />
                  )}
                  <span>
                    {knowledgeMessage ||
                      "Uploaded evidence is stored in Neon, chunked, embedded, and indexed in pgvector for future incident retrieval."}
                  </span>
                </div>
              </div>
            </div>

            <div className="signal-card p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="eyebrow">
                    PERSISTENT KNOWLEDGE
                  </div>
                  <h2 className="mt-2 text-lg font-semibold">
                    Indexed in Neon / pgvector
                  </h2>
                </div>

                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-xs text-slate-400">
                  {knowledgeDocuments.length} DOCS
                </span>
              </div>

              <div className="mt-5 grid gap-2">
                {knowledgeDocuments.length ? (
                  knowledgeDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3"
                    >
                      <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-emerald-300/15 bg-emerald-300/[0.05] text-emerald-200">
                        <Database className="size-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-200">
                          {doc.filename}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          {doc.doc_type} · {doc.chunk_count} chunks · indexed{" "}
                          {new Date(doc.created_at).toLocaleString()}
                        </div>
                      </div>

                      <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.05] px-2 py-1 text-[10px] font-semibold tracking-wide text-emerald-200">
                        INDEXED
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm leading-6 text-slate-500">
                    <Database className="mx-auto mb-3 size-5 text-slate-600" />
                    No uploaded knowledge indexed yet.
                  </div>
                )}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  [
                    "RCA / Postmortem",
                    "Root cause, timeline, remediation and lessons learned",
                  ],
                  [
                    "Data model / Schema",
                    "Entities, relationships, message structures and fields",
                  ],
                  [
                    "Runbook",
                    "Known checks, escalation paths and recovery procedures",
                  ],
                  [
                    "Incident telemetry",
                    "Logs, queue metrics, failure patterns and structured exports",
                  ],
                ].map(([title, copy]) => (
                  <div
                    key={title}
                    className="rounded-lg border border-white/10 bg-black/20 p-3"
                  >
                    <div className="text-sm font-semibold text-slate-200">
                      {title}
                    </div>

                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      {copy}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="history" className="pt-6">
          <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="signal-card overflow-hidden">
              <div className="border-b border-white/10 p-5">
                <div className="eyebrow">
                  PERSISTENT INCIDENT MEMORY
                </div>

                <div className="mt-2 flex items-center justify-between gap-3">
                  <h1 className="text-2xl font-semibold">
                    Incident History
                  </h1>

                  <Button
                    onClick={loadIncidents}
                    size="sm"
                    variant="outline"
                    className="border-white/15 bg-transparent"
                  >
                    <RefreshCcw />
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="divide-y divide-white/10">
                {incidents.length ? (
                  incidents.map((row) => (
                    <button
                      key={row.id}
                      onClick={() =>
                        setSelectedIncident(row)
                      }
                      className="block w-full p-4 text-left hover:bg-white/[0.03]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-white">
                            {row.incident_name}
                          </div>

                          <div className="mt-1 font-mono text-xs text-slate-600">
                            {row.id}
                          </div>
                        </div>

                        <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-slate-400">
                          {row.status}
                        </span>
                      </div>

                      <div className="mt-2 text-xs text-slate-500">
                        {new Date(
                          row.created_at
                        ).toLocaleString()}{" "}
                        · {row.severity} · {row.framework}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="p-8 text-center text-sm text-slate-500">
                    No saved incidents yet.
                  </div>
                )}
              </div>
            </div>

            <div className="signal-card p-5 sm:p-6">
              {selectedIncident ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="eyebrow">
                        INCIDENT SUMMARY
                      </div>

                      <h2 className="mt-2 text-xl font-semibold">
                        {
                          selectedIncident.incident_name
                        }
                      </h2>

                      <div className="mt-1 font-mono text-xs text-slate-600">
                        {selectedIncident.id}
                      </div>
                    </div>

                    <Button
                      onClick={() =>
                        printIncident(selectedIncident)
                      }
                      className="bg-cyan-300 text-[#061218] hover:bg-cyan-200"
                    >
                      <Printer />
                      Print summary
                    </Button>
                  </div>

                  <p className="mt-5 text-sm leading-6 text-slate-400">
                    {selectedIncident.incident_text}
                  </p>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <div className="detail-label">
                        Likely cause
                      </div>

                      <p className="mt-1 text-sm">
                        {selectedIncident.analysis
                          ?.recommendation
                          ?.likely_cause || "—"}
                      </p>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <div className="detail-label">
                        Primary control
                      </div>

                      <p className="mt-1 text-sm">
                        {selectedIncident.analysis
                          ?.recommendation
                          ?.primary_control || "—"}
                      </p>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <div className="detail-label">
                        Human approval
                      </div>

                      <p className="mt-1 text-sm">
                        {selectedIncident.human_approved
                          ? "Approved"
                          : "Not recorded"}
                      </p>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <div className="detail-label">
                        Evidence
                      </div>

                      <p className="mt-1 text-sm">
                        {selectedIncident.analysis
                          ?.evidence?.length || 0}{" "}
                        retrieved sources
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 border-t border-white/10 pt-5">
                    <div className="eyebrow">AGENT FINDINGS</div>
                    <h3 className="mt-2 text-lg font-semibold">
                      Full investigation comments
                    </h3>

                    <div className="mt-4 grid gap-2">
                      {(selectedIncident.analysis?.agents || []).map(
                        (agent, index) => {
                          const icons = [Activity, Zap, Network, Eye, ShieldCheck];
                          const Icon = icons[index % icons.length];

                          return (
                            <div
                              key={`${agent.name}-${index}`}
                              className="agent-row agent-row-active"
                            >
                              <div className="agent-icon">
                                <Icon className="size-4" />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2">
                                  <span className="font-semibold text-white">
                                    {agent.name}
                                  </span>
                                  <span className="text-xs text-slate-500">
                                    {agent.role}
                                  </span>
                                </div>
                                <p className="mt-1 text-sm leading-6 text-slate-400">
                                  {agent.finding}
                                </p>
                              </div>
                            </div>
                          );
                        }
                      )}

                      {!selectedIncident.analysis?.agents?.length && (
                        <div className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-slate-500">
                          No agent findings were stored with this incident.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid min-h-64 place-items-center text-center text-sm text-slate-500">
                  Select an incident to view its summary.
                </div>
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="architecture" className="pt-6">
          <section className="signal-card overflow-hidden">
            <div className="border-b border-white/10 p-5 sm:p-7">
              <div className="eyebrow">
                IMPLEMENTED RUNTIME
              </div>

              <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    Live agentic AI on Vercel
                  </h1>

                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                    The Next.js interface calls a Python
                    function that retrieves evidence,
                    invokes the selected framework,
                    measures the run, and returns a
                    human-gated recommendation.
                  </p>
                </div>

                <span className="rounded-md border border-emerald-300/20 bg-emerald-300/[0.07] px-3 py-2 text-xs text-emerald-200">
                  Implemented—not a diagram-only
                  simulation
                </span>
              </div>
            </div>

            <div className="grid gap-px bg-white/10 lg:grid-cols-5">
              {architectureLayers.map(
                (layer, index) => {
                  const Icon = layer.icon;

                  return (
                    <div
                      key={layer.title}
                      className="relative bg-[#0b161e] p-5 lg:min-h-[250px]"
                    >
                      <div className="flex items-center justify-between">
                        <div
                          className="grid size-10 place-items-center rounded-lg border border-white/10 bg-white/[0.04]"
                          style={{
                            color: layer.accent,
                          }}
                        >
                          <Icon className="size-5" />
                        </div>

                        <span className="font-mono text-xs text-slate-600">
                          0{index + 1}
                        </span>
                      </div>

                      <h3 className="mt-7 font-semibold">
                        {layer.title}
                      </h3>

                      <p className="mt-3 text-sm leading-6 text-slate-400">
                        {layer.items}
                      </p>

                      {index <
                        architectureLayers.length -
                          1 && (
                        <ChevronRight className="absolute -right-3 top-1/2 z-10 hidden size-6 rounded-full border border-white/10 bg-[#0b161e] p-1 text-slate-500 lg:block" />
                      )}
                    </div>
                  );
                }
              )}
            </div>
          </section>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {[
              [
                LockKeyhole,
                "Secrets stay server-side",
                "The browser never receives the model key or database connection string.",
              ],
              [
                CircleGauge,
                "Observable by default",
                "Every completed run returns a run ID, actual latency, token usage, framework, model and citation coverage.",
              ],
              [
                UserCheck,
                "Human authority",
                "The model recommends; a person approves. No external payment action is wired into the portfolio lab.",
              ],
            ].map(([I, title, copy]) => {
              const Icon = I as typeof LockKeyhole;

              return (
                <div
                  key={String(title)}
                  className="signal-card p-5"
                >
                  <Icon className="size-5 text-cyan-200" />

                  <h3 className="mt-4 font-semibold">
                    {String(title)}
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {String(copy)}
                  </p>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="frameworks" className="pt-6">
          <section className="mb-5 max-w-3xl">
            <div className="eyebrow">
              RUN-TIME COMPARISON
            </div>

            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              The buttons now execute three different
              Python frameworks.
            </h1>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              All three receive the same incident and
              retrieved evidence, making their orchestration
              behavior directly comparable.
            </p>
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            {[
              [
                "LangGraph",
                "Stateful graph",
                "Four specialist nodes feed a controlled synthesis node through explicit graph edges.",
                [
                  "StateGraph execution",
                  "Deterministic edges",
                  "Structured synthesis",
                ],
              ],
              [
                "CrewAI",
                "Role-based crew",
                "Specialist agents own sequential tasks and an incident commander synthesizes their shared context.",
                [
                  "Crew + Task objects",
                  "Role-specific agents",
                  "Sequential process",
                ],
              ],
              [
                "AutoGen",
                "Conversational agents",
                "A round-robin team shares context, with the incident commander producing the final structured recommendation.",
                [
                  "AssistantAgent team",
                  "Shared conversation",
                  "Bounded termination",
                ],
              ],
            ].map(
              ([name, pattern, copy, benefits]) => (
                <article
                  key={String(name)}
                  className="framework-card"
                >
                  <div className="flex items-center justify-between">
                    <Bot className="size-5 text-cyan-200" />
                    <span className="text-xs text-slate-500">
                      {String(pattern)}
                    </span>
                  </div>

                  <h2 className="mt-6 text-xl font-semibold">
                    {String(name)}
                  </h2>

                  <p className="mt-3 min-h-20 text-sm leading-6 text-slate-400">
                    {String(copy)}
                  </p>

                  <div className="my-5 h-px bg-white/10" />

                  <ul className="grid gap-3">
                    {(benefits as string[]).map(
                      (item) => (
                        <li
                          key={item}
                          className="flex items-center gap-2 text-sm text-slate-300"
                        >
                          <Check className="size-4 text-emerald-300" />
                          {item}
                        </li>
                      )
                    )}
                  </ul>
                </article>
              )
            )}
          </div>

          <div className="mt-4 signal-card p-5">
            <div className="flex gap-3">
              <BookOpen className="mt-0.5 size-5 shrink-0 text-amber-300" />

              <div>
                <h3 className="font-semibold">
                  Fair comparison boundary
                </h3>

                <p className="mt-1 text-sm leading-6 text-slate-400">
                  The knowledge set, model configuration
                  and response contract remain constant.
                  Only orchestration changes. Results may
                  vary because the model calls are live.
                </p>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="governance" className="pt-6">
          <section className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
            <div className="signal-card p-5 sm:p-6">
              <div className="eyebrow">
                RESPONSIBLE AI CONTROL PLANE
              </div>

              <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                Every recommendation needs evidence,
                limits and an owner.
              </h1>

              <p className="mt-3 text-sm leading-6 text-slate-400">
                Controls are implemented in the request path
                instead of being presentation-only claims.
              </p>

              <div className="mt-6 grid gap-3">
                {[
                  [
                    "01",
                    "Ground inputs",
                    "Retrieve a bounded set of versioned knowledge documents.",
                  ],
                  [
                    "02",
                    "Constrain output",
                    "Require structured JSON and normalize every returned field.",
                  ],
                  [
                    "03",
                    "Limit requests",
                    "Validate incident length and allow only named frameworks.",
                  ],
                  [
                    "04",
                    "Protect secrets",
                    "Keep API and database credentials in server environment variables.",
                  ],
                  [
                    "05",
                    "Require approval",
                    "Keep consequential action outside autonomous execution.",
                  ],
                ].map(([num, title, copy]) => (
                  <div
                    key={num}
                    className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3"
                  >
                    <span className="font-mono text-xs text-cyan-300">
                      {num}
                    </span>

                    <div>
                      <h3 className="text-sm font-semibold">
                        {title}
                      </h3>

                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {copy}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="signal-card overflow-hidden">
              <div className="border-b border-white/10 p-5">
                <div className="eyebrow">
                  OPERATING BOUNDARIES
                </div>

                <h2 className="mt-2 font-semibold">
                  What the live portfolio lab does—and does
                  not do
                </h2>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-white/[0.025] text-xs tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">
                        CAPABILITY
                      </th>
                      <th className="px-5 py-3 font-medium">
                        IMPLEMENTATION
                      </th>
                      <th className="px-5 py-3 font-medium">
                        BOUNDARY
                      </th>
                      <th className="px-5 py-3 font-medium">
                        STATUS
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-white/10">
                    {[
                      [
                        "Agent reasoning",
                        "Live model calls",
                        "No hidden chain-of-thought displayed",
                        "LIVE",
                      ],
                      [
                        "RAG",
                        "Embeddings + similarity",
                        "Bundled portfolio documents",
                        "LIVE",
                      ],
                      [
                        "Vector database",
                        "Neon pgvector when configured",
                        "Falls back visibly to memory",
                        "OPTIONAL",
                      ],
                      [
                        "Approval",
                        "Browser state",
                        "Does not change production systems",
                        "SAFE",
                      ],
                      [
                        "Payment action",
                        "Not connected",
                        "Recommendation only",
                        "BLOCKED",
                      ],
                    ].map((row) => (
                      <tr
                        key={row[0]}
                        className="text-slate-300"
                      >
                        {row
                          .slice(0, 3)
                          .map((cell) => (
                            <td
                              key={cell}
                              className="px-5 py-4"
                            >
                              {cell}
                            </td>
                          ))}

                        <td className="px-5 py-4">
                          <span
                            className={
                              row[3] === "LIVE"
                                ? "pass-chip"
                                : "watch-chip"
                            }
                          >
                            {row[3]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </TabsContent>
      </Tabs>

      {wizardOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-amber-300/20 bg-[#08101b] shadow-2xl">
            <div className="flex items-start justify-between border-b border-white/10 p-5">
              <div>
                <div className="eyebrow text-amber-200">START HERE</div>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  Guided payment incident intake
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Step {wizardStep + 1} of 4 · We’ll write the incident description for you.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWizardOpen(false)}
                className="rounded-lg border border-white/10 p-2 text-slate-500 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="p-5">
              {wizardStep === 0 && (
                <div className="grid gap-4">
                  <label className="grid gap-2 text-sm text-slate-300">
                    Which payment rail or service is affected?
                    <select
                      value={wizardData.rail}
                      onChange={(event) =>
                        setWizardData((current) => ({
                          ...current,
                          rail: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-slate-200 outline-none focus:border-amber-300/40"
                    >
                      {PAYMENT_RAIL_OPTIONS.map((rail) => (
                        <option key={rail} value={rail}>
                          {rail}
                        </option>
                      ))}
                    </select>
                  </label>

                  {wizardData.rail === "Other" && (
                    <label className="grid gap-2 text-sm text-slate-300">
                      Other rail / processor / service
                      <input
                        value={wizardData.otherRail}
                        onChange={(event) =>
                          setWizardData((current) => ({
                            ...current,
                            otherRail: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-slate-200 outline-none focus:border-amber-300/40"
                        placeholder="e.g., a specific processor or correspondent service"
                      />
                    </label>
                  )}

                  <label className="grid gap-2 text-sm text-slate-300">
                    What is failing or behaving abnormally?
                    <textarea
                      value={wizardData.symptom}
                      onChange={(event) =>
                        setWizardData((current) => ({
                          ...current,
                          symptom: event.target.value,
                        }))
                      }
                      rows={4}
                      className="rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-slate-200 outline-none focus:border-amber-300/40"
                      placeholder="Timeouts, rejects, duplicate payments, delayed acknowledgments, posting failures..."
                    />
                  </label>
                </div>
              )}

              {wizardStep === 1 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm text-slate-300">
                    When did it start?
                    <input
                      value={wizardData.startedAt}
                      onChange={(event) =>
                        setWizardData((current) => ({
                          ...current,
                          startedAt: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-slate-200 outline-none focus:border-amber-300/40"
                      placeholder="14:02 PT / after release 3.4"
                    />
                  </label>

                  <label className="grid gap-2 text-sm text-slate-300">
                    How many are affected?
                    <input
                      value={wizardData.affectedCount}
                      onChange={(event) =>
                        setWizardData((current) => ({
                          ...current,
                          affectedCount: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-slate-200 outline-none focus:border-amber-300/40"
                      placeholder="1,842 instructions / 327 members"
                    />
                  </label>

                  <label className="grid gap-2 text-sm text-slate-300">
                    Failure / delay rate
                    <input
                      value={wizardData.failureRate}
                      onChange={(event) =>
                        setWizardData((current) => ({
                          ...current,
                          failureRate: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-slate-200 outline-none focus:border-amber-300/40"
                      placeholder="18.4% / 22 minutes"
                    />
                  </label>

                  <label className="grid gap-2 text-sm text-slate-300">
                    Recent change, deploy, config, certificate?
                    <input
                      value={wizardData.recentChange}
                      onChange={(event) =>
                        setWizardData((current) => ({
                          ...current,
                          recentChange: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-slate-200 outline-none focus:border-amber-300/40"
                      placeholder="API release at 14:02 / none known"
                    />
                  </label>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="grid gap-4">
                  <label className="grid gap-2 text-sm text-slate-300">
                    Errors, rejects, processor responses, or codes
                    <textarea
                      value={wizardData.errorDetails}
                      onChange={(event) =>
                        setWizardData((current) => ({
                          ...current,
                          errorDetails: event.target.value,
                        }))
                      }
                      rows={3}
                      className="rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-slate-200 outline-none focus:border-amber-300/40"
                    />
                  </label>

                  <label className="grid gap-2 text-sm text-slate-300">
                    Queue, settlement, acknowledgment, or posting state
                    <textarea
                      value={wizardData.queueState}
                      onChange={(event) =>
                        setWizardData((current) => ({
                          ...current,
                          queueState: event.target.value,
                        }))
                      }
                      rows={3}
                      className="rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-slate-200 outline-none focus:border-amber-300/40"
                      placeholder="Oldest queued item, settlement status, ACK/NACK behavior..."
                    />
                  </label>

                  <label className="grid gap-2 text-sm text-slate-300">
                    Retry or duplicate behavior
                    <input
                      value={wizardData.retryState}
                      onChange={(event) =>
                        setWizardData((current) => ({
                          ...current,
                          retryState: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-slate-200 outline-none focus:border-amber-300/40"
                      placeholder="Retries 6.2× normal / duplicate submissions observed"
                    />
                  </label>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="grid gap-4">
                  <label className="grid gap-2 text-sm text-slate-300">
                    Customer / member impact
                    <textarea
                      value={wizardData.customerImpact}
                      onChange={(event) =>
                        setWizardData((current) => ({
                          ...current,
                          customerImpact: event.target.value,
                        }))
                      }
                      rows={3}
                      className="rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-slate-200 outline-none focus:border-amber-300/40"
                    />
                  </label>

                  <label className="grid gap-2 text-sm text-slate-300">
                    What has already been tried?
                    <textarea
                      value={wizardData.actionsTaken}
                      onChange={(event) =>
                        setWizardData((current) => ({
                          ...current,
                          actionsTaken: event.target.value,
                        }))
                      }
                      rows={3}
                      className="rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-slate-200 outline-none focus:border-amber-300/40"
                      placeholder="Paused retries, rolled back config, contacted processor..."
                    />
                  </label>

                  <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4">
                    <div className="eyebrow">PREVIEW</div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      {wizardSummary() || "Complete the intake questions to build the incident summary."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-white/10 p-5">
              <Button
                type="button"
                variant="outline"
                disabled={wizardStep === 0}
                onClick={() => setWizardStep((step) => Math.max(0, step - 1))}
              >
                Back
              </Button>

              {wizardStep < 3 ? (
                <Button
                  type="button"
                  onClick={() => setWizardStep((step) => Math.min(3, step + 1))}
                  disabled={
                    wizardStep === 0 &&
                    (!wizardData.symptom.trim() ||
                      (wizardData.rail === "Other" &&
                        !wizardData.otherRail.trim()))
                  }
                >
                  Continue
                  <ChevronRight className="ml-2 size-4" />
                </Button>
              ) : (
                <Button type="button" onClick={finishWizard}>
                  Use this incident
                  <Check className="ml-2 size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-5 right-5 z-40">
        {chatOpen ? (
          <div className="flex h-[560px] w-[390px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-cyan-300/20 bg-[#08101b] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 bg-cyan-300/[0.04] px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="grid size-8 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-200">
                  <MessageCircle className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">Chatty</div>
                  <div className="text-[11px] text-slate-500">
                    Current screen + Neon incident memory
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {chatMessages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={
                    message.role === "user"
                      ? "ml-10 rounded-xl bg-cyan-300/10 p-3 text-sm leading-6 text-cyan-50"
                      : "mr-6 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-sm leading-6 text-slate-300"
                  }
                >
                  <div>{message.content}</div>

                  {!!message.incident_matches?.length && (
                    <div className="mt-3 grid gap-2">
                      {message.incident_matches.map((match) => (
                        <button
                          type="button"
                          key={match.id}
                          onClick={() => void openIncidentFromChat(match.id)}
                          className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.04] p-2 text-left transition hover:bg-cyan-300/[0.08]"
                        >
                          <div className="text-xs font-semibold text-cyan-200">
                            {match.name}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {match.id} · {new Date(match.created_at).toLocaleString()}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {chatBusy && (
                <div className="mr-6 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-sm text-slate-500">
                  <LoaderCircle className="size-4 animate-spin" />
                  Reading the incident and Neon history…
                </div>
              )}
            </div>

            <div className="border-t border-white/10 p-3">
              <div className="flex gap-2">
                <textarea
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendChat();
                    }
                  }}
                  rows={2}
                  className="min-h-12 flex-1 resize-none rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-300/30"
                  placeholder='Ask “Has this happened before?”'
                />
                <Button
                  type="button"
                  size="icon"
                  onClick={() => void sendChat()}
                  disabled={chatBusy || !chatInput.trim()}
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="flex items-center gap-2 rounded-full border border-cyan-300/25 bg-[#0b1726] px-4 py-3 text-sm font-semibold text-cyan-100 shadow-2xl transition hover:bg-cyan-300/[0.08]"
          >
            <MessageCircle className="size-4" />
            Ask Chatty
          </button>
        )}
      </div>
    </main>
  );
}
