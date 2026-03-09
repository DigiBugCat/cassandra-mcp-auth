import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkOSHandler } from "../../src/workos-handler.js";
import { createMockKV } from "../helpers/kv.js";

interface TestEnv {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: {
    parseAuthRequest: ReturnType<typeof vi.fn>;
    completeAuthorization: ReturnType<typeof vi.fn>;
  };
  WORKOS_CLIENT_ID: string;
  WORKOS_CLIENT_SECRET: string;
}

function createExecutionContext() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function createEnv() {
  return {
    OAUTH_KV: createMockKV(),
    OAUTH_PROVIDER: {
      parseAuthRequest: vi.fn(async () => ({
        clientId: "client-1",
        redirectUri: "https://client.example/callback",
        scope: "read write",
      })),
      completeAuthorization: vi.fn(async () => ({
        redirectTo: "https://client.example/callback?code=worker-token",
      })),
    },
    WORKOS_CLIENT_ID: "workos-client",
    WORKOS_CLIENT_SECRET: "workos-secret",
  } satisfies TestEnv;
}

describe("createWorkOSHandler", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("starts authorization by storing state, binding the session, and redirecting to WorkOS", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("state-123");
    const env = createEnv();
    const app = createWorkOSHandler<TestEnv>();

    const response = await app.fetch(
      new Request("https://worker.example/authorize"),
      env as any,
      createExecutionContext(),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Set-Cookie")).toContain("__Host-CONSENTED_STATE=");
    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.origin + redirect.pathname).toBe(
      "https://api.workos.com/user_management/authorize",
    );
    expect(redirect.searchParams.get("client_id")).toBe("workos-client");
    expect(redirect.searchParams.get("redirect_uri")).toBe("https://worker.example/callback");
    expect(redirect.searchParams.get("state")).toBe("state-123");
    await expect(env.OAUTH_KV.get("oauth:state:state-123")).resolves.toBeTruthy();
  });

  it("completes the callback flow and clears the bound session cookie", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("state-456");
    const env = createEnv();
    const app = createWorkOSHandler<TestEnv>();

    const authorizeResponse = await app.fetch(
      new Request("https://worker.example/authorize"),
      env as any,
      createExecutionContext(),
    );
    const cookie = authorizeResponse.headers.get("Set-Cookie")!;
    const state = new URL(authorizeResponse.headers.get("location")!).searchParams.get("state");

    globalThis.fetch = vi.fn(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        code: "code-123",
        redirect_uri: "https://worker.example/callback",
      });
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          user: {
            id: "user_123",
            email: "user@example.com",
            first_name: "Cass",
            last_name: "Andra",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;

    const response = await app.fetch(
      new Request(`https://worker.example/callback?state=${state}&code=code-123`, {
        headers: { Cookie: cookie.split(";")[0] },
      }),
      env as any,
      createExecutionContext(),
    );

    expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledWith({
      request: {
        clientId: "client-1",
        redirectUri: "https://client.example/callback",
        scope: "read write",
      },
      userId: "user_123",
      scope: "read write",
      metadata: { label: "Cass Andra" },
      props: {
        userId: "user_123",
        email: "user@example.com",
        name: "Cass Andra",
        accessToken: "access-token",
      },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://client.example/callback?code=worker-token",
    );
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
