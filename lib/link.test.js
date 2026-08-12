const { test } = require("node:test");
const assert = require("node:assert/strict");
const link = require("./link");

test("extractUrl unwraps Slack formatted links and extracts the first http(s) URL", () => {
  assert.equal(
    link.extractUrl("check this out: <https://www.pixl.rsvp/docs|Pixl Docs>"),
    "https://www.pixl.rsvp/docs",
  );
  assert.equal(
    link.extractUrl("see <https://example.com/page> for details."),
    "https://example.com/page",
  );
  assert.equal(
    link.extractUrl("pixie how does this look? https://example.org/test"),
    "https://example.org/test",
  );
  assert.equal(link.extractUrl("no links in this message"), null);
});

test("isPrivateOrLoopbackIp detects loopback and private IPv4 and IPv6 addresses", () => {
  assert.equal(link.isPrivateOrLoopbackIp("127.0.0.1"), true);
  assert.equal(link.isPrivateOrLoopbackIp("127.0.0.254"), true);
  assert.equal(link.isPrivateOrLoopbackIp("10.0.1.5"), true);
  assert.equal(link.isPrivateOrLoopbackIp("172.16.0.1"), true);
  assert.equal(link.isPrivateOrLoopbackIp("172.31.255.255"), true);
  assert.equal(link.isPrivateOrLoopbackIp("192.168.1.1"), true);
  assert.equal(link.isPrivateOrLoopbackIp("169.254.169.254"), true);
  assert.equal(link.isPrivateOrLoopbackIp("::1"), true);
  assert.equal(link.isPrivateOrLoopbackIp("::ffff:127.0.0.1"), true);
  assert.equal(link.isPrivateOrLoopbackIp("fc00::1"), true);
  assert.equal(link.isPrivateOrLoopbackIp("fd00::1234"), true);
  assert.equal(link.isPrivateOrLoopbackIp("fe80::1"), true);

  // Public IPs
  assert.equal(link.isPrivateOrLoopbackIp("8.8.8.8"), false);
  assert.equal(link.isPrivateOrLoopbackIp("1.1.1.1"), false);
  assert.equal(link.isPrivateOrLoopbackIp("93.184.216.34"), false);
});

test("isBlockedHost blocks localhost, loopback, private IPs, and non-http(s) schemes", async () => {
  assert.equal(await link.isBlockedHost("http://localhost:8000"), true);
  assert.equal(await link.isBlockedHost("http://test.localhost"), true);
  assert.equal(await link.isBlockedHost("http://127.0.0.1:3000"), true);
  assert.equal(await link.isBlockedHost("http://169.254.169.254/latest/meta-data"), true);
  assert.equal(await link.isBlockedHost("http://10.0.0.1"), true);
  assert.equal(await link.isBlockedHost("http://192.168.1.1"), true);
  assert.equal(await link.isBlockedHost("http://[::1]:8080"), true);
  assert.equal(await link.isBlockedHost("ftp://example.com/file"), true);
  assert.equal(await link.isBlockedHost("file:///etc/passwd"), true);
});

test("isBlockedHost allows public domain names", async () => {
  assert.equal(await link.isBlockedHost("https://github.com"), false);
  assert.equal(await link.isBlockedHost("https://www.pixl.rsvp"), false);
});

test("fetchUrlContent returns blocked response for local or internal hosts", async () => {
  const result = await link.fetchUrlContent("http://localhost:8000");
  assert.equal(result.blocked, true);
  assert.match(result.reason, /pixie can only open public URLs/);
});
