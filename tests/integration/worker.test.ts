import { afterEach, describe, expect, it, vi } from "vitest";

const mockProviderInstances: Array<{ fetch: ReturnType<typeof vi.fn>; options: any }> = [];
const mockPushMetrics = vi.fn();
const mockCounter = vi.fn((name: string, value: number, labels: Record<string, string>) => ({
  name,
  value,
  labels,
}));
const mockServe = vi.fn((path: string) => ({ type: "api-handler", path }));

vi.mock("@cloudflare/workers-oauth-provider", () => ({
  default: class MockOAuthProvider {
    options: any;
    fetch: ReturnType<typeof vi.fn>;

    constructor(options: any) {
      this.options = options;
      this.fetch = vi.fn(async () => new Response("ok", { status: 201 }));
      mockProviderInstances.push(this);
    }
  },
}));

vi.mock("agents/mcp", () => ({
  McpAgent: class MockMcpAgent {
    static serve = mockServe;
    env: unknown;
    props: unknown;
  },
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class MockMcpServer {
    constructor(public options: any) {}
  },
}));

vi.mock("cassandra-observability", () => ({
  pushMetrics: mockPushMetrics,
  counter: mockCounter,
}));

const { createMcpWorker } = await import("../../src/worker.js");

describe("createMcpWorker", () => {
  afterEach(() => {
    mockProviderInstances.length = 0;
    vi.clearAllMocks();
  });

  it("wires the OAuth provider routes and initializes tools through the generated agent class", async () => {
    const registerTools = vi.fn();
    const { McpAgentClass } = createMcpWorker({
      serviceId: "yt-mcp",
      name: "Cassandra YT MCP",
      version: "2.0.0",
      registerTools,
    });

    expect(mockServe).toHaveBeenCalledWith("/mcp");
    expect(mockProviderInstances).toHaveLength(1);
    expect(mockProviderInstances[0].options).toMatchObject({
      apiRoute: "/mcp",
      authorizeEndpoint: "/authorize",
      clientRegistrationEndpoint: "/register",
      tokenEndpoint: "/token",
    });
    expect(typeof mockProviderInstances[0].options.defaultHandler.fetch).toBe("function");
    expect(typeof mockProviderInstances[0].options.resolveExternalToken).toBe("function");

    const agent = new McpAgentClass();
    (agent as any).env = { TEST_ENV: true };
    (agent as any).props = { userId: "user_123" };

    await agent.init();

    expect(registerTools).toHaveBeenCalledTimes(1);
    expect(registerTools).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          name: "Cassandra YT MCP",
          version: "2.0.0",
        },
      }),
      { TEST_ENV: true },
      { userId: "user_123" },
    );
  });

  it("records normalized request metrics for provider fetches", async () => {
    const { default: worker } = createMcpWorker({
      serviceId: "yt-mcp",
      name: "Cassandra YT MCP",
      registerTools: vi.fn(),
    });
    const provider = mockProviderInstances[0];
    provider.fetch.mockResolvedValueOnce(new Response("accepted", { status: 202 }));

    const waitUntil = vi.fn();
    const response = await worker.fetch(
      new Request("https://worker.example/mcp/sse"),
      {
        VM_PUSH_URL: "https://vm.example",
        VM_PUSH_CLIENT_ID: "id",
        VM_PUSH_CLIENT_SECRET: "secret",
      } as any,
      { waitUntil, passThroughOnException: vi.fn() } as any,
    );

    expect(response.status).toBe(202);
    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];

    expect(mockCounter).toHaveBeenNthCalledWith(1, "mcp_requests_total", 1, {
      service: "yt-mcp",
      status: "202",
      path: "/mcp",
    });
    expect(mockCounter).toHaveBeenNthCalledWith(
      2,
      "mcp_request_duration_ms_total",
      expect.any(Number),
      {
        service: "yt-mcp",
        path: "/mcp",
      },
    );
    expect(mockPushMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        VM_PUSH_URL: "https://vm.example",
      }),
      [
        expect.objectContaining({ name: "mcp_requests_total" }),
        expect.objectContaining({ name: "mcp_request_duration_ms_total" }),
      ],
    );
  });
});
