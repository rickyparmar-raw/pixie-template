// Row shapes for supabase/schema.sql. *_encrypted fields are ciphertext from
// lib/crypto.ts — decrypt before use, never pass through to a client.

export type TrialStatus =
  | "draft"
  | "awaiting_slack_credentials"
  | "provisioning"
  | "active"
  | "paused"
  | "deleted"
  | "failed";

// A knowledge source for the bot's corpus.
//
// `url` and `content` are alternatives, not both: anything fetched has a url,
// while a FAQ typed into the wizard travels inline as `content` and has no url at
// all (the engine's lib/knowledge.js handles both). `name` is what the engine
// keys its cache and citations on — `label` was the old field name and is kept
// readable for rows written before the rename.
export interface DocSource {
  type: "url" | "json-faq" | "gdoc" | "github-dir" | "text" | "pixl-shop";
  name?: string;
  label?: string;
  url?: string;
  siteUrl?: string;
  content?: unknown;
}

export interface Milestone {
  name: string;
  date: string;
  note?: string;
  questions?: string[];
}

export interface ChannelRef {
  id: string;
  name: string;
}

export interface ChannelSelection {
  helpChannel?: ChannelRef;
  faqChannels?: ChannelRef[];
}

export interface PixieTrialRow {
  id: string;

  requester_hca_id: string;
  requester_email: string;
  requester_name: string;
  requester_slack_id: string | null;

  program_name: string;
  program_description: string | null;
  bot_name: string | null;

  status: TrialStatus;

  railway_account_pool_id: string | null;
  railway_project_id: string | null;
  railway_service_id: string | null;
  railway_environment_id: string | null;

  slack_workspace_id: string | null;
  slack_workspace_name: string | null;
  slack_bot_user_id: string | null;

  channels: ChannelSelection;

  // Everything program-shaped is rendered into PIXIE_PROGRAMS_JSON rather than
  // getting a variable of its own — the engine reads posture, scope, guides and
  // milestones only from the program registry (lib/programs.js), never from
  // individual env vars. See renderProgramsJson in generateConfig.ts.
  bot_slug?: string | null;
  program_slug?: string | null;
  posture?: "active" | "passive" | "muted";
  scope?: "any" | "program";
  guides?: string[];
  milestones?: Milestone[];

  enable_tickets?: boolean;
  ticket_channel?: string | null;

  // Behaviour knobs that DO map to their own variables.
  admin_slack_ids?: string[];
  escalate_reaction?: string | null;
  feedback_reactions?: string[];
  report_channel?: string | null;
  refresh_interval_min?: number | null;

  sources: DocSource[];
  config_snapshot: Record<string, string> | null;

  llm_base_url: string | null;
  llm_model: string | null;
  llm_key_encrypted: string | null;
  // The engine rotates a pool of keys with per-key cooldown (OPENCODE_API_KEY,
  // _2, _3…), so extra keys beyond the first are carried here. Kept separate from
  // llm_key_encrypted rather than replacing it, so existing rows stay valid.
  llm_extra_keys_encrypted?: string[] | null;
  firecrawl_key_encrypted?: string | null;
  slack_bot_token_encrypted: string | null;
  slack_app_token_encrypted: string | null;

  // Railway volume holding the bot's SQLite file. Without it, every redeploy
  // wipes the answer cache, learned facts and ticket records.
  railway_volume_id?: string | null;

  // Which engine ref this bot deploys from. 'main' for every bot today —
  // auto-deploy on push is the fleet update mechanism — present so pinning one
  // bot to a tag later needs no migration.
  engine_ref?: string;
  lifecycle?: "trial" | "permanent";
  // A green Railway build only proves the process started, not that the bot
  // answers anything.
  last_smoke_test_at?: string | null;

  created_at: string;
  expires_at: string | null;

  last_deploy_at: string | null;
  last_deploy_status: string | null;

  expiry_notified_at: string | null;
  paused_at: string | null;
  reclaim_deadline: string | null;
  deleted_at: string | null;
}

export interface RailwayAccountPoolRow {
  id: string;
  label: string;
  api_token_encrypted: string;
  max_concurrent_trials: number;
  current_trial_count: number;
  cooling_until: string | null;
  disabled: boolean;
  created_at: string;

  // Provenance for the account, which is what determines whether the pool is a
  // set of legitimately separate accounts or the multi-accounting pattern
  // Railway's fair-use enforcement looks for. token_created_at drives rotation.
  owner_email?: string | null;
  plan?: "free" | "hobby" | "pro" | null;
  token_created_at?: string | null;
  notes?: string | null;
}

export interface TrialEventRow {
  id: string;
  trial_id: string;
  event_type: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}
