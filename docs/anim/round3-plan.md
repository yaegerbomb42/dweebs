# Round 3 Plan: Punch Wind-Up & Impact

## Overview
Give every unarmed punch a readable two-part language: a **wind-up telegraph**
(the fist draws back along a raised arm while the body coils and squashes,
scaling with charge — a tap jab stays nearly flat, a held smash escalates), then
a **strike snap** (front-loaded extension with a pooled trail), and a
**recoil spring** that flinches the fist backward when a punch is parried or
lands on a heavy object. All math lives in a new pure module —
`src/player/punchAnim.js` — with thin wiring in the three.js classes.
**Nothing in this round touches physics bodies, colliders, hitboxes, damage, or
timing; every output is a presentation value. `src/sim/**` is untouched.**

---

## 1. New Pure Module (DONE — landed API)

`src/player/punchAnim.js` — no three.js, no DOM, no `Math.random()`; plain
`{x,y,z}` / 2D `{y,z}` numbers; reused scratch objects via `out` params.
Verified by `test/punch-anim.test.js` (33 tests, all green).

```js
export const PUNCH_DEFAULTS = {
  armLen: 0.32,  minSy: 0.55,
  windup: { pullMax: 0.34, twistMax: 0.5, squashMax: 0.16,
            pullPow: 1.4, twistPow: 1.8, squashPow: 1.5,
            cockBase: 0.55, cockPerCharge: 0.95, armRz: 0.9 },
  punch:  { minPull: 0.06, extend: 0.5, extensionRx: -1.35,
            strikeDuration: 0.13, recoverDuration: 0.18, trailStrength: 0.3 },
  smash:  { extend: 0.62, extensionRx: -1.5,
            strikeBase: 0.16, strikeCharge: 0.06,
            recoverBase: 0.2, recoverCharge: 0.08, trailStrength: 1 },
  strike: { snapPow: 0.52, overshootK: 0.12, impactAt: 0.38, uncoilPow: 1.2 },
  recoil: { stiffness: 70, damping: 11, maxDisp: 0.24,
            twistPerM: 1.0, squashPerM: 0.4,
            parryImpulse: 1.1, heavyFrom: 2.5, heavyBase: 0.22,
            heavyPerMass: 0.07, heavyChargeK: 0.2, heavyMax: 1.0 },
  trail: { points: 8 },
};

export function makePunchState();        // per-Dweeb FSM state, create once in the constructor
export function makePunchPose();         // scratch pose object, reuse every frame (no alloc)

export function beginWindup(state);      // idle/recover/strike → 'windup' (idempotent)
export function releaseStrike(state, charge = 0, kind = null);
//   → 'strike'; locks charge snapshot + mode. kind = atk.kind ('punch'|'smash');
//   when omitted, mode derives from charge (≥ 0.2 → 'smash', mirrors CombatSystem).
export function interruptPunch(state);   // any phase → 'idle' (keeps recoil spring)
export function applyRecoilImpulse(state, strength);   // kick the flinch spring (m/s)
export function parryRecoilStrength(opts?);            // → 1.1 m/s (overrideable)
export function heavyRecoilStrength(mass, charge, opts?);
//   → clamp(heavyBase + max(0, mass − heavyFrom)·heavyPerMass + charge·heavyChargeK,
//           heavyBase, heavyMax)

export function updatePunch(state, dt, driverCharge = 0, opts?, out?);
//   Advances timers + recoil spring, writes the pose into `out` (reused; creates
//   a fresh pose when out is null). `driverCharge` = live `d.charging` while
//   winding so the pose ramps with the hold. Returns out.
//   Pose fields (pose = out):
//     phase        'idle' | 'windup' | 'strike' | 'recover'
//     mode         'punch' | 'smash' | null
//     charge       0..1 (live while winding, locked after release)
//     armRx        rad, desired pitch of the PUNCHING arm pivot (0 = leave
//                  the locomotion/held pose alone)
//     armRz        rad, sideways spread for the punching arm
//     handRetract  m, extra fist distance along the arm past its rest offset
//                  (positive = chambered deeper; negative = press-through)
//     twist        rad, body yaw coil — NEGATIVE = right shoulder back (the
//                  load for a right punch). Wire `rig.rotation.y = twist`.
//     scale        { sy, sxz }, volume-preserving punch envelope (sy·sxz² ≈ 1).
//                  Compose MULTIPLICATIVELY with the locomotion scale.
//     trail        { active, strength } — 0..1, for pooled trail spawns
//     head2d      { y, z } — fist position in the sagittal plane (up = +y,
//                  forward = +z), independent of the three.js transform stack
export function punchPose(state, driverCharge?, opts?, out?);   // pose without advancing
export function trailPath(state, opts?, out?);
//   → { points, count } — `P.trail.points` keyframes of the fist's path through
//   the strike sweep in sagittal-plane coordinates ({y,z}); `out.count` set.
//   Points lie on the chamber arc: radius ∈ [armLen, armLen + pullMax].
```

---

## 2. Wiring Points (Second Engineer)

### `src/player/Dweeb.js`

1. **Import** (extend the existing juice import block):
   ```js
   import { makePunchState, makePunchPose, beginWindup, releaseStrike, interruptPunch,
            updatePunch, applyRecoilImpulse, parryRecoilStrength, heavyRecoilStrength } from './punchAnim.js';
   ```

2. **Constructor** (near `this.loco`):
   ```js
   this.punch = makePunchState();
   this._punchPose = makePunchPose();   // reused across frames — no alloc
   this._wasCharging = false;           // isCharging rising-edge detector
   this._punchFistRestY = null;         // rest Y of the right fist (cached first frame)
   this.onPunchStrike = (dw, charge, kind) => releaseStrike(this.punch, charge, kind);
   this.onPunchRecoil = (dw, strength) => applyRecoilImpulse(this.punch, strength);
   this.onPunchHeavyImpact = (dw, obj, charge) =>
     applyRecoilImpulse(this.punch, heavyRecoilStrength(obj?.def?.mass ?? 0, charge));
   ```

3. **`postStep(dt, time)`** — at the top of the timer block (before `_animate`):
   ```js
   // Punch FSM: wind-up on the rising edge of isCharging; hard interrupts cancel.
   if (this.isCharging && !this._wasCharging) beginWindup(this.punch);
   this._wasCharging = this.isCharging;
   if (this.punch.phase !== 'idle' && (!this.canAct || this.held)) interruptPunch(this.punch);
   ```
   (`canAct` already covers hitstun / ragdoll / grabbed / prone / dive / landLag /
   air-dodge / ledge / freeze / roll; `held` is extra — punching never animates
   while holding.)

4. **`_animate(dt, time, pos)`**:
   - At the top (before the squash/stretch block), integrate:
     ```js
     const pose = updatePunch(this.punch, dt, this.charging, {}, this._punchPose);
     ```
   - **Compose punch scale with the locomotion envelope** — replace the scale-set
     line (`this.rig.scale.set(sxz * this._scale, sy * this._scale, sxz * this._scale);`)
     with:
     ```js
     this.rig.scale.set(
       sxz * this._scale * pose.scale.sxz,
       sy * this._scale * pose.scale.sy,
       sxz * this._scale * pose.scale.sxz,
     );
     ```
     (Multiplicative composition keeps sy·sxz² ≈ 1 exactly.)
   - **Twist** — in the banking block (`if (this.grounded && !this.held && !this.ragdolling)`),
     add `this.rig.rotation.y = pose.twist;` after the lean line, and
     `this.rig.rotation.y = 0;` in the `else` branch. (`rig.rotation.y` is
     currently unused — only x/z are taken by holds/roll/banking.)
   - **Arm override** — in the arm loop, replace the two old branches
     (`if (this.charging > 0 && arm.side === 1)` and
     `if (this.attackAnim > 0 && arm.side === 1)`) with one punch-first gate:
     ```js
     if (arm.side === 1 && !this.held && pose.phase !== 'idle') {
       rx = pose.armRx;
       rz = pose.armRz;
     } else if (arm.side === 1) {
       if (this.charging > 0) { rx = 0.6 + this.charging * 0.9; rz = 0.9; }
       if (this.attackAnim > 0) {
         const t = this.attackAnim / 0.22;
         rx = -Math.PI / 2 * Math.min(1, t * 2);
         rz = 0.1;
       }
     }
     ```
     (The old branches keep their exact behaviour whenever punch is idle — held
     charges and throw/gadget attackAnim still render as before. The punch arm is
     always the right one, `arm.side === 1`.)
   - **Fist retract** — after the arm loop:
     ```js
     const fist = this.handParts?.[1];
     if (fist) {
       const restY = this._punchFistRestY ?? (this._punchFistRestY = fist.position.y);
       fist.position.y = pose.phase !== 'idle' ? restY - pose.handRetract : restY;
     }
     ```
     (Rest Y differs per archetype (glove/plunger/plain) — caching avoids hardcoding.)
   - **Trail hook** — right after `animateHands(...)`:
     ```js
     if (pose.trail.active) this.onPunchTrail?.(this, pose);
     ```

### `src/combat/CombatSystem.js`

Additive event lines only — no gameplay value changes.

1. **`releaseAttack`** — immediately after `d.swingT = weapon ? 0.3 : 0;`:
   ```js
   d.onPunchStrike?.(d, charge, atk.kind);
   ```
   (At this point `atk.kind` is already `'punch'` | `'smash'`; throws/gadgets
   returned earlier, so this fires only for real punch/smash attacks.)
2. **Object-hit loop** — after the `explosive / applyDamage / bonk` chain:
   ```js
   if ((obj.def.mass ?? 1) >= HEAVY_MASS) d.onPunchHeavyImpact?.(d, obj, charge);
   ```
   Add `HEAVY_MASS` to the existing `from '../player/handRig.js'` import.

### `src/player/Dweeb.js` — `_counter(dir, attacker, time)`

Parry recoil on the attacker, after `attacker.hitstun = Math.max(attacker.hitstun, P.stun);`:
```js
attacker.onPunchRecoil?.(attacker, parryRecoilStrength());
```

### `src/game/Fx.js`

```js
const _w = new THREE.Vector3();  // module-level scratch — no per-frame alloc

/** Pooled punch trail: a short candy puff trail at the fist's current world position. */
punchTrail(d, pose) {
  (d.handParts?.[1] ?? d.mesh).getWorldPosition(_w);
  const n = 2 + Math.round(3 * pose.trail.strength);
  this.particles.emit(_w, {
    count: n, colors: [d.color, 0xffffff], speed: 0.9, up: 0.4,
    size: 0.12, life: 0.2, gravity: 0, drag: 3, grow: 1.2,
  });
}
```
(`Particles.emit` is pooled — nothing new to allocate or dispose. If the streak
reads too sparse, swap the `emit` for a `ring` at `_w` on the impact frame (`pose.trail.strength` ≥ ~0.8).)

### `src/main.js` — `wireDweeb(d)`

```js
d.onPunchTrail = (dw, pose) => fx.punchTrail(dw, pose);
```

### Unchanged

`DweebModel.js`, `Controller.js`, `Juice.js`, `src/sim/**`, hitboxes, damage
tables, `attackAnim` semantics. The hub crowd's `syncVisual` path is a separate
`_animate` override that never runs the FSM — leave it alone.

---

## 3. Test List

`test/punch-anim.test.js` — 33 tests, all landed and green:

| Group | Coverage |
|-------|----------|
| Purity | source scan: no three import, no DOM/window, no `Math.random()` |
| State/creation | factory pose is a clean idle; fresh state idle with zeroed lock/recoil |
| Transitions | beginWindup from idle/recover/strike, idempotent from windup; releaseStrike locks explicit kind, derives mode from charge when omitted, works from idle, clamps charge; interruptPunch from every phase clears lock; recoil impulse applies from idle |
| Wind-up poses | charge 0 = minPull only, zero twist/squash (identity scale); pull/twist/squash monotonic in charge; exact endpoints at charge 1; twist negative (right-shoulder-back convention); volume preserved (sy·sxz² ≈ 1) across samples |
| Strike snap | front-loaded (first-half travel > 1.8× second-half); fist crosses forward before the impact marker and reaches exactly full extension at strike end; punch strike < smash strike < higher-charge smash; twist uncoils during extension |
| Recoil spring | impulse kicks, clamps at maxDisp, settles < 0.01 by 2s; underdamped (overshoots then falls); zero dt advances nothing; heavyRecoilStrength scales above threshold + charge and clamps; parryRecoilStrength default + opts override |
| Trail | inactive in idle/windup, active in strike, fades in recover; strength ∈ [0,1]; head2d behind → forward for both modes; trailPath fills count, sits on the chamber arc (radius in [armLen, armLen+pullMax]); fallback allocation works |
| Full cycles | charged smash cycle ends idle with zero pose and cleared lock; tap jab (windup skipped) plays and ends clean; interrupt mid-strike zeroes pose; no NaN across a noisy multi-attack session; out object reused and mutated in place |

Also re-run: `test/hand-rig.test.js`, `test/locomotion-juice.test.js`,
`test/sim-purity.test.js`, full suite (see Gate).

---

## 4. Implementation Order

1. ✅ `src/player/punchAnim.js` — pure math (this commit)
2. ✅ `test/punch-anim.test.js` — 33 vitest tests, all passing
3. Wiring per §2 (second engineer): `Dweeb.js` → `CombatSystem.js` → `Dweeb._counter` → `Fx.js` → `main.js`
4. `npm test` → `npm run build` → gate.
5. This doc stays as the handoff record.

---

## 5. Gate Checklist

- [ ] `npm test` (npx vitest run) exits 0 — including the new 33 tests
- [ ] `npm run build` exits 0
- [ ] `/workspace/anim/gate.sh` exits 0 (test + build + smoke-shell + smoke-units)
- [ ] No new dependencies, no CDN
- [ ] `src/sim/**` untouched (purist gate passes)
- [ ] No physics/hitbox/damage/timing changes: all outputs are rig/particle-only
- [ ] No per-frame allocations (module + `makePunchPose()`/`out` reuse; `Fx._w` scratch)
- [ ] No geometry/material created (nothing to dispose) — pure math + existing pools

---

## 6. Notes for Second Engineer

- **Sign conventions** (locked by tests):
  - `pose.twist` < 0 = right shoulder back (load for a right punch). Wire
    `rig.rotation.y = pose.twist` unmodified.
  - `pose.handRetract` > 0 = fist chambered deeper along the arm; apply as
    `fist.position.y = restY - handRetract` (restY is negative, so subtracting
    moves the fist farther out along the raised arm).
  - `pose.scale` composes MULTIPLICATIVELY with the locomotion scale;
    `sy·sxz² ≈ 1` is preserved exactly.
- **Gate the old branches, don't delete them.** The old `charging`/`attackAnim`
  arm branches still serve held charges, throws, and gadgets (all of which run
  with punch idle). Punch only takes over when `pose.phase !== 'idle'` and
  `!this.held`.
- **Don't change `attackAnim`.** It still drives cooldown/feel and the legacy
  visual for non-punch attacks. Punch supplies its own arm values while active.
- **Interrupts**: `!this.canAct || this.held` covers everything
  (hitstun, ragdoll, grabbed, prone, dive, landLag, air-dodge, ledge, freeze,
  roll, hold). Do not interrupt on `attackCooldown` — `canAct` excludes it, so
  recovery/cooldown never cuts the strike short.
- **Recoil fires from idle too** (a parry can connect while you're not
  punching). The spring just flinches the fist and decays — that's expected.
- **Perf**: pass `this._punchPose` as `out` to `updatePunch` every frame; use
  `Fx._w` for the world position; `particles.emit` is pooled.
- If the body coil reads too strong on round archetypes, tune `twistMax`
  (0.5 rad ≈ 29°) or `twistPow` per type via `opts` in `_animate` — not in the
  pure module.
