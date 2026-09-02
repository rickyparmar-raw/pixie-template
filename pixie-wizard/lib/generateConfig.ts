import type { PixieTrialRow, DocSource } from "@/lib/types";

// Same defaults the wizard offered in step 2 (app/wizard/actions.ts) — repeated
// here rather than imported so this module has no "use server" dependency and
// stays callable from a plain script/test.
const HCAI_BASE_URL = "https://ai.hackclub.com/proxy/v1";
const DEFAULT_HCAI_MODEL = "openrouter/free";

// Where the engine keeps its SQLite file. Must sit on the Railway volume — the
// default path is next to the code, which a redeploy replaces, taking the answer
// cache, learned facts, ticket records and last-good docs copy with it.
export const VOLUME_MOUNT_PATH = "/data";
export const DB_PATH = `${VOLUME_MOUNT_PATH}/pixie.db`;

// Every guide is available to every bot, but the YSWS submission walkthrough is
// the one that applies to all of them, so it's the default when the wizard hasn't
// asked yet.
const DEFAULT_GUIDES = ["submit-ysws-guidelines"];

// Trimmed relative to apps/pixie/lib/identity.js's own IDENTITY block — no
// "who made you" or "are you pixorpheus" pairs, since neither is true for a
// trial deployed elsewhere. See that file's PIXIE_IDENTITY_OVERRIDE support.
//
// The slash command has to be the bot's real one. This used to say "/pixie"
// verbatim, which meant every deployed bot told users to run a command its Slack
// app doesn't have.
export function generateIdentityOverride(botName: string, programName: string, slug?: string): string {
  const askCommand = `/${slug || "pixie"}`;
  return [
    "Q: Who are you? / What are you? / Introduce yourself",
    `A: I'm ${botName} — the Slack bot for ${programName}. I answer questions from ${programName}'s docs and FAQ, help debug code and screenshots, and walk people through setup. If I don't know something, ask a helper in the channel.`,
    "",
    "Q: How are you? / How's it going?",
    `A: Just a bot vibing — chatting and answering questions. Ask me anything about ${programName}.`,
    "",
    "Q: What can you do? / How do I use you?",
    `A: Ping me or say my name anywhere, DM me, or use ${askCommand} <question> for a private answer. I can also read screenshots and error messages if you upload them.`,
  ].join("\n");
}

export interface TrialSecrets {
  botToken: string;
  appToken: string;
  llmKey: string;
  firecrawlKey?: string;
}

const SECRET_ENV_KEYS = new Set(["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "HCAI_API_KEY", "FIRECRAWL_API_KEY"]);

// A stable program id for the engine's registry. It keys forChannel(), get() and
// posture() lookups, so it has to be a slug, not a display name with spaces.
export function programIdFor(trial: PixieTrialRow): string {
  const explicit = trial.program_slug || trial.bot_slug;
  if (explicit) return explicit;
  return (
    (trial.program_name || "program")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "program"
  );
}

// Normalizes a source row into what the engine's lib/knowledge.js expects. It
// keys its cache and citations on `name`, so a source that only has the wizard's
// older `label` field would otherwise arrive nameless and be dropped by
// loadSources().
function normalizeSource(source: DocSource, index: number): Record<string, unknown> {
  const name = source.name || source.label || `Source ${index + 1}`;
  const out: Record<string, unknown> = { name, type: source.type };
  if (source.url) out.url = source.url;
  if (source.siteUrl) out.siteUrl = source.siteUrl;
  // Inline content travels in the blob and needs no URL at all — that's how a
  // FAQ typed into the wizard reaches a shared image with no file to point at.
  if (source.content !== undefined && source.content !== null) out.content = source.content;
  return out;
}

// The whole per-bot config, as the one variable the engine's program registry
// reads (lib/programs.js loadEnvPrograms). This is the fix for the wizard's worst
// bug: sources were collected, stored, and then never sent, so every provisioned
// bot fell through to the image's own sources.json and answered from Pixl's docs.
//
// Everything program-shaped goes here rather than into a variable of its own —
// posture, scope, guides and milestones have no env path in the engine and never
// will, so one renderer is the whole contract.
export function renderProgramsJson(trial: PixieTrialRow): string {
  const faqChannels = (trial.channels?.faqChannels ?? []).map((c) => c.id);
  const helpChannel = trial.channels?.helpChannel?.id ?? null;

  // The engine treats channels as "where this program lives" and helpChannel as
  // the escalation target, which is normally also one of them.
  const channels = helpChannel && !faqChannels.includes(helpChannel) ? [helpChannel, ...faqChannels] : faqChannels;

  const program = {
    id: programIdFor(trial),
    name: trial.program_name,
    posture: trial.posture || "active",
    // Defaults to "program": a single-program bot answering unaddressed
    // questions about anything is the surprising behaviour, not the safe one.
    scope: trial.scope || "program",
    helpChannel,
    channels,
    sources: (trial.sources ?? []).map(normalizeSource),
    milestones: trial.milestones ?? [],
    guides: trial.guides ?? DEFAULT_GUIDES,
    links: {},
  };

  return JSON.stringify({ programs: [program] });
}

export function generateTrialEnv(trial: PixieTrialRow, secrets: TrialSecrets): Record<string, string> {
  const model = trial.llm_model || DEFAULT_HCAI_MODEL;
  const botName = trial.bot_name || trial.program_name;
  const slug = trial.bot_slug || programIdFor(trial);

  const env: Record<string, string> = {
    SLACK_BOT_TOKEN: secrets.botToken,
    SLACK_APP_TOKEN: secrets.appToken,
    HCAI_API_KEY: secrets.llmKey,
    PIXIE_IDENTITY_OVERRIDE: generateIdentityOverride(botName, trial.program_name, slug),

    // The bot's own name and command prefix. Everything user-facing derives from
    // these, so the deployed bot calls itself Sol and answers /sol rather than
    // introducing itself as pixie.
    PIXIE_BOT_NAME: botName,
    PIXIE_BOT_SLUG: slug,

    // Sources, channels, posture, scope, guides, milestones — see
    // renderProgramsJson. Without this the bot answers from the image's docs.
    PIXIE_PROGRAMS_JSON: renderProgramsJson(trial),

    // On the Railway volume, so a redeploy doesn't wipe the database. Paired with
    // the volume created in provisionTrial — setting this without a volume mounted
    // at VOLUME_MOUNT_PATH is worse than not setting it, because the writes then
    // land somewhere that silently disappears.
    PIXIE_DB_PATH: DB_PATH,
  };

  if (trial.channels?.helpChannel) env.SLACK_HELP_CHANNEL = trial.channels.helpChannel.id;
  const faq = trial.channels?.faqChannels ?? [];
  if (faq.length > 0) env.SLACK_FAQ_CHANNELS = faq.map((c) => c.id).join(",");

  // Fails closed in the engine (isAdmin returns false on an empty list), so an
  // empty value here means nobody can ever teach this bot anything. The requester
  // is always included by the wizard for exactly that reason.
  const admins = trial.admin_slack_ids?.length
    ? trial.admin_slack_ids
    : trial.requester_slack_id
      ? [trial.requester_slack_id]
      : [];
  if (admins.length > 0) env.PIXIE_ADMIN_USER_IDS = admins.join(",");

  if (model !== DEFAULT_HCAI_MODEL) env.HCAI_MODEL = model;

  if (secrets.firecrawlKey) env.FIRECRAWL_API_KEY = secrets.firecrawlKey;

  // Unset disables the escalation handoff entirely, which is a reasonable default
  // but must be a choice rather than an accident of the wizard not sending it.
  if (trial.escalate_reaction) env.PIXIE_ESCALATE_REACTION = trial.escalate_reaction;
  if (trial.feedback_reactions?.length) env.PIXIE_FEEDBACK_REACTIONS = trial.feedback_reactions.join(",");

  // Where the weekly report goes. The engine already defaults this to the help
  // channel, so only send it when the bot wants it somewhere else.
  if (trial.report_channel && trial.report_channel !== trial.channels?.helpChannel?.id) {
    env.PIXIE_REPORT_CHANNEL = trial.report_channel;
  }

  if (trial.refresh_interval_min && trial.refresh_interval_min > 0) {
    env.REFRESH_INTERVAL_MIN = String(trial.refresh_interval_min);
  }

  return env;
}

// What actually gets written to config_snapshot — same map minus the values
// that are secrets, so the audit trail in Supabase never holds a live token.
export function redactEnvForSnapshot(env: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    redacted[key] = SECRET_ENV_KEYS.has(key) ? "(hidden)" : value;
  }
  return redacted;
}
