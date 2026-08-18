import { REST, Routes } from "discord.js";
import { env } from "../config/env.js";
import { commands } from "../commands/index.js";
import { logger } from "../util/logger.js";

async function main() {
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

main().catch((err) => {
  logger.error({ err }, "Failed to register commands");
  process.exit(1);
});
