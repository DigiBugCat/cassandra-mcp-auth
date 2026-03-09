import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {
      // Mock cloudflare:workers protocol for Node.js test environment
      "cloudflare:workers": new URL("./src/__tests__/__mocks__/cloudflare-workers.ts", import.meta.url).pathname,
    },
  },
});
