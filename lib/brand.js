// Who this deployment is, by name.
//
// One engine image serves every bot in the fleet, so the words "pixie" and the
// command "/pixie" cannot be literals scattered through the code — a bot deployed
// for Solvable has to call itself Sol and answer /sol. Everything user-facing
// reads its name from here.
//
// Both values default to today's pixie identity, so a deployment that sets
// neither behaves exactly as it did before this module existed.

// Display name, for prose the user reads: "I'm Sol", "Sol is still loading".
const DEFAULT_NAME = "pixie";
// Command prefix. Slash command names are unique per Slack workspace and every
// bot in the fleet shares one, so this has to differ per bot or the second app
// fails to install.
const DEFAULT_SLUG = "pixie";

function envValue(name) {
  return (process.env[name] || "").trim();
}

// Read through a function rather than captured at require time: the test suite
// shares one process, so a module-level snapshot would freeze whichever value the
// first test file happened to set.
function name() {
  return envValue("PIXIE_BOT_NAME") || DEFAULT_NAME;
}

// A slug is going into a slash command, so it has to be a slug: Slack rejects
// spaces and uppercase in command names, and a bot named "Sol Helper" must not
// produce "/Sol Helper-teach".
function slug() {
  const raw = envValue("PIXIE_BOT_SLUG") || envValue("PIXIE_BOT_NAME") || DEFAULT_SLUG;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || DEFAULT_SLUG;
}

// The command name for a given suffix: cmd() -> "/sol", cmd("teach") ->
// "/sol-teach". One helper for both the Bolt registration and the help text, so
// what the bot listens for and what it tells people to type cannot drift.
function cmd(suffix = "") {
  return suffix ? `/${slug()}-${suffix}` : `/${slug()}`;
}

// For Slack payload ids (shortcut callback_ids, action_ids) — underscores, since
// those aren't slash commands and read better unhyphenated.
function id(suffix) {
  return `${slug().replace(/-/g, "_")}_${suffix}`;
}

module.exports = { name, slug, cmd, id, DEFAULT_NAME, DEFAULT_SLUG };
