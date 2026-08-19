import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { ensureGuild, getGuildConfig } from "../db/repositories/guildRepo.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";

const command = {
  data: new SlashCommandBuilder()
    .setName("privacy")
    .setDescription("Explains what this bot processes, stores, and how to control or delete your data.")
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    ensureGuild(guildId, interaction.guild?.name);
    const config = getGuildConfig(guildId)!;

    const aiLine =
      config.aiEnabled && config.aiProvider !== "none"
        ? `Enabled — your **/ask** questions and matching approved-knowledge excerpts are sent to ${config.aiProvider} to generate an answer. Nothing else (no message history, no member list, no profile data) is sent.`
        : "Disabled — questions are answered locally by keyword matching against approved knowledge. Nothing is sent to an external AI provider.";

    const analysisLine = config.messageAnalysisEnabled
      ? `Enabled for ${config.messageAnalysisChannels.length} channel(s) — recent messages there are aggregated into anonymous keyword/volume patterns (no per-member profiles, no message content is stored verbatim).`
      : "Disabled — the bot does not analyze ordinary conversation by default.";

    const embed = new EmbedBuilder()
      .setTitle("Privacy & data handling")
      .setColor(0x5865f2)
      .setDescription(
        "This bot only uses data an administrator explicitly configured or that you send it directly " +
          "(like a question or feedback). It does not read DMs, and only reads channel messages where a " +
          "feature that needs that has been turned on for that specific channel."
      )
      .addFields(
        { name: "External AI provider", value: aiLine },
        { name: "Message analysis (opt-in)", value: analysisLine },
        { name: "Conversation memory", value: `Short-lived follow-up context, kept for ${config.retentionDays} day(s), then automatically deleted.` },
        { name: "What's never collected", value: "Passwords, tokens, precise location, health info, political opinions, or other sensitive/protected data." },
        { name: "Your controls", value: "`/forget` deletes your own conversation memory and feedback in this server. Ask an administrator for a full export or deletion of server knowledge (`/knowledge export`)." }
      )
      .setFooter({ text: "Server administrators control which channels and features are enabled — see /status for what's on right now." });

    await interaction.reply({ embeds: [embed], ephemeral: true });

    recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: "privacy_viewed" });
  },
};

export default command;
