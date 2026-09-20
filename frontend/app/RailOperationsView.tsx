"use client";

import { useEffect, useMemo, useState } from "react";
import RailDailyRunbook from "./RailDailyRunbook";
import GovernanceView from "./GovernanceView";
import PaymentsOpsAI from "./PaymentsOpsAI";

type Rail = "fednow" | "fedwire" | "rtp";
type Scenario = "healthy" | "watch" | "critical";
type Snapshot = { rail:string; scenario:string; overall_status:string; success_rate:number; transaction_count:number; volume:number; exception_count:number; oldest_exception_seconds:number; reconciliation_rate:number; example_status:string; example_amount:number; example_message_type:string; example_id:string; current_stage:string; };
type CatalogCase = { code:string; message_type?:string|null; category:string; title:string; severity:string; public_documentation:boolean; case_status:string; };
type CatalogResponse = { rail:string; metadata:{name:string;operator:string;message_standard:string;primary_value_messages:string[];availability:string;transaction_limit_usd?:number|null;settlement_model:string;test_label:string;coverage_note:string;}; count:number; cases:CatalogCase[]; };
type TestResult = { run_id?:string; passed:boolean; errors:Array<{code:string;message:string}>; warnings:Array<{code:string;message:string}>; message_type?:string|null; message_id?:string|null; amount?:number|null; currency?:string|null; validator_scope?:string; };

const railNames:Record<Rail,string>={fednow:"FedNow",fedwire:"FedWire",rtp:"RTP"};
function money(value:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(value);}
function scenarioFromUrl():Scenario{if(typeof window==="undefined")return"healthy";const v=new URLSearchParams(window.location.search).get("scenario");return v==="watch"||v==="critical"?v:"healthy";}

export default function RailOperationsView({rail}:{rail:Rail}) {
  const [scenario,setScenario]=useState<Scenario>("healthy");
  const [tab,setTab]=useState<"dashboard"|"coverage"|"test"|"runbook"|"governance">("dashboard");
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [catalog,setCatalog]=useState<CatalogResponse|null>(null);
  const [file,setFile]=useState<File|null>(null);
  const [testResult,setTestResult]=useState<TestResult|null>(null);
  const [busy,setBusy]=useState(false);
  const [resetMessage,setResetMessage]=useState<string|null>(null);

  useEffect(()=>{
    const syncScenario=()=>setScenario(scenarioFromUrl());
    syncScenario();
    window.addEventListener("popstate",syncScenario);
    return()=>window.removeEventListener("popstate",syncScenario);
  },[]);
  useEffect(()=>{fetch(`/api/rails/scenario/${rail}/${scenario}`,{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject()).then(d=>setSnapshot(d.snapshot)).catch(()=>setSnapshot(null));},[rail,scenario]);
  useEffect(()=>{fetch(`/api/rails/catalog/${rail}`,{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject()).then(setCatalog).catch(()=>setCatalog(null));},[rail]);

  const grouped=useMemo(()=>{const out:Record<string,CatalogCase[]>={};for(const item of catalog?.cases||[])(out[item.category]||=[]).push(item);return out;},[catalog]);

  async function resetRail(){if(!confirm(`Reset the ${railNames[rail]} training lab back to red/open?`))return;setBusy(true);setResetMessage(null);try{const r=await fetch(`/api/rails/reset/${rail}`,{method:"POST"});const d=await r.json();setResetMessage(d.message||"Lab reset.");setTestResult(null);const s=await fetch(`/api/rails/scenario/${rail}/${scenario}`,{cache:"no-store"});if(s.ok)setSnapshot((await s.json()).snapshot);const c=await fetch(`/api/rails/catalog/${rail}`,{cache:"no-store"});if(c.ok)setCatalog(await c.json());}catch{setResetMessage("Reset failed.");}finally{setBusy(false);}}
  async function runTest(){if(!file)return;setBusy(true);setTestResult(null);try{const form=new FormData();form.append("file",file);const r=await fetch(`/api/rails/message-test/${rail}`,{method:"POST",body:form});const d=await r.json();if(!r.ok)throw new Error(d.detail||"Message test failed");setTestResult(d);}catch(e){setTestResult({passed:false,errors:[{code:"REQUEST",message:e instanceof Error?e.message:"Message test failed"}],warnings:[]});}finally{setBusy(false);}}

  const meta=catalog?.metadata;
  const tone=scenario==="healthy"?"emerald":scenario==="watch"?"amber":"red";
  const toneText=tone==="emerald"?"text-emerald-300":tone==="amber"?"text-amber-200":"text-red-300";
  const toneBorder=tone==="emerald"?"border-emerald-300/25":tone==="amber"?"border-amber-300/25":"border-red-300/25";
  const toneBg=tone==="emerald"?"bg-emerald-300/[0.06]":tone==="amber"?"bg-amber-300/[0.06]":"bg-red-300/[0.06]";

  return <div className="rail-operations-view">
    <PaymentsOpsAI
      rail={rail}
      scenario={scenario}
      transactionId={snapshot?.example_id||null}
      screenContext={{
        activeTab:tab,
        overall:snapshot?.overall_status||null,
        reconciliation:snapshot?.reconciliation_rate??null,
        exceptionCount:snapshot?.exception_count??null,
        oldestExceptionSeconds:snapshot?.oldest_exception_seconds??null,
        visibleTransaction:snapshot?{
          id:snapshot.example_id,
          status:snapshot.example_status,
          amount:snapshot.example_amount,
          messageType:snapshot.example_message_type,
          currentStage:snapshot.current_stage,
          source:"neon-rail-simulation",
        }:null,
        railMetadata:meta||null,
        latestMessageTest:testResult||null,
      }}
    />
    <div className="sticky top-[94px] z-[80] -mx-4 mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#071017]/95 px-4 py-3 backdrop-blur-xl lg:-mx-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-2">
        {[["dashboard","Operations Dashboard"],["coverage","Use Cases Covered"],["test",meta?.test_label||"ISO 20022 Message Test"],["runbook","Daily Run Book"],["governance","Governance"]].map(([id,label])=>
          <button key={id} type="button" onClick={()=>setTab(id as typeof tab)} className={`rounded-md px-3 py-2 text-sm font-semibold transition ${tab===id?"bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-300/25":"text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"}`}>{label}</button>)}
      </div>
      <div className="flex items-center gap-3">{resetMessage&&<span className="text-xs text-slate-500">{resetMessage}</span>}<button type="button" onClick={resetRail} disabled={busy} className="rounded-md border border-red-300/20 bg-red-300/[0.06] px-3 py-2 text-xs font-semibold text-red-200 disabled:opacity-50">{busy?"Working…":"Reset Lab to Red"}</button></div>
    </div>

    {tab==="dashboard"&&<>
      <section className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div><div className={`text-xs font-semibold tracking-[0.14em] ${toneText}`}>OPERATIONS MANAGER · {railNames[rail].toUpperCase()}</div><h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">{railNames[rail]} processing health</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{rail==="fednow"?"Instant-payment operations across ISO 20022 validation, fraud controls, participant reachability, settlement, posting and reconciliation.":rail==="fedwire"?"High-value wire operations across ISO 20022 validation, Fedwire business edits, acknowledgements, settlement, returns, investigations and reconciliation.":"Real-time RTP operations across participant connectivity, prefunding, limits, message status, immediate settlement, posting and reconciliation."}</p></div>
        <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.05] px-4 py-3 text-right"><div className="text-[10px] font-semibold tracking-[0.12em] text-cyan-400">DATA SOURCE</div><div className="mt-1 text-sm font-semibold text-cyan-100">Synthetic Neon simulation</div></div>
      </section>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[["Overall processing",snapshot?.overall_status||"LOADING"],["Transactions today",snapshot?snapshot.transaction_count.toLocaleString():"—"],["Reconciliation",snapshot?`${snapshot.reconciliation_rate.toFixed(2)}%`:"—"],["Oldest exception",snapshot?`${snapshot.oldest_exception_seconds}s`:"—"]].map(([label,value],i)=>
          <article key={label} className={`signal-card border ${i===0?toneBorder+" "+toneBg:"border-white/10"} p-5`}><div className="text-[10px] font-semibold tracking-[0.12em] text-slate-600">{label.toUpperCase()}</div><div className={`mt-4 text-2xl font-semibold ${i===0?toneText:"text-white"}`}>{value}</div>{i===1&&snapshot&&<div className="mt-2 text-sm text-slate-500">{money(snapshot.volume)} processed</div>}{i===2&&snapshot&&<div className="mt-2 text-sm text-slate-500">{snapshot.exception_count} open exceptions</div>}{i===0&&snapshot&&<div className="mt-2 text-sm text-slate-500">{snapshot.success_rate.toFixed(2)}% successful</div>}</article>)}
      </section>
      <section className="mt-4 grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
        <div className="signal-card p-5 sm:p-6"><div className={`text-xs font-semibold tracking-[0.14em] ${toneText}`}>EXAMPLE TRANSACTION</div><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{snapshot?`${money(snapshot.example_amount)} ${railNames[rail]} payment`:"Loading…"}</h2><p className="mt-2 font-mono text-xs text-slate-500">{snapshot?.example_id||"—"}</p></div><span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${toneBorder} ${toneBg} ${toneText}`}>{snapshot?.example_status||"—"}</span></div><div className="mt-6 grid gap-3 sm:grid-cols-4">{[["Message",snapshot?.example_message_type||"—"],["Stage",snapshot?.current_stage||"—"],["Exceptions",String(snapshot?.exception_count??"—")],["Scenario",scenario.toUpperCase()]].map(([l,v])=><div key={l} className="rounded-lg border border-white/10 bg-black/20 p-3"><div className="text-sm font-semibold text-white">{v}</div><div className="mt-1 text-xs text-slate-600">{l}</div></div>)}</div></div>
        <aside className="signal-card p-5 sm:p-6"><div className="text-xs font-semibold tracking-[0.14em] text-violet-300">RAIL MODEL</div><div className="mt-4 grid gap-3 text-sm"><div><span className="text-slate-500">Operator</span><div className="mt-1 font-semibold">{meta?.operator||"Loading…"}</div></div><div><span className="text-slate-500">Standard</span><div className="mt-1 font-semibold">{meta?.message_standard||"ISO 20022"}</div></div><div><span className="text-slate-500">Availability</span><div className="mt-1 font-semibold">{meta?.availability||"—"}</div></div><div><span className="text-slate-500">Settlement</span><div className="mt-1 font-semibold">{meta?.settlement_model||"—"}</div></div><div><span className="text-slate-500">Current modeled limit</span><div className="mt-1 font-semibold">{meta?.transaction_limit_usd?money(meta.transaction_limit_usd):"No simulator cap"}</div></div></div></aside>
      </section>
    </>}

    {tab==="coverage"&&<section className="grid gap-4"><div className="signal-card p-5 sm:p-6"><div className="text-xs font-semibold tracking-[0.14em] text-violet-300">USE CASE COVERAGE · {railNames[rail].toUpperCase()}</div><h1 className="mt-2 text-2xl font-semibold">{catalog?.count??"—"} modeled codes and operational cases</h1><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">{meta?.coverage_note||"Loading coverage…"}</p></div><div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{Object.entries(grouped).map(([category,items])=><div key={category} className="signal-card p-5"><div className="text-xs font-semibold tracking-[0.14em] text-cyan-300">{category.toUpperCase()}</div><div className="mt-4 grid gap-3">{items.map((item,index)=><div key={`${item.code}-${item.message_type||""}-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between gap-3"><span className="font-mono text-sm font-semibold text-white">{item.code}</span><span className="text-[10px] text-slate-600">{item.message_type||item.severity}</span></div><div className="mt-2 text-sm text-slate-300">{item.title}</div>{item.public_documentation&&<div className="mt-2 text-[10px] font-semibold text-emerald-400/70">PUBLIC OPERATOR CODE</div>}</div>)}</div></div>)}</div></section>}

    {tab==="runbook"&&
      <RailDailyRunbook
        rail={rail}
        scenario={scenario}
        transactionId={snapshot?.example_id||null}
        screenContext={{
          overall:snapshot?.overall_status||null,
          reconciliation:snapshot?.reconciliation_rate??null,
          exceptionCount:snapshot?.exception_count??null,
          oldestExceptionSeconds:snapshot?.oldest_exception_seconds??null,
          exampleTransaction:snapshot?{
            id:snapshot.example_id,
            status:snapshot.example_status,
            amount:snapshot.example_amount,
            messageType:snapshot.example_message_type,
            currentStage:snapshot.current_stage,
          }:null,
          railMetadata:meta||null,
          latestMessageTest:testResult||null,
        }}
      />
    }

    {tab==="governance"&&<GovernanceView currentRail={rail}/>}\n\n    {tab==="test"&&<section className="grid gap-4"><div className="signal-card p-5 sm:p-6"><div className="text-xs font-semibold tracking-[0.14em] text-emerald-300">MESSAGE TEST · DRY RUN</div><h1 className="mt-2 text-2xl font-semibold">{meta?.test_label||"ISO 20022 Message Test"}</h1><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">Upload a synthetic XML message for structural and selected publicly documented business-rule checks. Nothing is sent to the payment network and no account is touched.</p><div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><input type="file" accept=".xml,text/xml,application/xml" onChange={e=>{setFile(e.target.files?.[0]||null);setTestResult(null);}} className="block w-full rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-300/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-cyan-200"/><button type="button" disabled={!file||busy} onClick={runTest} className="rounded-lg border border-emerald-300/25 bg-emerald-300/[0.10] px-4 py-3 text-sm font-semibold text-emerald-100 disabled:opacity-40">{busy?"Testing…":"Run Message Test"}</button></div></div>{testResult&&<div className={`rounded-xl border p-5 sm:p-6 ${testResult.passed?"border-emerald-300/25 bg-emerald-300/[0.06]":"border-red-300/25 bg-red-300/[0.06]"}`}><div className={`text-xs font-semibold tracking-[0.14em] ${testResult.passed?"text-emerald-300":"text-red-300"}`}>{testResult.passed?"MESSAGE TEST PASSED":"MESSAGE TEST FAILED"}</div><div className="mt-4 grid gap-3 sm:grid-cols-4"><div><div className="text-xs text-slate-500">Message type</div><div className="mt-1 font-mono">{testResult.message_type||"—"}</div></div><div><div className="text-xs text-slate-500">Amount</div><div className="mt-1 font-mono">{testResult.amount!=null?money(testResult.amount):"—"}</div></div><div><div className="text-xs text-slate-500">Errors</div><div className="mt-1 font-mono">{testResult.errors.length}</div></div><div><div className="text-xs text-slate-500">Warnings</div><div className="mt-1 font-mono">{testResult.warnings.length}</div></div></div><div className="mt-5 grid gap-3">{[...testResult.errors,...testResult.warnings].map((item,index)=><div key={`${item.code}-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-3"><div className="font-mono text-sm font-semibold text-white">{item.code}</div><div className="mt-1 text-sm text-slate-300">{item.message}</div></div>)}</div>{testResult.validator_scope&&<p className="mt-4 text-xs leading-5 text-slate-600">{testResult.validator_scope}</p>}</div>}</section>}
  </div>;
}
