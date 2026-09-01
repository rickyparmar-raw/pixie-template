// Assembled from apps/pixie/README.md's "Slack App Setup" section and the
// slash-command table there — not yet diffed against a real Slack-exported
// manifest (plan §2 step 4 flags this as required before trusting it blind).

const BOT_SCOPES = [
  "chat:write",
  "channels:history",
  "groups:history",
  "channels:join",
  "app_mentions:read",
  "reactions:read",
  "reactions:write",
  "commands",
  "im:history",
  "im:write",
  "channels:read",
  "groups:read",
  "files:read",
];

const BOT_EVENTS = [
  "message.channels",
  "message.groups",
  "message.im",
  "app_mention",
  "reaction_added",
  "reaction_removed",
  "app_home_opened",
  "member_joined_channel",
];

// Command suffixes, not full names. The engine registers exactly this set from
// its own slug (lib/brand.js, lib/commands.js register()), so generating both
// sides from a suffix list is what stops the manifest advertising /sol-teach
// while the process listens for /pixie-teach.
//
// `null` is the bare ask command (/sol). Order here is the order Slack shows
// them in, so the two everyone uses come first.
const SLASH_COMMANDS: Array<{ suffix: string | null; description: string; usage_hint?: string }> = [
  { suffix: null, description: "Private answer — help without cluttering the channel", usage_hint: "[question]" },
  { suffix: "guide", description: "Interactive step-by-step walkthrough guides", usage_hint: "[guide-name]" },
  { suffix: "sources", description: "What's loaded and when it last refreshed" },
  { suffix: "stats", description: "Answer rate, cache hits, feedback, latency" },
  { suffix: "gaps", description: "Top questions the docs didn't cover" },
  { suffix: "report", description: "The weekly report now", usage_hint: "[last]" },
  { suffix: "teach", description: "Teach an answer directly", usage_hint: "<question> :: <answer>" },
  { suffix: "pending", description: "Captured answers awaiting review" },
  { suffix: "approve", description: "Start using a captured answer", usage_hint: "<n>" },
  { suffix: "forget", description: "Drop answer(s) by id, range, pending, or all", usage_hint: "<target>" },
  { suffix: "reload", description: "Re-fetch the docs and clear the cache, no restart" },
  { suffix: "program", description: "Manage multi-program channels and posture", usage_hint: "[list|add|set|remove]" },
];

// Mirrors lib/brand.js slug(): Slack rejects spaces and uppercase in command
// names, so a display name has to be slugified before it can become one. Kept in
// sync deliberately — if this diverges, the manifest and the listeners diverge.
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pixie"
  );
}

export function commandName(slug: string, suffix: string | null): string {
  return suffix ? `/${slug}-${suffix}` : `/${slug}`;
}

// Every command name this bot will claim. Exported so the wizard can show them
// live as the user types a slug, and so a slug collision against another bot in
// the workspace can be checked before the app is created — Slack command names
// are unique per workspace and every fleet bot shares the Hack Club one.
export function commandNamesFor(slug: string): string[] {
  return SLASH_COMMANDS.map((c) => commandName(slug, c.suffix));
}

export function generateSlackManifest(botName: string, programName: string, botSlug?: string) {
  const slug = slugify(botSlug || botName);

  return {
    display_information: {
      name: botName,
      description: `Answers questions from ${programName}'s docs, right in Slack.`,
      background_color: "#ec3750",
    },
    features: {
      bot_user: {
        display_name: botName,
        always_online: true,
      },
      slash_commands: SLASH_COMMANDS.map((c) => ({
        command: commandName(slug, c.suffix),
        description: c.description,
        ...(c.usage_hint ? { usage_hint: c.usage_hint } : {}),
        should_escape: false,
      })),
      shortcuts: [
        {
          name: `Teach ${botName} from thread`,
          type: "message",
          // Underscored to match lib/brand.js id(). Callback ids are per-app so a
          // collision is impossible, but keeping them slugged makes a payload in
          // the logs traceable to a bot.
          callback_id: `${slug.replace(/-/g, "_")}_teach_thread`,
          description: "Capture this thread as a taught answer for review",
        },
      ],
      app_home: {
        home_tab_enabled: true,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
    },
    oauth_config: {
      scopes: {
        bot: BOT_SCOPES,
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: BOT_EVENTS,
      },
      interactivity: {
        is_enabled: true,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };
}
