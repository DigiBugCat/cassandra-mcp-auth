export { createMcpWorker } from "./worker.js";
export { checkACL, fetchUserCredentials } from "./acl.js";
export type { AclEnv, AclCheckResult } from "./acl.js";
import {
  createTokenResolver,
  createWorkOSHandler,
  createOAuthState,
  bindStateToSession,
  validateOAuthState,
  OAuthError,
  getUpstreamAuthorizeUrl,
  fetchWorkOSAuthToken,
} from "./advanced.js";

/**
 * Escape hatches for services that need to bypass the standard `createMcpWorker()` path.
 * Most consumers should stick to `createMcpWorker()` and the exported types above.
 */
export const advanced = {
  createTokenResolver,
  createWorkOSHandler,
  createOAuthState,
  bindStateToSession,
  validateOAuthState,
  OAuthError,
  getUpstreamAuthorizeUrl,
  fetchWorkOSAuthToken,
} as const;

export type {
  McpAuthEnv,
  McpAgentProps,
  McpCredentials,
  McpKeyMeta,
  McpWorkerConfig,
  ResolvedAuth,
} from "./types.js";

export type { WorkOSAuthResult } from "./utils.js";
