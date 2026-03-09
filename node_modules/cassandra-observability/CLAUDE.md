# CLAUDE.md — Cassandra Observability

## What This Is

Shared observability for Cassandra Worker services. Provides:
1. **Metrics push utility** (`src/metrics.ts`) — Workers import this to push metrics to VictoriaMetrics
2. **Grafana dashboards** (`dashboards/`) — Platform home + Worker analytics dashboards
3. **Terraform module** (`infra/modules/metrics-push/`) — CF Access for the VM push endpoint

## Repo Structure

```
cassandra-observability/
├── src/
│   ├── metrics.ts           # Shared push helper (waitUntil wrapper)
│   └── index.ts             # Re-exports
├── dashboards/
│   ├── home.json            # Platform home dashboard
│   ├── workers.json         # Worker/MCP request analytics
│   ├── orchestrator.json    # Runner orchestrator metrics
│   ├── sessions.json        # Session lifecycle dashboard
│   ├── yt-mcp.json          # YT-MCP transcription metrics
│   ├── cicd.json            # CI/CD & ARC runner metrics
│   └── kustomization.yaml   # ConfigMaps for Grafana sidecar
├── infra/
│   └── modules/
│       └── metrics-push/    # CF Access app + service token
└── .github/workflows/
    └── ci.yml               # Type-check only
```

## Usage in Workers

```ts
import { pushMetrics, counter } from "cassandra-observability";

// In your Worker's fetch handler:
ctx.waitUntil(pushMetrics(env, [
  counter("mcp_requests_total", 1, { service: "portal", status: "200" }),
]));
```

Workers need these secrets (via `wrangler secret put`):
- `VM_PUSH_URL` — `https://vm-push.<domain>/api/v1/import/prometheus`
- `VM_PUSH_CLIENT_ID` — CF Access service token client ID
- `VM_PUSH_CLIENT_SECRET` — CF Access service token client secret

## Metrics Flow

```
CF Worker → POST vm-push.<domain>/api/v1/import/prometheus
          → CF Access (service token auth)
          → CF Tunnel (runner tunnel, extra ingress rule)
          → vmsingle-vm-k8s-stack-victoria-metrics-k8s-stack.monitoring.svc:8428
```

## Deploy

```bash
# Dashboards: ArgoCD watches dashboards/ and syncs ConfigMaps to monitoring namespace
# Infra: manual tofu apply from cassandra-infra/environments/production/observability/
```
