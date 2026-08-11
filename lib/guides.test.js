process.env.PIXIE_DB_PATH = ":memory:";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const db = require("./db");
const llm = require("./llm");
const guides = require("./guides");

db.open(":memory:");

// Guide selection falls back to the model when keywords miss. Stubbed to NONE so
// the suite stays hermetic and every assertion below is really testing the free
// keyword pass; the tests that care about the fallback set it themselves.
let modelChoice = "NONE";
// llm is a shared, cached module — every test file `require("./llm")`s the
// same exports object. Stubbing at require time (module top level) poisons it
// during Bun's collection phase, before any file's tests have run at all, so
// before()/after() bracket the stub around this file's own execution window
// instead — anything outside that window sees the real llm.complete.
let realComplete;
before(() => {
  realComplete = llm.complete;
  llm.complete = async () => ({ text: modelChoice, finishReason: "stop" });
});
after(() => {
  llm.complete = realComplete;
});

// Every keyword hit now gets confirmed by the model before detectGuideIntent
// commits to it (see the comment on detectGuideIntent), so these need the
// stub to agree — a keyword match alone is no longer enough on its own.
test("detectGuideIntent matches each guide's trigger phrasing", async () => {
  modelChoice = "submit-ysws-guidelines";
  assert.equal(await guides.detectGuideIntent("how do i submit my ysws guidelines"), "submit-ysws-guidelines");
  modelChoice = "create-hackpad";
  assert.equal(await guides.detectGuideIntent("how do i build a hackpad"), "create-hackpad");
  modelChoice = "create-devboard";
  assert.equal(await guides.detectGuideIntent("how do i design and order a custom pcb"), "create-devboard");
  modelChoice = "NONE";
});

test("detectGuideIntent bypasses the model check when the request is explicit", async () => {
  modelChoice = "NONE"; // even if the model returns NONE, it should bypass and return the correct guide ID
  assert.equal(await guides.detectGuideIntent("gimme a guide and walkthrough of project submission guidelines"), "submit-ysws-guidelines");
  assert.equal(await guides.detectGuideIntent("can you start the hackpad setup tutorial?"), "create-hackpad");
  assert.equal(await guides.detectGuideIntent("walk me through setting up a devboard step by step"), "create-devboard");
});

// The message that proved the old substring match was too brittle: recorded as
// doc_gap 79 instead of starting the walkthrough it was asking for.
test("detectGuideByKeyword survives a typo in the guide's subject", () => {
  assert.equal(guides.detectGuideByKeyword("pixie help me setup hackpadd"), "create-hackpad");
  assert.equal(guides.detectGuideByKeyword("how do i design a devbaord"), "create-devboard");
});

// Budget is length-scaled precisely so short words stay exact.
test("detectGuideByKeyword does not fuzzy-match short words into a guide", () => {
  assert.equal(guides.detectGuideByKeyword("how do i get set up with pixl"), null);
});

// Naming the topic isn't asking to be walked through it.
test("detectGuideByKeyword needs both the subject and an intent hint", () => {
  assert.equal(guides.detectGuideByKeyword("hackpad is down again"), null);
  assert.equal(guides.detectGuideByKeyword("which devboard are you using"), null);
});

// Live bug: a real question about the RE/pixels-per-hour multiplier tier
// system ("why did my rate go back to base after 50h") got answered with the
// submit-project walkthrough's first step, because "project" + the bare
// "how" hint was enough to match — regardless of what was actually asked.
test("submit-ysws-guidelines does not trigger on 'how' + a common subject word alone", () => {
  const multiplierQuestion =
    "Can someone explain to me why I got the multiplier for my project so I got a good rate as I did 50h " +
    "but now it went back to my normal base rate? Is that normal? how does tht work";
  assert.equal(guides.detectGuideByKeyword(multiplierQuestion), null);

  // Real phrasings must still trigger via their actual action words.
  assert.equal(guides.detectGuideByKeyword("how do i submit my ysws guidelines"), "submit-ysws-guidelines");
  assert.equal(guides.detectGuideByKeyword("how do i qualify my ysws guidelines"), "submit-ysws-guidelines");
});

test("submit-ysws-guidelines still triggers on 'turn in my ysws guidelines' now that hints are split into single words", () => {
  assert.equal(guides.detectGuideByKeyword("how do i turn in my ysws guidelines"), "submit-ysws-guidelines");
});

// Live incident: this exact message ("guide me with ysws project submission
// guidelines") fell through to the general docs answer instead of starting
// the walkthrough, and got answered from a since-purged bad source. Explicit
// "guide me with" phrasing must resolve via detectGuideBySubject and never
// depend on the model call at all — modelChoice stays NONE here on purpose.
test("detectGuideIntent starts the ysws walkthrough on 'guide me with ysws project submission guidelines'", async () => {
  modelChoice = "NONE";
  assert.equal(
    await guides.detectGuideIntent("guide me with ysws project submission guidelines"),
    "submit-ysws-guidelines",
  );
});

test("detectGuideIntent returns null for unrelated messages", async () => {
  assert.equal(await guides.detectGuideIntent("whats the deadline"), null);
  assert.equal(await guides.detectGuideIntent(""), null);
  assert.equal(await guides.detectGuideIntent(undefined), null);
});

// Keywords can't cover every phrasing, so a help request that misses them gets
// one model call to decide.
test("detectGuideIntent falls back to the model on a keyword miss", async () => {
  modelChoice = "create-hackpad";
  assert.equal(await guides.detectGuideIntent("how do i make my custom macropad?"), "create-hackpad");
  modelChoice = "NONE";
});

// Small talk must never reach the fallback — that's the gate that keeps chat
// from paying for a network call.
test("detectGuideIntent skips the model for messages that aren't help requests", async () => {
  modelChoice = "create-hackpad";
  assert.equal(await guides.detectGuideIntent("lol same"), null);
  modelChoice = "NONE";
});

test("startGuide returns the first step and records state", () => {
  const result = guides.startGuide("submit-ysws-guidelines", "thread-a", "U1");
  assert.match(result.message, /public GitHub repo/);
  assert.ok(result.checkNext);
  assert.equal(guides.isInGuide("thread-a"), true);
});

// A generic "grab it from kicad.org" pointer didn't actually answer someone
// who asked how to install it on Linux from the command line.
test("create-hackpad's no-kicad alternate step gives real Linux install commands", () => {
  const reply = guides.GUIDES["create-hackpad"].alternateSteps["doesn't have kicad or fusion360 installed"];
  assert.match(reply, /apt install kicad/);
  assert.match(reply, /dnf install kicad/);
  assert.match(reply, /flatpak install/);
});

test("availableFor returns only the guides configured for a program", () => {
  const available = guides.availableFor({ guides: ["start-live"] });
  assert.deepEqual(available.map(([id]) => id), ["start-live"]);
});

// The three most predictable real friction points in this exact 19-step
// walkthrough — DRC errors, Fusion360's account requirement, and a plate
// generator/PCB size mismatch — get their own alternateKey so the classifier
// (and the dynamic answer built on top of it) has a specific, accurate anchor
// instead of falling into the generic "stuck on a specific step" catch-all.
test("create-hackpad covers DRC errors, Fusion360 account activation, and plate/PCB size mismatches", () => {
  const { alternateSteps } = guides.GUIDES["create-hackpad"];

  assert.match(alternateSteps["pcb has drc errors or red marks after routing"], /Design Rules Checker/);
  assert.match(alternateSteps["fusion360 asks to sign in or activate a personal use license"], /personal use/);
  assert.match(alternateSteps["plate generator output doesn't match the pcb, wrong size or key count"], /ai03/);
});

test("stuckAnswerPrompt includes the canned guidance as grounding and the pixl guardrail", () => {
  const guide = guides.GUIDES["create-hackpad"];
  const step = guide.steps[0];
  const canned = guide.alternateSteps["doesn't have kicad or fusion360 installed"];
  const prompt = guides.stuckAnswerPrompt(guide, step, "doesn't have kicad or fusion360 installed", canned, false);

  assert.match(prompt, /Pixie's own fallback line for this/);
  assert.match(prompt, /apt install kicad/);
  assert.match(prompt, /point them at/);
  // The whole point: real troubleshooting for the exact step, not a deflection.
  assert.match(prompt, /don't deflect to asking someone else/);
  assert.match(prompt, /never make that the whole answer/);
});

// A vague "i'm struggling with this" doesn't name a specific problem, so it
// classifies against the catch-all alternateKey — whose canned line used to
// be a pure deflection to #hackpad. The prompt must give the model the
// current step's actual content to troubleshoot from, not just that deflection.
test("stuckAnswerPrompt gives the model the current step's content to troubleshoot from on a vague 'stuck' message", () => {
  const guide = guides.GUIDES["create-hackpad"];
  const step = guide.steps[3];
  const canned = guide.alternateSteps["stuck on a specific step and googling didn't help"];
  const prompt = guides.stuckAnswerPrompt(guide, step, "stuck on a specific step and googling didn't help", canned, false);

  assert.ok(prompt.includes(step.message), "the exact current step must be quoted for the model to troubleshoot");
  assert.match(prompt, /don't deflect to asking someone else/);
  assert.match(prompt, /never make it the first thing you say/);
});

test("answerStuckQuestion falls back to the canned reply if the model call fails", async () => {
  const original = llm.complete;
  llm.complete = async () => {
    throw new Error("model down");
  };

  try {
    const guide = guides.GUIDES["create-hackpad"];
    const step = guide.steps[0];
    const message = await guides.answerStuckQuestion(
      guide,
      step,
      "doesn't have kicad or fusion360 installed",
      "how do i get kicad",
    );
    assert.equal(message, guide.alternateSteps["doesn't have kicad or fusion360 installed"]);
  } finally {
    llm.complete = original;
  }
});

// The whole point: "how do i get X" and "how do i get X on linux using
// commands" used to get back the exact same canned string. A STUCK match now
// gives the model that canned text as grounding and lets it actually answer
// the specific thing asked, same as pixie would for any general tech
// question anywhere else.
test("continueGuide answers a STUCK reply dynamically instead of the same canned text every time", async () => {
  const original = llm.complete;
  llm.complete = async (options) => {
    const sysPrompt = options.messages[0].content;
    // alternateKeys[1] for create-hackpad is "doesn't have kicad or fusion360
    // installed" — see GUIDES["create-hackpad"].alternateSteps below.
    if (sysPrompt.includes("Classify their reply")) return { text: "STUCK_2", finishReason: "stop" };
    if (sysPrompt.includes("Pixie's own fallback line for this")) {
      return { text: "on debian/ubuntu just run `sudo apt install kicad` and you're set", finishReason: "stop" };
    }
    throw new Error(`unexpected llm.complete call: ${sysPrompt.slice(0, 80)}`);
  };

  guides.startGuide("create-hackpad", "thread-stuck-dynamic", "U1");

  try {
    const result = await guides.continueGuide(
      "thread-stuck-dynamic",
      "how do i get kicad on linux using commands",
      "U1",
    );

    assert.equal(result.isAlternate, true);
    assert.match(result.message, /apt install kicad/);
    assert.notEqual(
      result.message,
      guides.GUIDES["create-hackpad"].alternateSteps["doesn't have kicad or fusion360 installed"],
    );
  } finally {
    llm.complete = original;
  }
});

test("startGuide's create-hackpad walkthrough opens with the care package step and a screenshot", () => {
  const result = guides.startGuide("create-hackpad", "thread-hackpad", "U1");
  assert.match(result.message, /kicad_care_package|care package/);
  assert.ok(result.checkNext);
  assert.equal(result.screenshot, "create-hackpad/01.webp");
});

test("startGuide's create-devboard walkthrough opens by crediting OnBoard, with no submission/grant steps", () => {
  const result = guides.startGuide("create-devboard", "thread-devboard", "U1");
  assert.match(result.message, /OnBoard/);
  assert.ok(result.checkNext);

  const steps = guides.GUIDES["create-devboard"].steps;
  assert.ok(!steps.some((s) => /\bfork\b|pull request/i.test(s.message)));
  assert.ok(!steps.some((s) => s.screenshot === "create-devboard/19.webp"));
});

// Every step that claims a screenshot needs a file that actually exists —
// the exact class of bug the pixl-game guides shipped with (screenshot
// fields pointing at broken/placeholder captures nobody had verified).
test("every create-devboard screenshot path resolves to a real file", () => {
  const fs = require("fs");
  const path = require("path");
  for (const step of guides.GUIDES["create-devboard"].steps) {
    if (!step.screenshot) continue;
    const full = path.join(__dirname, "..", "public", "screenshots", step.screenshot);
    assert.ok(fs.existsSync(full), `missing screenshot: ${step.screenshot}`);
  }
});

test("startGuide rejects an unknown guide id", () => {
  assert.equal(guides.startGuide("does-not-exist", "thread-x", "U1"), null);
});

test("continueGuide returns null when no guide is active", async () => {
  assert.equal(await guides.continueGuide("thread-never-started", "yes"), null);
});

// Exit is checked before the model call, so bailing out is free and can't be
// broken by an API outage.
test("isExitRequest recognises the ways people actually quit", () => {
  for (const phrase of ["stop", "nvm", "nevermind", "cancel", "forget it", "  quit "]) {
    assert.equal(guides.isExitRequest(phrase), true, phrase);
  }
});

test("isExitRequest ignores normal step replies", () => {
  for (const phrase of ["yes", "it shows 2.39.2", "no it says command not found", ""]) {
    assert.equal(guides.isExitRequest(phrase), false, phrase);
  }
});

test("continueGuide cancels without an API call when the user bails", async () => {
  guides.startGuide("submit-ysws-guidelines", "thread-b", "U1");
  const result = await guides.continueGuide("thread-b", "nvm");

  assert.equal(result.cancelled, true);
  assert.equal(guides.isInGuide("thread-b"), false);
});

// A bare "yea"/"yeah" meant for someone else entirely in the same thread used
// to read exactly like ADVANCE to the step classifier, marching a guide
// forward for a person who never replied to it at all.
test("continueGuide ignores a reply from someone other than who the guide is for", async () => {
  guides.startGuide("submit-ysws-guidelines", "thread-multiuser", "U1");
  const result = await guides.continueGuide("thread-multiuser", "yeah", "U2");

  assert.equal(result, null);
  assert.equal(db.getGuide("thread-multiuser").current_step, 0);
});

test("continueGuide still advances for the person the guide was started for", async () => {
  guides.startGuide("submit-ysws-guidelines", "thread-sameuser", "U1");
  modelChoice = "ADVANCE";
  const result = await guides.continueGuide("thread-sameuser", "yeah done that", "U1");
  modelChoice = "NONE";

  assert.ok(result);
  assert.equal(db.getGuide("thread-sameuser").current_step, 1);
});

// continueGuide is called without a userId from a couple of older call sites
// below in this file — must keep behaving exactly as before when it's omitted.
test("continueGuide with no userId is unaffected by the ownership check", async () => {
  guides.startGuide("submit-ysws-guidelines", "thread-no-userid", "U1");
  modelChoice = "ADVANCE";
  const result = await guides.continueGuide("thread-no-userid", "vs code");
  modelChoice = "NONE";

  assert.ok(result);
});

// A :upvote: reaction is an explicit, unambiguous "next step" — it should
// never need a model call to interpret, unlike a typed reply.
test("advanceGuideByReaction moves to the next step with no classifier call", () => {
  guides.startGuide("submit-ysws-guidelines", "thread-react", "U1");
  modelChoice = "NONE"; // if this were read, the test would see it advance to STUCK/OTHER instead
  const result = guides.advanceGuideByReaction("thread-react", "U1");

  assert.ok(result);
  assert.equal(db.getGuide("thread-react").current_step, 1);
});

test("advanceGuideByReaction completes the guide on its last step", () => {
  guides.startGuide("submit-ysws-guidelines", "thread-react-done", "U1"); // 5 steps: 0, 1, 2, 3, 4
  guides.advanceGuideByReaction("thread-react-done", "U1"); // -> step 1
  guides.advanceGuideByReaction("thread-react-done", "U1"); // -> step 2
  guides.advanceGuideByReaction("thread-react-done", "U1"); // -> step 3
  guides.advanceGuideByReaction("thread-react-done", "U1"); // -> step 4 (last)
  const result = guides.advanceGuideByReaction("thread-react-done", "U1"); // -> completed

  assert.equal(result.completed, true);
  assert.equal(guides.isInGuide("thread-react-done"), false);
});

// Same ownership rule as a typed reply — a bystander's reaction on someone
// else's guide message must not march their walkthrough forward.
test("advanceGuideByReaction ignores a reaction from someone other than who the guide is for", () => {
  guides.startGuide("submit-ysws-guidelines", "thread-react-other", "U1");
  const result = guides.advanceGuideByReaction("thread-react-other", "U2");

  assert.equal(result, null);
  assert.equal(db.getGuide("thread-react-other").current_step, 0);
});

test("advanceGuideByReaction returns null when no guide is active", () => {
  assert.equal(guides.advanceGuideByReaction("thread-react-none", "U1"), null);
});

// active_guides is keyed on thread_ts alone, so without this check a second
// person's unrelated guide-shaped question in the same thread would silently
// overwrite whoever was already partway through via the ON CONFLICT upsert.
test("startGuide declines to steal a thread's guide slot from someone else's in-progress walkthrough", () => {
  guides.startGuide("submit-ysws-guidelines", "thread-steal", "U1");
  const stolen = guides.startGuide("create-hackpad", "thread-steal", "U2");

  assert.equal(stolen, null);
  const state = db.getGuide("thread-steal");
  assert.equal(state.guide_id, "submit-ysws-guidelines");
  assert.equal(state.user_id, "U1");
});

test("cancelGuide clears an active guide", () => {
  guides.startGuide("create-hackpad", "thread-c", "U1");
  guides.cancelGuide("thread-c");
  assert.equal(guides.isInGuide("thread-c"), false);
});

test("classifierPrompt enumerates every alternate branch as its own label", () => {
  const guide = guides.GUIDES["create-hackpad"];
  const keys = Object.keys(guide.alternateSteps);
  const prompt = guides.classifierPrompt(guide, guide.steps[0], keys);

  assert.match(prompt, /STUCK_1:/);
  assert.match(prompt, /STUCK_2:/);
  assert.match(prompt, /ADVANCE:/);
  assert.match(prompt, /OTHER:/);
  // The branch descriptions are natural language, not literal phrases the user
  // has to type.
  assert.match(prompt, /drc errors/);
});

test("detectGuideIntent skips the model when no guide subject is mentioned", async () => {
  modelChoice = "create-hackpad";
  assert.equal(await guides.detectGuideIntent("how do i fix a 404 on my deployed site?"), null);
  assert.equal(await guides.detectGuideIntent("my sprite wont load at all, what should i do?"), null);
  modelChoice = "NONE";
});

// The actual fix this session was built around: a keyword match used to be
// trusted outright and start a guide with zero further checks. It's now
// treated as a candidate only — the model still has the final say on whether
// this is really "walk me through X" versus a one-off question that happens
// to share vocabulary with a trigger. A keyword hit the model disagrees with
// must not start a guide.
test("detectGuideIntent matches keyword hits directly without requiring model confirmation", async () => {
  assert.equal(guides.detectGuideByKeyword("how do i submit my ysws guidelines"), "submit-ysws-guidelines");
  assert.equal(await guides.detectGuideIntent("how do i submit my ysws guidelines"), "submit-ysws-guidelines");
});

// The subject match is fuzzy for the same reason the keyword pass is: one typo
// used to kill guide detection outright.
test("mentionsGuideSubject survives a typo and ignores unrelated messages", () => {
  assert.equal(guides.mentionsGuideSubject("pixie help me setup hackpadd"), true);
  assert.equal(guides.mentionsGuideSubject("how do i submit my ysws guidelines"), true);
  assert.equal(guides.mentionsGuideSubject("whats the deadline"), false);
  assert.equal(guides.mentionsGuideSubject(""), false);
});

/* ---------------------------------------------------------------- blocks -- */
// A plain-text step used to fall back to one long paragraph with the question
// mashed onto the end of the message — no Block Kit at all unless there was a
// screenshot. buildGuideBlocks now always returns structured blocks, so every
// step gets the message and the question in their own visually separated
// sections regardless of whether it has an image.

test("buildGuideBlocks always returns sections, even with no screenshot", () => {
  const blocks = guides.buildGuideBlocks({ message: "do the thing", checkNext: "done? (yes/no)" }, "https://x");

  assert.ok(!blocks.some((b) => b.type === "image"));
  assert.ok(blocks.some((b) => b.type === "section" && b.text.text === "do the thing"));
  // Bolded so the question reads as the thing to actually respond to, not
  // just more body text.
  assert.ok(blocks.some((b) => b.type === "section" && b.text.text === "*done? (yes/no)*"));
});

test("buildGuideBlocks puts the screenshot first when one is present", () => {
  const blocks = guides.buildGuideBlocks(
    { message: "do the thing", checkNext: null, screenshot: "guide/01.webp" },
    "https://x",
  );

  assert.equal(blocks[0].type, "image");
  assert.equal(blocks[0].image_url, "https://x/screenshots/guide/01.webp");
});

// The literal complaint this was built to fix: the same "react :upvote:..."
// sentence repeating at the end of every single step's text.
test("buildGuideBlocks only includes the reaction-hint context block when explicitly asked", () => {
  const result = { message: "do the thing", checkNext: "done? (yes/no)" };

  const first = guides.buildGuideBlocks(result, "https://x", { showReactionHint: true });
  assert.ok(first.some((b) => b.type === "context"));

  const later = guides.buildGuideBlocks(result, "https://x");
  assert.ok(!later.some((b) => b.type === "context"));
});

test("buildGuideBlocks never shows the reaction hint on a step with no checkNext to react to", () => {
  const blocks = guides.buildGuideBlocks({ message: "all done!", checkNext: null }, "https://x", {
    showReactionHint: true,
  });

  assert.ok(!blocks.some((b) => b.type === "context"));
});
