const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const { config } = require("./config");
const firecrawl = require("./firecrawl");

// axios is a shared module object across every file that requires it, same
// stubbing reason as lib/llm.js elsewhere in this codebase — before()/after()
// bracket the stub around this file's own execution window.
let realPost;
before(() => {
  realPost = axios.post;
});
after(() => {
  axios.post = realPost;
});

let savedApiKey;
before(() => {
  savedApiKey = config.firecrawlApiKey;
  config.firecrawlApiKey = "test-key";
});
after(() => {
  config.firecrawlApiKey = savedApiKey;
});

beforeEach(() => {
  firecrawl.clearScrapeCache();
});

test("scrapeUrl returns null without an API key, and never calls the network", async () => {
  const saved = config.firecrawlApiKey;
  config.firecrawlApiKey = null;
  axios.post = async () => {
    throw new Error("should not have been called");
  };

  try {
    assert.equal(await firecrawl.scrapeUrl("https://example.com/docs"), null);
  } finally {
    config.firecrawlApiKey = saved;
  }
});

test("scrapeUrl returns the markdown on a successful scrape", async () => {
  axios.post = async () => ({ data: { success: true, data: { markdown: "# Hello\n\nworld" } } });

  assert.equal(await firecrawl.scrapeUrl("https://example.com/docs"), "# Hello\n\nworld");
});

// The whole point of this fix: knowledge.js's corpus refresh runs every 30
// minutes and used to re-scrape every doc page on every single cycle, which
// blew through Firecrawl's free-tier rate limit for content that almost
// never changes.
test("scrapeUrl serves a cached copy instead of re-scraping the same URL", async () => {
  let calls = 0;
  axios.post = async () => {
    calls += 1;
    return { data: { success: true, data: { markdown: "cached content" } } };
  };

  const first = await firecrawl.scrapeUrl("https://example.com/docs");
  const second = await firecrawl.scrapeUrl("https://example.com/docs");

  assert.equal(first, "cached content");
  assert.equal(second, "cached content");
  assert.equal(calls, 1, "the second call should have been served from cache, not the network");
});

test("scrapeUrl caches independently per URL", async () => {
  let calls = 0;
  axios.post = async (_endpoint, body) => {
    calls += 1;
    return { data: { success: true, data: { markdown: `content for ${body.url}` } } };
  };

  const a = await firecrawl.scrapeUrl("https://example.com/a");
  const b = await firecrawl.scrapeUrl("https://example.com/b");

  assert.equal(a, "content for https://example.com/a");
  assert.equal(b, "content for https://example.com/b");
  assert.equal(calls, 2);
});

// The explicit "reload the docs now" admin command needs a real hard refresh
// — a cached copy from earlier today defeats the point of asking for one.
test("scrapeUrl's skipCache option bypasses the cache and re-scrapes", async () => {
  let calls = 0;
  axios.post = async () => {
    calls += 1;
    return { data: { success: true, data: { markdown: `version ${calls}` } } };
  };

  const first = await firecrawl.scrapeUrl("https://example.com/docs");
  const second = await firecrawl.scrapeUrl("https://example.com/docs", { skipCache: true });

  assert.equal(first, "version 1");
  assert.equal(second, "version 2");
  assert.equal(calls, 2);
});

// A rate limit or a transient hiccup shouldn't drop a page from the corpus
// when a perfectly good — just not brand new — copy is sitting in the cache.
test("scrapeUrl falls back to a stale cached copy when a re-scrape fails", async () => {
  axios.post = async () => ({ data: { success: true, data: { markdown: "good copy" } } });
  await firecrawl.scrapeUrl("https://example.com/docs");

  axios.post = async () => {
    throw new Error("Rate limit exceeded");
  };
  const result = await firecrawl.scrapeUrl("https://example.com/docs", { skipCache: true });

  assert.equal(result, "good copy");
});

test("scrapeUrl returns null on failure with no cached copy to fall back on", async () => {
  axios.post = async () => {
    throw new Error("Rate limit exceeded");
  };

  assert.equal(await firecrawl.scrapeUrl("https://example.com/never-cached"), null);
});

test("clearScrapeCache forces the next call to hit the network again", async () => {
  let calls = 0;
  axios.post = async () => {
    calls += 1;
    return { data: { success: true, data: { markdown: `version ${calls}` } } };
  };

  await firecrawl.scrapeUrl("https://example.com/docs");
  firecrawl.clearScrapeCache();
  await firecrawl.scrapeUrl("https://example.com/docs");

  assert.equal(calls, 2);
});
