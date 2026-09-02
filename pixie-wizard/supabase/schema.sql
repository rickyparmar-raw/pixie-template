-- Pixie Trial Deployment Wizard schema. Run once against whichever Supabase
-- project SUPABASE_URL/SUPABASE_SERVICE_KEY point at — the existing Pixl
-- project or a dedicated one, either works, see .env.example.
--
-- All *_encrypted columns hold ciphertext written by lib/crypto.ts
-- (AES-256-GCM, WIZARD_ENCRYPTION_KEY) — never plaintext secrets. This table
-- is the highest-value secret surface in the monorepo: live Railway account
-- tokens plus per-trial Slack/LLM keys for external orgs. See plan §7.

create extension if not exists pgcrypto;

create table if not exists railway_account_pool (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  api_token_encrypted text not null,
  max_concurrent_trials int not null default 3,
  current_trial_count int not null default 0,
  cooling_until timestamptz,
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists pixie_trials (
  id uuid primary key default gen_random_uuid(),

  requester_hca_id text not null,
  requester_email text not null,
  requester_name text not null,
  requester_slack_id text,

  program_name text,
  program_description text,
  bot_name text,

  status text not null default 'draft'
    check (status in (
      'draft', 'awaiting_slack_credentials', 'provisioning',
      'active', 'paused', 'deleted', 'failed'
    )),

  railway_account_pool_id uuid references railway_account_pool(id),
  railway_project_id text,
  railway_service_id text,
  railway_environment_id text,

  -- Every trial installs into the one Hack Club workspace, so these are
  -- denormalized from auth.test rather than a per-trial choice — kept here
  -- (not hardcoded) since a trial's Slack app can only confirm it after the
  -- manual manifest handshake in wizard step 4.
  slack_workspace_id text,
  slack_workspace_name text,
  slack_bot_user_id text,

  -- { helpChannel: {id, name}, faqChannels: [{id, name}] } — picked in the
  -- same session as the Slack handshake, once the trial's own bot token can
  -- list channels. Empty object until step 5 completes.
  channels jsonb not null default '{}'::jsonb,

  sources jsonb not null default '[]'::jsonb,
  config_snapshot jsonb,

  -- Base URL and model aren't secrets — only the key is. Kept alongside it
  -- rather than deferred to config_snapshot (which is the full resolved env
  -- map written at deploy time) because step 2 needs them read back to
  -- re-render the form and to re-run validateLlmKey later if the key changes.
  llm_base_url text,
  llm_model text,
  llm_key_encrypted text,
  slack_bot_token_encrypted text,
  slack_app_token_encrypted text,

  created_at timestamptz not null default now(),
  expires_at timestamptz,

  last_deploy_at timestamptz,
  last_deploy_status text,

  expiry_notified_at timestamptz,
  paused_at timestamptz,
  reclaim_deadline timestamptz,
  deleted_at timestamptz
);

-- One live trial per requester at a time. "Live" is any non-terminal status —
-- draft/awaiting_slack_credentials/provisioning/active all count, so someone
-- can't queue a second trial while mid-setup on their first either.
create unique index if not exists pixie_trials_one_live_per_requester
  on pixie_trials (requester_hca_id)
  where status in ('draft', 'awaiting_slack_credentials', 'provisioning', 'active');

create index if not exists pixie_trials_status_expires_idx
  on pixie_trials (status, expires_at);

create index if not exists pixie_trials_status_reclaim_idx
  on pixie_trials (status, reclaim_deadline);

create table if not exists trial_events (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid not null references pixie_trials(id) on delete cascade,
  event_type text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trial_events_trial_id_idx
  on trial_events (trial_id, created_at desc);
