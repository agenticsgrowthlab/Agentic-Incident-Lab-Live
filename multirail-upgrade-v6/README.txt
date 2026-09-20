MULTI-RAIL UPGRADE V6

Adds: ACH | FedNow | FedWire | RTP

ACH stays intact. FedNow, FedWire, RTP each get:
- Operations Dashboard
- Use Cases Covered
- ISO 20022 Message Test
- Healthy / Watch / Critical Neon scenarios
- rail-specific error/failure catalog
- Reset Lab to Red

INSTALL FROM REPO ROOT:
python .\multirail-upgrade-v6\apply_multirail_upgrade.py
python -m py_compile backend\main.py backend\multi_rail.py backend\rail_catalogs.py
npm run build

Only commit/push after both checks pass.

The test-files folder contains synthetic XML only. Never transmit them to a live payment network.
