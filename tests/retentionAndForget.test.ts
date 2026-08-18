import { beforeEach, describe, expect, it } from "vitest";
import { freshTestDb } from "./setupTestDb.js";
import { ensureGuild } from "../src/db/repositories/guildRepo.js";
import {
  saveConversationContext,
  getRecentContext,
  deleteConversationContextForUser,
  countConversationContextForUser,
} from "../src/db/repositories/conversationRepo.js";
import { createFeedbackItem, createModerationReport, deleteFeedbackForUser, deleteReportsFiledByUser } from "../src/db/repositories/communityInputRepo.js";
import { runRetentionSweep, retentionDaysToTtlMs } from "../src/services/retention.js";

const GUILD = "guild-retention";

beforeEach(() => {
  freshTestDb();
  ensureGuild(GUILD, "Retention Test Guild");
});

describe("retentionDaysToTtlMs", () => {
  it("converts days to milliseconds", () => {
    expect(retentionDaysToTtlMs(1)).toBe(24 * 60 * 60 * 1000);
    expect(retentionDaysToTtlMs(30)).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("floors at 1 day even if given 0 or a negative value", () => {
    expect(retentionDaysToTtlMs(0)).toBe(24 * 60 * 60 * 1000);
    expect(retentionDaysToTtlMs(-5)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("runRetentionSweep", () => {
  it("deletes only conversation_context rows whose expiry has already passed", () => {
    // Already expired (ttl in the past).
    saveConversationContext({ guildId: GUILD, channelId: "c1", userId: "u1", summaryText: "old", ttlMs: -1000 });
    // Still valid for an hour.
    saveConversationContext({ guildId: GUILD, channelId: "c1", userId: "u2", summaryText: "fresh", ttlMs: 60 * 60 * 1000 });

    const { deletedConversationRows } = runRetentionSweep();

    expect(deletedConversationRows).toBe(1);
    expect(countConversationContextForUser(GUILD, "u1")).toBe(0);
    expect(countConversationContextForUser(GUILD, "u2")).toBe(1);
    expect(getRecentContext(GUILD, "c1", "u2")).not.toBeNull();
  });

  it("is a no-op (returns 0) when nothing has expired", () => {
    saveConversationContext({ guildId: GUILD, channelId: "c1", userId: "u1", summaryText: "fresh", ttlMs: 60_000 });
    const { deletedConversationRows } = runRetentionSweep();
    expect(deletedConversationRows).toBe(0);
  });
});

describe("/forget self-service deletion", () => {
  it("deletes only the requesting user's conversation context, feedback, and self-filed reports", () => {
    saveConversationContext({ guildId: GUILD, channelId: "c1", userId: "requester", summaryText: "mine", ttlMs: 60_000 });
    saveConversationContext({ guildId: GUILD, channelId: "c1", userId: "someone-else", summaryText: "not mine", ttlMs: 60_000 });
    createFeedbackItem({ guildId: GUILD, reporterUserId: "requester", comment: "my feedback" });
    createFeedbackItem({ guildId: GUILD, reporterUserId: "someone-else", comment: "their feedback" });
    createModerationReport({ guildId: GUILD, reporterUserId: "requester", reason: "a report I filed" });

    const deletedConvos = deleteConversationContextForUser(GUILD, "requester");
    const deletedFeedback = deleteFeedbackForUser(GUILD, "requester");
    const deletedReports = deleteReportsFiledByUser(GUILD, "requester");

    expect(deletedConvos).toBe(1);
    expect(deletedFeedback).toBe(1);
    expect(deletedReports).toBe(1);
    expect(countConversationContextForUser(GUILD, "someone-else")).toBe(1); // untouched
  });

  it("does NOT delete a moderation report filed about the user by someone else", () => {
    // Someone else reports "requester" for something — this is a safety record, not requester's own data.
    createModerationReport({ guildId: GUILD, reporterUserId: "other-reporter", reason: "reported the requester for spam" });

    const deletedReports = deleteReportsFiledByUser(GUILD, "requester");

    expect(deletedReports).toBe(0); // requester filed nothing themselves
    // The report about them, filed by someone else, is untouched by design (see /forget's disclosed limitation).
    const stillFiledByOther = deleteReportsFiledByUser(GUILD, "other-reporter");
    expect(stillFiledByOther).toBe(1);
  });
});
