# Round 2 Plan: Locomotion Juice

## Overview
Give the Dweeb body a readable locomotion language: banking into turns, a pre-jump
crouch, aerial stretch, a landing squash, a landing-roll transition (already exists,
wire the visuals to it), and skid-dust on fast reversals. All math lives in a new
pure module — `src/player/locomotionJuice.js` — with thin wiring in the three.js
classes. **Nothing in this round touches physics bodies, colliders, hitboxes, or
`src/sim/**`; every output is a presentation value.**

---

## 1. New Pure Module (DONE — landed API)

`src/player/locomotionJuice.js` — no three.js, no DOM, no `Math.random()`; plain
`{x,y,z}` numbers; reused scratch objects via `out` params. Verified by
`test/locomotion-juice.test.js` (32 tests, all green).

```js
export const LOCOMOTION_DEFAULTS = {
  lean: { speedRef: 6, minSpeed: 1.2, rate: 12, maxLean: 0.5 },
  anticipation: { duration: 0.16, peak: 0.24, squashPhase: 0.45 },
  stretch: { maxStretch: 0.18, refSpeed: 15 },
  landing: { maxSquash: 0.5, k: 0.03, massRef: 3 },
  reversal: { engageDot: -0.3, releaseDot: 0.15, minSpeed: 4.2, cooldown: 0.22, eventMinSpeed: 6 },
};

export function makeLocomotionState();      // per-Dweeb state, create once in the constructor

export function updateLean(state, vel, input, dt, opts?);
//   → number. Bank angle (rad), lerped toward the target. Positive = leaning LEFT
//   (top toward the character's left), i.e. into a left turn. Sign derives from
//   cross(vel, input).y, scaled by hSpeed/speedRef, clamped to ±maxLean, smoothed
//   with rate. At hSpeed < minSpeed or no input → target 0.
//   Wire: this.rig.rotation.z = lean (in Dweeb._animate, non-ragdoll, non-held).

export function beginJumpAnticipation(state, opts?);   // call when a jump fires
export function updateJumpAnticipation(state, dt, opts?);
//   → number ≥ 0 to ADD to body Y scale: smoothstep envelope bump to `peak` at
//   `squashPhase`, back to 0, then deactivates.

export function aerialStretch(vy, opts?);
//   → number ≥ 0: min(maxStretch, |vy| · maxStretch/refSpeed). Symmetric.

export function landingSquash(fallSpeed, mass = 3, opts?);
//   → 0…maxSquash: min(maxSquash, fallSpeed · k · mass/massRef). Mirrors the old
//   inline Dweeb formula so wiring can route through here without behaviour change.

export function squashStretch(amounts, opts?, out?);
//   amounts = { anticipating?, landing?, stretch? } (all ≥ 0)
//   → { sy, sxz } with sy = max(minSy, 1 − anticipating − landing + stretch) and
//   sxz = 1/√sy (volume preserved). Mutates `out` when provided.

export function detectReversal(state, hSpeed, dot, dt, opts?, out?);
//   → { event, intensity }
//   event: 'start' | 'skid' | 'end' | null; intensity 0…1 (hSpeed/eventMinSpeed clamped).
//   State machine with hysteresis (idle ⇄ skidding):
//     idle      → 'start' when hSpeed ≥ minSpeed && dot ≤ engageDot && cooldown ≤ 0
//                 (primes cooldown)
//     skidding → 'end' when hSpeed < minSpeed || dot ≥ releaseDot (cooldown set)
//              → 'skid' every cooldown expiry while still hard-reversed (continuous dust)
//   `dot` = travel/input alignment (−1 = full reversal), e.g. the Dweeb's existing
//   `facing` value in preStep.
```

---

## 2. Wiring Points (Second Engineer)

### `src/player/Dweeb.js`

1. **Import** `{ makeLocomotionState, updateLean, beginJumpAnticipation,
   updateJumpAnticipation, aerialStretch, landingSquash, detectReversal }` from
   `./locomotionJuice.js`.

2. **Constructor** (near `this.wobblePhase`):
   ```js
   this.loco = makeLocomotionState();
   this.skidDust = { event: null, intensity: 0 }; // reuse across frames — no alloc
   ```

3. **`preStep(dt)`** — at the end of the `canAct` movement block (right where the
   skid trigger already lives, ~line 482). The existing block already fires
   `this.onSkid` and sets `this.skidTimer`. **Add** behind it:
   ```js
   if (this.grounded) {
     const r = detectReversal(this.loco, hSpeed, facing, dt, {}, this.skidDust);
     if (r.event === 'start' || r.event === 'skid') {
       this.onSkidDust?.(this, r.intensity);
     }
   }
   ```
   This is **visual only** — it does not change `skidTimer`, physics, or gameplay.
   (Do NOT replace the existing `onSkid` call; the new event is additive and feeds
   the pooled dust spray in Fx.)

4. **`postStep`** — in the landing branch (inside `if (this.grounded)` →
   `if (!this.wasGrounded && this.velocity.y < -3)`):
   - Keep the existing `this.landSquash = Math.min(0.5, …)` line exactly as-is
     (gameplay/roll gating uses it). **Add** a parallel visual value:
     ```js
     this.locoLandSquash = landingSquash(fall, this.stats.mass);
     ```
   - The roll transition already exists (`startRoll` when direction held + fall ≥
     `BALANCE.roll.minFallSpeed`). No gameplay changes. For the visual roll read,
     the existing `_animate` roll tumble (`this.rig.rotation.x = -t * PI * 2`)
     already plays; optionally add the same `fx.roll(d)` dust by calling it in
     `onRoll` (already wired in `main.js` → `fx.roll`).
   - Jump anticipation / stretch: in `preStep`, where jump velocity is set
     (`if (this.jumpBuffer > 0 && …) { vy = … }` and the double-jump branch), call
     ```js
     beginJumpAnticipation(this.loco);
     ```
     (once when the jump fires). The stretch is computed in `_animate` from
     `this.velocity.y` — pure, no call site needed.

5. **`_animate(dt, time, pos)`** — replace the squash/stretch block (currently
   lines ~911–923). Keep the same shape but route through the pure curves:
   ```js
   const air = !this.grounded && !this.ragdolling;
   const anticipating = updateJumpAnticipation(this.loco, dt);
   const landingSq = this.locoLandSquash ?? 0;          // set in postStep
   const stretch = air ? aerialStretch(this.velocity.y) : 0;
   const { sy, sxz } = squashStretch(
     { anticipating, landing: landingSq, stretch },
     {}, this._locoScale ?? (this._locoScale = { sy: 1, sxz: 1 }),
   );
   this.rig.scale.set(sxz * this._scale, sy * this._scale, sxz * this._scale);
   ```
   - `this.locoLandSquash` decays like the old one: `this.locoLandSquash *=
     Math.exp(-10 * dt)` at the top of `_animate` (keep `landSquash` handling
     untouched — it still drives the roll/other flags).
   - Keep `wobblePhase` walk wobble and `mega` scale as they are; `this._scale` is
     still multiplied in. The old `sy` var (walk sin + stretch + landSquash) is
     replaced by the envelope; tune `A.peak`/`S.maxStretch` if it reads too strong.
   - **Banking** — in the same non-ragdoll branch where yaw is applied, add:
     ```js
     if (this.grounded && !this.held) {
       const lean = updateLean(this.loco, this.velocity, this.moveInput, dt);
       this.rig.rotation.z = lean;
     } else {
       this.rig.rotation.z = 0;   // air / held / ragdoll: no bank
     }
     ```
     Note `this.rig.rotation.x` is already used by holds/roll — only Z is new.
     `this.moveInput` is a `THREE.Vector2` ({x, y}); `updateLean` reads
     `input.z ?? input.y`, so it works as-is.

### `src/player/DweebModel.js` / `src/render/*`
- No changes needed. The rig scale/rotation live on `d.rig` in `Dweeb.js`.

### `src/game/Fx.js`
1. **Add** `skidDust(d, intensity)`:
   ```js
   skidDust(d, intensity = 1) {
     const pos = d.getPosition();
     const v = d.velocity || { x: 0, z: 0 };
     const n = Math.max(2, Math.round(6 * intensity));
     // kick dust sideways out of the turn: perpendicular to travel
     const len = Math.hypot(v.x, v.z) || 1;
     this.particles.dust(
       { x: pos.x - v.x * 0.03, y: pos.y - 0.45, z: pos.z - v.z * 0.03 },
       n,
     );
     if (d.isPlayer) this.haptics?.pulse(0.1 + 0.08 * intensity, 45, 0.18);
   }
   ```
   (Or reuse `Particles`' pooled `dust` preset — it already pools; nothing new to
   allocate.)
2. **Wire** in `src/main.js` `wireDweeb` next to `onSkid`:
   ```js
   d.onSkidDust = (dw, intensity) => fx.skidDust(dw, intensity);
   ```

### Roll-transition juice (already present)
- Landing + direction held + fall ≥ 14 already calls `startRoll` (keeps momentum,
  sets `landSquash`, fires `onRoll` → `fx.roll` dust + style). **No changes.**
  The visual tumble exists. If you want the roll to feel juicier, add a second
  dust puff at the roll midpoint (`rollTimer` ≈ half) in `preStep`'s roll branch —
  keep it zero-alloc (reuse `this.onRoll`/`fx.roll`).

---

## 3. Test List

`test/locomotion-juice.test.js` — 32 tests, all landed and green:

| Group | Coverage |
|-------|----------|
| Purity | source scan: no three import, no DOM/window, no `Math.random()` |
| Lean target | 0 when stationary / slow / aligned; sign matches left/right turn (cross convention); exact mirror for opposite turns; scales with speed up to `speedRef`; clamps at `maxLean`; smoothing monotonic, no overshoot, converges; decays to 0 when input released; accepts `{x,y}` Vector2-shaped input; `dt = 0` advances nothing |
| Jump anticipation | 0 before start; envelope rises to peak, falls, deactivates forever after; custom duration/peak honoured |
| Aerial stretch | 0 at rest; symmetric in sign; ramps with \|vy\|, clamps at `maxStretch` |
| Landing squash | 0 at zero fall; scales with fall speed and mass; clamps at `maxSquash` |
| Squash/stretch compose | identity at rest; volume preserved (sy·sxz² ≈ 1) across combos; stretch > 1, squash < 1; `minSy` clamp; reuses/returns `out` |
| Reversal detection | idle when slow/aligned; 'start' on fast full reversal with intensity; no re-trigger while cooldown hot; 'skid' repeats after cooldown while still reversed; hysteresis band (dot between engage/release) neither ends nor re-engages; ends on slowing below minSpeed; post-end cooldown blocks instant restart; intensity monotonic, clamped [0,1]; reuses `out` |

Also re-run: `test/hand-rig.test.js`, `test/sim-purity.test.js`, full suite (see
Gate).

---

## 4. Implementation Order

1. ✅ `src/player/locomotionJuice.js` — pure math (this commit)
2. ✅ `test/locomotion-juice.test.js` — 32 vitest tests, all passing
3. Wiring per §2 (second engineer): `Dweeb.js` → `Fx.js` → `main.js`
4. `npm test` → `npm run build` → gate.
5. This doc stays as the handoff record.

---

## 5. Gate Checklist

- [ ] `npm test` (npx vitest run) exits 0 — including the new 32 tests
- [ ] `npm run build` exits 0
- [ ] `/workspace/anim/gate.sh` exits 0 (test + build + smoke-shell + smoke-units)
- [ ] No new dependencies, no CDN
- [ ] `src/sim/**` untouched (purist gate passes)
- [ ] No physics/hitbox changes: all outputs are rig/particle-only
- [ ] No per-frame allocations in `_animate`/`preStep` (module `out` objects reused)
- [ ] No geometry/material created (nothing to dispose) — pure math + existing pools

---

## 6. Notes for Second Engineer

- **Sign convention**: `updateLean` positive = lean LEFT (top toward the
  character's left) = into a left turn. Wire `rig.rotation.z = lean` unmodified —
  do NOT negate. The test suite locks this convention in.
- **`facing` in preStep** is exactly the `dot` input for `detectReversal`
  (travel·input alignment). It's computed only when `inputMag > 0.1`; leave the
  fallback as-is.
- **Don't delete the old `landSquash`** — roll gating, `Fx.hit` squash, and
  `recoverFromRagdoll` still read it. `locoLandSquash` is additive.
- **Skid dust**: reuse `Particles.dust` (already pooled, no per-frame alloc).
  Don't create a new particle system.
- **Roll**: do not modify `Dweeb.startRoll`. It already gives momentum, squash,
  yaw, `onRoll` style + FX. Visual tumble is in `_animate`.
- **Perf**: `updateLean`/`detectReversal`/`updateJumpAnticipation` mutate `state`
  (no allocs); pass the module-level `this.skidDust` / `this._locoScale` objects
  as `out` args.
- If the bank reads too strong on the round blob archetypes, tune `maxLean`
  (0.5 rad ≈ 29°) down per type via `opts` in `_animate` — not in the pure module.
