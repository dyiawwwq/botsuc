import pino from "pino";
import { env } from "../config/env.js";

/**
 * Structured logger. Secrets are redacted defensively even though nothing
 * in this codebase should ever log a token/API key directly.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "token",
      "apiKey",
      "*.token",
      "*.apiKey",
      "req.headers.authorization",
      "config.DISCORD_BOT_TOKEN",
      "config.ANTHROPIC_API_KEY",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
