# Build-A-Dweeb traits & balance

Code: `src/builder/traits/` (TraitCatalog, TraitBalance, TraitBrawl, TraitBrawlMode, TraitPicker).

## Stats
26 core stats in [0,1], 0.5 = average Dweeb. Physical (speed, agility, stamina, strength,
weight, health, armor, jump, grip, friction, bounce, size), combat (reach, reaction, accuracy,
knockback, regen, throwPower), and AI personality (aggression, caution, cunning, bravery, focus,
curiosity, loyalty, showoff). Each stat has a price weight `w` (mind stats are cheap: they shape
decisions, not raw power).

## Catalog (1143 traits)
70 authored families (each a stat-delta vector + tags + an exclusivity slot) ×
tiers I–V (scale .4/.7/1/1.35/1.75; styles get Classic/Deluxe) + 59 non-style families × 14 affixes
("Reckless Sprinter", "Sneaky Wrestler"…). Trait cost = `100·pos^1.35 − refund`, where
`pos = Σ w·(positive deltas)`; drawbacks refund at most 60% of the upside. Convex, so tier V
costs far more than 2× tier II.

## Normaliser (`normalizeBuild`) — deterministic pipeline
1. **Conflicts.** Max 8 equip slots; one per exclusivity slot (mass, size, temper, tactic, style, hair…);
   forbidden tag pairs (heavy+light, heavy+fast, berserk+coward, big+small, sticky+slippery,
   fragile+armored). Earlier in the list wins; the picker puts the newest toggle first, so it replaces.
2. **Raw sum.** 0.5 + Σ trait deltas + hand-picked core points (each step ±0.06, steps −3…+5;
   raising costs `w·8·n^1.5` budget points, lowering refunds `w·3` per step). Core points and equipped
   traits share the same 100-point budget.
3. **Couplings (one pass, no feedback).** Excess above 0.5 of weight drains speed −.45, agility −.35,
   jump −.4, stamina −.15; health drains speed/agility; armor drains speed/jump/agility; size drains
   agility; strength drains stamina; bounce drains accuracy/grip. Clamp to [0,1].
4. **Budget.** If trait points > 100, every deviation from 0.5 is scaled by 100/points.
5. **Product caps (feasible region).** With `x = max(0, s−.5)/.5`: weight·speed ≤ .12,
   health·speed ≤ .15, armor·agility ≤ .15, strength·speed ≤ .2, health·regen ≤ .15. A violating pair
   is scaled by `sqrt(cap/xa·xb)`, which keeps the ratio and lands exactly on the cap curve.
   This is the "you can't be heavy, tanky and fast" rule.
6. **Power cap.** `power = (Σ w·d² for d>0 − min(Σ .25·w·|d| for d<0, 40% of upside)) / 3`,
   `d = (s−.5)/.5`. If power > 0.6, bisection finds the largest uniform shrink t so power(t) ≤ 0.6.

Steps 4–6 only shrink toward 0.5, so they never break an earlier constraint. AI rivals use
`generateBuild(seed)` — seeded, same budget, same rules.

## How traits drive the brawl AI
Every 0.18–0.5 s (faster with high reaction) each Dweeb scores ~14 options: attack, defend, flee, hide
(behind a chalkboard, on the side away from its target), flank, grab/throw toy blocks, bounce
(trampoline stomp), slide / rail (fast repositioning), smash (break the board an enemy hides behind),
regroup, taunt, rest. Each score = trait-derived weight × situation (HP, stamina, distance, threats,
whether a teammate is already on the target), plus noise that shrinks with focus. Physical stats
set the numbers (HP, move speed, acceleration, knockback resistance, windup, jump, friction slide).
Traits only affect this mode — the live 3D arena still uses the existing builder stats/DNA.

## Acquiring traits (hybrid)
- **Core stats**: hand-picked with ± in the Trait Lab, on the shared budget, through the same rules.
- **Collection**: you start with every family's tier I + Classic styles (~70). Everything else drops
  from Brawl Sim fights your own Dweebs take part in (`TraitCollection.js`). The drop table is tied to
  what happened: 3+ throws → grip/grab families, win after hiding → Ambusher/Hider/Camo, win under
  20% HP → Scrappy/Stubborn, slide/rail rides → Slide Addict/Rail Grinder, trampoline stomps → Spring
  Legs/Trampoline Kid, chalkboard smashes → Smasher/Brute, KOs → Berserker/Hunter, and so on. Rarity
  tiers: I/Classic common, II uncommon, III & combos rare, IV/Deluxe epic, V legendary; a win and more
  earned rules push the rarity roll up. Rolls are seeded (same facts + seed ⇒ same loot); unowned
  traits are preferred. Saved in `localStorage['dweebs-trait-collection-v1']`.
- **Equip**: 8 slots, picked from your collection in the searchable picker; equipped traits cost budget.
- **Randomize** rolls a legal build from your collection; **Mutation Roulette** swaps one equipped trait
  for a random legal one you own. **Sandbox** checkbox in the Trait Lab unlocks everything (no drops).
