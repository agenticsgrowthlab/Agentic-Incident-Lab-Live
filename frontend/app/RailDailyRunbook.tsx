"use client";

import { useEffect, useMemo, useState } from "react";

export type OpsRail = "ach" | "fednow" | "fedwire" | "rtp";

type Step = {
  id: string;
  phase: string;
  when: string;
  task: string;
  evidence: string;
  stop?: boolean;
};

type StepRun = {
  run_id: string;
  rail: OpsRail;
  step_id: string;
  phase: string;
  model: string;
  latency_ms: number;
  result: {
    rail?: string;
    status: "READY_FOR_APPROVAL" | "NEEDS_ATTENTION" | "BLOCKED_MISSING_EVIDENCE";
    summary: string;
    checks_performed: string[];
    evidence_found: string[];
    exceptions: string[];
    missing_evidence: string[];
    recommended_human_action: string;
    can_approve: boolean;
    human_approval_reason: string;
    escalate_to_incident_intelligence: boolean;
    escalation_reason?: string;
    escalation_target?: string;
    specialist_findings: Array<{ name: string; role: string; finding: string }>;
  };
};

const railLabels: Record<OpsRail, string> = {
  ach: "ACH",
  fednow: "FedNow",
  fedwire: "FedWire",
  rtp: "RTP",
};

const commonClose: Step[] = [
  {id:"close-01",phase:"End of day",when:"Before close",task:"Verify every expected processing window or operating cycle has completed and all sent items have a final or explicitly pending status.",evidence:"Processing-window checklist; sent-item inventory; final/pending acknowledgements."},
  {id:"close-02",phase:"End of day",when:"Before close",task:"Review aged exceptions, failed/retried items, reconciliation breaks, customer impact and incident handoffs.",evidence:"Exception aging; failed/retry queue; reconciliation breaks; incident IDs; client/support cases."},
  {id:"close-03",phase:"End of day",when:"Before signoff",task:"Verify the daily audit evidence package is complete.",evidence:"Approvals; validation results; acknowledgements; posting/reconciliation reports; exception decisions; incident references."},
  {id:"close-04",phase:"End of day",when:"Final signoff",task:"Prepare the shift handoff with open items, settlement/reconciliation status, client impact, deadlines, incidents and next actions.",evidence:"Current run-book results; open exception inventory; incident and deadline data."},
];

const railSteps: Record<OpsRail, Step[]> = {
  ach: [
    {id:"start-01",phase:"Start of day",when:"Before first processing window",task:"Confirm prior-day close completed and every carried settlement, file, return, NOC, exception and reconciliation break has an owner.",evidence:"Prior-day close report; exception queue; handoff notes."},
    {id:"start-02",phase:"Start of day",when:"Before first processing window",task:"Verify ACH secure intake, processor/operator connectivity, acknowledgements, posting feeds, settlement feeds and reporting.",evidence:"Connectivity state; latest ACKs; queue depth/age; transfer status.",stop:true},
    {id:"start-03",phase:"Start of day",when:"Before first processing window",task:"Verify today's processing calendar, holidays, same-day windows and client cutoffs.",evidence:"Processing calendar; cutoff schedule; operator notices."},
    {id:"start-04",phase:"Start of day",when:"Before first processing window",task:"Review settlement-account position and applicable liquidity/funding thresholds.",evidence:"Settlement balance; liquidity/funding report; threshold alerts.",stop:true},

    {id:"intake-01",phase:"File and message intake",when:"Every inbound/originated file",task:"Validate authorized source, duplicate status, ACH file header/control fields, record count and control totals.",evidence:"Secure transfer record; file hash; Nacha preflight result; file control totals.",stop:true},
    {id:"intake-02",phase:"Validation and risk",when:"Every batch / entry population",task:"Validate batch headers, SEC codes, effective dates, routing/company identifiers, trace sequencing, debit/credit totals and required addenda.",evidence:"Batch controls; validation results; exception list."},
    {id:"intake-03",phase:"Validation and risk",when:"Before release",task:"Review originator status, limits/exposure, funding/account state, authorization, stop-payment, fraud/compliance and sanctions controls.",evidence:"Risk/limit result; funding/account result; screening/hold results.",stop:true},
    {id:"intake-04",phase:"Validation and risk",when:"Before release",task:"Verify required maker-checker / dual-control approvals are complete.",evidence:"Approval IDs; timestamps; approval history.",stop:true},

    {id:"tx-01",phase:"Transmission and acknowledgements",when:"Each release / cutoff",task:"Verify every transmitted ACH file has matching transmission confirmation and operator acknowledgement with accepted/rejected status.",evidence:"Transmission IDs; ACK/NAK; accepted/rejected counts; timestamps.",stop:true},
    {id:"tx-02",phase:"Transmission and acknowledgements",when:"Continuous",task:"Review queue depth, retries, duplicate indicators, processor latency and aged ACH items.",evidence:"Queue metrics; retry counts; duplicate keys; processor status."},

    {id:"recv-01",phase:"Receipt and posting",when:"Each inbound distribution",task:"Verify expected inbound ACH distributions were received, parsed and routed to the correct posting workflow.",evidence:"Inbound manifest; received file counts; parse/routing status."},
    {id:"recv-02",phase:"Receipt and posting",when:"After posting cycle",task:"Reconcile received entry counts and dollars to posted, pending, rejected, blocked and returned outcomes.",evidence:"Inbound totals; posting/core results; exception queue.",stop:true},

    {id:"ret-01",phase:"Returns and exceptions",when:"Throughout the day",task:"Review returns, NOCs, prenotes, unauthorized claims, stop payments and other ACH exceptions for linkage, reason, timing and documentation.",evidence:"Return/NOC data; original trace; case record; supporting evidence."},
    {id:"ret-02",phase:"Returns and exceptions",when:"Each available window",task:"Identify eligible return items approaching operational timing limits or an earlier supported processing window.",evidence:"Return queue; received timestamps; planned settlement/transmission window."},

    {id:"recon-01",phase:"Reconciliation",when:"After each major origination cycle",task:"Reconcile originated file/batch/entry counts and debit/credit dollars to operator-accepted totals and rejects.",evidence:"Originated controls; operator acceptance/acknowledgement report.",stop:true},
    {id:"recon-02",phase:"Reconciliation",when:"After posting",task:"Reconcile received ACH entries and dollars to core posting outcomes.",evidence:"Inbound ACH totals; posted/pending/rejected/blocked totals.",stop:true},
    {id:"recon-03",phase:"Reconciliation",when:"Intraday and end of day",task:"Reconcile expected ACH settlement to operator/Federal Reserve settlement reporting and settlement-account activity.",evidence:"Expected settlement; operator settlement report; settlement-account activity; internal ledger.",stop:true},
    {id:"recon-04",phase:"Reconciliation",when:"Intraday and end of day",task:"Reconcile returns and reversals to original transactions and their settlement effects.",evidence:"Original transaction; return/reversal record; related settlement entry.",stop:true},
    {id:"recon-05",phase:"Reconciliation",when:"End of day",task:"Reconcile platform/client reporting to the system of record and identify every unresolved difference with owner, age and disposition.",evidence:"Daily ops report; client/correspondent report; GL/settlement report; exception inventory.",stop:true},
    ...commonClose,
  ],
  fednow: [
    {id:"start-01",phase:"Start of day",when:"At shift start / continuous-service handoff",task:"Review prior-shift FedNow exceptions, participant reachability issues, settlement/posting breaks and open incidents.",evidence:"Prior-shift handoff; exception queue; incident list."},
    {id:"start-02",phase:"Start of day",when:"At shift start",task:"Verify FedNow gateway/API connectivity, participant reachability monitoring, message queues and status-report processing.",evidence:"Connectivity health; queue depth; recent successful message/status exchange.",stop:true},
    {id:"start-03",phase:"Start of day",when:"At shift start and when thresholds change",task:"Review settlement/liquidity position and any institution-specific funding thresholds supporting instant payments.",evidence:"Settlement/liquidity position; funding alerts; internal thresholds.",stop:true},

    {id:"msg-01",phase:"File and message intake",when:"Each outbound/inbound flow",task:"Validate required ISO 20022 message structure, message IDs, participant routing and duplicate/idempotency keys.",evidence:"Message validation result; message ID; routing/participant data; duplicate check.",stop:true},
    {id:"risk-01",phase:"Validation and risk",when:"Before outbound release",task:"Review amount/limit controls, account/funding state, fraud/compliance holds and required approvals for the instant-payment request.",evidence:"Limit result; account/funding result; fraud/compliance decision; approvals.",stop:true},
    {id:"risk-02",phase:"Validation and risk",when:"Before outbound release",task:"Confirm beneficiary/participant reachability and that the payment instruction is not stale, duplicated or already completed.",evidence:"Participant status; message lifecycle; duplicate/idempotency result.",stop:true},

    {id:"tx-01",phase:"Transmission and acknowledgements",when:"Each outbound payment",task:"Match each sent payment message to its immediate status/acceptance/rejection response and record final network state.",evidence:"Outbound message ID; status message; response code; timestamps.",stop:true},
    {id:"tx-02",phase:"Transmission and acknowledgements",when:"Continuous",task:"Review timeouts, pending status inquiries, duplicate-risk indicators and sustained connectivity degradation.",evidence:"Timeout queue; status-inquiry results; duplicate controls; connectivity metrics."},

    {id:"post-01",phase:"Receipt and posting",when:"Each accepted inbound/outbound event",task:"Verify accepted payments are reflected in the expected core/posting workflow and customer-facing status.",evidence:"Network status; core posting result; customer/payment status.",stop:true},
    {id:"post-02",phase:"Receipt and posting",when:"Continuous",task:"Identify accepted-network / missing-posting mismatches and posting latency exceptions.",evidence:"Accepted transaction set; posting confirmations; aged unmatched items.",stop:true},

    {id:"ret-01",phase:"Returns and exceptions",when:"Throughout shift",task:"Review supported return/request-for-return, rejection and investigation flows for correct transaction linkage, reason and status.",evidence:"Original message ID; related return/investigation message; reason/status data."},
    {id:"ret-02",phase:"Returns and exceptions",when:"Throughout shift",task:"Confirm exception handling never converts an ambiguous network state into an unsafe resend.",evidence:"Original lifecycle; status inquiry; downstream posting state; retry history.",stop:true},

    {id:"recon-01",phase:"Reconciliation",when:"Continuous / intraday",task:"Reconcile sent messages to network status and accepted/rejected outcomes.",evidence:"Outbound message inventory; network status inventory; unmatched list.",stop:true},
    {id:"recon-02",phase:"Reconciliation",when:"Continuous / intraday",task:"Reconcile accepted transactions to core posting outcomes and customer status.",evidence:"Accepted transaction set; posting results; customer status."},
    {id:"recon-03",phase:"Reconciliation",when:"Intraday and shift close",task:"Reconcile expected instant-payment settlement activity to settlement reporting/account activity.",evidence:"Expected settlement activity; settlement reports/account activity; variance list.",stop:true},
    {id:"recon-04",phase:"Reconciliation",when:"Shift close",task:"Confirm every unresolved FedNow difference has an owner, age, incident/client impact and next action.",evidence:"Exception inventory; owner/age; incident/client references.",stop:true},
    ...commonClose,
  ],
  fedwire: [
    {id:"start-01",phase:"Start of day",when:"Before wire activity",task:"Review prior-day FedWire exceptions, rejected messages, investigations, reconciliation breaks and open incidents.",evidence:"Prior-day close; exception/investigation queue; incident list."},
    {id:"start-02",phase:"Start of day",when:"Before wire activity",task:"Verify FedWire interface connectivity, message queues, acknowledgements, operator notices and internal wire-processing availability.",evidence:"Interface health; recent ACK; queue depth; operator notices.",stop:true},
    {id:"start-03",phase:"Start of day",when:"Before high-value release",task:"Review settlement/liquidity position, intraday funding constraints and high-value authorization controls.",evidence:"Settlement/liquidity position; funding alerts; approval thresholds.",stop:true},

    {id:"msg-01",phase:"File and message intake",when:"Each wire instruction",task:"Validate ISO 20022 message structure, message IDs, routing identifiers, required parties, amount/currency data and duplicate controls.",evidence:"Message validation result; message ID; routing/party fields; duplicate check.",stop:true},
    {id:"risk-01",phase:"Validation and risk",when:"Before release",task:"Review account/funding state, entitlement/authorization, high-value dual control, fraud/compliance and sanctions controls.",evidence:"Funding/account result; entitlements; approvals; screening decisions.",stop:true},
    {id:"risk-02",phase:"Validation and risk",when:"Before release",task:"Confirm the wire is within internal limits/cutoffs and any required repair has independent approval.",evidence:"Limit/cutoff result; repair history; maker-checker approval.",stop:true},

    {id:"tx-01",phase:"Transmission and acknowledgements",when:"Each wire",task:"Match each released wire to its FedWire acknowledgement/acceptance/rejection state and retain message identifiers.",evidence:"Released message; ACK/response; message ID; timestamp.",stop:true},
    {id:"tx-02",phase:"Transmission and acknowledgements",when:"Continuous",task:"Review awaiting-ACK, reject, timeout and duplicate-risk populations; do not resend until authoritative status is known.",evidence:"Pending/rejected queue; ACK history; status inquiry; duplicate controls.",stop:true},

    {id:"post-01",phase:"Receipt and posting",when:"Each inbound/outbound settlement event",task:"Verify network-accepted wires are reflected in internal posting/ledger/customer status as expected.",evidence:"FedWire status; ledger/core posting; customer status.",stop:true},
    {id:"post-02",phase:"Receipt and posting",when:"Continuous",task:"Identify high-value posting, booking or customer-notification mismatches immediately.",evidence:"Accepted wires; posting/booking results; notification status.",stop:true},

    {id:"ret-01",phase:"Returns and exceptions",when:"Throughout day",task:"Review rejected wires, return/investigation activity and repair queues for correct linkage, reason, ownership and timing.",evidence:"Original message; related return/investigation; reject reason; owner."},
    {id:"ret-02",phase:"Returns and exceptions",when:"Throughout day",task:"Confirm high-value exceptions are contained and escalated when customer, liquidity or systemic risk is material.",evidence:"Exception amount; customer impact; liquidity/system impact; incident status.",stop:true},

    {id:"recon-01",phase:"Reconciliation",when:"Intraday",task:"Reconcile released wire inventory to FedWire accepted/rejected statuses and message IDs.",evidence:"Released wires; FedWire statuses; unmatched list.",stop:true},
    {id:"recon-02",phase:"Reconciliation",when:"Intraday",task:"Reconcile network-accepted wires to internal ledger/core posting outcomes.",evidence:"Accepted wire set; posting/ledger entries; breaks.",stop:true},
    {id:"recon-03",phase:"Reconciliation",when:"Intraday and end of day",task:"Reconcile expected FedWire settlement activity to settlement-account/Federal Reserve reporting and internal ledger.",evidence:"Expected settlement; settlement reporting/account activity; internal ledger.",stop:true},
    {id:"recon-04",phase:"Reconciliation",when:"End of day",task:"Reconcile returns/investigations and all high-value breaks to owners and documented disposition.",evidence:"Return/investigation queue; break inventory; owner/disposition.",stop:true},
    ...commonClose,
  ],
  rtp: [
    {id:"start-01",phase:"Start of day",when:"At shift start / continuous-service handoff",task:"Review prior-shift RTP exceptions, participant/switch issues, prefunding/liquidity alerts, posting breaks and incidents.",evidence:"Shift handoff; exception queue; liquidity alerts; incident list."},
    {id:"start-02",phase:"Start of day",when:"At shift start",task:"Verify RTP interface connectivity, participant reachability, message queues, acknowledgements/status processing and reporting.",evidence:"Interface health; queue depth; recent successful exchange.",stop:true},
    {id:"start-03",phase:"Start of day",when:"At shift start and continuously",task:"Review RTP prefunding/liquidity position and institution-specific thresholds supporting real-time payments.",evidence:"Prefunding/liquidity balance; threshold alerts; funding plan.",stop:true},

    {id:"msg-01",phase:"File and message intake",when:"Each real-time message",task:"Validate ISO 20022 message structure, unique message IDs, participant routing, amount data and duplicate/idempotency controls.",evidence:"Message validation; message ID; routing; duplicate check.",stop:true},
    {id:"risk-01",phase:"Validation and risk",when:"Before outbound release",task:"Review account/funding state, transaction limits, fraud/compliance controls and required human approvals.",evidence:"Account/funding result; limits; fraud/compliance result; approvals.",stop:true},
    {id:"risk-02",phase:"Validation and risk",when:"Before outbound release",task:"Confirm participant reachability and that the instruction is not stale, duplicated or already completed.",evidence:"Participant status; lifecycle status; duplicate/idempotency evidence.",stop:true},

    {id:"tx-01",phase:"Transmission and acknowledgements",when:"Each outbound payment",task:"Match every sent RTP message to switch/participant response and accepted/rejected/final status.",evidence:"Outbound message ID; response/status; timestamps.",stop:true},
    {id:"tx-02",phase:"Transmission and acknowledgements",when:"Continuous",task:"Monitor timeouts, status-pending items, duplicate-risk signals and sustained switch/connectivity degradation.",evidence:"Timeout/status queue; duplicate controls; connectivity metrics."},

    {id:"post-01",phase:"Receipt and posting",when:"Each accepted event",task:"Verify accepted RTP payments are posted/booked to the expected core/customer workflow.",evidence:"Accepted network status; core posting; customer status.",stop:true},
    {id:"post-02",phase:"Receipt and posting",when:"Continuous",task:"Identify accepted-network / missing-posting mismatches and aged posting exceptions.",evidence:"Accepted set; posting results; aged unmatched items.",stop:true},

    {id:"ret-01",phase:"Returns and exceptions",when:"Throughout shift",task:"Review supported return/request-for-return, rejection and investigation flows for transaction linkage, reason, ownership and status.",evidence:"Original message; related return/investigation; reason/status; owner."},
    {id:"ret-02",phase:"Returns and exceptions",when:"Throughout shift",task:"Confirm ambiguous network states do not trigger unsafe duplicate resend/replay.",evidence:"Lifecycle/status evidence; posting state; retry history.",stop:true},

    {id:"recon-01",phase:"Reconciliation",when:"Continuous / intraday",task:"Reconcile sent RTP messages to switch/participant accepted/rejected statuses.",evidence:"Sent message inventory; status inventory; unmatched list.",stop:true},
    {id:"recon-02",phase:"Reconciliation",when:"Continuous / intraday",task:"Reconcile accepted RTP transactions to core posting outcomes and customer status.",evidence:"Accepted transactions; posting results; customer status.",stop:true},
    {id:"recon-03",phase:"Reconciliation",when:"Intraday and shift close",task:"Reconcile expected RTP settlement/prefunding movement to settlement reporting and liquidity position.",evidence:"Expected settlement movement; settlement/prefunding reports; liquidity position.",stop:true},
    {id:"recon-04",phase:"Reconciliation",when:"Shift close",task:"Confirm every unresolved RTP difference has an owner, age, incident/client impact and next action.",evidence:"Exception inventory; owner/age; incident/client references.",stop:true},
    ...commonClose,
  ],
};

const phaseOrder = [
  "Start of day",
  "File and message intake",
  "Validation and risk",
  "Transmission and acknowledgements",
  "Receipt and posting",
  "Returns and exceptions",
  "Reconciliation",
  "End of day",
];

export default function RailDailyRunbook({
  rail,
  scenario,
  transactionId,
  screenContext,
}: {
  rail: OpsRail;
  scenario: string;
  transactionId?: string | null;
  screenContext?: Record<string, unknown>;
}) {
  const steps = railSteps[rail];
  const label = railLabels[rail];

  const [approved,setApproved]=useState<Record<string,boolean>>({});
  const [runs,setRuns]=useState<Record<string,StepRun>>({});
  const [busyStep,setBusyStep]=useState<string|null>(null);
  const [modal,setModal]=useState<StepRun|null>(null);
  const [reviewed,setReviewed]=useState(false);
  const [approving,setApproving]=useState(false);
  const [error,setError]=useState<string|null>(null);

  const [operatorId,setOperatorId]=useState("");
  const [operatorName,setOperatorName]=useState("");
  const [operatorProfiles,setOperatorProfiles]=useState<Array<{id:string;name:string}>>([]);
  const [guideOpen,setGuideOpen]=useState(true);
  const [guidePos,setGuidePos]=useState({x:80,y:90});
  const [dragOffset,setDragOffset]=useState<{x:number;y:number}|null>(null);

  const [managerOpen,setManagerOpen]=useState(false);
  const [managerData,setManagerData]=useState<any|null>(null);
  const [managerLoading,setManagerLoading]=useState(false);

  const completed=useMemo(()=>steps.filter(s=>approved[s.id]).length,[approved,steps]);
  const percent=Math.round((completed/steps.length)*100);
  const nextStep=steps.find(s=>!approved[s.id]);

  useEffect(()=>{
    let profiles:Array<{id:string;name:string}>=[];
    try{
      profiles=JSON.parse(localStorage.getItem("ops-operator-profiles")||localStorage.getItem("ach-operator-profiles")||"[]");
    }catch{}
    let activeId=localStorage.getItem("ops-operator-id")||localStorage.getItem("ach-operator-id")||"";
    const oldName=localStorage.getItem("ops-operator-name")||localStorage.getItem("ach-operator-name")||"";
    if(!profiles.length){
      if(!activeId)activeId=crypto.randomUUID();
      profiles=[{id:activeId,name:oldName||"Operator 1"}];
    }
    if(!profiles.some(p=>p.id===activeId))activeId=profiles[0].id;
    const active=profiles.find(p=>p.id===activeId)||profiles[0];
    setOperatorProfiles(profiles);
    setOperatorId(active.id);
    setOperatorName(active.name);
    localStorage.setItem("ops-operator-profiles",JSON.stringify(profiles));
    localStorage.setItem("ops-operator-id",active.id);
    localStorage.setItem("ops-operator-name",active.name);
    const pos=localStorage.getItem("ops-guide-position");
    if(pos){try{setGuidePos(JSON.parse(pos));}catch{}}
  },[]);

  useEffect(()=>{
    if(!operatorId)return;
    setApproved({});
    setRuns({});
    setModal(null);
    fetch(`/api/rail-runbook/today?operator_id=${encodeURIComponent(operatorId)}&rail=${rail}`,{cache:"no-store"})
      .then(r=>r.ok?r.json():Promise.reject())
      .then(payload=>{
        const a:Record<string,boolean>={};
        const rr:Record<string,StepRun>={};
        for(const item of payload.steps||[]){
          if(item.approved)a[item.step_id]=true;
          if(item.result)rr[item.step_id]={run_id:item.run_id,rail:item.rail,step_id:item.step_id,phase:item.phase,model:"",latency_ms:0,result:item.result};
        }
        setApproved(a);setRuns(rr);
      }).catch(()=>{});
  },[operatorId,rail]);

  function persistProfiles(next:Array<{id:string;name:string}>){
    setOperatorProfiles(next);
    localStorage.setItem("ops-operator-profiles",JSON.stringify(next));
  }

  function saveOperatorName(value:string){
    setOperatorName(value);
    localStorage.setItem("ops-operator-name",value);
    persistProfiles(operatorProfiles.map(p=>p.id===operatorId?{...p,name:value}:p));
  }

  function switchOperator(id:string){
    const profile=operatorProfiles.find(p=>p.id===id);
    if(!profile)return;
    setOperatorId(profile.id);
    setOperatorName(profile.name);
    setApproved({});
    setRuns({});
    setModal(null);
    setReviewed(false);
    localStorage.setItem("ops-operator-id",profile.id);
    localStorage.setItem("ops-operator-name",profile.name);
    setGuideOpen(true);
  }

  function addOperator(){
    const name=window.prompt("New operator name");
    if(!name?.trim())return;
    const profile={id:crypto.randomUUID(),name:name.trim()};
    const next=[...operatorProfiles,profile];
    persistProfiles(next);
    setOperatorId(profile.id);
    setOperatorName(profile.name);
    localStorage.setItem("ops-operator-id",profile.id);
    localStorage.setItem("ops-operator-name",profile.name);
    setGuideOpen(true);
  }

  async function runStep(step:Step){
    setBusyStep(step.id);setError(null);setReviewed(false);
    try{
      const r=await fetch("/api/rail-runbook/run-step",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        operator_id:operatorId,operator_name:operatorName||"Operations SME",rail,
        step_id:step.id,phase:step.phase,task:step.task,evidence_expected:step.evidence,scenario,
        transaction_id:transactionId||null,screen_context:screenContext||{}
      })});
      const p=await r.json();
      if(!r.ok)throw new Error(p?.detail||"AI run-book step failed");
      setRuns(cur=>({...cur,[step.id]:p}));setModal(p);setGuideOpen(true);
    }catch(e){setError(e instanceof Error?e.message:"Unable to run AI step");}
    finally{setBusyStep(null);}
  }

  async function approveCurrent(){
    if(!modal||!reviewed||!modal.result.can_approve)return;
    setApproving(true);setError(null);
    try{
      const r=await fetch("/api/rail-runbook/approve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        operator_id:operatorId,operator_name:operatorName||"Operations SME",run_id:modal.run_id,approved:true
      })});
      const p=await r.json();if(!r.ok)throw new Error(p?.detail||"Approval failed");
      setApproved(cur=>({...cur,[modal.step_id]:true}));setModal(null);setReviewed(false);setGuideOpen(true);
    }catch(e){setError(e instanceof Error?e.message:"Unable to approve step");}
    finally{setApproving(false);}
  }

  async function downloadActivityReport(){
    if(!operatorId)return;
    setError(null);
    try{
      const r=await fetch(`/api/rail-runbook/activity?operator_id=${encodeURIComponent(operatorId)}`,{cache:"no-store"});
      const p=await r.json();
      if(!r.ok)throw new Error(p?.detail||"Unable to create activity report");
      const esc=(v:unknown)=>`"${String(v??"").replaceAll('"','""')}"`;
      const rows=[
        ["Run Date","Rail","Step","Phase","Status","Human Approved","Approved At","AI Summary","Created At"],
        ...(p.runs||[]).map((run:any)=>[
          run.run_date,railLabels[run.rail as OpsRail]||run.rail,run.step_id,run.phase,run.result_status,
          run.approved?"Yes":"No",run.approved_at||"",run.result?.summary||"",run.created_at||""
        ])
      ];
      const csv=rows.map((row:any[])=>row.map(esc).join(",")).join("\r\n");
      const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;
      a.download=`Payments-activity-${(operatorName||"operator").replace(/[^a-z0-9]+/gi,"-")}-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();URL.revokeObjectURL(url);
    }catch(e){setError(e instanceof Error?e.message:"Unable to create activity report");}
  }

  async function openManagerView(){
    setManagerOpen(true);setManagerLoading(true);
    try{
      const r=await fetch("/api/rail-runbook/manager-summary",{cache:"no-store"});
      const p=await r.json();
      if(!r.ok)throw new Error(p?.detail||"Unable to load manager view");
      setManagerData(p);
    }catch(e){setError(e instanceof Error?e.message:"Unable to load manager view");}
    finally{setManagerLoading(false);}
  }

  function beginDrag(e:any){
    setDragOffset({x:e.clientX-guidePos.x,y:e.clientY-guidePos.y});
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveDrag(e:any){
    if(!dragOffset)return;
    setGuidePos({x:Math.max(8,Math.min(window.innerWidth-200,e.clientX-dragOffset.x)),y:Math.max(8,Math.min(window.innerHeight-80,e.clientY-dragOffset.y))});
  }
  function endDrag(){
    setDragOffset(null);
    localStorage.setItem("ops-guide-position",JSON.stringify(guidePos));
  }

  const statusClass=(s?:string)=>s==="READY_FOR_APPROVAL"?"text-emerald-300":s==="NEEDS_ATTENTION"?"text-amber-200":s==="BLOCKED_MISSING_EVIDENCE"?"text-red-300":"text-slate-500";

  return <section className="grid gap-4">
    <div className="signal-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold tracking-[0.14em] text-cyan-300">AI-GUIDED {label.toUpperCase()} DAILY RUN BOOK</div>
          <h1 className="mt-2 text-2xl font-semibold">AI team does the review. Human SME approves each step.</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">The same team member can work across ACH, FedNow, FedWire and RTP. Their productivity report follows them across rails.</p>
        </div>
        <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.05] px-4 py-3 text-right">
          <div className="text-[10px] font-semibold tracking-[0.12em] text-cyan-400">{label} TODAY</div>
          <div className="mt-1 text-2xl font-semibold text-cyan-100">{completed}/{steps.length}</div>
          <div className="text-xs text-slate-500">{percent}% human-approved</div>
        </div>
      </div>

      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.05]"><div className="h-full rounded-full bg-cyan-300/60" style={{width:`${percent}%`}} /></div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select value={operatorId} onChange={e=>switchOperator(e.target.value)} className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm font-semibold text-white outline-none">
          {operatorProfiles.map(p=><option key={p.id} value={p.id} className="bg-[#0b161e]">{p.name}</option>)}
        </select>
        <button type="button" onClick={addOperator} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-semibold text-slate-300">+ Operator</button>
        <button type="button" onClick={()=>setGuideOpen(true)} className="rounded-lg border border-violet-300/25 bg-violet-300/[0.08] px-4 py-3 text-sm font-semibold text-violet-100">✦ Open {label} Ops Guide</button>
        <button type="button" onClick={openManagerView} className="rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm font-semibold text-amber-100">Manager View</button>
        <button type="button" onClick={downloadActivityReport} className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-slate-300">Download my activity report</button>
      </div>
      {error&&<div className="mt-4 rounded-lg border border-red-300/20 bg-red-300/[0.06] p-3 text-sm text-red-200">{error}</div>}
    </div>

    {phaseOrder.map(phase=>{
      const phaseSteps=steps.filter(s=>s.phase===phase);
      if(!phaseSteps.length)return null;
      return <div key={phase} className="signal-card p-5 sm:p-6">
        <div className="text-xs font-semibold tracking-[0.14em] text-cyan-300">{phase.toUpperCase()}</div>
        <div className="mt-4 grid gap-3">
          {phaseSteps.map(step=>{
            const run=runs[step.id];const isApproved=!!approved[step.id];
            return <article key={step.id} className={`rounded-xl border p-4 ${isApproved?"border-emerald-300/20 bg-emerald-300/[0.04]":step.stop?"border-red-300/20 bg-red-300/[0.035]":"border-white/10 bg-black/20"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-slate-600">{step.id}</span>{step.stop&&<span className="rounded-full bg-red-300/10 px-2 py-1 text-[10px] font-semibold text-red-200">CONTROL GATE</span>}{isApproved&&<span className="rounded-full bg-emerald-300/10 px-2 py-1 text-[10px] font-semibold text-emerald-200">HUMAN APPROVED</span>}</div>
                  <h3 className="mt-2 font-semibold text-white">{step.task}</h3>
                  <div className="mt-1 text-xs text-slate-600">{step.when}</div>
                  <div className="mt-3 text-xs text-slate-500"><span className="font-semibold text-slate-400">Evidence expected:</span> {step.evidence}</div>
                  {run&&<div className="mt-3 text-xs"><span className={`font-semibold ${statusClass(run.result.status)}`}>{run.result.status.replaceAll("_"," ")}</span><span className="text-slate-600"> · {run.result.summary}</span></div>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {run&&<button type="button" onClick={()=>{setModal(run);setReviewed(false);setGuideOpen(true);}} className="rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300">View result</button>}
                  {!isApproved&&<button type="button" disabled={busyStep===step.id} onClick={()=>runStep(step)} className="rounded-md border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-40">{busyStep===step.id?"AI working...":run?"Rerun AI step":"Run AI step"}</button>}
                </div>
              </div>
            </article>;
          })}
        </div>
      </div>;
    })}

    <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-4 text-xs leading-5 text-slate-500">
      AI performs evidence review and operational analysis, not autonomous money movement. Release, transmission, funding, retry/replay, account changes and compliance decisions remain human-controlled. Missing evidence blocks approval.
    </div>

    {guideOpen&&<div className="fixed z-[280] w-[min(560px,calc(100vw-16px))] overflow-hidden rounded-2xl border border-violet-300/20 bg-[#0b161e] shadow-2xl" style={{left:guidePos.x,top:guidePos.y,maxHeight:"calc(100vh - 16px)"}}>
      <div className="flex cursor-move items-center justify-between gap-3 border-b border-white/10 bg-violet-300/[0.05] px-4 py-3 select-none" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag}>
        <div><div className="text-[10px] font-semibold tracking-[0.14em] text-violet-300">✦ {label.toUpperCase()} OPS GUIDE</div><div className="text-sm font-semibold text-white">{operatorName?`Welcome back, ${operatorName}`:"Your AI operations teammate"}</div></div>
        <div className="text-[10px] text-slate-600">Drag me anywhere</div>
      </div>

      <div className="max-h-[calc(100vh-150px)] overflow-y-auto p-4">
        {modal?<>
          <div className="text-xs font-semibold tracking-[0.12em] text-cyan-300">{label} STEP RESULT · {modal.step_id}</div>
          <h2 className="mt-2 text-lg font-semibold text-white">{modal.result.summary}</h2>
          <div className={`mt-2 text-xs font-semibold ${statusClass(modal.result.status)}`}>{modal.result.status.replaceAll("_"," ")}</div>
          <div className="mt-4 grid gap-3">
            <ResultBox title="Checks performed" items={modal.result.checks_performed}/>
            <ResultBox title="Evidence found" items={modal.result.evidence_found}/>
            <ResultBox title="Exceptions / risks" items={modal.result.exceptions}/>
            <ResultBox title="Missing evidence" items={modal.result.missing_evidence}/>
          </div>
          {modal.result.escalate_to_incident_intelligence&&<div className="mt-3 rounded-lg border border-red-300/20 bg-red-300/[0.05] p-3"><div className="text-sm font-semibold text-red-100">Escalate to Incident Intelligence / Lindsay</div><div className="mt-1 text-xs text-slate-400">{modal.result.escalation_reason}</div></div>}
          <div className="mt-4 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.03] p-3">
            <div className="text-[10px] font-semibold tracking-[0.12em] text-cyan-300">YOUR DECISION</div>
            <div className="mt-2 text-sm text-slate-300">{modal.result.recommended_human_action}</div>
            {modal.result.can_approve?<>
              <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-black/20 p-3"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} className="mt-1"/><span className="text-sm text-slate-300">I reviewed the AI team's evidence and approve this {label} step as complete.</span></label>
              <button type="button" disabled={!reviewed||approving} onClick={approveCurrent} className="mt-3 w-full rounded-lg border border-emerald-300/25 bg-emerald-300/[0.10] px-4 py-3 text-sm font-semibold text-emerald-100 disabled:opacity-40">{approving?"Recording approval...":"Approve & continue"}</button>
            </>:<div className="mt-3 rounded-lg border border-red-300/20 bg-red-300/[0.05] p-3 text-sm text-red-200">This step is blocked. Resolve missing evidence or the exception, then rerun it.</div>}
          </div>
          <button type="button" onClick={()=>{setModal(null);setReviewed(false);}} className="mt-3 text-xs font-semibold text-slate-500">← Back to current step</button>
        </>:nextStep?<>
          <div className="flex items-center justify-between gap-3"><div className="text-xs font-semibold tracking-[0.12em] text-cyan-300">NEXT {label} STEP · {nextStep.id}</div><div className="text-xs text-slate-600">{completed}/{steps.length} approved</div></div>
          <h2 className="mt-2 text-lg font-semibold text-white">{nextStep.task}</h2>
          <div className="mt-2 text-xs text-slate-500">{nextStep.when}</div>
          <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3"><div className="text-[10px] font-semibold tracking-[0.12em] text-slate-500">EVIDENCE THE AI TEAM WILL CHECK</div><div className="mt-2 text-sm leading-5 text-slate-300">{nextStep.evidence}</div></div>
          <button type="button" disabled={!!busyStep||!operatorName} onClick={()=>runStep(nextStep)} className="mt-4 w-full rounded-lg border border-cyan-300/25 bg-cyan-300/[0.10] px-4 py-3 text-sm font-semibold text-cyan-100 disabled:opacity-40">{busyStep?"AI team is doing the work...":"Run this step with my AI team"}</button>
        </>:<div className="py-6 text-center"><div className="text-2xl">✓</div><h2 className="mt-2 text-lg font-semibold text-emerald-100">{label} run book complete.</h2><div className="mt-2 text-sm text-slate-500">All {steps.length} steps have human approval.</div></div>}

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-4">
          <button type="button" onClick={()=>setGuideOpen(false)} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-semibold text-slate-300">Done for now</button>
          <button type="button" onClick={downloadActivityReport} className="rounded-lg border border-violet-300/20 bg-violet-300/[0.06] px-3 py-2 text-sm font-semibold text-violet-100">Download my activity report</button>
        </div>
      </div>
    </div>}

    {managerOpen&&<div className="fixed inset-0 z-[310] flex items-center justify-center bg-black/80 p-4">
      <div className="max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-2xl border border-amber-300/20 bg-[#0b161e] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-[#0b161e]/95 p-5 backdrop-blur">
          <div><div className="text-xs font-semibold tracking-[0.14em] text-amber-300">MANAGER VIEW · PAYMENTS OPERATIONS</div><h2 className="mt-2 text-xl font-semibold text-white">Team productivity across ACH, FedNow, FedWire and RTP</h2></div>
          <button type="button" onClick={()=>setManagerOpen(false)} className="rounded-md border border-white/10 px-3 py-2 text-sm text-slate-300">Close</button>
        </div>
        <div className="p-5">
          {managerLoading?<div className="py-12 text-center text-sm text-slate-500">Loading team activity...</div>:managerData?<>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[["Active operators",managerData.totals?.active_operators??0],["Rails active",managerData.totals?.rails_active??0],["AI runs",managerData.totals?.ai_runs??0],["Human approvals",managerData.totals?.approved_steps??0],["Blocked",managerData.totals?.blocked_count??0]].map(([l,v])=><div key={String(l)} className="rounded-xl border border-white/10 bg-black/20 p-4"><div className="text-[10px] font-semibold tracking-[0.12em] text-slate-500">{l}</div><div className="mt-2 text-2xl font-semibold text-white">{String(v)}</div></div>)}
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {(managerData.rail_totals||[]).map((r:any)=><div key={r.rail} className="rounded-xl border border-cyan-300/10 bg-cyan-300/[0.025] p-4">
                <div className="text-xs font-semibold text-cyan-200">{railLabels[r.rail as OpsRail]||r.rail}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <div><span className="block text-lg font-semibold text-white">{r.ai_runs}</span>AI runs</div>
                  <div><span className="block text-lg font-semibold text-emerald-200">{r.approved_steps}</span>approved</div>
                  <div><span className="block text-lg font-semibold text-amber-200">{r.attention_count}</span>attention</div>
                  <div><span className="block text-lg font-semibold text-red-200">{r.blocked_count}</span>blocked</div>
                </div>
              </div>)}
            </div>

            <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-white/[0.03] text-[10px] font-semibold tracking-[0.12em] text-slate-500"><tr><th className="p-3">TEAM MEMBER</th><th className="p-3">RAILS WORKED</th><th className="p-3">AI RUNS</th><th className="p-3">APPROVED</th><th className="p-3">ATTENTION</th><th className="p-3">BLOCKED</th><th className="p-3">LAST ACTIVITY</th></tr></thead>
                <tbody>{(managerData.members||[]).map((m:any)=><tr key={m.operator_id} className="border-t border-white/[0.06]"><td className="p-3 font-semibold text-white">{m.operator_name||"Unnamed operator"}</td><td className="p-3 text-cyan-200">{m.rails_worked}</td><td className="p-3 text-slate-300">{m.ai_runs}</td><td className="p-3 text-emerald-200">{m.approved_steps}</td><td className="p-3 text-amber-200">{m.attention_count}</td><td className="p-3 text-red-200">{m.blocked_count}</td><td className="p-3 text-xs text-slate-500">{m.last_activity_at?new Date(m.last_activity_at).toLocaleString():"—"}</td></tr>)}</tbody>
              </table>
            </div>

            <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs font-semibold tracking-[0.12em] text-slate-400">RECENT TEAM ACTIVITY · ALL RAILS</div>
              <div className="mt-3 grid gap-2">{(managerData.recent_activity||[]).slice(0,30).map((item:any,index:number)=><div key={`${item.operator_id}-${item.rail}-${item.step_id}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"><div><div className="text-sm font-semibold text-white">{item.operator_name||"Unnamed operator"} · {railLabels[item.rail as OpsRail]||item.rail} · {item.step_id}</div><div className="mt-1 text-xs text-slate-600">{item.phase} · {item.result_status?.replaceAll("_"," ")}</div></div><div className="text-right text-xs"><div className={item.approved?"text-emerald-300":"text-slate-600"}>{item.approved?"Human approved":"Not yet approved"}</div><div className="mt-1 text-slate-700">{item.created_at?new Date(item.created_at).toLocaleString():""}</div></div></div>)}</div>
            </div>

            <div className="mt-4 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] p-3 text-xs leading-5 text-slate-500">Demo manager view. Add authenticated manager RBAC before production use.</div>
          </>:<div className="py-12 text-center text-sm text-slate-500">No manager data available.</div>}
        </div>
      </div>
    </div>}
  </section>;
}

function ResultBox({title,items}:{title:string;items?:string[]}) {
  return <div className="rounded-xl border border-white/10 bg-black/20 p-4"><h3 className="font-semibold text-white">{title}</h3><div className="mt-3 grid gap-2">{(items||[]).map((item,index)=><div key={index} className="text-sm text-slate-300">• {item}</div>)}{!(items||[]).length&&<div className="text-sm text-slate-600">None reported.</div>}</div></div>;
}
