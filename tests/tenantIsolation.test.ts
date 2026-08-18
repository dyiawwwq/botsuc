import { beforeEach, describe, expect, it } from "vitest";
import { freshTestDb } from "./setupTestDb.js";
import { ensureGuild, getGuildConfig, updateGuildConfig } from "../src/db/repositories/guildRepo.js";
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  getKnowledgeEntryById,
  listKnowledgeEntries,
} from "../src/db/repositories/knowledgeRepo.js";
import { upsertChannelConfig, listChannelConfigs } from "../src/db/repositories/channelConfigRepo.js";
import { saveConversationContext, deleteConversationContextForUser } from "../src/db/repositories/conversationRepo.js";

const GUILD_A = "guild-aaa";
const GUILD_B = "guild-bbb";

beforeEach(() => {
  freshTestDb();
  ensureGuild(GUILD_A, "Guild A");
  ensureGuild(GUILD_B, "Guild B");
});

describe("tenant isolation — knowledge entries", () => {
  it("never returns another guild's entries from listKnowledgeEntries", () => {
    createKnowledgeEntry(GUILD_A, { type: "rule", title: "A-only rule", content: "...", createdByUserId: "u1" });
    createKnowledgeEntry(GUILD_B, { type: "rule", title: "B-only rule", content: "...", createdByUserId: "u2" });

    const aEntries = listKnowledgeEntries(GUILD_A);
    const bEntries = listKnowledgeEntries(GUILD_B);

    expect(aEntries.map((e) => e.title)).toEqual(["A-only rule"]);
    expect(bEntries.map((e) => e.title)).toEqual(["B-only rule"]);
  });

  it("cannot fetch a knowledge entry by ID under the wrong guildId", () => {
    const entry = createKnowledgeEntry(GUILD_A, { type: "faq", title: "Secret", content: "...", createdByUserId: "u1" });
    expect(getKnowledgeEntryById(GUILD_A, entry.id)).not.toBeNull();
    expect(getKnowledgeEntryById(GUILD_B, entry.id)).toBeNull();
  });

  it("cannot delete a knowledge entry under the wrong guildId", () => {
    const entry = createKnowledgeEntry(GUILD_A, { type: "faq", title: "Secret", content: "...", createdByUserId: "u1" });
    const deletedUnderWrongGuild = deleteKnowledgeEntry(GUILD_B, entry.id);
    expect(deletedUnderWrongGuild).toBe(false);
    expect(getKnowledgeEntryById(GUILD_A, entry.id)).not.toBeNull(); // still there
  });
});

describe("tenant isolation — guild_config", () => {
  it("updating one guild's config never mutates another guild's config", () => {
    updateGuildConfig(GUILD_A, { serverName: "Alpha", retentionDays: 10 }, "admin1");
    updateGuildConfig(GUILD_B, { serverName: "Bravo", retentionDays: 90 }, "admin2");

    expect(getGuildConfig(GUILD_A)?.serverName).toBe("Alpha");
    expect(getGuildConfig(GUILD_A)?.retentionDays).toBe(10);
    expect(getGuildConfig(GUILD_B)?.serverName).toBe("Bravo");
    expect(getGuildConfig(GUILD_B)?.retentionDays).toBe(90);
  });
});

describe("tenant isolation — channel_config", () => {
  it("only lists channels configured for that specific guild", () => {
    upsertChannelConfig(GUILD_A, "chan-1", { purpose: "general chat" });
    upsertChannelConfig(GUILD_B, "chan-2", { purpose: "announcements" });

    expect(listChannelConfigs(GUILD_A).map((c) => c.channelId)).toEqual(["chan-1"]);
    expect(listChannelConfigs(GUILD_B).map((c) => c.channelId)).toEqual(["chan-2"]);
  });
});

describe("tenant isolation — conversation context (same user in two guilds)", () => {
  it("deleting a user's context in one guild leaves their context in another guild untouched", () => {
    const userId = "user-in-both-guilds";
    saveConversationContext({ guildId: GUILD_A, channelId: "c1", userId, summaryText: "asked about rules", ttlMs: 60_000 });
    saveConversationContext({ guildId: GUILD_B, channelId: "c2", userId, summaryText: "asked about events", ttlMs: 60_000 });

    const deletedInA = deleteConversationContextForUser(GUILD_A, userId);
    expect(deletedInA).toBe(1);

    // Guild B's copy for the same physical user must survive — /forget in one server never reaches into another.
    const remainingInB = deleteConversationContextForUser(GUILD_B, userId);
    expect(remainingInB).toBe(1);
  });
});
