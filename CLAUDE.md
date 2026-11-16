# @shieldsbetter/planet

A procedural planet on a canvas: noise terrain, clouds, atmosphere, city lights and
rings, lit and spinning. One file, no dependencies, browser or Node.

```
npm run lint            # eslint, --max-warnings 0
npm run format          # prettier --write; format:check to verify
python3 -m http.server  # then open index.html: the demo, a control for every option
```

There are no tests yet.

---

## Design goals

**One file, no dependencies, no build step.** `planet.js` is the whole library, noise
included. A consumer drops it in with a `<script>` tag, `require`s it, or imports
`planet.mjs`, and nothing else has to be fetched or compiled.

**It's a classic script, on purpose.** It attaches `Planet` (and `PlanetNoise`) to the
global and also sets `module.exports`, so a plain `<script>` works and `Planet` exists
on the very next line. The noise is inlined rather than imported for the same reason:
a classic script can't import synchronously. `planet.mjs` is a short wrapper that
imports `planet.js` for that side effect and re-exports the global. That's why the
package must never be marked `"sideEffects": false`: a bundler would be entitled to
drop the import that makes it work.

**The same code runs in the browser and Node.** `Planet.offscreen(w, h, options)`
renders with no canvas or DOM, and `exportFrame(t)` encodes PNGs itself under Node
(`zlib`) and uses `canvas.toDataURL` in a browser. ESLint gives `planet.js` both sets
of globals for this reason.

**Cheap per frame, on a phone.** All the noise is baked once into equirectangular
textures; a frame after that is a texture lookup plus cached per-pixel geometry, done
on the GPU (WebGL2) by default. The whole design follows from keeping the spinning
part nearly free.

**This directory is the whole project.** It's published to GitHub and npm as-is
(`files`: `planet.js` and `planet.mjs` only), so nothing in it may refer to a path
outside itself. The `trade` game is a consumer, not part of it.

---

## Shape of the thing

`planet.js` holds the noise (`Planet.Noise`: `mulberry32`, `createNoise3D`, `fbm`), the
texture bake, the sphere-geometry cache and the two renderers. `index.html` is the demo;
`media/` holds the README's GIFs.

**Options cost one of four amounts,** and `set()` does only what a change needs:

- **Regenerate (~600ms at `textureWidth: 768`):** `seed`, `terrain`, `continentScale`,
  `plateCount`, `warp`, `textureWidth`, `cloudAmount`, `cloudScale`, `biomeScale`,
  `cityClusters`. These re-run the noise.
- **Recolour (~10ms):** `oceanColor`, `landColor`, `seaLevel` and the like. The bake is
  split into an expensive height-field pass and a cheap colorize pass for exactly this.
- **Rebuild geometry (~40ms at 400²):** ring options other than colour.
- **Free (a redraw):** `cloudColor`, `atmosphereColor`, `ringColor`, `cityColor`,
  lighting and spin, applied while compositing.

The settlement field is skipped while `civilization` is 0, so the first move off zero
costs a full bake.

**Two renderers, one composite.** `renderer: 'webgl'` (the default) uploads the cached
geometry as float textures once per canvas size and the baked textures once per bake;
a frame is one full-screen triangle. `'software'` does the same composite in JavaScript
on a 2D canvas, and is the fallback wherever WebGL2 isn't available. They match to
within 2/255 per channel. The GPU path survives a lost context (a backgrounded mobile
tab) by re-uploading on restore.

**Two save forms.** `getConfig()` is the options alone (under 1 KB) and reproduces the
planet exactly, since generation is deterministic from the seed, but pays the bake on
load. `compile()` adds the finished textures, so `Planet.from(target, data)` shows the
planet instantly. A compiled planet carries no height field, so any option that
recolours or regenerates re-bakes from the saved options. It always works; it just
isn't free the first time.

**Most fractions are exact quantiles.** `seaLevel` is the fraction of surface under
water, chosen as an area-weighted (`cos(lat)`) quantile of the height field actually
generated, because each terrain algorithm's heights are distributed differently and a
fixed threshold would mean different things. `biomeSplit` is the same one level down:
the fraction of _land_ that's biome B, split on a separate low-frequency climate field
that's deliberately independent of elevation. Both are exact at 0 and 1.
`civilization` is the exception: quartic, not a fraction, for fine control at the
sparse end.

**Rings are the one truly 3D part.** The view ray is intersected with a tilted plane,
which gives occlusion behind the planet, the planet's shadow on the rings and the
rings' banded shadow on the planet. The planet shrinks to make room, so a ringed
planet fills the same box as an unringed one.

---

## Things that have already bitten

**The night term is not the shade term.** City lights are driven by the raw lambert
term _before_ the ring shadow is multiplied in. Deriving it from the cached `shade` is
the obvious shortcut and it's wrong: every city under the rings' shadow lights up in
broad daylight.

**The light grain has no low-frequency term, on purpose.** Where lights go is already
decided by two low-frequency fields (settlement and coverage). An earlier grain with a
blob-scale layer doubled that falloff: everything sank into a dim tail and the fine
structure sat below what reads against the night side. To debug lights, render with
`civilization: 0` and with it up, and diff the two.

**Every term in the settlement score keeps a floor above zero.** Without one, land
outside every settlement radius can never light, and `civilization: 1` can't reach a
planet-wide city.

**Ring bands are finer than a pixel once tilted.** The density profile is averaged over
each pixel's radial footprint, not point-sampled (or you get moiré), and the shadow on
the planet uses a prefiltered copy of the profile.

**`ringTilt` and `axialTilt` are separate, on purpose.** Physically a ring sits in its
planet's equatorial plane, but nothing here renders latitude (no polar caps, biomes
come from a climate field), so coupling them would only cost a control. If
latitude-banded terrain or ice caps arrive, tie them back together.

**A canvas gets one kind of context for life.** So `renderer` is fixed at
construction, and `set()` ignores it. It isn't saved by `getConfig()` or `compile()`,
because it's the device's choice, not the planet's. `Planet.offscreen` is always
software.

**A compiled planet's constructor must adopt its saved options before `set()` runs.**
Otherwise `set()` sees every non-default colour as a change and re-bakes the planet
the compile was meant to skip.

**GIF transparency is on/off, so the glow can't survive it.** The README's GIFs are
composited onto a dark background (`#0b0e14`). They were made by rendering
`Planet.offscreen(240, 240, …)` frames with `spin` and `cloudSpin` set to whole turns
per loop, so the loop is seamless, then assembling them with ffmpeg's `palettegen` and
`paletteuse`. There's no script for this in the repo.

---

## Conventions

Prettier with 4-space indent and single quotes; ESLint with the recommended rules and
`eqeqeq`, `planet.js` linted as a classic script. The library is written in ES5 style (`var`,
function expressions); keep new code consistent with it. That's style, not a runtime
target: the one exception is an optional `catch` binding (ES2019), and the WebGL2
path needs a modern browser anyway.

Comments explain _why_, especially where the code looks arbitrary: a constant that
was measured, an ordering that matters, a shortcut that's wrong.
