import { randomUUID } from "node:crypto";
import { getDb } from "../client.js";
import type { FeedbackItemRow, ModerationReportRow } from "../../types/domain.js";

interface FeedbackDbRow {
  id: string;
  guild_id: string;
  reporter_user_id: string;
  related_question: string | null;
  related_answer: string | null;
  comment: string;
  status: string;
  created_at: string;
}

function feedbackFromDbRow(row: FeedbackDbRow): FeedbackItemRow {
  return {
    id: row.id,
    guildId: row.guild_id,
    reporterUserId: row.reporter_user_id,
    relatedQuestion: row.related_question,
    relatedAnswer: row.related_answer,
    comment: row.comment,
    status: row.status as FeedbackItemRow["status"],
    createdAt: row.created_at,
  };
}

export function createFeedbackItem(params: {
  guildId: string;
  reporterUserId: string;
  comment: string;
  relatedQuestion?: string;
  relatedAnswer?: string;
}): FeedbackItemRow {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO feedback_items (id, guild_id, reporter_user_id, related_question, related_answer, comment)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, params.guildId, params.reporterUserId, params.relatedQuestion ?? null, params.relatedAnswer ?? null, params.comment);
  const row = db.prepare(`SELECT * FROM feedback_items WHERE id = ?`).get(id) as FeedbackDbRow;
  return feedbackFromDbRow(row);
}

export function listOpenFeedback(guildId: string, limit = 20): FeedbackItemRow[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM feedback_items WHERE guild_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT ?`)
    .all(guildId, limit) as FeedbackDbRow[];
  return rows.map(feedbackFromDbRow);
}

export function deleteFeedbackForUser(guildId: string, userId: string): number {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM feedback_items WHERE guild_id = ? AND reporter_user_id = ?`)
    .run(guildId, userId);
  return result.changes;
}

interface ReportDbRow {
  id: string;
  guild_id: string;
  reporter_user_id: string;
  channel_id: string | null;
  message_id: string | null;
  reason: string;
  status: string;
  suggested_action: string | null;
  created_at: string;
}

function reportFromDbRow(row: ReportDbRow): ModerationReportRow {
  return {
    id: row.id,
    guildId: row.guild_id,
    reporterUserId: row.reporter_user_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    reason: row.reason,
    status: row.status as ModerationReportRow["status"],
    suggestedAction: row.suggested_action,
    createdAt: row.created_at,
  };
}

export function createModerationReport(params: {
  guildId: string;
  reporterUserId: string;
  reason: string;
  channelId?: string;
  messageId?: string;
  suggestedAction?: string;
}): ModerationReportRow {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO moderation_reports (id, guild_id, reporter_user_id, channel_id, message_id, reason, suggested_action)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.guildId,
    params.reporterUserId,
    params.channelId ?? null,
    params.messageId ?? null,
    params.reason,
    params.suggestedAction ?? null
  );
  const row = db.prepare(`SELECT * FROM moderation_reports WHERE id = ?`).get(id) as ReportDbRow;
  return reportFromDbRow(row);
}

export function listOpenReports(guildId: string, limit = 20): ModerationReportRow[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM moderation_reports WHERE guild_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT ?`)
    .all(guildId, limit) as ReportDbRow[];
  return rows.map(reportFromDbRow);
}

/**
 * Reports a member FILED (as reporter) are theirs to delete via /forget.
 * Reports filed ABOUT a member by someone else are moderation records kept
 * for community-safety/integrity purposes and are not self-service-deletable
 * — this is disclosed in /privacy.
 */
export function deleteReportsFiledByUser(guildId: string, userId: string): number {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM moderation_reports WHERE guild_id = ? AND reporter_user_id = ?`)
    .run(guildId, userId);
  return result.changes;
}
