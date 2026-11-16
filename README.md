# Procedural Planet

A single-file, dependency-free 2D-canvas planet: 3D noise sampled on a sphere, an ocean color,
a land color, and a cloud/atmosphere shell rendered slightly larger with
transparency. Designed to sit in the middle of a mobile screen.

## Try it

Open `index.html` directly, or `python3 -m http.server` and visit it. Terrain
algorithm, color pickers, water level, cloud density, spin, and a "New planet"
button. The seed lives in the URL hash, so a planet you like is
shareable/reproducible.

## Use it

Point it at a container and you're done:

```html
<div id="world" style="width: 320px; height: 320px"></div>

<script src="planet.js"></script>
<script>
  var planet = Planet.mount('#world', { seed: 12345, landColor: '#4a8f4a' });
</script>
```

`Planet.mount(target, options)` creates the canvas inside `target`, keeps it
sized to that element, and starts rendering. `target` is a CSS selector or an
element. It returns the `Planet`, so everything below still applies.

- The canvas is **transparent**, so it composites over whatever UI is behind it.
- It tracks the container with a `ResizeObserver`, not window resizes — a flex
  or grid change resizes the planet even though the window never moved.
- If the container has **no height of its own** (a plain `<div>`, where
  `height: 100%` resolves to zero and you'd get nothing), the canvas goes square
  off its width instead.
- Pass a `<canvas>` as the target and it's used as-is, and left in place when
  you destroy.
- `autoStart: false` mounts and draws a single frame without starting a loop.

```js
planet.set({ seaLevel: 0.8 });   // change options; see the cost tiers below
planet.compile();                // bake to JSON (see below)
planet.getConfig();              // config only, no textures
planet.exportFrame(0);           // PNG bytes for the frame at t seconds
planet.stop();                   // pause the loop
planet.start();                  // resume
planet.destroy();                // stop, unhook, remove the canvas. Idempotent.
```

Call `destroy()` when the view goes away — otherwise the animation loop keeps
running for the life of the page, which in a single-page app is a leak.

Driving it yourself instead of using the loop:

```js
var planet = Planet.mount('#world', { autoStart: false });
function frame(dt) { planet.step(dt); planet.render(); }
```

`planet.resize()` exists if you ever need to force a re-measure, but `mount`
already handles it.

### Exporting frames

`exportFrame(t)` returns the frame at `t` seconds as **PNG bytes with a
transparent background** — a `Uint8Array`, or a `Buffer` under Node, which is
one. Writing it somewhere is yours to do; the library never touches a
filesystem.

```js
// browser
const bytes = planet.exportFrame(0);
const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));

// node
fs.writeFileSync('planet.png', planet.exportFrame(0));
```

Identical API either way. Under Node it encodes the PNG itself (colour type 6,
RGBA, via `zlib`); in a browser it uses the encoder already there, through
`canvas.toDataURL`. The demo's **Export PNG** button is the browser half.

`t` is measured from the planet's zero state, not from now, so the same `t`
always gives the same frame and `exportFrame(0)`, `(1)`, `(2)` is a usable
sequence — sprite sheets, or a loop of exactly one rotation at
`1 / spin` seconds. It defaults to `0`. Calling it on a running planet is safe:
rotation is saved and restored, so the animation isn't disturbed.

#### Without a DOM

`Planet.offscreen(width, height, options)` gives you a planet that renders into
its own buffer with no canvas, no container, and no document — for build
scripts and Node:

```js
const Planet = require('./planet.js');
const p = Planet.offscreen(512, 512, { seed: 404, rings: true, civilization: 0.6 });
fs.writeFileSync('planet.png', p.exportFrame(0));
```

It sets `maxResolution` to the size you asked for, so the export comes out at
that resolution rather than the on-screen default cap. For a mounted planet, the
export follows the render buffer instead — raise `maxResolution` before
exporting if you want more than the canvas is showing.

### Pre-compiling a planet

Generation costs ~600ms of noise on the device. `compile()` bakes the finished
textures into JSON so `load()` can skip it — pick a planet once at authoring
time, ship the file, and it appears immediately.

```js
// authoring: dial one in, then
require('fs').writeFileSync('planet.json', JSON.stringify(planet.compile()));

// runtime
fetch('planet.json')
  .then(function (r) { return r.json(); })
  .then(function (data) { Planet.from('#world', data); });
```

The demo's **Compile to JSON** button downloads the planet currently on screen.

`Planet.from(target, data, overrides)` mounts and loads in one step — prefer it
over `mount()` then `load()`, which would bake the defaults first and throw the
result away. `load()` also works on an existing planet, and takes either a
compiled file or a plain config save.

Measured on the default 768-wide texture, a planet with rings and cities:

| | |
| --- | --- |
| generate | 667ms |
| **load compiled** | **42ms** |
| JSON on disk | 1.88MB |
| gzipped | 0.35MB |
| brotli | 0.28MB |

Round-tripping is pixel-identical — the compiled planet renders byte-for-byte
the same as the one it came from.

**Serve it compressed.** The payload is base64'd raw texture bytes, which is
bulky in the file and shrinks by ~85% in transit; 1.88MB uncompressed is a bad
trade for 280KB gzipped. The other lever is `textureWidth`: dropping it to 384
before compiling gives 0.47MB raw / **85KB brotli**, at some softness on a large
planet.

The 42ms that remains is per-pixel geometry, which depends on your canvas size
and so can't be baked ahead.

#### What a compiled planet can and can't do

It carries finished textures but no height field, so:

- Render-time settings stay free — `cityColor`, `ringColor`, `atmosphereColor`,
  lighting, sun angle, rings, spin. All 0ms, exactly as normal.
- Anything that would recolour or regenerate — `seaLevel`, `landColor`,
  `biomeSplit`, `civilization`, `terrain`, `seed` — **regenerates from the saved
  options**, costing the ~600ms bake you'd skipped. It always works, it just
  isn't free the first time.

If you want the planet fully live, ship `getConfig()` instead: config only, 819
bytes, reproduces the planet exactly because generation is deterministic from
the seed — but pays the bake on load. Both forms go back in through `load()`.
`compile()` for a fixed planet, `getConfig()` for one the player keeps editing.
`JSON.stringify(planet)` gives you the config form too.

### Modules

`planet.js` is one file with no dependencies and nothing to load alongside it.
It's UMD: a plain `<script>` tag sets `window.Planet`, and `require` works in
Node and bundlers. For ES modules there's `planet.mjs`, which works natively in
the browser and through a bundler with no build step:

```js
import Planet from './planet.mjs';
Planet.mount('#world', { seed: 12345 });
```

The noise implementation is inlined rather than being a second file, because a
classic `<script>` can't import synchronously — anything else would mean either
a second tag to forget or an async load, where `Planet` wouldn't exist on the
line after the tag. It's still reachable as `Planet.Noise` (`mulberry32`,
`createNoise3D`, `fbm`) if you want the noise on its own.

## Terrain algorithms

Set with `terrain`. `Planet.TERRAINS` lists them at runtime.

| `terrain` | Look | Notes |
| --- | --- | --- |
| `continents` | Rounded earthlike landmasses | The default; safe for anything. |
| `ridged` | Branching, mountainous, fjord-like coasts | Ridged multifractal. More visible highlands. |
| `plates` | Large continents with mountain belts | Voronoi plates over the sphere, each continental or oceanic; boundaries raise mountain ranges, volcanic arcs, trenches and mid-ocean ridges. `plateCount` tunes the count. |
| `archipelago` | Scattered island chains | Billow noise gated by a large-scale mask, so islands cluster and the ocean stays open. Best around `seaLevel: 0.80`. |
| `pangaea` | One supercontinent | Placed near the equator on the front hemisphere, so it faces the camera at rotation 0 and swings past as the planet spins. |

All of them go through a domain warp before evaluation — displacing the sample
point is what turns blobby noise (and dead-straight Voronoi edges) into
coastlines that look eroded. `warp: 0` gives you the unwarped version of each.

Adding your own is a self-contained job: write a `height(x, y, z)` function over
the unit sphere, in any value range you like, and add it to the `TERRAIN`
registry in `planet.js`.

## Options

Only the chosen colors matter for look; every other surface shade (deep water,
coastal shelf, beach, highland, atmosphere tint) is derived from them so the
palette stays coherent whatever you pick.

| Option | Default | Notes |
| --- | --- | --- |
| `seed` | `1` | Any integer. Same seed, same planet. |
| `oceanColor` / `landColor` | `#1d5e86` / `#4a8f4a` | Hex. `landColor` is biome A. |
| `landColorB` | `'#a8994f'` | Biome B. Unused while `biomeSplit` is 0. |
| `biomeSplit` | `0` | **Fraction of the land that is biome B**, 0…1. `0.5` = half the land each. |
| `biomeScale` | `1.15` | Lower = fewer, broader biome regions. |
| `atmosphereColor` | `null` | `null` derives a pale version of the ocean. |
| `cloudColor` | `'#ffffff'` | Composited at render time, so changing it costs nothing but a redraw. |
| `terrain` | `'continents'` | See above. |
| `seaLevel` | `0.62` | **Fraction of the surface under water**, 0…1. `0` is all land, `1` is all ocean — both exact. |
| `continentScale` | `1.55` | Higher = more, smaller landmasses. |
| `plateCount` | `22` | `plates` only. |
| `warp` | `0.30` | Domain warp; 0 gives rounder, blobbier continents. |
| `cloudAmount` | `0.42` | `0` skips the cloud shell entirely. |
| `cloudOpacity` | `0.75` | |
| `cloudRadius` | `1.025` | Cloud shell size relative to the planet. |
| `glowSize` / `glowStrength` | `0.12` / `0.70` | Outer atmosphere halo. |
| `rimStrength` | `0.75` | Atmospheric brightening at the limb. |
| `ambient` | `0.16` | Night-side floor. |
| `sunAzimuth` | `37.376` | Degrees. `0` = sun behind the camera (full day, flat), `90` = terminator down the middle, `180` = behind the planet (night side facing you, lit only at the limb). Negative swings the other way. |
| `sunElevation` | `24.870` | Degrees above the view horizontal. |
| `lightDir` | `null` | Set an `[x, y, z]` vector to override the two angles. x right, y up, z toward viewer. |
| `axialTilt` | `0` | Degrees the planet's axis leans toward the viewer. Independent of the rings. |
| `axialRoll` | `0` | Degrees the axis leans in the screen plane. |
| `civilization` | `0` | 0…1. City lights on the night side. |
| `cityColor` | `'#ffcf8a'` | Composited at render time; free to change. |
| `cityBrightness` | `0.95` | |
| `cityClusters` | `24` | Settlement centres scattered over the globe. |
| `rings` | `false` | Master switch. Everything below is inert while it's off. |
| `ringColor` | `'#cbbfa8'` | Composited at render time; free to change. |
| `ringInner` / `ringOuter` | `1.35` / `2.25` | In planet radii. |
| `ringOpacity` | `0.85` | |
| `ringTilt` | `18` | Degrees. `0` = edge-on, `90` = fully open. |
| `ringRoll` | `-14` | Degrees of rotation in the screen plane. |
| `ringBands` | `9` | Higher = finer banding. |
| `ringShadow` | `0.60` | How strongly the rings shadow the planet. `0` disables. |
| `spin` | `0.02` | Surface rotations per second. `0` = still. |
| `cloudSpin` | `0.027` | Cloud rotations per second, independent of `spin`. Negative counter-rotates; clouds still drift over a planet with `spin: 0`. |
| `textureWidth` | `768` | Terrain texture; height is half. |
| `maxResolution` | `400` | Render-buffer cap in px; CSS upscales past it. |
| `renderer` | `'webgl'` | `'webgl'` composites each frame on the GPU (WebGL2); `'software'` does it in JavaScript on a 2D canvas. WebGL falls back to software where WebGL2 isn't available; `planet.renderer` says which you got. Fixed when the planet is created (a canvas only ever gets one kind of context), so `set()` ignores it. `Planet.offscreen` is always software. Not saved by `getConfig()`/`compile()`: it's the device's choice, not the planet's. |

### Biomes

`biomeSplit` works like `seaLevel`, one level down: it's the fraction of the
**land** that gets `landColorB` instead of `landColor`, and it means the same
thing at any ocean coverage — at `0.5` you get half the land each whether the
planet is 30% water or 90%.

Which land goes to which biome is decided by a separate low-frequency climate
field, baked alongside the terrain and deliberately independent of elevation, so
biomes come out as broad irregular regions rather than as contour bands around
every highland. The split point is a quantile of that field taken over land
texels only, and the two biomes meet across a narrow blend band rather than a
hard threshold. Each biome is a full beach/base/highland ramp derived from its
own color, so coastlines and highlands stay consistent across both.

Both endpoints are exact: `0` is no biome B anywhere, `1` is all of it.

### Why `seaLevel` is a fraction

Each algorithm produces a completely different distribution of height values, so
a fixed numeric threshold would mean "ocean world" for one and "desert" for the
next. Instead the waterline is chosen as a quantile of the height field that was
actually generated — sampled by area, weighted by `cos(lat)`, since equirect
texels near the poles cover far less surface than texels at the equator. The
depth and elevation ramps are anchored to quantiles the same way, so no
algorithm ends up with its whole ocean at one shade or its highlands off the
top. `seaLevel: 0.7` means 70% water whatever you pick.

The two endpoints are exact — `0` leaves no water anywhere and `1` leaves no
land — and the ramps still span the full height range at both, so a total ocean
keeps its shallows over submerged highlands and a total landmass keeps its
relief. The beach band is dropped at `0`, since there's no coastline to put it
on.

## Rings

Static, and off by default — `rings: true` turns them on, `ringTilt` sets the
angle. They're the one genuinely 3D part of the renderer: everything else is
flat discs, but a ring needs the view ray intersected with a tilted plane.

Three things fall out of doing it properly rather than drawing an ellipse:

- **Occlusion.** The half of the ring behind the planet is dropped, the half in
  front draws over it.
- **The planet's shadow on the rings** — the darkened wedge where the ring
  passes through the planet's shadow cylinder.
- **The rings' shadow on the planet** — the banded stripe across the globe.
  This is the detail that most makes a ringed planet read as one.

`ringTilt` moves only the rings. The planet's own axis is separate
(`axialTilt`/`axialRoll`, both `0` by default, i.e. upright), so dragging the
ring angle doesn't swing the globe around.

Physically these *should* be locked — a ring sits in its planet's equatorial
plane — and if you want that, set `axialTilt` equal to `ringTilt`. The reason
it isn't the default: nothing here renders latitude. Biomes come from a climate
field rather than bands, and there are no polar caps, so a tilted axis has no
visible cue to be consistent with and the coupling only costs you a usable
control. That changes the day you add latitude-banded terrain or ice caps —
then a planet whose caps sit screen-up while its rings lean 30° will look wrong,
and you'll want them tied together again.

With `rings: false` and no axial tilt the bases are the identity and output is
byte-identical to a planet without any of this.

The planet shrinks to make room for the rings, so a ringed planet occupies the
same canvas box as an unringed one.

Two antialiasing notes, both of which look wrong if skipped: ring bands are far
finer than a pixel once the rings tilt away from the viewer, so the density
profile is averaged over each pixel's radial footprint rather than point-sampled
(otherwise: moiré). And the shadow cast on the planet uses a prefiltered copy of
the profile, which both antialiases it and matches the soft edge a real ring
shadow has.

Not implemented, if you want them later: ring rotation (they're static, and
being radially symmetric they'd need azimuthal structure to show it), and
light scattering forward through the ring when backlit.

## City lights

`civilization` lights up the night side. Cities are placed by a suitability
field rather than by noise: settlement centres are scattered over the sphere and
every land texel is scored by its distance to the nearest one, then weighted
toward coastal plains (the waterline is already in hand, and land near it *is*
coastal), toward the temperate middle of the climate range, and away from peaks.
A high-frequency mottle breaks the result up so lit regions get bright cores and
dark voids instead of reading as solid blobs.

The slider is **not** a coverage fraction, unlike `seaLevel` and `biomeSplit`.
It's quartic, which buys fine control over sparse settlement at the bottom while
still running all the way to a planet-wide megalopolis at the top: roughly 0.2%
of land lit at `0.25`, 4% at `0.5`, 20% at `0.75`, and effectively all of it
at `1`.

Two things make the endpoints work. Every term in the suitability score keeps a
floor above zero — without one, land outside the settlement radii could never
light however far you pushed the slider, and the megalopolis would be
unreachable. And the grain floor *rises* with `civilization`, so sparse
settlement is mostly dark gaps while a built-out planet fills them in and keeps
the grain only as surface texture. Same field, opposite reading at the two ends
of the slider.

### Grain carries no low-frequency term, on purpose

The texture modulating the lights is three high-frequency bands only: a web of
thin dark veins (`|noise|`, near zero along the field's zero crossings, giving
unlit corridors), a medium speckle, and a fine one. There is deliberately no
blob-shaped layer in it.

An earlier version had one, and it looked wrong in a way that was hard to see:
*where* the lights go is already decided by the settlement field and the
coverage ramp, both low-frequency, so a third field at that same frequency just
doubled the falloff. Everything landed in a long dim tail, the visible cores
went solid, and all the fine structure sat below the threshold of what reads
against the night side. The texture was there the whole time — it was just too
dark to see. If you go to debug something similar, render the night side with
`civilization: 0` and again with it up, and diff the two; the emissive layer in
isolation tells you immediately whether the problem is the texture or the
tone mapping.

Lights are emissive — added, not lit — and added before the cloud layer
composites, so cloud cover correctly hides the cities under it. They rotate with
the surface, get occluded by the limb, and fade into the rim haze, all for free
from living in texture space.

Turn `ambient` down (0.05–0.08) for a darker night side and much punchier
lights. `sunAzimuth` around 120–150° gives a crescent of daylight with the lit
side sprawling across the dark.

### The night term is not the shade term

Worth knowing if you touch this code: the night factor driving the lights is
computed from the raw lambert term *before* the ring shadow is multiplied in.
Deriving it from the cached `shade` would be the obvious shortcut and it is
wrong — every city under the rings' shadow would switch its lights on in broad
daylight.

## Day and night

`sunAzimuth` swings the sun around the planet, so one slider takes you from a
fully lit disc through a terminator to a backlit night side. The old `lightDir`
vector still works as an override; the default angles reproduce it exactly.

Two things had to change for the night end to look like anything. A backlit
planet's atmosphere lights up all the way around the limb rather than brightest
on the sunward edge, so the halo's directional bias fades out as the sun goes
behind, and both halo and limb brighten with it. Without that, `sunAzimuth: 180`
was just a dark circle. The `ambient` floor is what keeps the night side
readable rather than black — turn it down for a harsher look.

## Performance

Generating a planet bakes an equirectangular terrain + cloud texture once
(~0.5s at `textureWidth: 768` for any of the algorithms — halve it for ~4×
faster, slightly softer). After
that, a frame is only a texture lookup plus cached per-pixel lighting: ~20ms at
480², well under that at the default 400 cap. A planet with `spin: 0` stops
redrawing entirely until an option changes.

That per-frame composite runs on the GPU by default (`renderer: 'webgl'`): the
cached geometry goes up as float textures once per canvas size, the baked
textures once per bake, and a frame is one full-screen triangle, so the CPU
does next to nothing while the planet spins. That matters most on a phone's
battery. Output matches the software path to within 2/255 per channel. The
GPU path survives a lost context (a backgrounded mobile tab) by re-uploading
on restore.

The bake is split into an expensive height-field pass and a cheap colorize pass,
so changing `oceanColor`, `landColor` or `seaLevel` costs ~10ms rather than a
full regeneration — dragging a color picker or the water slider stays smooth.
Only `seed`, `terrain`, `continentScale`, `plateCount`, `warp`, `textureWidth`,
`cloudAmount`, `cloudScale`, `biomeScale` and `cityClusters` re-run the noise.
`cloudColor`, `atmosphereColor`, `ringColor` and `cityColor` are applied during
compositing and cost nothing at all.

The settlement field is skipped entirely while `civilization` is 0, so the first
move off zero costs one bake (~600ms); every slider move after that is ~20ms.

Ring options other than the color rebuild the cached per-pixel geometry, ~40ms
at 400² — smooth enough to drag a slider, but it is not free the way a color
change is.

If the bake hitch matters on a target device, drop `textureWidth`, or move
`buildTextures` into a Worker — it touches nothing but typed arrays.

## Files

- `planet.js` — the whole library: noise, texture bake, sphere geometry cache,
  renderer. No dependencies.
- `planet.mjs` — ES module entry point.
- `index.html` — demo page with controls.
