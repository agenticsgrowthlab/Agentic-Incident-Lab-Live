"use client";

import { useMemo, useState } from "react";
import type { OpsRail } from "./RailDailyRunbook";

type Message = { role:"user"|"assistant"; content:string };
const labels:Record<OpsRail,string>={ach:"ACH",fednow:"FedNow",fedwire:"FedWire",rtp:"RTP"};

export default function PaymentsOpsAI({
  rail,scenario,transactionId,screenContext
}:{
  rail:OpsRail;scenario:string;transactionId?:string|null;screenContext?:Record<string,unknown>;
}) {
  const label=labels[rail];
  const [open,setOpen]=useState(false);
  const [tab,setTab]=useState<"chat"|"team">("chat");
  const [messages,setMessages]=useState<Message[]>([]);
  const [input,setInput]=useState("");
  const [busy,setBusy]=useState(false);
  const [teamResult,setTeamResult]=useState<any|null>(null);
  const [error,setError]=useState<string|null>(null);
  const intro=useMemo(()=>`Ask ${label} Ops`,[label]);

  async function sendChat(){
    const question=input.trim();
    if(!question||busy)return;
    const next=[...messages,{role:"user" as const,content:question}];
    setMessages(next);setInput("");setBusy(true);setError(null);
    try{
      const r=await fetch("/api/payments-ops-ai/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        operator_id:typeof window!=="undefined"?localStorage.getItem("ops-operator-id"):null,operator_name:typeof window!=="undefined"?localStorage.getItem("ops-operator-name"):null,rail,scenario,message:question,transaction_id:transactionId||null,screen_context:screenContext||{},conversation:messages
      })});
      const p=await r.json();
      if(!r.ok)throw new Error(p?.detail||"Payments Ops Copilot failed");
      setMessages([...next,{role:"assistant",content:p.message}]);
    }catch(e){setError(e instanceof Error?e.message:"Payments Ops Copilot failed");}
    finally{setBusy(false);}
  }

  async function runTeam(){
    setBusy(true);setError(null);
    try{
      const question=input.trim()||`Analyze the current ${label} operations state. What should the operator do next?`;
      const r=await fetch("/api/payments-ops-ai/team",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        operator_id:typeof window!=="undefined"?localStorage.getItem("ops-operator-id"):null,operator_name:typeof window!=="undefined"?localStorage.getItem("ops-operator-name"):null,rail,scenario,question,transaction_id:transactionId||null,screen_context:screenContext||{}
      })});
      const p=await r.json();
      if(!r.ok)throw new Error(p?.detail||"AI team analysis failed");
      setTeamResult(p);setInput("");
    }catch(e){setError(e instanceof Error?e.message:"AI team analysis failed");}
    finally{setBusy(false);}
  }

  return <>
    <button type="button" onClick={()=>setOpen(v=>!v)}
      className="fixed bottom-5 right-5 z-[240] rounded-full border border-cyan-300/25 bg-[#0b161e] px-4 py-3 text-sm font-semibold text-cyan-100 shadow-2xl transition hover:-translate-y-0.5">
      ✦ {intro}
    </button>

    {open&&<div className="fixed bottom-20 right-5 z-[245] flex max-h-[78vh] w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-cyan-300/20 bg-[#0b161e] shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 bg-cyan-300/[0.04] p-4">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.14em] text-cyan-300">PAYMENTS OPS COPILOT</div>
          <div className="mt-1 font-semibold text-white">{label} operations</div>
          <div className="mt-1 text-xs text-slate-500">Evidence-aware · human-controlled actions</div>
        </div>
        <button type="button" onClick={()=>setOpen(false)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400">Close</button>
      </div>

      <div className="grid grid-cols-2 border-b border-white/10">
        <button type="button" onClick={()=>setTab("chat")} className={`px-3 py-3 text-xs font-semibold ${tab==="chat"?"bg-cyan-300/[0.08] text-cyan-100":"text-slate-500"}`}>{label} Ops Chat</button>
        <button type="button" onClick={()=>setTab("team")} className={`px-3 py-3 text-xs font-semibold ${tab==="team"?"bg-violet-300/[0.08] text-violet-100":"text-slate-500"}`}>AI Team Analysis</button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab==="chat"?<div className="grid gap-3">
          {!messages.length&&<div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm leading-6 text-slate-400">
            Ask about the visible {label} scenario, exceptions, posting, reconciliation, settlement, duplicate risk or what to check next.
          </div>}
          {messages.map((m,i)=><div key={i} className={`rounded-xl p-3 text-sm leading-6 ${m.role==="user"?"ml-8 border border-cyan-300/15 bg-cyan-300/[0.05] text-slate-200":"mr-5 border border-white/10 bg-black/20 text-slate-300"}`}>{m.content}</div>)}
          {busy&&<div className="text-xs text-slate-600">AI is reviewing the current {label} evidence…</div>}
        </div>:<div className="grid gap-3">
          {!teamResult&&<div className="rounded-xl border border-violet-300/15 bg-violet-300/[0.03] p-3 text-sm leading-6 text-slate-400">
            Run the specialist team when an issue crosses connectivity, account/funding state, posting, exceptions, reconciliation or risk.
          </div>}
          {teamResult&&<>
            <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.03] p-4">
              <div className="text-[10px] font-semibold tracking-[0.12em] text-cyan-300">OPERATIONS LEAD</div>
              <div className="mt-2 text-sm font-semibold text-white">{teamResult.lead?.summary}</div>
              <div className="mt-3 grid gap-2 text-xs text-slate-400">
                <div><span className="font-semibold text-slate-300">Network/payment state:</span> {teamResult.lead?.payment_or_network_state}</div>
                <div><span className="font-semibold text-slate-300">Operations status:</span> {teamResult.lead?.operations_status}</div>
                <div><span className="font-semibold text-slate-300">Recommended action:</span> {teamResult.lead?.recommended_action}</div>
                <div><span className="font-semibold text-slate-300">Duplicate risk:</span> {teamResult.lead?.duplicate_risk}</div>
              </div>
              {teamResult.lead?.escalate_to_incident_intelligence&&<div className="mt-3 rounded-lg border border-red-300/20 bg-red-300/[0.05] p-3 text-xs text-red-200">Escalate to Incident Intelligence / Lindsay.</div>}
              {!!teamResult.lead?.missing_evidence?.length&&<div className="mt-3 text-xs text-slate-500">Missing evidence: {teamResult.lead.missing_evidence.join(" · ")}</div>}
            </div>
            <div className="grid gap-2">{(teamResult.specialists||[]).map((agent:any,index:number)=><div key={index} className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs font-semibold text-white">{agent.name}<span className="font-normal text-slate-600"> · {agent.role}</span></div>
              <div className="mt-1 text-xs leading-5 text-slate-400">{agent.finding}</div>
            </div>)}</div>
          </>}
          {busy&&<div className="text-xs text-slate-600">Specialists are reviewing the current {label} evidence…</div>}
        </div>}
        {error&&<div className="mt-3 rounded-lg border border-red-300/20 bg-red-300/[0.05] p-3 text-xs text-red-200">{error}</div>}
      </div>

      <div className="border-t border-white/10 p-3">
        <textarea value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&tab==="chat"){e.preventDefault();sendChat();}}}
          rows={2} placeholder={tab==="chat"?`Ask ${label} Ops…`:`Optional question for the ${label} AI team…`}
          className="w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600"/>
        <button type="button" disabled={busy} onClick={tab==="chat"?sendChat:runTeam}
          className={`mt-2 w-full rounded-lg px-4 py-3 text-sm font-semibold disabled:opacity-40 ${tab==="chat"?"border border-cyan-300/25 bg-cyan-300/[0.10] text-cyan-100":"border border-violet-300/25 bg-violet-300/[0.10] text-violet-100"}`}>
          {busy?"Working…":tab==="chat"?"Send to Copilot":"Run AI Team Analysis"}
        </button>
      </div>
    </div>}
  </>;
}
