# Dweebs overnight log — Dweeb Warfare deepening

Focus: make **Dweeb Warfare** one solid, fully working game. Other games untouched (build only).
Every batch: `npx vitest run` + `npm run build` on the Mac, then a local commit (no push, no deploy).

## 2026-10-26 00:47 CT — Batch 0: baseline snapshot
- The whole Dweeb Mall (hub, warfare/escape/mimic/adventure, main.js wiring) was uncommitted since Oct 25.
  Committed it as-is under apps/dweebs only (gamewithfam deletions and root WHY.md left unstaged) so the
  warfare work below has a clean base.
- Tests: 97/97 pass. Build: OK.

## 2026-10-26 00:48 CT — Batch 1: deterministic Warfare sim + tests
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

## 2026-10-26 01:00 CT — Batch 2: Warfare split into modules + full game loop
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

## 2026-10-26 01:35 CT — Batch 3: enemy AI behaviours + difficulty tuning
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

## 2026-10-26 01:55 CT — Batch 4: juice + WebAudio SFX + mute
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
