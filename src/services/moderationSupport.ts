import { EmbedBuilder, type Client } from "discord.js";
import type { GuildConfigRow, KnowledgeEntryRow, ModerationReportRow } from "../types/domain.js";
import { logger } from "../util/logger.js";

/**
 * IMPORTANT: This module never takes an enforcement action itself (no kick,
 * ban, timeout, message deletion, or role change). It only formats reminder
 * text and suggested actions for a human moderator to review and carry out,
 * per the requirement that the bot must not "silently punish members or
 * make high-impact decisions without authorized human review." Wiring an
 * actual action would mean adding an explicit human-approval step (e.g. a
 * button click by an authorized moderator) before calling Discord's
 * moderation endpoints — intentionally left as a documented next step, see
 * README Limitations, rather than shipped half-safeguarded.
 */

export function buildRuleReminderText(rule: KnowledgeEntryRow): string {
  return `📌 Friendly reminder — **${rule.title}**\n${rule.content}`;
}

const INTENSITY_GUIDANCE: Record<GuildConfigRow["moderationIntensity"], string> = {
  lenient: "a friendly reminder or a private note from a moderator",
  standard: "a formal warning, escalating only on repeat reports",
  strict: "prompt moderator review, since this server prefers stricter enforcement",
};

/**
 * Purely advisory text shown to moderators alongside a report — never
 * auto-applied. Uses the guild's configured moderation intensity, warning
 * threshold, and enforcement style, not any judgment about the reporting or
 * reported member as people.
 */
export function buildSuggestedAction(config: GuildConfigRow): string {
  return (
    `Based on this server's settings (intensity: ${config.moderationIntensity}, ` +
    `enforcement style: ${config.enforcementStyle}, warning threshold: ${config.warningThreshold}), ` +
    `a typical next step would be ${INTENSITY_GUIDANCE[config.moderationIntensity]}. ` +
    `A human moderator should review the report before taking any action.`
  );
}

export async function postModAlert(
  client: Client,
  config: GuildConfigRow,
  report: ModerationReportRow
): Promise<{ posted: boolean; reason?: string }> {
  if (!config.modAlertChannelId) {
    return { posted: false, reason: "no mod alert channel configured" };
  }

  try {
    const channel = await client.channels.fetch(config.modAlertChannelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      return { posted: false, reason: "configured alert channel is missing or not a guild text channel" };
    }

    const embed = new EmbedBuilder()
      .setTitle("New moderation report")
      .setDescription(report.reason)
      .addFields(
        { name: "Reported by", value: `<@${report.reporterUserId}>`, inline: true },
        { name: "Channel", value: report.channelId ? `<#${report.channelId}>` : "Not specified", inline: true },
        { name: "Suggested next step", value: buildSuggestedAction(config) }
      )
      .setFooter({ text: "This is a suggestion for human review only — no action has been taken automatically." })
      .setColor(0xf5a623)
      .setTimestamp(new Date(report.createdAt));

    await channel.send({ embeds: [embed] });
    return { posted: true };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, guildId: config.guildId }, "Failed to post mod alert");
    return { posted: false, reason: "failed to send (missing access or channel unavailable)" };
  }
}
