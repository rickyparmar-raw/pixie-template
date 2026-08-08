const { test } = require("node:test");
const assert = require("node:assert/strict");
const calculator = require("./calculator");

const ITEMS = [
  { id: 500, name: "PS5 Digital, 825gb +wireless controller", price: 11400, category: "other", unlock_xp: 0, config_options: null },
  { id: 27, name: "Soldering Iron Kit", price: 650, category: "tech", unlock_xp: 0, config_options: null },
  { id: 10, name: "Sticker Pack", price: 50, category: "merch", unlock_xp: 0, config_options: null },
];

const DATA = {
  items: ITEMS,
  economy: {
    pixelValueUsd: 0.07,
    basePayoutUsd: 4.0,
    maxPayoutUsd: 6.0,
    reForMaxPayout: 3750,
    tierRePerHour: [12.5, 15, 18.75, 25],
  },
};

test("parseHours extracts hours from string", () => {
  assert.equal(calculator.parseHours("i have 14 hours tracked"), 14);
  assert.equal(calculator.parseHours("12.5 hrs on hackatime"), 12.5);
  assert.equal(calculator.parseHours("no numbers here"), null);
});

test("parseRe extracts RE from string", () => {
  assert.equal(calculator.parseRe("banked 250 RE"), 250);
  assert.equal(calculator.parseRe("with 1200 restoration energy"), 1200);
});

test("isCalculatorQuery identifies calculation intent", () => {
  assert.equal(calculator.isCalculatorQuery("calculate payout for 20 hours at T3"), true);
  assert.equal(calculator.isCalculatorQuery("what can i afford with 15 hours"), true);
  assert.equal(calculator.isCalculatorQuery("how many more hours do i need for ps5 with 14 hours"), true);
  assert.equal(calculator.isCalculatorQuery("when is the deadline"), false);
});

test("directAnswer calculates hours needed for specific target item", () => {
  const r = calculator.directAnswer("i have 14 hours at T2, how many more hours for PS5?", DATA);
  assert.ok(r, "expected calculator answer");
  assert.match(r.answer, /PS5/);
  assert.match(r.answer, /11,400 px/);
  assert.match(r.answer, /more hours/i);
});

test("directAnswer lists affordable items", () => {
  const r = calculator.directAnswer("what can i afford with 15 hours at T1", DATA);
  assert.ok(r, "expected affordable items answer");
  assert.match(r.answer, /Soldering Iron Kit/);
  assert.match(r.answer, /Sticker Pack/);
});

test("directAnswer calculates general payout", () => {
  const r = calculator.directAnswer("calculate payout for 25 hours at T3", DATA);
  assert.ok(r, "expected payout answer");
  assert.match(r.answer, /Payout Calculation/);
  assert.match(r.answer, /T3 Grid/);
  assert.match(r.answer, /Restoration Energy/);
});
