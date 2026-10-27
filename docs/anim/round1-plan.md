# Round 1 Plan: Expressive Hands & Reach

## Overview
Add articulated squishy floating hands/paws to every Dweeb archetype with procedural reach to interactive objects. Pure math in `src/player/handRig.js`, thin wiring in `DweebModel.js` and `Dweeb.js`.

---

## 1. New Pure Module: `src/player/handRig.js`

### Exports (landed API — matches the implemented module)
```js
// Hand shape per archetype (kind: mitt | gooeyDrop | knuckles | paw | glove | suction | blob)
export const HAND_SHAPES = { cube, blob, spiky, bunny, boxer, ... };       // 26 types
export const DEFAULT_HAND_SHAPE;
export function handShapeFor(type) { ... }

// Grip data: hand-authored overrides for marquee objects, plus derivation
export const GRIP_OVERRIDES = { giantHammer, boxingGlove, freezeRay, anvil, melonCannon, magnet };
export function defaultGripPoints(def) { ... }   // shape/visualScale → { oneHand, twoHand }
export function selectGripPoints(def, mass, opts) { ... }
//   → { mode: 'one'|'two', points: [{x,y,z}...] }  (prefers def.gripPoints)

export function decideOneOrTwoHanded(mass, threshold = HEAVY_MASS) { ... }
export const HEAVY_MASS = 2.5;                 // mirrors BALANCE.carry.heavyFrom
export const ARM_LENGTHS = { upper: 0.16, forearm: 0.18 };
export function solveReach(shoulder, target, opts, out) { ... }
//   → { elbow, hand, clamped } — hand on target, clamped to max arm length
export function springStep(state, target, dt, opts) { ... }   // mutates state, no alloc
export function makeSpringState(x, y, z) { ... }
export function squashOnAccel(vel, prevVel, dt, opts) { ... }  // → { sy, sxz }
```

### Data Structures

**HAND_SHAPES** — per-archetype hand geometry params:
```js
{
  cube:    { type: 'mitt',      scale: 1.0,  squash: 0.3, fingers: 0 },
  blob:    { type: 'gooeyDrop', scale: 0.9,  squash: 0.5, wobble: 0.8 },
  spiky:   { type: 'knuckles',  scale: 1.0,  squash: 0.2, spikes: 4 },
  bunny:   { type: 'paw',       scale: 0.85, squash: 0.4, pads: true },
  boxer:   { type: 'glove',     scale: 1.2,  squash: 0.25 },
  plunger: { type: 'suction',   scale: 1.1,  squash: 0.35 },
  // ... sensible defaults for all 26 types
}
```

**GRIP_POINTS** — per-object grip data (local to object mesh):
```js
{
  freezeRay:        { oneHand: [{ x: 0.05, y: -0.1, z: 0.3 }] },
  giantHammer:      { twoHand: [{ x: -0.15, y: -0.05, z: -0.3 }, { x: 0.15, y: -0.05, z: -0.3 }] },
  boxingGlove:      { oneHand: [{ x: 0, y: 0, z: -0.25 }] },
  anvil:            { twoHand: [{ x: -0.12, y: 0.05, z: 0 }, { x: 0.12, y: 0.05, z: 0 }] },
  // ... all grabbable objects
}
```

---

## 2. Wiring Points (Thin — Second Engineer)

### `src/player/DweebModel.js`
- **Add** `buildHands(d, handShape)` called from `buildDweebModel` — creates two hand meshes (left/right) attached to arm pivots
- **Add** `animateHands(d, dt, time, reachState)` called from `animateDweebFace` — runs spring step, applies squash on accel
- **Store** on `d`: `d.hands = [{ pivot, mesh, side }, ...]`, `d.handShape`

### `src/player/Dweeb.js`
- **In `preStep`**: compute reach target from `d.held` (if object) or nearby `InteractiveObject` (if locking/near)
- **Call** `handRig.selectGripPoints`, `handRig.solveReach`, `handRig.springStep`
- **Store** result on `d.handReach = { left: { target, current, vel }, right: {...} }`
- **Pass** to `DweebModel.animateHands` in `postStep`

### `src/combat/CombatSystem.js` (already has grip logic)
- `_updateHeld` already positions kinematic objects — **add** grip-point offsets from `GRIP_POINTS`

---

## 3. Test List: `test/hand-rig.test.js` (24 tests, all landed)

| Group | Coverage |
|-------|----------|
| Purity | source scan: no three import, no DOM/window, no `Math.random()` |
| Hand shapes | all 26 `VALID_TYPES` have a shape; unknown type falls back to `DEFAULT_HAND_SHAPE` |
| One/two-hand | below threshold → `one`; at/above → `two`; custom threshold respected |
| Squash on accel | rest at constant velocity; grows with acceleration; volume preserved (sy·sxz²≈1); clamped at max |
| Grip points | every `OBJECT_DEFS` key derives grip points; overrides exist only for real registry keys; light → 1 point; heavy → 2 distinct; lone one-hand point mirrors for heavy; explicit `def.gripPoints` wins |
| Reach solve | hand lands exactly on reachable target; clamped to max arm length with `clamped` flag; direction preserved; elbow bows off the shoulder–hand line and flips with `side`; degenerate targets (same as shoulder / straight down) produce no NaN |
| Spring step | converges and settles; tracks a moving target with bounded lag (c/k·v); stable at hiccup dt; mutates/returns the same state object |

---

## 4. Implementation Order

1. **Write `src/player/handRig.js`** — pure math, no Three.js imports
2. **Write `test/hand-rig.test.js`** — vitest, covers all exports
3. **Run `npm test`** — verify tests pass
4. **Update `docs/anim/round1-plan.md`** (this file)
5. **Git commit** — gate script must pass

---

## 5. Gate Checklist

- [ ] `npm test` exits 0
- [ ] `npm run build` exits 0
- [ ] No new dependencies
- [ ] No `src/sim/**` modifications
- [ ] Pure module has zero Three.js / DOM imports
- [ ] All 26 archetypes have hand shape
- [ ] All grabbable objects have grip points

---

## 6. Notes for Second Engineer

- **Arm length**: `DweebModel.LAYOUT` has `shoulder` — use `shoulder` as the world-space origin, max reach ≈ `ARM_LENGTHS.upper + ARM_LENGTHS.forearm` = 0.34m
- **Spring params**: `stiffness = 60`, `damping = 12` defaults (override per-hold for heavier pulls)
- **Squash on accel**: feed per-hand `vel`/`prevVel` into `squashOnAccel`; apply `sy` to hand mesh scale.y and `sxz` to scale.x/z
- **Two-handed**: when `selectGripPoints(def, mass).mode === 'two'`, the returned `points` array has two entries — left hand targets `points[0]`, right hand `points[1]` (one entry → both hands share it, or the active hand only for one-handed swings)
- **Grip data**: explicit `def.gripPoints` (in ObjectRegistry) wins over `GRIP_OVERRIDES[key]`, which wins over derivation. Promote overrides into ObjectRegistry when wiring
- **Where to call**: per-frame in `Dweeb.postStep` (after `_updateHeld` has moved the object) → write `d.handReach` → read in `DweebModel.animateHands` (called from `animateDweebFace`)
- **Reach target**: world-space grip point = object mesh position + grip point rotated by the object's quaternion (use the object's `mesh.quaternion`)
- **Near/lock**: when not holding, reach toward the nearest grabbable object within ~1.2m of the facing direction (reuse CombatSystem's `focusTarget` logic for direction), or retract hands to rest when none
- **Visual only**: never modify physics body, collider, or hitboxes (hands are pure presentation)