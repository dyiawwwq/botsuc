import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetDbForTests } from "../src/db/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Creates a brand-new in-memory database with the real db/schema.sql
 * applied, and points the app's DB singleton at it. Call this in a
 * `beforeEach` so every test starts from a clean, isolated database —
 * this is what makes the tenant-isolation tests trustworthy (no shared
 * state could leak between tests and mask a bug).
 */
export function freshTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.resolve(__dirname, "../db/schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  resetDbForTests(db);
  return db;
}
