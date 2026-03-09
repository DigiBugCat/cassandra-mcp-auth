import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTokenResolver } from "../../src/auth.js";
import { createMockKV } from "../helpers/kv.js";

function encodeBase64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createJwt(
  payload: Record<string, unknown>,
  options: { kid: string; privateKey: ReturnType<typeof createPrivateKey> },
) {
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: options.kid }));
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), options.privateKey);
  return `${header}.${body}.${encodeBase64Url(signature)}`;
}

describe("createTokenResolver", () => {
  const originalFetch = globalThis.fetch;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const publicJwk = publicKey.export({ format: "jwk" });

  beforeAll(() => {
    if (!("kid" in publicJwk)) {
      Object.assign(publicJwk, { kid: "kid-1" });
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("resolves scoped mcp keys from KV and forwards credentials", async () => {
    const kv = createMockKV();
    await kv.put(
      "mcp_valid",
      JSON.stringify({
        service: "yt-mcp",
        created_by: "user@example.com",
        name: "Personal Key",
        credentials: { external_api_token: "secret-token" },
      }),
    );

    const resolveExternalToken = createTokenResolver<{ external_api_token: string }>("yt-mcp");
    const result = await resolveExternalToken({
      token: "mcp_valid",
      request: new Request("https://worker.example/mcp"),
      env: { MCP_KEYS: kv } as any,
    });

    expect(result).toEqual({
      props: {
        userId: "user@example.com",
        email: "user@example.com",
        name: "Personal Key",
        accessToken: "mcp_valid",
        credentials: { external_api_token: "secret-token" },
      },
    });
  });

  it("rejects mcp keys scoped to another service", async () => {
    const kv = createMockKV();
    await kv.put("mcp_other", JSON.stringify({ service: "portal" }));

    const resolveExternalToken = createTokenResolver("yt-mcp");
    const result = await resolveExternalToken({
      token: "mcp_other",
      request: new Request("https://worker.example/mcp"),
      env: { MCP_KEYS: kv } as any,
    });

    expect(result).toBeNull();
  });

  it("verifies a WorkOS JWT against the JWKS endpoint", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://api.workos.com/sso/jwks");
      return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "kid-1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const token = createJwt(
      {
        sub: "user_123",
        azp: "Cassandra Client",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      { kid: "kid-1", privateKey },
    );

    const resolveExternalToken = createTokenResolver("yt-mcp");
    const result = await resolveExternalToken({
      token,
      request: new Request("https://worker.example/mcp"),
      env: { MCP_KEYS: createMockKV() } as any,
    });

    expect(result).toEqual({
      props: {
        userId: "user_123",
        email: "user_123",
        name: "Cassandra Client",
        accessToken: token,
      },
    });
  });

  it("rejects expired WorkOS JWTs even when the signature is valid", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "kid-1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const token = createJwt(
      {
        sub: "user_123",
        exp: Math.floor(Date.now() / 1000) - 5,
      },
      { kid: "kid-1", privateKey },
    );

    const resolveExternalToken = createTokenResolver("yt-mcp");
    const result = await resolveExternalToken({
      token,
      request: new Request("https://worker.example/mcp"),
      env: { MCP_KEYS: createMockKV() } as any,
    });

    expect(result).toBeNull();
  });
});
