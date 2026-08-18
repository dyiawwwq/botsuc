import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshTestDb } from "./setupTestDb.js";
import { ensureGuild } from "../src/db/repositories/guildRepo.js";
import { checkRateLimit, resetRateLimitsForTests } from "../src/services/rateLimiter.js";
import { RateLimitError, NotFoundError, PermissionError, toUserMessage } from "../src/util/errors.js";
import { parseDurationToMs } from "../src/util/duration.js";
import { getKnowledgeEntryById, updateKnowledgeEntry, deleteKnowledgeEntry, createKnowledgeEntry } from "../src/db/repositories/knowledgeRepo.js";
import { getChannelConfig } from "../src/db/repositories/channelConfigRepo.js";
import { recordAuditEvent, listRecentFailures } from "../src/db/repositories/auditRepo.js";

const GUILD = "guild-failures";

beforeEach(() => {
  freshTestDb();
  resetRateLimitsForTests();
  ensureGuild(GUILD, "Failure Test Guild");
});

describe("rate limiter", () => {
  it("allows calls up to the limit and then throws RateLimitError", () => {
    for (let i = 0; i < 3; i++) {
      expect(() => checkRateLimit({ bucket: "test", guildId: GUILD, userId: "u1", limit: 3, windowMs: 60_000 })).not.toThrow();
    }
    expect(() => checkRateLimit({ bucket: "test", guildId: GUILD, userId: "u1", limit: 3, windowMs: 60_000 })).toThrow(RateLimitError);
  });

  it("tracks separate users independently", () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit({ bucket: "test", guildId: GUILD, userId: "u1", limit: 3, windowMs: 60_000 });
    }
    // u2 hasn't used any of their quota yet — must not be blocked by u1's usage.
    expect(() => checkRateLimit({ bucket: "test", guildId: GUILD, userId: "u2", limit: 3, windowMs: 60_000 })).not.toThrow();
  });

  it("tracks separate buckets (commands) independently for the same user", () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit({ bucket: "ask", guildId: GUILD, userId: "u1", limit: 3, windowMs: 60_000 });
    }
    expect(() => checkRateLimit({ bucket: "feedback", guildId: GUILD, userId: "u1", limit: 3, windowMs: 60_000 })).not.toThrow();
  });

  it("resets once the time window has passed", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 2; i++) {
        checkRateLimit({ bucket: "test", guildId: GUILD, userId: "u1", limit: 2, windowMs: 1000 });
      }
      expect(() => checkRateLimit({ bucket: "test", guildId: GUILD, userId: "u1", limit: 2, windowMs: 1000 })).toThrow(RateLimitError);

      vi.advanceTimersByTime(1001);

      expect(() => checkRateLimit({ bucket: "test", guildId: GUILD, userId: "u1", limit: 2, windowMs: 1000 })).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("parseDurationToMs", () => {
  it("parses valid short duration strings", () => {
    expect(parseDurationToMs("24h")).toBe(24 * 60 * 60 * 1000);
    expect(parseDurationToMs("7d")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDurationToMs("45m")).toBe(45 * 60 * 1000);
  });

  it("rejects malformed input instead of guessing", () => {
    expect(() => parseDurationToMs("abc")).toThrow();
    expect(() => parseDurationToMs("10x")).toThrow();
    expect(() => parseDurationToMs("-5h")).toThrow();
    expect(() => parseDurationToMs("")).toThrow();
  });

  it("enforces a maximum window", () => {
    expect(() => parseDurationToMs("30d", { maxMs: 14 * 24 * 60 * 60 * 1000 })).toThrow();
  });
});

describe("missing / deleted resource handling", () => {
  it("getKnowledgeEntryById returns null (not a throw) for a nonexistent ID", () => {
    expect(getKnowledgeEntryById(GUILD, "does-not-exist")).toBeNull();
  });

  it("updateKnowledgeEntry returns null for a nonexistent ID instead of throwing", () => {
    expect(updateKnowledgeEntry(GUILD, "does-not-exist", { title: "x" })).toBeNull();
  });

  it("deleteKnowledgeEntry returns false for a nonexistent/already-deleted ID", () => {
    const entry = createKnowledgeEntry(GUILD, { type: "faq", title: "Temp", content: "...", createdByUserId: "u1" });
    expect(deleteKnowledgeEntry(GUILD, entry.id)).toBe(true); // first delete succeeds
    expect(deleteKnowledgeEntry(GUILD, entry.id)).toBe(false); // second delete (already gone) fails gracefully
  });

  it("getChannelConfig returns null for a channel that was never configured (treated as not-permitted, not a crash)", () => {
    expect(getChannelConfig(GUILD, "never-configured-channel")).toBeNull();
  });
});

describe("toUserMessage — safe error surfacing", () => {
  it("passes through known, safe error messages", () => {
    expect(toUserMessage(new NotFoundError("That item couldn't be found."))).toBe("That item couldn't be found.");
    expect(toUserMessage(new PermissionError("Nope."))).toBe("Nope.");
  });

  it("never leaks internals for an unexpected/unknown error", () => {
    const message = toUserMessage(new Error("SQLITE_CONSTRAINT: FOREIGN KEY failed at /home/claude/secret/path.ts:42"));
    expect(message).not.toContain("SQLITE_CONSTRAINT");
    expect(message).not.toContain("/home/claude");
    expect(message).toContain("/audit");
  });
});

describe("audit trail of failures", () => {
  it("records and lists failed events, scoped to the correct guild", () => {
    recordAuditEvent({ guildId: GUILD, actorUserId: "u1", action: "summarize_generated", success: false });
    recordAuditEvent({ guildId: GUILD, actorUserId: "u1", action: "ask_answered", success: true });

    const failures = listRecentFailures(GUILD, 10);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.action).toBe("summarize_generated");
  });
});
