import { randomUUID } from "node:crypto";
import { getDb } from "../client.js";
import type { ChannelConfigRow } from "../../types/domain.js";

interface ChannelConfigDbRow {
  id: string;
  guild_id: string;
  channel_id: string;
  purpose: string | null;
  guidance: string | null;
  category: string | null;
  read_enabled: number;
  index_enabled: number;
  updated_at: string;
}

function fromDbRow(row: ChannelConfigDbRow): ChannelConfigRow {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    purpose: row.purpose,
    guidance: row.guidance,
    category: row.category,
    readEnabled: !!row.read_enabled,
    indexEnabled: !!row.index_enabled,
    updatedAt: row.updated_at,
  };
}

export function getChannelConfig(guildId: string, channelId: string): ChannelConfigRow | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM channel_config WHERE guild_id = ? AND channel_id = ?`)
    .get(guildId, channelId) as ChannelConfigDbRow | undefined;
  return row ? fromDbRow(row) : null;
}

export function listChannelConfigs(guildId: string): ChannelConfigRow[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM channel_config WHERE guild_id = ? ORDER BY channel_id`)
    .all(guildId) as ChannelConfigDbRow[];
  return rows.map(fromDbRow);
}

export function listIndexableChannelIds(guildId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT channel_id FROM channel_config WHERE guild_id = ? AND index_enabled = 1`)
    .all(guildId) as { channel_id: string }[];
  return rows.map((r) => r.channel_id);
}

export interface ChannelConfigUpsert {
  purpose?: string | null;
  guidance?: string | null;
  category?: string | null;
  readEnabled?: boolean;
  indexEnabled?: boolean;
}

/** Tenant-scoped upsert: always requires guildId + channelId together, never a bare channelId. */
export function upsertChannelConfig(guildId: string, channelId: string, update: ChannelConfigUpsert): ChannelConfigRow {
  const db = getDb();
  const existing = getChannelConfig(guildId, channelId);

  if (!existing) {
    db.prepare(
      `INSERT INTO channel_config (id, guild_id, channel_id, purpose, guidance, category, read_enabled, index_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      guildId,
      channelId,
      update.purpose ?? null,
      update.guidance ?? null,
      update.category ?? null,
      update.readEnabled ? 1 : 0,
      update.indexEnabled ? 1 : 0
    );
  } else {
    db.prepare(
      `UPDATE channel_config SET
         purpose = ?, guidance = ?, category = ?, read_enabled = ?, index_enabled = ?, updated_at = datetime('now')
       WHERE guild_id = ? AND channel_id = ?`
    ).run(
      update.purpose !== undefined ? update.purpose : existing.purpose,
      update.guidance !== undefined ? update.guidance : existing.guidance,
      update.category !== undefined ? update.category : existing.category,
      update.readEnabled !== undefined ? (update.readEnabled ? 1 : 0) : existing.readEnabled ? 1 : 0,
      update.indexEnabled !== undefined ? (update.indexEnabled ? 1 : 0) : existing.indexEnabled ? 1 : 0,
      guildId,
      channelId
    );
  }

  const result = getChannelConfig(guildId, channelId);
  if (!result) throw new Error("channel_config upsert failed unexpectedly");
  return result;
}
