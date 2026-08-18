import { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { ensureGuild, getGuildConfig } from "../db/repositories/guildRepo.js";
import { listRecentAuditEvents } from "../db/repositories/auditRepo.js";
import { isAuthorizedAdmin } from "../services/permissions.js";
import { PermissionError, toUserMessage } from "../util/errors.js";

const command = {
  data: new SlashCommandBuilder()
    .setName("audit")
    .setDescription("Admin: view recent configuration changes and notable bot actions.")
    .addIntegerOption((opt) =>
      opt.setName("count").setDescription("How many recent events to show (default 15, max 25)").setMinValue(1).setMaxValue(25)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guildId = interaction.guildId!;
      ensureGuild(guildId, interaction.guild?.name);
      const config = getGuildConfig(guildId)!;

      if (!isAuthorizedAdmin(interaction, config)) {
        throw new PermissionError("You need Manage Server permission or a configured admin role to view /audit.");
      }

      const count = interaction.options.getInteger("count") ?? 15;
      const events = listRecentAuditEvents(guildId, count);

      if (events.length === 0) {
        await interaction.reply({ content: "No audit events recorded yet.", ephemeral: true });
        return;
      }

      const lines = events.map((e) => {
        const status = e.success ? "✅" : "❌";
        const actor = e.actorUserId.startsWith("system:") ? `_${e.actorUserId}_` : `<@${e.actorUserId}>`;
        const target = e.targetType ? ` (${e.targetType}${e.targetId ? `: ${e.targetId}` : ""})` : "";
        return `${status} \`${e.action}\`${target} — ${actor} — <t:${Math.floor(new Date(e.createdAt).getTime() / 1000)}:R>`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`Audit log — last ${events.length} event(s)`)
        .setColor(0x95a5a6)
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Metadata (e.g. what field changed) is never logged with message content or secrets." });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: toUserMessage(err), ephemeral: true });
    }
  },
};

export default command;
