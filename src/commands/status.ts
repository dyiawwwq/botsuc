import { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { ensureGuild, getGuildConfig } from "../db/repositories/guildRepo.js";
import { listChannelConfigs } from "../db/repositories/channelConfigRepo.js";
import { countKnowledgeEntries } from "../db/repositories/knowledgeRepo.js";
import { listRecentFailures } from "../db/repositories/auditRepo.js";
import { isAuthorizedAdmin } from "../services/permissions.js";
import { PermissionError, toUserMessage } from "../util/errors.js";
import { env } from "../config/env.js";

const command = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Admin: show enabled features, data sources, and recent failures.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guildId = interaction.guildId!;
      ensureGuild(guildId, interaction.guild?.name);
      const config = getGuildConfig(guildId)!;

      if (!isAuthorizedAdmin(interaction, config)) {
        throw new PermissionError("You need Manage Server permission or a configured admin role to view /status.");
      }

      const channels = listChannelConfigs(guildId);
      const readable = channels.filter((c) => c.readEnabled).length;
      const indexable = channels.filter((c) => c.indexEnabled).length;
      const knowledgeCount = countKnowledgeEntries(guildId);
      const failures = listRecentFailures(guildId, 5);

      const embed = new EmbedBuilder()
        .setTitle(`Status — ${interaction.guild?.name ?? "this server"}`)
        .setColor(0x2ecc71)
        .addFields(
          { name: "Response mode", value: config.responseMode, inline: true },
          { name: "AI provider", value: config.aiEnabled ? config.aiProvider : "none (local keyword matching)", inline: true },
          { name: "Message content features", value: env.ENABLE_MESSAGE_CONTENT_FEATURES ? "enabled (operator)" : "disabled (operator)", inline: true },
          { name: "Knowledge entries", value: String(knowledgeCount), inline: true },
          { name: "Channels configured", value: `${channels.length} (${readable} readable, ${indexable} indexable)`, inline: true },
          { name: "Message analysis", value: config.messageAnalysisEnabled ? `on (${config.messageAnalysisChannels.length} channel(s))` : "off", inline: true },
          { name: "Retention window", value: `${config.retentionDays} day(s)`, inline: true },
          { name: "Summarize feature", value: config.summarizeEnabled ? "enabled" : "disabled", inline: true },
          { name: "Admin roles configured", value: String(config.adminRoleIds.length), inline: true },
          {
            name: "Recent failures",
            value:
              failures.length === 0
                ? "None recorded."
                : failures.map((f) => `• \`${f.action}\` — ${new Date(f.createdAt).toLocaleString()}`).join("\n"),
          },
          { name: "Last config change", value: config.updatedByUserId ? `<@${config.updatedByUserId}> — ${new Date(config.updatedAt).toLocaleString()}` : "No changes recorded yet" }
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: toUserMessage(err), ephemeral: true });
    }
  },
};

export default command;
