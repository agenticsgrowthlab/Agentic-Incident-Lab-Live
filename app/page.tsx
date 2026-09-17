"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BookOpen, Bot, Braces, Check, CheckCircle2, ChevronRight, CircleGauge, Cloud, Database, Eye, FileSearch, GitBranch, LockKeyhole, Network, Play, RefreshCcw, ShieldCheck, Sparkles, Timer, UserCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Framework = "LangGraph" | "CrewAI" | "AutoGen";
type RunState = "ready" | "running" | "complete" | "approved" | "error";
type BackendState = "checking" | "ready" | "configuration_required" | "unreachable";

type AgentFinding = { name: string; role: string; finding: string; status: string };
type Evidence = { id: string; title: string; type: string; score: number; excerpt: string };
type AnalysisResult = {
  run_id: string;
  framework: Framework;
  model: string;
  live: boolean;
  latency_ms: number;
  retrieval_mode: string;
  retrieval_notice?: string | null;
  citation_coverage: number;
  token_usage: { input_tokens: number; output_tokens: number; total_tokens: number };
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

const API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || "/api/analyze";
const DEFAULT_INCIDENT = "ACH payments are failing intermittently. Processor timeouts rose after the 14:02 deployment. Failure rate is 18.4%, 1,842 payment instructions are affected, retry volume is 6.2× normal, and the oldest queued message is 47 minutes old. Some customers have attempted payment more than once.";

const frameworkCopy: Record<Framework, { label: string; pattern: string; color: string }> = {
  LangGraph: { label: "Controlled state graph", pattern: "Deterministic routing + checkpoints", color: "cyan" },
  CrewAI: { label: "Role-based crew", pattern: "Delegation + specialized expertise", color: "violet" },
  AutoGen: { label: "Conversational team", pattern: "Message passing + group consensus", color: "amber" },
};

const waitingAgents: AgentFinding[] = [
  { name: "Lindsay", role: "Incident Commander", finding: "Waiting for live analysis…", status: "waiting" },
  { name: "Payments SME", role: "Rail & settlement", finding: "Waiting for retrieved evidence…", status: "waiting" },
  { name: "Platform Agent", role: "API & queue health", finding: "Waiting for retrieved evidence…", status: "waiting" },
  { name: "Scout", role: "Customer impact", finding: "Waiting for retrieved evidence…", status: "waiting" },
  { name: "Risk Agent", role: "Controls & compliance", finding: "Waiting for retrieved evidence…", status: "waiting" },
];

const architectureLayers = [
  { icon: Cloud, title: "Experience & access", items: "Vercel · Next.js · protected Python API", accent: "#39d9e6" },
  { icon: GitBranch, title: "Agent orchestration", items: "LangGraph · CrewAI · AutoGen", accent: "#9f8cff" },
  { icon: Sparkles, title: "Models & intelligence", items: "OpenAI chat models · structured outputs", accent: "#ffb55e" },
  { icon: Database, title: "Knowledge & state", items: "OpenAI embeddings · Neon pgvector", accent: "#6ee7a7" },
  { icon: CircleGauge, title: "Operations & assurance", items: "Run IDs · tokens · latency · evidence lineage", accent: "#ff7185" },
];

export default function Home() {
  const [framework, setFramework] = useState<Framework>("LangGraph");
  const [incident, setIncident] = useState(DEFAULT_INCIDENT);
  const [runState, setRunState] = useState<RunState>("ready");
  const [backendState, setBackendState] = useState<BackendState>("checking");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(API_URL, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unreachable");
        return response.json() as Promise<{ configured?: boolean }>;
      })
      .then((data) => { if (active) setBackendState(data.configured ? "ready" : "configuration_required"); })
      .catch(() => { if (active) setBackendState("unreachable"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (runState !== "running") return;
    const timer = window.setInterval(() => setProgress((value) => Math.min(92, value + Math.max(2, Math.round((94 - value) / 7)))), 900);
    return () => window.clearInterval(timer);
  }, [runState]);

  const runAnalysis = async () => {
    setRunState("running");
    setProgress(8);
    setResult(null);
    setError(null);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ framework, incident }),
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(payload.detail || payload.error || `Agent API returned ${response.status}`));
      setResult(payload as AnalysisResult);
      setProgress(100);
      setBackendState("ready");
      setRunState("complete");
    } catch (cause) {
      setProgress(0);
      setError(cause instanceof Error ? cause.message : "The live agent run failed");
      setRunState("error");
    }
  };

  const resetRun = () => { setRunState("ready"); setProgress(0); setResult(null); setError(null); };
  const statusLabel = useMemo(() => {
    if (runState === "running") return progress < 30 ? "Retrieving evidence" : progress < 62 ? "Running specialist agents" : "Synthesizing recommendation";
    if (runState === "complete") return "Live analysis complete";
    if (runState === "approved") return "Human approval recorded locally";
    if (runState === "error") return "Run needs attention";
    return "Ready for live analysis";
  }, [runState, progress]);

  const agents = result?.agents || waitingAgents;
  const evidence = result?.evidence || [];
  const recommendation = result?.recommendation;
  const confidence = recommendation ? Math.round(recommendation.confidence * 100) : 0;
  const backendLabel = backendState === "ready" ? "Live AI configured" : backendState === "configuration_required" ? "API key required" : backendState === "checking" ? "Checking AI backend" : "Backend deploy pending";

  return (
    <main className="min-h-screen bg-[#071017] text-[#f2f7f8]">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#071017]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-5 px-5 py-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200"><Network className="size-5" /></div><div className="min-w-0"><div className="truncate text-[15px] font-semibold tracking-[0.08em]">AGENTIC INCIDENT LAB</div><div className="text-xs text-slate-400">Live multi-framework AI · Nicole Chernow-Martinez</div></div></div>
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-slate-300 sm:flex"><span className={`size-2 rounded-full ${backendState === "ready" ? "bg-emerald-400 shadow-[0_0_12px_#34d399]" : backendState === "checking" ? "animate-pulse bg-amber-300" : "bg-red-400"}`} />{backendLabel}</div>
        </div>
      </header>

      <Tabs defaultValue="incident" className="mx-auto max-w-[1500px] gap-0 px-4 pb-12 pt-5 lg:px-8">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto overflow-y-hidden border-b border-white/10 pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="incident" className="px-4 pb-3 text-slate-400 data-[state=active]:text-cyan-200">Incident room</TabsTrigger>
          <TabsTrigger value="architecture" className="px-4 pb-3 text-slate-400 data-[state=active]:text-cyan-200">Live architecture</TabsTrigger>
          <TabsTrigger value="frameworks" className="px-4 pb-3 text-slate-400 data-[state=active]:text-cyan-200">Framework lab</TabsTrigger>
          <TabsTrigger value="governance" className="px-4 pb-3 text-slate-400 data-[state=active]:text-cyan-200">Governance</TabsTrigger>
        </TabsList>

        <TabsContent value="incident" className="pt-6">
          <section className="mb-5 grid gap-4 xl:grid-cols-[1.45fr_.75fr]">
            <div className="signal-card relative overflow-hidden p-5 sm:p-6"><div className="absolute right-0 top-0 h-full w-1 bg-gradient-to-b from-red-400 via-amber-300 to-transparent" /><div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold tracking-[0.1em] text-slate-400"><span className="rounded border border-red-400/30 bg-red-400/10 px-2 py-1 text-red-300">INCIDENT INPUT</span><span>LIVE MODEL ANALYSIS</span></div><h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">What is happening?</h1><p className="mt-2 text-sm leading-6 text-slate-400">Describe the operational symptoms, timing, volume and known changes. The selected framework will retrieve relevant evidence and analyze this text.</p><Textarea value={incident} onChange={(event) => setIncident(event.target.value)} disabled={runState === "running"} aria-label="Incident description" className="mt-5 min-h-36 resize-y border-white/15 bg-black/20 text-base leading-6 text-slate-100 placeholder:text-slate-600 focus-visible:border-cyan-300/60 focus-visible:ring-cyan-300/20" /></div>
            <div className="signal-card p-5 sm:p-6"><div className="eyebrow">CONTROL DESK</div><h2 className="mt-2 text-lg font-semibold">Choose the real orchestration runtime</h2><div className="mt-4 grid gap-2">{(Object.keys(frameworkCopy) as Framework[]).map((item)=><button key={item} onClick={()=>{setFramework(item);resetRun();}} disabled={runState === "running"} className={`framework-choice ${framework===item?"framework-choice-active":""}`} aria-pressed={framework===item}><span className={`framework-dot framework-${frameworkCopy[item].color}`}/><span className="min-w-0 text-left"><span className="block font-semibold text-white">{item}</span><span className="block truncate text-xs text-slate-500">{frameworkCopy[item].label}</span></span>{framework===item&&<Check className="ml-auto size-4 text-cyan-200"/>}</button>)}</div><Button onClick={runAnalysis} disabled={runState==="running" || incident.trim().length < 20} className="mt-4 h-11 w-full bg-cyan-300 font-semibold text-[#061218] hover:bg-cyan-200">{runState==="running"?<><RefreshCcw className="animate-spin"/>Running live agents</>:<><Play className="fill-current"/>Run {framework} analysis</>}</Button><p className="mt-3 text-xs leading-5 text-slate-500">Calls the deployed Python backend. Model usage may incur API charges.</p></div>
          </section>

          {error && <div className="mb-4 flex gap-3 rounded-xl border border-red-400/25 bg-red-400/[0.07] p-4 text-sm text-red-100"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-300"/><div><div className="font-semibold">Live run did not complete</div><div className="mt-1 text-red-100/75">{error}</div>{error.includes("OPENAI_API_KEY") && <div className="mt-2 text-xs text-red-100/60">Add OPENAI_API_KEY in Vercel → Project Settings → Environment Variables, then redeploy.</div>}</div></div>}

          <section className="grid gap-4 xl:grid-cols-[1.45fr_.75fr]">
            <div className="grid gap-4">
              <div className="signal-card p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow">LIVE ORCHESTRATION TRACE</div><h2 className="mt-2 text-lg font-semibold">{frameworkCopy[framework].pattern}</h2></div><span className="status-chip"><span className={runState==="running"?"pulse-dot":"steady-dot"}/>{statusLabel}</span></div><Progress value={progress} className="mt-5 h-1.5 bg-white/10 [&_[data-slot=progress-indicator]]:bg-cyan-300"/><div className="mt-5 grid gap-2">{agents.map((agent,index)=>{const icons=[Activity,Zap,Network,Eye,ShieldCheck];const Icon=icons[index%icons.length];const active=runState==="running" || agent.status==="complete";return <div key={`${agent.name}-${index}`} className={`agent-row ${active?"agent-row-active":""}`}><div className="agent-icon"><Icon className="size-4"/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-2"><span className="font-semibold text-white">{agent.name}</span><span className="text-xs text-slate-500">{agent.role}</span></div><p className="mt-1 text-sm leading-5 text-slate-400">{runState === "running" && !result ? "Agent execution in progress…" : agent.finding}</p></div>{agent.status==="complete"?<CheckCircle2 className="size-4 shrink-0 text-emerald-300"/>:<Timer className="size-4 shrink-0 text-slate-600"/>}</div>})}</div></div>
              <div className={`recommendation-card ${recommendation?"opacity-100":"opacity-45"}`}><div className="flex items-center gap-2 text-sm font-semibold text-emerald-200"><ShieldCheck className="size-4"/>LIVE RECOMMENDATION {recommendation ? `· ${confidence}% CONFIDENCE` : "· PENDING"}</div><h2 className="mt-3 text-xl font-semibold">{recommendation?.summary || "Run the agents to generate an evidence-grounded response."}</h2>{recommendation && <><p className="mt-2 text-sm leading-6 text-slate-400">{recommendation.rationale}</p><div className="mt-5 grid gap-3 sm:grid-cols-3"><div><span className="detail-label">Likely cause</span><p>{recommendation.likely_cause}</p></div><div><span className="detail-label">Primary control</span><p>{recommendation.primary_control}</p></div><div><span className="detail-label">Escalation</span><p>{recommendation.escalation}</p></div></div></>}<div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4"><Button onClick={()=>setRunState("approved")} disabled={runState!=="complete"} className="bg-emerald-300 text-emerald-950 hover:bg-emerald-200"><UserCheck/>{runState==="approved"?"Approval recorded":"Approve recommendation"}</Button><Button onClick={resetRun} variant="outline" className="border-white/15 bg-transparent text-slate-200 hover:bg-white/10 hover:text-white"><RefreshCcw/>Reset</Button><span className="text-xs text-slate-500">Approval is recorded in this browser; no payment-system action is executed.</span></div></div>
            </div>

            <aside className="grid content-start gap-4"><div className="signal-card p-5"><div className="flex items-center justify-between"><div><div className="eyebrow">RAG EVIDENCE</div><h2 className="mt-2 font-semibold">Retrieved sources</h2></div><FileSearch className="size-5 text-cyan-200"/></div><div className="mt-4 grid gap-2">{evidence.length ? evidence.map((item)=><div key={item.id} className="evidence-row"><div className="min-w-0"><span className="block text-[11px] font-semibold tracking-[0.08em] text-cyan-300">{item.type}</span><span className="mt-1 block truncate text-sm text-slate-200">{item.title}</span></div><span className="font-mono text-xs text-slate-500">{Math.round(item.score*100)}%</span></div>) : <div className="rounded-lg border border-dashed border-white/10 p-4 text-sm leading-6 text-slate-500">Evidence will appear after the embedding search completes.</div>}</div><div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-500"><Braces className="mr-2 inline size-3.5 text-violet-300"/>{result?.retrieval_mode || "Embeddings → vector similarity → cited context → agent reasoning"}</div>{result?.retrieval_notice && <p className="mt-2 text-xs text-amber-300/70">{result.retrieval_notice}</p>}</div>
              <div className="signal-card p-5"><div className="eyebrow">MEASURED RUN TELEMETRY</div><div className="mt-4 grid grid-cols-2 gap-3">{[[result?`${(result.latency_ms/1000).toFixed(1)} s`:"—","Latency"],[result?result.token_usage.total_tokens.toLocaleString():"—","Tokens"],[result?`${Math.round(result.citation_coverage*100)}%`:"—","Citation coverage"],[result?.model||"—","Model"]].map(([value,label])=><div key={label} className="rounded-lg border border-white/10 bg-white/[0.025] p-3"><div className="truncate font-mono text-base text-white" title={value}>{value}</div><div className="mt-1 text-xs text-slate-500">{label}</div></div>)}</div>{result && <div className="mt-3 font-mono text-[11px] text-slate-600">{result.run_id}</div>}</div>
            </aside>
          </section>
        </TabsContent>

        <TabsContent value="architecture" className="pt-6"><section className="signal-card overflow-hidden"><div className="border-b border-white/10 p-5 sm:p-7"><div className="eyebrow">IMPLEMENTED RUNTIME</div><div className="mt-2 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Live agentic AI on Vercel</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">The Next.js interface calls a Python function that retrieves evidence, invokes the selected framework, measures the run, and returns a human-gated recommendation.</p></div><span className="rounded-md border border-emerald-300/20 bg-emerald-300/[0.07] px-3 py-2 text-xs text-emerald-200">Implemented—not a diagram-only simulation</span></div></div><div className="grid gap-px bg-white/10 lg:grid-cols-5">{architectureLayers.map((layer,index)=>{const Icon=layer.icon;return <div key={layer.title} className="relative bg-[#0b161e] p-5 lg:min-h-[250px]"><div className="flex items-center justify-between"><div className="grid size-10 place-items-center rounded-lg border border-white/10 bg-white/[0.04]" style={{color:layer.accent}}><Icon className="size-5"/></div><span className="font-mono text-xs text-slate-600">0{index+1}</span></div><h3 className="mt-7 font-semibold">{layer.title}</h3><p className="mt-3 text-sm leading-6 text-slate-400">{layer.items}</p>{index<architectureLayers.length-1&&<ChevronRight className="absolute -right-3 top-1/2 z-10 hidden size-6 rounded-full border border-white/10 bg-[#0b161e] p-1 text-slate-500 lg:block"/>}</div>})}</div></section><div className="mt-4 grid gap-4 md:grid-cols-3">{[[LockKeyhole,"Secrets stay server-side","The browser never receives the model key or database connection string."],[CircleGauge,"Observable by default","Every completed run returns a run ID, actual latency, token usage, framework, model and citation coverage."],[UserCheck,"Human authority","The model recommends; a person approves. No external payment action is wired into the portfolio lab."]].map(([I,title,copy])=>{const Icon=I as typeof LockKeyhole;return <div key={String(title)} className="signal-card p-5"><Icon className="size-5 text-cyan-200"/><h3 className="mt-4 font-semibold">{String(title)}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{String(copy)}</p></div>})}</div></TabsContent>

        <TabsContent value="frameworks" className="pt-6"><section className="mb-5 max-w-3xl"><div className="eyebrow">RUN-TIME COMPARISON</div><h1 className="mt-2 text-2xl font-semibold tracking-tight">The buttons now execute three different Python frameworks.</h1><p className="mt-2 text-sm leading-6 text-slate-400">All three receive the same incident and retrieved evidence, making their orchestration behavior directly comparable.</p></section><div className="grid gap-4 lg:grid-cols-3">{[["LangGraph","Stateful graph","Four specialist nodes feed a controlled synthesis node through explicit graph edges.",["StateGraph execution","Deterministic edges","Structured synthesis"]],["CrewAI","Role-based crew","Specialist agents own sequential tasks and an incident commander synthesizes their shared context.",["Crew + Task objects","Role-specific agents","Sequential process"]],["AutoGen","Conversational agents","A round-robin team shares context, with the incident commander producing the final structured recommendation.",["AssistantAgent team","Shared conversation","Bounded termination"]]].map(([name,pattern,copy,benefits])=><article key={String(name)} className="framework-card"><div className="flex items-center justify-between"><Bot className="size-5 text-cyan-200"/><span className="text-xs text-slate-500">{String(pattern)}</span></div><h2 className="mt-6 text-xl font-semibold">{String(name)}</h2><p className="mt-3 min-h-20 text-sm leading-6 text-slate-400">{String(copy)}</p><div className="my-5 h-px bg-white/10"/><ul className="grid gap-3">{(benefits as string[]).map(item=><li key={item} className="flex items-center gap-2 text-sm text-slate-300"><Check className="size-4 text-emerald-300"/>{item}</li>)}</ul></article>)}</div><div className="mt-4 signal-card p-5"><div className="flex gap-3"><BookOpen className="mt-0.5 size-5 shrink-0 text-amber-300"/><div><h3 className="font-semibold">Fair comparison boundary</h3><p className="mt-1 text-sm leading-6 text-slate-400">The knowledge set, model configuration and response contract remain constant. Only orchestration changes. Results may vary because the model calls are live.</p></div></div></div></TabsContent>

        <TabsContent value="governance" className="pt-6"><section className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]"><div className="signal-card p-5 sm:p-6"><div className="eyebrow">RESPONSIBLE AI CONTROL PLANE</div><h1 className="mt-2 text-2xl font-semibold tracking-tight">Every recommendation needs evidence, limits and an owner.</h1><p className="mt-3 text-sm leading-6 text-slate-400">Controls are implemented in the request path instead of being presentation-only claims.</p><div className="mt-6 grid gap-3">{[["01","Ground inputs","Retrieve a bounded set of versioned knowledge documents."],["02","Constrain output","Require structured JSON and normalize every returned field."],["03","Limit requests","Validate incident length and allow only named frameworks."],["04","Protect secrets","Keep API and database credentials in server environment variables."],["05","Require approval","Keep consequential action outside autonomous execution."]].map(([num,title,copy])=><div key={num} className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3"><span className="font-mono text-xs text-cyan-300">{num}</span><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{copy}</p></div></div>)}</div></div><div className="signal-card overflow-hidden"><div className="border-b border-white/10 p-5"><div className="eyebrow">OPERATING BOUNDARIES</div><h2 className="mt-2 font-semibold">What the live portfolio lab does—and does not do</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-white/[0.025] text-xs tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-medium">CAPABILITY</th><th className="px-5 py-3 font-medium">IMPLEMENTATION</th><th className="px-5 py-3 font-medium">BOUNDARY</th><th className="px-5 py-3 font-medium">STATUS</th></tr></thead><tbody className="divide-y divide-white/10">{[["Agent reasoning","Live model calls","No hidden chain-of-thought displayed","LIVE"],["RAG","Embeddings + similarity","Bundled portfolio documents","LIVE"],["Vector database","Neon pgvector when configured","Falls back visibly to memory","OPTIONAL"],["Approval","Browser state","Does not change production systems","SAFE"],["Payment action","Not connected","Recommendation only","BLOCKED"]].map(row=><tr key={row[0]} className="text-slate-300">{row.slice(0,3).map(cell=><td key={cell} className="px-5 py-4">{cell}</td>)}<td className="px-5 py-4"><span className={row[3]==="LIVE"?"pass-chip":"watch-chip"}>{row[3]}</span></td></tr>)}</tbody></table></div></div></section></TabsContent>
      </Tabs>
    </main>
  );
}
