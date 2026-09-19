import type { Metadata } from "next";
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

const flowSteps = [
  ["Channel", "Received", "10:14:02"],
  ["Payment Platform", "Validated", "10:14:03"],
  ["Processor", "Accepted", "10:14:04"],
  ["ODFI", "Submitted", "10:14:08"],
  ["ACH Operator", "Delivered", "10:14:41"],
  ["RDFI", "Accepted", "10:15:07"],
  ["Posting", "Posted", "10:15:12"],
  ["Reconciliation", "Balanced", "10:17:30"],
];

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
              href="/?workspace=platform"
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
            <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-5 px-5 py-4 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 text-emerald-200">
                  <span className="text-lg">◎</span>
                </div>
                <div>
                  <div className="text-[15px] font-semibold tracking-[0.08em]">PLATFORM HEALTH</div>
                  <div className="text-xs text-slate-400">Payments operations workspace · ACH</div>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-2 text-xs text-emerald-200">
                <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
                Simulation feed healthy
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1500px] px-4 pb-14 pt-6 lg:px-8">
            <section className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="text-xs font-semibold tracking-[0.14em] text-emerald-300">OPERATIONS MANAGER</div>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">ACH processing health</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                  Monitor transaction completion, posting, settlement and reconciliation by credit union. The screen is using controlled example data now, but the data contract is structured for live ACH events later.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <label className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                  <span className="block text-[10px] font-semibold tracking-[0.12em] text-slate-600">CREDIT UNION</span>
                  <select className="mt-2 w-full bg-transparent text-sm font-semibold text-white outline-none">
                    <option className="bg-[#0b161e]">Pacific Community CU</option>
                    <option className="bg-[#0b161e]">Coastal Federal CU</option>
                    <option className="bg-[#0b161e]">Summit Credit Union</option>
                  </select>
                </label>
                <label className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                  <span className="block text-[10px] font-semibold tracking-[0.12em] text-slate-600">RAIL</span>
                  <select className="mt-2 w-full bg-transparent text-sm font-semibold text-white outline-none">
                    <option className="bg-[#0b161e]">ACH</option>
                  </select>
                </label>
                <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.05] p-3">
                  <span className="block text-[10px] font-semibold tracking-[0.12em] text-cyan-400">DATA MODE</span>
                  <div className="mt-2 text-sm font-semibold text-cyan-100">Example / Simulation</div>
                </div>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                ["Overall processing", "HEALTHY", "99.84% successful", "emerald"],
                ["Transactions today", "1,245", "$3.82M processed", "cyan"],
                ["Reconciliation", "99.60%", "5 unreconciled · $12,480", "amber"],
                ["Oldest pending", "4 min", "3 pending · 2 failed", "violet"],
              ].map(([label, value, detail, tone]) => (
                <article key={label} className="signal-card p-5">
                  <div className="text-[10px] font-semibold tracking-[0.13em] text-slate-600">{label.toUpperCase()}</div>
                  <div className={`mt-3 text-2xl font-semibold ${tone === "emerald" ? "text-emerald-300" : tone === "cyan" ? "text-cyan-200" : tone === "amber" ? "text-amber-200" : "text-violet-200"}`}>{value}</div>
                  <div className="mt-2 text-sm text-slate-500">{detail}</div>
                </article>
              ))}
            </section>

            <section className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
              <div className="signal-card p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold tracking-[0.14em] text-cyan-300">EXAMPLE TRANSACTION</div>
                    <h2 className="mt-2 text-xl font-semibold">$1,000 ACH Credit · Completed</h2>
                    <p className="mt-2 text-sm text-slate-500">Trace 09100001-240919-1042 · Member payment · Pacific Community CU</p>
                  </div>
                  <span className="rounded-full border border-emerald-300/25 bg-emerald-300/[0.08] px-3 py-1.5 text-xs font-semibold text-emerald-200">PROCESSED COMPLETELY</span>
                </div>

                <div className="mt-7 overflow-x-auto pb-2">
                  <div className="flex min-w-[980px] items-start">
                    {flowSteps.map(([name, status, time], index) => (
                      <div key={name} className="flex flex-1 items-start">
                        <div className="min-w-[105px] text-center">
                          <div className="mx-auto grid size-9 place-items-center rounded-full border border-emerald-300/30 bg-emerald-300/[0.10] text-emerald-300">✓</div>
                          <div className="mt-3 text-sm font-semibold text-white">{name}</div>
                          <div className="mt-1 text-xs text-emerald-300/80">{status}</div>
                          <div className="mt-1 font-mono text-[10px] text-slate-600">{time}</div>
                        </div>
                        {index < flowSteps.length - 1 && <div className="mt-[17px] h-px flex-1 bg-gradient-to-r from-emerald-300/70 to-emerald-300/20" />}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <aside className="signal-card p-5 sm:p-6">
                <div className="text-xs font-semibold tracking-[0.14em] text-violet-300">TRANSACTION DETAIL</div>
                <div className="mt-4 grid gap-3 text-sm">
                  {[
                    ["Direction", "Credit"],
                    ["Amount", "$1,000.00"],
                    ["SEC code", "PPD"],
                    ["Effective date", "Sep 19, 2026"],
                    ["Posting status", "Posted"],
                    ["Settlement status", "Settled"],
                    ["Reconciliation", "Balanced"],
                    ["Return code", "None"],
                    ["Retries", "0"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 border-b border-white/[0.06] pb-2">
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
                    <div className="text-xs font-semibold tracking-[0.14em] text-amber-300">RECONCILIATION HEALTH</div>
                    <h2 className="mt-2 text-lg font-semibold">Pacific Community CU · ACH</h2>
                  </div>
                  <span className="font-mono text-2xl font-semibold text-amber-200">0.40%</span>
                </div>
                <p className="mt-2 text-sm text-slate-500">Percent not reconciled</p>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[["1,245", "Total"], ["1,240", "Reconciled"], ["5", "Unreconciled"], ["$12,480", "Difference"]].map(([value, label]) => (
                    <div key={label} className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <div className="font-mono text-lg text-white">{value}</div>
                      <div className="mt-1 text-xs text-slate-600">{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="signal-card p-5 sm:p-6">
                <div className="text-xs font-semibold tracking-[0.14em] text-cyan-300">OPERATING CHECKS</div>
                <h2 className="mt-2 text-lg font-semibold">What needs attention</h2>
                <div className="mt-5 grid gap-3">
                  {[
                    ["File acknowledgements", "Healthy", "All expected acknowledgements received"],
                    ["Posting queues", "Healthy", "3 pending · oldest 4 min"],
                    ["Settlement", "Healthy", "Current cycle within SLA"],
                    ["Reconciliation", "Watch", "5 items require investigation"],
                  ].map(([name, status, detail]) => (
                    <div key={name} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3">
                      <span className={`size-2 rounded-full ${status === "Healthy" ? "bg-emerald-400" : "bg-amber-300"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-200">{name}</div>
                        <div className="mt-1 text-xs text-slate-600">{detail}</div>
                      </div>
                      <span className={`text-xs font-semibold ${status === "Healthy" ? "text-emerald-300" : "text-amber-200"}`}>{status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="mt-4 signal-card p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold tracking-[0.14em] text-emerald-300">READY FOR REAL DATA</div>
                  <h2 className="mt-2 text-lg font-semibold">Stable ACH operations data contract</h2>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">The UI is intentionally separated from the source. Synthetic scenarios can populate the same fields today; later a provider API, ACH file parser, event stream or credit-union feed can populate them without redesigning the operator experience.</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 font-mono text-xs text-slate-400">
                  transaction → rail → stage → status → posting → settlement → reconciliation
                </div>
              </div>
            </section>
          </div>
        </main>

        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  function applyWorkspace() {
    var params = new URLSearchParams(window.location.search);
    var mode = params.get('workspace') === 'platform' ? 'platform' : 'incident';
    var incident = document.getElementById('incident-workspace');
    var platform = document.getElementById('platform-workspace');
    var incidentLink = document.getElementById('workspace-incident-link');
    var platformLink = document.getElementById('workspace-platform-link');
    if (!incident || !platform || !incidentLink || !platformLink) return;

    incident.style.display = mode === 'incident' ? '' : 'none';
    platform.style.display = mode === 'platform' ? 'block' : 'none';

    incidentLink.className = 'rounded-md px-3 py-2 text-sm font-semibold transition ' + (mode === 'incident' ? 'bg-cyan-300/12 text-cyan-200 ring-1 ring-cyan-300/30' : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300');
    platformLink.className = 'rounded-md px-3 py-2 text-sm font-semibold transition ' + (mode === 'platform' ? 'bg-emerald-300/12 text-emerald-200 ring-1 ring-emerald-300/30' : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyWorkspace);
  else applyWorkspace();
})();
            `,
          }}
        />
      </body>
    </html>
  );
}
