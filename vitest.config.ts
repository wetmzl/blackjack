import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tools/dialogue-admin/server.test.mjs"],
    environment: "node",
    coverage: { reporter: ["text"] }
  }
});
