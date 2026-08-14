# 🎨 Custom Bot Rebranding & Manifests

Pixie can be renamed and rebranded for any Hack Club program or community (e.g. `Sol`, `Blaze`, `Orb`, `Nova`) with zero code modifications.

---

## 🏷️ Setting Your Bot Name & Slug

In your `.env` or deployment variables, set:

```bash
PIXIE_BOT_NAME="Sol"
PIXIE_BOT_SLUG="sol"
```

When set:
* All slash commands automatically adapt: `/sol`, `/sol-stats`, `/sol-sources`, `/sol-teach`.
* Identity and personality automatically adapt to your custom name.
* Message shortcuts adapt to `Teach Sol from thread`.

---

## 📋 Generating Your Custom Slack Manifest

Whenever you change your bot name or slug, generate your matching Slack App Manifest:

```bash
bun scripts/manifest.cjs
```

Or for a specific brand:

```bash
PIXIE_BOT_NAME="Sol" PIXIE_BOT_SLUG="sol" bun scripts/manifest.cjs
```

Copy the JSON output into **[api.slack.com/apps](https://api.slack.com/apps)** ➔ **App Manifest** to keep Slack in 100% sync!
