import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./client.js";
import { logger } from "../util/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Applies db/schema.sql. Every statement in that file uses
 * `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, so re-running
 * this on every boot is safe and idempotent. For schema changes beyond v1,
 * replace this with a proper numbered-migration runner (e.g. a small
 * `db/migrations/NNN_description.sql` folder applied in order and tracked in
 * `schema_migrations`) — that table already exists for this purpose.
 */
export function runMigrations(): void {
  const schemaPath = path.resolve(__dirname, "../../db/schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");
  const db = getDb();
  db.exec(sql);
  logger.info("Schema migrations applied");
}

// Allow `npm run migrate` to apply the schema without starting the bot.
if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  runMigrations();
}
