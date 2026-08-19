import { Client, GatewayIntentBits, Partials } from "discord.js";
import { env } from "../config/env.js";

/**
 * Intent minimization: `Guilds` (non-privileged) is always requested — it's
 * enough for slash commands, buttons, modals, and basic channel/guild
 * metadata, which covers setup, config, knowledge, rules, ask, privacy,
 * forget, status, audit, feedback, and report.
 *
 * `GuildMessages` + the privileged `MessageContent` intent are only added
 * when ENABLE_MESSAGE_CONTENT_FEATURES=true, and even then /summarize and
 * message-analysis additionally re-check per-guild + per-channel config
 * before fetching any message content. If you flip this on, you must also
 * enable "Message Content Intent" for this application in the Discord
 * Developer Portal (Bot tab), and — once the bot is in 100+ servers —
 * Discord requires this be approved via bot verification.
 */
export function buildDiscordClient(): Client {
  const intents = [GatewayIntentBits.Guilds];

  if (env.ENABLE_MESSAGE_CONTENT_FEATURES) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  }

  return new Client({
    intents,
    partials: [Partials.Channel],
  });
}
