import type { Client, TextChannel } from "discord.js";
import { env } from "../config/env.js";
import { listGuildsWithMessageAnalysisEnabled } from "../db/repositories/guildRepo.js";
import { createKnowledgeEntry, findDerivedPatternEntry, updateKnowledgeEntry } from "../db/repositories/knowledgeRepo.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";
import { logger } from "../util/logger.js";

/**
 * This entire module is inert unless a guild admin has explicitly enabled
 * `message_analysis_enabled` via /config AND listed specific channels in
 * `message_analysis_channels` (Core Requirements: "require an explicit
 * administrator opt-in, define allowed channels and retention, use
 * aggregation and redaction... Never use conversation history to make
 * sensitive judgments about individual members"). It never stores per-member
 * profiles — only aggregate counts and keyword frequencies, and the
 * `participantCount` is a count, not a list of who participated.
 */

const STOPWORDS = new Set([
  "the","and","for","that","this","with","have","from","your","you","are","was","were","but","not",
  "just","like","get","got","can","will","would","about","what","when","where","how","why","who",
  "yeah","okay","lol","its","it's","im","i'm","dont","don't","also","really","think","know","one",
]);

function extractTokens(text: string): string[] {
  return text.toLowerCase().normalize("NFKC").match(/[a-z0-9']{3,}/g) ?? [];
}

/** Strips mentions, channel refs, links, and long numeric IDs before any keyword counting, so nothing identifying survives into aggregate output. */
function redact(content: string): string {
  return content
    .replace(/<@!?\d+>/g, " ")
    .replace(/<#\d+>/g, " ")
    .replace(/<@&\d+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b\d{6,}\b/g, " ");
}

export interface AggregatePatternResult {
  topKeywords: { term: string; count: number }[];
  messageVolume: number;
  participantCount: number;
  windowLabel: string;
}

export function computeAggregatePatterns(
  messages: { content: string; authorId: string }[],
  windowLabel: string
): AggregatePatternResult {
  const freq = new Map<string, number>();
  const participants = new Set<string>();

  for (const m of messages) {
    participants.add(m.authorId);
    for (const tok of extractTokens(redact(m.content))) {
      if (STOPWORDS.has(tok)) continue;
      freq.set(tok, (freq.get(tok) ?? 0) + 1);
    }
  }

  const topKeywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([term, count]) => ({ term, count }));

  return { topKeywords, messageVolume: messages.length, participantCount: participants.size, windowLabel };
}

export function renderAggregatePatternSummary(result: AggregatePatternResult, channelLabel: string): string {
  if (result.messageVolume === 0) {
    return `No messages observed in ${channelLabel} during ${result.windowLabel}.`;
  }
  const keywordList = result.topKeywords.map((k) => k.term).join(", ") || "(no recurring terms found)";
  return (
    `Over ${result.windowLabel} in ${channelLabel}: roughly ${result.messageVolume} messages from ` +
    `${result.participantCount} distinct participants. Recurring terms: ${keywordList}. ` +
    `This is an automatically-generated aggregate pattern — it does not describe, profile, or judge any individual member.`
  );
}

const ANALYSIS_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Orchestration: for every guild that opted in, for every allowed channel,
 * fetch the last day of messages (requires the Message Content intent —
 * silently skipped per-guild if that intent isn't enabled, since the
 * feature already checks this before ai/message features activate) and
 * upsert one derived_pattern knowledge entry per channel. Intended to be
 * called on an interval from index.ts, same pattern as the retention sweep.
 */
export async function runMessageAnalysisSweep(client: Client): Promise<void> {
  if (!env.ENABLE_MESSAGE_CONTENT_FEATURES) return;

  const guildConfigs = listGuildsWithMessageAnalysisEnabled();
  for (const config of guildConfigs) {
    for (const channelId of config.messageAnalysisChannels) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased() || channel.isDMBased()) continue;

        const after = Date.now() - ANALYSIS_WINDOW_MS;
        const fetched = await (channel as TextChannel).messages.fetch({ limit: 100 });
        const recent = [...fetched.values()]
          .filter((m) => m.createdTimestamp >= after && !m.author.bot)
          .map((m) => ({ content: m.content, authorId: m.author.id }));

        const pattern = computeAggregatePatterns(recent, "the last 24 hours");
        const summaryText = renderAggregatePatternSummary(pattern, `<#${channelId}>`);
        const title = `Community activity patterns — <#${channelId}>`;

        const existing = findDerivedPatternEntry(config.guildId, channelId);
        if (existing) {
          updateKnowledgeEntry(config.guildId, existing.id, { content: summaryText });
        } else {
          createKnowledgeEntry(config.guildId, {
            type: "derived_pattern",
            title,
            content: summaryText,
            sourceChannelId: channelId,
            confidence: "derived_provisional",
            createdByUserId: "system:message-analysis",
          });
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : err, guildId: config.guildId, channelId },
          "Message-analysis sweep failed for channel"
        );
        recordAuditEvent({
          guildId: config.guildId,
          actorUserId: "system:message-analysis",
          action: "message_analysis_sweep",
          targetId: channelId,
          success: false,
        });
      }
    }
  }
}
