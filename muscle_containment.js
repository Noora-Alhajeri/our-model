// Per-frame containment for the muscle layer, using the same exact inside test as the skeleton
// (SkinField: winding number over all closed skin shells plus the lip closure, margin delta).
// 1. A cross-section (ring) with a vertex outside: if its centre is outside, the centre slides
//    toward the ring's bone anchor (a point on its own bone) just far enough to be inside; this
//    keeps consecutive rings in order. Without anchors it moves just inside the nearest skin.
// 2. The ring shrinks toward its centre until every vertex is feasible; last resort per vertex.
// 3. Surface check: the tube between two feasible rings can still cut through a thin region, so
//    the midpoint of every ring-to-ring edge is tested too. A failing segment's rings shrink; if
//    that is not enough, the ring is folded onto its neighbour (that short piece is hidden).
import { SkinField, CONTAINMENT_DEFAULTS } from './containment_projection.js';

export class MuscleContainment {
  constructor() {
    this.field = new SkinField({ ...CONTAINMENT_DEFAULTS });
    this.q = new Float64Array(3);
  }

  // positions: Float32Array (n * 3), modified in place; ring: vertices per cross-section.
  // options.anchors: Float32Array (rings * 3) world anchor per ring; options.muscles: [{vertex_start, vertex_count}].
  apply(skinPositions, skinFaces, closureFaces, positions, ring, bodyHeight, options = {}) {
    const started = typeof performance !== 'undefined' ? performance.now() : 0;
    const o = CONTAINMENT_DEFAULTS;
    const fraction = bodyHeight > 0 ? Math.min(1, Math.max(o.marginMinimumFraction, bodyHeight / o.marginReferenceHeight)) : 1;
    this.field.options.margin = o.margin * fraction;
    let faces = skinFaces;
    if (closureFaces?.length) {
      faces = new Uint32Array(skinFaces.length + closureFaces.length);
      faces.set(skinFaces); faces.set(closureFaces, skinFaces.length);
    }
    const tBuild = typeof performance !== 'undefined' ? performance.now() : 0;
    const field = this.field.build(skinPositions, faces), q = this.q, target = field.target;
    const anchors = options.anchors || null;
    const tRings = typeof performance !== 'undefined' ? performance.now() : 0;
    const rings = positions.length / 3 / ring;
    let adjusted = 0, collapsed = 0, folded = 0;
    const ok = (i) => field.feasible(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    const centre = (r) => {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < ring; k += 1) { const i = (r * ring + k) * 3; cx += positions[i] / ring; cy += positions[i + 1] / ring; cz += positions[i + 2] / ring; }
      return [cx, cy, cz];
    };
    const shift = (r, dx, dy, dz) => { for (let k = 0; k < ring; k += 1) { const i = (r * ring + k) * 3; positions[i] += dx; positions[i + 1] += dy; positions[i + 2] += dz; } };
    const shrink = (r, c, s) => {
      for (let k = 0; k < ring; k += 1) {
        const i = (r * ring + k) * 3;
        positions[i] = c[0] + s * (positions[i] - c[0]); positions[i + 1] = c[1] + s * (positions[i + 1] - c[1]); positions[i + 2] = c[2] + s * (positions[i + 2] - c[2]);
      }
    };
    // Deep rings (fast path, exact): if no skin triangle lies within R of the ring centre, where R
    // covers this ring, the next ring of the same muscle and the margin, and the centre is inside,
    // then that whole ball is inside the skin: every vertex of both rings is at least delta deep and
    // the tube between them is inside. No per-vertex test is needed for them.
    const lastOf = new Uint8Array(rings), withSegments = Boolean(options.muscles);
    for (const m of options.muscles || []) lastOf[(m.vertex_start + m.vertex_count) / ring - 1] = 1;
    const deep = new Uint8Array(rings), modified = new Uint8Array(rings);
    for (let r = 0; r < rings; r += 1) {
      const [cx, cy, cz] = centre(r), span = withSegments && !lastOf[r] ? 2 : 1;
      let R2 = 0;
      for (let k = 0; k < ring * span; k += 1) {
        const i = (r * ring + k) * 3, d = (positions[i] - cx) ** 2 + (positions[i + 1] - cy) ** 2 + (positions[i + 2] - cz) ** 2;
        if (d > R2) R2 = d;
      }
      const R = Math.sqrt(R2) + 1.05 * target;
      if (field.insideExact(cx, cy, cz) && field.bandDistance(cx, cy, cz, R, R) === Infinity) deep[r] = 1;
    }
    for (let r = 0; r < rings; r += 1) {
      if (deep[r]) continue;
      const first = r * ring;
      let all = true;
      for (let k = 0; k < ring; k += 1) if (!ok(first + k)) { all = false; break; }
      if (all) continue;
      adjusted += 1; modified[r] = 1;
      let [cx, cy, cz] = centre(r);
      if (!field.feasible(cx, cy, cz)) {
        let moved = false;
        if (anchors) {
          const ax = anchors[r * 3], ay = anchors[r * 3 + 1], az = anchors[r * 3 + 2];
          const length = Math.hypot(ax - cx, ay - cy, az - cz);
          if (length > 1e-9 && field.feasible(ax, ay, az)) {
            let lo = 0, hi = 1;  // lo infeasible, hi feasible
            for (let it = 0; it < 14; it += 1) {
              const t = (lo + hi) / 2;
              if (field.feasible(cx + t * (ax - cx), cy + t * (ay - cy), cz + t * (az - cz))) hi = t; else lo = t;
            }
            const t = Math.min(1, hi + 2 * target / length);
            const nx = cx + t * (ax - cx), ny = cy + t * (ay - cy), nz = cz + t * (az - cz);
            shift(r, nx - cx, ny - cy, nz - cz); cx = nx; cy = ny; cz = nz; moved = true;
          }
        }
        if (!moved) {
          const phi = field.nearest(cx, cy, cz, q);
          let dx = q[0] - cx, dy = q[1] - cy, dz = q[2] - cz;
          const length = Math.hypot(dx, dy, dz);
          if (Number.isFinite(phi) && length > 1e-12) {
            // side from the exact inside test (the sign of the nearest distance is unreliable at thin parts)
            if (field.insideExact(cx, cy, cz)) { dx = -dx; dy = -dy; dz = -dz; }
            const nx = q[0] + dx / length * 3 * target, ny = q[1] + dy / length * 3 * target, nz = q[2] + dz / length * 3 * target;
            shift(r, nx - cx, ny - cy, nz - cz); cx = nx; cy = ny; cz = nz;
          }
        }
      }
      for (let pass = 0; pass < 8; pass += 1) {
        let bad = false;
        for (let k = 0; k < ring; k += 1) if (!ok(first + k)) { bad = true; break; }
        if (!bad) break;
        const s = pass === 7 ? 0 : .65;
        shrink(r, [cx, cy, cz], s);
        if (s === 0) collapsed += 1;
      }
      // Last resort (thin skin): each remaining vertex moves individually just inside the nearest
      // skin, deeper on each attempt, until it passes the exact test.
      for (let k = 0; k < ring; k += 1) {
        const i = first + k;
        for (let attempt = 0; attempt < 5 && !ok(i); attempt += 1) {
          const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
          const phi = field.nearest(x, y, z, q);
          let dx = q[0] - x, dy = q[1] - y, dz = q[2] - z;
          const length = Math.hypot(dx, dy, dz);
          if (!Number.isFinite(phi) || length < 1e-12) break;
          // side from the exact inside test (the sign of the nearest distance is unreliable at thin parts)
          if (field.insideExact(x, y, z)) { dx = -dx; dy = -dy; dz = -dz; }
          const depth = (2 << attempt) * target;
          positions[i * 3] = q[0] + dx / length * depth; positions[i * 3 + 1] = q[1] + dy / length * depth; positions[i * 3 + 2] = q[2] + dz / length * depth;
        }
      }
    }
    const tSeg = typeof performance !== 'undefined' ? performance.now() : 0;
    // Surface check between consecutive rings of the same muscle.
    let segmentsFixed = 0;
    // Both triangles of each quad between ring r and r + 1 (same split as the mesh: a-b-d, a-d-c).
    const inside3 = (p, q2, s) => {
      const x = (positions[p] + positions[q2] + positions[s]) / 3, y = (positions[p + 1] + positions[q2 + 1] + positions[s + 1]) / 3, z = (positions[p + 2] + positions[q2 + 2] + positions[s + 2]) / 3;
      return field.feasible(x, y, z) || field.insideExact(x, y, z);  // fast path, then the exact test
    };
    const segmentOk = (r) => {
      for (let k = 0; k < ring; k += 1) {
        const a = (r * ring + k) * 3, b = (r * ring + (k + 1) % ring) * 3;
        const c = a + ring * 3, d = b + ring * 3;
        if (!inside3(a, b, d) || !inside3(a, d, c)) return false;
      }
      return true;
    };
    // Fix a failing segment: push both rings inward (away from their nearest skin point) and thin
    // them, so the muscle runs under the skin and keeps both attachments; only if that fails, fold
    // one ring onto its neighbour toward the nearer end of the muscle (the end stays on its bone).
    const pushRing = (r, step) => {
      const [cx, cy, cz] = centre(r), phi = field.nearest(cx, cy, cz, q);
      let dx = cx - q[0], dy = cy - q[1], dz = cz - q[2];
      const length = Math.hypot(dx, dy, dz);
      if (!Number.isFinite(phi) || length < 1e-12) return;
      if (!field.insideExact(cx, cy, cz)) { dx = -dx; dy = -dy; dz = -dz; }
      shift(r, dx / length * step, dy / length * step, dz / length * step);
    };
    const fixSegment = (r, first, last) => {
      if (segmentOk(r)) return false;
      modified[r] = 1; modified[r + 1] = 1;
      for (let pass = 0; pass < 6 && !segmentOk(r); pass += 1) {
        pushRing(r, 2 * target); pushRing(r + 1, 2 * target);
        shrink(r, centre(r), .85); shrink(r + 1, centre(r + 1), .85);
      }
      if (!segmentOk(r)) {
        const towardEnd = (r + 1 - first) > (last - r);
        const from = towardEnd ? r + 1 : r, to = towardEnd ? r : r + 1;
        for (let k = 0; k < ring * 3; k += 1) positions[to * ring * 3 + k] = positions[from * ring * 3 + k];
        folded += 1;
      }
      return true;
    };
    for (const m of options.muscles || []) {
      const first = m.vertex_start / ring, last = (m.vertex_start + m.vertex_count) / ring - 1;
      for (let r = first; r < last; r += 1) {
        if (deep[r] && !modified[r] && !modified[r + 1]) continue;
        if (fixSegment(r, first, last)) segmentsFixed += 1;
      }
    }
    // A ring changed while fixing segment r can break segment r - 1 (checked earlier): recheck the
    // segments next to modified rings and fold any that fail.
    for (let pass = 0; pass < 25; pass += 1) {   // until no segment changes
      let changed = false;
      for (const m of options.muscles || []) {
        const first = m.vertex_start / ring, last = (m.vertex_start + m.vertex_count) / ring - 1;
        for (let r = first; r < last; r += 1) {
          if (!modified[r] && !modified[r + 1]) continue;
          if (fixSegment(r, first, last)) changed = true;
        }
      }
      if (!changed) break;
    }
    let remaining = 0;
    for (let i = 0; i < positions.length / 3; i += 1) {
      const r = (i / ring) | 0;
      if (deep[r] && !modified[r]) continue;   // proven inside by the ball test
      if (!ok(i)) remaining += 1;
    }
    const ms = typeof performance !== 'undefined' ? performance.now() - started : 0;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    let deepCount = 0; for (let r = 0; r < rings; r += 1) deepCount += deep[r];
    return { rings, deep: deepCount, adjusted, collapsed, segmentsFixed, folded, remaining, ms, split: { build: tRings - tBuild, rings: tSeg - tRings, segments: now - tSeg } };
  }
}
