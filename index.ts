import { env } from "./config/env.js";
import { logger } from "./util/logger.js";
import { runMigrations } from "./db/migrate.js";
import { closeDb } from "./db/client.js";
import { buildDiscordClient } from "./discord/client.js";
import { routeInteraction } from "./discord/interactionRouter.js";
import { runRetentionSweep } from "./services/retention.js";
import { runMessageAnalysisSweep } from "./services/consentSummarizer.js";

const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
const MESSAGE_ANALYSIS_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

async function main() {
  runMigrations();

  const client = buildDiscordClient();

  client.once("ready", (c) => {
    logger.info({ tag: c.user.tag, guildCount: c.guilds.cache.size }, "Bot is online");
  });

  client.on("interactionCreate", (interaction) => {
    void routeInteraction(interaction);
  });

  client.on("error", (err) => {
    logger.error({ err: err.message }, "Discord client error");
  });

  client.on("guildCreate", (guild) => {
    logger.info({ guildId: guild.id, name: guild.name }, "Joined a new guild");
  });

  const retentionTimer = setInterval(() => {
    try {
      runRetentionSweep();
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : err }, "Retention sweep failed");
    }
  }, RETENTION_SWEEP_INTERVAL_MS);

  const analysisTimer = setInterval(() => {
    runMessageAnalysisSweep(client).catch((err) => {
      logger.error({ err: err instanceof Error ? err.message : err }, "Message-analysis sweep failed");
    });
  }, MESSAGE_ANALYSIS_INTERVAL_MS);

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down gracefully");
    clearInterval(retentionTimer);
    clearInterval(analysisTimer);
    client.destroy();
    closeDb();
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
  });

  await client.login(env.DISCORD_BOT_TOKEN);
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
