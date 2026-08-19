import "dotenv/config";
import { z } from "zod";

/**
 * All configuration the process needs comes from environment variables.
 * Nothing here is a per-guild setting — those live in guild_config (see
 * db/schema.sql) and are managed at runtime via /setup and /config.
 *
 * Secrets (bot token, AI provider key) are only ever read from process.env.
 * They are never logged, never written to the database, and never echoed
 * back in any command response.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  // Optional: when set, slash commands are registered guild-scoped (instant)
  // for that guild only, which is convenient during development. When unset,
  // commands are registered globally (can take up to ~1 hour to propagate).
  DISCORD_DEV_GUILD_ID: z.string().optional(),

  // Must be "true" only after the "Message Content Intent" has been enabled
  // for this application in the Discord Developer Portal. Gates /summarize
  // and the opt-in message-analysis feature. Everything else in the bot
  // (setup, config, knowledge, /ask, /rules, /privacy, /forget, /status,
  // /audit, /feedback, /report) works with zero privileged intents.
  ENABLE_MESSAGE_CONTENT_FEATURES: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),

  DATABASE_FILE: z.string().default("./data/bot.sqlite3"),

  // AI provider. Leave ANTHROPIC_API_KEY unset to run in NullProvider mode:
  // fully local keyword matching, no question or knowledge text ever leaves
  // the host running the bot. This is also the automatic fallback if the
  // provider errors at runtime.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),

  // In-memory rate limiting is per-process. See services/rateLimiter.ts and
  // Limitations in README.md for horizontal-scaling notes.
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    // Intentionally thrown (not logged via pino) so it's visible even if
    // logger setup itself depends on env in the future.
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }
  return parsed.data;
}

export const env = loadEnv();
