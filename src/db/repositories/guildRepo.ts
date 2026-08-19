import { getDb } from "../client.js";
import type { GuildConfigRow, TrustedResourceLink } from "../../types/domain.js";

interface GuildConfigDbRow {
  guild_id: string;
  server_name: string | null;
  server_purpose: string | null;
  server_description: string | null;
  server_culture: string | null;
  response_mode: string;
  ai_enabled: number;
  ai_provider: string;
  moderation_intensity: string;
  warning_threshold: number;
  prohibited_content_notes: string | null;
  enforcement_style: string;
  mod_alert_channel_id: string | null;
  message_analysis_enabled: number;
  message_analysis_channels: string;
  retention_days: number;
  summarize_enabled: number;
  admin_role_ids: string;
  trusted_resource_links: string;
  updated_at: string;
  updated_by_user_id: string | null;
}

function fromDbRow(row: GuildConfigDbRow): GuildConfigRow {
  return {
    guildId: row.guild_id,
    serverName: row.server_name,
    serverPurpose: row.server_purpose,
    serverDescription: row.server_description,
    serverCulture: row.server_culture,
    responseMode: row.response_mode as GuildConfigRow["responseMode"],
    aiEnabled: !!row.ai_enabled,
    aiProvider: row.ai_provider as GuildConfigRow["aiProvider"],
    moderationIntensity: row.moderation_intensity as GuildConfigRow["moderationIntensity"],
    warningThreshold: row.warning_threshold,
    prohibitedContentNotes: row.prohibited_content_notes,
    enforcementStyle: row.enforcement_style,
    modAlertChannelId: row.mod_alert_channel_id,
    messageAnalysisEnabled: !!row.message_analysis_enabled,
    messageAnalysisChannels: safeJsonArray(row.message_analysis_channels),
    retentionDays: row.retention_days,
    summarizeEnabled: !!row.summarize_enabled,
    adminRoleIds: safeJsonArray(row.admin_role_ids),
    trustedResourceLinks: safeJsonArray(row.trusted_resource_links) as unknown as TrustedResourceLink[],
    updatedAt: row.updated_at,
    updatedByUserId: row.updated_by_user_id,
  };
}

function safeJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Ensures a `guilds` row and a default `guild_config` row exist for this guild. Idempotent. */
export function ensureGuild(guildId: string, name?: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO guilds (id, name) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET name = COALESCE(excluded.name, guilds.name)`
  ).run(guildId, name ?? null);

  db.prepare(
    `INSERT INTO guild_config (guild_id) VALUES (?)
     ON CONFLICT(guild_id) DO NOTHING`
  ).run(guildId);
}

export function getGuildConfig(guildId: string): GuildConfigRow | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM guild_config WHERE guild_id = ?`).get(guildId) as
    | GuildConfigDbRow
    | undefined;
  return row ? fromDbRow(row) : null;
}

export interface GuildConfigUpdate {
  serverName?: string | null;
  serverPurpose?: string | null;
  serverDescription?: string | null;
  serverCulture?: string | null;
  responseMode?: GuildConfigRow["responseMode"];
  aiEnabled?: boolean;
  aiProvider?: GuildConfigRow["aiProvider"];
  moderationIntensity?: GuildConfigRow["moderationIntensity"];
  warningThreshold?: number;
  prohibitedContentNotes?: string | null;
  enforcementStyle?: string;
  modAlertChannelId?: string | null;
  messageAnalysisEnabled?: boolean;
  messageAnalysisChannels?: string[];
  retentionDays?: number;
  summarizeEnabled?: boolean;
  adminRoleIds?: string[];
  trustedResourceLinks?: TrustedResourceLink[];
}

const COLUMN_MAP: Record<keyof GuildConfigUpdate, string> = {
  serverName: "server_name",
  serverPurpose: "server_purpose",
  serverDescription: "server_description",
  serverCulture: "server_culture",
  responseMode: "response_mode",
  aiEnabled: "ai_enabled",
  aiProvider: "ai_provider",
  moderationIntensity: "moderation_intensity",
  warningThreshold: "warning_threshold",
  prohibitedContentNotes: "prohibited_content_notes",
  enforcementStyle: "enforcement_style",
  modAlertChannelId: "mod_alert_channel_id",
  messageAnalysisEnabled: "message_analysis_enabled",
  messageAnalysisChannels: "message_analysis_channels",
  retentionDays: "retention_days",
  summarizeEnabled: "summarize_enabled",
  adminRoleIds: "admin_role_ids",
  trustedResourceLinks: "trusted_resource_links",
};

const JSON_FIELDS = new Set<keyof GuildConfigUpdate>([
  "messageAnalysisChannels",
  "adminRoleIds",
  "trustedResourceLinks",
]);
const BOOL_FIELDS = new Set<keyof GuildConfigUpdate>(["aiEnabled", "messageAnalysisEnabled", "summarizeEnabled"]);

/** Partial update of guild_config. Ensures the guild/config rows exist first. */
export function updateGuildConfig(guildId: string, update: GuildConfigUpdate, updatedByUserId: string): GuildConfigRow {
  ensureGuild(guildId);
  const db = getDb();

  const keys = Object.keys(update) as (keyof GuildConfigUpdate)[];
  if (keys.length > 0) {
    const setClauses = keys.map((k) => `${COLUMN_MAP[k]} = ?`);
    const values = keys.map((k) => {
      const v = update[k];
      if (JSON_FIELDS.has(k)) return JSON.stringify(v ?? []);
      if (BOOL_FIELDS.has(k)) return v ? 1 : 0;
      return v as string | number | null;
    });
    db.prepare(
      `UPDATE guild_config SET ${setClauses.join(", ")}, updated_at = datetime('now'), updated_by_user_id = ?
       WHERE guild_id = ?`
    ).run(...values, updatedByUserId, guildId);
  }

  const result = getGuildConfig(guildId);
  if (!result) throw new Error(`guild_config missing for guild ${guildId} after update`);
  return result;
}

/** Deletes ALL data for a guild (cascades to every child table). Used only for full data-reset flows. */
export function deleteGuildCompletely(guildId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM guilds WHERE id = ?`).run(guildId);
}

/** Guilds that have explicitly opted into the (default-off) message-analysis feature. */
export function listGuildsWithMessageAnalysisEnabled(): GuildConfigRow[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM guild_config WHERE message_analysis_enabled = 1`).all() as GuildConfigDbRow[];
  return rows.map(fromDbRow);
}
