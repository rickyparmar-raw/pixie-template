

const { config } = require("./config");

const subscribers = [];

function subscribe(fn) {
  subscribers.push(fn);
  return () => {
    const idx = subscribers.indexOf(fn);
    if (idx !== -1) subscribers.splice(idx, 1);
  };
}

function notify(kind, scope, args) {
  if (subscribers.length === 0) return;
  for (const fn of subscribers) {
    try { fn(kind, scope, args); } catch (_) {}
  }
}

function format(scope, args) {
  return [`[pixie/${scope}]`, ...args];
}

function debug(scope, ...args) {
  if (config.debug) console.log(...format(scope, args));
  notify("debug", scope, args);
}

function info(scope, ...args) {
  console.log(...format(scope, args));
  notify("info", scope, args);
}

function warn(scope, ...args) {
  console.warn(...format(scope, args));
  notify("warn", scope, args);
}

function error(scope, ...args) {
  console.error(...format(scope, args));
  notify("error", scope, args);
}

module.exports = { debug, info, warn, error, subscribe };
