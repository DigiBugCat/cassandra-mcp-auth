import type { McpAuthEnv, McpKeyMeta, ResolvedAuth } from "./types.js";

/**
 * Resolve a Bearer token to an authenticated identity.
 *
 * Two paths:
 * 1. MCP API key (mcp_ prefix) — KV lookup, service scope check, credentials extraction
 * 2. WorkOS JWT fallback — JWKS signature verification
 */
export function createTokenResolver(serviceId: string) {
  return async function resolveExternalToken(input: {
    token: string;
    request: Request;
    env: McpAuthEnv;
  }): Promise<{ props: ResolvedAuth; audience?: string | string[] } | null> {
    // Path 1: MCP API key
    if (input.token.startsWith("mcp_")) {
      const meta = await input.env.MCP_KEYS.get<McpKeyMeta>(input.token, "json");
      if (meta && meta.service === serviceId) {
        return {
          props: {
            userId: meta.created_by || "api-key",
            email: meta.created_by || "api-key@mcp",
            name: meta.name || "API Key",
            accessToken: input.token,
            credentials: meta.credentials,
          },
        };
      }
      return null;
    }

    // Path 2: WorkOS JWT
    try {
      const [headerB64, payloadB64, signatureB64] = input.token.split(".");
      const header = JSON.parse(atob(headerB64));
      const jwksResponse = await fetch("https://api.workos.com/sso/jwks");
      if (!jwksResponse.ok) return null;
      const jwks = (await jwksResponse.json()) as { keys: JsonWebKey[] };
      const key = jwks.keys.find(
        (candidate) => (candidate as JsonWebKey & { kid?: string }).kid === header.kid,
      );
      if (!key) return null;

      const cryptoKey = await crypto.subtle.importKey(
        "jwk",
        key,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );

      const signatureBytes = Uint8Array.from(
        atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")),
        (char) => char.charCodeAt(0),
      );
      const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        cryptoKey,
        signatureBytes,
        dataBytes,
      );
      if (!valid) return null;

      const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.exp && payload.exp < Date.now() / 1000) return null;

      return {
        props: {
          userId: payload.sub || payload.org_id || "m2m",
          email: payload.sub || "m2m@machine",
          name: payload.azp || "M2M Client",
          accessToken: input.token,
        },
      };
    } catch {
      return null;
    }
  };
}
