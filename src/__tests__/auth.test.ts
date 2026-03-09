import { describe, it, expect, vi } from "vitest";
import { createTokenResolver } from "../auth.js";

// Mock KV namespace
function createMockKV(data: Record<string, any> = {}): KVNamespace {
  return {
    get: vi.fn(async (key: string, opts?: any) => {
      const val = data[key];
      if (!val) return null;
      if (opts === "json" || opts?.type === "json") return val;
      return JSON.stringify(val);
    }),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

function createMockEnv(kvData: Record<string, any> = {}) {
  return {
    MCP_KEYS: createMockKV(kvData),
    OAUTH_KV: createMockKV(),
    MCP_OBJECT: {} as any,
    WORKOS_CLIENT_ID: "test-client-id",
    WORKOS_CLIENT_SECRET: "test-client-secret",
    COOKIE_ENCRYPTION_KEY: "test-cookie-key",
    VM_PUSH_URL: "",
    VM_PUSH_CLIENT_ID: "",
    VM_PUSH_CLIENT_SECRET: "",
  };
}

describe("createTokenResolver", () => {
  describe("MCP API key path", () => {
    it("resolves a valid mcp_ key for the correct service", async () => {
      const resolve = createTokenResolver("pushover");
      const env = createMockEnv({
        mcp_abc123: {
          name: "test-key",
          service: "pushover",
          created_by: "user@example.com",
        },
      });

      const result = await resolve({
        token: "mcp_abc123",
        request: new Request("https://example.com"),
        env,
      });

      expect(result).not.toBeNull();
      expect(result!.props.userId).toBe("user@example.com");
      expect(result!.props.email).toBe("user@example.com");
      expect(result!.props.name).toBe("test-key");
      expect(result!.props.accessToken).toBe("mcp_abc123");
    });

    it("rejects mcp_ key for wrong service", async () => {
      const resolve = createTokenResolver("pushover");
      const env = createMockEnv({
        mcp_abc123: {
          name: "test-key",
          service: "yt-mcp",
          created_by: "user@example.com",
        },
      });

      const result = await resolve({
        token: "mcp_abc123",
        request: new Request("https://example.com"),
        env,
      });

      expect(result).toBeNull();
    });

    it("rejects unknown mcp_ key", async () => {
      const resolve = createTokenResolver("pushover");
      const env = createMockEnv({});

      const result = await resolve({
        token: "mcp_nonexistent",
        request: new Request("https://example.com"),
        env,
      });

      expect(result).toBeNull();
    });

    it("extracts credentials from key metadata", async () => {
      const resolve = createTokenResolver("pushover");
      const env = createMockEnv({
        mcp_withcreds: {
          name: "my-key",
          service: "pushover",
          created_by: "user@example.com",
          credentials: {
            pushover_user_key: "u123",
            pushover_api_token: "a456",
          },
        },
      });

      const result = await resolve({
        token: "mcp_withcreds",
        request: new Request("https://example.com"),
        env,
      });

      expect(result).not.toBeNull();
      expect(result!.props.credentials).toEqual({
        pushover_user_key: "u123",
        pushover_api_token: "a456",
      });
    });

    it("returns undefined credentials when key has none", async () => {
      const resolve = createTokenResolver("yt-mcp");
      const env = createMockEnv({
        mcp_nocreds: {
          name: "basic-key",
          service: "yt-mcp",
          created_by: "user@example.com",
        },
      });

      const result = await resolve({
        token: "mcp_nocreds",
        request: new Request("https://example.com"),
        env,
      });

      expect(result).not.toBeNull();
      expect(result!.props.credentials).toBeUndefined();
    });

    it("uses fallback values when key metadata is sparse", async () => {
      const resolve = createTokenResolver("pushover");
      const env = createMockEnv({
        mcp_sparse: {
          service: "pushover",
        },
      });

      const result = await resolve({
        token: "mcp_sparse",
        request: new Request("https://example.com"),
        env,
      });

      expect(result).not.toBeNull();
      expect(result!.props.userId).toBe("api-key");
      expect(result!.props.email).toBe("api-key@mcp");
      expect(result!.props.name).toBe("API Key");
    });
  });

  describe("WorkOS JWT path", () => {
    it("rejects malformed JWT tokens", async () => {
      const resolve = createTokenResolver("pushover");
      const env = createMockEnv();

      const result = await resolve({
        token: "not-a-jwt",
        request: new Request("https://example.com"),
        env,
      });

      expect(result).toBeNull();
    });

    it("rejects JWT with invalid base64 segments", async () => {
      const resolve = createTokenResolver("pushover");
      const env = createMockEnv();

      const result = await resolve({
        token: "invalid.base64.token",
        request: new Request("https://example.com"),
        env,
      });

      expect(result).toBeNull();
    });
  });
});
