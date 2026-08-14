const { test } = require("node:test");
const assert = require("node:assert/strict");
const validator = require("./validator");

test("parseGithubUrl parses full GitHub URLs", () => {
  const r1 = validator.parseGithubUrl("https://github.com/hackclub/pixie");
  assert.equal(r1.owner, "hackclub");
  assert.equal(r1.repo, "pixie");
  assert.equal(r1.fullName, "hackclub/pixie");

  const r2 = validator.parseGithubUrl("github.com/torvalds/linux.git");
  assert.equal(r2.owner, "torvalds");
  assert.equal(r2.repo, "linux");

  const r3 = validator.parseGithubUrl("check this out: https://github.com/user/cool-game/tree/main");
  assert.equal(r3.owner, "user");
  assert.equal(r3.repo, "cool-game");
});

test("parseGithubUrl returns null for non-github URLs", () => {
  assert.equal(validator.parseGithubUrl("https://gitlab.com/user/repo"), null);
  assert.equal(validator.parseGithubUrl("hello world"), null);
});

test("detectLicense detects standard open source licenses", () => {
  assert.equal(validator.detectLicense("MIT License\n\nPermission is hereby granted..."), "MIT License");
  assert.equal(validator.detectLicense("Apache License, Version 2.0"), "Apache 2.0");
  assert.equal(validator.detectLicense("GNU GENERAL PUBLIC LICENSE Version 3"), "GPL v3");
  assert.equal(validator.detectLicense(""), null);
});

test("analyzeReadme extracts instructions and demo indicators", () => {
  const text = `# My Cool Game
This is a game built for Pixl.

## How to Run
\`\`\`bash
npm install
npm run dev
\`\`\`

## Demo
Check out the playable demo at https://play.pixl.hackclub.com/
![Screenshot](screenshot.png)
`;
  const res = validator.analyzeReadme(text);
  assert.equal(res.hasReadme, true);
  assert.equal(res.hasInstructions, true);
  assert.equal(res.hasDemo, true);
  assert.equal(res.hasScreenshots, true);
  assert.ok(res.wordCount > 15);
});
