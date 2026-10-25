# STYLE TASK — "Googly Toybox" art pass

## Role & mission
You are the art director and technical artist for DWEEBS, a three.js + Rapier party brawler.
The physics and audio are solid. The *look* is not: 25 of 30 props are bare boxes, spheres and
cylinders with one flat colour. Your job is to give the game a signature identity so that any single
screenshot reads as "DWEEBS" and not "generic low-poly demo", and so that every object *feels*
physical and alive when you hit it, throw it, or break it.

## Art direction: Googly Toybox
Source of truth: `images/*.jpg` (yellow cube dweeb, Dweeb Smash hammer, spiky blob, stadium).
1. **Faceted toy plastic.** Hard low-poly facets (flat shading) on everything, with chunky bevels and
   no thin or realistic parts. Every object looks like a toy version of itself: oversized handles, fat rims.
2. **Everything might be alive.** Googly eyes are the signature motif. Characterful props (duck, blob,
   hammer, TV, trash can, box, barrel, cone, watermelon) get googly eyes whose pupils lag and wobble
   with the object's motion (spring physics) and go dizzy or wide on big impacts.
3. **Handmade repairs.** Black gaffer-tape bands, stitched seams, sticker decals ("POW!", stars,
   hazard stripes, ☠, brand stickers like "DWEEB-O-MATIC"). These are canvas-generated textures, not image files.
4. **Colour script.** Saturated primaries on the props; the stage stays mid-value so props pop; ink
   outlines (#1b1030) everywhere; white rim highlights. No greys without a hue.

## Feel systems (objects must *react*)
- **Squash & stretch**: every prop has a jelly spring. Impacts squash it in proportion to speed and
  softness (rubber/fabric/fruit squash a lot, while metal/stone barely move), then it wobbles back. Throws stretch it.
- **Grab wiggle**: grabbing pops the object slightly (scale overshoot); held props jiggle.
- **Throw trails**: thrown props leave a tapered ribbon in the thrower's colour while `thrownTime > 0`.
- **Impact stars**: hard hits (>9 m/s) flash a comic impact-star sprite at the contact point.
- **Material-specific breakage**, with debris shape and colour taken from the object:
  wood → splinters + planks; glass → sharp shards + glints; ceramic → curved shards;
  fruit → chunky red flesh + rind + a ground splat decal; cardboard → flat flaps; metal/plastic → bolts & panels.
- **Ground decals**: splats, scorch marks (explosions) and scuffs fade over ~8s from a fixed pool.

## Object roster: each one gets a dedicated model (fit inside `visualScale`)
chair (slatted back, fat legs), table (thick top, stubby legs), crate (planks + corner brackets + stencil),
barrel (hoops, bung), explosiveBarrel (hazard stripes, ☠ sticker, nervous googly eyes, fuse cap),
brick (holes), cinderBlock (two cavities), plank (grain + nails), tire (torus with treads + hubcap),
trafficCone (stripes, square base, googly eyes), bucket (rim, handle, water inside),
shoppingCart (wire basket, handle, wheels), trashCan (lid, handles, dent, googly eyes peeking),
rock (lumpy faceted, moss), watermelon (stripes, googly eyes), beachBall (6 colour gores),
bowlingBall (finger holes), sign (post + "BONK ZONE" sticker), ladder (rails + rungs),
couch (arms, cushions, buttons), mattress (quilted tufts, stripes), flowerPot (rim, soil, flower),
box (flaps, tape, "FRAGILE" sticker, googly eyes), bottle (neck, label, cork),
giantRubberDuck (body, head, beak, wing nubs, googly eyes), tv (bezel, screen face, antennae, knobs),
lamp (base, pole, shade, bulb glow), giantHammer (reference image), spikyBall (reference image: tentacle
spikes + googly eyes), toolbox (handle, latches, wrench sticker).

## Constraints
- Do NOT change collider shapes, `dims`, masses or the physics/audio APIs. This pass is visual only.
- Share geometries and materials through caches, because props respawn constantly. Dispose only per-instance resources.
- Budget: ≤ 150 draw calls added in a busy scene, no per-frame allocations in hot loops,
  and worst frame no worse than +3 ms versus the current 18.8 ms stress test.
- Keep the toon + OutlineEffect pipeline. Decals and trails use `noOutline`.

## Acceptance
1. `npm run build` passes, with 0 console errors in the browser.
2. A screenshot "line-up" of all 30 props (dev hook) shows each one is recognisable at gameplay zoom.
3. In a live match, thrown props trail, squash on landing and show impact stars; broken props leave
   material-appropriate debris and decals.
4. Rerun the stress test (25 items spawned) and check the perf budget holds.
5. Log decisions in WHY.md.
