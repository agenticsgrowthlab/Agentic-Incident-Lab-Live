"use client";

import { useEffect, useState } from "react";
import PromptRegistry from "./PromptRegistry";

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
  const [today,setToday]=useState("");
  const [earliest,setEarliest]=useState("");
  const [startDate,setStartDate]=useState("");
  const [endDate,setEndDate]=useState("");
  const [rail,setRail]=useState<string>(currentRail||"all");
  const [activityFilter,setActivityFilter]=useState("all");
  const [payload,setPayload]=useState<any|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    const now=new Date();
    const first=new Date(now);
    first.setUTCDate(first.getUTCDate()-89);
    const start=new Date(now);
    start.setUTCDate(start.getUTCDate()-6);
    setToday(isoDate(now));
    setEarliest(isoDate(first));
    setStartDate(isoDate(start));
    setEndDate(isoDate(now));
  },[]);

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

  useEffect(()=>{if(startDate&&endDate)load();},[startDate,endDate,rail,activityFilter]);

  function download(){
    const qs=new URLSearchParams({start_date:startDate,end_date:endDate,rail,activity_filter:activityFilter});
    window.location.href=`/api/governance/export?${qs.toString()}`;
  }

  const s=payload?.summary||{};
  const rows:ActivityRow[]=payload?.activity||[];

  return <section className="grid gap-4">
    <PromptRegistry scope="platform" currentRail={currentRail}/>
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
        <button type="button" onClick={download} disabled={!startDate||!endDate}
          className="rounded-lg border border-emerald-300/25 bg-emerald-300/[0.08] px-4 py-3 text-sm font-semibold text-emerald-100 disabled:opacity-40">
          Download governance log
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="text-xs text-slate-500">Start date
          <input type="date" value={startDate} min={earliest} max={endDate} onChange={e=>setStartDate(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"/>
        </label>
        <label className="text-xs text-slate-500">End date
          <input type="date" value={endDate} min={startDate} max={today} onChange={e=>setEndDate(e.target.value)}
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

    <div className="signal-card p-5 sm:p-6">
      <div className="text-xs font-semibold tracking-[0.14em] text-violet-300">UAT &amp; SAFETY VALIDATION</div>
      <h2 className="mt-2 text-xl font-semibold">Payments Operations UAT record</h2>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
        Regression history is documented here so operators and reviewers can see what was tested, what passed,
        what required remediation and what still requires manual verification.
      </p>

      <div className="mt-5 grid gap-3">
        <UatRow status="PASS" severity="High" title="Visible ACH transaction context"
          detail="Copilot recognizes the displayed ACH transaction and warns against blind retry / duplicate-payment risk."/>
        <UatRow status="PASS" severity="High" title="Nacha preflight validation"
          detail="Valid ACH file passes; invalid routing check digit fails with ROUTING_CHECK_DIGIT; Chat explains the observed preflight failure."/>
        <UatRow status="PASS" severity="High" title="Incident escalation"
          detail="ACH specialists explicitly route material/systemic issues to Incident Intelligence / Lindsay; live Incident Intelligence analysis completes."/>
        <UatRow status="PASS" severity="Medium" title="Payment outcome vs incident status"
          detail="Copilot labels payment outcome separately from operations / incident status for returned-payment questions."/>
        <UatRow status="PASS" severity="Low" title="ACH summary fields"
          detail="Stage, processor, posting and reconciliation summary fields render instead of empty dashes."/>

        <UatRow status="FIXED · RETEST REQUIRED" severity="High" title="Downstream certainty invariant"
          detail="Specialists are now hard-guarded: without affirmative downstream events, acceptance/posting remains UNKNOWN. Unsupported claims such as never accepted, never posted, or safe to retry are prohibited and safety-corrected before synthesis."/>
        <UatRow status="FIXED · RETEST REQUIRED" severity="High" title="Preflight-to-transaction evidence association"
          detail="Latest preflight evidence is causal only when its file identifier is confirmed against the displayed transaction. Unconfirmed preflight runs are labeled unrelated/background and excluded from likely cause."/>
        <UatRow status="FIXED · RETEST REQUIRED" severity="High" title="FedNow / FedWire / RTP routing hydration regression"
          detail="Governance date initialization was moved to client-only hydration to eliminate time-based server/client render divergence associated with React hydration error #418."/>
        <UatRow status="FIXED · RETEST REQUIRED" severity="Medium" title="Specialist differentiation"
          detail="Each ACH specialist receives role-scoped evidence and must state its evidence boundary instead of borrowing another specialist's diagnosis."/>

        <UatRow status="UNVERIFIED" severity="Low" title="Reset completion"
          detail="Reset confirmation opens, but automated browser QA cannot interact with the native confirmation dialog. Requires manual confirmation test."/>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-500">
        UAT note: synthetic training data only. No source-system payments were transmitted and no real payment action was performed during these tests.
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


function UatRow({status,severity,title,detail}:{status:string;severity:string;title:string;detail:string}){
  const pass=status==="PASS";
  const pending=status.startsWith("FIXED");
  const statusClass=pass
    ?"border-emerald-300/20 bg-emerald-300/[0.05] text-emerald-200"
    :pending
      ?"border-cyan-300/20 bg-cyan-300/[0.05] text-cyan-200"
      :"border-amber-300/20 bg-amber-300/[0.05] text-amber-200";
  return <div className="rounded-xl border border-white/10 bg-black/20 p-4">
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusClass}`}>{status}</span>
      <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-semibold text-slate-500">{severity.toUpperCase()}</span>
      <span className="text-sm font-semibold text-white">{title}</span>
    </div>
    <div className="mt-2 text-xs leading-5 text-slate-400">{detail}</div>
  </div>;
}
