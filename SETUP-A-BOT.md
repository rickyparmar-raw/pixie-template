# Setting up your first bot

Two ways in. **Path A** runs the wizard and deploys through it — that's the real
system, and worth doing if you want the fleet. **Path B** skips the wizard entirely
and puts one bot on Railway by hand in about fifteen minutes, which is the faster
way to see a bot answering in Slack today.

Both produce the same thing: one engine image reading its whole identity from
environment variables.

---

## What's ready and what isn't

Working end to end: the engine (rebrands itself from one slug, loads config from
`PIXIE_PROGRAMS_JSON`), the Railway client (project, service, volume, variables,
deploy, status polling, pause/resume/delete), the account pool with encrypted
tokens, and the wizard's first five steps — program info, model key, sources, Slack
handshake with the live command preview, channel picker, review, deploy.

Not built yet: wizard form steps for behaviour (posture, scope, guides, tickets,
escalation emoji) and for admins beyond the requester. The database columns and the
env contract for all of those exist, so they default sensibly and can be set by
updating the row — there's just no form for them. Also missing: `pixie fleet status`.

One gap that will bite in Path A: **Hack Club Auth only gives the wizard your
Slack ID if your HCA identity has one linked.** No Slack ID means no
`PIXIE_ADMIN_USER_IDS`, and `isAdmin()` fails closed — the bot answers questions
fine but nobody can teach it anything. Check after deploying; if the admin variable
is missing, set it on the Railway service by hand.

---

## Path A — through the wizard

### 1. Supabase

Create a project, then run both files in the SQL editor, in order:

```
pixie-wizard/supabase/schema.sql
pixie-wizard/supabase/migrations/001_fleet_config.sql
```

The migration is idempotent, so re-running it is safe. Copy the project URL and the
**service role** key (not the anon key — the wizard writes secrets).

### 2. Wizard environment

`pixie-wizard/.env.local` already exists with Supabase, HCA and encryption values
set, plus `WIZARD_DRY_RUN=1`. Keep the dry run on for the first pass: it logs the
exact variables it would send, with secrets redacted, and fabricates success. That's
how you check the whole flow without spending a Railway project.

If you're starting fresh instead, `.env.example` lists every key. The one that
matters most:

```sh
openssl rand -base64 32   # WIZARD_ENCRYPTION_KEY — 32 bytes, base64
```

Lose that key and every stored token becomes undecryptable ciphertext.

Two values fail **open** today and should be set before anyone else can reach the
wizard: `PIXIE_WIZARD_ALLOWLIST` (empty means any Hack Club Auth account can
provision on your Railway bill) and `CRON_SECRET` (empty means the sweep endpoint,
which pauses and deletes bots, is callable by anyone who finds the URL).

### 3. Railway pool

At least one account. The token must be **account-scoped** — Railway dashboard →
Account Settings → Tokens — because provisioning creates projects, which a
project-scoped token can't do. Then, from `pixie-wizard/`:

```sh
bun run pool:add --label acct-1 --email you@example.com --plan hobby --token <token>
```

Use the script rather than the Supabase table editor: the token has to be encrypted
with `WIZARD_ENCRYPTION_KEY` first, and a hand-pasted plaintext row fails to decrypt
at provision time.

Then connect that account's GitHub app to `rickyparmar-raw/PIXIE`. `serviceCreate`
deploys straight from the repo, and a missing connection fails mid-provision with an
opaque Railway error — this is the step most likely to be forgotten.

On sourcing accounts: multi-accounting is what Railway's fair-use enforcement looks
for, so make each account legitimately separate (its own paid Hobby, or owned by the
program lead with you added as a workspace member — members cost no seat). See §5.1
of the plan.

### 4. Run it

```sh
cd pixie-wizard && bun install && bun dev     # localhost:4901
```

Log in — `/api/auth/dev-login` skips the HCA round trip in development. Then work
through: program name → model key (Hack Club AI is the provider,
and the key is probed live so a bad one is a form error rather than a crashed
service) → sources → Slack app.

The Slack step is manual and stays that way: Slack can't create an app on your
behalf without an org-level config token. Copy the generated manifest, create the
app at api.slack.com/apps from it, install it, then paste back the bot token
(`xoxb-`) and an app-level token (`xapp-`, needs the `connections:write` scope).

Set the **command prefix** on that step. It becomes every slash command, the
Railway project name, and the program id. It must be unique across the workspace —
two bots can't both own `/sol` — and changing it after the app exists means renaming
every command by hand.

Then channels, review, deploy. With `WIZARD_DRY_RUN=1` you'll see the resolved
variables in the terminal. Read them, confirm `PIXIE_PROGRAMS_JSON` holds your
sources and channels, then drop the flag and deploy for real.

### 5. After the deploy goes green

A green build only proves the process started. Invite the bot to private channels by
hand (it self-joins public ones at boot), then ask it something and confirm an answer
comes back.

---

## Path B — one bot by hand

Skip Supabase, skip the pool, skip the wizard.

Create the Slack app first — either from the manifest the wizard generates, or
following README's "Slack App Setup" section. Socket Mode on, `connections:write` on
the app-level token. Grab `xoxb-` and `xapp-`.

Then a Railway project from the engine repo, with a volume mounted at `/data`
(attach it **before** the first deploy — the engine opens SQLite on boot, so a volume
added later means the first run wrote somewhere that then vanished).

Variables:

```sh
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_HELP_CHANNEL=C0SOLVE          # required even with the programs blob set
SLACK_FAQ_CHANNELS=C0SOLVE,C0CHAT   # first entry is the auto-reply channel
HCAI_API_KEY=...

PIXIE_BOT_NAME=Sol
PIXIE_BOT_SLUG=sol
PIXIE_DB_PATH=/data/pixie.db
PIXIE_ADMIN_USER_IDS=U01ABCDEF      # your Slack ID; empty means nobody can teach it

PIXIE_PROGRAMS_JSON=[{"id":"solvable","name":"Solvable","helpChannel":"C0SOLVE","channels":["C0SOLVE","C0CHAT"],"scope":"program","posture":"active","guides":["submit-ysws-guidelines"],"sources":[{"name":"Solvable Docs","type":"url","url":"https://solvable.hackclub.com/docs"},{"name":"Solvable FAQ","type":"json-faq","content":[{"question":"What is Solvable?","answer":"Find a problem in your life and 3D design a solution."}]}]}]
```

The first five are validated at startup and the process refuses to boot without
them, listing everything absent. The `SLACK_*` channel variables stay required even
though the programs blob also carries channels — that validation predates the blob.

Use one `HCAI_API_KEY`. `FIRECRAWL_API_KEY` is optional, for doc sites that need
JavaScript rendering.

Deploy. Expect `connected via Socket Mode as U...` in the logs, then twelve `/sol-*`
commands live in Slack.

### Sources

Four types: `url` (a docs site, follows subpages), `github-dir` (a GitHub contents
API directory of markdown, with `siteUrl` for the rendered version), `json-faq`
(either `content` inline as above, or a `url`), and `text` (inline prose).

Inline content is the one that makes a shared image work — a FAQ typed into the
wizard travels inside the blob, with no file baked into the image and nothing to
fetch.

---

## Adding the second bot

Same Slack app dance, new slug, new `PIXIE_PROGRAMS_JSON`, and — if you're following
the plan's Railway model — a different pool account.

Nothing else. Both bots run the identical image from `main`, so a feature you push
rebuilds every bot automatically. That's the whole point of the config-only design:
a new YSWS bot is a row, not a fork.

The one rule that keeps auto-deploy safe: **new configuration must always default to
today's behaviour.** A commit that requires a new variable deploys before the
variable exists, `validate()` throws, and every bot is down until you finish
backfilling. Add the variable in one push, backfill it, then ship the commit that
uses it.
