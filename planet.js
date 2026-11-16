// Procedural planet renderer. Single file, no dependencies.
//
// Terrain is baked once into an equirectangular texture, and per-pixel sphere
// geometry + lighting is cached whenever the canvas resizes. A frame is then
// just a texture lookup and a composite, so it stays cheap on mobile: done on
// the GPU (WebGL2) by default, or in JavaScript (`renderer: 'software'`, and
// wherever WebGL2 isn't available).
(function (global) {
  'use strict';

  // ----------------------------------------------------------------- noise
  //
  // Seeded 3D simplex noise + fBm, inlined so planet.js is a single file with
  // no load-order dependency. Reachable as Planet.Noise if you want it.
  // Classic Gustavson/Ashima port with a seeded permutation table, so the same
  // seed always yields the same planet.

  var GRAD3 = [
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
  ];

  var F3 = 1 / 3;
  var G3 = 1 / 6;

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createNoise3D(seed) {
    var rng = mulberry32(seed | 0);
    var p = new Uint8Array(256);
    var i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {
      var j = (rng() * (i + 1)) | 0;
      var tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    var perm = new Uint8Array(512);
    var permMod12 = new Uint8Array(512);
    for (i = 0; i < 512; i++) {
      perm[i] = p[i & 255];
      permMod12[i] = perm[i] % 12;
    }

    return function noise3(xin, yin, zin) {
      var n0 = 0, n1 = 0, n2 = 0, n3 = 0;

      var s = (xin + yin + zin) * F3;
      var i = Math.floor(xin + s);
      var j = Math.floor(yin + s);
      var k = Math.floor(zin + s);
      var t = (i + j + k) * G3;
      var x0 = xin - (i - t);
      var y0 = yin - (j - t);
      var z0 = zin - (k - t);

      var i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) {
        if (y0 >= z0)      { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
        else               { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
      } else {
        if (y0 < z0)       { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0)  { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else               { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      }

      var x1 = x0 - i1 + G3,     y1 = y0 - j1 + G3,     z1 = z0 - k1 + G3;
      var x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
      var x3 = x0 - 1 + 3 * G3,  y3 = y0 - 1 + 3 * G3,  z3 = z0 - 1 + 3 * G3;

      var ii = i & 255, jj = j & 255, kk = k & 255;

      var t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
      if (t0 > 0) {
        var g0 = permMod12[ii + perm[jj + perm[kk]]] * 3;
        t0 *= t0;
        n0 = t0 * t0 * (GRAD3[g0] * x0 + GRAD3[g0 + 1] * y0 + GRAD3[g0 + 2] * z0);
      }
      var t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
      if (t1 > 0) {
        var g1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
        t1 *= t1;
        n1 = t1 * t1 * (GRAD3[g1] * x1 + GRAD3[g1 + 1] * y1 + GRAD3[g1 + 2] * z1);
      }
      var t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
      if (t2 > 0) {
        var g2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
        t2 *= t2;
        n2 = t2 * t2 * (GRAD3[g2] * x2 + GRAD3[g2 + 1] * y2 + GRAD3[g2 + 2] * z2);
      }
      var t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
      if (t3 > 0) {
        var g3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
        t3 *= t3;
        n3 = t3 * t3 * (GRAD3[g3] * x3 + GRAD3[g3 + 1] * y3 + GRAD3[g3 + 2] * z3);
      }

      return 32 * (n0 + n1 + n2 + n3);
    };
  }

  // Fractal brownian motion. Returns roughly [-1, 1].
  function fbm(noise, x, y, z, octaves, lacunarity, gain) {
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  var Noise = {
    mulberry32: mulberry32,
    createNoise3D: createNoise3D,
    fbm: fbm
  };

  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------- colors

  function hexToRgb(hex) {
    var h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Everything the surface needs is derived from the two chosen colors, so the
  // caller only ever picks "ocean" and "land".
  // A biome is a full beach/base/highland ramp derived from one chosen color,
  // so both biomes shade consistently with each other and with the coast.
  function deriveLand(hex) {
    var land = hexToRgb(hex);
    return {
      beach: mix(land, [240, 226, 178], 0.55),
      base: land,
      high: mix(land, [255, 252, 238], 0.32)
    };
  }

  function derivePalette(opts) {
    var ocean = hexToRgb(opts.oceanColor);
    return {
      deep: mix(ocean, [4, 12, 30], 0.42),
      ocean: ocean,
      shallow: mix(ocean, [235, 250, 255], 0.34),
      landA: deriveLand(opts.landColor),
      landB: deriveLand(opts.landColorB),
      atmosphere: opts.atmosphereColor ? hexToRgb(opts.atmosphereColor)
                                       : mix(ocean, [255, 255, 255], 0.45),
      cloud: hexToRgb(opts.cloudColor),
      night: [10, 16, 34]
    };
  }

  // -------------------------------------------------------------- terrain

  var scratch = [0, 0, 0];

  // Single-octave domain warp. Displacing the sample point before evaluating
  // the height field is what turns blobby noise -- and dead-straight Voronoi
  // edges -- into coastlines that look eroded.
  function makeWarp(seed, freq) {
    var n = Noise.createNoise3D(seed);
    return function (x, y, z, amt, out) {
      out[0] = x + n(x * freq + 11.3, y * freq + 17.7, z * freq + 5.1) * amt;
      out[1] = y + n(x * freq - 5.9, y * freq + 3.3, z * freq - 13.7) * amt;
      out[2] = z + n(x * freq + 27.1, y * freq - 9.5, z * freq + 19.3) * amt;
    };
  }

  // Ridged multifractal: sharp crests instead of rounded lumps.
  function ridgedFbm(noise, x, y, z, octaves, lacunarity, gain) {
    var sum = 0, amp = 0.5, freq = 1, weight = 1, norm = 0;
    for (var o = 0; o < octaves; o++) {
      var n = 1 - Math.abs(noise(x * freq, y * freq, z * freq));
      n *= n;
      n *= weight;
      weight = clamp(n * 2.2, 0, 1);
      sum += n * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  // Billow: |noise| stacked, giving puffy rounded masses.
  function billowFbm(noise, x, y, z, octaves, lacunarity, gain) {
    var sum = 0, amp = 1, freq = 1, norm = 0;
    for (var o = 0; o < octaves; o++) {
      sum += amp * (2 * Math.abs(noise(x * freq, y * freq, z * freq)) - 1);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  function randomUnit(rng, out) {
    var z = rng() * 2 - 1;
    var t = rng() * TAU;
    var r = Math.sqrt(Math.max(0, 1 - z * z));
    out[0] = r * Math.cos(t);
    out[1] = r * Math.sin(t);
    out[2] = z;
    return out;
  }

  // Each entry builds a height function over the unit sphere. The absolute
  // range doesn't matter -- the waterline is chosen as a quantile of whatever
  // distribution comes out, so `seaLevel` means the same thing for all of them.
  var TERRAIN = {

    // Rounded earthlike landmasses. The safe default.
    continents: function (opts) {
      var n = Noise.createNoise3D(opts.seed);
      var warp = makeWarp(opts.seed + 8191, 1.7);
      var f = opts.continentScale, amt = opts.warp;
      return function (x, y, z) {
        warp(x, y, z, amt, scratch);
        return Noise.fbm(n, scratch[0] * f, scratch[1] * f, scratch[2] * f, 6, 2.0, 0.5);
      };
    },

    // Branching, mountainous continents with fjord-like coasts.
    ridged: function (opts) {
      var n = Noise.createNoise3D(opts.seed);
      var warp = makeWarp(opts.seed + 8191, 1.4);
      var f = opts.continentScale * 0.85, amt = opts.warp * 0.7;
      return function (x, y, z) {
        warp(x, y, z, amt, scratch);
        return ridgedFbm(n, scratch[0] * f, scratch[1] * f, scratch[2] * f, 6, 2.0, 0.5) - 0.5;
      };
    },

    // Tectonic plates. Voronoi cells over the sphere, each plate either
    // continental or oceanic, with mountain belts, arcs and trenches raised
    // along the boundaries between them.
    plates: function (opts) {
      var rng = Noise.mulberry32(opts.seed + 331);
      var count = Math.max(4, opts.plateCount | 0);
      var cx = new Float32Array(count), cy = new Float32Array(count),
          cz = new Float32Array(count), elev = new Float32Array(count);
      var tx = new Float32Array(count), ty = new Float32Array(count),
          tz = new Float32Array(count);
      var v = [0, 0, 0];
      for (var i = 0; i < count; i++) {
        randomUnit(rng, v);
        cx[i] = v[0]; cy[i] = v[1]; cz[i] = v[2];
        elev[i] = rng() < 0.45 ? 0.10 + rng() * 0.18 : -0.20 - rng() * 0.18;
        // Each plate is tilted along its own axis, so interiors aren't flat.
        randomUnit(rng, v);
        tx[i] = v[0]; ty[i] = v[1]; tz[i] = v[2];
      }
      var detail = Noise.createNoise3D(opts.seed);
      var warp = makeWarp(opts.seed + 8191, 1.15);
      var amt = 0.30 + opts.warp * 0.90;
      var f = opts.continentScale;
      return function (x, y, z) {
        warp(x, y, z, amt, scratch);
        var wx = scratch[0], wy = scratch[1], wz = scratch[2];
        var inv = 1 / Math.max(1e-6, Math.sqrt(wx * wx + wy * wy + wz * wz));
        wx *= inv; wy *= inv; wz *= inv;

        var b1 = -2, b2 = -2, i1 = 0, i2 = 0;
        for (var k = 0; k < count; k++) {
          var d = wx * cx[k] + wy * cy[k] + wz * cz[k];
          if (d > b1) { b2 = b1; i2 = i1; b1 = d; i1 = k; }
          else if (d > b2) { b2 = d; i2 = k; }
        }
        // Proximity to the boundary, as the gap between nearest and runner-up.
        var gap = Math.acos(clamp(b2, -1, 1)) - Math.acos(clamp(b1, -1, 1));

        // Blend the two plates' elevations near their shared edge. Without this
        // the elevation steps discontinuously at the boundary and every
        // coastline traces a dead-straight Voronoi edge.
        var blend = 0.5 * smoothstep(0.30, 0, gap);
        var e1 = elev[i1], e2 = elev[i2];
        var h = e1 + (e2 - e1) * blend;

        var border = smoothstep(0.16, 0, gap);
        if (e1 > 0 && e2 > 0) h += border * 0.34;         // collision: mountains
        else if (e1 > 0 || e2 > 0) h += border * 0.16 - border * 0.18 * (e1 > 0 ? 0 : 1);
        else h += border * 0.10;                          // mid-ocean ridge

        var tilt1 = wx * tx[i1] + wy * ty[i1] + wz * tz[i1];
        var tilt2 = wx * tx[i2] + wy * ty[i2] + wz * tz[i2];
        h += (tilt1 + (tilt2 - tilt1) * blend) * 0.14;
        return h + Noise.fbm(detail, x * f * 1.9, y * f * 1.9, z * f * 1.9, 5, 2.0, 0.5) * 0.44;
      };
    },

    // Scattered islands, gathered into chains by a large-scale mask so the
    // ocean still has structure rather than uniform speckle.
    archipelago: function (opts) {
      var n = Noise.createNoise3D(opts.seed);
      var m = Noise.createNoise3D(opts.seed + 4409);
      var warp = makeWarp(opts.seed + 8191, 2.4);
      var f = opts.continentScale * 2.5, amt = opts.warp * 0.5;
      return function (x, y, z) {
        warp(x, y, z, amt, scratch);
        var detail = billowFbm(n, scratch[0] * f, scratch[1] * f, scratch[2] * f, 4, 2.0, 0.50);
        // Large-scale mask, so islands gather into chains and clusters with
        // genuinely open ocean between them rather than even speckle.
        var mask = Noise.fbm(m, x * 0.80, y * 0.80, z * 0.80, 3, 2.0, 0.5);
        return detail * 0.65 + mask * 0.70;
      };
    },

    // One supercontinent on a random hemisphere, ragged at the edges.
    pangaea: function (opts) {
      var n = Noise.createNoise3D(opts.seed);
      var warp = makeWarp(opts.seed + 8191, 1.6);
      var arng = Noise.mulberry32(opts.seed + 1777);
      // Kept near the equator and near the front, so the supercontinent faces
      // the camera at rotation 0 instead of hiding over a pole or the far side.
      var alon = (arng() - 0.5) * 1.2, alat = (arng() - 0.5) * 0.9;
      var axis = [Math.cos(alat) * Math.sin(alon), Math.sin(alat), Math.cos(alat) * Math.cos(alon)];
      var f = opts.continentScale * 1.1, amt = opts.warp * 1.5;
      return function (x, y, z) {
        warp(x, y, z, amt, scratch);
        var g = scratch[0] * axis[0] + scratch[1] * axis[1] + scratch[2] * axis[2];
        return Noise.fbm(n, scratch[0] * f, scratch[1] * f, scratch[2] * f, 5, 2.0, 0.5) * 0.95
             + smoothstep(0.32, 1.0, g) * 1.25 - 0.50;
      };
    }
  };

  // Sorted sample of the height field, weighted by area: rows are sampled in
  // proportion to cos(lat), since equirect texels near the poles cover far less
  // surface than texels at the equator. Quantiles of this let every algorithm
  // share one set of ramps regardless of its raw value distribution.
  function areaSamples(heights, TW, TH) {
    var samples = [];
    for (var j = 0; j < TH; j++) {
      var lat = (0.5 - (j + 0.5) / TH) * Math.PI;
      var take = Math.round(48 * Math.cos(lat));
      for (var s = 0; s < take; s++) {
        samples.push(heights[j * TW + ((s * 2654435761 + j * 40503) % TW)]);
      }
    }
    samples.sort(function (a, b) { return a - b; });
    return samples;
  }

  // Climate values over land only, sampled by area exactly as areaSamples does.
  // Restricting to land is what makes `biomeSplit` mean "this fraction of the
  // land", independent of how much of the planet is ocean.
  function landClimateSamples(climate, heights, TW, TH, cut, allLand, allWater) {
    var samples = [];
    if (allWater) return samples;
    for (var j = 0; j < TH; j++) {
      var lat = (0.5 - (j + 0.5) / TH) * Math.PI;
      var take = Math.round(48 * Math.cos(lat));
      for (var s = 0; s < take; s++) {
        var idx = j * TW + ((s * 2654435761 + j * 40503) % TW);
        if (allLand || heights[idx] >= cut) samples.push(climate[idx]);
      }
    }
    samples.sort(function (a, b) { return a - b; });
    return samples;
  }

  // beach -> base -> highland, for one biome.
  function landRamp(biome, t, allLand) {
    // No coastline on an all-land planet, so no beach band either.
    if (!allLand && t < 0.06) return mix(biome.beach, biome.base, smoothstep(0, 0.06, t));
    return mix(biome.base, biome.high, smoothstep(0.45, 1.0, t));
  }

  function quantile(sorted, fraction) {
    if (!sorted.length) return 0;
    return sorted[clamp(Math.round(fraction * (sorted.length - 1)), 0, sorted.length - 1)];
  }

  // ------------------------------------------------------------- textures

  // Equirectangular convention: lon = atan2(x, z), lat = asin(y).
  //
  // Split in two on purpose: buildField is the expensive part (noise), and
  // colorize is cheap, so changing a color or the water level doesn't re-run
  // terrain generation.
  function buildField(opts) {
    var TW = opts.textureWidth;
    var TH = TW >> 1;
    var surface = new Uint8ClampedArray(TW * TH * 3);
    var clouds = new Uint8ClampedArray(TW * TH);
    var heights = new Float32Array(TW * TH);
    var climate = new Float32Array(TW * TH);
    var settle = new Float32Array(TW * TH);
    var grain = new Float32Array(TW * TH);
    var lights = new Uint8ClampedArray(TW * TH);

    var height = (TERRAIN[opts.terrain] || TERRAIN.continents)(opts);
    // Biome field. Deliberately independent of elevation and lower frequency
    // than the terrain, so biomes read as broad regions rather than as
    // contour bands around every highland.
    var climateNoise = Noise.createNoise3D(opts.seed + 5501);
    var bs = opts.biomeScale;

    // Settlement suitability, minus everything that depends on the waterline --
    // that's a colorize-tier decision, so the coastal and altitude terms are
    // applied later. Civilisation clusters around scattered seed points; plain
    // noise would read as speckle rather than as regions.
    var civOn = opts.civilization > 0;
    var seedCount = Math.max(1, opts.cityClusters | 0);
    var kx = new Float32Array(seedCount), ky = new Float32Array(seedCount),
        kz = new Float32Array(seedCount), kw = new Float32Array(seedCount),
        kr = new Float32Array(seedCount);
    if (civOn) {
      var crng = Noise.mulberry32(opts.seed + 7717);
      var kv = [0, 0, 0];
      for (var c = 0; c < seedCount; c++) {
        randomUnit(crng, kv);
        kx[c] = kv[0]; ky[c] = kv[1]; kz[c] = kv[2];
        kw[c] = 0.35 + crng() * 0.65;
        var rad = 0.16 + crng() * 0.26;
        kr[c] = 2 - 2 * Math.cos(rad);   // squared chord, to skip the acos
      }
    }
    var mottleNoise = Noise.createNoise3D(opts.seed + 3313);
    var grainNoise = Noise.createNoise3D(opts.seed + 6619);
    var grainNoise2 = Noise.createNoise3D(opts.seed + 1223);
    var grainNoise3 = Noise.createNoise3D(opts.seed + 4457);
    var cloudNoise = Noise.createNoise3D(opts.seed + 20261);
    var cloudCut = 0.5 - opts.cloudAmount * 0.85;
    var cs = opts.cloudScale;

    // Pass 1: height field (and clouds, which need no normalizing).
    var lo = Infinity, hi = -Infinity;
    for (var j = 0; j < TH; j++) {
      var lat = (0.5 - (j + 0.5) / TH) * Math.PI;
      var cy = Math.cos(lat), sy = Math.sin(lat);
      for (var i = 0; i < TW; i++) {
        var lon = ((i + 0.5) / TW) * TAU;
        var x = cy * Math.sin(lon), y = sy, z = cy * Math.cos(lon);
        var idx = j * TW + i;

        var h = height(x, y, z);
        heights[idx] = h;
        var cl = Noise.fbm(climateNoise, x * bs, y * bs, z * bs, 3, 2.0, 0.5);
        climate[idx] = cl;

        if (civOn) {
          var best = 0;
          for (var q = 0; q < seedCount; q++) {
            var f = 1 - (2 - 2 * (x * kx[q] + y * ky[q] + z * kz[q])) / kr[q];
            if (f > 0) {
              f = f * f * kw[q];
              if (f > best) best = f;
            }
          }
          // Regional structure at low frequency.
          var mot = smoothstep(-0.20, 0.50,
            Noise.fbm(mottleNoise, x * 9, y * 9, z * 9, 3, 2.2, 0.55));
          // Temperate middles of the climate range are the habitable ones.
          var temper = 1 - smoothstep(0.15, 0.55, Math.abs(cl));
          // Every term keeps a floor above zero. Without one, land outside the
          // settlement radii could never light however high the slider went,
          // and a planet-wide megalopolis would be unreachable.
          settle[idx] = (0.07 + 0.93 * best)
                      * (0.22 + 0.78 * mot)
                      * (0.14 + 0.86 * temper);
          // Grain, applied at the very end of the pipeline so even a fully
          // built-out planet keeps visible structure instead of glowing flat.
          // Two bands rather than one: the coarse layer shapes the blobs, the
          // fine one punches dips inside them. Octave counts are capped so the
          // finest detail stays a couple of texels wide -- push them higher and
          // the extra octaves land under the texture's Nyquist limit and turn
          // into noise instead of structure.
          // Pure texture -- deliberately NO low-frequency term here. Where the
          // lights go is already decided by `settle` and the coverage ramp;
          // multiplying in a second blob-shaped field at that same frequency
          // just doubles the falloff and buries the fine structure in a dim
          // tail, where it sits below anything visible against the night side.
          //
          // |noise| is near zero along the field's zero crossings, so this is a
          // web of thin dark veins -- unlit corridors cutting through the lit
          // area, including straight through its brightest cores.
          var gVein = smoothstep(0.04, 0.26,
            Math.abs(grainNoise3(x * 22, y * 22, z * 22)));
          var gSpeck = smoothstep(-0.30, 0.50,
            Noise.fbm(grainNoise2, x * 30, y * 30, z * 30, 2, 2.0, 0.50));
          var gFine = smoothstep(-0.35, 0.55,
            Noise.fbm(grainNoise, x * 52, y * 52, z * 52, 1, 2.0, 0.50));
          grain[idx] = (0.10 + 0.90 * gVein)
                     * (0.34 + 0.66 * gSpeck)
                     * (0.62 + 0.38 * gFine);
        }
        if (h < lo) lo = h;
        if (h > hi) hi = h;

        if (opts.cloudAmount > 0) {
          var cv = Noise.fbm(cloudNoise, x * cs, y * cs, z * cs, 5, 2.0, 0.55);
          clouds[idx] = smoothstep(cloudCut, cloudCut + 0.30, cv) * 255;
        }
      }
    }

    return {
      w: TW, h: TH,
      surface: surface, clouds: clouds, heights: heights, climate: climate,
      settle: settle, grain: grain, lights: lights, hasSettle: civOn,
      sorted: areaSamples(heights, TW, TH), lo: lo, hi: hi
    };
  }

  // Pass 2: colorize. The waterline is the `seaLevel` quantile, and the
  // depth/elevation ramps are anchored to quantiles too, so no algorithm ends
  // up with its whole ocean at one shade or its highlands off the top.
  function colorize(tex, opts, palette) {
    var TW = tex.w, TH = tex.h;
    var heights = tex.heights, surface = tex.surface;
    var lo = tex.lo, hi = tex.hi, sorted = tex.sorted;

    var sea = clamp(opts.seaLevel, 0, 1);
    // The endpoints are exact rather than "almost": 0 is every texel land, 1 is
    // every texel water, with the ramps still spanning the full height range so
    // a total ocean keeps its shallows and a total landmass keeps its relief.
    var allLand = sea <= 0, allWater = sea >= 1;
    var cut = allLand ? lo : (allWater ? hi : quantile(sorted, sea));
    var deepAt = quantile(sorted, allWater ? 0.20 : sea * 0.20);
    var highAt = quantile(sorted, allLand ? 0.90 : sea + (1 - sea) * 0.90);
    var dRange = Math.max(1e-6, cut - deepAt);
    var lRange = Math.max(1e-6, highAt - cut);

    // Biome B takes the top `biomeSplit` of the climate field over land. Both
    // endpoints are exact, like seaLevel's.
    var climate = tex.climate;
    var split = clamp(opts.biomeSplit, 0, 1);
    var noB = split <= 0, allB = split >= 1;
    var cLo = 0, cHi = 1;
    if (!noB && !allB) {
      var csorted = landClimateSamples(climate, heights, TW, TH, cut, allLand, allWater);
      if (csorted.length) {
        // A narrow band rather than a hard threshold, so the two biomes meet in
        // a soft transition instead of an aliased edge.
        cLo = quantile(csorted, clamp(1 - split - 0.02, 0, 1));
        cHi = quantile(csorted, clamp(1 - split + 0.02, 0, 1));
        if (cHi <= cLo) cHi = cLo + 1e-6;
      } else {
        noB = true;
      }
    }

    // City lights. `civilization` is deliberately not a raw coverage fraction
    // the way seaLevel and biomeSplit are -- cities are a couple of percent of
    // land at most, so a linear slider would be unusable past its first tick.
    var lights = tex.lights;
    var civ = clamp(opts.civilization, 0, 1);
    // How much of the grain's dark gaps survive. Sparse settlement is mostly
    // gaps; a fully built-out planet fills them in and keeps the grain only as
    // surface texture, so the top of the slider reads as one continuous city.
    var grainFloor = 0.02 + 0.22 * civ * civ * civ;
    var grainSpan = 1 - grainFloor;
    var suit = null, lightCut = 0, lightTop = 1;
    if (civ > 0 && !allWater) {
      var settle = tex.settle;
      suit = new Float32Array(TW * TH);
      var lit = [];
      for (var q = 0; q < TW * TH; q++) {
        var hq = heights[q];
        if (!allLand && hq < cut) continue;
        if (settle[q] <= 0) continue;
        var tq = clamp((hq - cut) / lRange, 0, 1);
        // Coastal plains first, and nobody builds on the peaks.
        suit[q] = settle[q]
                * (0.35 + 0.65 * (1 - smoothstep(0, 0.35, tq)))
                * (0.25 + 0.75 * (1 - smoothstep(0.55, 1.0, tq)));
      }
      for (var j2 = 0; j2 < TH; j2++) {
        var lat2 = (0.5 - (j2 + 0.5) / TH) * Math.PI;
        var take2 = Math.round(48 * Math.cos(lat2));
        for (var s2 = 0; s2 < take2; s2++) {
          var i2 = j2 * TW + ((s2 * 2654435761 + j2 * 40503) % TW);
          if (allLand || heights[i2] >= cut) lit.push(suit[i2]);
        }
      }
      if (lit.length) {
        lit.sort(function (a, b) { return a - b; });
        // Quartic: fine control over sparse settlement at the bottom of the
        // slider, running all the way to a planet-wide megalopolis at 1.
        var cov = Math.pow(civ, 4);
        lightCut = quantile(lit, clamp(1 - cov, 0, 1));
        lightTop = quantile(lit, clamp(1 - cov * 0.15, 0, 1));
        if (lightTop <= lightCut) lightTop = lightCut + 1e-6;
      } else {
        suit = null;
      }
    }

    for (var p = 0, n = TW * TH; p < n; p++) {
      var hv = heights[p];
      var c;
      lights[p] = (suit && suit[p] > 0)
        ? smoothstep(lightCut, lightTop, suit[p])
          * (grainFloor + grainSpan * tex.grain[p]) * 255
        : 0;
      if (allLand ? false : (allWater || hv < cut)) {
        var depth = clamp((cut - hv) / dRange, 0, 1);
        // shallow shelf -> open ocean -> abyss
        c = mix(palette.shallow, palette.ocean, smoothstep(0, 0.16, depth));
        c = mix(c, palette.deep, smoothstep(0.16, 0.80, depth));
      } else {
        var t = clamp((hv - cut) / lRange, 0, 1);
        c = landRamp(palette.landA, t, allLand);
        if (!noB) {
          var bw = allB ? 1 : smoothstep(cLo, cHi, climate[p]);
          if (bw > 0) c = mix(c, landRamp(palette.landB, t, allLand), bw);
        }
      }
      var o = p * 3;
      surface[o] = c[0];
      surface[o + 1] = c[1];
      surface[o + 2] = c[2];
    }
    return tex;
  }

  // ----------------------------------------------------------------- rings

  var RING_LUT = 512;

  // Radial density profile of the rings, as a 1D lookup over inner..outer.
  // Banded noise plus a couple of carved Cassini-style gaps.
  function buildRingLUT(opts) {
    var lut = new Float32Array(RING_LUT);
    if (!opts.rings) return lut;

    var noise = Noise.createNoise3D(opts.seed + 9137);
    var rng = Noise.mulberry32(opts.seed + 4241);
    var gaps = [];
    var gapCount = 1 + ((rng() * 2) | 0);
    for (var k = 0; k < gapCount; k++) gaps.push([0.15 + rng() * 0.70, 0.012 + rng() * 0.030]);

    var bands = Math.max(1, opts.ringBands);
    for (var i = 0; i < RING_LUT; i++) {
      var u = i / (RING_LUT - 1);
      var a = smoothstep(-0.28, 0.30, Noise.fbm(noise, u * bands, 3.7, 11.2, 4, 2.4, 0.55));
      for (var j = 0; j < gaps.length; j++) {
        var d = (u - gaps[j][0]) / gaps[j][1];
        a *= 1 - 0.95 * Math.exp(-d * d);
      }
      // Soften both edges so the ring doesn't stop on a hard line.
      a *= smoothstep(0, 0.05, u) * smoothstep(1, 0.95, u);
      lut[i] = a;
    }
    return lut;
  }

  // Ring shadows in reality are soft -- penumbra, plus the ring's own vertical
  // spread -- and a hard-edged projection of the density profile aliases badly
  // across the sphere. A prefiltered copy solves both at once.
  function blurLUT(lut, radius) {
    var out = new Float32Array(lut.length);
    for (var i = 0; i < lut.length; i++) {
      var sum = 0, count = 0;
      for (var k = -radius; k <= radius; k++) {
        var j = i + k;
        if (j < 0 || j >= lut.length) continue;
        sum += lut[j];
        count++;
      }
      out[i] = count ? sum / count : 0;
    }
    return out;
  }

  // Average the density profile over a radial footprint. Ring bands are far
  // finer than a pixel once the rings tilt away from the viewer, so a point
  // sample moirés; this is the mip-map the LUT would otherwise need.
  function sampleLUTRange(lut, u0, u1) {
    if (u1 - u0 < 1 / RING_LUT) {
      return lut[clamp((u0 * (RING_LUT - 1)) | 0, 0, RING_LUT - 1)];
    }
    var sum = 0;
    for (var k = 0; k < 8; k++) {
      var u = u0 + (u1 - u0) * ((k + 0.5) / 8);
      sum += lut[clamp((u * (RING_LUT - 1)) | 0, 0, RING_LUT - 1)];
    }
    return sum / 8;
  }

  // Radius from the planet's centre of the point where this view ray crosses
  // the ring plane.
  function ringRadiusAt(nx, ny, pole) {
    var tz = -(nx * pole[0] + ny * pole[1]) / pole[2];
    return Math.sqrt(nx * nx + ny * ny + tz * tz);
  }

  // Where the sun is, as an angle around the planet rather than a raw vector.
  // 0 deg puts it behind the camera (full day, flat), 90 deg off to one side
  // (terminator down the middle), 180 deg behind the planet (night side facing
  // us, lit only around the limb). Negative swings it the other way.
  function resolveLight(opts) {
    if (opts.lightDir) return opts.lightDir;
    var az = opts.sunAzimuth * Math.PI / 180;
    var el = opts.sunElevation * Math.PI / 180;
    var ce = Math.cos(el);
    return [-Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce];
  }

  // An orientation in view space, shared by two independent things: the
  // planet's own axis (`axialTilt`/`axialRoll`) and the ring plane
  // (`ringTilt`/`ringRoll`). `pole` is the axis -- for the rings, their plane's
  // normal -- and e1/e2 span the plane perpendicular to it.
  //
  // Tilt 0 with roll 0 is the identity: pole straight up, so an untilted planet
  // gets exactly the lon/lat it had before any of this existed, and rings at
  // tilt 0 are edge-on.
  //
  // The two are deliberately NOT locked together. Physically a ring sits in the
  // equatorial plane, so tilting it should tilt the axis too -- but nothing
  // here renders latitude (biomes come from a climate field, not bands, and
  // there are no polar caps), so the coupling would swing the whole globe
  // around for no visible gain. Set axialTilt = ringTilt to get it back.
  function orientationBasis(tiltDeg, rollDeg, avoidEdgeOn) {
    var th = clamp(tiltDeg, -90, 90) * Math.PI / 180;
    // A dead edge-on plane has no intersection to solve; hold it a hair open.
    if (avoidEdgeOn && Math.abs(th) < 0.010) th = th < 0 ? -0.010 : 0.010;
    var ph = rollDeg * Math.PI / 180;
    var st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ph), cp = Math.cos(ph);
    return {
      e1: [cp, sp, 0],
      e2: [st * sp, -st * cp, ct],
      pole: [-ct * sp, ct * cp, st],
      sin: st, cos: ct, sinRoll: sp, cosRoll: cp
    };
  }

  // ------------------------------------------------------------- geometry

  // Per-pixel sphere data that only depends on canvas size and light angle.
  function buildGeometry(W, H, opts, ringLUT) {
    var shadowLUT = blurLUT(ringLUT, 10);
    var n = W * H;
    var g = {
      W: W, H: H,
      mask: new Uint8Array(n),      // bit 1 = planet, bit 2 = cloud shell
      pu: new Float32Array(n),
      pv: new Float32Array(n),
      shade: new Float32Array(n),
      rim: new Float32Array(n),
      alpha: new Float32Array(n),
      cu: new Float32Array(n),
      cv: new Float32Array(n),
      cshade: new Float32Array(n),
      calpha: new Float32Array(n),
      glow: new Float32Array(n),
      night: new Float32Array(n),   // 1 on the night side; NOT derived from shade
      ringA: new Float32Array(n),   // ring coverage, 0 where hidden by the planet
      ringL: new Float32Array(n)    // ring brightness, including the planet's shadow
    };

    // Planet frame: what the cached lon/lat are computed in.
    var pb = orientationBasis(opts.axialTilt, opts.axialRoll, false);
    var e1 = pb.e1, e2 = pb.e2, axis = pb.pole;
    // Ring frame: independent of the planet's axis.
    var basis = orientationBasis(opts.ringTilt, opts.ringRoll, true);
    var pole = basis.pole;
    var rings = !!opts.rings;
    var rIn = Math.max(1.02, opts.ringInner);
    var rOut = Math.max(rIn + 0.02, opts.ringOuter);

    var cx = W / 2, cyc = H / 2;
    var Ra = 1 + opts.glowSize;

    // The planet has to shrink to make room for the rings. The projected ring
    // is an ellipse with semi-axes rOut and rOut*sin(tilt), rolled by ringRoll;
    // these are that ellipse's bounding half-extents.
    var ex = Ra, ey = Ra;
    if (rings) {
      var a2 = rOut * rOut;
      var b2 = rOut * basis.sin * rOut * basis.sin;
      var sp2 = basis.sinRoll * basis.sinRoll, cp2 = basis.cosRoll * basis.cosRoll;
      ex = Math.max(ex, Math.sqrt(a2 * cp2 + b2 * sp2));
      ey = Math.max(ey, Math.sqrt(a2 * sp2 + b2 * cp2));
    }
    var R = Math.min(W / (2 * ex * 1.02), H / (2 * ey * 1.02));
    var Rc = R * opts.cloudRadius;
    var Rg = R * Ra;

    var L = resolveLight(opts);
    var ll = Math.sqrt(L[0] * L[0] + L[1] * L[1] + L[2] * L[2]) || 1;
    var lx = L[0] / ll, ly = L[1] / ll, lz = L[2] / ll;
    var amb = opts.ambient;
    // How far round the back the sun is. A backlit planet's atmosphere lights
    // up all the way round the limb instead of only on the sunward side, which
    // is the whole look of a planet seen against its own star.
    var backlit = clamp(-lz, 0, 1);

    // Ring geometry constants, hoisted out of the pixel loop.
    var poleZ = pole[2];
    var poleDotL = pole[0] * lx + pole[1] * ly + pole[2] * lz;
    var ringLit = 0.50 + 0.50 * Math.abs(poleDotL);
    var ringSpan = rOut - rIn;
    // Seen near edge-on the line of sight passes through much more of the ring,
    // so thin bands read as opaque. This is that path-length term.
    var depthExp = 1 / Math.max(Math.abs(poleZ), 0.08);
    var shadowAmt = opts.ringShadow;

    for (var py = 0; py < H; py++) {
      for (var px = 0; px < W; px++) {
        var idx = py * W + px;
        var dx = px + 0.5 - cx;
        var dy = py + 0.5 - cyc;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var nx = dx / R, ny = -dy / R;
        var r2 = nx * nx + ny * ny;

        // --- planet sphere
        if (dist < R + 1) {
          var z = Math.sqrt(Math.max(0, 1 - Math.min(r2, 1)));
          var lam = nx * lx + ny * ly + z * lz;
          var diff = smoothstep(-0.22, 0.45, lam);
          var shade = amb + (1 - amb) * diff;
          // Taken from the raw lambert term, before the ring shadow is applied
          // below: a city under the rings' shadow is in daylight, not at night.
          var nightF = 1 - smoothstep(-0.15, 0.20, lam);

          // Ring shadow cast onto the surface: march from the surface point
          // toward the light and see if it crosses the ring plane inside the
          // annulus. This is the feature that sells a ringed planet.
          if (rings && shadowAmt > 0 && Math.abs(poleDotL) > 1e-4) {
            var sp = -(nx * pole[0] + ny * pole[1] + z * pole[2]) / poleDotL;
            if (sp > 0) {
              var qx = nx + sp * lx, qy = ny + sp * ly, qz = z + sp * lz;
              var qr = Math.sqrt(qx * qx + qy * qy + qz * qz);
              if (qr >= rIn && qr <= rOut) {
                var qd = shadowLUT[((qr - rIn) / ringSpan * (RING_LUT - 1)) | 0];
                shade *= 1 - qd * shadowAmt;
              }
            }
          }

          // Longitude/latitude in the planet's own (possibly tilted) frame.
          var dp = clamp(nx * axis[0] + ny * axis[1] + z * axis[2], -1, 1);
          g.mask[idx] |= 1;
          g.pu[idx] = Math.atan2(nx * e1[0] + ny * e1[1] + z * e1[2],
                                 nx * e2[0] + ny * e2[1] + z * e2[2]) / TAU;
          g.pv[idx] = 0.5 - Math.asin(dp) / Math.PI;
          g.shade[idx] = shade;
          g.rim[idx] = Math.pow(1 - z, 3.2) * (0.20 + 0.80 * diff + 0.85 * backlit)
                     * opts.rimStrength;
          g.alpha[idx] = clamp((R - dist) + 0.5, 0, 1);
          g.night[idx] = nightF;
        }

        // --- cloud shell (slightly larger sphere, same treatment)
        if (opts.cloudAmount > 0 && dist < Rc + 1) {
          var cnx = dx / Rc, cny = -dy / Rc;
          var cr2 = cnx * cnx + cny * cny;
          var cz = Math.sqrt(Math.max(0, 1 - Math.min(cr2, 1)));
          var clam = cnx * lx + cny * ly + cz * lz;
          var cdp = clamp(cnx * axis[0] + cny * axis[1] + cz * axis[2], -1, 1);

          g.mask[idx] |= 2;
          g.cu[idx] = Math.atan2(cnx * e1[0] + cny * e1[1] + cz * e1[2],
                                 cnx * e2[0] + cny * e2[1] + cz * e2[2]) / TAU;
          g.cv[idx] = 0.5 - Math.asin(cdp) / Math.PI;
          g.cshade[idx] = amb + (1 - amb) * smoothstep(-0.22, 0.45, clam);
          // Fade at the limb, where the shell is edge-on and would smear.
          g.calpha[idx] = clamp((Rc - dist) + 0.5, 0, 1) * smoothstep(0, 0.30, cz);
        }

        // --- outer glow, only outside the planet disc
        if (dist > R - 1 && dist < Rg) {
          var t = (dist - R) / Math.max(1e-6, Rg - R);
          var falloff = Math.pow(1 - clamp(t, 0, 1), 3);
          var facing = dist > 0 ? (dx / dist) * lx + (-dy / dist) * ly : 0;
          var dirTerm = 0.30 + 0.70 * smoothstep(-0.5, 0.7, facing);
          // Fade the sunward bias out as the sun goes behind: an eclipsed
          // planet rings evenly, not brightest on one edge.
          dirTerm += (1 - dirTerm) * backlit;
          g.glow[idx] = falloff * dirTerm * (1 + backlit * 0.9) * opts.glowStrength;
        }

        // --- rings
        //
        // The one genuinely 3D step in the renderer: intersect the view ray
        // (orthographic, straight down -z) with the tilted ring plane, then
        // keep the hit if it lands inside the annulus and isn't behind the
        // planet.
        if (rings) {
          var tz = -(nx * pole[0] + ny * pole[1]) / poleZ;
          var rr = Math.sqrt(r2 + tz * tz);
          if (rr >= rIn && rr <= rOut) {
            var overDisc = r2 < 1;
            // Behind the planet, which is opaque: nothing to draw.
            if (!overDisc || tz > Math.sqrt(Math.max(0, 1 - r2))) {
              // Radial footprint of this pixel, for the antialiased lookup.
              var stepPx = 1 / R;
              var fw = Math.max(Math.abs(ringRadiusAt(nx + stepPx, ny, pole) - rr),
                                Math.abs(ringRadiusAt(nx, ny + stepPx, pole) - rr));
              var dens = sampleLUTRange(ringLUT,
                                        (rr - fw * 0.5 - rIn) / ringSpan,
                                        (rr + fw * 0.5 - rIn) / ringSpan);
              if (dens > 0.001) {
                // Planet's shadow on the rings: is the point inside the
                // cylinder of radius 1 cast along the light direction?
                var proj = nx * lx + ny * ly + tz * lz;
                var lit = 1;
                if (proj < 0) {
                  var ux = nx - proj * lx, uy = ny - proj * ly, uz = tz - proj * lz;
                  lit = smoothstep(0.92, 1.06, Math.sqrt(ux * ux + uy * uy + uz * uz));
                }
                g.ringA[idx] = (1 - Math.pow(1 - dens, depthExp)) * opts.ringOpacity;
                g.ringL[idx] = ringLit * (0.15 + 0.85 * lit);
              }
            }
          }
        }
      }
    }

    return g;
  }

  // -------------------------------------------------------------- sampling

  function sampleRGB(tex, u, v, out) {
    var TW = tex.w, TH = tex.h, d = tex.surface;
    var fx = (u - Math.floor(u)) * TW - 0.5;
    var fy = clamp(v, 0, 1) * TH - 0.5;
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var tx = fx - x0, ty = fy - y0;
    var x1 = (x0 + 1) % TW; x0 = ((x0 % TW) + TW) % TW; x1 = ((x1 % TW) + TW) % TW;
    var y1 = clamp(y0 + 1, 0, TH - 1); y0 = clamp(y0, 0, TH - 1);

    var i00 = (y0 * TW + x0) * 3, i10 = (y0 * TW + x1) * 3;
    var i01 = (y1 * TW + x0) * 3, i11 = (y1 * TW + x1) * 3;
    var w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty);
    var w01 = (1 - tx) * ty, w11 = tx * ty;

    out[0] = d[i00] * w00 + d[i10] * w10 + d[i01] * w01 + d[i11] * w11;
    out[1] = d[i00 + 1] * w00 + d[i10 + 1] * w10 + d[i01 + 1] * w01 + d[i11 + 1] * w11;
    out[2] = d[i00 + 2] * w00 + d[i10 + 2] * w10 + d[i01 + 2] * w01 + d[i11 + 2] * w11;
  }

  function sampleA(tex, d, u, v) {
    var TW = tex.w, TH = tex.h;
    var fx = (u - Math.floor(u)) * TW - 0.5;
    var fy = clamp(v, 0, 1) * TH - 0.5;
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var tx = fx - x0, ty = fy - y0;
    var x1 = (x0 + 1) % TW; x0 = ((x0 % TW) + TW) % TW; x1 = ((x1 % TW) + TW) % TW;
    var y1 = clamp(y0 + 1, 0, TH - 1); y0 = clamp(y0, 0, TH - 1);

    return d[y0 * TW + x0] * (1 - tx) * (1 - ty) + d[y0 * TW + x1] * tx * (1 - ty)
         + d[y1 * TW + x0] * (1 - tx) * ty + d[y1 * TW + x1] * tx * ty;
  }

  // ---------------------------------------------------------------- planet

  var DEFAULTS = {
    seed: 1,
    oceanColor: '#1d5e86',
    landColor: '#4a8f4a',     // biome A
    landColorB: '#a8994f',    // biome B
    biomeSplit: 0,            // fraction of the land that is biome B, 0..1
    biomeScale: 1.15,         // lower = fewer, broader biome regions
    atmosphereColor: null,   // null = derived from the ocean color
    cloudColor: '#ffffff',
    terrain: 'continents',   // see TERRAIN: continents | ridged | plates | archipelago | pangaea
    seaLevel: 0.62,          // fraction of the surface under water, 0..1
    continentScale: 1.55,    // higher = more, smaller landmasses
    plateCount: 22,          // 'plates' only
    warp: 0.30,
    cloudAmount: 0.42,       // 0 disables the cloud shell entirely
    cloudOpacity: 0.75,
    cloudScale: 2.1,
    cloudRadius: 1.025,      // cloud shell radius, relative to the planet
    axialTilt: 0,            // degrees the planet's own axis leans toward the viewer
    axialRoll: 0,            // degrees the axis leans in the screen plane
    civilization: 0,         // 0..1; city lights on the night side
    cityColor: '#ffcf8a',
    cityBrightness: 0.95,
    cityClusters: 24,        // number of settlement centres scattered over the globe
    rings: false,
    ringColor: '#cbbfa8',
    ringInner: 1.35,         // planet radii
    ringOuter: 2.25,
    ringOpacity: 0.85,
    ringTilt: 18,            // degrees; 0 = edge-on, 90 = fully open
    ringRoll: -14,           // degrees of rotation in the screen plane
    ringBands: 9,            // higher = finer banding
    ringShadow: 0.60,        // how strongly the rings shadow the planet
    glowSize: 0.12,          // atmosphere halo thickness, relative to radius
    glowStrength: 0.70,
    rimStrength: 0.75,
    ambient: 0.16,
    sunAzimuth: 37.376,      // degrees; 0 = behind the camera, 180 = behind the planet
    sunElevation: 24.870,    // degrees above the view horizontal
    lightDir: null,          // set a [x, y, z] vector to override the two angles
    spin: 0.02,              // surface rotations per second; 0 for a still planet
    cloudSpin: 0.027,        // cloud rotations per second, independent of `spin`
    textureWidth: 768,
    maxResolution: 400, // render-buffer cap; the canvas is upscaled by CSS
    renderer: 'webgl'   // 'webgl' (falls back to software if unavailable) | 'software'; fixed at construction
  };

  function Planet(canvas, options, prebaked) {
    this.canvas = canvas;
    // A canvas gets one kind of context for life, so the renderer is chosen
    // here: WebGL2 if asked for and available, else the 2D software path.
    // `this.renderer` says which one it got.
    var want = (options && options.renderer) || DEFAULTS.renderer;
    this._gl = want === 'webgl' ? glCreate(canvas) : null;
    this.renderer = this._gl ? 'webgl' : 'software';
    if (this._gl) glWatchLoss(this);
    else this.ctx = canvas.getContext('2d');
    this.opts = {};
    for (var k in DEFAULTS) this.opts[k] = DEFAULTS[k];
    // Installed before set() so the constructor's build is skipped entirely --
    // with the options it was baked from already adopted, or set() would see
    // every non-default colour as a change and re-bake a compiled planet.
    if (prebaked) {
      this.tex = prebaked;
      for (k in (options || {})) if (k in DEFAULTS) this.opts[k] = options[k];
    }
    this.rotation = 0;
    this.cloudRotation = 0;
    this._raf = null;
    this._last = 0;
    this._geomKey = '';
    this._needsRender = true;
    this.set(options || {});
  }

  // Applies options; rebuilds only what actually changed.
  Planet.prototype.set = function (options) {
    // Regenerating the height field is expensive; recoloring it is not.
    var fieldKeys = ['seed', 'terrain', 'continentScale', 'plateCount', 'warp',
                     'cloudAmount', 'cloudScale', 'biomeScale', 'cityClusters',
                     'textureWidth'];
    var colorKeys = ['oceanColor', 'landColor', 'landColorB', 'seaLevel', 'biomeSplit',
                     'civilization'];
    var geomKeys = ['cloudAmount', 'cloudRadius', 'glowSize', 'glowStrength',
                    'rimStrength', 'ambient', 'lightDir', 'sunAzimuth', 'sunElevation', 'seed',
                    'axialTilt', 'axialRoll',
                    'rings', 'ringInner', 'ringOuter', 'ringOpacity', 'ringTilt',
                    'ringRoll', 'ringBands', 'ringShadow'];
    var dirtyField = !this.tex, dirtyColor = !this.tex, dirtyGeom = !this.geom, k;

    for (k in options) {
      if (!(k in DEFAULTS)) continue;
      if (this.opts[k] === options[k]) continue;
      this.opts[k] = options[k];
      if (fieldKeys.indexOf(k) >= 0) dirtyField = true;
      if (colorKeys.indexOf(k) >= 0) dirtyColor = true;
      if (geomKeys.indexOf(k) >= 0) dirtyGeom = true;
    }

    this.palette = derivePalette(this.opts);
    // The settlement field is skipped entirely when civilisation is off, so
    // the first move off zero costs one bake; dragging after that is cheap.
    if (this.opts.civilization > 0 && this.tex && !this.tex.hasSettle) dirtyField = true;
    // A compiled planet carries finished textures but no height field, so
    // anything that would recolour has to regenerate from the options first.
    // It costs the bake that compiling avoided, but it always works.
    if (dirtyColor && this.tex && this.tex.compiled) dirtyField = true;

    if (dirtyGeom || !this.ringLUT) this.ringLUT = buildRingLUT(this.opts);
    if (dirtyField) this.tex = buildField(this.opts);
    if (dirtyField || (dirtyColor && this.tex.heights)) {
      colorize(this.tex, this.opts, this.palette);
      this._texDirty = true;
    }
    if (dirtyGeom) this.geom = null;
    this._needsRender = true;
    this.resize();
    return this;
  };

  Planet.prototype.resize = function () {
    var canvas = this.canvas;
    var dpr = global.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var cssW = rect.width || canvas.clientWidth || canvas.width;
    var cssH = rect.height || canvas.clientHeight || canvas.height;
    var cap = this.opts.maxResolution;
    var scale = Math.min(dpr, cap / Math.max(cssW, cssH, 1));
    var W = Math.max(1, Math.round(cssW * scale));
    var H = Math.max(1, Math.round(cssH * scale));

    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
      this.geom = null;
    }
    var key = W + 'x' + H;
    if (!this.geom || this._geomKey !== key) {
      this.geom = buildGeometry(W, H, this.opts, this.ringLUT);
      this._geomKey = key;
      if (this._gl) this._geomDirty = true;
      else this.image = this.ctx.createImageData(W, H);
      this._needsRender = true;
    }
    return this;
  };

  Planet.prototype.render = function () {
    if (this._gl) return glRender(this);
    var g = this.geom, tex = this.tex, o = this.opts, pal = this.palette;
    var data = this.image.data;
    var n = g.W * g.H;
    var rot = this.rotation, crot = this.cloudRotation;
    var atmo = pal.atmosphere, night = pal.night, cloudCol = pal.cloud;
    var ringCol = hexToRgb(o.ringColor);
    var cityCol = hexToRgb(o.cityColor);
    var cityGain = o.cityBrightness;
    var hasCities = o.civilization > 0;
    var cloudOp = o.cloudOpacity;
    var rgb = [0, 0, 0];

    for (var i = 0; i < n; i++) {
      var m = g.mask[i];
      var glow = g.glow[i];
      var ra = g.ringA[i];
      if (!m && glow <= 0.002 && ra <= 0.002) { data[i * 4 + 3] = 0; continue; }

      // Start with the halo, which sits behind everything.
      var a = glow > 0 ? Math.min(glow, 1) : 0;
      var r = atmo[0] * a, gr = atmo[1] * a, b = atmo[2] * a;

      if (m & 1) {
        var pa = g.alpha[i];
        if (pa > 0) {
          sampleRGB(tex, g.pu[i] + rot, g.pv[i], rgb);
          var sh = g.shade[i];
          var rim = g.rim[i];
          var sr = rgb[0] * sh + night[0] * (1 - sh) * 0.35 + atmo[0] * rim;
          var sg = rgb[1] * sh + night[1] * (1 - sh) * 0.35 + atmo[1] * rim;
          var sb = rgb[2] * sh + night[2] * (1 - sh) * 0.35 + atmo[2] * rim;

          // City lights are emissive: added, not lit. Only the night side pays
          // for the extra texture fetch, and being added here rather than after
          // means the cloud layer below correctly covers them.
          var nf = g.night[i];
          if (hasCities && nf > 0.004) {
            var li = sampleA(tex, tex.lights, g.pu[i] + rot, g.pv[i]);
            if (li > 0.5) {
              var em = (li / 255) * nf * cityGain;
              sr += cityCol[0] * em;
              sg += cityCol[1] * em;
              sb += cityCol[2] * em;
            }
          }
          r = sr * pa + r * (1 - pa);
          gr = sg * pa + gr * (1 - pa);
          b = sb * pa + b * (1 - pa);
          a = pa + a * (1 - pa);
        }
      }

      if (m & 2) {
        var ca = (sampleA(tex, tex.clouds, g.cu[i] + crot, g.cv[i]) / 255) * g.calpha[i] * cloudOp;
        if (ca > 0.002) {
          var csh = g.cshade[i];
          var cr = cloudCol[0] * csh + night[0] * (1 - csh) * 0.5;
          var cg = cloudCol[1] * csh + night[1] * (1 - csh) * 0.5;
          var cb = cloudCol[2] * csh + night[2] * (1 - csh) * 0.5;
          r = cr * ca + r * (1 - ca);
          gr = cg * ca + gr * (1 - ca);
          b = cb * ca + b * (1 - ca);
          a = ca + a * (1 - ca);
        }
      }

      // Rings composite last: everything still visible here is in front of the
      // planet, since buildGeometry already dropped the occluded half.
      if (ra > 0.002) {
        var rl = g.ringL[i];
        var rgr = ringCol[0] * rl + night[0] * (1 - rl) * 0.4;
        var rgg = ringCol[1] * rl + night[1] * (1 - rl) * 0.4;
        var rgb2 = ringCol[2] * rl + night[2] * (1 - rl) * 0.4;
        r = rgr * ra + r * (1 - ra);
        gr = rgg * ra + gr * (1 - ra);
        b = rgb2 * ra + b * (1 - ra);
        a = ra + a * (1 - ra);
      }

      var p = i * 4;
      if (a > 0.0001) {
        // Un-premultiply for the canvas.
        data[p] = r / a;
        data[p + 1] = gr / a;
        data[p + 2] = b / a;
        data[p + 3] = a * 255;
      } else {
        data[p + 3] = 0;
      }
    }

    this.ctx.putImageData(this.image, 0, 0);
    this._needsRender = false;
    return this;
  };

  Planet.prototype.step = function (dt) {
    this.rotation += this.opts.spin * dt;
    this.cloudRotation += this.opts.cloudSpin * dt;
    return this;
  };

  Planet.prototype.start = function () {
    if (this._raf) return this;
    var self = this;
    var o = this.opts;
    this._last = 0;
    var loop = function (t) {
      var dt = self._last ? Math.min((t - self._last) / 1000, 0.1) : 0;
      self._last = t;
      self.step(dt);
      // A still planet only redraws when something actually changed -- but
      // clouds can drift over a planet whose surface isn't turning.
      var moving = o.spin !== 0 || (o.cloudSpin !== 0 && o.cloudAmount > 0);
      if (moving || self._needsRender) self.render();
      self._raf = global.requestAnimationFrame(loop);
    };
    this._raf = global.requestAnimationFrame(loop);
    return this;
  };

  Planet.prototype.stop = function () {
    if (this._raf) global.cancelAnimationFrame(this._raf);
    this._raf = null;
    return this;
  };

  // ----------------------------------------------------------------- webgl
  //
  // The same composite as render()'s software loop, per fragment. The cached
  // geometry goes up as four float textures (read texel-for-pixel), the baked
  // surface/clouds/lights as ordinary filtered textures, so a frame is one
  // full-screen triangle. The geometry is still built on the CPU, once per
  // canvas size, exactly as for software.

  var GL_VERT = '#version 300 es\n' +
    'void main() {\n' +
    '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n' +
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n' +
    '}\n';

  // Colours are in 0..255, as in the software path, until the very end.
  var GL_FRAG = '#version 300 es\n' +
    'precision highp float;\n' +
    'precision highp int;\n' +
    'uniform highp sampler2D uG0, uG1, uG2, uG3;\n' +   // pu pv cu cv | alpha shade rim night | calpha cshade glow ringA | ringL mask
    'uniform sampler2D uSurface, uClouds, uLights;\n' +
    'uniform float uRot, uCrot, uCloudOp, uCityGain;\n' +
    'uniform int uCities, uH;\n' +
    'uniform vec3 uAtmo, uNight, uCloud, uRing, uCity;\n' +
    'out vec4 outColor;\n' +
    'void main() {\n' +
    '  ivec2 p = ivec2(int(gl_FragCoord.x), uH - 1 - int(gl_FragCoord.y));\n' +
    '  vec4 g0 = texelFetch(uG0, p, 0), g1 = texelFetch(uG1, p, 0);\n' +
    '  vec4 g2 = texelFetch(uG2, p, 0), g3 = texelFetch(uG3, p, 0);\n' +
    '  int m = int(g3.y + 0.5);\n' +
    '  float glow = g2.z, ra = g2.w;\n' +
    '  if (m == 0 && glow <= 0.002 && ra <= 0.002) { outColor = vec4(0.0); return; }\n' +
    '  float a = glow > 0.0 ? min(glow, 1.0) : 0.0;\n' +
    '  vec3 c = uAtmo * a;\n' +
    '  if ((m & 1) != 0 && g1.x > 0.0) {\n' +
    '    float pa = g1.x, sh = g1.y, rim = g1.z, nf = g1.w;\n' +
    '    vec2 uv = vec2(g0.x + uRot, g0.y);\n' +
    '    vec3 s = texture(uSurface, uv).rgb * 255.0 * sh + uNight * (1.0 - sh) * 0.35 + uAtmo * rim;\n' +
    '    if (uCities != 0 && nf > 0.004) {\n' +
    '      float li = texture(uLights, uv).r * 255.0;\n' +
    '      if (li > 0.5) s += uCity * (li / 255.0) * nf * uCityGain;\n' +
    '    }\n' +
    '    c = s * pa + c * (1.0 - pa);\n' +
    '    a = pa + a * (1.0 - pa);\n' +
    '  }\n' +
    '  if ((m & 2) != 0) {\n' +
    '    float ca = texture(uClouds, vec2(g0.z + uCrot, g0.w)).r * g2.x * uCloudOp;\n' +
    '    if (ca > 0.002) {\n' +
    '      float csh = g2.y;\n' +
    '      c = (uCloud * csh + uNight * (1.0 - csh) * 0.5) * ca + c * (1.0 - ca);\n' +
    '      a = ca + a * (1.0 - ca);\n' +
    '    }\n' +
    '  }\n' +
    '  if (ra > 0.002) {\n' +
    '    float rl = g3.x;\n' +
    '    c = (uRing * rl + uNight * (1.0 - rl) * 0.4) * ra + c * (1.0 - ra);\n' +
    '    a = ra + a * (1.0 - ra);\n' +
    '  }\n' +
    '  if (a <= 0.0001) { outColor = vec4(0.0); return; }\n' +
    // The software path un-premultiplies into clamped bytes; the canvas
    // composites premultiplied, so clamp the same way and multiply back.
    '  a = min(a, 1.0);\n' +
    '  outColor = vec4(clamp(c / a / 255.0, 0.0, 1.0) * a, a);\n' +
    '}\n';

  // A WebGL2 context for `canvas`, with its program, or null (no WebGL2, or
  // something that isn't a real canvas).
  function glCreate(canvas) {
    var gl = null;
    try {
      gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    } catch (e) { gl = null; }
    if (!gl || typeof gl.createShader !== 'function') return null;
    return glSetup(gl);
  }

  function glSetup(gl) {
    function shader(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error('Planet: shader failed: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, GL_VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, GL_FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error('Planet: program failed: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    var u = {};
    ['uG0', 'uG1', 'uG2', 'uG3', 'uSurface', 'uClouds', 'uLights', 'uRot', 'uCrot', 'uCloudOp',
     'uCityGain', 'uCities', 'uH', 'uAtmo', 'uNight', 'uCloud', 'uRing', 'uCity'].forEach(function (k) {
      u[k] = gl.getUniformLocation(prog, k);
    });
    // Texture units: geometry 0-3, then surface, clouds, lights.
    var names = ['g0', 'g1', 'g2', 'g3', 'surface', 'clouds', 'lights'];
    var tex = {};
    names.forEach(function (k, i) {
      var t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      var geo = i < 4;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, geo ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, geo ? gl.NEAREST : gl.LINEAR);
      // Longitude wraps; latitude clamps (as sampleRGB/sampleA do).
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, geo ? gl.CLAMP_TO_EDGE : gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      tex[k] = t;
    });
    gl.uniform1i(u.uG0, 0); gl.uniform1i(u.uG1, 1); gl.uniform1i(u.uG2, 2); gl.uniform1i(u.uG3, 3);
    gl.uniform1i(u.uSurface, 4); gl.uniform1i(u.uClouds, 5); gl.uniform1i(u.uLights, 6);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    return { gl: gl, prog: prog, u: u, tex: tex };
  }

  // A mobile browser can take the context away (backgrounded, memory
  // pressure). Keep the canvas, and rebuild everything GPU-side on restore.
  function glWatchLoss(planet) {
    var canvas = planet.canvas;
    if (typeof canvas.addEventListener !== 'function') return;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
    canvas.addEventListener('webglcontextrestored', function () {
      if (!planet._gl) return;
      planet._gl = glSetup(planet._gl.gl);
      planet._geomDirty = true;
      planet._texDirty = true;
      planet._needsRender = true;
    });
  }

  function glBytes(a) {
    return a instanceof Uint8Array ? a : new Uint8Array(a.buffer, a.byteOffset, a.length);
  }

  function glUploadGeometry(s, g) {
    var gl = s.gl, n = g.W * g.H;
    var packs = [
      [g.pu, g.pv, g.cu, g.cv],
      [g.alpha, g.shade, g.rim, g.night],
      [g.calpha, g.cshade, g.glow, g.ringA],
      [g.ringL, g.mask, null, null]
    ];
    var buf = new Float32Array(n * 4);
    for (var t = 0; t < 4; t++) {
      var src = packs[t];
      for (var c = 0; c < 4; c++) {
        var arr = src[c];
        if (arr) for (var i = 0; i < n; i++) buf[i * 4 + c] = arr[i];
        else for (var j = 0; j < n; j++) buf[j * 4 + c] = 0;
      }
      gl.activeTexture(gl.TEXTURE0 + t);
      gl.bindTexture(gl.TEXTURE_2D, s.tex['g' + t]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, g.W, g.H, 0, gl.RGBA, gl.FLOAT, buf);
    }
  }

  function glUploadTextures(s, tex) {
    var gl = s.gl;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, s.tex.surface);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, tex.w, tex.h, 0, gl.RGB, gl.UNSIGNED_BYTE, glBytes(tex.surface));
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, s.tex.clouds);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, tex.w, tex.h, 0, gl.RED, gl.UNSIGNED_BYTE, glBytes(tex.clouds));
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, s.tex.lights);
    // Lights only exist with civilisation; an empty texture otherwise.
    var lights = tex.lights || new Uint8Array(tex.w * tex.h);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, tex.w, tex.h, 0, gl.RED, gl.UNSIGNED_BYTE, glBytes(lights));
  }

  function glRender(planet) {
    var s = planet._gl, gl = s.gl;
    if (gl.isContextLost()) return planet;
    var g = planet.geom, o = planet.opts, pal = planet.palette, u = s.u;
    if (planet._geomDirty) { glUploadGeometry(s, g); planet._geomDirty = false; }
    if (planet._texDirty || s.uploaded !== planet.tex) {
      glUploadTextures(s, planet.tex);
      s.uploaded = planet.tex;
      planet._texDirty = false;
    }
    gl.viewport(0, 0, g.W, g.H);
    gl.useProgram(s.prog);
    // Wrapped here, so a long-running spin doesn't lose float precision.
    gl.uniform1f(u.uRot, planet.rotation - Math.floor(planet.rotation));
    gl.uniform1f(u.uCrot, planet.cloudRotation - Math.floor(planet.cloudRotation));
    gl.uniform1f(u.uCloudOp, o.cloudOpacity);
    gl.uniform1f(u.uCityGain, o.cityBrightness);
    gl.uniform1i(u.uCities, o.civilization > 0 ? 1 : 0);
    gl.uniform1i(u.uH, g.H);
    gl.uniform3fv(u.uAtmo, pal.atmosphere);
    gl.uniform3fv(u.uNight, pal.night);
    gl.uniform3fv(u.uCloud, pal.cloud);
    gl.uniform3fv(u.uRing, hexToRgb(o.ringColor));
    gl.uniform3fv(u.uCity, hexToRgb(o.cityColor));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    planet._needsRender = false;
    return planet;
  }

  // Free the GPU side now rather than whenever the context is collected.
  function glDestroy(planet) {
    var s = planet._gl, gl = s.gl;
    for (var k in s.tex) gl.deleteTexture(s.tex[k]);
    gl.deleteProgram(s.prog);
    var lose = gl.getExtension('WEBGL_lose_context');
    if (lose && planet._owned) lose.loseContext(); // only a canvas we made
    planet._gl = null;
  }

  var SAVE_VERSION = 1;

  // ------------------------------------------------------------------- png

  var CRC_TABLE = null;

  function crc32(buf) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Int32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c;
      }
    }
    var crc = -1;
    for (var i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  }

  // Colour type 6 (RGBA), so the transparent background survives. Node only --
  // browsers have an encoder already, via canvas.toDataURL.
  function encodePNG(data, w, h) {
    var zlib = require('zlib');
    var stride = w * 4;
    var raw = Buffer.alloc((stride + 1) * h);
    for (var y = 0; y < h; y++) {
      var row = y * (stride + 1);
      raw[row] = 0;                                  // filter: none
      for (var x = 0; x < stride; x++) raw[row + 1 + x] = data[y * stride + x];
    }

    function chunk(type, body) {
      var len = Buffer.alloc(4);
      len.writeUInt32BE(body.length, 0);
      var typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
      var crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(typed), 0);
      return Buffer.concat([len, typed, crc]);
    }

    var ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // colour type: RGBA
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0))
    ]);
  }

  function isNode() {
    return typeof process !== 'undefined' && !!process.versions && !!process.versions.node
        && typeof require === 'function';
  }

  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var s = '', CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return global.btoa(s);
  }

  function base64ToBytes(str) {
    if (typeof Buffer !== 'undefined') {
      var b = Buffer.from(str, 'base64');
      return new Uint8Array(b.buffer, b.byteOffset, b.length);
    }
    var bin = global.atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Bake the planet and serialise the finished textures, so loading skips
  // generation entirely. Big -- see the README for sizes -- but a compiled
  // planet appears immediately instead of paying the noise cost on the device.
  Planet.prototype.compile = function () {
    var tex = this.tex;
    var out = this.getConfig();
    out.format = 'compiled';
    out.texture = {
      w: tex.w,
      h: tex.h,
      surface: bytesToBase64(tex.surface),
      clouds: bytesToBase64(tex.clouds),
      lights: bytesToBase64(tex.lights)
    };
    return out;
  };

  function decodeTexture(t, where) {
    if (!t || typeof t.w !== 'number' || typeof t.h !== 'number') {
      throw new Error(where + ': compiled save has no texture block');
    }
    var n = t.w * t.h;
    var surface = base64ToBytes(t.surface);
    var clouds = base64ToBytes(t.clouds);
    var lights = base64ToBytes(t.lights);
    if (surface.length !== n * 3 || clouds.length !== n || lights.length !== n) {
      throw new Error(where + ': compiled texture is the wrong size for ' +
                      t.w + 'x' + t.h + ' (corrupt or truncated)');
    }
    return {
      w: t.w, h: t.h,
      surface: new Uint8ClampedArray(surface),
      clouds: new Uint8ClampedArray(clouds),
      lights: new Uint8ClampedArray(lights),
      // No height/climate/settle fields travel with a compiled planet, so any
      // change needing a recolour has to regenerate. `hasSettle` stops the
      // civilisation check in set() from forcing that on load.
      compiled: true,
      hasSettle: true
    };
  }

  // Config only -- a few hundred bytes. Reproduces the planet exactly, since
  // generation is deterministic from the seed, but pays the bake on load.
  // Feed it back through load(), same as a compiled planet.
  Planet.prototype.getConfig = function () {
    var opts = {};
    for (var k in DEFAULTS) {
      // How it's drawn belongs to the device loading it, not to the planet.
      if (k === 'renderer') continue;
      var v = this.opts[k];
      // lightDir is an array; copy it so the save can't alias live state.
      opts[k] = (v && typeof v.slice === 'function') ? v.slice() : v;
    }
    return {
      v: SAVE_VERSION,
      options: opts,
      // Part of the look for a still planet, so part of "exact".
      rotation: this.rotation,
      cloudRotation: this.cloudRotation
    };
  };

  // So JSON.stringify(planet) works directly.
  Planet.prototype.toJSON = function () { return this.getConfig(); };

  function parseSave(data, where) {
    var d = typeof data === 'string' ? JSON.parse(data) : data;
    if (!d || typeof d !== 'object' || !d.options || typeof d.options !== 'object') {
      throw new Error(where + ': not a planet save (expected { v, options })');
    }
    if (d.v > SAVE_VERSION && global.console && global.console.warn) {
      global.console.warn(where + ': save version ' + d.v + ' is newer than this ' +
                          'build (' + SAVE_VERSION + '); unknown settings ignored.');
    }
    return d;
  }

  function applyRotation(planet, d) {
    if (typeof d.rotation === 'number') planet.rotation = d.rotation;
    if (typeof d.cloudRotation === 'number') planet.cloudRotation = d.cloudRotation;
    planet._needsRender = true;
  }

  // Restore a save onto an existing planet. Only what actually changed is
  // rebuilt, so re-loading a near-identical save is cheap.
  Planet.prototype.load = function (data) {
    var d = parseSave(data, 'Planet#load');
    if (d.texture) {
      this.tex = decodeTexture(d.texture, 'Planet#load');
      this._texDirty = true;
      // Adopt the options without letting set() decide to rebuild the field.
      for (var k in DEFAULTS) if (k in d.options) this.opts[k] = d.options[k];
      this.palette = derivePalette(this.opts);
      this.ringLUT = buildRingLUT(this.opts);
      this.geom = null;
      this.resize();
    } else {
      this.set(d.options);
    }
    applyRotation(this, d);
    if (!this._raf) this.render();
    return this;
  };

  // Mount straight from a save. Prefer this over mount()-then-load(): it builds
  // once with the saved options instead of baking defaults and rebaking.
  Planet.from = function (target, data, overrides) {
    var d = parseSave(data, 'Planet.from');
    var opts = {}, k;
    for (k in d.options) opts[k] = d.options[k];
    if (overrides) for (k in overrides) opts[k] = overrides[k];
    var planet = Planet.mount(target, opts, d.texture ? decodeTexture(d.texture, 'Planet.from') : null);
    applyRotation(planet, d);
    planet.render();
    return planet;
  };

  // The frame at `t` seconds, as PNG bytes with a transparent background.
  // Returns a Uint8Array (a Buffer under Node, which is one) -- writing it
  // somewhere is the caller's business.
  //
  // `t` is measured from the planet's zero state, not from now, so the same t
  // always gives the same frame and exportFrame(0), (1), (2) is a usable
  // sequence. Live rotation is saved and restored, so calling this on a running
  // planet doesn't disturb it.
  //
  // Output size follows the render buffer -- use Planet.offscreen, or raise
  // `maxResolution`, to export larger than the on-screen canvas.
  Planet.prototype.exportFrame = function (t) {
    t = t || 0;
    var rot = this.rotation, crot = this.cloudRotation, running = !!this._raf;

    this.rotation = this.opts.spin * t;
    this.cloudRotation = this.opts.cloudSpin * t;
    this.render();

    var bytes;
    if (isNode()) {
      bytes = encodePNG(this.image.data, this.image.width, this.image.height);
    } else {
      // Browsers ship a PNG encoder; no need to carry a second one.
      var url = this.canvas.toDataURL('image/png');
      bytes = base64ToBytes(url.slice(url.indexOf(',') + 1));
    }

    this.rotation = rot;
    this.cloudRotation = crot;
    this._needsRender = true;
    if (!running) this.render();
    return bytes;
  };

  // A planet with no DOM at all, rendering into its own buffer. This is what
  // makes exportFrame useful from a build script.
  Planet.offscreen = function (width, height, options) {
    var w = Math.max(1, width | 0);
    var h = Math.max(1, height | 0);
    var surrogate = {
      width: 0, height: 0,
      getBoundingClientRect: function () { return { width: w, height: h }; },
      getContext: function () {
        return {
          createImageData: function (cw, ch) {
            return { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) };
          },
          putImageData: function () {}
        };
      }
    };
    // Honour the size asked for rather than the on-screen default cap.
    var opts = { maxResolution: Math.max(w, h) };
    for (var k in (options || {})) opts[k] = options[k];
    opts.renderer = 'software'; // it reads pixels back from this.image
    return new Planet(surrogate, opts);
  };

  // One-call entry point: put a planet inside `target` and keep it there.
  // `target` is a CSS selector or an element -- normally a container, whose
  // canvas is created and owned here; pass a <canvas> directly and it is used
  // as-is and left in place on destroy().
  Planet.mount = function (target, options, prebaked) {
    var doc = global.document;
    var el = typeof target === 'string' ? doc.querySelector(target) : target;
    if (!el) throw new Error('Planet.mount: no element matched ' + target);

    var canvas, owned = false;
    if (el.tagName === 'CANVAS') {
      canvas = el;
    } else {
      canvas = doc.createElement('canvas');
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      // A plain <div> with no height resolves height:100% to zero and the
      // planet renders into nothing -- the classic version of this footgun.
      // If the container has no height of its own, go square off its width.
      if (el.clientHeight > 0) {
        canvas.style.height = '100%';
      } else {
        canvas.style.height = 'auto';
        canvas.style.aspectRatio = '1 / 1';
      }
      el.appendChild(canvas);
      owned = true;
    }

    var planet = new Planet(canvas, options, prebaked);
    planet._owned = owned;

    // Observe the element's own box, not the window: a flex or grid change
    // resizes the planet without the window ever changing size.
    if (global.ResizeObserver) {
      planet._ro = new global.ResizeObserver(function () { planet.resize(); });
      planet._ro.observe(owned ? el : canvas);
    } else {
      planet._onResize = function () { planet.resize(); };
      global.addEventListener('resize', planet._onResize);
    }

    if (!options || options.autoStart !== false) planet.start();
    else planet.render();
    return planet;
  };

  // Stop rendering and release everything. Safe to call twice.
  Planet.prototype.destroy = function () {
    this.stop();
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._onResize) {
      global.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    if (this._owned && this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    if (this._gl) glDestroy(this);
    this._owned = false;
    this.geom = null;
    this.tex = null;
    this.image = null;
    this.ringLUT = null;
    return this;
  };

  Planet.DEFAULTS = DEFAULTS;
  Planet.TERRAINS = Object.keys(TERRAIN);
  Planet.Noise = Noise;
  Planet.SAVE_VERSION = SAVE_VERSION;
  global.Planet = Planet;
  global.PlanetNoise = Noise;
  if (typeof module !== 'undefined' && module.exports) module.exports = Planet;
})(typeof globalThis !== 'undefined' ? globalThis
   : typeof window !== 'undefined' ? window : this);
