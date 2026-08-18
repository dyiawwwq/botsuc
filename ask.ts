import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { ensureGuild, getGuildConfig } from "../db/repositories/guildRepo.js";
import { saveConversationContext } from "../db/repositories/conversationRepo.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";
import { answerQuestion } from "../services/answering.js";
import { retentionDaysToTtlMs } from "../services/retention.js";
import { checkRateLimit } from "../services/rateLimiter.js";
import { env } from "../config/env.js";
import { toUserMessage } from "../util/errors.js";

const command = {
  data: new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask a question about this server's approved knowledge, rules, channels, or events.")
    .addStringOption((opt) => opt.setName("question").setDescription("What do you want to know?").setRequired(true).setMaxLength(500))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guildId = interaction.guildId!;
      const userId = interaction.user.id;
      checkRateLimit({ bucket: "ask", guildId, userId, limit: 15, windowMs: env.RATE_LIMIT_WINDOW_MS });

      ensureGuild(guildId, interaction.guild?.name);
      const config = getGuildConfig(guildId)!;
      const question = interaction.options.getString("question", true);

      await interaction.deferReply({ ephemeral: config.responseMode === "private_only" });

      const result = await answerQuestion({
        guildId,
        question,
        config,
        serverName: interaction.guild?.name ?? config.serverName,
      });

      await interaction.editReply({ content: result.replyText });

      saveConversationContext({
        guildId,
        channelId: interaction.channelId,
        userId,
        summaryText: `Asked: "${question.slice(0, 200)}" -> ${result.outcome}`,
        ttlMs: retentionDaysToTtlMs(config.retentionDays),
      });

      recordAuditEvent({
        guildId,
        actorUserId: userId,
        action: "ask_answered",
        metadata: {
          outcome: result.outcome,
          matchedCount: result.matchedEntryIds.length,
          possibleInjectionFlagged: result.possibleInjectionFlagged,
        },
      });
    } catch (err) {
      const message = toUserMessage(err);
      if (interaction.deferred) {
        await interaction.editReply({ content: message });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  },
};

export default command;
