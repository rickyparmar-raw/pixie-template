const { test } = require("node:test");
const assert = require("node:assert/strict");
const { looksLikeCode, looksLikeQuestion } = require("./chat");

test("looksLikeCode detects fenced blocks", () => {
  assert.equal(looksLikeCode("here\n```js\nconst a = 1;\n```"), true);
});

test("looksLikeCode detects stack traces without fences", () => {
  assert.equal(looksLikeCode("TypeError: undefined is not a function"), true);
  assert.equal(looksLikeCode("Traceback (most recent call last):"), true);
  assert.equal(looksLikeCode("panic: runtime error: index out of range"), true);
});

test("looksLikeCode ignores ordinary prose", () => {
  assert.equal(looksLikeCode("how do i unlock the next region"), false);
  assert.equal(looksLikeCode("gg everyone"), false);
});

test("looksLikeQuestion catches question marks and question words", () => {
  assert.equal(looksLikeQuestion("whats the deadline?"), true);
  assert.equal(looksLikeQuestion("how do i join"), true);
  assert.equal(looksLikeQuestion("anyone know about hackatime"), true);
});

// "whats"/"hows" without the apostrophe is how people actually type in Slack,
// and \bwhat\b does not match it — this sent "pixie whats up" to the dead-end
// fallback.
test("looksLikeQuestion handles apostrophe-less contractions", () => {
  assert.equal(looksLikeQuestion("pixie whats up"), true);
  assert.equal(looksLikeQuestion("hows the deadline looking"), true);
  assert.equal(looksLikeQuestion("wheres the repo"), true);
});

test("looksLikeQuestion treats greetings as worth a reply", () => {
  assert.equal(looksLikeQuestion("hey pixie"), true);
  assert.equal(looksLikeQuestion("yo"), true);
  assert.equal(looksLikeQuestion("thanks!"), true);
});

test("looksLikeQuestion is false for statements and empties", () => {
  assert.equal(looksLikeQuestion("pixie ur the best"), false);
  assert.equal(looksLikeQuestion(""), false);
  assert.equal(looksLikeQuestion(undefined), false);
});

test("looksLikeQuestion treats pasted code as something to respond to", () => {
  assert.equal(looksLikeQuestion("```\nSyntaxError: bad\n```"), true);
});
