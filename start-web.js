// Dev launcher for the web console only (no Slack bot).
const db = require("./lib/db");
const knowledge = require("./lib/knowledge");
db.open();

console.log("DB opened.");
const web = require("./lib/web/serve");
const server = web.start();

if (!server) {
  console.log("Web server not started (SLACK_CLIENT_ID not set or not dev-testing).");
  process.exit(1);
}

console.log(`Web console at http://localhost:${server.port}`);

// Without this the console comes up with only the generated sections loaded —
// no FAQ, no docs, no BM25 index — so the playground answers from pixie's
// identity alone and the retrieval trace is always empty. index.js builds the
// corpus itself; this launcher has to do it too. Not awaited: the console is
// usable while the fetch is in flight.
knowledge
  .refreshCorpus()
  .then(() => console.log(`Corpus built — ${knowledge.getIndex().docs.length} chunks.`))
  .catch((e) => console.error(`Corpus build failed: ${e.message}`));
