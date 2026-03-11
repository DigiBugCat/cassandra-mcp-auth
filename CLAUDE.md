# CLAUDE.md — Cassandra MCP Auth

## What This Is

Shared auth package for Cassandra MCP Workers. Provides WorkOS OAuth flow, MCP API key resolution (with per-key credentials), and metrics middleware as a single `createMcpWorker()` factory.

Consumed via `github:DigiBugCat/cassandra-mcp-auth` in Worker `package.json` files — same pattern as `cassandra-observability`.

## Repo Structure

```
cassandra-mcp-auth/
├── src/
│   ├── index.ts               # Public API: createMcpWorker + types + advanced escape hatch
│   ├── advanced.ts            # Lower-level exports for custom integrations
│   ├── types.ts               # McpAuthEnv, ResolvedAuth, McpWorkerConfig
│   ├── auth.ts                # resolveExternalToken (mcp_ key + WorkOS JWT)
│   ├── worker.ts              # createMcpWorker() factory
│   ├── workos-handler.ts      # WorkOS OAuth handler (Hono)
│   ├── workers-oauth-utils.ts # CSRF, state, session utils
│   └── utils.ts               # WorkOS token exchange
├── package.json
├── tsconfig.json
└── .woodpecker.yaml            # type-check only
```

## Usage

```ts
import { createMcpWorker } from "cassandra-mcp-auth";

interface MyCredentials {
  external_api_token: string;
}

const { default: worker, McpAgentClass } = createMcpWorker<Env, MyCredentials>({
  serviceId: "my-service",
  name: "My MCP Service",
  registerTools(server, env, auth) {
    // auth.credentials is typed as MyCredentials | undefined
    server.registerTool("my_tool", { ... }, async (args) => { ... });
  },
});

export { McpAgentClass as MyServiceMCP };
export default worker;
```

## Consumer Requirements

Each Worker using this package needs:

### Bindings (wrangler.jsonc)
- `MCP_OBJECT` — Durable Object (MUST be this name)
- `OAUTH_KV` — Per-service KV for OAuth state
- `MCP_KEYS` — Shared KV for API key auth

### Secrets (wrangler secret put)
- `WORKOS_CLIENT_ID` — Shared WorkOS app
- `WORKOS_CLIENT_SECRET` — Shared WorkOS app
- `COOKIE_ENCRYPTION_KEY` — Session encryption
- `VM_PUSH_URL` — VictoriaMetrics push endpoint
- `VM_PUSH_CLIENT_ID` — CF Access service token for metrics
- `VM_PUSH_CLIENT_SECRET` — CF Access service token for metrics

## Per-Key Credentials

Services that need per-user credentials (e.g. Pushover user key) store them in the MCP key metadata via the portal. `createMcpWorker()` carries those credentials through to `auth.credentials` in `registerTools`, and services can type that shape via the second generic parameter.

## Advanced API

`createMcpWorker()` is the blessed path for normal services.

If a service really does need lower-level control, import the `advanced` namespace from the package root and reach for `advanced.createTokenResolver`, `advanced.createWorkOSHandler`, or the OAuth helpers explicitly.
