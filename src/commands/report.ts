import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { createModerationReport } from "../db/repositories/communityInputRepo.js";
import { ensureGuild, getGuildConfig } from "../db/repositories/guildRepo.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";
import { buildSuggestedAction, postModAlert } from "../services/moderationSupport.js";
import { checkRateLimit } from "../services/rateLimiter.js";
import { env } from "../config/env.js";
import { toUserMessage } from "../util/errors.js";

// Added beyond the ten explicitly-numbered commands: Core Requirements calls
// for a "reports" moderation-support feature, and /feedback is scoped to
// bot-answer corrections rather than member conduct — see "Understanding
// and assumptions" in the accompanying response.
const command = {
  data: new SlashCommandBuilder()
    .setName("report")
    .setDescription("Report a message or behavior to the moderation team for human review.")
    .addStringOption((opt) => opt.setName("reason").setDescription("What happened?").setRequired(true).setMaxLength(1000))
    .addChannelOption((opt) => opt.setName("channel").setDescription("Where it happened, if relevant"))
    .addStringOption((opt) => opt.setName("message_id").setDescription("The message ID, if you have it").setMaxLength(32))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guildId = interaction.guildId!;
      const userId = interaction.user.id;
      checkRateLimit({ bucket: "report", guildId, userId, limit: 10, windowMs: env.RATE_LIMIT_WINDOW_MS });
      ensureGuild(guildId, interaction.guild?.name);
      const config = getGuildConfig(guildId)!;

      const reason = interaction.options.getString("reason", true);
      const channelId = interaction.options.getChannel("channel")?.id;
      const messageId = interaction.options.getString("message_id") ?? undefined;
      const suggestedAction = buildSuggestedAction(config);

      const report = createModerationReport({ guildId, reporterUserId: userId, reason, channelId, messageId, suggestedAction });

      recordAuditEvent({ guildId, actorUserId: userId, action: "report_filed", targetType: "moderation_report", targetId: report.id });

      const alertResult = await postModAlert(interaction.client, config, report);

      await interaction.reply({
        content:
          "Thanks — this has been sent to the moderation team for review. No action is taken automatically; a " +
          `human moderator decides what happens next.${alertResult.posted ? "" : " (No mod alert channel is configured yet, but your report was saved.)"}`,
        ephemeral: true,
      });
    } catch (err) {
      await interaction.reply({ content: toUserMessage(err), ephemeral: true });
    }
  },
};

export default command;
