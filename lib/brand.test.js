process.env.PIXIE_DB_PATH = ":memory:";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const brand = require("./brand");

// Every value falls back to today's pixie identity, so a deployment that sets
// nothing behaves exactly as it did before this module existed. That's what makes
// the whole fleet change safe to land on the live Pixl bot.
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("with nothing set, the bot is still pixie", () => {
  withEnv({ PIXIE_BOT_NAME: undefined, PIXIE_BOT_SLUG: undefined }, () => {
    assert.equal(brand.name(), "pixie");
    assert.equal(brand.slug(), "pixie");
    assert.equal(brand.cmd(), "/pixie");
    assert.equal(brand.cmd("teach"), "/pixie-teach");
  });
});

test("a bot's name and slug drive its commands", () => {
  withEnv({ PIXIE_BOT_NAME: "Sol", PIXIE_BOT_SLUG: "sol" }, () => {
    assert.equal(brand.name(), "Sol");
    assert.equal(brand.cmd(), "/sol");
    assert.equal(brand.cmd("gaps"), "/sol-gaps");
  });
});

test("the slug is derived from the name when only the name is set", () => {
  withEnv({ PIXIE_BOT_NAME: "Athena", PIXIE_BOT_SLUG: undefined }, () => {
    assert.equal(brand.slug(), "athena");
    assert.equal(brand.cmd("teach"), "/athena-teach");
  });
});

// Slack rejects spaces and uppercase in slash command names, so a display name
// that isn't already a slug must not reach one verbatim.
test("a display name with spaces or caps is slugified before becoming a command", () => {
  withEnv({ PIXIE_BOT_NAME: "Sol Helper Bot", PIXIE_BOT_SLUG: undefined }, () => {
    assert.equal(brand.slug(), "sol-helper-bot");
    assert.equal(brand.cmd(), "/sol-helper-bot");
  });
});

test("punctuation is stripped rather than passed into a command name", () => {
  withEnv({ PIXIE_BOT_SLUG: "Solvable! YSWS (2026)" }, () => {
    assert.equal(brand.slug(), "solvable-ysws-2026");
  });
});

// A slug of only punctuation would otherwise produce "/" — a command name Slack
// won't accept, leaving the bot with no ask command at all.
test("a slug that slugifies to nothing falls back rather than producing '/'", () => {
  withEnv({ PIXIE_BOT_SLUG: "!!!" }, () => {
    assert.equal(brand.slug(), "pixie");
    assert.equal(brand.cmd(), "/pixie");
  });
});

test("an empty or whitespace value is treated as unset", () => {
  withEnv({ PIXIE_BOT_NAME: "   ", PIXIE_BOT_SLUG: "" }, () => {
    assert.equal(brand.name(), "pixie");
    assert.equal(brand.slug(), "pixie");
  });
});

// Payload ids aren't slash commands, so they use underscores — and a hyphenated
// slug must not leak a hyphen into one.
test("payload ids are underscored", () => {
  withEnv({ PIXIE_BOT_SLUG: "sol-helper" }, () => {
    assert.equal(brand.id("teach_thread"), "sol_helper_teach_thread");
  });
});

// The suite shares one process, so a value captured at require time would freeze
// whichever test file ran first.
test("brand values are read per call, not captured at require time", () => {
  withEnv({ PIXIE_BOT_SLUG: "first" }, () => {
    assert.equal(brand.cmd(), "/first");
  });
  withEnv({ PIXIE_BOT_SLUG: "second" }, () => {
    assert.equal(brand.cmd(), "/second");
  });
});
