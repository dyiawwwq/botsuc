import { PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction } from "discord.js";
import type { GuildConfigRow } from "../types/domain.js";

/** Any interaction type that carries guild member/permission info — slash commands, buttons, and modal submits all qualify. */
export type GuildInteraction = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;

/**
 * Discord-side gating (default_member_permissions on each command builder,
 * see commands/*) is defense-in-depth only — server owners can override who
 * *sees* a command in Discord's own Integrations settings. This function is
 * the authoritative, always-re-checked gate every admin command calls before
 * doing anything.
 *
 * A member is an authorized administrator if they have Discord's
 * Administrator or Manage Server permission, OR their roles intersect the
 * guild's configured `admin_role_ids` (Core Requirements: "Community roles"
 * should be configurable, not hard-coded to Discord's built-ins).
 */
export function isAuthorizedAdmin(
  interaction: GuildInteraction,
  guildConfig: GuildConfigRow | null
): boolean {
  if (!interaction.inGuild()) return false;
  const perms = interaction.memberPermissions;
  if (perms?.has(PermissionFlagsBits.Administrator)) return true;
  if (perms?.has(PermissionFlagsBits.ManageGuild)) return true;

  const adminRoleIds = guildConfig?.adminRoleIds ?? [];
  if (adminRoleIds.length === 0) return false;

  const roleIds = extractMemberRoleIds(interaction);
  return roleIds.some((r) => adminRoleIds.includes(r));
}

/**
 * `interaction.member.roles` is a GuildMemberRoleManager (cached gateway
 * member) in most runtime cases, but can be a plain string[] on the raw API
 * shape (APIInteractionGuildMember) depending on caching/partials. Handle
 * both defensively rather than assuming one shape.
 */
function extractMemberRoleIds(interaction: GuildInteraction): string[] {
  const member = interaction.member;
  if (!member) return [];
  const roles = (member as { roles?: unknown }).roles;
  if (Array.isArray(roles)) return roles as string[];
  if (roles && typeof roles === "object" && "cache" in roles) {
    const cache = (roles as { cache: Map<string, unknown> }).cache;
    return [...cache.keys()];
  }
  return [];
}

/** True if the invoking member is the guild owner — used only for the most destructive actions if ever needed. */
export function isGuildOwner(interaction: GuildInteraction): boolean {
  return !!interaction.guild && interaction.guild.ownerId === interaction.user.id;
}
