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
  it("throws on missing state parameter and no cookie", async () => {
    const kv = createMockKV();
    const request = new Request("https://example.com/callback");

    await expect(validateOAuthState(request, kv)).rejects.toThrow(OAuthError);
  });

  it("throws on invalid/expired state from query", async () => {
    const kv = createMockKV();
    const request = new Request("https://example.com/callback?state=expired-token");

    await expect(validateOAuthState(request, kv)).rejects.toThrow(OAuthError);
  });

  it("validates successfully with state in query and matching cookie", async () => {
    const kv = createMockKV();
    const oauthReq = { clientId: "test" };
    kv._store.set("oauth:state:valid-token", JSON.stringify(oauthReq));
    const request = new Request("https://example.com/callback?state=valid-token", {
      headers: { Cookie: "__Host-CONSENTED_STATE=valid-token" },
    });

    const result = await validateOAuthState(request, kv);
    expect(result.oauthReqInfo).toEqual(oauthReq);
    expect(kv._store.has("oauth:state:valid-token")).toBe(false);
  });

  it("validates successfully with state only in cookie (WorkOS AuthKit flow)", async () => {
    const kv = createMockKV();
    const oauthReq = { clientId: "test" };
    kv._store.set("oauth:state:cookie-token", JSON.stringify(oauthReq));
    const request = new Request("https://example.com/callback?code=some-code", {
      headers: { Cookie: "__Host-CONSENTED_STATE=cookie-token" },
    });

    const result = await validateOAuthState(request, kv);
    expect(result.oauthReqInfo).toEqual(oauthReq);
  });

  it("throws on CSRF when query state mismatches cookie state", async () => {
    const kv = createMockKV();
    kv._store.set("oauth:state:query-token", JSON.stringify({ clientId: "test" }));
    const request = new Request("https://example.com/callback?state=query-token", {
      headers: { Cookie: "__Host-CONSENTED_STATE=different-token" },
    });

    await expect(validateOAuthState(request, kv)).rejects.toThrow(OAuthError);
  });
});
