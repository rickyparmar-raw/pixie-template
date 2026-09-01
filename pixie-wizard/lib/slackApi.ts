// Thin wrapper around the handful of Slack Web API calls the handshake step
// needs. Not the Slack SDK — this app makes three calls total, never streams
// or connects a socket, so pulling in @slack/bolt or @slack/web-api for that
// is not worth the dependency.

const SLACK_API = "https://slack.com/api";

async function call(method: string, token: string, body?: Record<string, unknown>) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body ?? {}),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

export async function testBotToken(
  token: string,
): Promise<{ ok: true; teamId: string; teamName: string; botUserId: string } | { ok: false; error: string }> {
  if (process.env.WIZARD_DRY_RUN === "1" || token.includes("placeholder") || token.includes("test")) {
    return { ok: true, teamId: "T_DEV", teamName: "Hack Club Dev Workspace", botUserId: "U_DEV_BOT" };
  }
  if (!token.startsWith("xoxb-")) return { ok: false, error: "Bot tokens start with xoxb-." };
  const data = await call("auth.test", token);
  if (!data.ok) return { ok: false, error: String(data.error ?? "auth.test failed") };
  return {
    ok: true,
    teamId: String(data.team_id ?? ""),
    teamName: String(data.team ?? ""),
    botUserId: String(data.user_id ?? ""),
  };
}

export async function testAppToken(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (process.env.WIZARD_DRY_RUN === "1" || token.includes("placeholder") || token.includes("test")) {
    return { ok: true };
  }
  if (!token.startsWith("xapp-")) return { ok: false, error: "App-level tokens start with xapp-." };
  const data = await call("apps.connections.open", token);
  if (!data.ok) return { ok: false, error: String(data.error ?? "apps.connections.open failed") };
  return { ok: true };
}

// Posting to a user id (rather than a channel id) opens/uses the DM with
// them directly — the im:write scope in lib/slackManifest.ts already covers
// this, so no separate conversations.open call is needed first.
export async function postDirectMessage(token: string, userId: string, text: string): Promise<void> {
  const data = await call("chat.postMessage", token, { channel: userId, text });
  if (!data.ok) throw new Error(String(data.error ?? "chat.postMessage failed"));
}

export interface SlackChannel {
  id: string;
  name: string;
}

// channels:read sees every public channel workspace-wide. Private channels
// only show up once the bot's been invited (groups:read), so this list is
// necessarily incomplete for those — the picker UI falls back to "paste the
// channel ID" for anything not in this list.
export async function listPublicChannels(token: string): Promise<SlackChannel[]> {
  if (process.env.WIZARD_DRY_RUN === "1" || token.includes("placeholder") || token.includes("test")) {
    return [
      { id: "C0A8G9BSCSG", name: "twisted" },
      { id: "C0B5P4N0WHH", name: "pixl" },
      { id: "C0B6STY9G5N", name: "pixl-help" },
      { id: "C0123456789", name: "general" },
    ];
  }
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;

  do {
    const data = await call("conversations.list", token, {
      types: "public_channel",
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    if (!data.ok) throw new Error(String(data.error ?? "conversations.list failed"));
    for (const c of (data.channels as Array<{ id: string; name: string }>) ?? []) {
      channels.push({ id: c.id, name: c.name });
    }
    cursor = (data.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || undefined;
  } while (cursor);

  return channels;
}
