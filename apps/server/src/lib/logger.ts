/** Structured (JSON) logging; pretty-printed when running in a TTY. */

import pino from "pino";
import { config } from "../config.js";

export const logger = pino({
  level: config.logLevel,
  transport: process.stdout.isTTY
    ? { target: "pino-pretty", options: { colorize: true, ignore: "pid,hostname" } }
    : undefined,
});
