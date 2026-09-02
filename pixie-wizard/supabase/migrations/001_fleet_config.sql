-- Migration 001: per-bot config, the volume, and the extra credential slots.
--
-- Run against the same Supabase project schema.sql created. Every statement is
-- idempotent (if not exists / if exists), so re-running it is safe.
--
-- Why these columns exist: the engine reads posture, scope, guides and milestones
-- ONLY from its program registry — there is no per-field environment variable for
-- any of them. So they are stored here and rendered into one PIXIE_PROGRAMS_JSON
-- blob at deploy time (lib/generateConfig.ts renderProgramsJson). Adding a
-- program-shaped field means a column here and a line in that renderer, never a
-- new variable to plumb through Railway.

-- The bot's identity. bot_slug is the load-bearing one: it becomes the slash
-- command prefix (/sol, /sol-teach), the Railway project name, and the program id
-- the engine keys channel lookups off.
--
-- Slack slash command names are unique per workspace and every bot in the fleet
-- shares the Hack Club workspace, so a duplicate slug means the second app fails
-- to install. Enforced below rather than checked in application code.
alter table pixie_trials add column if not exists bot_slug text;
alter table pixie_trials add column if not exists program_slug text;

create unique index if not exists pixie_trials_bot_slug_unique
  on pixie_trials (bot_slug)
  where bot_slug is not null and status <> 'deleted';

-- Program-shaped config: rendered into PIXIE_PROGRAMS_JSON, never sent alone.
-- scope defaults to 'program' because a bot answering unaddressed questions about
-- anything is the surprising behaviour, not the safe one.
alter table pixie_trials add column if not exists posture text
  check (posture is null or posture in ('active', 'passive', 'muted'));
alter table pixie_trials add column if not exists scope text
  check (scope is null or scope in ('any', 'program'));
alter table pixie_trials add column if not exists guides jsonb not null default '[]'::jsonb;
alter table pixie_trials add column if not exists milestones jsonb not null default '[]'::jsonb;

-- Behaviour knobs that DO map to their own environment variables.
--
-- admin_slack_ids fails closed in the engine (isAdmin returns false on an empty
-- list), so an empty array here means nobody can ever teach this bot anything —
-- the wizard always seeds it with the requester for that reason.
alter table pixie_trials add column if not exists admin_slack_ids jsonb not null default '[]'::jsonb;
alter table pixie_trials add column if not exists escalate_reaction text;
alter table pixie_trials add column if not exists feedback_reactions jsonb not null default '[]'::jsonb;
alter table pixie_trials add column if not exists report_channel text;
alter table pixie_trials add column if not exists refresh_interval_min int
  check (refresh_interval_min is null or refresh_interval_min > 0);
alter table pixie_trials add column if not exists enable_tickets boolean not null default false;
alter table pixie_trials add column if not exists ticket_channel text;

-- Extra credentials. The engine rotates a pool of model keys with a per-key
-- cooldown (OPENCODE_API_KEY, _2, _3…); collecting only one throws away a feature
-- it already has, and rate-limit pressure is the likeliest reason a new bot looks
-- broken in its first week. Ciphertext only, same as every other *_encrypted.
alter table pixie_trials add column if not exists llm_extra_keys_encrypted jsonb not null default '[]'::jsonb;
alter table pixie_trials add column if not exists firecrawl_key_encrypted text;

-- The Railway volume holding the bot's SQLite file. Recorded so the lifecycle
-- sweep can find it, and so its absence on an existing row is visible: a bot with
-- a null volume id is one whose database dies on the next redeploy.
alter table pixie_trials add column if not exists railway_volume_id text;

-- Fleet bookkeeping. engine_ref is 'main' for every bot today — auto-deploy on
-- push is the update mechanism — and exists so pinning one bot to a tag later
-- needs no migration.
alter table pixie_trials add column if not exists engine_ref text not null default 'main';
alter table pixie_trials add column if not exists lifecycle text not null default 'trial'
  check (lifecycle in ('trial', 'permanent'));
alter table pixie_trials add column if not exists last_smoke_test_at timestamptz;

-- A green Railway build only proves the process started, so this index supports
-- finding active bots that were never actually verified answering a question.
create index if not exists pixie_trials_lifecycle_smoke_idx
  on pixie_trials (lifecycle, last_smoke_test_at);

-- The one-live-trial-per-requester rule was right for a trial programme and is
-- wrong for a fleet: one operator owns Pixl, Twisted and everything after them.
drop index if exists pixie_trials_one_live_per_requester;

-- Pool account provenance. Multi-accounting is what Railway's fair-use
-- enforcement is built to catch, so an account's owner and plan are the record of
-- whether it is legitimately separate — a paid Hobby of its own, or owned by the
-- program lead with the operator added as a workspace member (members cost no
-- seat). token_created_at exists so rotation has a date to reason about.
alter table railway_account_pool add column if not exists owner_email text;
alter table railway_account_pool add column if not exists plan text
  check (plan is null or plan in ('free', 'hobby', 'pro'));
alter table railway_account_pool add column if not exists token_created_at timestamptz;
alter table railway_account_pool add column if not exists notes text;
