import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { deleteConversationContextForUser, countConversationContextForUser } from "../db/repositories/conversationRepo.js";
import { deleteFeedbackForUser, deleteReportsFiledByUser } from "../db/repositories/communityInputRepo.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";
import { ensureGuild } from "../db/repositories/guildRepo.js";
import { checkRateLimit } from "../services/rateLimiter.js";
import { env } from "../config/env.js";
import { toUserMessage } from "../util/errors.js";

const command = {
  data: new SlashCommandBuilder()
    .setName("forget")
    .setDescription("Delete your own stored conversation memory and feedback in this server.")
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    try {
      checkRateLimit({ bucket: "forget", guildId, userId, limit: 5, windowMs: env.RATE_LIMIT_WINDOW_MS });
      ensureGuild(guildId, interaction.guild?.name);

      const before = countConversationContextForUser(guildId, userId);
      const deletedConversations = deleteConversationContextForUser(guildId, userId);
      const deletedFeedback = deleteFeedbackForUser(guildId, userId);
      const deletedReportsFiled = deleteReportsFiledByUser(guildId, userId);

      recordAuditEvent({
        guildId,
        actorUserId: userId,
        action: "forget_requested",
        metadata: { deletedConversations, deletedFeedback, deletedReportsFiled, hadAnyData: before > 0 },
      });

      await interaction.reply({
        content:
          `Done. Deleted ${deletedConversations} conversation memory item(s), ${deletedFeedback} feedback item(s), ` +
          `and ${deletedReportsFiled} report(s) you filed.\n\n` +
          `Note: reports **about** you filed by someone else are kept as moderation records for community-safety ` +
          `purposes and aren't self-service-deletable — an administrator can review those on request. See /privacy for details.`,
        ephemeral: true,
      });
    } catch (err) {
      await interaction.reply({ content: toUserMessage(err), ephemeral: true });
    }
  },
};

export default command;
