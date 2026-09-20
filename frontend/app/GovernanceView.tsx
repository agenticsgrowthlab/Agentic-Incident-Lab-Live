"use client";

import { useEffect, useMemo, useState } from "react";

type Rail = "ach"|"fednow"|"fedwire"|"rtp";
type ActivityRow = {
  event_id:string;
  created_at:string;
  run_id?:string|null;
  operator_name?:string|null;
  rail?:string|null;
  scenario?:string|null;
  activity_type:string;
  agent_name?:string|null;
  command_type?:string|null;
  command?:string|null;
  evidence_sources?:string[];
  result_summary?:string|null;
  status:string;
  proposed_action?:string|null;
  human_approval_required:boolean;
  escalation_target?:string|null;
  model?:string|null;
  latency_ms?:number|null;
};

function isoDate(d:Date){return d.toISOString().slice(0,10);}

export default function GovernanceView({currentRail}:{currentRail?:Rail}) {
  const today=useMemo(()=>new Date(),[]);
  const earliest=useMemo(()=>{const d=new Date();d.setUTCDate(d.getUTCDate()-89);return d;},[]);
  const defaultStart=useMemo(()=>{const d=new Date();d.setUTCDate(d.getUTCDate()-6);return d;},[]);
  const [startDate,setStartDate]=useState(isoDate(defaultStart));
  const [endDate,setEndDate]=useState(isoDate(today));
  const [rail,setRail]=useState<string>(currentRail||"all");
  const [activityFilter,setActivityFilter]=useState("all");
  const [payload,setPayload]=useState<any|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);

  async function load(){
    setLoading(true);setError(null);
    try{
      const qs=new URLSearchParams({start_date:startDate,end_date:endDate,rail,activity_filter:activityFilter,limit:"1000"});
      const r=await fetch(`/api/governance/activity?${qs.toString()}`,{cache:"no-store"});
      const p=await r.json();
      if(!r.ok)throw new Error(p?.detail||"Unable to load governance activity");
      setPayload(p);
    }catch(e){setError(e instanceof Error?e.message:"Unable to load governance activity");}
    finally{setLoading(false);}
  }

  useEffect(()=>{load();},[startDate,endDate,rail,activityFilter]);

  function download(){
    const qs=new URLSearchParams({start_date:startDate,end_date:endDate,rail,activity_filter:activityFilter});
    window.location.href=`/api/governance/export?${qs.toString()}`;
  }

  const s=payload?.summary||{};
  const rows:ActivityRow[]=payload?.activity||[];

  return <section className="grid gap-4">
    <div className="signal-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold tracking-[0.14em] text-violet-300">AI GOVERNANCE · AUDIT & OBSERVABILITY</div>
          <h1 className="mt-2 text-2xl font-semibold">AI proposes. Humans decide. Every AI action is observable.</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
            Review agent commands, Chatty/Copilot exchanges, evidence accessed, results, human approvals and escalations across payment rails.
            Governance records are retained for up to 90 days for audit.
          </p>
        </div>
        <button type="button" onClick={download}
          className="rounded-lg border border-emerald-300/25 bg-emerald-300/[0.08] px-4 py-3 text-sm font-semibold text-emerald-100">
          Download governance log
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="text-xs text-slate-500">Start date
          <input type="date" value={startDate} min={isoDate(earliest)} max={endDate} onChange={e=>setStartDate(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"/>
        </label>
        <label className="text-xs text-slate-500">End date
          <input type="date" value={endDate} min={startDate} max={isoDate(today)} onChange={e=>setEndDate(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"/>
        </label>
        <label className="text-xs text-slate-500">Rail
          <select value={rail} onChange={e=>setRail(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white">
            <option value="all">All rails</option><option value="ach">ACH</option><option value="fednow">FedNow</option><option value="fedwire">FedWire</option><option value="rtp">RTP</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">Activity
          <select value={activityFilter} onChange={e=>setActivityFilter(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white">
            <option value="all">All activity</option>
            <option value="agents">Agent commands</option>
            <option value="chatty">Chatty / Copilot</option>
            <option value="approvals">Human approvals</option>
            <option value="escalations">Escalations</option>
          </select>
        </label>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-[10px] font-semibold tracking-[0.12em] text-slate-500">RETENTION</div>
          <div className="mt-2 text-lg font-semibold text-white">90 days</div>
          <div className="mt-1 text-xs text-slate-600">Older records are automatically purged.</div>
        </div>
      </div>
      {error&&<div className="mt-4 rounded-lg border border-red-300/20 bg-red-300/[0.05] p-3 text-sm text-red-200">{error}</div>}
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {[
        ["Total events",s.total_events??0],
        ["Agent commands",s.agent_commands??0],
        ["Chatty exchanges",s.chat_exchanges??0],
        ["Human approvals",s.human_approvals??0],
        ["Escalations",s.escalations??0],
      ].map(([label,value])=><div key={String(label)} className="signal-card p-4">
        <div className="text-[10px] font-semibold tracking-[0.12em] text-slate-500">{label}</div>
        <div className="mt-2 text-2xl font-semibold text-white">{String(value)}</div>
      </div>)}
    </div>

    <div className="signal-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div><div className="text-xs font-semibold tracking-[0.14em] text-cyan-300">ACTIVITY LOG</div><div className="mt-1 text-sm text-slate-500">{rows.length} visible records</div></div>
        {loading&&<div className="text-xs text-slate-600">Loading…</div>}
      </div>

      <div className="mt-4 grid gap-3">
        {rows.map(row=><details key={row.event_id} className="rounded-xl border border-white/10 bg-black/20 p-4">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-semibold text-slate-400">{(row.rail||"—").toUpperCase()}</span>
                  <span className="text-xs font-semibold text-white">{row.agent_name||row.activity_type}</span>
                  <span className="text-[10px] text-slate-600">{row.command_type||row.activity_type}</span>
                  {row.escalation_target&&<span className="rounded-full bg-red-300/10 px-2 py-1 text-[10px] font-semibold text-red-200">ESCALATED</span>}
                  {row.human_approval_required&&<span className="rounded-full bg-amber-300/10 px-2 py-1 text-[10px] font-semibold text-amber-200">HUMAN APPROVAL</span>}
                </div>
                <div className="mt-2 text-sm text-slate-300">{row.command||row.result_summary||"Governance event"}</div>
              </div>
              <div className="text-right text-[10px] text-slate-600">
                <div>{new Date(row.created_at).toLocaleString()}</div>
                <div className="mt-1">{row.operator_name||"Unassigned operator"} · {row.status}</div>
              </div>
            </div>
          </summary>

          <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 lg:grid-cols-2">
            <GovBox title="Evidence accessed" items={row.evidence_sources||[]}/>
            <GovBox title="Result" text={row.result_summary||"No result summary recorded."}/>
            <GovBox title="Proposed action" text={row.proposed_action||"No consequential action proposed."}/>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-slate-500">
              <div><span className="font-semibold text-slate-300">Run ID:</span> {row.run_id||"—"}</div>
              <div className="mt-1"><span className="font-semibold text-slate-300">Model:</span> {row.model||"—"}</div>
              <div className="mt-1"><span className="font-semibold text-slate-300">Latency:</span> {row.latency_ms!=null?`${row.latency_ms} ms`:"—"}</div>
              <div className="mt-1"><span className="font-semibold text-slate-300">Escalation:</span> {row.escalation_target||"None"}</div>
            </div>
          </div>
        </details>)}
        {!loading&&!rows.length&&<div className="rounded-xl border border-white/10 bg-black/20 p-8 text-center text-sm text-slate-600">No governance activity exists for the selected filters yet.</div>}
      </div>
    </div>

    <div className="rounded-xl border border-violet-300/15 bg-violet-300/[0.035] p-4 text-xs leading-5 text-slate-500">
      Governance captures observable commands, evidence sources, outputs, proposed actions, approvals and escalations. It intentionally does not store hidden chain-of-thought.
    </div>
  </section>;
}

function GovBox({title,items,text}:{title:string;items?:string[];text?:string}){
  return <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
    <div className="text-[10px] font-semibold tracking-[0.12em] text-slate-500">{title.toUpperCase()}</div>
    {items?<div className="mt-2 grid gap-1">{items.map((item,index)=><div key={index} className="text-xs text-slate-300">• {item}</div>)}{!items.length&&<div className="text-xs text-slate-600">None recorded.</div>}</div>:<div className="mt-2 text-xs leading-5 text-slate-300">{text}</div>}
  </div>;
}
