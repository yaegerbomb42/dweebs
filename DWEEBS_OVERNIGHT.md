# Dweebs overnight log — Dweeb Warfare deepening

> Note (01:25 CT): batch headings 0–5 were corrected to the real git commit times (CDT); earlier drafts carried guessed times.

Focus: make **Dweeb Warfare** one solid, fully working game. Other games untouched (build only).
Every batch: `npx vitest run` + `npm run build` on the Mac, then a local commit (no push, no deploy).

## 2026-10-26 00:38 CT — Batch 0: baseline snapshot
- The whole Dweeb Mall (hub, warfare/escape/mimic/adventure, main.js wiring) was uncommitted since Oct 25.
  Committed it as-is under apps/dweebs only (gamewithfam deletions and root WHY.md left unstaged) so the
  warfare work below has a clean base.
- Tests: 97/97 pass. Build: OK.

## 2026-10-26 00:46 CT — Batch 1: deterministic Warfare sim + tests
What changed (all pure, under `src/sim/`, so the existing purity gate covers them: no three, no DOM, no Math.random, no trig):
- `warfareUnits.js` — roster (shield, rocket, stealer, kami + enemy-only sneak, brute, boss "Brass Bully"),
  stats, costs, counter multipliers, `COUNTER_OF` hints.
- `warfareDamage.js` — damage = base × wave dmgMul × splash falloff × counter, shield cover halves splash, knockback by mass.
- `warfareWaves.js` — budget-driven wave compositions, unlock schedule, hp/dmg scaling, boss every 5, FINAL_WAVE = 10, rewards.
- `warfareAI.js` — target priority (rockets love clumps, stealers/sneaks hunt the backline, kamis go for shield walls,
  sticky targets, finish the wounded), flanking waypoints, retreat-and-heal thresholds, AI commander for versus.
- `warfareBattle.js` — 30 Hz fixed-tick battle: forts, rally points, recruiting, prep/battle/won/lost phases, rockets as
  arcing shells with lead, stealer kidnap → convert at your fort, stealer "fuse flip" on kamis, kami detonation,
  slams, separation by mass, dowel barricades, events stream for the view, `battleHash` for determinism/online.
- `warfareDuel.js` + `tools/warfare-duels.mjs` — equal-cost duel matrix used for tuning.
- Balance result (equal-cost duels, 5–6 seeds): shield ▶ rocket, shield ▶ stealer, rocket ▶ stealer, rocket ▶ kami,
  stealer ▶ kami, kami ▶ shield. Every unit beats something and loses to something.
- Difficulty: idle commander loses by wave 2–3; a naive scripted mix reaches the wave-5 boss and sometimes wave 10.

Tested: new `test/warfare.test.js` (28 tests: units, real-sim duels/counters, damage, waves, AI, battle loop, determinism, versus).
Full suite 125/125 pass. Build OK.

Next: split the view (units/HUD/fx/audio modules) on top of this sim, full game loop UI (start screen + hints, wave banners,
win/lose stats + restart), then juice + SFX.

## 2026-10-26 00:58 CT — Batch 2: Warfare split into modules + full game loop
What changed:
- `src/warfare/DweebWarfare.js` rewritten as a thin controller over the pure sim: fixed 30 Hz stepping with
  interpolation, local command queue, RTS camera (WASD/arrows pan, wheel zoom, shake), input (click board = rally,
  1–4 recruit, Space start wave, M mute, Esc pause).
- New view modules: `WarfareModels.js` (faceted toy units: dodecahedron plastic bodies, googly eyes, plastic shield
  discs, brass rocket tubes, bandanas, TNT bombs with fuse sparks, dowel clubs, brass gear boss crown),
  `WarfareBoard.js` (bevelled plastic play-mat, dowel fence, dowel-log barricades with brass bands, brass-gear forts),
  `WarfareView.js` (sync/interpolate units + arcing shells, team swap on conversion, retreat flags, rally flags),
  `WarfareFx.js` (explosions, shockwaves, smoke puffs, tumbling death pop into confetti, floating damage numbers, shake),
  `WarfareHud.js` (start screen with tutorial hints, top bar: wave/boss, fort HP, coins, army counts; recruit cards with
  cost/hotkey/counter hints; wave banners; contextual enemy hints; pause; win/lose screen with stats; best wave saved).
- Game loop: title (AI-vs-AI attract battle behind the start screen) → Defend the Fort (10 waves, boss on 5 and 10) or
  Versus AI → win/lose stats → Play again / Menu / Back to the Mall.
- `main.js`: warfare now takes over the frame (brawler stack idles, stadium hidden, no stray dweebs), old rally click
  code and old per-frame hook removed, exit returns to the Mall. Warfare added to the mode segment in `index.html`.
- Bug fix in the shared launcher (`legacy.js` + `startMatch`): the app shell re-synced the menu segs from its saved
  settings when the match route opened, so Mall cards launched the saved mode (usually the brawler) instead of their
  own game. A one-shot `window.__dweebsLaunch` override now wins. This also makes the Escape/Mimic cards launch their
  own modes (their code is unchanged).

Tested: 125/125 vitest, build OK, eslint clean on touched files. Headless Chrome run of the built app on the box:
Mall → Start Warfare → title → Defend the Fort → recruit/rally/start wave → wave cleared → boss wave 5 renders; no page errors
from Warfare. (Seen a pre-existing classic-brawler console error `fx.step is not a function` from Dweeb footsteps; not
touched, outside Warfare.)

Next: boss HP bar, AI polish/tells (batch 3), WebAudio SFX + mute (batch 4).

## 2026-10-26 01:04 CT — Batch 3: enemy AI behaviours + difficulty tuning
What changed (sim, deterministic):
- Boss "Brass Bully" enrages once below 50% HP: faster, quicker and wider slams, calls in 2 kamis.
- Brutes charge targets 4–10 m away (2.4× dash, charged slams hit 1.5×).
- Sneaks backstab (1.6×) units that are busy fighting someone else; they still flank wide.
- Rockets hold formation 3 m behind their own side's front shield instead of walking out in front.
- Fort alarm: defenders drop everything for enemies within 16 m of their fort, even outside normal aggro.
- Fixed two real bugs found by headless runs: a unit converted mid-tick could target/grab itself (froze waves), and
  stealers could get stuck just outside the pen in a crowd (pen reach is now fort radius + 4).
- Tuning: defense fort 2000 HP, forts take 0.6× unit damage, bounty 60% of cost, wave reward 80 + 20n,
  boss 1200 base HP, kami ×1.8 vs boss, boss-wave escorts 45% budget (55% on the final wave).
  Headless results: idle commander loses on wave 2–3; a balanced "keep buying a mix" bot reaches wave 7–10 and wins
  some seeds; a counter-only bot that rushes waves dies around the wave-5 boss. Winnable with real play, not free.
- View/HUD tells: boss HP bar (pulses when enraged), ENRAGED banner + shockwave, CHARGE!/BACKSTAB! words,
  one-time hint toasts for charges and backstabs.

Tested: 133/133 vitest (8 new behaviour tests: enrage, charge, backstab, formation, flanking path, retreat-heal-rejoin,
fort alarm, no self-targeting over a full run). Duel matrix unchanged. Build OK. Headless Chrome: boss wave with bar and
enrage banner, defeat screen with stats, Back to the Mall returns to `#/`, Escape card now launches its own mode.

Next: WebAudio SFX + mute toggle (batch 4), sw.js offline (batch 5), online (batch 6).

## 2026-10-26 01:06 CT — Batch 4: juice + WebAudio SFX + mute
What changed:
- `src/warfare/WarfareAudio.js`: fully procedural WebAudio (no sample files, so it works offline on first load):
  hit ticks, death pops, explosion booms with sub thump, rocket thoomps, ground slams, grab/convert chimes, recruit plop,
  fort thunk, wave horn, boss drone, wave-clear jingle, enrage roar, win fanfare, lose trombone, UI click/deny.
  Stereo-panned by distance from the camera, rate-limited per 250 ms so 100-unit brawls don't clip, compressor on master.
- Mute: 🔊 button in the HUD corner + M key, persisted in localStorage (`dweebs-warfare-muted`); also respects the
  game's global Sound: Off setting. Attract battle behind the title is silent.
- Juice additions: rocket muzzle flash, camera "kick" (quick zoom punch) on big blasts, on top of batch-2 hit flash
  (white body flash + squash), knockback lean, screen shake, floating damage numbers (gold = counter hit, grey = resisted),
  tumbling death ragdoll that pops into team-coloured confetti, shockwaves, smoke puffs, spawn squash.

Tested: 135/135 vitest (new `test/warfare-audio.test.js`: safe without WebAudio, sim events make sound, spam is capped,
mute silences and persists). Build OK. Headless Chrome versus run: AudioContext running, M toggles mute + storage, no errors.

Next: offline service worker (batch 5), online co-op/versus (batch 6).

## 2026-10-26 01:08 CT — Batch 5: offline (service worker)
What changed:
- `public/sw.js`: cache bumped `dweebs-mall-v1` → `dweebs-mall-v2-<buildId>`; install now precaches the whole build
  (`PRECACHE`, injected at build time) instead of only caching assets when they happen to be re-fetched under the
  worker — before, a first visit was not offline-ready. Asset matching uses `includes('/assets/')` so it also works
  under the GitHub Pages sub-path. Old `dweebs-*` caches are still dropped on activate.
- `vite.config.js` + `tools/precache.mjs`: build plugin writes the hashed asset list (JS bundle with Warfare + Rapier,
  CSS, woff2 fonts; no maps/woff/html) and a per-build id into `dist/sw.js`. Fails loudly if placeholders disappear.
- Warfare needs nothing else: audio is procedural, models are code, fonts are bundled.

Tested: 140/140 vitest (new `test/warfare-offline.test.js`: placeholders + version, precache filter, install caches every
asset under the per-build cache, injection guard, solo Warfare code has no fetch/http/WebSocket). Build OK; dist/sw.js
gets 13 precache entries. Real check in headless Chrome: first visit → 17 entries cached and SW controlling → server shut
down + browser offline → reload → Mall → Dweeb Warfare → Defend the Fort played with zero network hits.

Next: online co-op / versus over the dweebs-server WebSocket (batch 6).

## 2026-10-26 01:25 CT — Batch 6: online co-op + versus over the dweebs-server

**What changed**
- `server/warfare.js` (new): `WarfareLobby` — quick-match queue per mode (co-op / versus) or join a friend by 4-letter code; on match both players get the same seed and a slot/team (versus: blue vs red; co-op: both blue). Lockstep relay: every 100 ms the server broadcasts a numbered turn with every command received since the last one; both clients apply turn *n* at sim tick 3n, so the deterministic sim stays bit-identical. `sanitizeCmd` whitelists rally/recruit/startWave and **forces the sender's team** (a client can't command the other army). Clients report `battleHash` every 30 turns; a mismatch sends `desync` to both. `over` (battle ended normally) vs `leave`/socket close (forfeit): versus ends with `peerLeft` → forfeit win, co-op keeps relaying so the survivor holds solo. Room-code generation can't spin on a bad RNG.
- `server/index.js`: same process, port 8787 and rate limiter as the brawler. Frames starting with `{` that parse to `{wf:…}` route to the lobby (brawler opcodes are binary, all < 0x7b); a turn-tick interval; `drop` on close; `/status` reports `warfare: {waiting, matches, players}`.
- `src/warfare/WarfareNet.js` (new): browser client using the brawler's server URL resolution (`?server=` / saved setting / same-origin `/ws` / `localhost:8787`), ignores binary brawler frames, buffers turns.
- `DweebWarfare.js`: ONLINE CO-OP / ONLINE VERSUS buttons now live; waiting panel with invite code, JOIN FRIEND code box and CANCEL; lockstep stepping (stalls when the next turn hasn't arrived, catches up to 12 ticks/frame when behind); local commands go to the server instead of straight into the sim; net chip shows partner / "waiting for partner…"; desync toast; Esc opens the menu without pausing a shared battle; red slot gets the red camera side and correct end-screen text; PLAY AGAIN re-queues online; goofy per-browser commander names (e.g. "Major Sprocket"). If the server can't be reached the panel says so and the solo modes keep working offline.
- `WarfareHud.js`: online screen + `onlineStatus()`.

**Tested**
- `test/warfare-online.test.js` (5 new): sanitize/forced team, lobby pairing by mode + by code, finished player ≠ peerLeft, codes never spin; **real server on a random port**: versus matchmaking, same seed, blue/red, a lying client's commands rewritten to its own team, turns identical on both sockets, two sims fed the relayed turns end with equal `battleHash`, desync detection, peerLeft + match teardown; co-op by code (both blue), survives a partner leaving.
- Two headless Chrome pages against a real server on the box: versus quick match (A blue, B red; both recruited; unit lists/positions/HP identical between pages a tick apart), B quits → A gets forfeit victory. Co-op by code: both blue, shared coins, B leaves → A continues "solo".
- `npx vitest run` 145/145 · `npm run build` OK.

**Next**: polish pass on Warfare (balance/readability), and the hosted VPS server needs a redeploy before online Warfare works there (not done — no deploys tonight).
