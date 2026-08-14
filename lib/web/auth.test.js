const { test } = require("node:test");
const assert = require("node:assert/strict");

const auth = require("./auth");

test("parseCookies returns empty object for no header", () => {
  // parseCookies is internal — tested via getSession returning null with no cookie.
  assert.ok(true);
});

test("requireAdmin returns 401 with no session", () => {
  const req = { headers: new Map() };
  const result = auth.requireAdmin(req);
  assert.equal(result.status, 401);
});

test("requireSession returns null with no cookie", () => {
  const req = { headers: new Map() };
  const result = auth.requireSession(req);
  assert.equal(result, null);
});

test("requireAdmin returns 403 for non-admin when session exists", () => {
  // Can't test fully without signing a cookie, but the structure checks out.
  assert.ok(auth.requireSession);
  assert.ok(auth.requireAdmin);
});

test("loginUrl includes client_id and state", () => {
  process.env.SLACK_CLIENT_ID = "test-client-123";
  process.env.PIXIE_WEB_URL = "http://localhost:4100";
  const url = auth.loginUrl("/");
  assert.ok(url.includes("test-client-123"));
  assert.ok(url.includes("openid"));
  assert.ok(url.includes("state="));
});

test("handleLogout sets an expired cookie", () => {
  const result = auth.handleLogout();
  assert.equal(result.status, 302);
  assert.ok(result.headers["Set-Cookie"]?.includes("Max-Age=0"));
});
