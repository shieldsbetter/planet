// ES module entry point. planet.js is a classic script that attaches to the
// global; importing it here runs that and re-exports the result, so this works
// in bundlers and in a browser's native <script type="module"> with no build
// step.
import './planet.js';

const g = globalThis;
export const Planet = g.Planet;
export const PlanetNoise = g.PlanetNoise;
export default g.Planet;
