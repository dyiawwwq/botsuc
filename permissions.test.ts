import { beforeEach, describe, expect, it } from "vitest";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { freshTestDb } from "./setupTestDb.js";
import { isAuthorizedAdmin, type GuildInteraction } from "../src/services/permissions.js";
import type { GuildConfigRow } from "../src/types/domain.js";

function fakeInteraction(opts: { permissionBits?: bigint[]; roleIds?: string[]; rolesAsManager?: boolean }): GuildInteraction {
  const perms = new PermissionsBitField(opts.permissionBits ?? []);
  const roles = opts.rolesAsManager ? { cache: new Map((opts.roleIds ?? []).map((r) => [r, {}])) } : (opts.roleIds ?? []);
  return {
    inGuild: () => true,
    memberPermissions: perms,
    member: { roles },
  } as unknown as GuildInteraction;
}

function configWithAdminRoles(roleIds: string[]): GuildConfigRow {
  return {
    guildId: "g1",
    serverName: null,
    serverPurpose: null,
    serverDescription: null,
    serverCulture: null,
    responseMode: "mention_only",
    aiEnabled: false,
    aiProvider: "none",
    moderationIntensity: "standard",
    warningThreshold: 3,
    prohibitedContentNotes: null,
    enforcementStyle: "warn_then_escalate",
    modAlertChannelId: null,
    messageAnalysisEnabled: false,
    messageAnalysisChannels: [],
    retentionDays: 30,
    summarizeEnabled: true,
    adminRoleIds: roleIds,
    trustedResourceLinks: [],
    updatedAt: new Date().toISOString(),
    updatedByUserId: null,
  };
}

describe("isAuthorizedAdmin", () => {
  beforeEach(() => {
    freshTestDb();
  });

  it("authorizes a member with the Administrator permission regardless of roles", () => {
    const interaction = fakeInteraction({ permissionBits: [PermissionFlagsBits.Administrator] });
    expect(isAuthorizedAdmin(interaction, configWithAdminRoles([]))).toBe(true);
  });

  it("authorizes a member with the Manage Server permission", () => {
    const interaction = fakeInteraction({ permissionBits: [PermissionFlagsBits.ManageGuild] });
    expect(isAuthorizedAdmin(interaction, configWithAdminRoles([]))).toBe(true);
  });

  it("denies a member with no native permission and no configured admin roles", () => {
    const interaction = fakeInteraction({ permissionBits: [] });
    expect(isAuthorizedAdmin(interaction, configWithAdminRoles([]))).toBe(false);
  });

  it("denies a member with no permission and a role NOT in adminRoleIds", () => {
    const interaction = fakeInteraction({ permissionBits: [], roleIds: ["role-999"] });
    expect(isAuthorizedAdmin(interaction, configWithAdminRoles(["role-mod"]))).toBe(false);
  });

  it("authorizes a member whose role IS in the configured adminRoleIds (array-shaped roles)", () => {
    const interaction = fakeInteraction({ permissionBits: [], roleIds: ["role-mod"] });
    expect(isAuthorizedAdmin(interaction, configWithAdminRoles(["role-mod"]))).toBe(true);
  });

  it("authorizes a member whose role IS in adminRoleIds when member.roles is a RoleManager-shaped cache", () => {
    const interaction = fakeInteraction({ permissionBits: [], roleIds: ["role-mod"], rolesAsManager: true });
    expect(isAuthorizedAdmin(interaction, configWithAdminRoles(["role-mod"]))).toBe(true);
  });

  it("denies when guildConfig is null and the member has no native admin permission", () => {
    const interaction = fakeInteraction({ permissionBits: [] });
    expect(isAuthorizedAdmin(interaction, null)).toBe(false);
  });
});
