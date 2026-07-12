import { buildApp } from "./app.js";
import { config } from "./config.js";
import { closePools } from "./db/pool.js";
import { logger } from "./lib/logger.js";

const app = buildApp();
const server = app.listen(config.port, () => {
  logger.info(`YunoBall API up on :${config.port} (rule-based engine, Postgres)`);
});

// Graceful shutdown: stop accepting connections, drain the pools, then exit.
// Platforms (Render/Fly/containers) send SIGTERM on deploy; without this,
// in-flight requests are dropped and PG connections leak.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  const timer = setTimeout(() => {
    logger.error("shutdown timed out; forcing exit");
    process.exit(1);
  }, 10_000);
  timer.unref();
  server.close(async () => {
    try {
      await closePools();
    } catch (err) {
      logger.warn({ err }, "error closing pools during shutdown");
    }
    clearTimeout(timer);
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Last-resort handlers: log with structure and exit non-zero so the platform
// restarts cleanly rather than leaving a wedged process.
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  void shutdown("uncaughtException");
});
