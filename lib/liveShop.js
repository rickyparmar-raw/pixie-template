const axios = require("axios");

let items = [];

function parseCatalogue(html) {
  const text = String(html || "");
  const patterns = [
    /\\"name\\":\\"((?:\\\\.|[^"\\])*)\\",\\"price\\":(\d+(?:\.\d+)?)/g,
    /"name":"((?:\\.|[^"\\])*)","price":(\d+(?:\.\d+)?)/g,
  ];
  const found = new Map();

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      let name;
      try {
        name = JSON.parse(`"${match[1]}"`);
      } catch {
        name = match[1];
      }
      const hours = Number(match[2]);
      if (name && Number.isFinite(hours) && hours > 0) found.set(name, { name, hours });
    }
  }

  return Array.from(found.values());
}

async function refresh(url) {
  const res = await axios.get(url, { timeout: 15000 });
  const parsed = parseCatalogue(res.data);
  if (parsed.length === 0) throw new Error("Live shop catalogue had no reward thresholds");
  items = parsed;
  return items;
}

async function refreshText(url) {
  const catalogue = await refresh(url);
  return [
    "Live rewards unlock after approved build hours.",
    ...catalogue.map((item) => `Q: How many approved build hours unlock ${item.name}?\nA: About ${item.hours} approved build hours.`),
  ].join("\n\n");
}

function parseHours(question) {
  const match = String(question || "").match(/\b(\d+(?:\.\d+)?)\s*(?:approved\s*)?(?:build\s*)?(?:hours?|hrs?|h)\b/i);
  return match ? Number(match[1]) : null;
}

function formatMinutes(minutes) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  if (hours > 0 && remaining > 0) return `${hours} hour${hours === 1 ? "" : "s"} ${remaining} minute${remaining === 1 ? "" : "s"}`;
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${remaining} minute${remaining === 1 ? "" : "s"}`;
}

function matchingItem(question, catalogue) {
  const lower = String(question || "").toLowerCase();
  const matches = catalogue.filter((item) => {
    const words = item.name.toLowerCase().split(/\W+/).filter((word) => word.length > 2);
    return words.length > 0 && words.some((word) => lower.includes(word));
  });
  return matches.length === 1 ? matches[0] : null;
}

function directAnswer(question, catalogue = items, minutesPerHour = 20) {
  const text = String(question || "");
  const hours = parseHours(text);
  const item = matchingItem(text, catalogue);

  if (hours !== null && /\b(?:stream|time|minutes?|hours? added)\b/i.test(text)) {
    return {
      source: "Live rewards",
      direct: true,
      answer: `*${hours} approved build hours* add *${formatMinutes(hours * minutesPerHour)}* to the stream.`,
    };
  }

  if (item && /\b(?:how many|hours?|hrs?|need|unlock|for)\b/i.test(text)) {
    return {
      source: "Live Shop",
      direct: true,
      answer: `*${item.name}* unlocks at about *${item.hours} approved build hours*.`,
    };
  }

  if (hours !== null && /\b(?:what (?:can i|get)|rewards?|unlock|afford)\b/i.test(text) && catalogue.length > 0) {
    const unlocked = catalogue.filter((candidate) => candidate.hours <= hours).sort((a, b) => b.hours - a.hours).slice(0, 5);
    if (unlocked.length === 0) return null;
    return {
      source: "Live Shop",
      direct: true,
      answer: `With *${hours} approved build hours*, you can unlock:\n${unlocked.map((candidate) => `• *${candidate.name}* (~${candidate.hours}h)`).join("\n")}`,
    };
  }

  return null;
}

function current() {
  return items;
}

module.exports = { parseCatalogue, refresh, refreshText, parseHours, directAnswer, current };
