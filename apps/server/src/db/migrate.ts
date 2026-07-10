/** Apply the warehouse schema (idempotent). Usage: pnpm --filter @yunoball/server db:migrate */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, closePools } from "./pool.js";
import { logger } from "../lib/logger.js";

export async function migrate(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ddl = readFileSync(path.join(here, "schema.sql"), "utf-8");
  await pool().query(ddl);
  logger.info("schema applied");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .catch((err) => {
      logger.error(err, "migration failed");
      process.exitCode = 1;
    })
    .finally(() => closePools());
}
