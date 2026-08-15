# 🚀 Pixie Deployment Guide

Follow this guide to deploy your own instance of Pixie in under 5 minutes.

---

## 📋 Prerequisites

1. **Slack Workspace Admin Access** (or permission to create and install Slack apps).
2. **Hack Club AI Key** from **[ai.hackclub.com](https://ai.hackclub.com)** (or OpenRouter/OpenAI API key).
3. **Railway Account** (or any Node.js/Docker host).

---

## Step 1: Create Your Slack App

1. Go to **[api.slack.com/apps](https://api.slack.com/apps)** and click **Create New App**.
2. Select **From an app manifest**.
3. Pick your workspace.
4. Run `bun scripts/manifest.cjs` in this repo and paste the JSON output into the manifest editor.
5. Click **Create**.

---

## Step 2: Retrieve Slack Tokens

1. **Bot Token (`xoxb-...`):** Go to **OAuth & Permissions** ➔ Install to Workspace ➔ Copy **Bot User OAuth Token**.
2. **App Token (`xapp-...`):** Go to **Basic Information** ➔ Scroll down to **App-Level Tokens** ➔ Generate a token with the `connections:write` scope ➔ Copy the token.

---

## Step 3: Configure Your Knowledge Sources

Copy `sources.example.json` to `sources.json`:

```json
[
  {
    "name": "My Project Docs",
    "type": "github-dir",
    "owner": "your-username",
    "repo": "your-repo",
    "path": "docs",
    "branch": "main"
  }
]
```

---

## Step 4: Deploy to Railway (1-Click)

1. Click **Deploy on Railway** (or link your forked repository in Railway).
2. Add a **Persistent Volume** mounted at `/data` (to preserve SQLite metrics & taught answers across restarts).
3. Set the following environment variables:
   * `SLACK_BOT_TOKEN="xoxb-..."`
   * `SLACK_APP_TOKEN="xapp-..."`
   * `HCAI_API_KEY="your-key-from-ai.hackclub.com"`
   * `SLACK_HELP_CHANNEL="C0..."`
4. Deploy! Your bot will connect via Socket Mode automatically.
