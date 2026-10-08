// Web Worker: runs the skin-containment projection off the main thread. Each worker keeps
// the previous frame's corrections of the sequence it is processing (temporal warm start).
import { ContainmentProjector } from './containment_projection.js';

const projector = new ContainmentProjector();
const models = new Map();
let last = null;

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    models.set(data.modelKey, { faces: data.faces, bones: data.bones });
    return;
  }
  if (data.type !== 'project') return;
  const model = models.get(data.modelKey);
  if (!model) {
    self.postMessage({ id: data.id, error: 'Unknown containment model' });
    return;
  }
  try {
    const bones = model.bones.map((bone, index) => ({ name: bone.name, local: bone.local,
      matrix: data.matrices.subarray(index * 16, index * 16 + 16),
      anchor: data.anchors ? Array.from(data.anchors.subarray(index * 3, index * 3 + 3)) : null }));
    const warm = last && last.modelKey === data.modelKey && last.sequence === data.sequence
      && last.frame === data.frame - 1 ? last.warm : null;
    const { corrections, displacements, warm: next, report } = projector.project(data.skin, model.faces, bones,
      { bodyHeight: data.bodyHeight, warm });
    last = { modelKey: data.modelKey, sequence: data.sequence, frame: data.frame, warm: next };
    const transfer = [];
    for (const displacement of displacements) if (displacement) transfer.push(displacement.buffer);
    self.postMessage({ id: data.id, corrections, displacements: displacements.map((d) => d && d.slice ? d : d), report }, []);
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error?.message || error) });
  }
};
