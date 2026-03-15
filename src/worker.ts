import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pushMetrics, counter } from "cassandra-observability";
import { createTokenResolver } from "./auth.js";
import { createWorkOSHandler } from "./workos-handler.js";
import { checkACL, fetchUserCredentials } from "./acl.js";
import type {
  McpAuthEnv,
  McpAgentProps,
  McpCredentials,
  McpWorkerConfig,
} from "./types.js";

/**
 * Create a fully-wired MCP Worker with auth, OAuth, and metrics.
 *
 * Returns an object with:
 * - `default`: the Worker fetch handler (export as default)
 * - `McpAgentClass`: the Durable Object class (export with your class name for wrangler binding)
 *
 * Usage:
 * ```ts
 * const { default: worker, McpAgentClass } = createMcpWorker({
 *   serviceId: "pushover",
 *   name: "Cassandra Pushover",
 *   registerTools(server, env, auth) { ... },
 * });
 * export { McpAgentClass as CassandraPushover };
 * export default worker;
 * ```
 */
export function createMcpWorker<
  TEnv extends McpAuthEnv = McpAuthEnv,
  TCredentials extends McpCredentials = McpCredentials,
>(
  config: McpWorkerConfig<TEnv, TCredentials>,
) {
  const resolveExternalToken = createTokenResolver<TCredentials>(config.serviceId);

  // Create the McpAgent subclass dynamically.
  // server typed as `any` to avoid McpServer version mismatch between agents and @modelcontextprotocol/sdk.
  // wrangler deduplicates at bundle time so the runtime type is always correct.
  class McpAgentClass extends McpAgent<TEnv, Record<string, never>, McpAgentProps<TCredentials>> {
    server: any = new McpServer({
      name: config.name,
      version: config.version || "1.0.0",
    });

    async init() {
      const props = this.props!;

      // If ACL service is configured, fetch per-user credentials and merge
      if (this.env.ACL_URL && this.env.ACL_SECRET) {
        const aclCreds = await fetchUserCredentials<TCredentials>(
          { ACL_URL: this.env.ACL_URL, ACL_SECRET: this.env.ACL_SECRET },
          props.email,
          config.serviceId,
        );
        if (aclCreds) {
          // ACL credentials take precedence over MCP key credentials
          props.credentials = { ...props.credentials, ...aclCreds } as TCredentials;
        }
      }

      await config.registerTools(this.server, this.env, props);

      // If ACL service is configured, wrap all registered tools with ACL checks
      if (this.env.ACL_URL && this.env.ACL_SECRET) {
        const aclEnv = { ACL_URL: this.env.ACL_URL, ACL_SECRET: this.env.ACL_SECRET };
        const email = props.email;
        const serviceId = config.serviceId;

        const originalRequestHandler = (this.server as any)._requestHandlers?.get("tools/call");

        if (originalRequestHandler) {
          (this.server as any)._requestHandlers.set("tools/call", async (request: any, extra: any) => {
            const toolName = request.params?.name;
            if (toolName) {
              const allowed = await checkACL(aclEnv, email, serviceId, toolName);
              if (!allowed) {
                return {
                  content: [{ type: "text", text: `Access denied: you do not have permission to use '${toolName}' on ${serviceId}.` }],
                  isError: true,
                };
              }
            }
            return originalRequestHandler(request, extra);
          });
        }
      }
    }
  }

  const workosHandler = createWorkOSHandler<TEnv, TCredentials>();

  const oauthProvider = new OAuthProvider({
    apiHandler: McpAgentClass.serve("/mcp"),
    apiRoute: "/mcp",
    authorizeEndpoint: "/authorize",
    clientRegistrationEndpoint: "/register",
    defaultHandler: workosHandler as any,
    tokenEndpoint: "/token",
    resolveExternalToken: resolveExternalToken as any,
  });

  const worker = {
    fetch(request: Request, env: TEnv, ctx: ExecutionContext) {
      const start = Date.now();
      const response = oauthProvider.fetch(request, env, ctx);
      ctx.waitUntil(
        Promise.resolve(response).then((res) => {
          const path = new URL(request.url).pathname;
          return pushMetrics(env, [
            counter("mcp_requests_total", 1, {
              service: config.serviceId,
              status: String(res.status),
              path: path.startsWith("/mcp") ? "/mcp" : path,
            }),
            counter("mcp_request_duration_ms_total", Date.now() - start, {
              service: config.serviceId,
              path: path.startsWith("/mcp") ? "/mcp" : path,
            }),
          ]);
        }),
      );
      return response;
    },
  };

  return { default: worker, McpAgentClass };
}
