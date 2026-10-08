// Web Worker: muscle-layer containment (muscle_containment.js) off the main thread. The page sends a
// keyframe's skin and bone-following muscle positions; the worker returns only the rings the
// containment moved (the rest follow the bones), exactly the format of the page's muscle frame cache.
import { MuscleContainment } from './muscle_containment.js';

const containment = new MuscleContainment();
const models = new Map();

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    models.set(data.modelKey, { faces: data.faces, closure: data.closure, muscles: data.muscles, ring: data.ring });
    return;
  }
  if (data.type !== 'contain') return;
  const model = models.get(data.modelKey);
  if (!model) { self.postMessage({ id: data.id, key: data.key, modelKey: data.modelKey, error: 'Unknown muscle model' }); return; }
  try {
    const out = data.positions, carried = out.slice(), ring = model.ring;
    const stats = containment.apply(data.skin, model.faces, model.closure, out, ring, data.bodyHeight,
      { anchors: data.anchors, muscles: model.muscles });
    const changed = [];
    for (let r = 0; r < out.length / 3 / ring; r += 1) {
      for (let i = r * ring * 3; i < (r + 1) * ring * 3; i += 1) if (out[i] !== carried[i]) { changed.push(r); break; }
    }
    const positions = new Float32Array(changed.length * ring * 3);
    changed.forEach((r, n) => positions.set(out.subarray(r * ring * 3, (r + 1) * ring * 3), n * ring * 3));
    const rings = Uint32Array.from(changed);
    self.postMessage({ id: data.id, key: data.key, modelKey: data.modelKey, rings, positions, stats }, [rings.buffer, positions.buffer]);
  } catch (error) {
    self.postMessage({ id: data.id, key: data.key, modelKey: data.modelKey, error: String(error?.message || error) });
  }
};
