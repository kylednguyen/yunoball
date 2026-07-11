/** Express app assembly — exported separately from the listener for tests. */

import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { ApiError } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { routes } from "./routes/index.js";

export function buildApp(): express.Express {
  const app = express();
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "yunoball-api" });
  });

  app.use(routes);

  // Error shape matches the previous backend: {"detail": "..."}.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      if (err.headers) res.set(err.headers);
      res.status(err.status).json({ detail: err.detail });
      return;
    }
    logger.error({ err }, "unhandled error");
    res.status(500).json({ detail: "Internal server error." });
  });

  return app;
}
