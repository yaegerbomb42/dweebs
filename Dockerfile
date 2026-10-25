# DWEEBS game server — authoritative multiplayer, one container.
#
# Build context is the dweebs repo root (the server imports ../src/**), so this
# lives next to package.json rather than inside server/. Deploys through the
# universal pipeline: ./infra/deploy.sh dweebs
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /srv/dweebs

# Dependencies first, so source edits don't invalidate the npm layer.
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

# The server needs the wire protocol + sims; the static site ships separately.
COPY server/ ./server/
COPY src/ ./src/

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8787/healthz || exit 1

# --sim real: authoritative physics with bots filling empty seats.
# --max-rooms 24: measured on the VPS at ~0.22 ms/room/tick (tools/perf-rooms.mjs),
# i.e. ~5.4 ms of a 16.67 ms frame — a third of one core, with snapshot headroom.
CMD ["node", "server/index.js", "--port", "8787", "--sim", "real", "--codec", "bin", "--max-rooms", "24"]
