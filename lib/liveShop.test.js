const { test } = require("node:test");
const assert = require("node:assert/strict");
const shop = require("./liveShop");

test("parses Live reward names and approved-hour thresholds", () => {
  const items = shop.parseCatalogue('\\"name\\":\\"Four Key Macropad\\",\\"price\\":3,\\"name\\":\\"GoPro HERO12 Black\\",\\"price\\":65');
  assert.deepEqual(items, [
    { name: "Four Key Macropad", hours: 3 },
    { name: "GoPro HERO12 Black", hours: 65 },
  ]);
});

test("answers the stream time added by approved build hours", () => {
  const result = shop.directAnswer("how much stream time does 3 approved hours add", [{ name: "Keyboard", hours: 15 }], 20);
  assert.equal(result.answer, "*3 approved build hours* add *1 hour* to the stream.");
});

test("answers the threshold for a named Live reward", () => {
  const result = shop.directAnswer("how many hours for the GoPro", [{ name: "GoPro HERO12 Black", hours: 65 }], 20);
  assert.equal(result.answer, "*GoPro HERO12 Black* unlocks at about *65 approved build hours*.");
});

test("lists rewards unlocked by approved build hours", () => {
  const result = shop.directAnswer(
    "what rewards unlock with 15 hours",
    [
      { name: "Keychain", hours: 1 },
      { name: "Macropad", hours: 3 },
      { name: "Keyboard", hours: 15 },
      { name: "Monitor", hours: 25 },
    ],
    20,
  );
  assert.match(result.answer, /Keyboard/);
  assert.doesNotMatch(result.answer, /Monitor/);
});
