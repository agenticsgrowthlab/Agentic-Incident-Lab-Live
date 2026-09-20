"use client";

import { useEffect, useState } from "react";

type Scenario = {
  id: "healthy" | "watch" | "critical";
  label: string;
  tone: "emerald" | "amber" | "red";
  headline: string;
  explanation: string;
  overall: string;
  success: string;
  transactions: string;
  volume: string;
  reconPct: string;
  reconDetail: string;
  pending: string;
  pendingDetail: string;
  txTitle: string;
  txBadge: string;
  trace: string;
  detail: [string, string][];
  reconMetrics: [string, string][];
  checks: [string, string, string][];
  flow: [string, string, string, "green" | "yellow" | "red" | "muted"][];
  scenarioNotes: [string, string][];
};

type Snapshot = {
  overall_status: string;
  success_rate: number;
  transaction_count: number;
  processed_volume: number;
  reconciliation_rate: number;
  unreconciled_count: number;
  unreconciled_amount: number;
  pending_count: number;
  failed_count: number;
  oldest_pending_minutes: number;
  example_transaction_id: string;
  credit_union_name: string;
  trace_number: string;
  amount: number;
  transaction_status: string;
  current_stage: string;
  posting_status: string;
  settlement_status: string;
  reconciliation_status: string;
  processor_code?: string | null;
  processor_message?: string | null;
  retry_count: number;
};

type TransactionDetail = {
  transaction: Record<string, unknown>;
  events: Array<{
    sequence: number;
    stage: string;
    status: string;
    event_time: string;
    source_system?: string | null;
    correlation_id?: string | null;
    response_code?: string | null;
    message?: string | null;
  }>;
};


type FailureCase = {
  id: string;
  category: string;
  subtype: string;
  case_name: string;
  expected_resolution: string;
  case_status: string;
};

type FailureLabResponse = {
  failure_case_count: number;
  failure_cases: FailureCase[];
  synthetic_accounts: Array<Record<string, unknown>>;
};

type ReturnCodeItem = {
  code: string;
  title: string;
  category: string;
  active_2026: boolean;
  effective_date?: string | null;
  failure_case_id?: string | null;
  case_status?: string | null;
  payment_outcome?: string | null;
  remediation_state?: string | null;
};

type ReturnCodeResponse = {
  active_2026_count: number;
  future_count: number;
  return_codes: ReturnCodeItem[];
};


type PreflightIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  line?: number | null;
  field?: string | null;
  expected?: string | null;
  actual?: string | null;
};

type PreflightResult = {
  run_id: string;
  filename: string;
  sha256: string;
  passed: boolean;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  summary: {
    physical_records?: number;
    logical_records?: number;
    batches?: number;
    entries_and_addenda?: number;
    debit_total_cents?: number;
    credit_total_cents?: number;
  };
  dry_run: boolean;
  transmitted: boolean;
  accounts_touched: boolean;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

export default function PlatformScenarioView({ scenario }: { scenario: Scenario }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "use-cases" | "preflight">("dashboard");
  const [failureLab, setFailureLab] = useState<FailureLabResponse | null>(null);
  const [returnCodes, setReturnCodes] = useState<ReturnCodeResponse | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [preflightFile, setPreflightFile] = useState<File | null>(null);
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/operations/scenario/${scenario.id}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Operations API unavailable");
        return (await r.json()) as Snapshot;
      })
      .then((data) => active && setSnapshot(data))
      .catch(() => active && setSnapshot(null))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [scenario.id]);

  const openTransaction = async () => {
    if (!snapshot?.example_transaction_id) return;
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/operations/transactions/${snapshot.example_transaction_id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load transaction");
      setDetail((await response.json()) as TransactionDetail);
    } finally {
      setDetailLoading(false);
    }
  };


  const loadUseCases = async () => {
    try {
      const [failureResponse, returnResponse] = await Promise.all([
        fetch("/api/operations/failure-lab", { cache: "no-store" }),
        fetch("/api/operations/return-codes", { cache: "no-store" }),
      ]);
      if (failureResponse.ok) setFailureLab((await failureResponse.json()) as FailureLabResponse);
      if (returnResponse.ok) setReturnCodes((await returnResponse.json()) as ReturnCodeResponse);
    } catch {
      // Keep the dashboard usable even if the catalog endpoint is unavailable.
    }
  };

  const resetLab = async () => {
    if (!confirm("Reset the ACH Failure Lab back to its original red/open training state?")) return;
    setResetting(true);
    setResetMessage(null);
    try {
      const response = await fetch("/api/operations/reset-lab", { method: "POST" });
      if (!response.ok) throw new Error("Reset failed");
      const payload = await response.json();
      setDetail(null);
      setSnapshot(null);
      await loadUseCases();
      const refreshed = await fetch(`/api/operations/scenario/${scenario.id}`, { cache: "no-store" });
      if (refreshed.ok) setSnapshot((await refreshed.json()) as Snapshot);
      setResetMessage(payload.message || "Failure Lab reset.");
    } catch {
      setResetMessage("Reset failed. Check the Operations API.");
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    if (activeTab === "use-cases") loadUseCases();
  }, [activeTab]);


  const runPreflight = async () => {
    if (!preflightFile) return;
    setPreflightRunning(true);
    setPreflightResult(null);
    try {
      const form = new FormData();
      form.append("file", preflightFile);
      const response = await fetch("/api/operations/preflight", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || "Preflight failed");
      setPreflightResult(payload as PreflightResult);
    } catch (error) {
      setPreflightResult({
        run_id: "ERROR",
        filename: preflightFile.name,
        sha256: "",
        passed: false,
        errors: [{
          level: "error",
          code: "PREFLIGHT_REQUEST",
          message: error instanceof Error ? error.message : "Preflight request failed",
        }],
        warnings: [],
        summary: {},
        dry_run: true,
        transmitted: false,
        accounts_touched: false,
      });
    } finally {
      setPreflightRunning(false);
    }
  };

  const toneText =
    scenario.tone === "red" ? "text-red-300" :
    scenario.tone === "amber" ? "text-amber-200" : "text-emerald-300";

  const toneBorder =
    scenario.tone === "red" ? "border-red-300/25 bg-red-300/[0.08]" :
    scenario.tone === "amber" ? "border-amber-300/25 bg-amber-300/[0.08]" :
    "border-emerald-300/25 bg-emerald-300/[0.08]";

  const txTitle = snapshot
    ? `${money(snapshot.amount)} ACH Credit · ${snapshot.transaction_status.replaceAll("_", " ")}`
    : scenario.txTitle;

  const cards = snapshot ? [
    ["Overall processing", snapshot.overall_status, `${snapshot.success_rate.toFixed(2)}% successful`],
    ["Transactions today", snapshot.transaction_count.toLocaleString(), `${money(snapshot.processed_volume)} processed`],
    ["Reconciliation", `${snapshot.reconciliation_rate.toFixed(2)}%`, `${snapshot.unreconciled_count} unreconciled · ${money(snapshot.unreconciled_amount)}`],
    ["Oldest pending", `${snapshot.oldest_pending_minutes} min`, `${snapshot.pending_count} pending · ${snapshot.failed_count} failed`],
  ] : [
    ["Overall processing", scenario.overall, scenario.success],
    ["Transactions today", scenario.transactions, scenario.volume],
    ["Reconciliation", scenario.reconPct, scenario.reconDetail],
    ["Oldest pending", scenario.pending, scenario.pendingDetail],
  ];

  return (
    <div id={`platform-scenario-${scenario.id}`} className="platform-scenario hidden">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("dashboard")}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
              activeTab === "dashboard"
                ? "bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-300/25"
                : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"
            }`}
          >
            Operations Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("use-cases")}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
              activeTab === "use-cases"
                ? "bg-violet-300/10 text-violet-200 ring-1 ring-violet-300/25"
                : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"
            }`}
          >
            Use Cases Covered
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("preflight")}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
              activeTab === "preflight"
                ? "bg-emerald-300/10 text-emerald-200 ring-1 ring-emerald-300/25"
                : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"
            }`}
          >
            Nacha Preflight
          </button>
        </div>

        <div className="flex items-center gap-3">
          {resetMessage && <span className="text-xs text-slate-500">{resetMessage}</span>}
          <button
            type="button"
            onClick={resetLab}
            disabled={resetting}
            className="rounded-md border border-red-300/20 bg-red-300/[0.06] px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-300/[0.10] disabled:opacity-50"
          >
            {resetting ? "Resetting…" : "Reset Lab to Red"}
          </button>
        </div>
      </div>

      {activeTab === "use-cases" ? (
        <section className="grid gap-4">
          <div className="signal-card p-5 sm:p-6">
            <div className="text-xs font-semibold tracking-[0.14em] text-violet-300">USE CASE COVERAGE</div>
            <h1 className="mt-2 text-2xl font-semibold">What the ACH Operations Failure Lab covers</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
              The lab covers three layers: Nacha file/preflight defects, account and authorization conditions,
              and downstream processing/reconciliation failures. It also includes one training case for every
              current 2026 Nacha return reason code, plus the future R90 case marked inactive until its effective date.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <div className="text-2xl font-semibold text-cyan-200">{failureLab?.failure_case_count ?? "33"}</div>
                <div className="mt-1 text-xs text-slate-500">Preflight + operations cases</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <div className="text-2xl font-semibold text-emerald-200">{returnCodes?.active_2026_count ?? "70"}</div>
                <div className="mt-1 text-xs text-slate-500">Current 2026 Nacha return cases</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <div className="text-2xl font-semibold text-amber-200">{failureLab?.synthetic_accounts?.length ?? "8"}</div>
                <div className="mt-1 text-xs text-slate-500">Synthetic account states</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <div className="text-2xl font-semibold text-violet-200">{returnCodes?.future_count ?? "1"}</div>
                <div className="mt-1 text-xs text-slate-500">Future return code case</div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {["PREFLIGHT", "ACCOUNT", "OPERATIONS"].map((category) => (
              <div key={category} className="signal-card p-5">
                <div className="text-xs font-semibold tracking-[0.14em] text-cyan-300">{category}</div>
                <div className="mt-4 grid gap-3">
                  {(failureLab?.failure_cases || []).filter((item) => item.category === category).map((item) => (
                    <div key={item.id} className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                      <div className="text-sm font-semibold text-white">{item.case_name}</div>
                      <div className="mt-1 text-[11px] font-mono text-slate-600">{item.id} · {item.subtype}</div>
                      <p className="mt-2 text-xs leading-5 text-slate-400">{item.expected_resolution}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="signal-card p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xs font-semibold tracking-[0.14em] text-emerald-300">NACHA RETURN TRAINING CASES</div>
                <h2 className="mt-2 text-xl font-semibold">Current return-code coverage</h2>
              </div>
              <div className="text-xs text-slate-500">
                {returnCodes ? `${returnCodes.active_2026_count} current · ${returnCodes.future_count} future` : "Loading catalog…"}
              </div>
            </div>
            <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {(returnCodes?.return_codes || []).map((item) => (
                <div key={item.code} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm font-semibold text-white">{item.code}</span>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                      item.active_2026
                        ? "bg-red-300/[0.08] text-red-200"
                        : "bg-violet-300/[0.08] text-violet-200"
                    }`}>
                      {item.active_2026 ? "TRAINING CASE" : "FUTURE"}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-slate-300">{item.title}</div>
                  <div className="mt-2 text-[11px] text-slate-600">{item.category}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <>
      <section className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className={`text-xs font-semibold tracking-[0.14em] ${toneText}`}>OPERATIONS MANAGER</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">{scenario.headline}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{scenario.explanation}</p>
        </div>
        <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.05] px-4 py-3 text-right">
          <div className="text-[10px] font-semibold tracking-[0.12em] text-cyan-400">DATA SOURCE</div>
          <div className="mt-1 text-sm font-semibold text-cyan-100">
            {snapshot ? "Neon PostgreSQL · live schema" : loading ? "Loading Neon…" : "Static fallback"}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, detailText]) => (
          <article key={label} className="signal-card p-5">
            <div className="text-[10px] font-semibold tracking-[0.13em] text-slate-600">{label.toUpperCase()}</div>
            <div className={`mt-3 text-2xl font-semibold ${label === "Overall processing" ? toneText : "text-white"}`}>{value}</div>
            <div className="mt-2 text-sm text-slate-500">{detailText}</div>
          </article>
        ))}
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <button
          type="button"
          onClick={openTransaction}
          className="signal-card p-5 text-left transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.025] sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold tracking-[0.14em] text-cyan-300">EXAMPLE TRANSACTION · CLICK TO INSPECT</div>
              <h2 className="mt-2 text-xl font-semibold">{txTitle}</h2>
              <p className="mt-2 text-sm text-slate-500">
                {snapshot ? `Trace ${snapshot.trace_number} · ${snapshot.credit_union_name}` : scenario.trace}
              </p>
            </div>
            <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${toneBorder} ${toneText}`}>
              {snapshot ? snapshot.transaction_status.toUpperCase() : scenario.txBadge}
            </span>
          </div>

          <div className="mt-6 grid gap-2 sm:grid-cols-4">
            {[
              ["Current stage", snapshot?.current_stage || "—"],
              ["Processor", snapshot?.processor_code || "—"],
              ["Posting", snapshot?.posting_status || "—"],
              ["Reconciliation", snapshot?.reconciliation_status || "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-[10px] font-semibold tracking-[0.1em] text-slate-600">{label.toUpperCase()}</div>
                <div className="mt-2 text-sm font-semibold text-slate-200">{value}</div>
              </div>
            ))}
          </div>
        </button>

        <aside className="signal-card p-5 sm:p-6">
          <div className="text-xs font-semibold tracking-[0.14em] text-violet-300">TRANSACTION DETAIL</div>
          <div className="mt-4 grid gap-3 text-sm">
            {(snapshot ? [
              ["Amount", money(snapshot.amount)],
              ["Trace number", snapshot.trace_number],
              ["Credit union", snapshot.credit_union_name],
              ["Processor message", snapshot.processor_message || "—"],
              ["Retries", String(snapshot.retry_count)],
              ["Settlement", snapshot.settlement_status],
              ["Posting", snapshot.posting_status],
              ["Reconciliation", snapshot.reconciliation_status],
            ] : scenario.detail).map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 border-b border-white/[0.06] pb-2">
                <span className="text-slate-500">{label}</span>
                <span className="max-w-[60%] text-right font-medium text-slate-200">{value}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className={`mt-4 rounded-xl border p-5 sm:p-6 ${toneBorder}`}>
        <div className={`text-xs font-semibold tracking-[0.14em] ${toneText}`}>SCENARIO EXPLANATION</div>
        <h2 className="mt-2 text-xl font-semibold">{scenario.label}</h2>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {scenario.scenarioNotes.map(([title, copy]) => (
            <div key={title} className="rounded-lg border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-semibold text-white">{title}</div>
              <p className="mt-2 text-sm leading-6 text-slate-400">{copy}</p>
            </div>
          ))}
        </div>
      </section>

        </>
      )}

      {detail && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-white/15 bg-[#0b161e] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-white/10 bg-[#0b161e]/95 p-5 backdrop-blur">
              <div>
                <div className="text-xs font-semibold tracking-[0.14em] text-cyan-300">ACH TRANSACTION RECORD</div>
                <h2 className="mt-1 text-xl font-semibold">{String(detail.transaction.id)}</h2>
              </div>
              <button onClick={() => setDetail(null)} className="rounded-md border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5">Close</button>
            </div>

            <div className="grid gap-4 p-5 lg:grid-cols-[.8fr_1.2fr]">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <h3 className="font-semibold">Database record</h3>
                <div className="mt-4 grid gap-2 text-sm">
                  {[
                    ["Credit union", detail.transaction.credit_union_name],
                    ["Trace number", detail.transaction.trace_number],
                    ["ACH file", detail.transaction.ach_file_identifier],
                    ["Batch", detail.transaction.batch_number],
                    ["SEC code", detail.transaction.sec_code],
                    ["Amount", money(Number(detail.transaction.amount || 0))],
                    ["ODFI routing", detail.transaction.odfi_routing],
                    ["RDFI routing", detail.transaction.rdfi_routing],
                    ["Current stage", detail.transaction.current_stage],
                    ["Status", detail.transaction.status],
                    ["Processor code", detail.transaction.processor_code],
                    ["Processor message", detail.transaction.processor_message],
                    ["Posting", detail.transaction.posting_status],
                    ["Settlement", detail.transaction.settlement_status],
                    ["Reconciliation", detail.transaction.reconciliation_status],
                    ["Difference", money(Number(detail.transaction.difference_amount || 0))],
                    ["Reconciliation reason", detail.transaction.recon_reason],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="grid grid-cols-[120px_1fr] gap-3 border-b border-white/[0.05] py-2">
                      <span className="text-slate-600">{String(label)}</span>
                      <span className="break-words text-slate-200">{value == null ? "—" : String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <h3 className="font-semibold">Lifecycle event timeline</h3>
                <p className="mt-1 text-xs text-slate-500">Each row is stored in ach_transaction_events.</p>
                <div className="mt-4 grid gap-3">
                  {detail.events.map((event) => (
                    <div key={event.sequence} className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3">
                      <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] font-mono text-[10px] text-cyan-300">
                        {event.sequence}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-white">{event.stage} · {event.status}</div>
                          <div className="font-mono text-[11px] text-slate-600">{new Date(event.event_time).toLocaleTimeString()}</div>
                        </div>
                        <div className="mt-1 text-sm text-slate-400">{event.message || "—"}</div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-slate-600">
                          <span>source={event.source_system || "—"}</span>
                          <span>code={event.response_code || "—"}</span>
                          <span>correlation={event.correlation_id || "—"}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailLoading && (
        <div className="fixed bottom-5 right-5 z-[220] rounded-lg border border-cyan-300/20 bg-[#0b161e] px-4 py-3 text-sm text-cyan-100 shadow-xl">
          Loading transaction record from Neon…
        </div>
      )}
    </div>
  );
}
