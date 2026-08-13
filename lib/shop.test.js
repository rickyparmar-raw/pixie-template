const { test } = require("node:test");
const assert = require("node:assert/strict");
const shop = require("./shop");

// A trimmed copy of the shape server.pixl.hackclub.com/api/shop/items returns,
// kept small on purpose: these tests are about the maths and the matching, not
// about the live catalogue, which changes whenever someone restocks.
const ITEMS = [
  { id: 27, name: "Signed Org Photo", price: 100, category: "merch", unlock_xp: 0, config_options: null, description: "" },
  { id: 500, name: "PS5 Digital, 825gb +wireless controller", price: 11400, category: "other", unlock_xp: 0, config_options: null, description: "" },
  { id: 66, name: "MacBook Neo", price: 10675, category: "tech", unlock_xp: 0, config_options: null, description: "" },
  { id: 67, name: "MacBook Air M5", price: 18875, category: "tech", unlock_xp: 0, config_options: null, description: "" },
  { id: 68, name: "Framework 13 DIY", price: 18850, category: "kits", unlock_xp: 0, config_options: { base_price: 18850 }, description: "" },
  { id: 481, name: "Huawei MatePad 11.5", price: 0, category: "tech", unlock_xp: 0, config_options: null, description: "" },
  { id: 99, name: "Founder Trophy", price: 0, category: "merch", unlock_xp: 500, config_options: null, description: "" },
];

const DATA = { items: ITEMS, economy: shop.DEFAULT_ECONOMY };

/* ------------------------------------------------------------- the maths -- */

test("pxPerHour walks the payout step table, not a curve", () => {
  const e = shop.DEFAULT_ECONOMY;
  assert.equal(Math.round(shop.pxPerHour(0, e)), 57);
  assert.equal(Math.round(shop.pxPerHour(624, e)), 57);
  assert.equal(Math.round(shop.pxPerHour(1875, e)), 71);
  assert.equal(Math.round(shop.pxPerHour(3750, e)), 86);
  // Nothing above the cap pays more than the cap.
  assert.equal(shop.pxPerHour(999999, e), shop.pxPerHour(3750, e));
});

test("rePerHour clamps the tier to the four that exist", () => {
  const e = shop.DEFAULT_ECONOMY;
  assert.equal(shop.rePerHour(1, e), 12.5);
  assert.equal(shop.rePerHour(4, e), 25);
  assert.equal(shop.rePerHour(9, e), 25);
  assert.equal(shop.rePerHour(0, e), 12.5);
});

// This is the range the shop page itself prints under every price, so pixie
// has to produce the same two numbers or it contradicts the site.
test("hoursRange reproduces the floor and cap hours the shop page shows", () => {
  const r = shop.hoursRange(11400, shop.DEFAULT_ECONOMY);
  assert.equal(Math.round(r.floorHours), 200);
  assert.equal(Math.round(r.capHours), 133);
  assert.equal(r.floorUsd, 4);
  assert.equal(r.capUsd, 6);
});

test("hoursForPixels climbs through the rate steps as RE banks up", () => {
  const h = shop.hoursForPixels(11400, { tier: 4, economy: shop.DEFAULT_ECONOMY });
  assert.ok(h > 133 && h < 200, `expected hours between 133 and 200, got ${h}`);

  // A lower tier banks RE slower, so it stays nearer the floor rate for longer
  // and takes more hours for the same item.
  const t1 = shop.hoursForPixels(11400, { tier: 1, economy: shop.DEFAULT_ECONOMY });
  assert.ok(t1 > h, `T1 (${t1}h) should need more hours than T4 (${h}h)`);
  assert.ok(t1 <= 200, "even T1 beats the flat floor rate once RE banks up");
});

test("hoursForPixels starts from the RE you already have", () => {
  const cold = shop.hoursForPixels(11400, { tier: 4, economy: shop.DEFAULT_ECONOMY });
  const warm = shop.hoursForPixels(11400, { tier: 4, startingRe: 3750, economy: shop.DEFAULT_ECONOMY });
  assert.ok(warm < cold);
  // Already at the cap, so it is flat 86 px/hour the whole way.
  assert.ok(Math.abs(warm - 133) < 0.5, `expected ~133h at the cap, got ${warm}`);
});

/* ---------------------------------------------------------- what's asked -- */

test("parseTier reads the ways people actually write a tier", () => {
  assert.equal(shop.parseTier("how much hours needed for t4 for ps5"), 4);
  assert.equal(shop.parseTier("tier 3 project"), 3);
  assert.equal(shop.parseTier("T2 Signal"), 2);
  assert.equal(shop.parseTier("a nexus build"), 4);
  assert.equal(shop.parseTier("spark"), 1);
  assert.equal(shop.parseTier("tier4"), 4);
});

test("parseTier says nothing when no tier was named", () => {
  assert.equal(shop.parseTier("how many hours for a ps5"), null);
  assert.equal(shop.parseTier("i shipped 4 projects"), null);
  assert.equal(shop.parseTier("t9 doesn't exist"), null);
});

test("findItems matches the short name people type", () => {
  const ps5 = shop.findItems("ps5", ITEMS);
  assert.equal(ps5.length, 1);
  assert.equal(ps5[0].id, 500);

  assert.equal(shop.findItems("playstation 5", ITEMS)[0].id, 500);
  assert.equal(shop.findItems("how much hours needed for t4 for ps5", ITEMS)[0].id, 500);
});

test("findItems returns every candidate when the name is ambiguous", () => {
  const macs = shop.findItems("macbook", ITEMS);
  assert.equal(macs.length, 2);
  assert.deepEqual(macs.map((i) => i.id).sort(), [66, 67]);
});

test("findItems finds nothing rather than guessing", () => {
  assert.deepEqual(shop.findItems("a hot air balloon", ITEMS), []);
  assert.deepEqual(shop.findItems("", ITEMS), []);
});

test("isShopQuestion separates shop maths from everything else", () => {
  assert.equal(shop.isShopQuestion("how much hours needed for t4 for ps5"), true);
  assert.equal(shop.isShopQuestion("how many pixels is a macbook"), true);
  assert.equal(shop.isShopQuestion("whats in the shop"), true);
  assert.equal(shop.isShopQuestion("how much does the ps5 cost"), true);
  assert.equal(shop.isShopQuestion("when is pixl launching"), false);
  assert.equal(shop.isShopQuestion("my hackatime isnt tracking"), false);
});

/* ------------------------------------------------------------ answering -- */

test("directAnswer works out the hours for a named item at a named tier", () => {
  const r = shop.directAnswer("how much hours needed for t4 for ps5", DATA);
  assert.ok(r, "expected an answer");
  assert.equal(r.clarify, undefined);
  assert.match(r.answer, /11,400/);
  assert.match(r.answer, /PS5/);
  assert.match(r.answer, /T4/i);
  assert.ok(r.source);
});

test("directAnswer gives the shop's own range when no tier was named", () => {
  const r = shop.directAnswer("how many hours for a ps5", DATA);
  assert.ok(r);
  assert.equal(r.clarify, undefined);
  assert.match(r.answer, /11,400/);
  assert.match(r.answer, /199\.5|200/);
  assert.match(r.answer, /133/);
});

test("directAnswer answers a plain price question", () => {
  const r = shop.directAnswer("how much is the ps5 in the shop", DATA);
  assert.ok(r);
  assert.match(r.answer, /11,400/);
});

test("directAnswer does not hijack non-price questions mentioning an item", () => {
  assert.equal(shop.directAnswer("how much storage does the ps5 have", DATA), null);
  assert.equal(shop.directAnswer("how many hours did you play on ps5", DATA), null);
  assert.equal(shop.directAnswer("my ps5 controller has drift", DATA), null);
});

// The point of the whole feature: when it can't tell which thing you mean it
// asks, instead of picking one and quoting a confident wrong number.
test("directAnswer asks which item when the name matches more than one", () => {
  const r = shop.directAnswer("how many hours for a macbook at t4", DATA);
  assert.ok(r);
  assert.equal(r.clarify, true);
  assert.match(r.answer, /MacBook Neo/);
  assert.match(r.answer, /MacBook Air M5/);
});

test("directAnswer asks which item when a tier was named but nothing else", () => {
  const r = shop.directAnswer("how many hours do i need at t4", DATA);
  assert.ok(r);
  assert.equal(r.clarify, true);
  assert.match(r.answer, /which/i);
});

test("directAnswer says an unpriced item isn't buyable rather than quoting 0", () => {
  const r = shop.directAnswer("how much is the huawei matepad", DATA);
  assert.ok(r);
  assert.doesNotMatch(r.answer, /\b0 px\b/);
  assert.match(r.answer, /not (?:available|priced)|coming soon/i);
});

test("directAnswer treats a trophy as claimed at a level, not bought", () => {
  const r = shop.directAnswer("how much is the founder trophy", DATA);
  assert.ok(r);
  assert.match(r.answer, /trophy|level/i);
});

test("directAnswer quotes a configurable item as a starting price", () => {
  const r = shop.directAnswer("how much is the framework 13", DATA);
  assert.ok(r);
  assert.match(r.answer, /from 18,850|starts at 18,850/i);
});

test("directAnswer stays out of the way of questions that aren't about the shop", () => {
  assert.equal(shop.directAnswer("when is pixl launching", DATA), null);
  assert.equal(shop.directAnswer("how do i set up hackatime", DATA), null);
});

test("directAnswer returns nothing when the catalogue never loaded", () => {
  assert.equal(shop.directAnswer("how much is a ps5", { items: [], economy: shop.DEFAULT_ECONOMY }), null);
});

/* -------------------------------------------------------------- corpus --- */

test("corpusText lists the catalogue with prices and the rate table", () => {
  const text = shop.corpusText(DATA);
  assert.match(text, /PS5 Digital/);
  assert.match(text, /11,400/);
  assert.match(text, /50 px/);
  assert.match(text, /86 px/);
  // The unpriced one is listed but never with a price.
  assert.match(text, /Huawei MatePad/);
});

test("corpusText survives an empty catalogue", () => {
  assert.equal(shop.corpusText({ items: [], economy: shop.DEFAULT_ECONOMY }), "");
});

/* ------------------------------------------------------------ follow-ups -- */

// The conversation the feature exists for: pixie asks which tier, they answer
// with just "t4", and the item is three lines up rather than in the message.
test("directAnswer picks the item up from the conversation when the reply is just a tier", () => {
  const history = [
    "user: how many hours for a ps5",
    "pixie: PS5 Digital, 825gb +wireless controller is 11,400 px. Which tier are your projects landing on?",
  ].join("\n");

  const r = shop.directAnswer("t4", DATA, { history });
  assert.ok(r, "expected an answer");
  assert.equal(r.clarify, undefined);
  assert.match(r.answer, /162/);
  assert.match(r.answer, /PS5/);
});

test("the most recently mentioned item wins when the thread named several", () => {
  const history = ["user: how much is a ps5", "pixie: 11,400 px", "user: and the macbook air"].join("\n");
  const r = shop.directAnswer("t4", DATA, { history });
  assert.ok(r);
  assert.match(r.answer, /MacBook Air M5/);
});

test("history is only consulted when the message itself names no item", () => {
  const history = "user: how much is a ps5";
  const r = shop.directAnswer("how much is the macbook air at t4", DATA, { history });
  assert.ok(r);
  assert.match(r.answer, /MacBook Air M5/);
  assert.doesNotMatch(r.answer, /PS5/);
});

// "t4" is only pixie's business when pixie just asked. With nothing about a
// price in the thread it is somebody talking about their project tier, and
// asking them which shop item they meant is exactly the unprompted reply this
// whole gate exists to stop. Asking back is still right when the message
// itself asked something, which the next test covers.
test("a bare tier with nothing in the thread is left alone", () => {
  assert.equal(shop.directAnswer("t4", DATA, { history: "user: hey\npixie: hey" }), null);
});

test("a tier with a real question behind it still asks which item", () => {
  const r = shop.directAnswer("how many hours do i need at t4", DATA);
  assert.ok(r);
  assert.equal(r.clarify, true);
  assert.match(r.answer, /which/i);
});

// Without this, every "t4" anywhere in a thread that once mentioned a price
// turns into a shop reply — including ones that are plainly about something
// else by then.
test("a message that is not asking anything is left alone", () => {
  const history = "user: how much is a ps5\npixie: 11,400 px";
  assert.equal(shop.directAnswer("my t4 project got rejected", DATA, { history }), null);
});

test("a clarify names a few candidates and counts the rest rather than listing a dozen", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({
    id: 900 + i,
    name: `Widget ${"abcdefg"[i]}`,
    price: 100 * (i + 1),
    unlock_xp: 0,
    config_options: null,
  }));
  const r = shop.directAnswer("how much is a widget", { items: many, economy: shop.DEFAULT_ECONOMY });
  assert.equal(r.clarify, true);
  assert.match(r.answer, /7 things/);
  assert.match(r.answer, /and 3 more/);
  assert.ok(r.answer.length < 300, `clarify got long: ${r.answer.length} chars`);
});

// pixie reads the shop the way a logged-out visitor does, and that catalogue
// is the US one. Quoting those numbers at someone in another region without
// saying so is how you get a confidently wrong answer.
test("a priced answer says which catalogue the numbers came from", () => {
  const r = shop.directAnswer("how much hours needed for t4 for ps5", DATA);
  assert.match(r.answer, /region|US catalogue/i);
});

test("the corpus says the same thing once, at the top", () => {
  const head = shop.corpusText(DATA).split("\n")[0];
  assert.match(head, /US catalogue/i);
});

// The corpus text is model input, not model output, so lib/reply.js never sees
// it. Dashes left in here teach the model to write them straight back out.
test("nothing the shop module produces contains a dash", () => {
  const produced = [
    shop.corpusText(DATA),
    shop.directAnswer("how much hours needed for t4 for ps5", DATA).answer,
    shop.directAnswer("how many hours for a ps5", DATA).answer,
    shop.directAnswer("how much is a macbook", DATA).answer,
    shop.directAnswer("how many hours do i need at t4", DATA).answer,
    shop.directAnswer("how much is the huawei matepad", DATA).answer,
    shop.directAnswer("how much is the founder trophy", DATA).answer,
    shop.directAnswer("how much is the framework 13", DATA).answer,
  ];
  for (const text of produced) assert.doesNotMatch(text, /[—–]|\s--\s/);
});

/* ------------------------------------------------- only when actually asked -- */

// Naming something off the shelf is not asking what it costs. Pixie was
// answering "i wanna buy a ps5 one day" with a price and a source line, which
// is the bot talking over a conversation nobody invited it into.
test("naming an item without asking a price gets no reply", () => {
  const quiet = [
    "i wanna buy a ps5 one day fr",
    "is a ps5 even worth it",
    "how long till my ps5 gets here",
    "just got a macbook air, so hyped",
    "my ps5 controller keeps drifting lol",
    "anyone else saving for a ps5",
    "bro the framework 13 is so cool",
  ];
  for (const q of quiet) {
    assert.equal(shop.directAnswer(q, DATA), null, `should have stayed quiet: ${q}`);
  }
});

test("actually asking the price still works", () => {
  const asked = [
    "gng whats the price of ps5 here",
    "how much is a ps5",
    "how much hours needed for t4 for ps5",
    "how many pixels for a macbook air",
    "how much does the ps5 cost",
    "can i afford a ps5 yet",
  ];
  for (const q of asked) {
    assert.ok(shop.directAnswer(q, DATA), `should have answered: ${q}`);
  }
});

// A tier on its own only means "the tier you just asked me about" when the
// thread was actually about a price. Otherwise it's someone saying their
// project got tiered.
test("a bare tier only revives an item from a thread that was about prices", () => {
  const priceThread = "user: how much is a ps5\npixie: PS5 Digital, 825gb +wireless controller is 11,400 px.";
  assert.match(shop.directAnswer("t4", DATA, { history: priceThread }).answer, /162/);

  const chatThread = "user: i finally got a ps5\npixie: nice one";
  assert.equal(shop.directAnswer("t4", DATA, { history: chatThread }), null);
});

test("isShopQuestion no longer fires on ordinary chat", () => {
  assert.equal(shop.isShopQuestion("is a ps5 worth it"), false);
  assert.equal(shop.isShopQuestion("how long does review take"), false);
  assert.equal(shop.isShopQuestion("i wanna buy a ps5"), false);
  // Still true for the ones that are genuinely about the shop.
  assert.equal(shop.isShopQuestion("whats in the shop"), true);
  assert.equal(shop.isShopQuestion("whats the price of a ps5"), true);
  assert.equal(shop.isShopQuestion("how many pixels for a macbook"), true);
});

/* ------------------------------------------------------- retrievable text -- */

// The catalogue was rendered as one unbroken list, which chunks into a single
// ~4kB block. BM25 penalises a chunk that long hard enough that it lost to
// every short docs paragraph, so "is there a keyboard in the shop" never saw
// the shop at all. Verified against production: the section was in the corpus
// and never once selected.
test("the catalogue chunks into pieces retrieval can actually pick", () => {
  const retrieve = require("./retrieve");
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    name: `Gadget ${i} Deluxe`,
    price: 100 * (i + 1),
    category: ["tech", "merch", "grants"][i % 3],
    unlock_xp: 0,
    config_options: null,
  }));
  many.push({ id: 999, name: "PS5 Digital", price: 11400, category: "other", unlock_xp: 0, config_options: null });

  const chunks = retrieve.chunkSection("Pixl Shop", shop.corpusText({ items: many, economy: shop.DEFAULT_ECONOMY }));
  assert.ok(chunks.length > 5, `expected the catalogue to split up, got ${chunks.length} chunk(s)`);
  for (const c of chunks) {
    assert.ok(c.text.length <= retrieve.MAX_CHUNK, `chunk of ${c.text.length} chars is over the cap`);
  }
});

test("a shop chunk outranks the docs for a question about an item", () => {
  const retrieve = require("./retrieve");
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    name: `Gadget ${i} Deluxe`,
    price: 100 * (i + 1),
    category: "tech",
    unlock_xp: 0,
    config_options: null,
  }));
  many.push({ id: 999, name: "PS5 Digital", price: 11400, category: "other", unlock_xp: 0, config_options: null });

  const index = retrieve.buildIndex(
    retrieve.chunkSections([
      ["Pixl Shop", shop.corpusText({ items: many, economy: shop.DEFAULT_ECONOMY })],
      ["Shipping", "## Shipping\n\nShipping a project means opening the shop page and pressing ship. The shop is where pixels go.\n\nEvery ship is reviewed by a human before any pixels land in your wallet."],
    ]),
  );

  const top = retrieve.selectChunks(index, "how much is a ps5")[0];
  assert.ok(top, "nothing matched at all");
  assert.equal(top.source, "Pixl Shop");
  assert.match(top.text, /PS5/);
});

// The word "shop" appearing in every chunk made them all score alike, and
// BM25's length bias then handed back whichever was shortest. "is there a
// keyboard in the shop" came back with the PS5, because PS5 was the only item
// in its category and so the smallest chunk.
test("a question that names no item does not surface an arbitrary one", () => {
  const retrieve = require("./retrieve");
  const items = [
    { id: 1, name: "PS5 Digital", price: 11400, category: "other", unlock_xp: 0, config_options: null },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: 10 + i,
      name: `Gadget ${i} Deluxe`,
      price: 100 * (i + 1),
      category: "tech",
      unlock_xp: 0,
      config_options: null,
    })),
  ];
  const index = retrieve.buildIndex(
    retrieve.chunkSections([["Pixl Shop", shop.corpusText({ items, economy: shop.DEFAULT_ECONOMY })]]),
  );

  const vague = retrieve.selectChunks(index, "is there a keyboard in the shop")[0];
  assert.ok(!vague || !/PS5/.test(vague.text), "a vague question pulled back the PS5 anyway");

  const named = retrieve.selectChunks(index, "how much is a ps5")[0];
  assert.match(named.text, /PS5/, "naming the item should still find it");
});

/* -------------------------------------------------- a bare pixel amount -- */

test("parsePixelAmount reads an amount out of the question", () => {
  assert.equal(shop.parsePixelAmount("how much hours for 275 pixl on each tier?"), 275);
  assert.equal(shop.parsePixelAmount("how many hours for 1,275 px"), 1275);
  assert.equal(shop.parsePixelAmount("275 pixels is how many hours"), 275);
  assert.equal(shop.parsePixelAmount("how long for 500px"), 500);
});

test("parsePixelAmount ignores numbers that aren't pixels", () => {
  assert.equal(shop.parsePixelAmount("i shipped 5 projects"), null);
  assert.equal(shop.parsePixelAmount("how many hours do i need"), null);
  assert.equal(shop.parsePixelAmount("pixl is a hack club thing"), null);
  assert.equal(shop.parsePixelAmount("i got t4 on my project"), null);
});

test("a pixel amount is answered in hours, not divided by the RE rate", () => {
  const r = shop.directAnswer("how much hours for 275 pixl on each tier?", DATA);
  assert.ok(r, "expected an answer");
  assert.match(r.answer, /4\.8/);
  assert.doesNotMatch(r.answer, /\b22\b|18\.3|14\.7|\b11 h/);
});

test("when the tier genuinely changes nothing, it says so", () => {
  const r = shop.directAnswer("how many hours for 275 px on each tier", DATA);
  assert.match(r.answer, /same on (?:all|every)|doesn't change|no difference/i);
  // And explains why, rather than leaving them to wonder.
  assert.match(r.answer, /625 RE|Restoration Energy/);
});

test("when the tier does change something, each one is given", () => {
  const r = shop.directAnswer("how many hours for 11400 px on each tier", DATA);
  assert.match(r.answer, /T1/);
  assert.match(r.answer, /T4/);
  assert.match(r.answer, /162/);
  assert.match(r.answer, /179/);
});

test("a pixel amount with one tier named answers just that tier", () => {
  const r = shop.directAnswer("how many hours for 11400 px at t4", DATA);
  assert.match(r.answer, /162/);
  assert.doesNotMatch(r.answer, /179/);
});

test("a pixel amount nobody asked about is still left alone", () => {
  assert.equal(shop.directAnswer("just hit 275 px lets goo", DATA), null);
  assert.equal(shop.directAnswer("275 px for that is mad", DATA), null);
});

// hoursForPixels was already right; it was the model doing the arithmetic.
test("the maths itself never depended on the tier at small amounts", () => {
  const e = shop.DEFAULT_ECONOMY;
  const byTier = [1, 2, 3, 4].map((t) => shop.hoursForPixels(275, { tier: t, economy: e }));
  for (const h of byTier) assert.ok(Math.abs(h - 4.8125) < 0.01, `expected ~4.8h, got ${h}`);
});

test("the corpus warns the model off the exact mistake it made", () => {
  const text = shop.corpusText(DATA);
  assert.match(text, /RE (?:per hour|an hour) is not/i);
});
