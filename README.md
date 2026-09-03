# Pixie Template

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/github?repo=rickyparmar-raw%2Fpixie-template)

A forkable Slack bot for a Hack Club YSWS. It answers from your program's official docs and FAQ, handles images and code-help questions, offers maintainers a reviewable teaching workflow, and runs through Socket Mode with one HCAI key.

This repository intentionally contains no Slack tokens, channel IDs, database, organizer messages, or program-specific rules.

## Fork and configure

1. Click **Fork** on GitHub, then clone your fork.
2. Install [Bun](https://bun.sh), then run `bun install`.
3. Copy `.env.example` to `.env` and add your private Slack and HCAI credentials.
4. Replace every placeholder in `programs.json`, or set `PIXIE_PROGRAMS_JSON` using `programs.template.json` as a starting point.
5. Generate a manifest with your chosen bot name and command slug:

```bash
PIXIE_BOT_NAME="my-ysws-bot" PIXIE_BOT_SLUG=my-ysws-bot bun run manifest > slack-manifest.json
```

6. In Slack, create an app **From a manifest**, paste `slack-manifest.json`, enable Socket Mode, create an `xapp-` token with `connections:write`, and install the app.
7. Invite the bot to the channels listed in your program configuration, then start it:

```bash
bun start
```

## Required environment variables

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
HCAI_API_KEY=...
SLACK_HELP_CHANNEL=C0000000000
SLACK_FAQ_CHANNELS=C0000000000,C1111111111
PIXIE_BOT_NAME=my-ysws-bot
PIXIE_BOT_SLUG=my-ysws-bot
PIXIE_ADMIN_USER_IDS=U0000000000
```

All model calls use the one `HCAI_API_KEY`. The current no-credit default is `openrouter/free`; set `HCAI_MODEL` or a task-specific `HCAI_*_MODEL` only when your HCAI account can use that model.

## Program configuration

`programs.json` is a safe placeholder and is the first file to edit after forking. A program needs:

- a unique `id` and display `name`;
- its help/FAQ channel IDs in `helpChannel` and `channels`;
- official docs under `sources` (`url`, `github-dir`, `json-faq`, or `text`);
- its `posture` (`active`, `passive`, or `muted`) and answer `scope`.

Keep rules, eligibility, dates, rewards, and policy answers in official sources. The bot refuses to invent facts when the docs do not cover a question.

## Verify locally

```bash
bun test
PIXIE_BOT_NAME="my-ysws-bot" PIXIE_BOT_SLUG=my-ysws-bot bun run manifest
bun start
```

The bot logs `connected via Socket Mode` once Slack is connected. Do not commit `.env` or a SQLite database.

## Slack app scopes

The generated manifest includes the needed bot scopes: message history for public/private channels and DMs, `chat:write`, `commands`, reactions, file reading, and app mentions. The app-level token needs `connections:write`.

## Deploying

Click the button above, or open Railway's **Deploy from GitHub Repo** flow and choose your fork. Add the environment variables in the service variables screen, attach a volume, and set:

```env
PIXIE_DB_PATH=/data/pixie.db
```

Then deploy the fork. Socket Mode means you do not need an inbound webhook URL.
