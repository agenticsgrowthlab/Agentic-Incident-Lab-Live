"use client";

import { useState } from "react";

type Props = {
  scenario: "healthy" | "watch" | "critical";
  transactionId?: string | null;
  screenContext?: Record<string, unknown>;
};

type TeamResult = {
  agents: Array<{name:string;role:string;finding:string}>;
  analysis: {
    summary?: string;
    payment_outcome?: string;
    operations_status?: string;
    likely_cause?: string;
    recommended_action?: string;
    why?: string;
    duplicate_risk?: string;
    human_approval_required?: boolean;
    escalate_to_incident_intelligence?: boolean;
  };
};

export default function ACHOpsAI({ scenario, transactionId, screenContext = {} }: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<Array<{role:"user"|"assistant";content:string}>>([]);
  const [team, setTeam] = useState<TeamResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"chat"|"team">("chat");
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    const text = message.trim();
    if (!text) return;
    setBusy(true); setError(null);
    const next = [...chat, {role:"user" as const, content:text}];
    setChat(next); setMessage("");
    try {
      const r = await fetch("/api/ach-ai/chat", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({message:text,scenario,transaction_id:transactionId||null,screen_context:screenContext,history:chat.slice(-8)}),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "ACH Ops Copilot unavailable");
      setChat([...next, {role:"assistant", content:data.answer}]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
    } finally { setBusy(false); }
  }

  async function runTeam() {
    setBusy(true); setError(null); setMode("team");
    try {
      const r = await fetch("/api/ach-ai/team", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          scenario,
          transaction_id:transactionId||null,
          screen_context:screenContext,
          question:message.trim()||"Analyze the current ACH operating condition and recommend the safest next action."
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "ACH AI team unavailable");
      setTeam(data); setMessage("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Team analysis failed");
    } finally { setBusy(false); }
  }

  return <>
    {!open && <button onClick={()=>setOpen(true)} className="fixed bottom-5 right-5 z-[180] rounded-full border border-cyan-300/30 bg-[#0a1821] px-5 py-3 text-sm font-semibold text-cyan-100 shadow-2xl hover:bg-cyan-300/[0.08]">✦ Ask ACH Ops</button>}

    {open && <div className="fixed bottom-4 right-4 z-[220] flex h-[min(720px,88vh)] w-[min(470px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#09151d] shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <div><div className="text-xs font-semibold tracking-[0.14em] text-cyan-300">ACH OPERATIONS INTELLIGENCE</div><div className="mt-1 text-sm font-semibold text-white">ACH Ops Copilot + Specialist Team</div></div>
        <button onClick={()=>setOpen(false)} className="rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/5">Close</button>
      </div>

      <div className="flex border-b border-white/10 p-2">
        <button onClick={()=>setMode("chat")} className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold ${mode==="chat"?"bg-cyan-300/10 text-cyan-200":"text-slate-500"}`}>ACH Ops Chat</button>
        <button onClick={()=>setMode("team")} className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold ${mode==="team"?"bg-violet-300/10 text-violet-200":"text-slate-500"}`}>AI Team Analysis</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {mode==="chat" ? <div className="grid gap-3">
          {chat.length===0 && <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4 text-sm leading-6 text-slate-400">I can explain this ACH screen, a transaction, a return code, a preflight result, posting/reconciliation state, or whether a retry is safe.</div>}
          {chat.map((item,i)=><div key={i} className={`rounded-xl p-3 text-sm leading-6 ${item.role==="user"?"ml-8 bg-white/[0.06] text-slate-200":"mr-5 border border-cyan-300/10 bg-cyan-300/[0.03] text-slate-300"}`}><div className="mb-1 text-[10px] font-semibold tracking-[0.1em] text-slate-600">{item.role==="user"?"YOU":"ACH OPS COPILOT"}</div>{item.content}</div>)}
        </div> : <div className="grid gap-3">
          {!team && <div className="rounded-xl border border-violet-300/15 bg-violet-300/[0.04] p-4 text-sm leading-6 text-slate-400">Run the specialist team against the current ACH scenario and selected transaction.</div>}
          {team && <>
            <div className="rounded-xl border border-violet-300/20 bg-violet-300/[0.05] p-4">
              <div className="text-[10px] font-semibold tracking-[0.12em] text-violet-300">ACH OPERATIONS LEAD</div>
              <div className="mt-2 text-sm font-semibold text-white">{team.analysis.summary || "Analysis complete"}</div>
              <div className="mt-3 grid gap-2 text-xs">
                <div><span className="text-slate-500">Likely cause:</span> <span className="text-slate-300">{team.analysis.likely_cause || "—"}</span></div>
                <div><span className="text-slate-500">Recommended action:</span> <span className="text-cyan-200">{team.analysis.recommended_action || "—"}</span></div>
                <div><span className="text-slate-500">Duplicate risk:</span> <span className="text-slate-300">{team.analysis.duplicate_risk || "—"}</span></div>
                <div><span className="text-slate-500">Payment outcome:</span> <span className="text-slate-300">{team.analysis.payment_outcome || "—"}</span></div>
                <div><span className="text-slate-500">Operations status:</span> <span className="text-slate-300">{team.analysis.operations_status || "—"}</span></div>
              </div>
              {team.analysis.human_approval_required && <div className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/[0.05] p-2 text-xs text-amber-200">Human approval required for consequential action.</div>}
              {team.analysis.escalate_to_incident_intelligence && <div className="mt-2 rounded-md border border-red-300/20 bg-red-300/[0.05] p-2 text-xs text-red-200">Team recommends escalation to Incident Intelligence / Lindsay.</div>}
            </div>
            {team.agents.slice(1).map(agent=><div key={agent.name} className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-xs font-semibold text-white">{agent.name}</div><div className="mt-1 text-[10px] text-slate-600">{agent.role}</div><p className="mt-2 text-xs leading-5 text-slate-400">{agent.finding}</p></div>)}
          </>}
        </div>}
        {error && <div className="mt-3 rounded-lg border border-red-300/20 bg-red-300/[0.05] p-3 text-xs text-red-200">{error}</div>}
      </div>

      <div className="border-t border-white/10 p-3">
        <textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder={mode==="chat"?"Ask about this ACH condition…":"Optional question for the specialist team…"} className="h-20 w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white outline-none placeholder:text-slate-700" />
        <div className="mt-2 flex gap-2">
          {mode==="chat" ? <button disabled={busy||!message.trim()} onClick={ask} className="flex-1 rounded-lg bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-100 ring-1 ring-cyan-300/20 disabled:opacity-40">{busy?"Thinking…":"Ask ACH Ops"}</button> :
          <button disabled={busy} onClick={runTeam} className="flex-1 rounded-lg bg-violet-300/10 px-3 py-2 text-sm font-semibold text-violet-100 ring-1 ring-violet-300/20 disabled:opacity-40">{busy?"Team analyzing…":"Run AI Team Analysis"}</button>}
        </div>
      </div>
    </div>}
  </>;
}
