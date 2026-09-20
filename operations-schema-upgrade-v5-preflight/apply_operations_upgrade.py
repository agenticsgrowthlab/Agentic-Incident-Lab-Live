from pathlib import Path

root = Path.cwd()
main = root / "backend/main.py"
layout = root / "frontend/app/layout.tsx"
ops = root / "backend/operations.py"
catalog = root / "backend/ach_return_catalog.py"
failure_catalog = root / "backend/ach_failure_catalog.py"
preflight_validator = root / "backend/nacha_preflight.py"
component = root / "frontend/app/PlatformScenarioView.tsx"

if not main.exists() or not layout.exists():
    raise SystemExit("Run this script from the repository root.")

# Install supplied new files.
payload_root = Path(__file__).resolve().parent
ops.write_text((payload_root / "backend/operations.py").read_text())
catalog.write_text((payload_root / "backend/ach_return_catalog.py").read_text())
failure_catalog.write_text((payload_root / "backend/ach_failure_catalog.py").read_text())
preflight_validator.write_text((payload_root / "backend/nacha_preflight.py").read_text())
component.write_text((payload_root / "frontend/app/PlatformScenarioView.tsx").read_text())

# Wire FastAPI router.
main_text = main.read_text()
if "from operations import router as operations_router" not in main_text:
    anchor = "from agentic.retrieval import ingest_uploaded_document, list_uploaded_documents, retrieve\n"
    main_text = main_text.replace(anchor, anchor + "from operations import router as operations_router\n")
if "app.include_router(operations_router)" not in main_text:
    anchor = 'app = FastAPI(title="Agentic Incident Lab API", version="1.1.0")\n'
    main_text = main_text.replace(anchor, anchor + "app.include_router(operations_router)\n")
main.write_text(main_text)

# Wire client-side Platform Health renderer without deleting the existing scenario definitions.
layout_text = layout.read_text()
if 'import PlatformScenarioView from "./PlatformScenarioView";' not in layout_text:
    layout_text = layout_text.replace(
        'import type { Metadata } from "next";\n',
        'import type { Metadata } from "next";\nimport PlatformScenarioView from "./PlatformScenarioView";\n',
    )

old = '<ScenarioView key={scenario.id} scenario={scenario} />'
new = '<PlatformScenarioView key={scenario.id} scenario={scenario} />'
if old in layout_text:
    layout_text = layout_text.replace(old, new)
elif new not in layout_text:
    raise SystemExit("Could not locate scenario renderer in frontend/app/layout.tsx")

layout.write_text(layout_text)

print("Operations schema upgrade applied.")
print("Created: backend/operations.py")
print("Created: backend/ach_return_catalog.py")
print("Created: backend/ach_failure_catalog.py")
print("Created: backend/nacha_preflight.py")
print("Created: frontend/app/PlatformScenarioView.tsx")
print("Updated: backend/main.py")
print("Updated: frontend/app/layout.tsx")
