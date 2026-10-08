import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve("."), "server-only": resolve("node_modules/server-only/empty.js") } },
  test: { environment: "node", include: ["docs/reviews/station-lifecycle/fixture.test.ts"], testTimeout: 120_000 },
});
