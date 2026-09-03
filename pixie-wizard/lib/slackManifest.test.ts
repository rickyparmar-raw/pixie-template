import { test, expect } from "bun:test";
import { generateSlackManifest, commandNamesFor, commandName, slugify } from "./slackManifest";

// The manifest and the engine's listeners are generated from the same slug on
// purpose. If they drift, the app advertises /sol-teach while the process listens
// for /pixie-teach and every admin command silently no-ops — a failure with no
// error anywhere, which is why it's worth pinning down here.

test("commands are named from the bot's slug, not from pixie", () => {
  const names = commandNamesFor("sol");
  expect(names).toContain("/sol");
  expect(names).toContain("/sol-teach");
  expect(names).toContain("/sol-program");
  expect(names.some((n) => n.startsWith("/pixie"))).toBe(false);
});

// This set must equal what lib/commands.js register() wires up. A command in the
// manifest with no listener is a command that acks nothing; a listener with no
// manifest entry is unreachable.
test("the manifest advertises exactly the twelve commands the engine registers", () => {
  const manifest = generateSlackManifest("Sol", "Solvable", "sol");
  const advertised = manifest.features.slash_commands.map((c) => c.command).sort();

  expect(advertised).toEqual(
    [
      "/sol",
      "/sol-approve",
      "/sol-forget",
      "/sol-gaps",
      "/sol-guide",
      "/sol-pending",
      "/sol-program",
      "/sol-reload",
      "/sol-report",
      "/sol-sources",
      "/sol-stats",
      "/sol-teach",
    ].sort(),
  );
});

// The old manifest listed both /pixie-guide and a bare /guide. Slash command
// names are unique per workspace and every fleet bot shares the Hack Club one, so
// a second bot claiming /guide would fail to install.
test("no unprefixed command is claimed, since the workspace is shared", () => {
  const manifest = generateSlackManifest("Sol", "Solvable", "sol");
  const advertised = manifest.features.slash_commands.map((c) => c.command);

  expect(advertised).not.toContain("/guide");
  expect(advertised.every((c) => c === "/sol" || c.startsWith("/sol-"))).toBe(true);
});

test("no two commands share a name", () => {
  const advertised = generateSlackManifest("Sol", "Solvable", "sol").features.slash_commands.map((c) => c.command);
  expect(new Set(advertised).size).toBe(advertised.length);
});

// Slack rejects spaces and uppercase in command names, so a display name used as
// the slug has to be slugified first.
test("the slug falls back to the bot name, slugified", () => {
  const manifest = generateSlackManifest("Sol Helper", "Solvable");
  expect(manifest.features.slash_commands[0].command).toBe("/sol-helper");
});

test("slugify mirrors the engine's own rule", () => {
  expect(slugify("Solvable! YSWS (2026)")).toBe("solvable-ysws-2026");
  expect(slugify("!!!")).toBe("pixie");
});

test("commandName builds the bare ask command from a null suffix", () => {
  expect(commandName("sol", null)).toBe("/sol");
  expect(commandName("sol", "gaps")).toBe("/sol-gaps");
});

// Matches lib/brand.js id(): underscores, and a hyphenated slug must not leak a
// hyphen into a callback id.
test("the shortcut callback id is slugged and underscored", () => {
  const manifest = generateSlackManifest("Sol Helper", "Solvable", "sol-helper");
  expect(manifest.features.shortcuts[0].callback_id).toBe("sol_helper_teach_thread");
  expect(manifest.features.shortcuts[0].name).toBe("Teach Sol Helper from thread");
});

test("display name and description name the bot and its program", () => {
  const manifest = generateSlackManifest("Sol", "Solvable", "sol");
  expect(manifest.display_information.name).toBe("Sol");
  expect(manifest.display_information.description).toMatch(/Solvable/);
  expect(manifest.features.bot_user.display_name).toBe("Sol");
});

// Socket Mode is how the engine connects — it listens on no port at all, so a
// manifest without this produces a bot that can never receive an event.
test("socket mode and interactivity stay enabled", () => {
  const manifest = generateSlackManifest("Sol", "Solvable", "sol");
  expect(manifest.settings.socket_mode_enabled).toBe(true);
  expect(manifest.settings.interactivity.is_enabled).toBe(true);
  expect(manifest.features.app_home.home_tab_enabled).toBe(true);
});

test("the scopes the engine actually calls are all requested", () => {
  const scopes = generateSlackManifest("Sol", "Solvable", "sol").oauth_config.scopes.bot;
  for (const needed of ["chat:write", "channels:join", "commands", "reactions:write", "files:read"]) {
    expect(scopes).toContain(needed);
  }
});

test("with no slug the default bot still gets pixie's own commands", () => {
  expect(commandNamesFor("pixie")).toContain("/pixie-teach");
});
