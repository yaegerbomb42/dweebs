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
