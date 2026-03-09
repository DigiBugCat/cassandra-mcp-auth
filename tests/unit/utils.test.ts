import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWorkOSAuthToken, getUpstreamAuthorizeUrl } from "../../src/utils.js";

describe("WorkOS helpers", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("builds the upstream authorize URL with the expected authkit parameters", () => {
    const url = new URL(
      getUpstreamAuthorizeUrl({
        upstream_url: "https://api.workos.com/user_management/authorize",
        client_id: "client-1",
        redirect_uri: "https://worker.example/callback",
        state: "state-123",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://api.workos.com/user_management/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://worker.example/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("provider")).toBe("authkit");
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("posts code exchange requests with redirect_uri and returns the normalized user record", async () => {
    globalThis.fetch = vi.fn(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({
        client_id: "client-1",
        client_secret: "secret-1",
        code: "code-123",
        grant_type: "authorization_code",
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

    const [result, error] = await fetchWorkOSAuthToken({
      client_id: "client-1",
      client_secret: "secret-1",
      code: "code-123",
      redirect_uri: "https://worker.example/callback",
    });

    expect(error).toBeNull();
    expect(result).toEqual({
      accessToken: "access-token",
      userId: "user_123",
      email: "user@example.com",
      name: "Cass Andra",
    });
  });

  it("returns a 400 response when the callback is missing an authorization code", async () => {
    const [result, error] = await fetchWorkOSAuthToken({
      client_id: "client-1",
      client_secret: "secret-1",
      code: undefined,
    });

    expect(result).toBeNull();
    expect(error?.status).toBe(400);
    await expect(error?.text()).resolves.toBe("Missing code");
  });
});
