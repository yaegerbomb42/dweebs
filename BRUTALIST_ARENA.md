# Brutalist Foundry — New Brawl Arena

A brutalist concrete industrial arena for Dweebs' Knockout Arena (brawl) mode,
inspired by the reference image: massive concrete forms, rusted steel trusses,
hazard-striped edges, and "ZONE" floor markings — built in the game's stylized
three.js aesthetic (stylized brutalism, not photorealism).

## Layout

```
                    ┌─────────────────────────────────┐
                    │  UPPER PLATFORM (y=8, 8×8m)     │  ZONE 03
                    │  "sniper perch"                 │
                    └─────────────────────────────────┘
                               ▲ stairs
┌──────────────────────────────────────────────────────────┐
│ NORTH WALKWAY (y=4, 24×5m)              ZONE 01          │ ▲
│  ←→ connected to main deck via west stairs               │ │
└──────────────────────────────────────────────────────────┘ │
                                                             │
    ┌────────────────────────────────────────┐               │
    │                                        │               │
    │   MAIN DECK (y=0, 24×24m)              │               │
    │   ZONE 04 — central fight area         │               │
    │   • 4 corner pillars (cover)           │               │
    │   • 2 blast walls (partial cover)      │               │
    │   • crates, pipes, hazard-striped lip  │               │
    │                                        │               │
    └────────────────────────────────────────┘               │
                                                             │
┌──────────────────────────────────────────────────────────┐ │
│ SOUTH WALKWAY (y=4, 24×5m)              ZONE 02          │ │
│  ←→ connected to main deck via east stairs               │ ▼
└──────────────────────────────────────────────────────────┘
```

**Verticality:** Three fight levels (y=0, y=4, y=8) connected by concrete
stair flights. High ground matters — knock foes off the walkways for KOs.

**Cover:** Four 6m corner pillars and two low blast walls break sightlines
without fully enclosing the space (edges stay KO-able).

**Hazards:** Yellow/black hazard stripes line every platform lip. Rusted
trusses span overhead (visual). Crates and concrete barriers provide
destructible-feeling obstacles (static colliders).

## Design decisions

- **Stairs, not ramps:** The reference shows both; stairs are more brutalist
  and simpler to build with axis-aligned boxes. Each flight has stepped
  visuals with a single smooth rotated Rapier collider underneath, so dweebs
  glide up instead of stair-stepping.
- **Offset from stadium:** The arena builds at (0, 0, 200), far from the
  stadium (radius 16), so Rapier colliders never overlap. `Arena.setArena`
  toggles visibility between stadium and brutalist.
- **Additive only:** No existing arena behavior was modified. `Arena.js`
  gained a lazy `brutalistArena` hook in `setArena`/`getSpawnPoint`;
  everything else is new code.
- **Performance:** Geometries (unit box) and materials are shared/cached.
  ~38 static colliders, ~60 meshes — trivial for the engine.
- **Textures:** Hazard stripes and "ZONE" markings are procedural canvas
  textures. In node/test environments (no `document`) they gracefully fall
  back to solid colors.

## Files

- `src/world/BrutalistArena.js` — standalone builder class. `build()` creates
  meshes + Rapier colliders; `dispose()` removes them; `getSpawnPoint(i)`
  returns the 4 main-deck spawns. Works standalone (tests) or via Arena.
- `src/game/Arenas.js` — new `brutalist` entry (id, name "Brutalist Foundry",
  icon 🏭, standard traction/gravity, `isBrutalist: true` flag).
- `src/world/Arena.js` — minimal hooks: lazy-builds `BrutalistArena` on
  `setArena('brutalist')`, hides the stadium, delegates `getSpawnPoint`.
- `test/brutalist-arena.test.js` — 13 tests: registration, construction,
  collider coverage, spawn spread/grounding (raycast), wall avoidance.

## How to select in-game

The arena appears in the arena picker automatically (it's in `ARENAS`).
Pick **🏭 Brutalist Foundry** from the arena select screen, or set
`settings.arena = 'brutalist'` programmatically — `arena.setArena('brutalist')`
handles the rest.

## Tests

```
npx vitest run test/brutalist-arena.test.js   # 13 passed
npx vitest run test/arena-wave2.test.js test/arena-wave3.test.js test/drops.test.js  # 83 passed
```

ESLint: clean on new files (Arena.js has 3 pre-existing `no-undef` errors
unrelated to this change).
