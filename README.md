# Discord Community Knowledge Bot

A configurable Discord bot that helps a server document and answer questions
about its own rules, channels, FAQs, and norms — with privacy-first defaults,
admin-controlled configuration, and no autonomous moderation actions.

- **Local-first by default.** Out of the box, `/ask` and `/rules` answer from
  admin-approved knowledge using local keyword matching. No message content
  or question text leaves the machine running the bot unless an admin
  explicitly runs `/config ai enabled:true`.
- **Nothing is read without permission.** The bot only reads a channel's
  message content if an admin explicitly enables that channel with
  `/config channel ... read:true`, and only if the bot operator has enabled
  the Message Content intent.
- **No silent moderation.** The bot can remind members of rules, collect
  reports/feedback, and suggest a next step — it never kicks, bans, times
  out, or deletes anything on its own.
- **Tenant-isolated.** Every server's configuration, knowledge, and
  conversation memory is scoped to that server's Discord guild ID and is
  never exposed to another server.

## Feature summary

| Command | Who | Purpose |
|---|---|---|
| `/setup` | Admin | Guided first-run configuration (modal + buttons) |
| `/config` | Admin | View/change identity, moderation, response mode, channels, admin roles, AI, alerts, retention, message analysis |
| `/knowledge add\|edit\|list\|delete\|reset\|export` | Admin | Manage approved server knowledge |
| `/rules` | Everyone | Show rules, or ask a rule-specific question |
| `/ask` | Everyone | Ask about approved server knowledge |
| `/summarize` | Admin | Summarize a permitted channel over a time window, with a save-or-discard confirmation |
| `/feedback` | Everyone | Report a wrong answer or suggest a knowledge update |
| `/report` | Everyone | Report a message/behavior for human moderator review |
| `/privacy` | Everyone | Live, accurate explanation of what's processed/stored |
| `/forget` | Everyone | Delete your own conversation memory, feedback, and self-filed reports |
| `/status` | Admin | Enabled features, data sources, recent failures |
| `/audit` | Admin | Recent configuration changes and notable actions |

`/report` is an addition beyond the ten explicitly-numbered commands in the
original spec — added because the Core Requirements call for a "reports"
moderation-support feature and `/feedback` is scoped to correcting bot
answers rather than reporting member conduct.

## Prerequisites

- Node.js 20+
- A Discord account and a server where you can add applications
- (Optional) An Anthropic API key, only if you want AI-generated answers
  instead of local keyword matching

## 1. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Under **Bot**, click **Reset Token** and copy it → this is `DISCORD_BOT_TOKEN`.
3. Still under **Bot**, leave **Message Content Intent** OFF unless you plan
   to use `/summarize` or message-analysis (see step 5).
4. Under **OAuth2 → General**, copy the **Client ID** → this is `DISCORD_CLIENT_ID`.
5. Under **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Send Messages`, `Read Message History`, `Embed Links`,
     `Attach Files`, `Use Slash Commands`. Add `Read Messages/View Channels`
     if you'll enable `/summarize`.
   - Open the generated URL and add the bot to your test server.

## 2. Local development

```bash
git clone <this-repo>
cd discord-community-bot
cp .env.example .env
# edit .env: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, and (for fast iteration)
# DISCORD_DEV_GUILD_ID set to your test server's ID.

npm install
npm run migrate          # creates ./data/bot.sqlite3 with the schema applied
npm run deploy-commands  # registers slash commands (instant if DISCORD_DEV_GUILD_ID is set)
npm run dev              # starts the bot with auto-reload
```

Run `/setup` in your test server, then `/knowledge add` to add your first
rule or FAQ, then try `/ask`.

### Enabling AI-generated answers (optional)

By default every server runs on local keyword matching — nothing is sent
anywhere. To enable Anthropic-generated answers for a specific server:

1. Set `ANTHROPIC_API_KEY` in `.env` (operator-level switch).
2. In that Discord server, an admin runs `/config ai enabled:true provider:anthropic`.

Both steps are required — setting the key alone does not opt any server in.
`ANTHROPIC_MODEL` defaults to `claude-sonnet-5`; check
[Anthropic's model documentation](https://docs.claude.com/en/docs/about-claude/models/overview)
for current model names if you want to change it.

### Enabling `/summarize` and message analysis (optional)

1. Enable **Message Content Intent** for your application in the Developer
   Portal (Bot tab). If your bot is in 100+ servers, Discord requires this be
   approved via bot verification first.
2. Set `ENABLE_MESSAGE_CONTENT_FEATURES=true` in `.env` and restart.
3. Per server, an admin runs `/config channel channel:#some-channel read:true`
   to allow `/summarize` there, and/or
   `/config message-analysis enabled:true channel:#some-channel action:add`
   for the opt-in aggregate-pattern feature.

## 3. Testing

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest — permissions, tenant isolation, retention/forget,
                     # prompt-injection & hallucination-prevention, failure scenarios
```

All tests run against an in-memory SQLite database with the real schema
applied — no real Discord connection or API key is needed.

## 4. Production deployment

### Option A — Docker

```bash
cp .env.example .env   # fill in real values
docker compose build
docker compose run --rm bot npm run deploy-commands   # register commands once
docker compose up -d
```

The SQLite file persists in the `bot-data` named volume across restarts.

### Option B — Plain Node (systemd, PM2, etc.)

```bash
npm ci
npm run build
npm run migrate
npm run deploy-commands
NODE_ENV=production node dist/index.js
```

Point your process manager at `node dist/index.js` with the same
environment variables from `.env`, and give it a persistent working
directory for `DATABASE_FILE`.

### Option C — Render (deploy from GitHub)

A `render.yaml` Blueprint is included, so Render can provision everything
from one file. Two things to know before you start:

- **Discord bots need a Background Worker, not a Web Service.** The bot
  holds a persistent connection to Discord's gateway and never receives
  inbound HTTP requests, which is exactly what a Background Worker is for.
  Render's free tier does **not** include Background Workers — pricing is
  from ~$7/month (Starter plan) plus ~$0.25/month for a 1 GB disk. A free
  Web Service would spin down after 15 minutes of no inbound traffic, which
  would repeatedly disconnect the bot — not a workable substitute.
- **The SQLite file needs a persistent disk**, or every deploy/restart wipes
  your knowledge base, config, and audit log. `render.yaml` already attaches
  a 1 GB disk at `/data` and points `DATABASE_FILE` at it — 1 GB is enough
  for a very long time at this bot's data sizes.

**Steps:**

1. Push this project to a new GitHub repository (see below if you haven't already).
2. In the Render dashboard: **New > Blueprint**, connect your GitHub account, and select the repo. Render reads `render.yaml` automatically.
3. Render will prompt you for the env vars marked `sync: false` — enter your real `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, and (optionally) `ANTHROPIC_API_KEY` there. They're never stored in the repo.
4. Click **Apply** to create the worker + disk and deploy.
5. From your own machine (not on Render — this just needs your bot token and talks directly to Discord's API), register the slash commands once, and again any time you add/change a command:
   ```bash
   DISCORD_BOT_TOKEN=... DISCORD_CLIENT_ID=... npm run deploy-commands
   ```
6. Watch the deploy logs in Render for `Bot is online` (from `src/index.ts`'s ready handler) to confirm it connected.

**Pushing to GitHub**, if you haven't yet:
```bash
cd discord-community-bot
git init                                   # skip if already a git repo
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```
`.gitignore` already excludes `node_modules/`, `data/`, and `.env`, so
secrets and local runtime data won't end up in the repo or on GitHub.

The bot process itself runs the retention sweep hourly and the message-
analysis sweep daily via `setInterval` (see `src/index.ts`). If you run
multiple short-lived instances (serverless, scale-to-zero) instead of one
long-lived process, run these as external cron jobs instead:

```bash
node -e "import('./dist/services/retention.js').then(m => m.runRetentionSweep())"
```

## Project structure

```
src/
  config/       env var loading & validation (zod)
  db/           SQLite client, migration runner, repositories/ (one per entity, all guild-scoped)
  discord/      Discord client factory, command registration, interaction router
  commands/     one file per slash command
  services/     permissions, rate limiting, retrieval, prompt-injection defenses,
                moderation support, retention, message-analysis, aiProvider/ (swappable)
  util/         logger, errors, duration parsing
  types/        shared domain types
db/schema.sql   the full relational schema
tests/          vitest suite (see Testing above)
```

Each layer is designed to be replaced independently: swap `db/repositories/*`
for a Postgres client without touching commands; swap `services/retrieval.ts`
for an embedding-based retriever without touching the AI providers; add a new
`services/aiProvider/*Provider.ts` without touching retrieval or commands.

## Known limitations

- **Retrieval is lexical, not semantic.** `services/retrieval.ts` does
  keyword-overlap scoring, not embeddings. It works well for a knowledge
  base of typical community size but will miss paraphrased questions that
  share no words with the stored entry. Swap in an embedding-based
  retriever behind the same `scoreEntries`/`retrieve` signature if you need
  semantic matching at scale.
- **Rate limiting and the retrieval index are in-memory and per-process.**
  A horizontally-scaled (multiple bot instances) deployment needs a shared
  store (e.g. Redis) for both — this template assumes one process, which
  covers the vast majority of community-sized deployments.
- **No autonomous moderation actions.** By design, the bot never kicks,
  bans, times out, or deletes messages — `/report` and rule reminders only
  produce suggestions for a human moderator. Wiring an actual action would
  need an explicit human-approval step (e.g. a button click by an
  authorized moderator) before calling Discord's moderation endpoints.
- **`response_mode: mention_only` behaves like `public`** in this
  implementation, since every interaction is a slash command (an inherently
  explicit invocation). A future version could add real free-text
  `@mention` handling in permitted channels using the Message Content
  intent for a more conversational feel.
- **SQLite, not Postgres, by default.** This keeps the template
  dependency-light and easy to self-host, but a single file has real
  concurrency and horizontal-scaling ceilings. The repository layer
  (`src/db/repositories/*`) is plain SQL specifically so swapping the driver
  for `pg` is a contained change if you outgrow it.
- **AnthropicProvider isn't covered by the automated test suite** (see
  Testing) since that would require a live API key and network call. Its
  pure-logic dependencies (prompt sanitization, retrieval gating) are
  tested; the provider itself should be checked manually against a staging
  server before relying on it in production.
- **Encryption at rest** is a deployment concern, not application code: run
  the SQLite file (or Postgres, if you migrate) on an encrypted volume/disk
  in production. There's little sensitive data to encrypt at the field
  level by design, since the schema deliberately avoids storing message
  transcripts, tokens, or protected-characteristic data.

See [`PRIVACY_SECURITY_CHECKLIST.md`](./PRIVACY_SECURITY_CHECKLIST.md) before
each launch or upgrade.
