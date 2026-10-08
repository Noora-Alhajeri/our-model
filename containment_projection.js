// Hard skin-containment projection for rigid anatomy meshes.
//
// For the displayed frame, every anatomy vertex x must satisfy phi_S(x) <= -delta,
// where phi_S is the signed distance to the closed skin surface S (negative inside).
// Bones that violate the constraint receive the smallest correction found in the order
//   1. rigid translation along the mean inward skin direction (bounded),
//   2. anisotropic segment scaling A_b = R_b diag(s_par, s_w, s_d) R_b^T about an
//      interior anchor, width/depth first and length coupled weakly,
//   3. uniform scaling about an interior anchor, which is guaranteed feasible:
//      if phi_S(c) = -D with D > delta, every point within D - delta of c satisfies
//      the constraint, so s <= (D - delta) / max|x - c| is always admissible.
// Every accepted correction is re-verified vertex by vertex with the exact test below.
//
// Exact test: the distance part uses closest points on all skin triangles whose
// bounding boxes reach the query neighbourhood (grid cell > delta, so nothing within
// delta is missed). The sign uses the ray winding number along +z against the closed, oriented skin
// (signed crossings, so self-overlapping skin counts as inside), either at
// the exact query (x, y) or, when the nearest surface is farther than the column
// half-diagonal, at the nearest precomputed column (no surface can lie in between).

// Bones fitted jointly before per-bone corrections, so articulated parts keep their relation.
export const CONTAINMENT_GROUPS = Object.freeze([Object.freeze(['skull', 'jaw'])]);

export const CONTAINMENT_DEFAULTS = Object.freeze({
  margin: 0.001,              // delta_b at the reference body height, metres
  marginReferenceHeight: 1.7, // delta_b scales with rest body height, clamped below
  marginMinimumFraction: 0.35,
  marginSafety: 0.02,         // solver targets delta (1 + safety) so float32 output keeps delta
  cell: 0.006,                // 3D triangle grid, must exceed twice the margin
  column: 0.0015,             // xy parity column spacing (band radius = half-diagonal)
  parityBucket: 0.004,        // xy buckets for exact parity
  maxTranslation: 0.03,       // metres
  translationFraction: 0.35,  // of the bone's largest extent
  axialCoupling: 0.35,        // s_par = 1 - k (1 - s_w)
  minAnisotropic: 0.5,
  bisectionSteps: 9,
  nearestRadius: 0.15,
  groups: CONTAINMENT_GROUPS,
  groupMinScale: 0.7,
  groupMaxTranslationFraction: 0.25,
  deformBelowVolume: 0.85,    // prefer local deformation when scaling keeps less volume
  maxDeformationFraction: 0.35,
  deformOverCapBelowVolume: 0.3,
  deformSigmaMin: 0.004,
  deformSigmaFraction: 0.12,
  deformIterations: 25,
  // Connectivity: articular vertices lie within this distance of another bone (scaled like the
  // margin). Candidates that move them more than the tolerance are compared with a deformation
  // that pins them; the correction with the smaller articular displacement is kept.
  connectivityRadius: 0.006,
  connectivityTolerance: 0.002,
  connectivityPin: 0.9,
});

function closestPointTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz;
      } else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
              qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz);
            } else {
              const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
              qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  if (out) { out[0] = qx; out[1] = qy; out[2] = qz; }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

// Sub-micron fixed offsets keep parity rays off mesh vertices and edges (exact ties).
const RAY_DX = 1.3719e-7, RAY_DY = 2.2531e-7, COLUMN_PHASE_X = 0.3183, COLUMN_PHASE_Y = 0.5772;

// Lips-closed envelope for the shared Anny skin topology: a closed, outward-oriented shell over
// existing skin vertices (convex hull, in the neutral pose, of the mouth-pocket walls and the oral
// shell). It adds only the enclosed oral cavity (ray escape <= 1.6 percent at sampled cavity
// points), never open air. Applied only when the skin topology fingerprint matches.
const ORAL_CLOSURE = Object.freeze({ facesCount: 82260, check: [4832, 0, 1, 1, 4831, 4832, 4, 2, 5, 5, 2, 3, 4833, 4832, 2, 2, 7, 4833, 7, 2, 4, 4, 8, 7, 10, 7, 8, 8, 11, 10, 4834, 4833, 7, 7, 10, 4834, 13, 10, 11, 11, 14, 13, 4835, 4834, 10, 10, 13, 4835, 16, 13, 14, 14, 17, 16, 4836, 4835, 13, 13, 16, 4836, 19, 16, 17, 17, 20, 19, 4837, 4836, 16, 16, 19, 4837, 22, 19, 20, 20, 23, 22, 4838, 4837, 19, 19, 22, 4838, 25, 22, 26, 26, 22, 23, 4839, 4838, 25, 25, 4838, 22, 28, 25, 29, 29, 25, 26, 4840, 4839, 28, 28, 4839, 25, 5061, 28, 5060, 5060, 28, 29, 5111, 4840, 5061, 5061, 4840, 28, 37, 34, 38, 38, 34, 35, 4843, 4842, 37, 37, 4842, 34, 4846, 4845, 43, 43, 46, 4846, 46, 43, 45, 45, 43, 42, 4847, 4846, 46, 46, 49, 4847, 49, 46, 48, 48, 46, 45, 5112, 4847, 49, 49, 5063, 5112, 5063, 49, 48, 48, 5065, 5063, 4849, 4831, 54, 54, 4831, 1, 56, 5, 3, 3, 55, 56, 59, 56, 55, 55, 58, 59, 4850, 4849, 54, 54, 57, 4850],
  faces: new Uint32Array([3700, 629, 3701, 3700, 3701, 665, 10353, 7330, 7346, 611, 3701, 629, 611, 13389, 3701, 13376, 13377, 671, 13376, 671, 3701, 13376, 3701, 13377, 672, 3701, 671, 672, 665, 3701, 3699, 629, 3700, 13489, 7330, 10353, 13362, 13377, 13477, 13362, 671, 13377, 13476, 13477, 10353, 10352, 10353, 7346, 10352, 7346, 10351, 473, 472, 493, 473, 573, 472, 470, 472, 573, 666, 3700, 665, 666, 665, 672, 615, 598, 597, 648, 672, 631, 648, 631, 3699, 648, 666, 672, 648, 3699, 3700, 648, 3700, 666, 13481, 10353, 13477, 13481, 13489, 10353, 7363, 7348, 7385, 7363, 10351, 7348, 7363, 10352, 10351, 7378, 7385, 10353, 7378, 10353, 10352, 7210, 11932, 7297, 7210, 7297, 7212, 7213, 493, 7212, 7213, 7212, 7297, 7338, 625, 642, 7333, 7348, 10351, 7333, 7334, 7385, 7333, 7385, 7348, 471, 472, 470, 469, 503, 476, 676, 672, 671, 676, 615, 672, 676, 7385, 7334, 676, 7334, 7338, 676, 7338, 642, 614, 3699, 631, 614, 615, 597, 614, 631, 672, 614, 672, 615, 3689, 598, 503, 619, 642, 625, 619, 598, 615, 619, 676, 642, 619, 615, 676, 501, 597, 598, 501, 598, 3689, 501, 3689, 503, 612, 629, 3699, 612, 611, 629, 612, 501, 500, 612, 500, 611, 13563, 13489, 13481, 13381, 13377, 3701, 13381, 3701, 13389, 7379, 7363, 7385, 7379, 10352, 7363, 7379, 7385, 7378, 7379, 7378, 10352, 7211, 7210, 7212, 474, 493, 7213, 474, 7213, 7297, 474, 7297, 573, 474, 473, 493, 474, 573, 473, 7226, 11932, 7210, 7226, 493, 591, 7226, 7210, 7211, 7226, 7212, 493, 7226, 7211, 7212, 487, 591, 493, 487, 471, 470, 487, 493, 472, 487, 472, 471, 7308, 7226, 591, 7232, 7330, 7297, 7318, 7334, 7333, 5346, 469, 476, 5346, 476, 487, 5346, 487, 470, 5346, 470, 573, 7384, 676, 671, 7384, 7385, 676, 7384, 671, 13362, 7384, 13362, 13477, 7384, 13477, 13476, 7384, 10353, 7385, 7384, 13476, 10353, 585, 598, 619, 585, 476, 503, 585, 487, 476, 585, 591, 487, 602, 625, 591, 602, 619, 625, 602, 591, 585, 602, 585, 619, 499, 501, 503, 499, 500, 501, 499, 611, 500, 499, 573, 611, 3698, 614, 597, 3698, 597, 501, 3698, 501, 612, 3698, 3699, 614, 3698, 612, 3699, 13463, 13381, 13389, 7323, 7308, 591, 7323, 7338, 7308, 7323, 591, 625, 7323, 625, 7338, 7215, 11932, 7226, 7215, 7226, 7308, 7233, 7330, 7232, 7233, 7232, 7234, 7331, 7233, 7234, 7331, 10351, 7346, 7331, 7330, 7233, 7331, 7346, 7330, 586, 503, 598, 586, 598, 585, 586, 585, 503, 416, 503, 469, 416, 499, 503, 416, 469, 5346, 416, 5346, 573, 416, 573, 499, 7319, 7338, 7334, 7319, 7334, 7318, 7319, 7308, 7338, 7319, 7318, 7234, 7319, 7309, 7308, 7209, 11932, 7215, 7160, 11932, 7209, 7160, 7297, 11932, 7160, 7232, 7297, 10341, 7319, 7234, 7236, 7308, 7309, 7236, 7215, 7308, 7236, 7309, 7319, 7236, 7319, 10341, 7236, 7209, 7215, 7236, 7160, 7209, 7236, 10341, 7234, 7236, 7234, 7232, 7236, 7232, 7160, 10350, 7234, 7318, 10350, 7331, 7234, 10350, 7318, 7333, 10350, 7333, 10351, 10350, 10351, 7331, 13489, 611, 7330, 13489, 13389, 611, 7297, 7330, 611, 7297, 611, 573, 13381, 13481, 13477, 13381, 13477, 13377, 13463, 13389, 13489, 13463, 13489, 13563, 13463, 13481, 13381, 13463, 13563, 13481]) });

// The winding sign requires a closed, consistently oriented skin: every directed edge occurs
// once and its reverse occurs once.
const closedTopologies = new WeakMap();
export function isClosedSurface(faces) {
  if (closedTopologies.has(faces)) return closedTopologies.get(faces);
  const counts = new Map();
  for (let t = 0; t < faces.length; t += 3) for (let e = 0; e < 3; e += 1) {
    const key = faces[t + e] * 4294967296 + faces[t + (e + 1) % 3];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let closed = counts.size > 0;
  for (const [key, count] of counts) {
    const a = Math.floor(key / 4294967296), b = key - a * 4294967296;
    if (count !== 1 || counts.get(b * 4294967296 + a) !== 1) { closed = false; break; }
  }
  closedTopologies.set(faces, closed);
  return closed;
}

// The containment envelope is the largest connected component of the skin mesh; closed
// interior shells (eyes, mouth) are not part of the body envelope.
const envelopes = new WeakMap();
export function envelopeFaces(faces) {
  if (envelopes.has(faces)) return envelopes.get(faces);
  let vertexCount = 0;
  for (let i = 0; i < faces.length; i += 1) vertexCount = Math.max(vertexCount, faces[i] + 1);
  const parent = new Int32Array(vertexCount).map((_, i) => i);
  const find = (v) => { while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v]; } return v; };
  for (let t = 0; t < faces.length; t += 3) {
    const a = find(faces[t]);
    for (let e = 1; e < 3; e += 1) { const b = find(faces[t + e]); if (a !== b) parent[b] = a; }
  }
  const size = new Map();
  for (let t = 0; t < faces.length; t += 3) { const root = find(faces[t]); size.set(root, (size.get(root) || 0) + 1); }
  let main = -1, largest = 0;
  for (const [root, count] of size) if (count > largest) { largest = count; main = root; }
  const out = new Uint32Array(largest * 3);
  let n = 0;
  for (let t = 0; t < faces.length; t += 3) if (find(faces[t]) === main) { out[n++] = faces[t]; out[n++] = faces[t + 1]; out[n++] = faces[t + 2]; }
  const result = { faces: out, components: size.size, excludedFaces: faces.length / 3 - largest };
  envelopes.set(faces, result);
  return result;
}

const closedFaces = new WeakMap();
function closureFaces(faces) {
  if (!closedFaces.has(faces)) {
    const out = new Uint32Array(faces.length + ORAL_CLOSURE.faces.length);
    out.set(faces); out.set(ORAL_CLOSURE.faces, faces.length);
    closedFaces.set(faces, out);
  }
  return closedFaces.get(faces);
}

function grow(array, size, Type) { return array && array.length >= size ? array : new Type(Math.ceil(size * 1.25)); }

export class SkinField {
  constructor(options = {}) {
    this.options = { ...CONTAINMENT_DEFAULTS, ...options };
    if (!(this.options.cell > this.options.margin * 2)) throw new Error('Containment grid cell must exceed the margin.');
    this.stampValue = 0;
    this.closest = new Float64Array(3);
  }

  build(positions, faces) {
    const { cell, column } = this.options;
    const triangleCount = faces.length / 3;
    this.positions = positions; this.faces = faces; this.triangleCount = triangleCount;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    x0 -= cell; y0 -= cell; z0 -= cell; x1 += cell; y1 += cell; z1 += cell;
    this.bounds = [x0, y0, z0, x1, y1, z1];
    const nx = Math.ceil((x1 - x0) / cell) + 1, ny = Math.ceil((y1 - y0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
    Object.assign(this, { x0, y0, z0, nx, ny, nz });
    const boxes = this.boxes = grow(this.boxes, triangleCount * 6, Float64Array);
    for (let t = 0; t < triangleCount; t += 1) {
      const a = faces[t * 3] * 3, b = faces[t * 3 + 1] * 3, c = faces[t * 3 + 2] * 3;
      for (let k = 0; k < 3; k += 1) {
        const va = positions[a + k], vb = positions[b + k], vc = positions[c + k];
        boxes[t * 6 + k] = Math.min(va, vb, vc); boxes[t * 6 + 3 + k] = Math.max(va, vb, vc);
      }
    }
    // 3D triangle grid.
    const cellCount = nx * ny * nz;
    const cellStart = this.cellStart = grow(this.cellStart, cellCount + 1, Int32Array);
    cellStart.fill(0, 0, cellCount + 1);
    const ranges = this.ranges = grow(this.ranges, triangleCount * 6, Int32Array);
    let cellTotal = 0;
    for (let t = 0; t < triangleCount; t += 1) {
      const o = t * 6;
      const i0 = Math.floor((boxes[o] - x0) / cell), j0 = Math.floor((boxes[o + 1] - y0) / cell), k0 = Math.floor((boxes[o + 2] - z0) / cell);
      const i1 = Math.floor((boxes[o + 3] - x0) / cell), j1 = Math.floor((boxes[o + 4] - y0) / cell), k1 = Math.floor((boxes[o + 5] - z0) / cell);
      ranges[o] = i0; ranges[o + 1] = j0; ranges[o + 2] = k0; ranges[o + 3] = i1; ranges[o + 4] = j1; ranges[o + 5] = k1;
      for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) {
        for (let k = k0; k <= k1; k += 1) { cellStart[(k * ny + j) * nx + i + 1] += 1; cellTotal += 1; }
      }
    }
    for (let i = 0; i < cellCount; i += 1) cellStart[i + 1] += cellStart[i];
    const cellTris = this.cellTris = grow(this.cellTris, cellTotal, Int32Array);
    const cellFill = this.cellFill = grow(this.cellFill, cellCount, Int32Array);
    cellFill.set(cellStart.subarray(0, cellCount));
    for (let t = 0; t < triangleCount; t += 1) {
      const o = t * 6;
      for (let j = ranges[o + 1]; j <= ranges[o + 4]; j += 1) for (let i = ranges[o]; i <= ranges[o + 3]; i += 1) {
        for (let k = ranges[o + 2]; k <= ranges[o + 5]; k += 1) cellTris[cellFill[(k * ny + j) * nx + i]++] = t;
      }
    }
    // Parity columns: +z crossings of the skin at regular xy column centres.
    const mx = Math.ceil((x1 - x0) / column) + 1, my = Math.ceil((y1 - y0) / column) + 1;
    Object.assign(this, { mx, my });
    const columnStart = this.columnStart = grow(this.columnStart, mx * my + 1, Int32Array);
    columnStart.fill(0, 0, mx * my + 1);
    let columnTotal = 0;
    const eachColumnHit = (visit) => {
      for (let t = 0; t < triangleCount; t += 1) {
        const a = faces[t * 3] * 3, b = faces[t * 3 + 1] * 3, c = faces[t * 3 + 2] * 3, o = t * 6;
        const i0 = Math.ceil((boxes[o] - x0) / column - COLUMN_PHASE_X), i1 = Math.floor((boxes[o + 3] - x0) / column - COLUMN_PHASE_X);
        const j0 = Math.ceil((boxes[o + 1] - y0) / column - COLUMN_PHASE_Y), j1 = Math.floor((boxes[o + 4] - y0) / column - COLUMN_PHASE_Y);
        for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) {
          const z = this.rayHit(x0 + (i + COLUMN_PHASE_X) * column, y0 + (j + COLUMN_PHASE_Y) * column, a, b, c);
          if (z === z) visit(j * mx + i, z);
        }
      }
    };
    eachColumnHit((index) => { columnStart[index + 1] += 1; columnTotal += 1; });
    for (let i = 0; i < mx * my; i += 1) columnStart[i + 1] += columnStart[i];
    const columnZ = this.columnZ = grow(this.columnZ, columnTotal, Float64Array);
    const columnSign = this.columnSign = grow(this.columnSign, columnTotal, Int8Array);
    const columnFill = this.columnFill = grow(this.columnFill, mx * my, Int32Array);
    columnFill.set(columnStart.subarray(0, mx * my));
    eachColumnHit((index, z) => { columnSign[columnFill[index]] = this.hitSign; columnZ[columnFill[index]++] = z; });
    for (let c = 0; c < mx * my; c += 1) {
      const start = columnStart[c], end = columnStart[c + 1];
      for (let i = start + 1; i < end; i += 1) {
        const v = columnZ[i], w = columnSign[i]; let j = i - 1;
        while (j >= start && columnZ[j] > v) { columnZ[j + 1] = columnZ[j]; columnSign[j + 1] = columnSign[j]; j -= 1; }
        columnZ[j + 1] = v; columnSign[j + 1] = w;
      }
    }
    this.columnHalfDiagonal = column * Math.SQRT1_2;
    this.target = this.options.margin * (1 + this.options.marginSafety);
    this.bandRadius = Math.max(this.columnHalfDiagonal * 1.001, this.target * 1.001);
    // Occupancy voxels: set where a triangle box dilated by the band radius overlaps the voxel.
    const voxel = this.voxel = cell / 2, r = this.bandRadius;
    const vx = Math.ceil((x1 - x0) / voxel) + 1, vy = Math.ceil((y1 - y0) / voxel) + 1, vz = Math.ceil((z1 - z0) / voxel) + 1;
    Object.assign(this, { vx, vy, vz });
    const occupancy = this.occupancy = grow(this.occupancy, vx * vy * vz, Uint8Array);
    occupancy.fill(0, 0, vx * vy * vz);
    for (let t = 0; t < triangleCount; t += 1) {
      const o = t * 6;
      const i0 = Math.max(0, Math.floor((boxes[o] - r - x0) / voxel)), i1 = Math.min(vx - 1, Math.floor((boxes[o + 3] + r - x0) / voxel));
      const j0 = Math.max(0, Math.floor((boxes[o + 1] - r - y0) / voxel)), j1 = Math.min(vy - 1, Math.floor((boxes[o + 4] + r - y0) / voxel));
      const k0 = Math.max(0, Math.floor((boxes[o + 2] - r - z0) / voxel)), k1 = Math.min(vz - 1, Math.floor((boxes[o + 5] + r - z0) / voxel));
      for (let k = k0; k <= k1; k += 1) for (let j = j0; j <= j1; j += 1) {
        const row = (k * vy + j) * vx;
        occupancy.fill(1, row + i0, row + i1 + 1);
      }
    }
    // Fine xy buckets for exact parity, one per parity column cell.
    const bucket = this.options.parityBucket;
    const px = this.px = Math.ceil((x1 - x0) / bucket) + 1, py = this.py = Math.ceil((y1 - y0) / bucket) + 1;
    const parityStart = this.parityStart = grow(this.parityStart, px * py + 1, Int32Array);
    parityStart.fill(0, 0, px * py + 1);
    let parityTotal = 0;
    const parityRange = (t, visit) => {
      const o = t * 6;
      const i0 = Math.max(0, Math.floor((boxes[o] - x0) / bucket)), i1 = Math.min(px - 1, Math.floor((boxes[o + 3] - x0) / bucket));
      const j0 = Math.max(0, Math.floor((boxes[o + 1] - y0) / bucket)), j1 = Math.min(py - 1, Math.floor((boxes[o + 4] - y0) / bucket));
      for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) visit(j * px + i);
    };
    for (let t = 0; t < triangleCount; t += 1) parityRange(t, (index) => { parityStart[index + 1] += 1; parityTotal += 1; });
    for (let i = 0; i < px * py; i += 1) parityStart[i + 1] += parityStart[i];
    const parityTris = this.parityTris = grow(this.parityTris, parityTotal, Int32Array);
    const parityFill = this.parityFill = grow(this.parityFill, px * py, Int32Array);
    parityFill.set(parityStart.subarray(0, px * py));
    for (let t = 0; t < triangleCount; t += 1) parityRange(t, (index) => { parityTris[parityFill[index]++] = t; });
    // Per-frame triangle class: 0 unknown, 1 envelope boundary, 2 interior sheet (winding
    // nonzero on both sides, e.g. a skinning self-overlap fold). Only boundary triangles bound
    // the margin; interior sheets never separate inside from outside.
    this.triangleClass = grow(this.triangleClass, triangleCount, Int8Array);
    this.triangleClass.fill(0, 0, triangleCount);
    this.stamps = grow(this.stamps, triangleCount, Uint32Array);
    if (this.stamps.length !== triangleCount || this.stampValue > 4e9) { this.stamps.fill(0); this.stampValue = 0; }
    return this;
  }

  // z of the triangle's crossing with the vertical line (x, y), or NaN. Strict interior test.
  rayHit(x, y, a, b, c) {
    const p = this.positions;
    const ax = p[a], ay = p[a + 1], bx = p[b], by = p[b + 1], cx = p[c], cy = p[c + 1];
    const w0 = (bx - x) * (cy - y) - (by - y) * (cx - x);
    const w1 = (cx - x) * (ay - y) - (cy - y) * (ax - x);
    const w2 = (ax - x) * (by - y) - (ay - y) * (bx - x);
    if (!((w0 > 0 && w1 > 0 && w2 > 0) || (w0 < 0 && w1 < 0 && w2 < 0))) return NaN;
    const sum = w0 + w1 + w2;
    this.hitSign = sum > 0 ? 1 : -1;
    return (w0 * p[a + 2] + w1 * p[b + 2] + w2 * p[c + 2]) / sum;
  }

  insideColumn(x, y, z) {
    const i = Math.round((x - this.x0) / this.options.column - COLUMN_PHASE_X), j = Math.round((y - this.y0) / this.options.column - COLUMN_PHASE_Y);
    if (i < 0 || j < 0 || i >= this.mx || j >= this.my) return false;
    const index = j * this.mx + i, start = this.columnStart[index], end = this.columnStart[index + 1];
    let lo = start, hi = end;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.columnZ[mid] <= z) lo = mid + 1; else hi = mid; }
    let winding = 0;
    for (let n = lo; n < end; n += 1) winding += this.columnSign[n];
    return winding !== 0;
  }

  insideExact(x, y, z) {
    const { cell } = this.options, faces = this.faces;
    x += RAY_DX; y += RAY_DY;
    const bucket = this.options.parityBucket;
    const i = Math.floor((x - this.x0) / bucket), j = Math.floor((y - this.y0) / bucket);
    if (i < 0 || j < 0 || i >= this.px || j >= this.py) return false;
    const index = j * this.px + i;
    let winding = 0;
    for (let n = this.parityStart[index], end = this.parityStart[index + 1]; n < end; n += 1) {
      const t = this.parityTris[n];
      if (this.boxes[t * 6 + 5] <= z) continue;
      const hit = this.rayHit(x, y, faces[t * 3] * 3, faces[t * 3 + 1] * 3, faces[t * 3 + 2] * 3);
      if (hit > z) winding += this.hitSign;
    }
    return winding !== 0;
  }

  inside(x, y, z, distance) {
    return distance > this.columnHalfDiagonal ? this.insideColumn(x, y, z) : this.insideExact(x, y, z);
  }

  // Minimum distance to skin triangles within `radius` of the query, Infinity if none.
  // Only cells overlapping the query box are visited. Returns early once below stopBelow.
  bandDistance(x, y, z, radius, stopBelow = 0) {
    const { cell } = this.options, { positions: p, faces, boxes } = this;
    const i0 = Math.max(0, Math.floor((x - radius - this.x0) / cell)), i1 = Math.min(this.nx - 1, Math.floor((x + radius - this.x0) / cell));
    const j0 = Math.max(0, Math.floor((y - radius - this.y0) / cell)), j1 = Math.min(this.ny - 1, Math.floor((y + radius - this.y0) / cell));
    const k0 = Math.max(0, Math.floor((z - radius - this.z0) / cell)), k1 = Math.min(this.nz - 1, Math.floor((z + radius - this.z0) / cell));
    const stamp = ++this.stampValue, stamps = this.stamps;
    let best = radius;
    for (let kk = k0; kk <= k1; kk += 1) for (let jj = j0; jj <= j1; jj += 1) for (let ii = i0; ii <= i1; ii += 1) {
      const index = (kk * this.ny + jj) * this.nx + ii;
      for (let n = this.cellStart[index], end = this.cellStart[index + 1]; n < end; n += 1) {
        const t = this.cellTris[n];
        if (stamps[t] === stamp) continue;
        stamps[t] = stamp;
        const o = t * 6;
        const ex = Math.max(boxes[o] - x, 0, x - boxes[o + 3]);
        if (ex >= best) continue;
        const ey = Math.max(boxes[o + 1] - y, 0, y - boxes[o + 4]);
        if (ey >= best) continue;
        const ez = Math.max(boxes[o + 2] - z, 0, z - boxes[o + 5]);
        if (ez >= best || ex * ex + ey * ey + ez * ez >= best * best) continue;
        const a = faces[t * 3] * 3, b = faces[t * 3 + 1] * 3, c = faces[t * 3 + 2] * 3;
        const d = Math.sqrt(closestPointTriangle(x, y, z, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]));
        if (d < best) { best = d; if (best < stopBelow) return best; }
      }
    }
    return best < radius ? best : Infinity;
  }

  inGrid(x, y, z) {
    const b = this.bounds;
    return x > b[0] && y > b[1] && z > b[2] && x < b[3] && y < b[4] && z < b[5];
  }

  isBoundaryTriangle(t) {
    const known = this.triangleClass[t];
    if (known) return known === 1;
    const p = this.positions, f = this.faces, a = f[t * 3] * 3, b = f[t * 3 + 1] * 3, c = f[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    let boundary = true;
    if (length > 0) {
      const eps = 3 * this.target;
      nx /= length; ny /= length; nz /= length;
      const gx = (p[a] + p[b] + p[c]) / 3, gy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, gz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
      boundary = !(this.insideExact(gx + eps * nx, gy + eps * ny, gz + eps * nz) && this.insideExact(gx - eps * nx, gy - eps * ny, gz - eps * nz));
    }
    this.triangleClass[t] = boundary ? 1 : 2;
    return boundary;
  }

  // True when an envelope-boundary triangle lies within `limit` of the query.
  boundaryWithin(x, y, z, limit) {
    const { cell } = this.options, { positions: p, faces, boxes } = this;
    const i0 = Math.max(0, Math.floor((x - limit - this.x0) / cell)), i1 = Math.min(this.nx - 1, Math.floor((x + limit - this.x0) / cell));
    const j0 = Math.max(0, Math.floor((y - limit - this.y0) / cell)), j1 = Math.min(this.ny - 1, Math.floor((y + limit - this.y0) / cell));
    const k0 = Math.max(0, Math.floor((z - limit - this.z0) / cell)), k1 = Math.min(this.nz - 1, Math.floor((z + limit - this.z0) / cell));
    const stamp = ++this.stampValue, stamps = this.stamps;
    for (let kk = k0; kk <= k1; kk += 1) for (let jj = j0; jj <= j1; jj += 1) for (let ii = i0; ii <= i1; ii += 1) {
      const index = (kk * this.ny + jj) * this.nx + ii;
      for (let n = this.cellStart[index], end = this.cellStart[index + 1]; n < end; n += 1) {
        const t = this.cellTris[n];
        if (stamps[t] === stamp) continue;
        stamps[t] = stamp;
        const o = t * 6;
        const ex = Math.max(boxes[o] - x, 0, x - boxes[o + 3]), ey = Math.max(boxes[o + 1] - y, 0, y - boxes[o + 4]), ez = Math.max(boxes[o + 2] - z, 0, z - boxes[o + 5]);
        if (ex * ex + ey * ey + ez * ez >= limit * limit) continue;
        const a = faces[t * 3] * 3, b = faces[t * 3 + 1] * 3, c = faces[t * 3 + 2] * 3, q = this.closest;
        if (closestPointTriangle(x, y, z, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2], q) >= limit * limit) continue;
        if (this.isBoundaryTriangle(t)) return true;
        // A triangle can be interior at its centroid but boundary elsewhere (where a fold or
        // shell intersection ends), so interior triangles are re-tested at the closest point.
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const length = Math.hypot(nx, ny, nz);
        if (!(length > 0)) return true;
        const eps = 3 * this.target;
        nx /= length; ny /= length; nz /= length;
        const qx = q[0], qy = q[1], qz = q[2];
        if (!this.insideExact(qx + eps * nx, qy + eps * ny, qz + eps * nz) || !this.insideExact(qx - eps * nx, qy - eps * ny, qz - eps * nz)) return true;
      }
    }
    return false;
  }

  // phi_S(x) <= -target, with S the envelope boundary. With no surface within the column
  // half-diagonal, the nearest winding column lies on the same side of the skin as the query.
  feasible(x, y, z) {
    if (!this.inGrid(x, y, z)) return false;
    const v = this.voxel;
    if (!this.occupancy[(Math.floor((z - this.z0) / v) * this.vy + Math.floor((y - this.y0) / v)) * this.vx + Math.floor((x - this.x0) / v)]) return this.insideColumn(x, y, z);
    const d = this.bandDistance(x, y, z, this.bandRadius, 0);
    if (!(d === Infinity ? this.insideColumn(x, y, z) : this.insideExact(x, y, z))) return false;
    return d >= this.target || !this.boundaryWithin(x, y, z, this.target);
  }

  // Exact nearest skin point by expanding cell shells. Returns signed distance (negative inside).
  nearest(x, y, z, out) {
    const { cell, nearestRadius } = this.options, { positions: p, faces } = this;
    const i = Math.floor((x - this.x0) / cell), j = Math.floor((y - this.y0) / cell), k = Math.floor((z - this.z0) / cell);
    const stamp = ++this.stampValue, stamps = this.stamps, q = this.closest;
    let best = Infinity, bx = x, by = y, bz = z;
    const maxRing = Math.ceil(nearestRadius / cell) + Math.max(0, -i, -j, -k, i - this.nx, j - this.ny, k - this.nz);
    for (let ring = 0; ring <= maxRing; ring += 1) {
      for (let kk = k - ring; kk <= k + ring; kk += 1) {
        if (kk < 0 || kk >= this.nz) continue;
        for (let jj = j - ring; jj <= j + ring; jj += 1) {
          if (jj < 0 || jj >= this.ny) continue;
          const shell = Math.abs(kk - k) === ring || Math.abs(jj - j) === ring;
          for (let ii = i - ring; ii <= i + ring; ii += shell ? 1 : 2 * ring || 1) {
            if (ii < 0 || ii >= this.nx) continue;
            const index = (kk * this.ny + jj) * this.nx + ii;
            for (let n = this.cellStart[index], end = this.cellStart[index + 1]; n < end; n += 1) {
              const t = this.cellTris[n];
              if (stamps[t] === stamp) continue;
              stamps[t] = stamp;
              const a = faces[t * 3] * 3, b = faces[t * 3 + 1] * 3, c = faces[t * 3 + 2] * 3;
              const d2 = closestPointTriangle(x, y, z, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2], q);
              if (d2 < best * best) { best = Math.sqrt(d2); bx = q[0]; by = q[1]; bz = q[2]; }
            }
          }
        }
      }
      if (best <= ring * cell) break;
    }
    if (out) { out[0] = bx; out[1] = by; out[2] = bz; }
    if (!Number.isFinite(best)) return Infinity;
    const inside = this.inGrid(x, y, z) && this.inside(x, y, z, best);
    return inside ? -best : best;
  }
}

function symmetricEigenvectors(m) {
  // Jacobi rotation for a 3x3 symmetric matrix given as [xx, xy, xz, yy, yz, zz].
  const a = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep += 1) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-18) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-20) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let r = 0; r < 3; r += 1) { const arp = a[r][p], arq = a[r][q]; a[r][p] = c * arp - s * arq; a[r][q] = s * arp + c * arq; }
      for (let r = 0; r < 3; r += 1) { const apr = a[p][r], aqr = a[q][r]; a[p][r] = c * apr - s * aqr; a[q][r] = s * apr + c * aqr; }
      for (let r = 0; r < 3; r += 1) { const vrp = v[r][p], vrq = v[r][q]; v[r][p] = c * vrp - s * vrq; v[r][q] = s * vrp + c * vrq; }
    }
  }
  const order = [0, 1, 2].sort((x, y) => a[y][y] - a[x][x]);
  return order.map((index) => [v[0][index], v[1][index], v[2][index]]);
}

// Affine map x -> A x + b stored row-major as 12 numbers.
function affineTranslation(t) { return [1, 0, 0, t[0], 0, 1, 0, t[1], 0, 0, 1, t[2]]; }

function affineScaleAbout(axes, scales, center, translation) {
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) {
    let sum = 0;
    for (let n = 0; n < 3; n += 1) sum += axes[n][r] * scales[n] * axes[n][c];
    A[r * 3 + c] = sum;
  }
  // x' = c + A (x + t - c) = A x + A (t - c) + c
  const d = [translation[0] - center[0], translation[1] - center[1], translation[2] - center[2]];
  const out = [];
  for (let r = 0; r < 3; r += 1) {
    out.push(A[r * 3], A[r * 3 + 1], A[r * 3 + 2], A[r * 3] * d[0] + A[r * 3 + 1] * d[1] + A[r * 3 + 2] * d[2] + center[r]);
  }
  return out;
}

const CHUNK = 32;
const chunkScratch = new Float64Array(CHUNK * 3);

// Vertices are tested in chunks of CHUNK spatially ordered vertices. When no skin triangle lies
// within (chunk radius + band radius) of the chunk centre, no vertex of the chunk has a
// triangle within the band radius, so each vertex needs only the column parity test.
function countViolations(field, world, affine, cap = Infinity) {
  let count = 0;
  const [a0, a1, a2, b0, a3, a4, a5, b1, a6, a7, a8, b2] = affine;
  const n = world.length / 3, s = chunkScratch;
  for (let first = 0; first < n; first += CHUNK) {
    const size = Math.min(CHUNK, n - first);
    let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < size; v += 1) {
      const i = (first + v) * 3, x = world[i], y = world[i + 1], z = world[i + 2];
      const tx = a0 * x + a1 * y + a2 * z + b0, ty = a3 * x + a4 * y + a5 * z + b1, tz = a6 * x + a7 * y + a8 * z + b2;
      s[v * 3] = tx; s[v * 3 + 1] = ty; s[v * 3 + 2] = tz; cx += tx; cy += ty; cz += tz;
    }
    cx /= size; cy /= size; cz /= size;
    let radius = 0;
    for (let v = 0; v < size; v += 1) radius = Math.max(radius, Math.hypot(s[v * 3] - cx, s[v * 3 + 1] - cy, s[v * 3 + 2] - cz));
    const far = field.inGrid(cx, cy, cz) && field.bandDistance(cx, cy, cz, radius + field.bandRadius) === Infinity;
    for (let v = 0; v < size; v += 1) {
      const x = s[v * 3], y = s[v * 3 + 1], z = s[v * 3 + 2];
      const ok = far ? field.inGrid(x, y, z) && field.insideColumn(x, y, z) : field.feasible(x, y, z);
      if (!ok) { count += 1; if (count >= cap) return count; }
    }
  }
  return count;
}

// Spatial (Morton) vertex order per local array, so chunks are compact.
const vertexOrders = new WeakMap();
function spatialOrder(local) {
  const cached = vertexOrders.get(local);
  if (cached && cached.length === local.length / 3) return cached;
  const n = local.length / 3;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i += 1) for (let k = 0; k < 3; k += 1) { min[k] = Math.min(min[k], local[i * 3 + k]); max[k] = Math.max(max[k], local[i * 3 + k]); }
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-9);
  const spread = (v) => { v &= 0x3ff; v = (v | (v << 16)) & 0x30000ff; v = (v | (v << 8)) & 0x300f00f; v = (v | (v << 4)) & 0x30c30c3; return (v | (v << 2)) & 0x9249249; };
  const codes = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const q = (k) => Math.min(1023, Math.floor((local[i * 3 + k] - min[k]) / span * 1023));
    codes[i] = spread(q(0)) | (spread(q(1)) << 1) | (spread(q(2)) << 2);
  }
  const order = Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => codes[a] - codes[b]);
  vertexOrders.set(local, order);
  return order;
}

const IDENTITY_AFFINE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

// (A o B)(x) = A (B x + b_B) + b_A, affines row-major 3x4.
function composeAffine(A, B) {
  const out = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) out.push(A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c]);
    out.push(A[r * 4] * B[3] + A[r * 4 + 1] * B[7] + A[r * 4 + 2] * B[11] + A[r * 4 + 3]);
  }
  return out;
}

function transformInPlace(world, affine) {
  const [a0, a1, a2, b0, a3, a4, a5, b1, a6, a7, a8, b2] = affine;
  for (let i = 0; i < world.length; i += 3) {
    const x = world[i], y = world[i + 1], z = world[i + 2];
    world[i] = a0 * x + a1 * y + a2 * z + b0; world[i + 1] = a3 * x + a4 * y + a5 * z + b1; world[i + 2] = a6 * x + a7 * y + a8 * z + b2;
  }
}



function multiply4(a, b) {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
    let sum = 0;
    for (let k = 0; k < 4; k += 1) sum += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = sum;
  }
  return out;
}

function invertRigidish(m) {
  // General 4x4 affine inverse (upper 3x3 may include scale).
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = new Float64Array(16);
  inv[0] = A / det; inv[1] = B / det; inv[2] = C / det;
  inv[4] = -(b * i - c * h) / det; inv[5] = (a * i - c * g) / det; inv[6] = -(a * h - b * g) / det;
  inv[8] = (b * f - c * e) / det; inv[9] = -(a * f - c * d) / det; inv[10] = (a * e - b * d) / det;
  inv[12] = -(inv[0] * m[12] + inv[4] * m[13] + inv[8] * m[14]);
  inv[13] = -(inv[1] * m[12] + inv[5] * m[13] + inv[9] * m[14]);
  inv[14] = -(inv[2] * m[12] + inv[6] * m[13] + inv[10] * m[14]);
  inv[15] = 1;
  return inv;
}

// Express a world correction C (and world displacement D) in the bone's local frame M.
function localCorrection(matrix, correction, displacement) {
  if (!correction && !displacement) return null;
  const M = Float64Array.from(matrix), Minv = invertRigidish(M);
  const local = correction ? multiply4(Minv, multiply4(Float64Array.from(correction), M)) : null;
  let delta = null;
  if (displacement) {
    delta = new Float32Array(displacement.length);
    for (let i = 0; i < displacement.length; i += 3) {
      const x = displacement[i], y = displacement[i + 1], z = displacement[i + 2];
      delta[i] = Minv[0] * x + Minv[4] * y + Minv[8] * z;
      delta[i + 1] = Minv[1] * x + Minv[5] * y + Minv[9] * z;
      delta[i + 2] = Minv[2] * x + Minv[6] * y + Minv[10] * z;
    }
  }
  return { local, delta };
}

// Re-apply a bone-local correction at the bone's new pose; accept only if fully feasible.
function reuseCorrection(field, rawWorld, matrix, warm, order) {
  const M = Float64Array.from(matrix);
  const C = warm.local ? multiply4(M, multiply4(warm.local, invertRigidish(M))) : null;
  const n = rawWorld.length / 3, candidate = new Float64Array(rawWorld.length);
  let D = null;
  if (warm.delta) {
    D = new Float32Array(warm.delta.length);
    for (let i = 0; i < warm.delta.length; i += 3) {
      const x = warm.delta[i], y = warm.delta[i + 1], z = warm.delta[i + 2];
      D[i] = M[0] * x + M[4] * y + M[8] * z; D[i + 1] = M[1] * x + M[5] * y + M[9] * z; D[i + 2] = M[2] * x + M[6] * y + M[10] * z;
    }
  }
  for (let v = 0; v < n; v += 1) {
    let x = rawWorld[v * 3], y = rawWorld[v * 3 + 1], z = rawWorld[v * 3 + 2];
    if (C) { const X = C[0] * x + C[4] * y + C[8] * z + C[12], Y = C[1] * x + C[5] * y + C[9] * z + C[13], Z = C[2] * x + C[6] * y + C[10] * z + C[14]; x = X; y = Y; z = Z; }
    if (D) { const i = order[v] * 3; x += D[i]; y += D[i + 1]; z += D[i + 2]; }
    candidate[v * 3] = x; candidate[v * 3 + 1] = y; candidate[v * 3 + 2] = z;
  }
  if (countViolations(field, candidate, IDENTITY_AFFINE, 1)) return null;
  return { matrix: C ? Array.from(C) : null, displacement: D };
}

// Articular masks (spatial vertex order): vertex v of bone b is articular when a vertex of
// another bone lies within `radius`. Computed once per bone set from the first projected frame.
const articularCache = new WeakMap();
function articularMasks(worlds, radius) {
  const inverse = 1 / radius, grid = new Map(), r2 = radius * radius;
  const cell = (ix, iy, iz) => ((ix + 1024) * 2048 + (iy + 1024)) * 2048 + (iz + 1024);
  worlds.forEach((world, b) => {
    for (let v = 0; v < world.length / 3; v += 1) {
      const key = cell(Math.floor(world[v * 3] * inverse), Math.floor(world[v * 3 + 1] * inverse), Math.floor(world[v * 3 + 2] * inverse));
      let list = grid.get(key);
      if (!list) grid.set(key, list = []);
      list.push(b, v);
    }
  });
  return worlds.map((world, b) => {
    const n = world.length / 3, mask = new Uint8Array(n);
    for (let v = 0; v < n; v += 1) {
      const x = world[v * 3], y = world[v * 3 + 1], z = world[v * 3 + 2];
      const ix = Math.floor(x * inverse), iy = Math.floor(y * inverse), iz = Math.floor(z * inverse);
      search: for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
        const list = grid.get(cell(ix + dx, iy + dy, iz + dz));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          if (list[k] === b) continue;
          const other = worlds[list[k]], j = list[k + 1] * 3;
          const ex = other[j] - x, ey = other[j + 1] - y, ez = other[j + 2] - z;
          if (ex * ex + ey * ey + ez * ez <= r2) { mask[v] = 1; break search; }
        }
      }
    }
    return mask;
  });
}

// Largest motion of the pinned (articular) vertices under an affine plus displacement.
function maxPinnedMotion(world, pin, affine, displacement) {
  if (!pin) return 0;
  const [a0, a1, a2, b0, a3, a4, a5, b1, a6, a7, a8, b2] = affine || IDENTITY_AFFINE;
  let peak = 0;
  for (let v = 0; v < pin.length; v += 1) {
    if (!pin[v]) continue;
    const x = world[v * 3], y = world[v * 3 + 1], z = world[v * 3 + 2];
    let dx = a0 * x + a1 * y + a2 * z + b0 - x, dy = a3 * x + a4 * y + a5 * z + b1 - y, dz = a6 * x + a7 * y + a8 * z + b2 - z;
    if (displacement) { dx += displacement[v * 3]; dy += displacement[v * 3 + 1]; dz += displacement[v * 3 + 2]; }
    peak = Math.max(peak, Math.hypot(dx, dy, dz));
  }
  return peak;
}

// Independent connectivity measurement for any corrections (column-major 4x4 world matrices)
// and displacements (world, original vertex order): max / mean articular displacement in mm.
export function measureArticularDisplacement(bones, corrections, displacements, bodyHeight, options = {}) {
  const o = { ...CONTAINMENT_DEFAULTS, ...options };
  const fraction = bodyHeight > 0 ? Math.min(1, Math.max(o.marginMinimumFraction, bodyHeight / o.marginReferenceHeight)) : 1;
  const worlds = bones.map(({ local, matrix: e }) => {
    const n = local.length / 3, order = spatialOrder(local), out = new Float64Array(n * 3);
    for (let v = 0; v < n; v += 1) {
      const i = order[v], x = local[i * 3], y = local[i * 3 + 1], z = local[i * 3 + 2];
      out[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    return out;
  });
  const masks = articularMasks(worlds, o.connectivityRadius * fraction);
  let max = 0, sum = 0, count = 0;
  bones.forEach((bone, b) => {
    const C = corrections[b], D = displacements[b], pin = masks[b];
    if ((!C && !D) || !pin.some((value) => value)) return;
    const order = spatialOrder(bone.local);
    const affine = C ? [C[0], C[4], C[8], C[12], C[1], C[5], C[9], C[13], C[2], C[6], C[10], C[14]] : null;
    let delta = null;
    if (D) { delta = new Float64Array(worlds[b].length); for (let v = 0; v < pin.length; v += 1) for (let k = 0; k < 3; k += 1) delta[v * 3 + k] = D[order[v] * 3 + k]; }
    const motion = maxPinnedMotion(worlds[b], pin, affine, delta);
    max = Math.max(max, motion); sum += motion; count += 1;
  });
  return { max_mm: max * 1000, mean_mm: count ? sum / count * 1000 : 0, corrected_articulated_bones: count };
}

export class ContainmentProjector {
  constructor(options = {}) {
    this.options = { ...CONTAINMENT_DEFAULTS, ...options };
    this.field = new SkinField(this.options);
    this.world = new Float64Array(0);
  }

  // bones: [{ name, local: Float32Array (n*3), matrix: column-major 16 numbers, anchor: [x, y, z] | null }]
  // Returns per-bone world-space corrections (column-major 4x4 or null) and a report.
  // warm: optional per-bone { local: 4x4 column-major bone-local correction, delta: bone-local
  // displacement (original vertex order) } from the previous frame of the same motion. A warm
  // correction is re-applied to the bone's new pose and accepted only if it passes the full
  // per-vertex test; otherwise the bone is solved from scratch.
  project(skinPositions, allSkinFaces, bones, { bodyHeight = null, warm = null } = {}) {
    const started = performance.now();
    // Body volume = union of all closed skin shells (nonzero winding). Interior shells such as
    // the eyes become interior sheets; the oral shell fills the mouth pocket of the outer skin.
    const envelope = envelopeFaces(allSkinFaces);
    const oralClosure = allSkinFaces.length === ORAL_CLOSURE.facesCount && ORAL_CLOSURE.check.every((value, index) => allSkinFaces[index] === value);
    const closed = isClosedSurface(allSkinFaces) && (!oralClosure || isClosedSurface(ORAL_CLOSURE.faces));
    const skinFaces = oralClosure ? closureFaces(allSkinFaces) : allSkinFaces;
    const o = this.options;
    const fraction = bodyHeight > 0 ? Math.min(1, Math.max(o.marginMinimumFraction, bodyHeight / o.marginReferenceHeight)) : 1;
    this.field.options.margin = o.margin * fraction;
    const field = this.field.build(skinPositions, skinFaces);
    const corrections = new Array(bones.length).fill(null);
    const displacements = new Array(bones.length).fill(null);
    const rows = [];
    // Group fit: one anisotropic scale (per principal axis) and translation for each group,
    // chosen by coordinate descent on the violation count.
    const groupAffines = new Array(bones.length).fill(null), groupRows = [];
    const worldOf = (b) => {
      const { local, matrix: e } = bones[b], n = local.length / 3, order = spatialOrder(local), out = new Float64Array(n * 3);
      for (let v = 0; v < n; v += 1) {
        const i = order[v], x = local[i * 3], y = local[i * 3 + 1], z = local[i * 3 + 2];
        out[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      return out;
    };
    const radius = o.connectivityRadius * fraction;
    let articular = null;
    if (radius > 0 && bones.length > 1) {
      const cached = articularCache.get(bones[0].local);
      if (cached && cached.radius === radius && cached.locals.length === bones.length && cached.locals.every((local, b) => local === bones[b].local)) articular = cached.masks;
      else {
        articular = articularMasks(bones.map((_, b) => worldOf(b)), radius);
        articularCache.set(bones[0].local, { radius, locals: bones.map((bone) => bone.local), masks: articular });
      }
    }
    const pinOf = (b) => (articular && articular[b].some((value) => value) ? articular[b] : null);
    // Warm pre-pass: bones whose previous-frame correction (or no correction) is still feasible
    // at the new pose are settled before any group fit.
    const settled = new Array(bones.length).fill(null);
    if (warm) {
      for (let b = 0; b < bones.length; b += 1) {
        if (!warm[b]) continue;
        const raw = worldOf(b);
        if (!countViolations(field, raw, IDENTITY_AFFINE, 1)) { settled[b] = { none: true }; continue; }
        const order = spatialOrder(bones[b].local);
        const reused = reuseCorrection(field, raw, bones[b].matrix, warm[b], order);
        if (reused) { settled[b] = reused; continue; }
        if (warm[b].delta) {
          const refined = this.refineWarm(field, raw, bones[b].matrix, warm[b], order, pinOf(b));
          if (refined) settled[b] = refined;
        }
      }
    }
    for (const names of o.groups) {
      const members = names.map((name) => bones.findIndex((bone) => bone.name === name)).filter((index) => index >= 0 && !settled[index]);
      if (members.length < 2) continue;
      const parts = members.map(worldOf), total = parts.reduce((sum, part) => sum + part.length, 0);
      const world = new Float64Array(total);
      let offset = 0;
      for (const part of parts) { world.set(part, offset); offset += part.length; }
      const fit = this.fitGroup(field, world, bones[members[0]].anchor);
      if (!fit) continue;
      members.forEach((index) => { groupAffines[index] = fit.affine; });
      groupRows.push({ bones: names, violations_before: fit.before, violations_after: fit.after, scales: fit.scales, translation_mm: fit.translation_mm });
    }
    let reusedBones = 0, maxDeformation = 0, deformed = 0, checked = 0, violatingBones = 0, violatingVertices = 0, failed = 0, maxOutside = 0, maxTranslation = 0, minScale = 1;
    for (let b = 0; b < bones.length; b += 1) {
      const { local, matrix: e } = bones[b];
      const n = local.length / 3;
      if (settled[b]) {
        checked += n;
        if (!settled[b].none) {
          corrections[b] = settled[b].matrix; displacements[b] = settled[b].displacement;
          rows.push({ name: bones[b].name, violations_before: null, max_outside_mm: 0, translation_mm: 0,
            scale_width: 1, scale_length: 1, mode: 'temporal_reuse', status: 'contained' });
          violatingBones += 1; reusedBones += 1;
        }
        continue;
      }
      if (this.world.length < n * 3) this.world = new Float64Array(n * 3 * 2);
      const world = this.world.subarray(0, n * 3);
      const order = spatialOrder(local);
      for (let v = 0; v < n; v += 1) {
        const i = order[v], x = local[i * 3], y = local[i * 3 + 1], z = local[i * 3 + 2];
        world[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; world[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; world[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      const group = groupAffines[b];
      const raw = warm?.[b] ? Float64Array.from(world) : null;
      if (group) transformInPlace(world, group);
      const violations = countViolations(field, world, IDENTITY_AFFINE);
      checked += n;
      if (!violations) { if (group) corrections[b] = toMatrix(group); continue; }
      violatingBones += 1; violatingVertices += violations;
      if (raw) {
        const reused = reuseCorrection(field, raw, e, warm[b], spatialOrder(local));
        if (reused) {
          corrections[b] = reused.matrix; displacements[b] = reused.displacement;
          rows.push({ name: bones[b].name, violations_before: violations, max_outside_mm: 0, translation_mm: 0,
            scale_width: 1, scale_length: 1, mode: 'temporal_reuse', status: 'contained' });
          reusedBones += 1;
          continue;
        }
      }
      const row = this.correctBone(field, world, bones[b], violations, pinOf(b));
      maxOutside = Math.max(maxOutside, row.max_outside_mm);
      if (row.status === 'failed') failed += 1;
      else { maxTranslation = Math.max(maxTranslation, row.translation_mm); minScale = Math.min(minScale, row.scale_width, row.scale_length); maxDeformation = Math.max(maxDeformation, row.max_displacement_mm || 0); if (row.mode === 'local_deformation') deformed += 1; }
      const affine = group ? composeAffine(row.affine || IDENTITY_AFFINE, group) : row.affine;
      corrections[b] = affine ? toMatrix(affine) : null;
      if (row.displacement) {
        const order = spatialOrder(local), out = new Float32Array(n * 3);
        for (let v = 0; v < n; v += 1) for (let k = 0; k < 3; k += 1) out[order[v] * 3 + k] = row.displacement[v * 3 + k];
        displacements[b] = out;
      }
      delete row.affine; delete row.displacement;
      rows.push(row);
    }
    // Connectivity: displacement of articular vertices from the raw (uncorrected) pose. A joint
    // gap between bones i and j changes by at most the sum of their articular displacements.
    let maxArticular = 0, articularBones = 0, articularSum = 0, articularVertices = 0;
    for (let b = 0; b < bones.length; b += 1) {
      const pin = pinOf(b);
      if (!pin) continue;
      articularVertices += pin.reduce((sum, value) => sum + value, 0);
      if (!corrections[b] && !displacements[b]) continue;
      const raw = worldOf(b), order = spatialOrder(bones[b].local), C = corrections[b], D = displacements[b];
      const affine = C ? [C[0], C[4], C[8], C[12], C[1], C[5], C[9], C[13], C[2], C[6], C[10], C[14]] : null;
      let delta = null;
      if (D) { delta = new Float64Array(raw.length); for (let v = 0; v < pin.length; v += 1) for (let k = 0; k < 3; k += 1) delta[v * 3 + k] = D[order[v] * 3 + k]; }
      const motion = maxPinnedMotion(raw, pin, affine, delta);
      maxArticular = Math.max(maxArticular, motion); articularSum += motion; articularBones += 1;
    }
    const warmNext = bones.map((bone, b) => localCorrection(bone.matrix, corrections[b], displacements[b]));
    return { corrections, displacements, warm: warmNext, report: {
      margin_mm: field.options.margin * 1000, oral_closure: oralClosure, envelope_components: envelope.components, excluded_interior_faces: envelope.excludedFaces,
      checked_vertices: checked, bones: bones.length, groups: groupRows, temporally_reused_bones: reusedBones,
      violating_bones_before: violatingBones, violating_vertices_before: violatingVertices,
      max_outside_before_mm: maxOutside, corrected_bones: violatingBones - failed, failed_bones: failed,
      max_translation_mm: maxTranslation, min_scale: minScale,
      connectivity: { radius_mm: radius * 1000, articular_vertices: articularVertices, corrected_articulated_bones: articularBones,
        max_articular_displacement_mm: maxArticular * 1000, mean_articular_displacement_mm: articularBones ? articularSum / articularBones * 1000 : 0 }, deformed_bones: deformed, max_deformation_mm: maxDeformation, closed_skin: closed, all_vertices_contained: closed && failed === 0,
      elapsed_ms: performance.now() - started, rows,
    } };
  }

  // Deformation warm start: re-apply the previous bone-local correction, then continue the
  // deformation solver from the previous displacement. Accepted only when fully feasible.
  refineWarm(field, raw, matrix, warm, order, pin = null) {
    const M = Float64Array.from(matrix), n = raw.length / 3;
    const C = warm.local ? multiply4(M, multiply4(warm.local, invertRigidish(M))) : null;
    const world = new Float64Array(raw.length), initial = new Float64Array(raw.length);
    let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < n; v += 1) {
      let x = raw[v * 3], y = raw[v * 3 + 1], z = raw[v * 3 + 2];
      if (C) { const X = C[0] * x + C[4] * y + C[8] * z + C[12], Y = C[1] * x + C[5] * y + C[9] * z + C[13], Z = C[2] * x + C[6] * y + C[10] * z + C[14]; x = X; y = Y; z = Z; }
      world[v * 3] = x; world[v * 3 + 1] = y; world[v * 3 + 2] = z; cx += x / n; cy += y / n; cz += z / n;
      const i = order[v] * 3, d = warm.delta;
      initial[v * 3] = M[0] * d[i] + M[4] * d[i + 1] + M[8] * d[i + 2];
      initial[v * 3 + 1] = M[1] * d[i] + M[5] * d[i + 1] + M[9] * d[i + 2];
      initial[v * 3 + 2] = M[2] * d[i] + M[6] * d[i + 1] + M[10] * d[i + 2];
    }
    let extent = 0;
    for (let v = 0; v < n; v += 1) extent = Math.max(extent, Math.hypot(world[v * 3] - cx, world[v * 3 + 1] - cy, world[v * 3 + 2] - cz));
    const anchor = field.feasible(cx, cy, cz) ? [cx, cy, cz] : null;
    const saved = this.options.deformIterations;
    this.options.deformIterations = Math.min(saved, 6);
    let displacement;
    try { displacement = this.deformBone(field, world, extent, anchor, initial, pin); }
    finally { this.options.deformIterations = saved; }
    if (!displacement) return null;
    const out = new Float32Array(n * 3);
    for (let v = 0; v < n; v += 1) for (let k = 0; k < 3; k += 1) out[order[v] * 3 + k] = displacement[v * 3 + k];
    const candidate = new Float64Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) candidate[i] = world[i] + displacement[i];
    if (countViolations(field, candidate, IDENTITY_AFFINE, 1)) return null;
    return { matrix: C ? Array.from(C) : null, displacement: out };
  }

  fitGroup(field, world, anchorHint) {
    const o = this.options, n = world.length / 3;
    const before = countViolations(field, world, IDENTITY_AFFINE);
    if (!before) return null;
    const centroid = [0, 0, 0];
    for (let i = 0; i < n; i += 1) for (let k = 0; k < 3; k += 1) centroid[k] += world[i * 3 + k] / n;
    const cov = [0, 0, 0, 0, 0, 0];
    let extent = 0;
    for (let i = 0; i < n; i += 1) {
      const dx = world[i * 3] - centroid[0], dy = world[i * 3 + 1] - centroid[1], dz = world[i * 3 + 2] - centroid[2];
      cov[0] += dx * dx; cov[1] += dx * dy; cov[2] += dx * dz; cov[3] += dy * dy; cov[4] += dy * dz; cov[5] += dz * dz;
      extent = Math.max(extent, Math.hypot(dx, dy, dz));
    }
    const axes = symmetricEigenvectors(cov);
    // Descent on a spatial subsample, final count on all vertices.
    const stride = Math.max(1, Math.floor(n / 600)), sample = new Float64Array(Math.ceil(n / stride) * 3);
    for (let i = 0, j = 0; i < n; i += stride, j += 1) sample.set(world.subarray(i * 3, i * 3 + 3), j * 3);
    const make = (scales, t) => {
      const shift = [0, 1, 2].map((k) => axes[0][k] * t[0] + axes[1][k] * t[1] + axes[2][k] * t[2]);
      return affineScaleAbout(axes, scales, centroid, shift);
    };
    let scales = [1, 1, 1], t = [0, 0, 0], best = countViolations(field, sample, IDENTITY_AFFINE);
    let scaleStep = 0.04, shiftStep = 0.003 * Math.max(0.35, extent / 0.1);
    const maxShift = o.groupMaxTranslationFraction * extent;
    for (let iteration = 0; iteration < 40 && best > 0; iteration += 1) {
      let move = null;
      for (let k = 0; k < 3; k += 1) {
        const trial = scales.slice(); trial[k] = Math.max(o.groupMinScale, trial[k] - scaleStep);
        if (trial[k] !== scales[k]) { const count = countViolations(field, sample, make(trial, t), best); if (count < best && (!move || count < move.count)) move = { count, scales: trial, t }; }
        for (const sign of [-1, 1]) {
          const shifted = t.slice(); shifted[k] += sign * shiftStep;
          if (Math.hypot(...shifted) > maxShift) continue;
          const count = countViolations(field, sample, make(scales, shifted), best);
          if (count < best && (!move || count < move.count)) move = { count, scales, t: shifted };
        }
      }
      if (move) { best = move.count; scales = move.scales; t = move.t; }
      else if (scaleStep > 0.011) { scaleStep /= 2; shiftStep /= 2; }
      else break;
    }
    const affine = make(scales, t), after = countViolations(field, world, affine);
    if (after >= before) return null;
    return { affine, before, after, scales, translation_mm: Math.hypot(...t) * 1000 };
  }

  // Smooth inward deformation: violating vertices move to depth 1.5 delta along the nearest
  // skin direction; displacements spread over the bone with a Gaussian kernel (sigma scaled
  // to the bone). Returns world displacements (bone vertex order of `world`) or null.
  deformBone(field, world, extent, interiorAnchor = null, initial = null, pin = null) {
    const o = this.options, n = world.length / 3, q = new Float64Array(3), violating = pin ? new Uint8Array(n) : null;
    const sigma = Math.max(o.deformSigmaMin, o.deformSigmaFraction * extent), inverse = 1 / (sigma * sigma);
    const displacement = initial ? Float64Array.from(initial) : new Float64Array(n * 3), current = new Float64Array(n * 3);
    for (let iteration = 0; iteration <= o.deformIterations; iteration += 1) {
      for (let i = 0; i < n * 3; i += 1) current[i] = world[i] + displacement[i];
      const violators = [];
      for (let i = 0; i < n; i += 1) if (!field.feasible(current[i * 3], current[i * 3 + 1], current[i * 3 + 2])) violators.push(i);
      if (!violators.length) return displacement;
      if (violating) { violating.fill(0); for (const i of violators) violating[i] = 1; }
      if (iteration === o.deformIterations) {
        // Remaining vertices: direct projection to depth 1.5 delta along the nearest skin direction;
        // vertices still stuck move along the segment to the (feasible) bone centroid instead.
        let centroid = [0, 0, 0];
        for (let i = 0; i < n; i += 1) for (let k = 0; k < 3; k += 1) centroid[k] += world[i * 3 + k] / n;
        if (!field.feasible(centroid[0], centroid[1], centroid[2]) && interiorAnchor) centroid = interiorAnchor;
        const centroidFeasible = field.feasible(centroid[0], centroid[1], centroid[2]);
        for (let pass = 0; pass < 20; pass += 1) {
          let remaining = 0;
          for (let i = 0; i < n; i += 1) {
            const x = world[i * 3] + displacement[i * 3], y = world[i * 3 + 1] + displacement[i * 3 + 1], z = world[i * 3 + 2] + displacement[i * 3 + 2];
            if (field.feasible(x, y, z)) continue;
            remaining += 1;
            if (pass >= 2 && centroidFeasible) {
              let lo = 0, hi = 1;
              for (let step = 0; step < 16; step += 1) {
                const t = (lo + hi) / 2;
                if (field.feasible(centroid[0] + t * (x - centroid[0]), centroid[1] + t * (y - centroid[1]), centroid[2] + t * (z - centroid[2]))) lo = t; else hi = t;
              }
              for (let k = 0; k < 3; k += 1) displacement[i * 3 + k] += (centroid[k] + lo * ([x, y, z][k] - centroid[k])) - [x, y, z][k];
              continue;
            }
            const phi = field.nearest(x, y, z, q);
            if (!Number.isFinite(phi)) continue;
            let dx = q[0] - x, dy = q[1] - y, dz = q[2] - z;
            const length = Math.hypot(dx, dy, dz);
            if (length < 1e-12) continue;
            if (phi < 0) { dx = -dx; dy = -dy; dz = -dz; }
            const amount = phi > 0 ? phi + 1.5 * field.target : 1.5 * field.target - Math.abs(phi) + 0.25 * field.target;
            displacement[i * 3] += dx / length * amount; displacement[i * 3 + 1] += dy / length * amount; displacement[i * 3 + 2] += dz / length * amount;
          }
          if (!remaining) return displacement;
        }
        return null;
      }
      const stride = Math.max(1, Math.floor(violators.length / 800)), sources = [];
      for (let k = 0; k < violators.length; k += stride) {
        const i = violators[k], x = current[i * 3], y = current[i * 3 + 1], z = current[i * 3 + 2];
        const phi = field.nearest(x, y, z, q);
        if (!Number.isFinite(phi)) continue;
        let dx = q[0] - x, dy = q[1] - y, dz = q[2] - z;
        const length = Math.hypot(dx, dy, dz);
        if (length < 1e-12) continue;
        const amount = phi > 0 ? phi + 1.5 * field.target : 1.5 * field.target - Math.abs(phi);
        if (phi < 0) { dx = -dx; dy = -dy; dz = -dz; }
        sources.push(world[i * 3], world[i * 3 + 1], world[i * 3 + 2], dx / length * Math.max(amount, 0.25 * field.target), dy / length * Math.max(amount, 0.25 * field.target), dz / length * Math.max(amount, 0.25 * field.target));
      }
      if (!sources.length) return null;
      for (let j = 0; j < n; j += 1) {
        const x = world[j * 3], y = world[j * 3 + 1], z = world[j * 3 + 2];
        let weight = 0, peak = 0, sx = 0, sy = 0, sz = 0;
        for (let k = 0; k < sources.length; k += 6) {
          const rx = x - sources[k], ry = y - sources[k + 1], rz = z - sources[k + 2];
          const r2 = (rx * rx + ry * ry + rz * rz) * inverse;
          if (r2 > 9) continue;
          const w = Math.exp(-r2);
          weight += w; if (w > peak) peak = w;
          sx += w * sources[k + 3]; sy += w * sources[k + 4]; sz += w * sources[k + 5];
        }
        if (weight > 0) {
          // Articular vertices that already satisfy containment keep their place (connectivity).
          const keep = violating && pin[j] && !violating[j] ? 1 - o.connectivityPin : 1;
          displacement[j * 3] += sx / weight * peak * keep; displacement[j * 3 + 1] += sy / weight * peak * keep; displacement[j * 3 + 2] += sz / weight * peak * keep;
        }
      }
    }
    return null;
  }

  correctBone(field, world, bone, violations, pin = null) {
    const o = this.options, n = world.length / 3, q = new Float64Array(3);
    const row = { name: bone.name, violations_before: violations, max_outside_mm: 0, translation_mm: 0,
      scale_width: 1, scale_length: 1, mode: 'translation', status: 'contained' };
    // Mean inward direction from the violating vertices (sampled), weighted by violation.
    const direction = [0, 0, 0];
    let needed = 0;
    const stride = Math.max(1, Math.floor(n / 192));
    for (let i = 0; i < n; i += stride) {
      const x = world[i * 3], y = world[i * 3 + 1], z = world[i * 3 + 2];
      if (field.feasible(x, y, z)) continue;
      const phi = field.nearest(x, y, z, q);
      if (!Number.isFinite(phi)) continue;
      const weight = phi + field.target;
      if (phi > 0) row.max_outside_mm = Math.max(row.max_outside_mm, phi * 1000);
      let dx = q[0] - x, dy = q[1] - y, dz = q[2] - z;
      if (phi < 0) { dx = -dx; dy = -dy; dz = -dz; }
      const length = Math.hypot(dx, dy, dz);
      if (length < 1e-12) continue;
      direction[0] += weight * dx / length; direction[1] += weight * dy / length; direction[2] += weight * dz / length;
      needed = Math.max(needed, weight);
    }
    let extent = 0;
    const centroid = [0, 0, 0];
    for (let i = 0; i < n; i += 1) for (let k = 0; k < 3; k += 1) centroid[k] += world[i * 3 + k] / n;
    const cov = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i += 1) {
      const dx = world[i * 3] - centroid[0], dy = world[i * 3 + 1] - centroid[1], dz = world[i * 3 + 2] - centroid[2];
      cov[0] += dx * dx; cov[1] += dx * dy; cov[2] += dx * dz; cov[3] += dy * dy; cov[4] += dy * dz; cov[5] += dz * dz;
      extent = Math.max(extent, Math.hypot(dx, dy, dz));
    }
    const axes = symmetricEigenvectors(cov);
    const feasible = (affine) => countViolations(field, world, affine, 1) === 0;
    const norm = Math.hypot(...direction);
    const u = norm > 0 ? direction.map((value) => value / norm) : [0, 0, 0];
    const limit = norm > 0 ? Math.min(o.maxTranslation, o.translationFraction * 2 * extent, needed + field.target) : 0;
    const shift = (tau) => u.map((value) => value * tau);
    // Pinned local deformation (computed at most once): the connectivity-preserving alternative.
    let deformation;
    const deform = () => {
      if (deformation !== undefined) return deformation;
      const displacement = this.deformBone(field, world, extent, findAnchor([0, 0, 0])?.anchor || null, null, pin);
      if (!displacement) return (deformation = null);
      let maxDisplacement = 0;
      for (let i = 0; i < displacement.length; i += 3) maxDisplacement = Math.max(maxDisplacement, Math.hypot(displacement[i], displacement[i + 1], displacement[i + 2]));
      return (deformation = { displacement, maxDisplacement, articular: maxPinnedMotion(world, pin, null, displacement) });
    };
    const useDeformation = (found) => {
      row.mode = 'local_deformation'; row.max_displacement_mm = found.maxDisplacement * 1000; row.displacement = found.displacement;
      row.articular_displacement_mm = found.articular * 1000;
      return row;
    };
    // An affine candidate is replaced by the pinned deformation when that moves the joint
    // surfaces less (and stays within the deformation cap).
    const connected = (affine) => {
      const articular = maxPinnedMotion(world, pin, affine, null);
      row.articular_displacement_mm = articular * 1000;
      if (!pin || articular <= o.connectivityTolerance) return false;
      const found = deform();
      if (!found || found.articular >= articular || found.maxDisplacement > o.maxDeformationFraction * extent) return false;
      useDeformation(found);
      return true;
    };
    const findAnchor = (translation) => {
      const moved = (point) => [point[0] + translation[0], point[1] + translation[1], point[2] + translation[2]];
      const candidates = [moved(centroid)];
      if (bone.anchor) candidates.push([...bone.anchor]);
      for (const candidate of candidates) {
        const phi = field.nearest(candidate[0], candidate[1], candidate[2]);
        if (-phi > field.target * 1.5) return { anchor: candidate, depth: -phi };
      }
      let best = null;
      const sampleStride = Math.max(1, Math.floor(n / 256));
      for (let i = 0; i < n; i += sampleStride) {
        const candidate = moved([world[i * 3], world[i * 3 + 1], world[i * 3 + 2]]);
        const phi = field.nearest(candidate[0], candidate[1], candidate[2]);
        if (-phi > field.target * 1.5 && (!best || -phi > best.depth)) best = { anchor: candidate, depth: -phi };
      }
      if (best) return best;
      // March from the bone centroid through its nearest skin point into the body.
      const start = moved(centroid), phi0 = field.nearest(start[0], start[1], start[2], q);
      let dx = q[0] - start[0], dy = q[1] - start[1], dz = q[2] - start[2];
      if (phi0 < 0) { dx = -dx; dy = -dy; dz = -dz; }
      const length = Math.hypot(dx, dy, dz);
      if (length > 1e-12) {
        for (let step = 1; step <= 60; step += 1) {
          const lambda = Math.abs(phi0) + step * 0.001;
          const candidate = [start[0] + dx / length * lambda, start[1] + dy / length * lambda, start[2] + dz / length * lambda];
          const phi = field.nearest(candidate[0], candidate[1], candidate[2]);
          if (-phi > field.target * 1.5 && (!best || -phi > best.depth)) best = { anchor: candidate, depth: -phi };
          else if (best) break;
        }
      }
      return best;
    };
    // 1. Smallest feasible rigid translation.
    for (let step = 1; limit > 0 && step <= 12; step += 1) {
      const t = shift(limit * step / 12);
      if (feasible(affineTranslation(t))) {
        if (connected(affineTranslation(t))) return row;
        row.translation_mm = Math.hypot(...t) * 1000; row.affine = affineTranslation(t);
        return row;
      }
    }
    // Largest feasible s on a descending coarse grid, refined inside the bracket
    // (the lower end of the bracket is always a verified feasible value).
    const scan = (make, grid) => {
      let previous = 1;
      for (const value of grid) {
        if (feasible(make(value))) {
          let lo = value, hi = previous;
          for (let step = 0; step < 5; step += 1) { const mid = (lo + hi) / 2; if (feasible(make(mid))) lo = mid; else hi = mid; }
          return lo;
        }
        previous = value;
      }
      return null;
    };
    const anisoGrid = [0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5];
    const uniformGrid = [0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
    let best = null;
    for (const fraction of limit > 0 ? [0, 0.5, 1] : [0]) {
      const translation = shift(limit * fraction);
      const found = findAnchor(translation);
      if (!found) continue;
      const { anchor } = found;
      const aniso = (value) => affineScaleAbout(axes, [1 - o.axialCoupling * (1 - value), value, value], anchor, translation);
      const uniform = (value) => affineScaleAbout(axes, [value, value, value], anchor, translation);
      const consider = (mode, width, length, affine) => {
        const volume = width * width * length;
        if (!best || volume > best.volume + 1e-9) best = { mode, width, length, affine, volume, translation, found };
      };
      const sa = scan(aniso, anisoGrid);
      if (sa !== null) consider('anisotropic', sa, 1 - o.axialCoupling * (1 - sa), aniso(sa));
      if (!best || best.volume < 0.9) {
        const su = scan(uniform, uniformGrid);
        if (su !== null) consider('uniform', su, su, uniform(su));
      }
      if (best && best.volume >= 0.95) break;
    }
    if (!best || best.volume < o.deformBelowVolume) {
      const found = deform();
      // Beyond the cap, a converged deformation is still preferred to near-total shrinkage.
      if (found && (found.maxDisplacement <= o.maxDeformationFraction * extent || !best || best.volume < o.deformOverCapBelowVolume)) return useDeformation(found);
    }
    if (best && connected(best.affine)) return row;
    if (!best) {
      // Guaranteed fallback: uniform scaling inside the interior ball of the anchor.
      const translation = shift(limit), found = findAnchor(translation) || findAnchor([0, 0, 0]);
      if (!found) { row.status = 'failed'; row.mode = 'no_interior_anchor'; row.affine = affineTranslation(translation); return row; }
      const t = findAnchor(translation) ? translation : [0, 0, 0];
      const uniform = (value) => affineScaleAbout(axes, [value, value, value], found.anchor, t);
      let maxRadius = 0;
      for (let i = 0; i < n; i += 1) {
        maxRadius = Math.max(maxRadius, Math.hypot(world[i * 3] + t[0] - found.anchor[0], world[i * 3 + 1] + t[1] - found.anchor[1], world[i * 3 + 2] + t[2] - found.anchor[2]));
      }
      let safe = Math.min(1, 0.999 * (found.depth - field.target) / Math.max(maxRadius, 1e-9));
      while (safe > 1e-6 && !feasible(uniform(safe))) safe *= 0.5;
      if (!(safe > 1e-6)) { row.status = 'failed'; row.mode = 'uniform_unreachable'; row.affine = affineTranslation(t); return row; }
      let lo = safe, hi = 0.3;
      for (let step = 0; step < o.bisectionSteps; step += 1) { const mid = (lo + hi) / 2; if (feasible(uniform(mid))) lo = mid; else hi = mid; }
      best = { mode: 'uniform_interior_ball', width: lo, length: lo, affine: uniform(lo), translation: t };
    }
    row.articular_displacement_mm = maxPinnedMotion(world, pin, best.affine, null) * 1000;
    row.mode = best.mode; row.scale_width = best.width; row.scale_length = best.length;
    row.translation_mm = Math.hypot(...best.translation) * 1000; row.affine = best.affine;
    return row;
  }
}

function toMatrix(affine) {
  const [a0, a1, a2, b0, a3, a4, a5, b1, a6, a7, a8, b2] = affine;
  return [a0, a3, a6, 0, a1, a4, a7, 0, a2, a5, a8, 0, b0, b1, b2, 1];
}
