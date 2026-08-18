import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { ensureGuild, getGuildConfig } from "../db/repositories/guildRepo.js";
import { listActiveKnowledgeForRetrieval } from "../db/repositories/knowledgeRepo.js";
import { saveConversationContext } from "../db/repositories/conversationRepo.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";
import { answerQuestion } from "../services/answering.js";
import { retentionDaysToTtlMs } from "../services/retention.js";
import { checkRateLimit } from "../services/rateLimiter.js";
import { env } from "../config/env.js";
import { toUserMessage } from "../util/errors.js";

const command = {
  data: new SlashCommandBuilder()
    .setName("rules")
    .setDescription("Show this server's rules, or ask a rule-related question.")
    .addStringOption((opt) => opt.setName("question").setDescription("Optional: ask about a specific rule instead of listing all of them").setMaxLength(500))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guildId = interaction.guildId!;
      const userId = interaction.user.id;
      checkRateLimit({ bucket: "rules", guildId, userId, limit: 15, windowMs: env.RATE_LIMIT_WINDOW_MS });

      ensureGuild(guildId, interaction.guild?.name);
      const config = getGuildConfig(guildId)!;
      const question = interaction.options.getString("question");
      const ephemeral = config.responseMode === "private_only";

      if (!question) {
        const rules = listActiveKnowledgeForRetrieval(guildId, ["rule", "policy"]);
        if (rules.length === 0) {
          await interaction.reply({
            content: "No rules have been documented yet. Ask an administrator to add some with `/knowledge add`.",
            ephemeral: true,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle(`Rules — ${interaction.guild?.name ?? "this server"}`)
          .setColor(0x3498db)
          .setDescription(
            rules
              .slice(0, 20)
              .map((r) => `**${r.title}**\n${r.content}`)
              .join("\n\n")
          );
        await interaction.reply({ embeds: [embed], ephemeral });
        recordAuditEvent({ guildId, actorUserId: userId, action: "rules_listed" });
        return;
      }

      await interaction.deferReply({ ephemeral });
      const result = await answerQuestion({
        guildId,
        question,
        config,
        serverName: interaction.guild?.name ?? config.serverName,
        typeFilter: ["rule", "policy"],
      });
      await interaction.editReply({ content: result.replyText });

      saveConversationContext({
        guildId,
        channelId: interaction.channelId,
        userId,
        summaryText: `Asked about rules: "${question.slice(0, 200)}" -> ${result.outcome}`,
        ttlMs: retentionDaysToTtlMs(config.retentionDays),
      });
      recordAuditEvent({
        guildId,
        actorUserId: userId,
        action: "rules_question_answered",
        metadata: { outcome: result.outcome, possibleInjectionFlagged: result.possibleInjectionFlagged },
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
