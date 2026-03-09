import { describe, it, expect, vi } from "vitest";
import {
  createOAuthState,
  bindStateToSession,
  validateOAuthState,
  OAuthError,
} from "../workers-oauth-utils.js";

function createMockKV(): KVNamespace & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

describe("OAuthError", () => {
  it("creates an error with code and description", () => {
    const err = new OAuthError("invalid_request", "Missing param", 400);
    expect(err.code).toBe("invalid_request");
    expect(err.description).toBe("Missing param");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("Missing param");
  });

  it("returns a JSON Response", () => {
    const err = new OAuthError("server_error", "Something broke", 500);
    const res = err.toResponse();
    expect(res.status).toBe(500);
  });
});

describe("createOAuthState", () => {
  it("stores state in KV and returns a token", async () => {
    const kv = createMockKV();
    const oauthReq = { clientId: "test-client", scope: ["read"] } as any;

    const { stateToken } = await createOAuthState(oauthReq, kv);

    expect(stateToken).toBeTruthy();
    expect(typeof stateToken).toBe("string");
    expect(kv.put).toHaveBeenCalledWith(
      `oauth:state:${stateToken}`,
      JSON.stringify(oauthReq),
      { expirationTtl: 600 },
    );
  });
});

describe("bindStateToSession", () => {
  it("returns a Set-Cookie header with hashed state", async () => {
    const { setCookie } = await bindStateToSession("test-state-token");

    expect(setCookie).toContain("__Host-CONSENTED_STATE=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Max-Age=600");
  });
});

describe("validateOAuthState", () => {
  it("throws on missing state parameter", async () => {
    const kv = createMockKV();
    const request = new Request("https://example.com/callback");

    await expect(validateOAuthState(request, kv)).rejects.toThrow(OAuthError);
  });

  it("throws on invalid/expired state", async () => {
    const kv = createMockKV();
    const request = new Request("https://example.com/callback?state=expired-token");

    await expect(validateOAuthState(request, kv)).rejects.toThrow(OAuthError);
  });

  it("throws when session cookie is missing", async () => {
    const kv = createMockKV();
    // Store state in KV
    kv._store.set("oauth:state:valid-token", JSON.stringify({ clientId: "test" }));
    const request = new Request("https://example.com/callback?state=valid-token");

    await expect(validateOAuthState(request, kv)).rejects.toThrow(OAuthError);
  });
});
