# Orchestrator WebApp

Extensible dashboard + configurator for this repository.

## Features
- Core API (`/api/v1/core/*`) for overview/config transaction/auth.
- Extension API (`/api/v1/ext/*`) for plugin registration and capability discovery.
- Event API (`/api/v1/events/*`) for event query/replay/webhook subscriptions.
- Plugin process isolation via subprocess execution and timeout/resource guard.
- RBAC roles: `Viewer`, `Operator`, `Approver`.

## Run Backend
```bash
cd orchestrator-webapp/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload --port 8000
```

## Run Frontend
```bash
cd orchestrator-webapp/frontend
npm install
npm run dev
```

## Register Sample Plugin
```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/ext/plugins/register \
  -H 'Content-Type: application/json' \
  -H 'X-User: dev-operator' -H 'X-Email: dev@local' -H 'X-Role: operator' \
  -d '{"manifestPath":"orchestrator-webapp/backend/plugins/sample_observability/plugin.manifest.json"}'
```

## Build New Plugin Scaffold
```bash
./orchestrator-webapp/scripts/new_plugin.sh my-plugin "My Plugin"
./orchestrator-webapp/scripts/check_plugin_compat.py orchestrator-webapp/backend/plugins/my-plugin/plugin.manifest.json
```
