

const DEFAULT_NAME = "pixie";

const DEFAULT_SLUG = "pixie";

function envValue(name) {
  return (process.env[name] || "").trim();
}

function name() {
  return envValue("PIXIE_BOT_NAME") || DEFAULT_NAME;
}

function slug() {
  const raw = envValue("PIXIE_BOT_SLUG") || envValue("PIXIE_BOT_NAME") || DEFAULT_SLUG;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || DEFAULT_SLUG;
}

function cmd(suffix = "") {
  return suffix ? `/${slug()}-${suffix}` : `/${slug()}`;
}

function id(suffix) {
  return `${slug().replace(/-/g, "_")}_${suffix}`;
}

module.exports = { name, slug, cmd, id, DEFAULT_NAME, DEFAULT_SLUG };
