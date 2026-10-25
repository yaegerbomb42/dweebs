# Why File — DWEEBS: emotionally unstable. Collectibly adorable.

## 1. Project Overview & Vision
- **Title**: DWEEBS
- **Tagline**: emotionally unstable. Collectibly adorable. (brand refs: `images/Screenshot 2026-09-28 at 8.5x.xx PM.png`)
- **Core Philosophy**: LOW GRAPHICS + HIGH PHYSICS + EMERGENT COMBAT
- **Inspirations**: Gang Beasts, .io games, Minecraft emergent sandbox, physics playgrounds.
- **Current Target**: Localhost physics multiplayer-style game with 1 human player and 7 AI bots in a chaotic stadium arena. Future targets include 2–40 player online matches.

## 2. Architecture & Modules
- **Physics**: Rapier3D (`@dimforge/rapier3d-compat`, WASM). Real rigid bodies, kinematic bodies for moving obstacles/pendulums, colliders, contact force events.
- **Renderer**: Three.js (`three`), procedural low-poly geometry, soft directional sunlight, colorful stylized materials, shadows.
- **Dweeb Characters**:
  - Based directly on reference images (`Cubic_character_rolling_physics_20260928150622.jpg`, `Spiky_blob_bouncing_off_walls_20260928150701.jpg`).
  - Chamfered yellow cube with expressive asymmetric eyes, open happy mouth, and noodle limbs.
  - Fiery red spiky blob with 30+ radiating tentacles and startled googly eyes.
  - Interactive pupils with velocity-driven look physics.
- **Dweeb Stadium Arena**:
  - Based directly on `Dweebs_battling_in_stadium_arena_20260928150532.jpg`.
  - Colosseum arena bowl with grandstands and tiered spectator Dweebs.
  - Giant "DWEEB STADIUM" banner archway and "BATTLE AREA" billboards.
  - Ball pits with 40+ dynamic rolling physics balls.
  - Swinging overhead wrecking pendulums and motorized spinning turntable cross hazards.
  - Obstacle course ramps, bridge catwalks, and slides.
- **Physics Toys & Weapons**:
  - Giant Wobbly Hammer (`Giant_wobbly_hammer_knocking_dweebs_20260928150634.jpg`) with bent striped handle and high damage.
  - Spiky Bouncy Blob (`Spiky_blob_bouncing_off_walls_20260928150701.jpg`).
  - 28+ interactable objects from the sandbox asset library (`Physics_sandbox_objects_asset_li...jpg`).
- **Combat & Audio**:
  - Real contact impulses trigger stumbling, ragdolling, launching, and object shattering.
  - Explosive barrels with shockwave impulses.
  - Procedural sound synthesis using Web Audio API (no external asset dependencies).

## 3. History of Changes & Lessons Learned
- **Initial Setup**: Configured Vite + Rapier3D + Three.js ES Modules.
- **Timer Fix**: `three/addons/misc/Timer.js` was unavailable in the current Three package; replaced with a lightweight, high-performance `performance.now()` game timer.
- **Visuals Upgrade**: Overhauled character models and arena to mirror reference images provided in `./images`.
- **Rapier Kinematic Rotation Fix**: Fixed rotation assignment on spinning obstacle hazards.
- **Knockout Brawl Overhaul (2026-09-28)**: Reworked into a Smash-style brawler — damage % raises knockback (`launch = base + growth × %/100`), KO by lagoon dunk or blast zones, stocks, best-of-3 rounds, power-ups (★ mega, ⚡ zoom, ● bubble), sudden-death crumbling outer ring. New modules: `game/Match.js` (rules), `game/Fx.js` (hit-stop, shake, popups), `ui/Hud.js`, `render/{Toon,Sky,Particles}.js`. Bright toy look: toon shading + OutlineEffect, Lilita One / Nunito fonts.
- **Physics Layer Rebuild**: `PhysicsWorld` now sub-steps each frame (≤1/60 s, max 4) and keeps a collider registry (handle → kind/material/ref/mass). Impacts are detected from per-body Δv across a sub-step (contact *forces* scale with mass and resting contact, so they make poor sound/break triggers). Items use game-mass via `setMass` (Dweeb = 3) — the old density formula made mass depend on box width. All items have CCD and rounded collider edges so they tumble and roll well.
- **Throw feel**: throw speed × `clamp(1.3 − 0.15·mass, 0.55, 1.3)`, spin ∝ 1/√mass, punch/explosion impulses ∝ √mass. Light things rocket, heavy things lob and hit harder. Breakables take `speed² × mass × 12` damage per impact (only when thrown or > 7 m/s, so spawn drops don't shatter bottles).
- **Audio Engine Rebuild**: master compressor + generated stadium convolution reverb; modal impact synth driven by `Materials.sound` (partials, contact noise, mass thump, rubber boing, fruit splat); shared noise buffers instead of per-sound allocation; 50 ms event budget + per-body cooldown to avoid mush; loops for crowd (follows `arena.cheer`), water, rolling (follows `physics.rollSpeed`) and charge hum; music ducking on KOs/explosions.
- **Lessons**: three r186 removed `PCFSoftShadowMap` and deprecates `Clock` (use `Timer`). Dweeb characters use friction 0 while upright (velocity-driven movement; no wall sticking) and 0.7 while ragdolled. Launch drag (`exp(-0.9·dt)` in hitstun) keeps small hits on-stage. Bots penalise targets others already chase to avoid dogpiling the player.
- **Googly Toybox art pass (2026-09-28)**: brief in `STYLE_TASK.md`. All 30 props now have dedicated low-poly toy models (`world/ObjectModels.js`) with canvas-drawn stickers, tape and labels (`render/Stickers.js`, so no image files are needed). Faceted look = `FLAT_SHADED` define on toon materials (derivative normals), while merged geometry is `mergeVertices` + smooth normals. Real flat-shaded (split) normals crack the OutlineEffect shell, so shading and outline normals are deliberately decoupled. Models are built once per key, parts merged per material, then cloned per spawn with shared geometry/material (~4 draw calls per prop incl. outline + shadow), so `destroy()` must never dispose them. Only the TV screen material is per-instance.
- **Feel layer**: per-object squash spring along the impact axis (volume-preserving, scaled by a material softness table), pop spring on grab/release, googly pupils simulated as bounded masses under (gravity − body acceleration), TV screen moods, and fuse flicker. `render/Juice.js` pools throw ribbons (thrower's colour), comic impact stars and ground decals (splat/scorch/crack, raycast to the `stage` collider, fade out when the ground crumbles). Juice sprites and decals use `toneMapped:false` so their colours stay saturated. Debris shape/material comes from the prop material (splinters, shards, rind, flaps, bolts). Dev tool: `http://localhost:3000/#lineup` shows all props on turntables. Stress test (25 extra props): worst frame 14.3 ms (baseline 18.8), +97 draw calls.
- **Toybox Island map + 12 new props (2026-09-28)**: the core is a canvas play-mat (`Stickers.playmatTexture`); outer tiles get candy-stripe lips and outward chevrons. Four pinball **bumpers** (r 8.2) shove dweebs outward (10 + ½·speed, capped at +6) and give thrown objects a bank-shot boost that extends `thrownTime` so ricochets still hit. Two **trampolines** launch you to about a 7 m apex and refund one air jump (holding jump or falling fast adds ×1.12). Both are fixed colliders plus sprung visual parts. Detection is a distance check in `CombatSystem._updateHazards` / `Arena._bumpObject`, not contact events. Lagoon scenery: giant floating toys and D-W-E-E-B-S letter blocks. New props: rubber chicken, giant die, piñata, boombox, fish bowl, teddy, pool ring, anvil, gumball machine, cake, piggy bank, and a **toy rocket**, which flies dead straight at 21 m/s (velocity overridden every frame while it has fuel) and explodes on impact. Defs may set `breakWord`, `breakColors` (confetti and debris palette) and `splat` (decal colour). Impacts between a thrown item and its own thrower are ignored, so rockets can't detonate in your hands. Bots steer tangentially around bumpers. Live match: about 278 draw calls, 8.3 ms median frame.

## 4. QA — Tooling, Tests and CI (2026-09-29)

Day-one foundations. The rule I hold myself to: **tests describe the shape of the design, never
the numbers themselves.** The Lead tunes `Balance.js` constantly, so a test that hard-codes
`launchAt(120%) === 17.4` is a bug waiting to happen. Instead each test pins the *relationship*
— the curve is linear in percent, charging never reduces knockback, DI can never reverse a smash —
so retuning stays free but a genuine regression fails the build.

- **Why vitest and not a browser runner:** the suites are pure maths and headless logic, so they
  run in Node with no DOM and no WebGL in well under a second. That keeps CI cheap and means a
  failing test is always a logic bug, never a rendering-environment flake. `src/sim/` will drop
  straight into this same suite when it lands.
- **Why the ESLint config has no stylistic rules on purpose:** there are no `indent`/`quotes`/
  `semi` rules at all, so `npm run lint:fix` can *never* reformat the codebase. Lint reports real
  defects (`no-undef`, `no-dupe-keys`, `use-isnan`, …) and leaves the style to the Lead. It is
  currently 0 errors, 3 pre-existing unused-variable warnings in files I don't own.
- **Why the drop-table tests use a stub arena:** `pickDropItem` only reads `objects` and
  `lastRareDrop`, so `Object.create(Arena.prototype)` exercises the real weighted picker, the live
  cap and the per-key cooldown without a renderer. Two things this surfaced that are worth
  remembering: (a) rare keys are gated by **cooldown as well as cap**, so testing a cap in
  isolation means the clock has to advance past the cooldown or you are measuring the wrong
  filter; (b) because a handout stamps `lastRareDrop`, "assert this key always appears" is a
  flaky test — the suite asserts the *natural table rate* instead (a rare drops ~1% of the time,
  never 0%, never rampant).
- **Why `predictThrow` is tested against real physics and not a re-implementation:** the point of
  the aim guide is that it never lies, so the test flies the *same* launch velocity through a real
  Rapier world and compares where the item actually lands. Three things that cost real debugging
  time, recorded so nobody repeats them: each case needs a **fresh Rapier world** (leftover item
  bodies from a previous case bounce the next throw); **Rapier only refreshes its scene queries on
  `step`**, so a raycast before the first step silently returns no hit; and landing must be
  detected by the **vertical velocity reversing**, not by a guessed rest height — the items are
  round-cuboids, so a guessed height never registers contact and you end up measuring where the
  crate *rolled to* (4 m of phantom "drift" that was really a broken test).
- **Known divergence, reported not hidden:** the toy rocket is predicted ballistically in 1/45 s
  steps, but the live game re-pins its velocity to `ROCKET_SPEED` every 1/60 s frame in
  `CombatSystem._thrust`. The two arcs diverge by ~1 m over a 45 m flight, so the rocket case
  carries an explicit, commented 2.5 m tolerance while everything else is held to 1 m. Filed to
  the Lead and SIM on the board; if the aim guide is going to be trustworthy for rockets, one of
  the two models has to change.
- **Other finding:** `winBanners()` given an eliminated winner and an empty `roundWins` map emits a
  bogus `CLEAN SWEEP 0–0` (every-element-of-empty is vacuously true). The test asserts the correct
  behaviour against a realistic match state and the bug is on the board for the Lead, who owns
  `Announcer.js`.
- **CI:** build → test → lint on every push to `main`/`agent/**` and every PR. QA is the merge
  gate, so a red build, a failing test or a lint error all block the merge. The pipeline now runs
  the suites that exist rather than stubs: vitest, the app-shell unit smoke, the real-sim perf gate
  (p95 step < 4 ms), a 1-match real-sim soak, the real-sim net smoke, and `tools/clientSim.mjs`.
  The two-browser Chrome test is included but **guarded on Chrome actually being on the runner**,
  and a skip emits `::warning::` in the log. That is deliberate: a suite can either run or shout
  about not running, but it must never quietly pass. The frozen-lobby bug below survived a green
  pipeline precisely because "the test did not exercise the thing" looked exactly like success.

### Guarding the offline/PWA promise, and two harness lessons (2026-09-29)

- **"Declared" is not "shipped".** `src/app/runtime.js` registered `${BASE_URL}sw.js` in production
  and `index.html` linked `/manifest.webmanifest`, and neither file existed in `public/`. The
  registration 404'd, `registerServiceWorker` swallowed it as a `console.warn`, and the
  single-player offline cache simply did not exist — while the code read as though it did. What
  caught it was an assertion that looks unrelated: `smoke-shell.mjs` fails on *any* console error,
  so the browser's "bad HTTP response code (404) … fetching the script" failed the build. The
  lesson is that a handful of "no console errors, no external requests" assertions is worth more
  than it looks, because it catches the class of bug where a feature is 95% wired.
- **So it is guarded by `test/pwa-assets.test.js`, not by the Chrome harness.** The Chrome harness
  needs a preview server, a browser and ~40 s; that is far too expensive to be the only thing
  standing between the repo and a silent 404. The test reads the declarations out of the source
  (`runtime.js` register path, `index.html` manifest link) and asserts the matching file exists,
  then runs `public/sw.js` for real inside `node:vm` with fake `self`/`caches`/`fetch` and fires
  install/activate/fetch by hand. The behaviours it pins are the ones that would be invisible
  until a user hit them offline: network-first navigation that falls back to the cached shell,
  cache-first hashed assets, non-GET/cross-origin/`sw.js` never intercepted (**the netcode server
  must never sit behind a cache**), and a 500 never cached as the shell.
- **A test that cannot fail is decoration, so every guard here was mutation-checked**: delete
  `public/sw.js` → the existence test fails; remove the SW's `res.ok` stash guard → "a 500 must not
  become the offline shell" fails. Restore, and the suite is green again. Mutation-checking a
  guard right after writing it is the cheapest way to know it is not a tautology.
- **Two things the two-browser harness taught that no amount of Node testing would have.**
  1. *A second Chrome tab has to be requested, not assumed.* Launching Chrome with one `about:blank`
     and then enumerating `/json/list` yields exactly one page target, so the second browser
     silently could not be created (`no chrome tab available`). Tabs must be created over the
     browser-level CDP socket with `Target.createTarget`, then attached. Chrome does not open N
     tabs from N URL arguments.
  2. *Snapshots are deltas, so a "compare the two clients" test needs an accumulated baseline.*
     Comparing each browser's latest frame compared **one entity** and would have passed against a
     broken server. Recording the merged baseline per tick (reset on a full snapshot, exactly as
     `NetClient` does) turned the same comparison into 8 real entities. A comparison that only
     inspects whatever happens to be in the last packet is a test of the packet, not of the world.
- **Comparing the same tick is the whole trick.** Two clients are never at the same wall-clock
  moment; the server's authoritative bytes for tick N are identical for everyone, so the assertion
  is "same tick, same quantized values, 0 cm apart" — which is meaningful — rather than "the latest
  frames look similar", which is not.

## SIM — the deterministic simulation (`src/sim/**`)

### What landed, and what it is for
`src/sim/` is a pure simulation: fixed 60 Hz, no three.js, no DOM, no audio, no `Math.random()`
anywhere reachable from `step()`. It exists so the same code runs in a browser and in a Node
server, and so a server does not need a WebGL context to know who got KO'd. The published
boundary is `src/sim/contracts.js` (on the board under Contracts); everything below it is
implementation.

- **Why a contract file and not just a class:** NET needed something to code against on day one,
  and a class invites coupling. A constants-and-JSDoc module that imports nothing can be read by
  anyone, in either process, without pulling in WASM. It also forces the awkward decisions early
  and in writing: inputs are HELD state not press edges, a missing input frame is
  `NEUTRAL_INPUT` rather than "repeat the last one", and `advance(dt)` is view-only while a server
  must call `step()`. Those three are the ones that would have been got wrong otherwise.
- **Fixed timestep with an accumulator, and two clamps** (`accumulator.js`). Wall-clock time goes
  in, whole 1/60 s ticks come out. `TICK_DT` is `1/60`, not `0.016` — the latter drifts, and drift
  is a desync that takes 40 minutes to show up. Frames longer than `MAX_FRAME_TIME` (250 ms: a
  backgrounded tab, a GC pause) are *discarded* rather than caught up, because 25 catch-up ticks
  teleports everyone across the stage; catch-up is otherwise capped at `MAX_STEPS_PER_FRAME` (5), so
  a machine briefly too slow runs slightly slow instead of exploding. Both counters (`dropped`,
  `discarded`) are kept, because a sim that silently discards time is a sim whose bugs are
  unfindable.
- **Seeded RNG in named streams** (`rng.js`). mulberry32: the whole state is two 32-bit ints, and
  the output comes only from `Math.imul`/xor/shift/add, all of which ECMAScript specifies exactly.
  Streams are named (`drops`, `combat`, `bot0`, `powerup`) and seeded by hashing the name rather
  than drawing from one master sequence. That is not tidiness: if combat jitter and the drop table
  shared a stream, one extra draw in the drop table would shift every combat roll in the game and
  the checksum would diverge for a reason no debugger could explain. `weighted()` likewise draws a
  24-bit integer rather than comparing floats, for the same reason.
- **The checksum is coarse on purpose** (`checksum.js`). FNV-1a over positions rounded to 1 cm,
  velocities to 0.01 m/s, percent to 0.1, plus stocks, style, phase, timers and the RNG state. A
  checksum that reacted to float noise would fire constantly and mean nothing; this one fires on a
  real divergence. Each field is hashed with its own tag, so a missing field changes the hash and
  so does a field in the wrong slot — which a `join()` would not catch. The RNG state is in there
  on purpose: a sim that has drifted by a single draw differs here long before its bodies visibly
  diverge, which makes it the cheapest early warning available.
- **Events instead of callbacks** (`events.js`). `Dweeb.onHit` / `onKO` / `onFlail` and the rest
  became `SimEvent` records in a queue. This is the change that makes a server possible at all:
  the live gameplay objects hold references to `Fx`, `Hud`, `AudioManager` and a
  `CameraController`, so the loop only runs where a DOM and a WebGL context exist. The payoff is
  also a robustness property — because the sim never reads events back, the view can be slow, late
  or entirely absent without changing a single tick's outcome. A client that drops a packet loses
  a sound, not a stock.

### `rapier3d-deterministic-compat`: evaluated, NOT adopted
**Decision: stay on `@dimforge/rapier3d-compat` (0.21.0). No switch, and no extra dependency.**

Both packages are at 0.21.0, and the determinism guarantee lives in the *engine*, not in the
packaging. Rapier's own docs state that "the WASM/Typescript/JavaScript version of Rapier is fully
cross-platform deterministic" — same version, same initial conditions, same construction order,
same number of steps gives identical results, including a byte-identical `world.takeSnapshot()`. So
there is nothing extra to buy. What actually differs is packaging: `-compat` inlines the WASM as
base64 so it loads with no bundler and no `.wasm` file on disk, which is exactly what a Node server
wants and what the browser bundle already does. I verified the guarantee empirically rather than
trusting the docs: two identical 30-step worlds produce MD5-identical `takeSnapshot()` bytes
(`ea7911bc36c27155a6ad4912d1847ef9`).

**The real determinism risk is on our side of the boundary, and it is not the package.** The same
Rapier page says it directly: "transcendental functions like Math.sin, Math.cos are not
cross-platform deterministic and may give different results on different platforms." Our gameplay
code uses `Math.sin`/`Math.cos` *constantly* — bot facing vectors, cone tests, throw arcs, spinner
angles. So in `src/sim/`: the RNG and the checksum never use transcendentals; `Rng.floorDir()`
samples a disc without trig (concentric mapping plus `Math.sqrt`, which IEEE specifies exactly);
where a heading is genuinely needed it is derived with `atan2` rather than from `sin`/`cos`; and
`yaw` pairs come from the same `atan2` result on both ends, so client and server agree. Anything
that truly needs a transcendental belongs behind a fixed-size lookup table agreed in the contract —
noted for M2, not needed yet.

### Three real bugs this work surfaced, all worth keeping in mind
- **`World.restoreSnapshot` does not preserve body identity the way you would hope, and iterating
  the body set by index silently lies.** `RigidBodySet.get()` takes a rigid-body *handle*, not an
  index, and in the 0.21 JS bindings a handle is a `Number` — so `bodies.get(0)`, `get(1)`, `get(2)`
  and `get(3)` all return the same body, or a zeroed one. Our first `rebuildIndex` did exactly that,
  and every restore came back with an empty world and a perfectly "successful" checksum. The fix is
  `world.bodies.forEach(...)`, which visits every body and, helpfully, returns them in creation
  order with fixed bodies first — which is the order the sim allocates entity ids in, and is what
  makes id re-linking possible at all. That is a contract with Rapier rather than with ourselves, so
  it lives in an explicit documented method instead of a loop.
- **Restoring the RNG streams is not idempotent unless the insertion order is cleared first.**
  `RngStreams.stream()` appends to an `order` array, and `restore()` was seeding that array from
  the snapshot before rebuilding — so every restore appended a second copy of every stream name.
  Symptom: a sim that restored perfectly and then diverged a few hundred ticks later, with the
  checksum identical at the restore point. A restore that is not idempotent is a restore that is
  wrong.
- **Anything holding a reference to an `Rng` object must be re-pointed after a restore**, because
  `RngStreams.restore` constructs *new* `Rng` objects. The bots each hold one directly. Missing
  this is the worst class of bug here: the bot silently keeps drawing from the pre-snapshot
  generator, so its decisions diverge from the rest of the match while the checksum looks fine for
  a long time. `Sim.restore()` now re-points the bot, arena and combat streams explicitly, with a
  comment saying why.

### Headless, measured
`node tools/headless-match.mjs` plays a full match in bare Node — no DOM, no WebGL. Flags: `--bots N`,
`--seed N`, `--matches N`, `--ticks N`, `--verify` (run twice, compare the checksum at **every**
tick, report the first tick that differs), `--snapshot-at N` (snapshot, restore into a second sim,
confirm resuming equals never having stopped), `--perf`.
- 4 bots: finishes in ~6,700 ticks, checksum `1b6c46dc`, step p50 0.031 ms / p95 0.065 ms against
  a 4 ms budget.
- 8 bots: matches finish in 9,700–14,100 ticks, p95 still well inside budget.
- `--verify`: IDENTICAL across 6,736 ticks. `--snapshot-at 1200`: restore exact, and the resumed run
  is bit-identical to the uninterrupted one.

### What still blocks a full headless match — the honest list
1. **The view is not wired to the sim yet.** `main.js` still runs the old loop over the old
   `Dweeb` / `CombatSystem` / `Arena`, so offline play is untouched and correct — which is the
   point — but nothing yet *renders* `SimState` or subscribes to `SimEvent`. The Lead owns
   `src/player/Dweeb.js` and is mid character-pass, so the visual split is requested on the board
   rather than done unilaterally; the rule is verbatim move, no restyle.
2. **Items, hazards, power-ups and ledge-clinging are simplified** relative to the live `Arena` /
   `InteractiveObject`. The drop table, rare caps and cooldowns are exact restatements (QA asked for
   that on the board); the mesh shapes, the crumbling ring tiles and the wrecking pendulums are not.
3. **KO causes skew heavily to `splash`** in headless runs — bots fall off the edge rather than being
   blasted out of it. That is a *balance* observation to report to the Lead, not something to
   retune here.
4. **No rollback/replay yet**, so a client cannot rewind for prediction. `snapshot()` is the
   prerequisite and it works.
5. **`test/**` is QA's.** The determinism suite is requested on the board; until QA writes it, the
   equivalent checks live in `tools/headless-match.mjs --verify / --snapshot-at`. I have not edited
   anything under `test/`.


- **Combat skill pass: trickshots + aim (2026-09-28)**:
  - **Aim indicator** (`render/AimGuide.js`): an instanced, inked dotted arc from `CombatSystem.predictThrow` (the same launch maths as the real throw, including bumper and trampoline bounces) plus a landing reticle. Explosives also show a blast ring.
  - **Aim assist / lock-on**: if the mouse aim is within 0.35 rad of yaw and 0.35 of loft of a solution that hits a rival, it snaps to that solution. It leads the rival's velocity (lead capped at 4 m) and picks the arc closest to your mouse loft. The reticle turns red and brackets slam in, a sound plays, and the HUD tag reads "LOCK · 12m".
  - **Loft**: mouse pitch maps to `aimLoft ∈ [−0.35, 0.95]` (look down to spike, up to lob).
  - **Trickshot tags** (`_trickshot`): SNIPED (≥18 m) or LONG SHOT (≥11 m); one of BANK SHOT (bumper) / RICOCHET / SKIP SHOT; AIR SHOT (victim more than 1.4 m up); JUMP SHOT. Each tag adds +20% knockback, up to 3 tags (×1.6), and 12 style points per tag.

- **Specs 1–7: balance feel pass (2026-09-28)**. *Presentation untouched; numbers live in `game/Balance.js`.*
  - **Knockback** (Spec 1): `launch = (base + growth · growthTaken · %/100) · armor`, where % already includes the hit's own damage. KO needs a launch of about 15.3 from the lip and about 21 from mid-stage (checked with a launch/recovery sim). The old table made every charged hit a KO at low %. The fix lowers base and growth and moves the attack tables into Balance.js.

    | Hit | before: KO from lip / mid | after: KO from lip / mid |
    |---|---|---|
    | jab (punch, c=0) | 162% / 249% | 222% / 335% |
    | smash (punch, c=1) | 28% / 65% | 82% / 142% |
    | hammer tap | 64% / 116% | 117% / 188% |
    | hammer smash | **0%** / 19% | 55% / 105% |
    | anvil smash (new) | — | 37% / 82% |
    | spiky swipe smash (new) | — | 92% / 155% |

    - Resulting launch speeds: a jab at 20% is 5.0 (was 5.8), and at 120% it is 10.0 (was 12.3). A hammer smash at 60% is 12.9 (was 24.0).
    - Ragdoll now starts at launch 15 (was 11, so mid-% punches no longer tumble). Air tumble is capped at 0.55 s (was 1.5).
    - Hitstun is 0.12 + 0.022·launch (was 0.028). Launch drag is 1.1/s.
  - **DI**: hold a direction while launched to spend a Δv budget of 0.35 × move speed (≈2.6 m/s) at 12 m/s². Up-DI is at ×0.6 and ragdoll DI at ×0.4. It can nudge a launch but never reverse a smash.
  - **Landing lag**: 0.08–0.18 s, only when falling faster than 15 m/s. A full jump lands at about 12.6, so normal jumps never lag.
  - **Bots** use DI, tech, air-dodge and ledge at difficulty-scaled rates:

    | Difficulty | DI | tech | air-dodge |
    |---|---|---|---|
    | easy | 0.3 | 0.05 | 0.4 |
    | normal | 0.7 | 0.3 | 0.85 |
    | hard | 1.0 | 0.75 | 1.0 |

  - **Throw arc** (Spec 2): `aimLoft` is clamped to [−0.35, 0.95]. The throw uses the same arc the guide draws, and the HUD lock tag shows the distance.
  - **Archetypes** (Spec 3, `TYPE_STATS`): all three share one collider and differ in feel.

    | Type | mass | move | jump | armor | growth taken | air accel | escape | notes |
    |---|---|---|---|---|---|---|---|---|
    | Cube | 3.0 | 1 | 1 | 1 | 1 | 1 | 1 | all-rounder |
    | Blob | 3.6 | 0.88 | 0.92 | 0.85 | 0.9 | 1 | 1.3 | heavy; dive ×1.15 damage, ×1.25 cooldown |
    | Spiky | 2.6 | 1.12 | 1.08 | 1.15 | 1 | 0.85 | 1 | glass cannon; ×1.2 hit damage |

    - The menu has type and colour pickers.
    - Bots are spread across the three types.
    - The results screen shows each dweeb's type.
  - **Style meter + Super Yeet** (Spec 4):
    - Tiers MEH / SPICY / CHAOTIC / DWEEB GOD at 0 / 25 / 55 / 90 (max 100). The meter holds for 2.5 s, then drains 22/s.
    - Gains: melee 4 + 0.5·launch (+4 for a full charge); throws 6 + 0.4·launch; each trickshot tag 12; BUMPER BANK 10.
    - A full meter arms the **Super Yeet** (F / MMB): the next charged smash or throw gets ×1.35 damage, base and growth.
  - **Item economy** (Spec 5): drops use a weighted table (`Arena.DROP_ITEMS`).
    - Common: beachBall 8, rubberChicken 8, watermelon 7, cake 6, giantRubberDuck 6, trafficCone 6, box 6, poolRing 5, teddyBear 5, pinata 5, piggyBank 4, gumballMachine 4, fishBowl 4, boombox 4, lamp 4, giantDie 4.
    - Mid: crate 5, tire 4, tv 3, ladder 3, mattress 3, shoppingCart 3, couch 2, bowlingBall 3, spikyBall 3.
    - **Rare**: giantHammer 1.5, toyRocket 1.5, explosiveBarrel 1.5, anvil 1. Rares have caps and cooldowns:

      | Rare | max live | cooldown |
      |---|---|---|
      | giantHammer | 1 | 45 s |
      | anvil | 1 | 45 s |
      | toyRocket | 1 | 30 s |
      | explosiveBarrel | 2 | 25 s |

    - A simulated 120 s produced 0 hammers, 0 rockets, 0 anvils and 2 barrels, against 13 cones and 4 carts.
    - Only one hammer spawns at the start (the second became a bowling ball). Starting explosives are rotated in π/8 steps until they're more than 4 m from every spawn.
    - **Comeback bias**: 60% bubble power-up above 90%, and 50% mega when you're behind the best rival on stocks.
    - Punching a barrel lights its fuse. Weapons have distinct identities: the hammer has 2.5 m reach, the anvil hits point-blank and hard, and the spiky ball swipes everyone around you.
  - **Recovery** (Spec 6):
    - **Air-dodge**: speed 11, 0.25 s invulnerable, 0.28 s long, 1.2 s cooldown, then *special fall* (drift only) until you land or grab a ledge.
    - **Tech**: press within a 0.1 s window of a hard slam to pop up with 0.3 s of invulnerability. Missing it leaves you prone for 0.55 s.
    - **Ledge**: auto-grab within 1.1 m of the lip and 1.4 m below it. Hang up to 1.2 s; jump climbs up at 11.5; regrab cooldown 0.6 s.
  - **Sudden death** (Spec 7):
    - Phase 0: RING CRUMBLING, with crumble pace and warnings ×0.75.
    - Phase 1 (15 s): WRECKING CUBES UNLEASHED, pendulum amplitude ×1.2.
    - Phase 2 (last 10 s): FINAL 10 · IT'S RAINING BOOMS. Amplitude ×1.25, drops every 2.2 s biased to rockets and barrels.
    - Every 12 s a **hot-potato** barrel falls with a 7 s fuse.
    - Throughout SD: the sky and fog tint toward dusk, a heartbeat loop plays, shake is ×1.6, and the side blast line pulls in ×0.88 (34 → 30).
    - **Crumble fairness**: tiles with a dweeb on them are skipped where possible and always get at least 0.8 s of warning.

- **Specs 10–12: personality, juice, physics feel (2026-09-28)**
  - **KO lines** (`game/Announcer.js`, 41 strings):
    - Context priority is self-KO > revenge (the victim KO'd you within the last 8 s) > trickshot (hit within 3 s) > sudden death > style tier ≥ 2 > plain.
    - Wet (water) and dry (blast) KOs draw from separate pools, so a dunk and a side blast can never share a line. No line repeats back-to-back.
    - Feed items get a context class (`ko revenge`, `ko trick`, …), and the player gets big announcer text.
    - **splash**: "{a} baptised {v}" · "{v} went for a swim, courtesy of {a}" · "{a} dunked {v} · splish splash" · "{v} is sleeping with the rubber ducks" · "{a} made {v} a lagoon souvenir" · "Cannonball! {a} → {v}"
    - **side**: "{a} yeeted {v} into next week" · "{v} left the building (sideways) · thanks {a}" · "{a} bowled {v} off the map" · "{v} saw the horizon up close · {a}" · "Home run! {a} sent {v} packing" · "{a} deleted {v} from the arena"
    - **star**: "{a} launched {v} into orbit" · "{v} is a star now · {a} made it happen" · "{a} sent {v} to the moon · ding!" · "{v} achieved liftoff · pilot: {a}" · "Houston, {a} has a {v} problem"
    - **self / wet**: "{v} tried to walk on water" · "{v} forgot how floors work (splash)" · "{v} took the scenic route · into the lagoon"
    - **self / dry**: "{v} self-destructed" · "{v} flew off with nobody touching them" · "{v} ran out of arena"
    - **revenge / wet**: "REVENGE! {a} dunks {v} right back" · "Payback tastes like pool water · {a} → {v}"
    - **revenge / dry**: "REVENGE! {a} returns {v} to sender" · "Payback! {a} yeets {v} straight back" · "Grudge settled: {a} > {v}"
    - **trick / wet**: "Trickshot dunk! {a} sank {v} from downtown" · "{a} bank-shot {v} into the drink"
    - **trick / dry**: "TRICKSHOT KO! {a} sniped {v}" · "{a} called the pocket · {v} off the side" · "No-look yeet! {a} → {v}"
    - **sd / wet**: "Sudden death dunk! {a} sinks {v}" · "The lagoon claims {v} · thanks {a}"
    - **sd / dry**: "Sudden death! {a} blasts {v} out" · "{a} wins the crumble lottery vs {v}"
    - **style / wet**: "DWEEB GOD {a} drowns {v} in style" · "Pure chaos: {a} dunks {v}"
    - **style / dry**: "CHAOTIC! {a} stylishly yeets {v}" · "Style points! {a} sends {v} flying"
    - **Big text, you got KO'd**: splash DUNKED! / SPLOOSH! / SOGGY! · side YEETED! / OOF! / BYE-BYE! · star STAR KO! / TO THE MOON! / TWINKLE!
    - **Big text, you scored**: splash DUNK! / SPLASHDOWN! · side YEET! / HOME RUN! / NICE! · star STAR KO! / ORBITAL!
  - **Banners**:
    - The possible banners are "CLEAN SWEEP N–0" (match only, "not a single round dropped"), "STOCK SWEPT" ("never lost a life") or "CLUTCH 1-STOCK" ("hanging on by a googly eye"), and "SUDDEN DEATH HERO" ("last dweeb standing on the rubble").
    - The podium is louder than the mid-match feed: a Lilita One title slam, a staggered banner cascade, 70 pooled confetti spans, and a snare roll plus brass sting with the music ducked to 20% for 1.8 s.
    - **CLOSE!** pops up after a launch that came within 1.5 m of a blast line or the lagoon, at most once every 3 s.
    - The results screen shows a **highlight reel**: BIGGEST YEET (launch, by → on), LONGEST AIR, and TRICKSHOTS (total and top scorer).
  - **Juice by launch tier** (`BALANCE.juice`):

    | Tier (launch) | hit-stop | shake | squash |
    |---|---|---|---|
    | 0 (< 6) | 0.025 s | 0.06 | 0.12 |
    | 1 (6–11) | 0.05 s | 0.16 | 0.2 |
    | 2 (11–18) | 0.09 s | 0.38 | 0.3 |
    | 3 (≥ 18) | 0.16 s | 0.8 | 0.45 |

    - Tier 3 is the fireworks gag: confetti, a ring, sparkles, a screen impact flash and a punch-zoom.
    - **Kill-cam lite**: when you're part of a KO, the camera leans 55% toward it for 0.75 s and snaps back. It's skipped when `cam.multiFraming` is set.
    - Stock icons pop off when a stock is lost, and the % number punch-scales at 50, 100 and 150.
    - No post-processing. Measured 60 fps with 8 dweebs (≈246 draw calls).
  - **Carry heft** (`BALANCE.carry`):
    - Items heavier than 2.5 take 0.05 + 0.02·(mass − 2.5) s to settle in your arms (max 0.12 s). Throwing during that window queues the throw.
    - Walking with a heavy item: speed × (1 − 0.035·(mass − 2.5)), floored at 0.82.
    - Items under 0.8 mass have only a 0.1 s grab-to-throw cooldown.
    - Throws of mass 4 or more add a grunt ("HNNNGH!"), dust and a micro hit-stop. An anvil telegraphs its weight; a beach ball stays slapstick.
  - **Stage toys** (`BALANCE.bounce`):
    - Bumper loft 4.2 (was 3); dweeb bump-up 5.2 (was 4.5).
    - Trampolines keep ×1.1 horizontal speed (contact friction used to eat it), so bank shots through a trampoline still earn BANK SHOT and the arc preview matches.
  - **Water** (`BALANCE.water`):
    - Bigger splash: double plume, ring and spray.
    - Landing in the water within 2.5 m past the lip starts a 0.6 s **flail**, once per trip. Pressing jump does a splash-jump at 18.5 up, with an inward push timed to clear the lip after 0.36 s (max 6).
    - Air-braking is switched off for 1.1 s afterwards unless you steer, with a minimum 3.5 m/s inward. A hands-off splash-jump from r = 18 lands on the tiles at r ≈ 14.4.
    - Bots splash-jump at a skill-scaled rate.
  - **Ragdoll**: angular damping 2.2 and spin capped at 14 rad/s (was 25, which read as a seizure rather than a yeet).

- **Brand + character pass (2026-09-28)**. *Refs: the three `images/Screenshot 2026-09-28 …` files: cube + spiky, logo, screaming.*
  - **Characters** (`player/DweebModel.js`; `Dweeb.js` now only calls `buildDweebModel` and `animateDweebFace`):
    - Flat-shaded, faceted low-poly bodies. The cube is a chamfered, hand-jittered 0.64 × 0.76 block raised on thin noodle legs.
    - Spiky is a faceted ball with 26 bent noodle tentacles merged into two wobbling meshes. That's 2 draw calls, down from ~30 cones, each of which was drawn twice by the outline pass.
    - Blob is a faceted gumdrop.
    - Huge googly eyes, sculpted brows (not on spiky, matching the ref), and noodle arms ending in four-finger hands.
  - **Faces**: the resting face is a small frown that flips to a smug grin.
    - When hit, grabbed, flailing or tumbling, the mouth becomes a **screaming howl** (arched top lip, corners dragged down, teeth, tongue) and the eyes squeeze shut under body-coloured lids. X-eyes appear while ragdolled.
    - Charging shows gritted teeth under furious brows.
  - **Moods** ("emotionally unstable"): grumpy (cube default) / calm / smug / worried.
    - Smug for 2.5 s after scoring a KO; worried at 100%+; otherwise random mood swings every 2.5–7.5 s.
    - Geometry is cached per type and shared, and the per-frame face update doesn't allocate.
  - Dev tool: `/#dweebs` shows every type × expression (and `#dweebs-side` shows side views).
  - **Logo** (pure CSS, `index.html .logo`):
    - Chunky Lilita One letters, each with its own brand colour: D `#f47a3a`, W `#ffc53d`, E `#ffd84a`, E `#6cc35a`, B `#56aee8`, S `#a98be0`. Navy ink `#1f2342`.
    - Gloss comes from a clipped gradient overlay on each letter. The letters bob and twinkle.
    - A grumpy yellow cube mascot sits on the S, and a little blue cube bonks off the D.
    - The logo is used on the loading screen and in the menu. The `favicon.svg` is the grumpy cube.
  - **Loading screen**: a soft grey-rainbow glow with pastel neon panels (blue/pink, also behind the results screen), the tagline, and a real progress bar.
    - Boot stages: *Inflating Dweebs… → Teaching cubes to feel… → Untangling tentacles… → Calibrating googly eyes… → Filling the lagoon… → Emotions: unstable. Ready!*
    - It stays up at least 1.1 s from boot so the logo reads, then fades out.
  - **HUD portraits** are now tiny googly-eyed faces: angry by default, worried at 100%+, yelling while launched.

### The adapter: running the real sim behind the server

The server was built against the contract, not against `Sim`, so wiring the real thing was an
adapter rather than a rewrite — and the adapter is where every assumption got tested.

- **Ids are assigned by the adapter, not by the sim.** `src/sim/dweeb.js` identifies dweebs by slot,
  but the wire format is `u16` entity ids that must be stable for the life of a match and never
  collide with item ids. The adapter maps slot `s` → wire id `s + 1` (matching what `MockSim`
  already put on the wire, so the client cannot tell the two apart) and sim item ids → `1000 + itemId`.
  A fixed offset rather than a hand-rolled map: it is total, it is obvious, and it cannot drift. The
  item base is what keeps two entities from sharing a wire id, which would look exactly like a
  teleport.
- **`restore()` is snapshot-wide, and that is fast enough.** Rewind-and-replay needs to rewind *one*
  entity, but the sim's restore is global. Per-entity rewind would need a second, partial snapshot
  path — a whole new failure mode for a cost saving nobody could measure. `step()` at p50 0.055 ms /
  p95 0.171 ms against a 4 ms budget leaves so much headroom that the server can afford ~30 restores
  per snapshot and still be idle.
- **`step()` takes inputs for every slot, bots included**, and the adapter's `botInputs()` fills the
  seats nobody claimed, so a server-hosted match and a headless match run the same sim call. Bots
  themselves are driven inside `Sim` (the headless runner never passes bot inputs), so the adapter
  only has to make sure the input map is total instead of sparse.
- **The mock stayed the default.** `DWEEBS_SIM=real` is opt-in, because a green suite that suddenly
  changes which sim it exercises is not a green suite, it is a different suite. Both paths are now
  run in CI, and the mock keeps a second, independent implementation of the contract alive — which
  is what makes the contract's tests worth anything.
- **Events are the part the mock could not fake.** On the real sim a 3-second netcode run delivers
  ~193–196 events (KO, hit, pickup); on the mock it delivers 0. A protocol that only ever saw
  position deltas would have shipped with an event stream that had never once been exercised on the
  wire.

## 5. NET — Protocol, Prediction and Bandwidth (2026-09-29)

- **One encoder interface, two implementations.** `src/net/protocol.js` defines the messages and
  a `makeCodec('json' | 'bin')` factory. JSON went first because a protocol you cannot read in
  devtools is a protocol you cannot debug; the binary `DataView` path replaced it once both
  sides agreed on the schema. The server picks per process with `--codec`, so a bug can be
  reproduced with readable frames by flipping one flag. Every number lives in the `NET` block of
  `Balance.js` and is re-exported through `protocol.js`, so the wire code, the HUD and the server
  cannot drift apart by copy-paste.
- **Quantization.** Positions are centimetres in an `int16`: 1 cm over a 40 m stage is 4000 steps,
  far below visual resolution, and it fits a signed short with room to spare. Rotations use
  smallest-three quaternions — three `int16` components plus a 2-bit index — with the dropped
  component recovered from the unit-length constraint, and the sign canonicalized to `w >= 0` so
  `q` and `-q` cannot encode differently. In practice yaw rides in a single byte (`q`), which is
  all the current game needs; the quaternion path is there for when items and ragdolls need a
  full orientation.
- **Input redundancy (3 frames).** Each input packet repeats the last three ticks, so a dropped
  packet costs nothing: the next one carries the input the server missed. Three frames is 50 ms of
  runway at 60 Hz, which covers a single loss event without wasting bandwidth on a margin no real
  network needs.
- **The lookahead discovery.** The input buffer originally required an exact tick match. That is
  wrong, and it was the single biggest source of prediction error: the client deliberately runs its
  tick clock *ahead* of the server's by about half the RTT (that is what prediction is for), so an
  exact-match buffer was always one tick behind and the dweeb walked in slow motion. The server
  now takes the newest input within an 8-tick window — 133 ms, which covers 250 ms RTT. Prediction
  error at 120 ms went from ~1.4 m to 0.24 m.
- **Never predict before you are anchored.** The client used to step its local sim from the moment
  it connected. For one full RTT it free-ran with no authoritative baseline, and the first snapshot
  then "corrected" by metres — the ugliest thing netcode does. It now idles until the first
  snapshot, then adopts the server state outright (a join is a snap, not a correction; smoothing a
  spawn means gliding in from nowhere).
- **Out-of-order snapshots are dropped, not reconciled.** With jitter applied, an older snapshot
  can arrive after a newer one. Reconciling it rewinds the sim and shows up as a rubber-band. One
  line of guard removed the remaining 2-3 m jumps.
- **The clock can also teleport you.** Catching up 5 sim ticks after a slow frame moves the dweeb
  five ticks' worth of distance in one rendered frame. That is the same visual failure as a network
  teleport, caused by the frame clock instead of the network, and it is just as noticeable. Catch-up
  is capped at 2 ticks and the leftover accumulator is dropped rather than repaid: the client clock
  is allowed to drift a few ms per second, which is imperceptible, and the snapshots keep pulling it
  back into agreement.
- **The 1 m no-snap rule.** Errors under 1 m are only ever eased in. A sub-metre disagreement is
  invisible in motion, and snapping there is the most obvious netcode tell there is. The mock sim
  was also faking teleports (no floor, so dweebs fell out of the world and respawned; a mirrored
  stage edge that flung them 27 m across the arena), which is worth remembering when a netcode
  harness reports a jump: check the mock before you blame the reconciliation.
- **Bandwidth, and where it actually goes.** Measured at 8 clients with 120 ms lag and 2% loss:
  **3.3–3.7 KB/s peak downstream, 2.1 KB/s upstream, 0 cm cross-client divergence.** The budget is
  8 KB/s. Three changes did most of the work, and none of them were "send less often":
  1. *Deltas against a per-client baseline* — only entities whose quantized state changed are sent,
     with a full snapshot every second as the safety net for dropped deltas and late joiners.
  2. *Velocity only for your own dweeb.* A client interpolates everyone else between snapshots, so
     remote velocity is redundant: 6 bytes off 11 of 12 entities, every frame. This is the single
     biggest saving, and it is why the snapshot is built per receiver rather than once and fanned
     out. The flag bit has to be written *before* the velocity, since the reader is sequential.
  3. *Items at a third of the snapshot rate.* A box rolling on a floor is slow; 10 Hz plus
     interpolation is indistinguishable and worth ~1.2 KB/s.
  Entity ids also went from `u32` to `u16` (ids are small: 720 B/s for three lines of code). The
  worst case — 1 player plus 7 bots with every entity in motion every frame — is 6.4 KB/s, so the
  budget holds without trading away responsiveness.
- **Rate limiting needs separate budgets per message kind.** One shared sliding window meant that
  60 input frames per second filled the window and then tripped the much smaller control-message
  cap on the next ping, benching a perfectly well-behaved client. Windows are now per kind: 90/s
  for input (60 Hz plus headroom), 40/s for control.
- **Reconnect.** A dropped connection holds the slot and the dweeb in it for 20 s, keyed by a token
  the client keeps in `localStorage`, so a phone locking its screen does not cost you your
  character. The server is the authority, so there is no host to migrate.
- **Frozen lobby, and why every test still passed.** Wiring the real sim exposed a bug that no
  amount of netcode testing would have found, because the netcode was fine: the server never
  transitioned a room out of `lobby`. The ready-handshake existed in the client and was ignored by
  the server, so players sat in a lobby while the server kept ticking an idle world. Every
  convergence assertion passed, because all clients agreed perfectly on a world where nothing
  happened. Three fixes came out of it:
  1. **The ready-gate is enforced server-side** — `allHumansReady()`: every *connected* human ready
     and at least one human present, then the room flips to `playing` and bots fill the empty seats.
     There is deliberately no timeout: a ready gate that gives up on its own is just a slower
     auto-start, and it would hide a client whose ready packet never arrived.
  2. **The full-snapshot cadence was tied to the wrong clock.** `tick % FULL_SNAPSHOT_EVERY === 0`
     cannot work in a lobby, because the lobby tick never advances — the remainder was 0 forever, so
     the room was one permanent full snapshot at full bandwidth. The cadence now counts *snapshots*,
     independent of the sim tick.
  3. **The room loop was iterating the `rooms` Map while mutating it** (create/evict happened inside
     the same `for…of`), which is undefined behaviour that happened to look like "rooms sometimes do
     not tick". It now iterates a snapshot of the keys.
  4. **Idle rooms are evicted** after `ROOM_IDLE_MS` with zero humans, so an abandoned room does not
     keep a 60 Hz sim alive forever.
- **Liveness is now an assertion, not an assumption.** `tools/netSmoke.mjs` asserts worst-case entity
  movement and a minimum server-tick advance, so "the server agreed with itself while nothing moved"
  fails instead of passing. A convergence test without a liveness test is a test that a broken server
  passes: 0 cm of divergence is trivially true when every client is watching a frozen world. This is
  the most valuable line in the harness and it took a real bug to think of it.
- **What is still not automated, and should not be claimed.** How 100 ms smoothing *feels* in a real
  tab. The two-browser test proves both clients agree on the same tick and that the world moves; it
  says nothing about whether the camera reads well, which needs a human in two tabs.
