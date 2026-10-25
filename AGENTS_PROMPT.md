# DWEEBS — multi-agent brief (paste the SHARED BRIEF + one ROLE CARD into each agent)

---------------------------------------------------------------------------------------------------
## SHARED BRIEF (every agent gets this)

You are one of 4 agents turning **DWEEBS** (a browser party-brawler) into a stronger web app that is
**multiplayer ready**. A 5th session, the **Lead**, owns game feel, art, audio and branding, and integrates your work.

**Project:** `/Users/yaeger/Desktop/dweebs`. Vite 8, three.js r186, Rapier (`@dimforge/rapier3d-compat`),
toon shading + OutlineEffect, synthesized WebAudio. `npm run dev` (port 5173) and `npm run build`.
Read these before touching anything: `WHY.md` (the design log, and the reasons behind every number), `src/game/Balance.js`
(the single source of gameplay numbers), and `src/main.js` (the frame loop and wiring).

**Map of the code:**
- `src/main.js`: boot, the frame loop, and event wiring. The loop order is controller/bots → Dweeb.preStep → physics →
  postStep → handleImpacts → combat.update → drops → match.update → hud → aim → camera.
- `src/player/Dweeb.js`: character physics and state (hitstun, ledge, air-dodge, flail) **plus** its visuals.
- `src/combat/CombatSystem.js`: attacks, grabs/throws, knockback, fuses, trickshots, throw prediction.
- `src/game/Match.js`: stocks, rounds, blast lines, sudden death. `Announcer.js` is the KO lines; `Fx.js` is hit feedback.
- `src/world/Arena.js`, `ObjectRegistry.js`, `InteractiveObject.js`, `ObjectModels.js`: the stage, items and drops.
- `src/ai/Bot.js`: bots. They produce the same inputs as `src/player/Controller.js`.
- `src/render/*`, `src/audio/*`, `src/ui/Hud.js`, `index.html`: presentation.
- `window.__dweebs` exposes the live game for debugging (physics, match, combat, player, dweebs, …).

**Goal:**
- 2–8 players can join a room by link or code and play a full match at 60 fps.
- It stays playable at ~120 ms RTT.
- A server is authoritative over outcomes (hits, KOs, stocks).
- **Offline play vs bots keeps working at every step.** Offline is the default mode and must never break.

**Target architecture (agreed; change it only via the board):**
1. A **pure simulation** (`src/sim/`) with a fixed 60 Hz step.
   - No three.js, DOM or audio imports.
   - Input per player per tick is `{moveX, moveY, jump, attack, grab, dodge, aimYaw, aimLoft, charge…}`.
   - `snapshot()` and `restore()` must be serializable.
   - It emits typed events (hit, ko, splash, throw…) that the view layer turns into Fx, Hud and audio.
2. A **view layer** that renders sim state and interpolates between ticks.
3. An **authoritative server** (Node + `ws`, in `server/`) that runs the same `src/sim` headless.
   - Clients send inputs.
   - The server broadcasts snapshots at 20–30 Hz as deltas, plus events.
4. The **client** predicts and reconciles its own dweeb and interpolates everything else at ~100 ms.
   - Cosmetic Fx play locally.
   - Authoritative events (KO, stock loss) come from the server.

**Rules of engagement:**
- **Git:** work in your own branch or worktree, `agent/<role>` (e.g. `git worktree add ../dweebs-net agent/net`).
  - Merge small and often to `main`, and rebase before merging.
  - Merge only when `npm run build` and `npm test` pass and offline play still works.
- **The board, `COORDINATION.md`:**
  - Before editing a file outside your ownership, add a line under **Claims** and check nobody else holds it.
  - Publish interfaces under **Contracts** *before* building against them.
  - Put asks for other agents under **Requests**, and log merged work under **Done**. Keep entries one line, dated, and signed with your role.
  - If you can message other sessions (SendMessage / ListAgents), ping the owner too. The board is still the record.
- **Numbers:** do not change values in `Balance.js` or tune feel. If the netcode needs a constant, add it in a new `NET` block
  there, and post it on the board. The Lead owns every existing number.
- **Presentation:** do not rewrite art, models, audio, fonts or the HUD look. The Lead is mid-way through a branding
  and character pass (new logo, loading screen, character models). Move and wrap presentation code if you must, but don't restyle it.
- **Performance:**
  - Budgets: 60 fps with 8 players and 40+ items; no per-frame allocations in hot paths (reuse vectors, pool objects);
    sim step ≤ 4 ms on a mid laptop.
  - Keep network payloads compact (quantize positions and rotations, send deltas). Target ≤ 8 KB/s per client downstream at 8 players.
- **WHY.md:** every non-obvious decision gets a short entry under your role's heading: what, why, and any numbers.
- If you're blocked, say so on the board and take the next item. Don't stall, and don't silently edit around another agent's claim.

**Milestones (all agents move together):**
- **M1, foundations:**
  - Git and CI are green.
  - The sim contract is published.
  - A protocol draft exists.
  - The app shell routes Menu, Play (offline) and Lobby.
- **M2, headless:**
  - A full bot match runs in Node through `src/sim`, with the same results as in the browser.
  - The server hosts rooms.
  - Two browsers see each other move, server-authoritative and interpolated.
- **M3, playable online:**
  - Prediction and reconciliation, synced items and throws, and hits credited by the server.
  - Lobby: create or join by code, pick archetype and colour, ready up.
  - Reconnect, and bots fill empty slots.
- **M4, hardened:**
  - 8 players with 150 ms simulated latency and 2% packet loss is playable.
  - A 30-minute soak with no desyncs or leaks.
  - Deployed.

---------------------------------------------------------------------------------------------------
## ROLE CARD 1 — SIM (simulation extraction). Owns `src/sim/**`

Carve a deterministic, headless-capable simulation out of `main.js`, `Dweeb.js`, `CombatSystem.js`, `Match.js`,
`Arena.js`, `InteractiveObject.js` and `Bot.js`.

1. **First deliverable, day one:** publish `src/sim/contracts.js` (JSDoc types) on the board.
   It covers `InputFrame`, `SimConfig`, `Sim.step(inputsByPlayer)`, `Sim.snapshot()/restore()`, the event list, and entity IDs.
   Agent 2 (NET) builds against it.
2. **Fixed timestep:** move the loop to a 60 Hz accumulator (render interpolates between ticks). Replace any
   `Math.random()` inside gameplay with a seeded RNG owned by the sim. Cosmetic randomness in the view is fine.
3. **Split the gameplay classes:**
   - `Dweeb.js` becomes a sim part (body, state machine) and a view part (mesh, eyes, squash).
   - Items get the same sim / view split.
   - Callbacks like `onHit`, `onKO` and `onFlail` become sim events that the view (`Fx`, `Hud`, audio) subscribes to.
   - `Dweeb.js` visuals belong to the Lead, who is changing the character models now. Post the split plan on the board first and move the visual code verbatim.
4. **Bots:** make them pure input producers (`Bot.think(simState) → InputFrame`) so the server can run them.
5. **Snapshots:** `snapshot()` must capture everything needed to resume: Rapier world (`world.takeSnapshot()`), dweebs,
   items, match, timers and RNG state. Add a checksum (hash of rounded positions, velocities, % and stocks) for desync tests.
6. **Headless run:** it must run in Node with no DOM (`node tools/headless-match.mjs` plays a bot match to the end).
   - Note: `rapier3d-compat` is deterministic on the same build and platform.
   - Evaluate `@dimforge/rapier3d-deterministic-compat` for cross-platform determinism, and write the decision in WHY.md.

**Done when:**
- Offline play is identical in feel.
- Headless matches finish.
- Same seed + same inputs gives the same checksum every tick.

## ROLE CARD 2 — NET (server + client netcode). Owns `server/**`, `src/net/**`

1. **Protocol** (`src/net/protocol.js`, shared by client and server):
   - Message types: hello/join, input (tick-stamped, redundantly sends the last 3 inputs), snapshot (delta vs last-acked baseline), event, ping/pong, room state.
   - Quantize positions to 1 cm and rotations to smallest-three.
   - Start with JSON behind an encoder interface, then switch to binary (DataView) once it works. Post the schema on the board.
2. **Server** (`server/index.js`, Node + `ws`):
   - Rooms with 4-letter codes and up to 8 players; bots fill empty slots.
   - Runs `src/sim` at 60 Hz and broadcasts at 30 Hz.
   - Input buffer per player with a jitter allowance.
   - Handles disconnect and reconnect (holds the slot 20 s), host migration isn't needed (server is authority), and rate-limits and validates inputs.
3. **Client** (`src/net/NetClient.js`):
   - Clock sync and RTT estimate.
   - Local prediction of your own dweeb, with reconcile-on-snapshot (rewind and replay inputs; smooth corrections over ~100 ms, never teleport under 1 m).
   - Remote dweebs and items interpolated about 100 ms behind.
   - Authoritative events (KO, stock, round end) drive the Hud and Announcer. Cosmetic hit Fx can play predicted.
4. **Held and thrown items:** the server owns them. The thrower predicts the throw arc locally, using the same `predictThrow` maths.
5. **Tooling:** a latency and loss simulator (`?lag=120&loss=2` query params, and a server flag).
6. Until SIM's contract lands, build against a mock sim that moves boxes around. Don't wait.

**Done when:** two to eight browser tabs across machines can play a match at 120 ms RTT and it feels fair, and bandwidth is within budget.

## ROLE CARD 3 — APP (web-app shell, lobby, UX, deploy). Owns `src/app/**`, `public/**`, `vite.config.js`, app routing in `index.html`

1. **App shell:**
   - Screens are Boot/Loading → Title → Play Offline / Play Online (Create Room / Join by code / Quick play) → Lobby → Match → Results.
   - Hash routing (`#/room/ABCD`) so invite links work, and back-button safe.
   - Keep the existing menu flow working while you migrate.
2. **Lobby UI:**
   - Room code and a copy-invite button, a player list with archetype and colour, ready states, and host settings (stocks, time, items on/off).
   - Show a ping indicator, reconnecting / disconnected toasts, and the "server full" and "room not found" states.
   - Wire it to NET's `NetClient` through a small interface. Mock it until NET merges.
3. **Loading and assets:**
   - A real progress bar (Rapier WASM, fonts, audio unlock), and code-split three/Rapier.
   - The current bundle is over 500 kB. Use dynamic `import()` and aim for first paint under 2 s on 4G.
   - The Lead is designing the loading screen *art*. You own the *mechanics* (progress, errors, retry), so agree the DOM hooks with the Lead on the board.
4. **Settings:** volume sliders (the AudioManager already has buses), controls rebinding, gamepad support, a
   reduced-motion toggle (screen shake / kill-cam off), and a quality preset. Persist them in localStorage.
5. **PWA:** a manifest and icons (the Lead supplies the art), an offline cache for single-player, and handling WebGL context loss and tab-hidden pause.
6. **Deploy:**
   - Static client (Vercel, Netlify or Cloudflare Pages) plus server (Fly.io or Render).
   - Env-configurable server URL.
   - A one-command `npm run deploy` recipe documented in the README. Ask the user before actually deploying anything public.

**Done when:** a friend can open an invite link on a phone or laptop, pick a dweeb, ready up and play. Nothing blocks on the network in offline mode.

## ROLE CARD 4 — QA (tests, CI, perf, tooling). Owns `test/**`, `tools/**`, `.github/**`, lint config, `package.json` scripts/devDeps

1. **Day one:**
   - If the repo isn't under git yet, `git init`, add a `.gitignore` (`node_modules`, `dist`, `.env*`), make an initial commit on `main`, and post on the board.
   - Add `vitest` and ESLint (a light config that doesn't reformat the codebase) with `npm test` / `npm run lint`, plus GitHub Actions CI (build, test, lint).
2. **Tests:**
   - Unit tests for pure maths: knockback / DI / % curve from `Balance.js`, `Announcer.koLine` (a water dunk and a side blast never share a line), `Arena.pickDropItem` (rare caps and cooldowns hold over 10k draws), and `predictThrow` vs actual throw landing.
   - As SIM lands: a determinism test (same seed + inputs → same checksum for 3,600 ticks), and snapshot → restore → continue equals an uninterrupted run.
3. **Bot soak harness:**
   - `tools/soak.mjs` runs N headless 8-bot matches.
   - It asserts no NaN positions, no stuck dweebs (> 10 s unmoving while alive), no items leaking (live count bounded), and that matches end.
   - It reports KO causes and average match length. That's useful balance data for the Lead, but **report it, don't retune**.
4. **Perf:**
   - An in-game perf overlay (`?perf`: fps, frame ms, sim ms, draw calls, JS heap), and an allocation audit of the hot paths (DevTools allocation sampling). File findings to owners on the board.
   - A CI perf smoke that fails if headless sim step p95 exceeds 4 ms.
5. **Net testing:** with NET, a headless multi-client test (spawns the server plus N fake clients with lag and loss) that checks the clients converge on the server state.
6. **Review:** review every merge to `main` for broken offline play, perf regressions and contract drift. You are the gate.

**Done when:** CI is green and meaningful, the soak runs clean for 30 minutes, and the perf and determinism budgets are enforced automatically.

---------------------------------------------------------------------------------------------------
## LEAD (this session): for reference
Owns `Balance.js` numbers, `src/render/**`, `ObjectModels.js`, `Stickers.js`, Dweeb visuals, `src/audio/**`,
`Announcer.js`, Hud look, `index.html` styling, and the branding/loading art.

The Lead:
- Answers Requests on the board.
- Integrates and resolves merge conflicts on shared files (`main.js`, `Dweeb.js`).
- Keeps the game feeling right as it gets split into sim and view.
