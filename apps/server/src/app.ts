/** Express app assembly — exported separately from the listener for tests. */

import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { q } from "./db/pool.js";
import { ApiError } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { routes } from "./routes/index.js";

export function buildApp(): express.Express {
  const app = express();
  // Behind a platform load balancer (Render/Fly), so req.ip reflects the real
  // client from X-Forwarded-For instead of the proxy — see lib/rateLimit.ts.
  app.set("trust proxy", config.trustProxy);
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: "32kb" }));

  // Lightweight request logging: method, path, status — no bodies. ponytail: on 'finish', no pino-http dep.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.on("finish", () => {
      logger.info({ method: req.method, path: req.path, status: res.statusCode }, "request");
    });
    next();
  });

  // Liveness: the process is up.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "yunoball-api" });
  });

  // Readiness: the process can reach Postgres. Render's health check should
  // point here so a DB outage marks the instance unhealthy instead of serving
  // errors behind a green check.
  app.get("/ready", async (_req, res) => {
    try {
      await q("SELECT 1");
      res.json({ ok: true, service: "yunoball-api", db: "up" });
    } catch (err) {
      logger.warn({ err }, "readiness check failed");
      res.status(503).json({ ok: false, service: "yunoball-api", db: "down" });
    }
  });

  app.use(routes);

  // Error shape matches the previous backend: {"detail": "..."}.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      if (err.headers) res.set(err.headers);
      res.status(err.status).json({ detail: err.detail });
      return;
    }
    logger.error(
      { err, method: req.method, url: req.originalUrl, ip: req.ip, status: 500 },
      "unhandled error",
    );
    res.status(500).json({ detail: "Internal server error." });
  });

  return app;
}
