import { describe, it, expect, vi } from "vitest";

// Mock Cloudflare-specific modules before importing worker
vi.mock("@cloudflare/workers-oauth-provider", () => ({
  default: class OAuthProvider {
    constructor() {}
    fetch() { return new Response(); }
  },
}));

vi.mock("agents/mcp", () => ({
  McpAgent: class McpAgent {
    env: any;
    props: any;
    server: any;
    static serve(path: string) { return () => {}; }
    async init() {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class McpServer {
    constructor(public config: any) {}
    registerTool() {}
  },
}));

vi.mock("cassandra-observability", () => ({
  pushMetrics: vi.fn(),
  counter: vi.fn(),
}));

vi.mock("hono", () => ({
  Hono: class Hono {
    get() {}
    post() {}
  },
}));

const { createMcpWorker } = await import("../worker.js");

describe("createMcpWorker", () => {
  it("returns default worker and McpAgentClass", () => {
    const result = createMcpWorker({
      serviceId: "test-service",
      name: "Test Service",
      registerTools: () => {},
    });

    expect(result).toHaveProperty("default");
    expect(result).toHaveProperty("McpAgentClass");
    expect(result.default).toHaveProperty("fetch");
    expect(typeof result.default.fetch).toBe("function");
  });

  it("McpAgentClass is a constructor", () => {
    const { McpAgentClass } = createMcpWorker({
      serviceId: "test-service",
      name: "Test Service",
      registerTools: () => {},
    });

    expect(typeof McpAgentClass).toBe("function");
    expect(McpAgentClass.prototype).toBeDefined();
  });

  it("creates independent instances for different services", () => {
    const result1 = createMcpWorker({
      serviceId: "service-a",
      name: "Service A",
      registerTools: () => {},
    });

    const result2 = createMcpWorker({
      serviceId: "service-b",
      name: "Service B",
      registerTools: () => {},
    });

    expect(result1.McpAgentClass).not.toBe(result2.McpAgentClass);
  });
});
