import { deleteExpiredConversationContext } from "../db/repositories/conversationRepo.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";
import { pruneRateLimitBuckets } from "./rateLimiter.js";
import { logger } from "../util/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionDaysToTtlMs(retentionDays: number): number {
  return Math.max(1, retentionDays) * DAY_MS;
}

/**
 * Deletes conversation_context rows whose expires_at has passed. Each
 * conversation_context row's expiry is set at write time from the owning
 * guild's configured retention_days (see commands/ask.ts), so this sweep
 * doesn't need to look at guild_config itself — it just enforces expiries
 * that were already computed correctly.
 *
 * Runs on an interval from index.ts. Can equally be invoked from an
 * external cron job by running `tsx -e "import('./src/services/retention.js').then(m=>m.runRetentionSweep())"`
 * against a deployment that isn't running the long-lived bot process.
 */
export function runRetentionSweep(): { deletedConversationRows: number } {
  const deletedConversationRows = deleteExpiredConversationContext();
  pruneRateLimitBuckets(60 * 60 * 1000);

  if (deletedConversationRows > 0) {
    logger.info({ deletedConversationRows }, "Retention sweep completed");
  }

  return { deletedConversationRows };
}

/** Records a system-level audit event (no single guild "actor") for a completed sweep, for a given guild's /audit view. */
export function recordRetentionAuditEvent(guildId: string, deletedRows: number): void {
  if (deletedRows === 0) return;
  recordAuditEvent({
    guildId,
    actorUserId: "system:retention",
    action: "retention_sweep",
    metadata: { deletedConversationRows: deletedRows },
  });
}
