import { defineConfig } from "@playwright/test";

/**
 * E2E suite over the local stack: the Express API on :4000 (backed by the
 * Postgres warehouse — run `docker compose up -d`, `pnpm db:migrate` and an
 * ingest first) and the Next.js app on :3000. Locally, already-running dev
 * servers are reused; in CI both are booted here, the web app as a production
 * build.
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
      // The API caps a client IP at 30 searches a minute. A suite that runs
      // every search flow from one address blows past that and starts asking
      // assertions about a "too many requests" banner, so turn the limiter off
      // for the run — it is the limiter's own tests' job, not this suite's.
      env: { RATE_LIMIT_PER_MINUTE: "0", READ_RATE_LIMIT_PER_MINUTE: "0" },
    },
    {
      // CI serves the production build (the workflow builds it in the step
      // before this one): `next dev` compiles routes on first request, and
      // with parallel workers that first click can land before the page is
      // interactive — a flake that says nothing about the app. Serving the
      // build also tests the artifact users actually get. Locally an
      // already-running `pnpm dev` is reused instead.
      command: process.env.CI ? "pnpm start" : "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
