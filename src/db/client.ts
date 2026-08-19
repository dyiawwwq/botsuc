import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { logger } from "../util/logger.js";

let dbInstance: Database.Database | null = null;

/**
 * Returns a singleton better-sqlite3 connection. better-sqlite3 is
 * synchronous and safe to share across the process (Node is single
 * threaded); this avoids connection-pool complexity for a template of this
 * size. For a multi-instance production deployment, swap this module for a
 * Postgres client (e.g. `pg`) behind the same repository interfaces in
 * src/db/repositories — those were written against plain SQL to keep that
 * swap contained.
 */
export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = env.DATABASE_FILE;
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  dbInstance = db;
  logger.info({ dbPath }, "Database connection opened");
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    logger.info("Database connection closed");
  }
}

/** Test-only helper: force a fresh in-memory database (see tests/setupTestDb.ts). */
export function resetDbForTests(db: Database.Database): void {
  dbInstance = db;
}
