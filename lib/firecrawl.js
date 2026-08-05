// Firecrawl integration for pixie.
// Converts documentation and web pages into clean Markdown using Firecrawl's API,
// and provides live web search when questions go beyond static sources.
const axios = require("axios");
const { config } = require("./config");
const log = require("./log");

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v1";
const DEFAULT_TIMEOUT_MS = 15000;

function getApiKey() {
  return config.firecrawlApiKey || process.env.FIRECRAWL_API_KEY || null;
}

// knowledge.js's corpus refresh runs every 30 minutes (plus once at boot) and
// re-scraped every single doc subpage on every cycle — 20-30 pages against a
// ~28-30 req/min free-tier limit, so most cycles were mostly 429s for content
// that's almost always byte-identical to what was already scraped a half
// hour earlier. Docs don't change that often; cache per URL and only pay for
// a real Firecrawl call once a page is actually stale.
const SCRAPE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const scrapeCache = new Map();
let creditsExhaustedUntil = 0;

function isCreditsExhausted() {
  return Date.now() < creditsExhaustedUntil;
}

function markCreditsExhausted() {
  creditsExhaustedUntil = Date.now() + 60 * 60 * 1000;
}

// Scrapes a single URL into clean markdown using Firecrawl, reusing a recent
// cached copy instead of re-fetching. Exported so a caller that needs a hard
// refresh (an explicit "reload docs" command, say) can bypass the cache.
async function scrapeUrl(url, { skipCache = false } = {}) {
  const cached = scrapeCache.get(url);
  if (!skipCache && cached && Date.now() - cached.fetchedAt < SCRAPE_CACHE_TTL_MS) {
    return cached.markdown;
  }

  if (isCreditsExhausted()) {
    return cached ? cached.markdown : null;
  }

  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await axios.post(
      `${FIRECRAWL_BASE_URL}/scrape`,
      { url, formats: ["markdown"] },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: DEFAULT_TIMEOUT_MS,
      },
    );

    if (res.data?.success && res.data?.data?.markdown) {
      const markdown = res.data.data.markdown;
      scrapeCache.set(url, { markdown, fetchedAt: Date.now() });
      log.info("firecrawl", `scraped ${url} (${markdown.length} chars)`);
      return markdown;
    }
  } catch (e) {
    const errMsg = e.response?.data?.error || e.message;
    if (e.response?.status === 402 || (typeof errMsg === "string" && errMsg.toLowerCase().includes("insufficient credits"))) {
      markCreditsExhausted();
      log.warn("firecrawl", "credits exhausted — pausing live web requests for 1 hour");
    } else {
      log.warn("firecrawl", `scrape failed for ${url}: ${errMsg}`);
    }
    // A rate limit or a hiccup shouldn't drop the page from the corpus when a
    // perfectly good copy — just not brand new — is sitting right here.
    if (cached) {
      log.debug("firecrawl", `serving stale cached copy for ${url} after a scrape failure`);
      return cached.markdown;
    }
  }
  return null;
}

function clearScrapeCache() {
  scrapeCache.clear();
}

// Searches the web or specific domains via Firecrawl search endpoint and returns markdown snippets.
async function searchWeb(query, limit = 3) {
  if (isCreditsExhausted()) return null;
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await axios.post(
      `${FIRECRAWL_BASE_URL}/search`,
      { query, limit, scrapeOptions: { formats: ["markdown"] } },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      },
    );

    if (res.data?.success && Array.isArray(res.data?.data)) {
      log.info("firecrawl", `search "${query}" returned ${res.data.data.length} results`);
      return res.data.data.map((item) => ({
        url: item.url,
        title: item.title,
        markdown: item.markdown || item.description || "",
      }));
    }
  } catch (e) {
    const errMsg = e.response?.data?.error || e.message;
    if (e.response?.status === 402 || (typeof errMsg === "string" && errMsg.toLowerCase().includes("insufficient credits"))) {
      markCreditsExhausted();
      log.warn("firecrawl", "credits exhausted — pausing web search for 1 hour");
    } else {
      log.warn("firecrawl", `search failed for "${query}": ${errMsg}`);
    }
  }
  return null;
}

module.exports = {
  getApiKey,
  scrapeUrl,
  searchWeb,
  clearScrapeCache,
  SCRAPE_CACHE_TTL_MS,
};
