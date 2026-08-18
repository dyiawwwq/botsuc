# Privacy, Security & Operations Checklist

Use this before launching in a new server, before upgrading, and periodically
(recommended: quarterly) thereafter.

## Before enabling in a new server

- [ ] Run `/setup` and confirm server identity, response mode, and moderation
      intensity are intentional (not just defaults).
- [ ] Run `/config channel` for every channel the bot should read/index.
      Channels not explicitly enabled are never read.
- [ ] Confirm `/config ai` is only turned on if the server actually wants
      questions sent to an external provider — read the disclosure text the
      command replies with before doing so.
- [ ] Set `/config alerts` to a channel moderators actually watch, or reports
      and feedback will only be visible via `/audit`.
- [ ] Read `/privacy` yourself as if you were a member — does it accurately
      describe what's enabled for this server?

## Privacy review

- [ ] No sensitive personal data categories (health, political opinions,
      precise location, protected characteristics, passwords, tokens) are
      ever written to any table — confirm this hasn't drifted if you add new
      knowledge types or columns.
- [ ] `message_analysis_enabled` defaults to off and requires a channel
      allowlist (`message_analysis_channels`) — verify this wasn't changed.
- [ ] Conversation memory (`conversation_context`) stores short derived
      summaries only, never raw message transcripts — check any new code
      path that writes to this table.
- [ ] Retention (`guild_config.retention_days`) is enforced by the hourly
      sweep (`services/retention.ts`) — confirm the scheduled job is actually
      running in production logs, not just present in code.
- [ ] `/forget` and `/privacy` still work and match reality after any schema
      change (re-run `tests/retentionAndForget.test.ts`).
- [ ] Data never crosses guild boundaries — re-run
      `tests/tenantIsolation.test.ts` after any repository change.

## Security review

- [ ] `DISCORD_BOT_TOKEN` and `ANTHROPIC_API_KEY` are only in environment
      variables or a secret manager — `git grep` the repo for accidental
      hard-coded secrets before every release.
- [ ] Only the intents actually needed are requested (`src/discord/client.ts`)
      — Message Content stays off unless `ENABLE_MESSAGE_CONTENT_FEATURES`
      is deliberately set, and that's approved in the Developer Portal.
- [ ] Every admin command re-checks `isAuthorizedAdmin` server-side — never
      trust Discord's client-side command visibility alone.
- [ ] Prompt-injection defenses (`services/promptGuard.ts`) are applied to
      every piece of server-sourced text (questions, knowledge content,
      message content) before it reaches an AI provider.
- [ ] AI provider output is never used to trigger an action, only displayed
      as text — confirm this invariant if you add new AI-touching code.
- [ ] Rate limits (`services/rateLimiter.ts`) are applied to every
      user-triggerable command that writes data or calls an external API.
- [ ] Dependencies are current: `npm audit` and `npm outdated` before each
      release.
- [ ] The bot process runs as a non-root user (see `Dockerfile`).

## Monitoring

- [ ] `/status` and `/audit` are checked periodically by an administrator,
      not just available.
- [ ] Structured logs (`pino`, `src/util/logger.ts`) are shipped somewhere
      durable in production (not just container stdout that gets rotated
      away) so failures are diagnosable after the fact.
- [ ] Alerting exists (even a simple uptime check) for the bot process going
      offline, since Discord gives no other signal that commands have
      stopped responding.

## Backups

- [ ] The SQLite file (`DATABASE_FILE`, default `./data/bot.sqlite3`) is
      backed up on a schedule appropriate to how much you'd mind losing
      (knowledge entries are admin-authored and not trivially reconstructed).
- [ ] Backups are encrypted at rest and access-restricted — they contain the
      same data the bot does, so they deserve the same protection.
- [ ] A restore has actually been tested at least once, not just taken.

## Ongoing maintenance

- [ ] Re-run `npm run typecheck && npm test` before every deploy.
- [ ] Re-read Discord's Developer Policy and Terms of Service periodically —
      intents, verification thresholds, and data-handling rules do change.
- [ ] Revisit `ANTHROPIC_MODEL` and the Anthropic API docs occasionally —
      model names and capabilities are updated over time.
- [ ] If you add a new knowledge type, command, or table, add it to this
      checklist and to `tests/`.
