process.env.PIXIE_DB_PATH = ":memory:";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const db = require("./db");
const programs = require("./programs");

db.open(":memory:");

/* ----------------------------------------------------------------- scope -- */
// What pixie answers when nobody addressed her: everything someone's stuck on,
// or only this program's questions. Stored per program so one deployment can
// run a locked-down #pixl next to an open #sprig-help.

test("scope defaults to any, so an existing program keeps answering everything", () => {
  programs.saveProgram({ id: "t-open", name: "Open Program" });
  assert.equal(programs.scope("t-open"), "any");
  assert.equal(programs.isProgramScoped(programs.get("t-open")), false);
});

test("scope survives a round trip through the database", () => {
  programs.saveProgram({ id: "t-scoped", name: "Scoped Program", scope: "program" });
  programs.invalidate();

  const loaded = programs.get("t-scoped");
  assert.equal(loaded.scope, "program");
  assert.equal(programs.scope("t-scoped"), "program");
  assert.equal(programs.isProgramScoped(loaded), true);
  assert.equal(programs.isProgramScoped("t-scoped"), true);
});

test("scope can be flipped back without a redeploy", () => {
  programs.saveProgram({ id: "t-flip", name: "Flip", scope: "program" });
  assert.equal(programs.scope("t-flip"), "program");

  programs.saveProgram({ ...programs.get("t-flip"), scope: "any" });
  assert.equal(programs.scope("t-flip"), "any");
});

// Anything that isn't the literal string "program" is treated as open. A typo
// in programs.json should leave pixie answering, not silently mute her.
test("an unrecognised scope value falls back to any", () => {
  programs.saveProgram({ id: "t-typo", name: "Typo", scope: "programme" });
  programs.invalidate();
  assert.equal(programs.scope("t-typo"), "any");
});

test("the shared YSWS program is never scoped", () => {
  assert.equal(programs.shared().scope, "any");
  assert.equal(programs.isProgramScoped(programs.shared()), false);
  assert.equal(programs.scope(null), "any");
});

/* ------------------------------------------------ PIXIE_PROGRAMS_JSON -- */
// One engine image serves the whole bot fleet, so the image can't carry any
// single bot's channels or sources. A provisioned bot gets them as a variable
// instead, and it has to win over the programs.json baked into the image —
// otherwise bot #7 boots answering from Pixl's docs.

function withEnvPrograms(value, fn) {
  const saved = process.env.PIXIE_PROGRAMS_JSON;
  if (value === undefined) delete process.env.PIXIE_PROGRAMS_JSON;
  else process.env.PIXIE_PROGRAMS_JSON = value;
  programs.invalidate();
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.PIXIE_PROGRAMS_JSON;
    else process.env.PIXIE_PROGRAMS_JSON = saved;
    programs.invalidate();
  }
}

test("PIXIE_PROGRAMS_JSON supplies programs without any file on disk", () => {
  withEnvPrograms(
    JSON.stringify([
      {
        id: "solvable",
        name: "Solvable",
        helpChannel: "C0SOLVE",
        channels: ["C0SOLVE", "C0CHAT"],
        scope: "program",
        posture: "passive",
        sources: [{ name: "Solvable Docs", type: "url", url: "https://solvable.hackclub.com/docs" }],
      },
    ]),
    () => {
      const p = programs.get("solvable");
      assert.equal(p.name, "Solvable");
      assert.equal(p.helpChannel, "C0SOLVE");
      assert.equal(p.scope, "program");
      assert.equal(p.posture, "passive");
      assert.equal(p.sources[0].url, "https://solvable.hackclub.com/docs");
      assert.equal(programs.forChannel("C0CHAT").id, "solvable");
      assert.equal(programs.isHelpChannel("C0SOLVE"), true);
    },
  );
});

// The whole point: the variable has to beat the repo's programs.json, which in a
// fleet image holds whichever program it was last built for.
test("PIXIE_PROGRAMS_JSON wins over the repo's programs.json", () => {
  withEnvPrograms(JSON.stringify([{ id: "solvable", name: "Solvable", channels: ["C0SOLVE"] }]), () => {
    const ids = programs.all().map((p) => p.id);
    assert.ok(ids.includes("solvable"));
    assert.ok(!ids.includes("pixl"), "the image's own program must not leak into a fleet bot");
  });
});

// `{ programs: [...] }` is the shape the control plane finds easiest to extend.
test("PIXIE_PROGRAMS_JSON accepts the wrapped object form", () => {
  withEnvPrograms(JSON.stringify({ programs: [{ id: "twisted", name: "Twisted" }] }), () => {
    assert.equal(programs.get("twisted").name, "Twisted");
  });
});

// A truncated blob must not crash-loop the bot where nobody can reach it — it
// falls back to the files and logs instead.
test("malformed PIXIE_PROGRAMS_JSON falls back to files instead of throwing", () => {
  withEnvPrograms('[{"id":"solvable"', () => {
    const ids = programs.all().map((p) => p.id);
    assert.ok(ids.length > 0);
    assert.ok(!ids.includes("solvable"));
  });
});

test("PIXIE_PROGRAMS_JSON of the wrong type falls back to files", () => {
  withEnvPrograms(JSON.stringify({ solvable: { name: "Solvable" } }), () => {
    assert.ok(!programs.all().some((p) => p.id === "solvable"));
  });
});

// An id is what forChannel/get/posture key off, so a record without one is
// unaddressable — dropped rather than kept as a program nothing can reach.
test("PIXIE_PROGRAMS_JSON drops records with no id", () => {
  withEnvPrograms(JSON.stringify([{ name: "Nameless" }, { id: "real", name: "Real" }]), () => {
    const ids = programs.all().map((p) => p.id);
    assert.deepEqual(ids.filter((id) => id === "real"), ["real"]);
    assert.ok(!ids.includes(undefined));
  });
});

// sources.json in the image is Pixl's shared layer. A fleet bot has to be able
// to replace it, so ysws-global is overridable through the same variable.
test("a ysws-global entry in PIXIE_PROGRAMS_JSON overrides the shared sources", () => {
  withEnvPrograms(
    JSON.stringify([
      { id: "ysws-global", name: "Shared", sources: [{ name: "My FAQ", type: "json-faq", content: [] }] },
    ]),
    () => {
      const sharedProg = programs.shared();
      assert.equal(sharedProg.sources.length, 1);
      assert.equal(sharedProg.sources[0].name, "My FAQ");
      assert.equal(sharedProg.scope, "any", "shared stays unscoped whatever the blob says");
    },
  );
});

test("with no PIXIE_PROGRAMS_JSON the shared program still comes from sources.json", () => {
  withEnvPrograms(undefined, () => {
    assert.equal(programs.shared().id, "ysws-global");
    assert.equal(programs.shared().name, "YSWS Global");
  });
});

// sources.json holds Pixl's quick links. A fleet bot that didn't ask for them
// must not get them — they'd show up as an extra source and answer Pixl questions
// in another program's channel.
test("a fleet bot gets an empty shared layer rather than Pixl's quick links", () => {
  withEnvPrograms(JSON.stringify([{ id: "solvable", name: "Solvable" }]), () => {
    const sharedProg = programs.shared();
    assert.deepEqual(sharedProg.sources, []);
    assert.deepEqual(sharedProg.milestones, []);
    assert.equal(sharedProg.scope, "any");
    assert.deepEqual(sharedProg.guides, ["submit-ysws-guidelines"]);
  });
});

// The shared program is the fallback for channels no program claims. Scoping it
// would leave those channels with a bot that answers nothing.
test("the shared program stays unscoped even if the blob says otherwise", () => {
  withEnvPrograms(JSON.stringify([{ id: "ysws-global", name: "Shared", scope: "program" }]), () => {
    assert.equal(programs.shared().scope, "any");
  });
});
