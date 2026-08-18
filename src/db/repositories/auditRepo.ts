import { randomUUID } from "node:crypto";
import { getDb } from "../client.js";
import type { AuditEventRow } from "../../types/domain.js";

interface AuditDbRow {
  id: string;
  guild_id: string;
  actor_user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: string | null;
  success: number;
  created_at: string;
}

function fromDbRow(row: AuditDbRow): AuditEventRow {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    guildId: row.guild_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata,
    success: !!row.success,
    createdAt: row.created_at,
  };
}

export interface RecordAuditEventInput {
  guildId: string;
  actorUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  success?: boolean;
}

/**
 * Records an audit event. `metadata` must never contain message content,
 * tokens, or other secrets — callers pass only small structured facts
 * (e.g. { field: "moderationIntensity", from: "standard", to: "strict" }).
 */
export function recordAuditEvent(input: RecordAuditEventInput): AuditEventRow {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO audit_events (id, guild_id, actor_user_id, action, target_type, target_id, metadata, success)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.guildId,
    input.actorUserId,
    input.action,
    input.targetType ?? null,
    input.targetId ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.success === false ? 0 : 1
  );
  const row = db.prepare(`SELECT * FROM audit_events WHERE id = ?`).get(id) as AuditDbRow;
  return fromDbRow(row);
}

export function listRecentAuditEvents(guildId: string, limit = 20): AuditEventRow[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM audit_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(guildId, limit) as AuditDbRow[];
  return rows.map(fromDbRow);
}

export function listRecentFailures(guildId: string, limit = 10): AuditEventRow[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM audit_events WHERE guild_id = ? AND success = 0 ORDER BY created_at DESC LIMIT ?`)
    .all(guildId, limit) as AuditDbRow[];
  return rows.map(fromDbRow);
}
