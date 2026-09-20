from pathlib import Path

root = Path.cwd()
payload = Path(__file__).resolve().parent
main = root / "backend/main.py"
layout = root / "frontend/app/layout.tsx"

if not main.exists() or not layout.exists():
    raise SystemExit("Run from repo root containing backend/main.py and frontend/app/layout.tsx")

(root/"backend/rail_catalogs.py").write_text((payload/"backend/rail_catalogs.py").read_text())
(root/"backend/multi_rail.py").write_text((payload/"backend/multi_rail.py").read_text())
(root/"frontend/app/RailOperationsView.tsx").write_text((payload/"frontend/app/RailOperationsView.tsx").read_text())

text = main.read_text()
if "from multi_rail import router as multi_rail_router" not in text:
    text = text.replace("from operations import router as operations_router\n", "from operations import router as operations_router\nfrom multi_rail import router as multi_rail_router\n")
if "app.include_router(multi_rail_router)" not in text:
    text = text.replace("app.include_router(operations_router)\n", "app.include_router(operations_router)\napp.include_router(multi_rail_router)\n")
main.write_text(text)

text = layout.read_text()
if 'import RailOperationsView from "./RailOperationsView";' not in text:
    text = text.replace('import PlatformScenarioView from "./PlatformScenarioView";\n', 'import PlatformScenarioView from "./PlatformScenarioView";\nimport RailOperationsView from "./RailOperationsView";\n')
text = text.replace("Payments operations workspace · ACH", "Payments operations workspace · multi-rail")

rail_nav = '''
          <nav id="rail-nav" className="border-b border-white/10 bg-[#08131b]">
            <div className="mx-auto flex max-w-[1500px] items-center gap-1 overflow-x-auto px-4 py-2 lg:px-8">
              <span className="mr-3 shrink-0 text-[10px] font-semibold tracking-[0.14em] text-slate-600">PAYMENT RAIL</span>
              <a id="rail-link-ach" href="/?workspace=platform&rail=ach&scenario=healthy" className="rail-link rounded-md px-4 py-2 text-sm font-semibold transition">ACH</a>
              <span className="text-slate-700">|</span>
              <a id="rail-link-fednow" href="/?workspace=platform&rail=fednow&scenario=healthy" className="rail-link rounded-md px-4 py-2 text-sm font-semibold transition">FedNow</a>
              <span className="text-slate-700">|</span>
              <a id="rail-link-fedwire" href="/?workspace=platform&rail=fedwire&scenario=healthy" className="rail-link rounded-md px-4 py-2 text-sm font-semibold transition">FedWire</a>
              <span className="text-slate-700">|</span>
              <a id="rail-link-rtp" href="/?workspace=platform&rail=rtp&scenario=healthy" className="rail-link rounded-md px-4 py-2 text-sm font-semibold transition">RTP</a>
            </div>
          </nav>
'''
if 'id="rail-nav"' not in text:
    marker = '          </header>\n\n          <div className="mx-auto max-w-[1500px] px-4 pb-14 pt-6 lg:px-8">'
    text = text.replace(marker, '          </header>\n' + rail_nav + '\n          <div className="mx-auto max-w-[1500px] px-4 pb-14 pt-6 lg:px-8">', 1)

old = '''          <div className="mx-auto max-w-[1500px] px-4 pb-14 pt-6 lg:px-8">
            {scenarios.map((scenario) => (
              <PlatformScenarioView key={scenario.id} scenario={scenario} />
            ))}
          </div>'''
new = '''          <div className="mx-auto max-w-[1500px] px-4 pb-14 pt-6 lg:px-8">
            <div id="rail-view-ach">
              {scenarios.map((scenario) => (
                <PlatformScenarioView key={scenario.id} scenario={scenario} />
              ))}
            </div>
            <div id="rail-view-fednow" className="hidden"><RailOperationsView rail="fednow" /></div>
            <div id="rail-view-fedwire" className="hidden"><RailOperationsView rail="fedwire" /></div>
            <div id="rail-view-rtp" className="hidden"><RailOperationsView rail="rtp" /></div>
          </div>'''
if old in text:
    text = text.replace(old, new, 1)

text = text.replace(
    "    var scenario = params.get('scenario');\n    if (scenario !== 'watch' && scenario !== 'critical') scenario = 'healthy';",
    "    var scenario = params.get('scenario');\n    if (scenario !== 'watch' && scenario !== 'critical') scenario = 'healthy';\n    var rail = params.get('rail');\n    if (rail !== 'fednow' && rail !== 'fedwire' && rail !== 'rtp') rail = 'ach';"
)
text = text.replace(
    "      if (view) view.style.display = mode === 'platform' && scenario === name ? 'block' : 'none';",
    "      if (view) view.style.display = mode === 'platform' && rail === 'ach' && scenario === name ? 'block' : 'none';"
)

rail_script = """
    ['ach', 'fednow', 'fedwire', 'rtp'].forEach(function (name) {
      var railView = document.getElementById('rail-view-' + name);
      if (railView) railView.style.display = mode === 'platform' && rail === name ? 'block' : 'none';
      var railLink = document.getElementById('rail-link-' + name);
      if (railLink) {
        railLink.className =
          'rail-link rounded-md px-4 py-2 text-sm font-semibold transition ' +
          (rail === name
            ? 'bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-300/25'
            : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300');
      }
    });

    ['healthy', 'watch', 'critical'].forEach(function (name) {
      var pillLink = document.getElementById('scenario-pill-' + name);
      if (pillLink) pillLink.setAttribute('href', '/?workspace=platform&rail=' + rail + '&scenario=' + name);
    });
"""
if "var railView = document.getElementById('rail-view-' + name);" not in text:
    anchor = "    ['healthy', 'watch', 'critical'].forEach(function (name) {"
    text = text.replace(anchor, rail_script + "\n" + anchor, 1)

layout.write_text(text)
print("Multi-rail v6 upgrade applied.")
print("Created backend/rail_catalogs.py, backend/multi_rail.py, frontend/app/RailOperationsView.tsx")
print("Updated backend/main.py and frontend/app/layout.tsx")
