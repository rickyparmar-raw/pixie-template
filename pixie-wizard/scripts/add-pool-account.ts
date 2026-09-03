// Adds a Railway account to the provisioning pool.
//
// The pool is the one thing the wizard cannot set up for itself: every account
// token has to be encrypted with WIZARD_ENCRYPTION_KEY before it goes near the
// database, so pasting a row into the Supabase table editor by hand produces a
// row that fails to decrypt at provision time. This does it properly.
//
//   bun run scripts/add-pool-account.ts --label acct-1 --email me@example.com \
//     --plan hobby --token <railway-account-token>
//
// Reads .env.local for SUPABASE_URL / SUPABASE_SERVICE_KEY / WIZARD_ENCRYPTION_KEY.
//
// The token must be an ACCOUNT-scoped token (Railway dashboard → Account
// Settings → Tokens), not a project token: provisioning creates projects, which a
// project-scoped token cannot do.
import { db } from "@/lib/supabase";
import { encryptSecret } from "@/lib/crypto";

interface Args {
  label?: string;
  token?: string;
  email?: string;
  plan?: string;
  max?: string;
  notes?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key && value) (out as Record<string, string>)[key] = value;
  }
  return out;
}

// supabase-js reports every transport failure as "Unable to connect. Is the
// computer able to access the url?" — which is the same message whether the
// project is paused, the URL is wrong, or the network is down. A paused free-tier
// project is by far the likeliest of those (Supabase pauses them after about a
// week of inactivity, and dashboard browsing doesn't count as activity), so this
// checks reachability first and says which it is.
async function preflight(url: string): Promise<void> {
  const ref = url.replace(/^https?:\/\//, "").split(".")[0];
  try {
    // /auth/v1/health needs no key and answers on any live project. A paused
    // project refuses the connection outright rather than returning an error body.
    const res = await fetch(`${url}/auth/v1/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    // Any HTTP answer at all means the host is up; status doesn't matter here.
    if (res) return;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`Can't reach ${url}`);
    console.error("");
    console.error("Most likely the project is paused — Supabase pauses free-tier projects");
    console.error("after about a week with no API calls. Open");
    console.error(`  https://supabase.com/dashboard/project/${ref}`);
    console.error("and hit Restore if that's it, then run this again. The data is intact;");
    console.error("a paused project just accepts no connections.");
    console.error("");
    console.error("If it isn't paused, check SUPABASE_URL in .env.local and your own network.");
    console.error(`(underlying error: ${detail})`);
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.label || !args.token) {
    console.error("usage: bun run scripts/add-pool-account.ts --label <name> --token <railway-token>");
    console.error("       [--email owner@example.com] [--plan free|hobby|pro] [--max 3] [--notes '...']");
    process.exit(1);
  }

  // Railway's account tokens have no fixed prefix to check, but a project token
  // pasted here is the likeliest mistake and it fails much later — at the first
  // projectCreate, with an opaque authorization error. A length sanity check
  // catches the other common one: a truncated copy-paste.
  if (args.token.length < 20) {
    console.error("that token looks too short — copy the whole value from Railway");
    process.exit(1);
  }

  const plan = args.plan ?? "hobby";
  if (!["free", "hobby", "pro"].includes(plan)) {
    console.error(`--plan must be free, hobby or pro (got "${plan}")`);
    process.exit(1);
  }

  const { data, error } = await db
    .from("railway_account_pool")
    .insert({
      label: args.label,
      api_token_encrypted: encryptSecret(args.token),
      owner_email: args.email ?? null,
      plan,
      // Railway's own project ceiling is far higher, but bots share an account's
      // compute budget — three is a deliberate default, not a limit of the API.
      max_concurrent_trials: args.max ? Number(args.max) : 3,
      token_created_at: new Date().toISOString(),
      notes: args.notes ?? null,
    })
    .select("id,label,plan,max_concurrent_trials")
    .single();

  if (error) {
    console.error(`insert failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`added pool account ${data.label} (${data.id})`);
  console.log(`  plan: ${data.plan}, capacity: ${data.max_concurrent_trials} bots`);
  console.log("");
  console.log("Before provisioning a real bot on it, confirm this account's GitHub app can");
  console.log("see the engine repo — serviceCreate deploys straight from it, and a missing");
  console.log("connection fails with an opaque Railway error mid-provision.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
