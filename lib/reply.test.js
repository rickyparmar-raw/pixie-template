process.env.PIXIE_DB_PATH = ":memory:";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const reply = require("./reply");

// Pixie is not allowed to talk in dashes. The model reaches for them constantly
// and static copy is full of them, so this is enforced on the way out to Slack
// rather than trusted to every author and every completion.

test("an em dash becomes a comma", () => {
  assert.equal(
    reply.plainDashes("PS5 is 11,400 px — that's about 202h at T4"),
    "PS5 is 11,400 px, that's about 202h at T4",
  );
});

test("en dashes and spaced double hyphens go the same way", () => {
  assert.equal(reply.plainDashes("i'm pixie – a helper bot"), "i'm pixie, a helper bot");
  assert.equal(reply.plainDashes("i'm pixie -- a helper bot"), "i'm pixie, a helper bot");
});

test("a dash with no spaces around it is still a dash", () => {
  assert.equal(reply.plainDashes("11,400 px—202h at T4"), "11,400 px, 202h at T4");
});

// A comma at the end of a sentence or the start of a line reads as a typo,
// which is worse than the dash was.
test("a dash at the edge of a line is dropped, not turned into a comma", () => {
  assert.equal(reply.plainDashes("hang on —"), "hang on");
  assert.equal(reply.plainDashes("— hang on"), "hang on");
  assert.equal(reply.plainDashes("first line —\nsecond line"), "first line\nsecond line");
});

test("no doubled or stranded punctuation is left behind", () => {
  assert.equal(reply.plainDashes("yeah, — that one"), "yeah, that one");
  assert.equal(reply.plainDashes("the price — 11,400 px — is fixed."), "the price, 11,400 px, is fixed.");
  assert.equal(reply.plainDashes("wait — ."), "wait.");
});

// Command flags are the reason this only touches real dashes and a spaced
// double hyphen. Turning `git commit --amend` into `git commit, amend` would
// hand somebody a broken command.
test("hyphens inside words and flags are left completely alone", () => {
  const cmd = "run `git commit --amend` then `npm run build -- --watch`";
  assert.equal(reply.plainDashes(cmd), cmd);
  assert.equal(reply.plainDashes("a well-known set-up"), "a well-known set-up");
  assert.equal(reply.plainDashes("- first\n- second"), "- first\n- second");
});

test("code blocks are never rewritten", () => {
  const text = "try this:\n```\nfoo --bar — baz\n```\nand then — you're done";
  assert.equal(reply.plainDashes(text), "try this:\n```\nfoo --bar — baz\n```\nand then, you're done");
});

test("empty and missing text survive", () => {
  assert.equal(reply.plainDashes(""), "");
  assert.equal(reply.plainDashes(null), "");
  assert.equal(reply.plainDashes(undefined), "");
});

/* ----------------------------------------------------- applied on the way out -- */

function fakeClient() {
  const calls = { posts: [], updates: [] };
  return {
    calls,
    chat: {
      postMessage: async (payload) => {
        calls.posts.push(payload);
        return { ts: "posted-1" };
      },
      update: async (payload) => {
        calls.updates.push(payload);
        return {};
      },
    },
  };
}

test("finalize strips dashes from the text and from the blocks", async () => {
  const client = fakeClient();
  const text = "the price — 11,400 px";
  await reply.finalize(client, "C1", "t1", Promise.resolve(null), text, {
    blocks: reply.blocksFor(text),
  });

  const posted = client.calls.posts[0];
  assert.equal(posted.text, "the price, 11,400 px");
  assert.equal(posted.blocks[0].text.text, "the price, 11,400 px");
});

test("streamed fragments are stripped as they go out", async () => {
  const client = fakeClient();
  const writer = reply.makeStreamWriter({
    client,
    channel: "C1",
    ensurePlaceholder: async () => "ts-1",
  });
  writer.write("the price — 11,400");
  await new Promise((r) => setTimeout(r, 5));
  await writer.settle();

  assert.equal(client.calls.updates.at(-1).text, "the price, 11,400");
});

test("the source line pixie appends carries no dash either", () => {
  const line = reply.sourceLineFor("Some Source");
  assert.doesNotMatch(line, /[—–]/);
});
