import { env } from "../../config/env.js";
import type { GuildConfigRow } from "../../types/domain.js";
import { AnthropicProvider } from "./AnthropicProvider.js";
import { NullProvider } from "./NullProvider.js";
import type { AiProvider } from "./types.js";

const nullProvider = new NullProvider();
let anthropicProvider: AnthropicProvider | null = null;

/**
 * Resolves which provider to use for a given guild. An external provider is
 * only ever used when BOTH the guild admin has explicitly opted in
 * (ai_enabled + ai_provider) AND the operator configured a key in env. This
 * double gate means a single bot deployment can serve some guilds in
 * fully-local mode and others with AI answering, per-guild, without a code
 * change — and a guild can never be opted into external AI by anything
 * other than an authorized admin running /config.
 */
export function resolveAiProvider(guildConfig: GuildConfigRow | null): AiProvider {
  if (!guildConfig?.aiEnabled || guildConfig.aiProvider === "none") {
    return nullProvider;
  }

  if (guildConfig.aiProvider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) {
      return nullProvider; // admin opted in, but operator hasn't configured a key — fail safe, not silently
    }
    if (!anthropicProvider) {
      anthropicProvider = new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
    }
    return anthropicProvider;
  }

  return nullProvider;
}
