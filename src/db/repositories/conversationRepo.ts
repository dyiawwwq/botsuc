import { randomUUID } from "node:crypto";
import { getDb } from "../client.js";
import type { ConversationContextRow } from "../../types/domain.js";

interface ConversationDbRow {
  id: string;
  guild_id: string;
  channel_id: string;
  user_id: string;
  summary_text: string;
  expires_at: string;
  created_at: string;
}

function fromDbRow(row: ConversationDbRow): ConversationContextRow {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    summaryText: row.summary_text,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/** Stores a short derived summary of the current interaction, not a message transcript. */
export function saveConversationContext(params: {
  guildId: string;
  channelId: string;
  userId: string;
  summaryText: string;
  ttlMs: number;
}): ConversationContextRow {
  const db = getDb();
  const id = randomUUID();
  // expires_at is computed by SQLite itself (datetime('now', 'N seconds')) rather than
  // pre-formatted in JS, so it's guaranteed to be in the exact same format/clock as the
  // datetime('now') comparisons in getRecentContext/deleteExpiredConversationContext below.
  // (A prior version used new Date().toISOString() here, which sorts inconsistently against
  // SQLite's space-separated datetime('now') output and silently broke expiry deletion.)
  const ttlSeconds = Math.round(params.ttlMs / 1000);
  db.prepare(
    `INSERT INTO conversation_context (id, guild_id, channel_id, user_id, summary_text, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', ?))`
  ).run(id, params.guildId, params.channelId, params.userId, params.summaryText, `${ttlSeconds} seconds`);
  const row = db.prepare(`SELECT * FROM conversation_context WHERE id = ?`).get(id) as ConversationDbRow;
  return fromDbRow(row);
}

/** Most recent non-expired context for a user in a channel, if any — used for short follow-up questions. */
export function getRecentContext(guildId: string, channelId: string, userId: string): ConversationContextRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM conversation_context
       WHERE guild_id = ? AND channel_id = ? AND user_id = ? AND expires_at > datetime('now')
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(guildId, channelId, userId) as ConversationDbRow | undefined;
  return row ? fromDbRow(row) : null;
}

/** Deletes every conversation_context row for one member in one guild. Used by /forget. Returns rows deleted. */
export function deleteConversationContextForUser(guildId: string, userId: string): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM conversation_context WHERE guild_id = ? AND user_id = ?`).run(guildId, userId);
  return result.changes;
}

/** Deletes every expired row across all guilds. Used by the retention sweep. Returns rows deleted. */
export function deleteExpiredConversationContext(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM conversation_context WHERE expires_at <= datetime('now')`).run();
  return result.changes;
}

export function countConversationContextForUser(guildId: string, userId: string): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) as n FROM conversation_context WHERE guild_id = ? AND user_id = ?`)
    .get(guildId, userId) as { n: number };
  return row.n;
}
