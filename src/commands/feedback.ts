import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { createFeedbackItem } from "../db/repositories/communityInputRepo.js";
import { ensureGuild, getGuildConfig } from "../db/repositories/guildRepo.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";
import { checkRateLimit } from "../services/rateLimiter.js";
import { env } from "../config/env.js";
import { toUserMessage } from "../util/errors.js";

const command = {
  data: new SlashCommandBuilder()
    .setName("feedback")
    .setDescription("Report an incorrect bot answer or suggest a knowledge update.")
    .addStringOption((opt) => opt.setName("comment").setDescription("What was wrong or what should be added/changed?").setRequired(true).setMaxLength(1000))
    .addStringOption((opt) => opt.setName("related_question").setDescription("The question you asked, if this is about a /ask or /rules answer").setMaxLength(300))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guildId = interaction.guildId!;
      const userId = interaction.user.id;
      checkRateLimit({ bucket: "feedback", guildId, userId, limit: 10, windowMs: env.RATE_LIMIT_WINDOW_MS });
      ensureGuild(guildId, interaction.guild?.name);
      const config = getGuildConfig(guildId)!;

      const comment = interaction.options.getString("comment", true);
      const relatedQuestion = interaction.options.getString("related_question") ?? undefined;

      const item = createFeedbackItem({ guildId, reporterUserId: userId, comment, relatedQuestion });

      recordAuditEvent({ guildId, actorUserId: userId, action: "feedback_submitted", targetType: "feedback_item", targetId: item.id });

      await interaction.reply({
        content: "Thanks — your feedback was recorded for an administrator to review. Use `/forget` any time to remove it.",
        ephemeral: true,
      });

      if (config.modAlertChannelId) {
        try {
          const channel = await interaction.client.channels.fetch(config.modAlertChannelId);
          if (channel?.isTextBased() && !channel.isDMBased()) {
            await channel.send({
              content:
                `📝 New feedback from <@${userId}>${relatedQuestion ? ` about: "${relatedQuestion}"` : ""}\n> ${comment}`,
            });
          }
        } catch {
          // Non-fatal: alert channel may be misconfigured; the feedback itself is already saved.
        }
      }
    } catch (err) {
      await interaction.reply({ content: toUserMessage(err), ephemeral: true });
    }
  },
};

export default command;
