import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type TextChannel,
} from "discord.js";
import { ensureGuild, getGuildConfig } from "../db/repositories/guildRepo.js";
import { getChannelConfig } from "../db/repositories/channelConfigRepo.js";
import { createKnowledgeEntry } from "../db/repositories/knowledgeRepo.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";
import { isAuthorizedAdmin } from "../services/permissions.js";
import { resolveAiProvider } from "../services/aiProvider/resolveProvider.js";
import { checkRateLimit } from "../services/rateLimiter.js";
import { parseDurationToMs } from "../util/duration.js";
import { env } from "../config/env.js";
import { FeatureUnavailableError, PermissionError, toUserMessage } from "../util/errors.js";

const MAX_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MAX_MESSAGES = 300;

async function fetchRecentMessages(channel: TextChannel, cutoffTimestamp: number): Promise<Message[]> {
  const collected: Message[] = [];
  let before: string | undefined;

  while (collected.length < MAX_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    const arr = [...batch.values()];

    for (const m of arr) {
      if (m.createdTimestamp < cutoffTimestamp) return collected;
      collected.push(m);
      if (collected.length >= MAX_MESSAGES) break;
    }

    before = arr[arr.length - 1]?.id;
    if (arr.length < 100) break;
  }

  return collected;
}

const command = {
  data: new SlashCommandBuilder()
    .setName("summarize")
    .setDescription("Admin: summarize recent activity in a permitted channel.")
    .addChannelOption((o) => o.setName("channel").setDescription("Channel to summarize").setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addStringOption((o) => o.setName("since").setDescription('How far back, e.g. "24h" or "7d" (default 24h)').setMaxLength(10))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    try {
      checkRateLimit({ bucket: "summarize", guildId, userId: interaction.user.id, limit: 5, windowMs: env.RATE_LIMIT_WINDOW_MS });
      ensureGuild(guildId, interaction.guild?.name);
      const config = getGuildConfig(guildId)!;
      if (!isAuthorizedAdmin(interaction, config)) throw new PermissionError("You need Manage Server permission or a configured admin role to use /summarize.");

      if (!env.ENABLE_MESSAGE_CONTENT_FEATURES) {
        throw new FeatureUnavailableError(
          "Summarize needs the Message Content intent, which the bot operator hasn't enabled (ENABLE_MESSAGE_CONTENT_FEATURES=false)."
        );
      }
      if (!config.summarizeEnabled) {
        throw new FeatureUnavailableError("Summarize is disabled for this server. An admin can turn it back on.");
      }

      const channelOpt = interaction.options.getChannel("channel", true);
      const channelConfig = getChannelConfig(guildId, channelOpt.id);
      if (!channelConfig?.readEnabled) {
        throw new FeatureUnavailableError(`I'm not permitted to read <#${channelOpt.id}> yet. Enable it with \`/config channel channel:<#channel> read:true\`.`);
      }

      const sinceStr = interaction.options.getString("since") ?? "24h";
      const windowMs = parseDurationToMs(sinceStr, { maxMs: MAX_WINDOW_MS });

      await interaction.deferReply({ ephemeral: true });

      const channel = await interaction.client.channels.fetch(channelOpt.id);
      if (!channel || channel.type !== ChannelType.GuildText) {
        throw new FeatureUnavailableError("That channel is unavailable or not a standard text channel.");
      }

      const cutoff = Date.now() - windowMs;
      const messages = await fetchRecentMessages(channel as TextChannel, cutoff);
      const humanMessages = messages.filter((m) => !m.author.bot).map((m) => ({ authorId: m.author.id, content: m.content }));

      const provider = resolveAiProvider(config);
      const result = await provider.summarize({
        channelLabel: `#${(channel as TextChannel).name}`,
        windowLabel: sinceStr,
        messages: humanMessages,
      });

      const embed = new EmbedBuilder()
        .setTitle(`Summary — #${(channel as TextChannel).name} (${sinceStr})`)
        .setColor(0xe67e22)
        .setDescription(result.text)
        .setFooter({ text: `${result.messageCount} message(s) from ${result.participantCount} participant(s) • ${result.providerName === "anthropic" ? "AI-generated" : "local extractive"} • provisional until saved` });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`summarize:save:${channelOpt.id}:${encodeURIComponent(sinceStr)}`).setLabel("Save to knowledge base").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("summarize:discard").setLabel("Discard").setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });

      recordAuditEvent({
        guildId,
        actorUserId: interaction.user.id,
        action: "summarize_generated",
        targetType: "channel",
        targetId: channelOpt.id,
        metadata: { since: sinceStr, messageCount: result.messageCount, provider: result.providerName },
      });
    } catch (err) {
      const message = toUserMessage(err);
      if (interaction.deferred) await interaction.editReply({ content: message });
      else await interaction.reply({ content: message, ephemeral: true });
    }
  },

  async handleButton(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    try {
      const config = getGuildConfig(guildId)!;
      if (!isAuthorizedAdmin(interaction, config)) throw new PermissionError("You no longer have permission to confirm this action.");

      if (interaction.customId === "summarize:discard") {
        await interaction.update({ content: "Discarded — nothing was saved.", embeds: [], components: [] });
        return;
      }

      const [, , channelId, encodedSince] = interaction.customId.split(":");
      const since = decodeURIComponent(encodedSince ?? "recent");
      const summaryText = interaction.message.embeds[0]?.description;
      if (!summaryText) throw new FeatureUnavailableError("Couldn't recover the summary text — please run /summarize again.");

      const entry = createKnowledgeEntry(guildId, {
        type: "general",
        title: `Summary: <#${channelId}> (${since})`,
        content: summaryText,
        sourceChannelId: channelId,
        confidence: "derived_provisional",
        createdByUserId: interaction.user.id,
      });

      recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: "summarize_saved", targetType: "knowledge_entry", targetId: entry.id });
      await interaction.update({ content: `Saved as knowledge entry \`${entry.id}\`.`, embeds: interaction.message.embeds, components: [] });
    } catch (err) {
      await interaction.reply({ content: toUserMessage(err), ephemeral: true });
    }
  },
};

export default command;
