# Pixie runs on Bun, not Node — lib/db.js imports `bun:sqlite`, which does not
# exist under Node. Railway's Nixpacks builder picks Node for this repo (there
# is no bun.lock here to tip it off), so the runtime is pinned explicitly here
# instead.
FROM oven/bun:1

# The base image drops to USER bun. A Railway volume mounts owned by root, so a
# non-root process cannot create pixie.db on it — the bot would crash on its
# first write. Staying root is the simplest thing that works with a volume.
USER root

WORKDIR /app

# Dependencies in their own layer so editing lib/ doesn't re-resolve them.
COPY package.json ./
RUN bun install

COPY . .

# Socket Mode: pixie dials out to Slack and listens on no port at all. This
# service needs no Railway domain and no healthcheck path.
CMD ["bun", "index.js"]
