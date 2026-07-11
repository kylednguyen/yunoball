import { defineConfig } from "@playwright/test";

/**
 * E2E suite over the local stack: the Express API on :4000 (backed by the
 * Postgres warehouse — run `docker compose up -d`, `pnpm db:migrate` and an
 * ingest first) and the Next.js app on :3000. Locally, already-running dev
 * servers are reused; in CI both are booted here.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
  webServer: [
    {
      command: "pnpm start",
      cwd: "../server",
      url: "http://localhost:4000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
