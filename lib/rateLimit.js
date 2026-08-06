// Per-user throttle. Nothing bounded pixie's API spend before this — one
// person pasting in a loop could drain the budget for the whole channel.
const db = require("./db");

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 8;

// Generous enough that no real conversation trips it, tight enough that a
// script can't. Returns { allowed, retryInMs }.
function check(userId, { windowMs = WINDOW_MS, max = MAX_PER_WINDOW } = {}) {
  if (!userId) return { allowed: true, retryInMs: 0 };

  const used = db.countRecentRequests(userId, windowMs);
  if (used >= max) return { allowed: false, retryInMs: windowMs };

  db.recordRequest(userId);
  return { allowed: true, retryInMs: 0 };
}

module.exports = { check, WINDOW_MS, MAX_PER_WINDOW };
