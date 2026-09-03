import { test, expect, afterEach } from "bun:test";
import { testBotToken, testAppToken, listPublicChannels } from "./slackApi";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

test("bot token is rejected before any network call if it doesn't start with xoxb-", async () => {
  global.fetch = (async () => {
    throw new Error("should not be called");
  }) as unknown as typeof fetch;
  const result = await testBotToken("nope-123");
  expect(result.ok).toBe(false);
});

test("app token is rejected before any network call if it doesn't start with xapp-", async () => {
  global.fetch = (async () => {
    throw new Error("should not be called");
  }) as unknown as typeof fetch;
  const result = await testAppToken("nope-123");
  expect(result.ok).toBe(false);
});

test("valid bot token returns team and bot user id from auth.test", async () => {
  global.fetch = (async () =>
    new Response(
      JSON.stringify({ ok: true, team: "Hack Club", team_id: "T123", user_id: "U456" }),
    )) as unknown as typeof fetch;
  const result = await testBotToken("xoxb-fake");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.teamId).toBe("T123");
    expect(result.botUserId).toBe("U456");
  }
});

test("slack error response surfaces the error string", async () => {
  global.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, error: "invalid_auth" }))) as unknown as typeof fetch;
  const result = await testBotToken("xoxb-bad");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBe("invalid_auth");
});

test("listPublicChannels follows pagination cursors", async () => {
  let call = 0;
  global.fetch = (async () => {
    call++;
    if (call === 1) {
      return new Response(
        JSON.stringify({
          ok: true,
          channels: [{ id: "C1", name: "general" }],
          response_metadata: { next_cursor: "page2" },
        }),
      );
    }
    return new Response(
      JSON.stringify({ ok: true, channels: [{ id: "C2", name: "help" }], response_metadata: {} }),
    );
  }) as unknown as typeof fetch;

  const channels = await listPublicChannels("xoxb-fake");
  expect(channels).toEqual([
    { id: "C1", name: "general" },
    { id: "C2", name: "help" },
  ]);
  expect(call).toBe(2);
});
