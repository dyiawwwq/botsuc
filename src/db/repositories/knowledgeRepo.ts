import { randomUUID } from "node:crypto";
import { getDb } from "../client.js";
import type { KnowledgeEntryRow, KnowledgeStatus, KnowledgeType } from "../../types/domain.js";

interface KnowledgeDbRow {
  id: string;
  guild_id: string;
  type: string;
  title: string;
  content: string;
  source_channel_id: string | null;
  source_message_id: string | null;
  status: string;
  confidence: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

function fromDbRow(row: KnowledgeDbRow): KnowledgeEntryRow {
  return {
    id: row.id,
    guildId: row.guild_id,
    type: row.type as KnowledgeType,
    title: row.title,
    content: row.content,
    sourceChannelId: row.source_channel_id,
    sourceMessageId: row.source_message_id,
    status: row.status as KnowledgeStatus,
    confidence: row.confidence as KnowledgeEntryRow["confidence"],
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateKnowledgeInput {
  type: KnowledgeType;
  title: string;
  content: string;
  sourceChannelId?: string | null;
  sourceMessageId?: string | null;
  confidence?: KnowledgeEntryRow["confidence"];
  createdByUserId: string;
}

export function createKnowledgeEntry(guildId: string, input: CreateKnowledgeInput): KnowledgeEntryRow {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO knowledge_entries
       (id, guild_id, type, title, content, source_channel_id, source_message_id, confidence, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    guildId,
    input.type,
    input.title,
    input.content,
    input.sourceChannelId ?? null,
    input.sourceMessageId ?? null,
    input.confidence ?? "authoritative",
    input.createdByUserId
  );
  const row = getKnowledgeEntryById(guildId, id);
  if (!row) throw new Error("knowledge_entries insert failed unexpectedly");
  return row;
}

/** Always scoped by guildId — a knowledge entry ID from another guild will never match. */
export function getKnowledgeEntryById(guildId: string, id: string): KnowledgeEntryRow | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM knowledge_entries WHERE guild_id = ? AND id = ?`)
    .get(guildId, id) as KnowledgeDbRow | undefined;
  return row ? fromDbRow(row) : null;
}

export interface ListKnowledgeFilter {
  type?: KnowledgeType | KnowledgeType[];
  status?: KnowledgeStatus;
  limit?: number;
}

export function listKnowledgeEntries(guildId: string, filter: ListKnowledgeFilter = {}): KnowledgeEntryRow[] {
  const db = getDb();
  const clauses = ["guild_id = ?"];
  const params: (string | number)[] = [guildId];
  if (filter.type) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type];
    clauses.push(`type IN (${types.map(() => "?").join(",")})`);
    params.push(...types);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  const limit = filter.limit ?? 200;
  const rows = db
    .prepare(`SELECT * FROM knowledge_entries WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`)
    .all(...params, limit) as KnowledgeDbRow[];
  return rows.map(fromDbRow);
}

/** Used by retrieval — active entries only, across all types unless filtered. */
export function listActiveKnowledgeForRetrieval(guildId: string, type?: KnowledgeType | KnowledgeType[]): KnowledgeEntryRow[] {
  return listKnowledgeEntries(guildId, { status: "active", ...(type ? { type } : {}) });
}

export interface UpdateKnowledgeInput {
  title?: string;
  content?: string;
  status?: KnowledgeStatus;
  type?: KnowledgeType;
}

export function updateKnowledgeEntry(guildId: string, id: string, update: UpdateKnowledgeInput): KnowledgeEntryRow | null {
  const existing = getKnowledgeEntryById(guildId, id);
  if (!existing) return null;
  const db = getDb();
  db.prepare(
    `UPDATE knowledge_entries SET title = ?, content = ?, status = ?, type = ?, updated_at = datetime('now')
     WHERE guild_id = ? AND id = ?`
  ).run(
    update.title ?? existing.title,
    update.content ?? existing.content,
    update.status ?? existing.status,
    update.type ?? existing.type,
    guildId,
    id
  );
  return getKnowledgeEntryById(guildId, id);
}

/** Returns true if a row was actually deleted (guild-scoped, so cross-tenant IDs never match). */
export function deleteKnowledgeEntry(guildId: string, id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM knowledge_entries WHERE guild_id = ? AND id = ?`).run(guildId, id);
  return result.changes > 0;
}

/** Wipes ALL knowledge entries for a guild. Used only behind an explicit confirm button in /knowledge reset. */
export function resetAllKnowledgeEntries(guildId: string): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM knowledge_entries WHERE guild_id = ?`).run(guildId);
  return result.changes;
}

/** Finds the one auto-generated aggregate-pattern entry for a channel, if any, so the analysis sweep updates it in place. */
export function findDerivedPatternEntry(guildId: string, sourceChannelId: string): KnowledgeEntryRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM knowledge_entries
       WHERE guild_id = ? AND type = 'derived_pattern' AND source_channel_id = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(guildId, sourceChannelId) as KnowledgeDbRow | undefined;
  return row ? fromDbRow(row) : null;
}

export function countKnowledgeEntries(guildId: string): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as n FROM knowledge_entries WHERE guild_id = ?`).get(guildId) as {
    n: number;
  };
  return row.n;
}
