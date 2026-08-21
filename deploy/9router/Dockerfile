# 9Router as a PRIVATE Railway service — the model gateway pixie talks to over
# Railway's internal network, so it can use kr/claude-sonnet-4.5 instead of the
# free Zen tier.
#
# Keep this service on the private network — no public domain.
#
# The gateway does gate remote callers ("API key required for remote API
# access"), but it trusts loopback unconditionally: on a dev box `Bearer
# anything` returns a full Sonnet stream. Only the remote check stands between a
# public URL and your provider quota, and everything behind it is upstream
# credentials that aren't ours to leak. Private network costs nothing here —
# pixie reaches it at 9router.railway.internal:20128 either way.
#
# DEPLOYING: do NOT run `railway up` from this directory. Railway walks up to the
# repo root looking for config and finds apps/pixie/railway.json, which builds
# pixie's Dockerfile and starts `bun index.js` — the service then boots pixie and
# crashloops on missing Slack vars. Copy this file and railway.json into an empty
# directory outside the repo, `railway link --project <id> --service 9router`
# there, then `railway up`. (Setting the service's Root Directory to
# apps/pixie/deploy/9router in the dashboard also works and is less fiddly.)
FROM node:22-slim

# Pinned deliberately. The CLI self-updates by default, which in a container
# means the version you tested is not necessarily the version that boots after
# the next restart.
RUN npm install --global 9router@0.5.40

# Provider connections, issued API keys and the CLI/server shared secret all
# live under DATA_DIR. Without a Railway volume mounted here, every redeploy
# starts with an empty database and no provider is connected — pixie's calls
# then fail over to Zen and quietly get worse.
#
# Set after the install above, not before: the package's postinstall warms its
# SQLite runtime into DATA_DIR, and anything written to the volume path during a
# build is discarded when Railway mounts the real volume over it. Warming into
# the image and switching to /data at runtime costs one lazy re-fetch on first
# boot instead of a silent miss. No VOLUME directive either — Railway owns the
# mount, and declaring it here only widens the window for that same discard.
ENV DATA_DIR=/data

EXPOSE 20128

# --host :: because Railway's private network is IPv6-only. Binding 0.0.0.0
# listens on IPv4 alone and leaves <service>.railway.internal unreachable, which
# looks exactly like the gateway being down.
CMD ["9router", "--host", "::", "--port", "20128", "--no-browser", "--skip-update", "--log"]
