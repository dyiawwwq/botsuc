import { REST, Routes } from "discord.js";
import { env } from "../config/env.js";
import { commands } from "../commands/index.js";
import { logger } from "../util/logger.js";

/**
 * Registers (overwrites) the bot's slash commands with Discord's API.
 *
 * Exported so it can be called two ways:
 *  1. As a one-off script: `npm run deploy-commands` (calls main() below).
 *  2. Automatically on every process start, from src/index.ts — this is
 *     what makes commands show up on Discord without needing a separate
 *     manual step or a Render dashboard field (e.g. Pre-Deploy Command)
 *     that may not be available on every plan/service type.
 *
 * Safe to call on every boot: this is a full overwrite (PUT), not an
 * incremental create, so re-running it with an unchanged command list is a
 * no-op from Discord's point of view.
 */
export async function registerCommands(): Promise<void> {
  const body = [...commands.values()].map((c) => c.data.toJSON());
  const rest = new REST().setToken(env.DISCORD_BOT_TOKEN);

  if (env.DISCORD_DEV_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_DEV_GUILD_ID), { body });
    logger.info({ guildId: env.DISCORD_DEV_GUILD_ID, count: body.length }, "Registered guild-scoped commands (instant)");
  } else {
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
    logger.info({ count: body.length }, "Registered global commands (may take up to ~1 hour to propagate)");
  }
}

// Only runs when this file is executed directly (`npm run deploy-commands`),
// not when it's imported by src/index.ts.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  registerCommands().catch((err) => {
    logger.error({ err }, "Failed to register commands");
    process.exit(1);
  });
}
