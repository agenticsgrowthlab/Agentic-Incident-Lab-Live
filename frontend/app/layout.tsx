import type { Metadata } from "next";
import PlatformScenarioView from "./PlatformScenarioView";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agentic Operations Lab | Nicole Chernow-Martinez",
  description:
    "An interactive portfolio demonstration of governed agentic AI for payments operations health and incident response.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

type Scenario = {
  id: "healthy" | "watch" | "critical";
  label: string;
  shortLabel: string;
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

const scenarios: Scenario[] = [
  {
    id: "healthy",
    label: "Simulation feed healthy",
    shortLabel: "Healthy",
    tone: "emerald",
    headline: "ACH processing health",
    explanation:
      "Normal operating conditions. Transactions are flowing end to end, acknowledgements are arriving, posting is current, settlement is within SLA and reconciliation differences are small enough for routine review.",
    overall: "HEALTHY",
    success: "99.84% successful",
    transactions: "1,245",
    volume: "$3.82M processed",
    reconPct: "99.60%",
    reconDetail: "5 unreconciled · $12,480",
    pending: "4 min",
    pendingDetail: "3 pending · 2 failed",
    txTitle: "$1,000 ACH Credit · Completed",
    txBadge: "PROCESSED COMPLETELY",
    trace: "Trace 09100001-240919-1042 · Member payment · Pacific Community CU",
    detail: [
      ["Direction", "Credit"],
      ["Amount", "$1,000.00"],
      ["SEC code", "PPD"],
      ["Effective date", "Sep 19, 2026"],
      ["Posting status", "Posted"],
      ["Settlement status", "Settled"],
      ["Reconciliation", "Balanced"],
      ["Return code", "None"],
      ["Retries", "0"],
    ],
    reconMetrics: [
      ["1,245", "Total"],
      ["1,240", "Reconciled"],
      ["5", "Unreconciled"],
      ["$12,480", "Difference"],
    ],
    checks: [
      ["File acknowledgements", "Healthy", "All expected acknowledgements received"],
      ["Posting queues", "Healthy", "3 pending · oldest 4 min"],
      ["Settlement", "Healthy", "Current cycle within SLA"],
      ["Reconciliation", "Watch", "5 items require routine investigation"],
    ],
    flow: [
      ["Channel", "Received", "10:14:02", "green"],
      ["Payment Platform", "Validated", "10:14:03", "green"],
      ["Processor", "Accepted", "10:14:04", "green"],
      ["ODFI", "Submitted", "10:14:08", "green"],
      ["ACH Operator", "Delivered", "10:14:41", "green"],
      ["RDFI", "Accepted", "10:15:07", "green"],
      ["Posting", "Posted", "10:15:12", "green"],
      ["Reconciliation", "Balanced", "10:17:30", "green"],
    ],
    scenarioNotes: [
      ["What the operator sees", "A normal day with no material processing interruption. Small reconciliation differences remain visible so the screen still feels operational rather than artificially perfect."],
      ["Expected action", "Monitor normal queues, clear routine exceptions, verify file acknowledgements and continue scheduled reconciliation."],
      ["Agent opportunity", "Agents can summarize operational health, explain minor exceptions and watch for changes without opening an incident."],
    ],
  },
  {
    id: "watch",
    label: "Simulation feed watch",
    shortLabel: "Watch",
    tone: "amber",
    headline: "ACH processing needs attention",
    explanation:
      "A developing condition is slowing processing. Processor latency and retries are rising, the queue is aging and reconciliation differences are increasing. Payments are still moving, but operations should investigate before the condition becomes a customer-impacting incident.",
    overall: "WATCH",
    success: "96.42% successful",
    transactions: "1,318",
    volume: "$4.11M processed",
    reconPct: "97.18%",
    reconDetail: "37 unreconciled · $86,940",
    pending: "29 min",
    pendingDetail: "41 pending · 12 failed",
    txTitle: "$1,000 ACH Credit · Delayed",
    txBadge: "PROCESSING DELAY",
    trace: "Trace 09100001-240919-1188 · Member payment · Coastal Federal CU",
    detail: [
      ["Direction", "Credit"],
      ["Amount", "$1,000.00"],
      ["SEC code", "PPD"],
      ["Effective date", "Sep 19, 2026"],
      ["Posting status", "Pending"],
      ["Settlement status", "Submitted"],
      ["Reconciliation", "Pending"],
      ["Return code", "None"],
      ["Retries", "2"],
    ],
    reconMetrics: [
      ["1,318", "Total"],
      ["1,281", "Reconciled"],
      ["37", "Unreconciled"],
      ["$86,940", "Difference"],
    ],
    checks: [
      ["File acknowledgements", "Watch", "Two acknowledgements arrived later than baseline"],
      ["Posting queues", "Watch", "41 pending · oldest 29 min"],
      ["Settlement", "Healthy", "Current settlement cycle remains within window"],
      ["Reconciliation", "Watch", "37 items are waiting for posting confirmation"],
    ],
    flow: [
      ["Channel", "Received", "11:03:12", "green"],
      ["Payment Platform", "Validated", "11:03:13", "green"],
      ["Processor", "Retrying", "11:05:44", "yellow"],
      ["ODFI", "Submitted", "11:08:10", "yellow"],
      ["ACH Operator", "Delivered", "11:09:02", "green"],
      ["RDFI", "Accepted", "11:09:27", "green"],
      ["Posting", "Pending", "—", "yellow"],
      ["Reconciliation", "Waiting", "—", "muted"],
    ],
    scenarioNotes: [
      ["What the operator sees", "A yellow condition: transaction success has dropped, retries are increasing and queue age is materially higher than the healthy baseline."],
      ["Expected action", "Check processor latency, acknowledgement timing and posting queues; compare affected credit unions; determine whether the issue is isolated or broadening."],
      ["Escalation threshold", "If queue age, failures or customer impact continue to rise, the operator should open an incident and pass the transaction evidence into Incident Intelligence."],
    ],
  },
  {
    id: "critical",
    label: "Simulation feed critical",
    shortLabel: "Critical",
    tone: "red",
    headline: "ACH processing disruption",
    explanation:
      "A material processing failure is affecting member payments. Processor failures are elevated, queued items are aging beyond tolerance, posting is blocked for a subset of transactions and reconciliation differences are growing. This condition warrants incident escalation.",
    overall: "CRITICAL",
    success: "81.60% successful",
    transactions: "1,406",
    volume: "$4.48M submitted",
    reconPct: "84.21%",
    reconDetail: "222 unreconciled · $614,380",
    pending: "71 min",
    pendingDetail: "184 pending · 96 failed",
    txTitle: "$1,000 ACH Credit · Failed",
    txBadge: "PROCESSING FAILED",
    trace: "Trace 09100001-240919-1297 · Member payment · Summit Credit Union",
    detail: [
      ["Direction", "Credit"],
      ["Amount", "$1,000.00"],
      ["SEC code", "PPD"],
      ["Effective date", "Sep 19, 2026"],
      ["Posting status", "Blocked"],
      ["Settlement status", "Not settled"],
      ["Reconciliation", "Unreconciled"],
      ["Processor result", "Timeout / no acknowledgement"],
      ["Retries", "4"],
    ],
    reconMetrics: [
      ["1,406", "Total"],
      ["1,184", "Reconciled"],
      ["222", "Unreconciled"],
      ["$614,380", "Difference"],
    ],
    checks: [
      ["File acknowledgements", "Critical", "Expected processor acknowledgement missing"],
      ["Posting queues", "Critical", "184 pending · oldest 71 min"],
      ["Settlement", "Watch", "Affected items may miss the current processing window"],
      ["Reconciliation", "Critical", "222 items cannot be balanced to posting state"],
    ],
    flow: [
      ["Channel", "Received", "12:16:04", "green"],
      ["Payment Platform", "Validated", "12:16:05", "green"],
      ["Processor", "Failed", "12:20:31", "red"],
      ["ODFI", "Not sent", "—", "muted"],
      ["ACH Operator", "Not reached", "—", "muted"],
      ["RDFI", "Not reached", "—", "muted"],
      ["Posting", "Blocked", "—", "red"],
      ["Reconciliation", "Unbalanced", "—", "red"],
    ],
    scenarioNotes: [
      ["What the operator sees", "A red condition: failures, queue age and unreconciled dollars have crossed an operational threshold and member payments are no longer reliably completing."],
      ["Expected action", "Stop treating this as routine queue management. Validate processor connectivity, protect against duplicate retries, identify the affected population and preserve evidence."],
      ["Incident handoff", "Open Incident Intelligence with the affected credit union, transaction IDs, processor errors, queue metrics, timestamps and reconciliation state already attached for the incident agents."],
    ],
  },
];

function toneClasses(tone: Scenario["tone"]) {
  if (tone === "amber") {
    return {
      text: "text-amber-200",
      accent: "text-amber-300",
      border: "border-amber-300/25",
      bg: "bg-amber-300/[0.08]",
      dot: "bg-amber-300 shadow-[0_0_12px_#fcd34d]",
      ring: "ring-amber-300/30",
    };
  }
  if (tone === "red") {
    return {
      text: "text-red-200",
      accent: "text-red-300",
      border: "border-red-300/25",
      bg: "bg-red-300/[0.08]",
      dot: "bg-red-400 shadow-[0_0_12px_#f87171]",
      ring: "ring-red-300/30",
    };
  }
  return {
    text: "text-emerald-200",
    accent: "text-emerald-300",
    border: "border-emerald-300/25",
    bg: "bg-emerald-300/[0.08]",
    dot: "bg-emerald-400 shadow-[0_0_12px_#34d399]",
    ring: "ring-emerald-300/30",
  };
}

function flowClasses(state: "green" | "yellow" | "red" | "muted") {
  if (state === "yellow") {
    return {
      circle: "border-amber-300/30 bg-amber-300/[0.10] text-amber-300",
      text: "text-amber-300/80",
      line: "bg-gradient-to-r from-amber-300/70 to-amber-300/20",
      symbol: "!",
    };
  }
  if (state === "red") {
    return {
      circle: "border-red-300/30 bg-red-300/[0.10] text-red-300",
      text: "text-red-300/80",
      line: "bg-gradient-to-r from-red-300/70 to-red-300/20",
      symbol: "×",
    };
  }
  if (state === "muted") {
    return {
      circle: "border-white/10 bg-white/[0.03] text-slate-600",
      text: "text-slate-600",
      line: "bg-white/10",
      symbol: "·",
    };
  }
  return {
    circle: "border-emerald-300/30 bg-emerald-300/[0.10] text-emerald-300",
    text: "text-emerald-300/80",
    line: "bg-gradient-to-r from-emerald-300/70 to-emerald-300/20",
    symbol: "✓",
  };
}

function ScenarioView({ scenario }: { scenario: Scenario }) {
  const tone = toneClasses(scenario.tone);

  return (
    <div id={`platform-scenario-${scenario.id}`} className="platform-scenario hidden">
      <section className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className={`text-xs font-semibold tracking-[0.14em] ${tone.accent}`}>
            OPERATIONS MANAGER
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">
            {scenario.headline}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            {scenario.explanation}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <label className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
            <span className="block text-[10px] font-semibold tracking-[0.12em] text-slate-600">
              CREDIT UNION
            </span>
            <select className="mt-2 w-full bg-transparent text-sm font-semibold text-white outline-none">
              <option className="bg-[#0b161e]">Pacific Community CU</option>
              <option className="bg-[#0b161e]">Coastal Federal CU</option>
              <option className="bg-[#0b161e]">Summit Credit Union</option>
            </select>
          </label>
          <label className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
            <span className="block text-[10px] font-semibold tracking-[0.12em] text-slate-600">
              RAIL
            </span>
            <select className="mt-2 w-full bg-transparent text-sm font-semibold text-white outline-none">
              <option className="bg-[#0b161e]">ACH</option>
            </select>
          </label>
          <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.05] p-3">
            <span className="block text-[10px] font-semibold tracking-[0.12em] text-cyan-400">
              DATA MODE
            </span>
            <div className="mt-2 text-sm font-semibold text-cyan-100">
              Example / Simulation
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Overall processing", scenario.overall, scenario.success, scenario.tone],
          ["Transactions today", scenario.transactions, scenario.volume, "cyan"],
          ["Reconciliation", scenario.reconPct, scenario.reconDetail, scenario.tone],
          ["Oldest pending", scenario.pending, scenario.pendingDetail, scenario.tone],
        ].map(([label, value, detail, cardTone]) => (
          <article key={label} className="signal-card p-5">
            <div className="text-[10px] font-semibold tracking-[0.13em] text-slate-600">
              {label.toUpperCase()}
            </div>
            <div
              className={`mt-3 text-2xl font-semibold ${
                cardTone === "emerald"
                  ? "text-emerald-300"
                  : cardTone === "amber"
                  ? "text-amber-200"
                  : cardTone === "red"
                  ? "text-red-300"
                  : "text-cyan-200"
              }`}
            >
              {value}
            </div>
            <div className="mt-2 text-sm text-slate-500">{detail}</div>
          </article>
        ))}
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <div className="signal-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className={`text-xs font-semibold tracking-[0.14em] ${tone.accent}`}>
                EXAMPLE TRANSACTION
              </div>
              <h2 className="mt-2 text-xl font-semibold">{scenario.txTitle}</h2>
              <p className="mt-2 text-sm text-slate-500">{scenario.trace}</p>
            </div>
            <span
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${tone.border} ${tone.bg} ${tone.text}`}
            >
              {scenario.txBadge}
            </span>
          </div>

          <div className="mt-7 overflow-x-auto pb-2">
            <div className="flex min-w-[980px] items-start">
              {scenario.flow.map(([name, status, time, state], index) => {
                const flow = flowClasses(state);
                return (
                  <div key={name} className="flex flex-1 items-start">
                    <div className="min-w-[105px] text-center">
                      <div
                        className={`mx-auto grid size-9 place-items-center rounded-full border ${flow.circle}`}
                      >
                        {flow.symbol}
                      </div>
                      <div className="mt-3 text-sm font-semibold text-white">{name}</div>
                      <div className={`mt-1 text-xs ${flow.text}`}>{status}</div>
                      <div className="mt-1 font-mono text-[10px] text-slate-600">{time}</div>
                    </div>
                    {index < scenario.flow.length - 1 && (
                      <div className={`mt-[17px] h-px flex-1 ${flow.line}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="signal-card p-5 sm:p-6">
          <div className="text-xs font-semibold tracking-[0.14em] text-violet-300">
            TRANSACTION DETAIL
          </div>
          <div className="mt-4 grid gap-3 text-sm">
            {scenario.detail.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 border-b border-white/[0.06] pb-2"
              >
                <span className="text-slate-500">{label}</span>
                <span className="font-medium text-slate-200">{value}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="signal-card p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className={`text-xs font-semibold tracking-[0.14em] ${tone.accent}`}>
                RECONCILIATION HEALTH
              </div>
              <h2 className="mt-2 text-lg font-semibold">Selected credit union · ACH</h2>
            </div>
            <span className={`font-mono text-2xl font-semibold ${tone.text}`}>
              {(100 - parseFloat(scenario.reconPct)).toFixed(2)}%
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-500">Percent not reconciled</p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {scenario.reconMetrics.map(([value, label]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="font-mono text-lg text-white">{value}</div>
                <div className="mt-1 text-xs text-slate-600">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="signal-card p-5 sm:p-6">
          <div className={`text-xs font-semibold tracking-[0.14em] ${tone.accent}`}>
            OPERATING CHECKS
          </div>
          <h2 className="mt-2 text-lg font-semibold">What needs attention</h2>
          <div className="mt-5 grid gap-3">
            {scenario.checks.map(([name, status, detail]) => (
              <div
                key={name}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3"
              >
                <span
                  className={`size-2 rounded-full ${
                    status === "Healthy"
                      ? "bg-emerald-400"
                      : status === "Watch"
                      ? "bg-amber-300"
                      : "bg-red-400"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-200">{name}</div>
                  <div className="mt-1 text-xs text-slate-600">{detail}</div>
                </div>
                <span
                  className={`text-xs font-semibold ${
                    status === "Healthy"
                      ? "text-emerald-300"
                      : status === "Watch"
                      ? "text-amber-200"
                      : "text-red-300"
                  }`}
                >
                  {status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={`mt-4 rounded-xl border p-5 sm:p-6 ${tone.border} ${tone.bg}`}>
        <div className={`text-xs font-semibold tracking-[0.14em] ${tone.accent}`}>
          SCENARIO EXPLANATION
        </div>
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

      <section className="mt-4 signal-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold tracking-[0.14em] text-cyan-300">
              READY FOR REAL DATA
            </div>
            <h2 className="mt-2 text-lg font-semibold">Stable ACH operations data contract</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              All three simulations use the same operational fields that a real provider feed, ACH file parser,
              event stream or credit-union integration can populate later. Only the data source changes; the operator
              experience does not need to be redesigned.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 font-mono text-xs text-slate-400">
            transaction → rail → stage → status → posting → settlement → reconciliation
          </div>
        </div>
      </section>
    </div>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-[#071017] text-[#f2f7f8]">
        <div className="sticky top-0 z-[100] border-b border-white/10 bg-[#050c12]/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1500px] items-center gap-2 px-4 py-2 lg:px-8">
            <span className="mr-2 hidden text-[11px] font-semibold tracking-[0.14em] text-slate-600 sm:inline">
              WORKSPACE
            </span>
            <a
              id="workspace-incident-link"
              href="/?workspace=incident"
              className="rounded-md px-3 py-2 text-sm font-semibold transition"
            >
              Incident Intelligence
            </a>
            <a
              id="workspace-platform-link"
              href="/?workspace=platform&scenario=healthy"
              className="rounded-md px-3 py-2 text-sm font-semibold transition"
            >
              Platform Health
            </a>
            <span className="ml-auto hidden text-xs text-slate-600 md:inline">
              Shared agentic intelligence · different operator experience
            </span>
          </div>
        </div>

        <div id="incident-workspace">{children}</div>

        <main id="platform-workspace" className="hidden min-h-screen bg-[#071017] text-[#f2f7f8]">
          <header className="border-b border-white/10 bg-[#071017]/95">
            <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 text-emerald-200">
                  <span className="text-lg">◎</span>
                </div>
                <div>
                  <div className="text-[15px] font-semibold tracking-[0.08em]">PLATFORM HEALTH</div>
                  <div className="text-xs text-slate-400">Payments operations workspace · ACH</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <a
                  id="scenario-pill-healthy"
                  href="/?workspace=platform&scenario=healthy"
                  className="scenario-pill flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition"
                >
                  <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
                  Simulation feed healthy
                </a>
                <a
                  id="scenario-pill-watch"
                  href="/?workspace=platform&scenario=watch"
                  className="scenario-pill flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition"
                >
                  <span className="size-2 rounded-full bg-amber-300 shadow-[0_0_12px_#fcd34d]" />
                  Simulation feed watch
                </a>
                <a
                  id="scenario-pill-critical"
                  href="/?workspace=platform&scenario=critical"
                  className="scenario-pill flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition"
                >
                  <span className="size-2 rounded-full bg-red-400 shadow-[0_0_12px_#f87171]" />
                  Simulation feed critical
                </a>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1500px] px-4 pb-14 pt-6 lg:px-8">
            {scenarios.map((scenario) => (
              <PlatformScenarioView key={scenario.id} scenario={scenario} />
            ))}
          </div>
        </main>

        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  function applyWorkspace() {
    var params = new URLSearchParams(window.location.search);
    var mode = params.get('workspace') === 'platform' ? 'platform' : 'incident';
    var scenario = params.get('scenario');
    if (scenario !== 'watch' && scenario !== 'critical') scenario = 'healthy';

    var incident = document.getElementById('incident-workspace');
    var platform = document.getElementById('platform-workspace');
    var incidentLink = document.getElementById('workspace-incident-link');
    var platformLink = document.getElementById('workspace-platform-link');

    if (!incident || !platform || !incidentLink || !platformLink) return;

    incident.style.display = mode === 'incident' ? '' : 'none';
    platform.style.display = mode === 'platform' ? 'block' : 'none';

    incidentLink.className =
      'rounded-md px-3 py-2 text-sm font-semibold transition ' +
      (mode === 'incident'
        ? 'bg-cyan-300/12 text-cyan-200 ring-1 ring-cyan-300/30'
        : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300');

    platformLink.className =
      'rounded-md px-3 py-2 text-sm font-semibold transition ' +
      (mode === 'platform'
        ? 'bg-emerald-300/12 text-emerald-200 ring-1 ring-emerald-300/30'
        : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300');

    ['healthy', 'watch', 'critical'].forEach(function (name) {
      var view = document.getElementById('platform-scenario-' + name);
      if (view) view.style.display = mode === 'platform' && scenario === name ? 'block' : 'none';

      var pill = document.getElementById('scenario-pill-' + name);
      if (!pill) return;

      if (name === 'healthy') {
        pill.className =
          'scenario-pill flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ' +
          (scenario === name
            ? 'border-emerald-300/35 bg-emerald-300/[0.12] text-emerald-100 ring-1 ring-emerald-300/20'
            : 'border-emerald-300/15 bg-emerald-300/[0.04] text-emerald-300/60 hover:bg-emerald-300/[0.08]');
      } else if (name === 'watch') {
        pill.className =
          'scenario-pill flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ' +
          (scenario === name
            ? 'border-amber-300/35 bg-amber-300/[0.12] text-amber-100 ring-1 ring-amber-300/20'
            : 'border-amber-300/15 bg-amber-300/[0.04] text-amber-300/60 hover:bg-amber-300/[0.08]');
      } else {
        pill.className =
          'scenario-pill flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ' +
          (scenario === name
            ? 'border-red-300/35 bg-red-300/[0.12] text-red-100 ring-1 ring-red-300/20'
            : 'border-red-300/15 bg-red-300/[0.04] text-red-300/60 hover:bg-red-300/[0.08]');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyWorkspace);
  } else {
    applyWorkspace();
  }
})();
            `,
          }}
        />
      </body>
    </html>
  );
}
