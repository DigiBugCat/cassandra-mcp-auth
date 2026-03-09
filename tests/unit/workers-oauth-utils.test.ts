import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OAuthError,
  bindStateToSession,
  createOAuthState,
  validateOAuthState,
} from "../../src/workers-oauth-utils.js";
import { createMockKV } from "../helpers/kv.js";

describe("workers OAuth helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates OAuth state records with the default TTL", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("state-123");
    const kv = createMockKV();
    const oauthReqInfo = {
      clientId: "client-1",
      redirectUri: "https://client.example/callback",
      scope: "read",
    };

    const result = await createOAuthState(oauthReqInfo as any, kv);

    expect(result).toEqual({ stateToken: "state-123" });
    expect(kv.putCalls).toEqual([
      {
        key: "oauth:state:state-123",
        value: JSON.stringify(oauthReqInfo),
        options: { expirationTtl: 600 },
      },
    ]);
  });

  it("binds the state token to a hashed cookie instead of storing the raw value", async () => {
    const result = await bindStateToSession("state-123");

    const expectedHash = createHash("sha256").update("state-123").digest("hex");
    expect(result.setCookie).toContain(`__Host-CONSENTED_STATE=${expectedHash}`);
    expect(result.setCookie).toContain("HttpOnly");
    expect(result.setCookie).not.toContain("state-123");
  });

  it("validates state, clears the session cookie, and deletes the KV record", async () => {
    const kv = createMockKV();
    const oauthReqInfo = { clientId: "client-1", scope: "read write" };
    await kv.put("oauth:state:state-123", JSON.stringify(oauthReqInfo));
    const { setCookie } = await bindStateToSession("state-123");

    const result = await validateOAuthState(
      new Request("https://worker.example/callback?state=state-123", {
        headers: { Cookie: setCookie.split(";")[0] },
      }),
      kv,
    );

    expect(result.oauthReqInfo).toEqual(oauthReqInfo);
    expect(result.clearCookie).toContain("__Host-CONSENTED_STATE=");
    expect(result.clearCookie).toContain("Max-Age=0");
    expect(kv.store.has("oauth:state:state-123")).toBe(false);
  });

  it("rejects callback requests when the binding cookie is missing", async () => {
    const kv = createMockKV();
    await kv.put("oauth:state:state-123", JSON.stringify({ clientId: "client-1" }));

    await expect(
      validateOAuthState(new Request("https://worker.example/callback?state=state-123"), kv),
    ).rejects.toMatchObject<Partial<OAuthError>>({
      code: "invalid_request",
      statusCode: 400,
    });
  });
});
