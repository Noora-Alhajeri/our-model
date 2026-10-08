// Anatomical (SKEL-level) joints for bones that the 31-joint rig cannot move correctly.
// Shared by the browser, the containment precompute and (ported 1:1) MuJoCo playback
// (src/hms_mujoco/anatomical_joints.py). All matrices are 4x4 column-major (three.js order).
//
// Forearm: the rig's forearm rotation Q = R_arm^-1 R_forearm is split into swing and twist about
//   the forearm axis a0 (elbow -> wrist). The ulna keeps only the swing (it hinges on the humerus);
//   the radius additionally turns about the radioulnar axis u (radial head -> ulnar head) by the
//   total pronation phi = twist(Q) + twist(R_forearm^-1 R_hand)  (the wrist itself does not twist).
// Shoulder: scapulohumeral rhythm (Inman 1944, 2:1): the scapula rotates upward by
//   psi = K (max(theta, 30deg) - max(theta0, 30deg)) (setting phase), theta = arm elevation from the thorax's downward axis, about the
//   thorax's forward axis through the point midway between glenoid and acromioclavicular joint; the
//   clavicle turns about the sternoclavicular joint so its lateral end follows the acromion.
// Spine: the rig bends the column at 6 joints (Hips, LowerBack, Spine, Spine1, Neck, Neck1, Head);
//   each vertebra between two consecutive joint pivots a, b (rest parameter w along a -> b) turns by
//   slerp(R_a, R_b, w) and its centre goes to (1 - w) M_a c + w M_b c, so the column bends smoothly
//   instead of in rigid blocks. Thoracic vertebrae above Spine1's pivot stay with Spine1 (ribs 1-7
//   and the sternum are rigid with it); ribs follow their vertebra.

export const RHYTHM_K = 1 / 3;
export const RHYTHM_LIMITS = [-0.35, 1.0]; // radians of scapular rotation
export const SETTING_PHASE = 30 * Math.PI / 180; // Inman: little scapular motion below ~30 deg elevation

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (norm(a) || 1));

// 3x3 helpers (row-major arrays of 9)
const rot3 = (m) => [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]; // from column-major 4x4
const mul3 = (a, b) => { const r = new Array(9); for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; };
const tr3 = (a) => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
const apply3 = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const applyAffine = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];

function axisAngle(axis, angle) {
  const [x, y, z] = unit(axis), c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

function quatFromRot(m) { // row-major 3x3 -> [w, x, y, z]
  const tr = m[0] + m[4] + m[8];
  let w, x, y, z;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = .25 * s; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / s; x = .25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s; }
  else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = .25 * s; z = (m[5] + m[7]) / s; }
  else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = .25 * s; }
  return [w, x, y, z];
}

// Twist angle of rotation m (row-major 3x3) about unit axis a (swing-twist decomposition).
export function twistAngle(m, a) {
  const [w, x, y, z] = quatFromRot(m);
  return 2 * Math.atan2(x * a[0] + y * a[1] + z * a[2], w);
}

// Compose world map x -> R (x - p) + q as column-major 4x4.
function affineAbout(R, p, q) {
  const t = sub(q, apply3(R, p));
  return Float64Array.from([R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1]);
}

function compose(a, b) { // column-major a * b
  const r = new Float64Array(16);
  for (let c = 0; c < 4; c += 1) for (let rr = 0; rr < 4; rr += 1) {
    let s = 0; for (let k = 0; k < 4; k += 1) s += a[k * 4 + rr] * b[c * 4 + k]; r[c * 4 + rr] = s;
  }
  return r;
}

function quatToRot([w, x, y, z]) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}

function slerpRot(a, b, t) { // row-major 3x3 rotations
  const qa = quatFromRot(a); let qb = quatFromRot(b);
  let d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  if (d < 0) { qb = qb.map((v) => -v); d = -d; }
  let ka, kb;
  if (d > 0.9995) { ka = 1 - t; kb = t; } else { const th = Math.acos(d), s = Math.sin(th); ka = Math.sin((1 - t) * th) / s; kb = Math.sin(t * th) / s; }
  const q = [0, 1, 2, 3].map((i) => ka * qa[i] + kb * qb[i]), n = Math.hypot(...q);
  return quatToRot(q.map((v) => v / n));
}

export const SPINE_CHAIN = ['Hips', 'LowerBack', 'Spine', 'Spine1', 'Neck', 'Neck1', 'Head'];

function centroidWhere(points, predicate) {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const p of points) if (predicate(p)) { sx += p[0]; sy += p[1]; sz += p[2]; n += 1; }
  return n ? [sx / n, sy / n, sz / n] : null;
}

// boneRest: Float32Array (V*3) world rest; meshes: [{name, vertex_start, vertex_count, control_index}]
// bindRowMajor: Float32Array (J*16) row-major bind frames; names, parents: rig.
export function prepareAnatomicalJoints({ boneRest, meshes, bindRowMajor, names, parents }) {
  const meshIndex = new Map(meshes.map((m, i) => [m.name, i]));
  const joint = (n) => names.indexOf(n);
  const origin = (j) => [bindRowMajor[j * 16 + 3], bindRowMajor[j * 16 + 7], bindRowMajor[j * 16 + 11]];
  const points = (name) => { const m = meshes[meshIndex.get(name)], out = []; for (let v = m.vertex_start; v < m.vertex_start + m.vertex_count; v += 1) out.push([boneRest[v * 3], boneRest[v * 3 + 1], boneRest[v * 3 + 2]]); return out; };
  const has = (...n) => n.every((x) => meshIndex.has(x));
  const toe = joint('RightToeBase'), foot = joint('RightFoot');
  const forward = unit([origin(toe)[0] - origin(foot)[0], origin(toe)[1] - origin(foot)[1], 0]);
  const sternum = has('Sternum') ? centroidWhere(points('Sternum'), () => true) : null;
  const sides = [];
  for (const [side, suffix] of [['Right', ''], ['Left', '_mirror']]) {
    const A = joint(side + 'Arm'), F = joint(side + 'ForeArm'), H = joint(side + 'Hand'), S = joint(side + 'Shoulder');
    if ([A, F, H, S].some((j) => j < 0) || !has('ulna' + suffix, 'radius' + suffix, 'humerus' + suffix, 'scapula' + suffix, 'clavicle' + suffix)) continue;
    const e0 = origin(F), w0 = origin(H), a0 = unit(sub(w0, e0));
    const radius = points('radius' + suffix), ulna = points('ulna' + suffix);
    const tr = radius.map((p) => dot(sub(p, e0), a0)), tu = ulna.map((p) => dot(sub(p, e0), a0));
    const [rmin, rmax] = [Math.min(...tr), Math.max(...tr)], [umin, umax] = [Math.min(...tu), Math.max(...tu)];
    const rp = centroidWhere(radius, (p) => dot(sub(p, e0), a0) < rmin + .15 * (rmax - rmin));
    const ud = centroidWhere(ulna, (p) => dot(sub(p, e0), a0) > umax - .12 * (umax - umin));
    // shoulder landmarks
    const s0 = origin(A), h0 = unit(sub(origin(F), s0));
    const humerus = points('humerus' + suffix), th = humerus.map((p) => dot(sub(p, s0), h0));
    const [hmin, hmax] = [Math.min(...th), Math.max(...th)];
    const g0 = centroidWhere(humerus, (p) => dot(sub(p, s0), h0) < hmin + .12 * (hmax - hmin));
    const clav = points('clavicle' + suffix), ref = sternum || [0, 0, origin(S)[2]];
    const dc = clav.map((p) => norm(sub(p, ref))); const [cmin, cmax] = [Math.min(...dc), Math.max(...dc)];
    const sc0 = centroidWhere(clav, (p) => norm(sub(p, ref)) < cmin + .12 * (cmax - cmin));
    const ac0 = centroidWhere(clav, (p) => norm(sub(p, ref)) > cmax - .12 * (cmax - cmin));
    const theta0 = Math.acos(Math.max(-1, Math.min(1, dot(h0, [0, 0, -1]))));
    // sign: positive psi must move the scapula's inferior angle away from the midline (upward rotation)
    const scap = points('scapula' + suffix); let low = scap[0];
    for (const p of scap) if (p[2] < low[2]) low = p;
    const moved = add(apply3(axisAngle(forward, .1), sub(low, g0)), g0);
    const sigma = Math.abs(moved[0]) > Math.abs(low[0]) ? 1 : -1;
    sides.push({ side, A, F, H, S, parentS: parents[S], e0, a0, rp, u: unit(sub(ud, rp)), g0, h0, theta0, sigma, sc0, ac0, forward,
      ulna: meshIndex.get('ulna' + suffix), radius: meshIndex.get('radius' + suffix),
      scapula: meshIndex.get('scapula' + suffix), clavicle: meshIndex.get('clavicle' + suffix) });
  }
  // spine
  const spine = [], chain = SPINE_CHAIN.map(joint);
  if (chain.every((j) => j >= 0)) {
    const pivots = chain.map(origin);
    const vertebrae = meshes.map((m, i) => [m.name, i]).filter(([n]) => /^(lumbar\d|thoracic\d+|cerv\d|rotatedcerv7)$/.test(n));
    for (const [name, index] of vertebrae) {
      const c = centroidWhere(points(name), () => true);
      const thoracic = name.startsWith('thoracic'), cervical = name.includes('cerv');
      // segments a -> b allowed for this vertebra: lumbar/thoracic LowerBack..Spine1, cervical Spine1..Head
      const segments = cervical ? [3, 4, 5] : [1, 2];
      let best = null;
      for (const i of segments) {
        const d = sub(pivots[i + 1], pivots[i]), t = dot(sub(c, pivots[i]), d) / dot(d, d);
        const tc = Math.max(0, Math.min(1, t)), off = norm(sub(c, add(pivots[i], scale(d, tc))));
        if (!best || off < best.off - 1e-12) best = { i, w: tc, off };
      }
      if (thoracic && best.i === 2 && best.w >= 1) continue;   // above Spine1's pivot: rigid with Spine1
      const member = { mesh: index, a: chain[best.i], b: chain[best.i + 1], w: best.w, c, ribs: [] };
      if (thoracic) {
        const level = name.slice('thoracic'.length);
        for (const rib of ['Rib' + level + 'R', 'Rib' + level + 'L']) if (meshIndex.has(rib)) member.ribs.push(meshIndex.get(rib));
      }
      spine.push(member);
    }
  }
  return sides.length || spine.length ? { sides, spine } : null;
}

// delta(j): Float64Array/Float32Array(16) column-major world delta of rig joint j.
// Returns Map(meshIndex -> column-major 4x4) for the derived bones, plus per-side angles.
export function derivedBoneMatrices(info, delta) {
  const out = new Map(), angles = [];
  if (!info) return { matrices: out, angles };
  for (const s of info.sides) {
    const DA = delta(s.A), DF = delta(s.F), DH = delta(s.H), DS = delta(s.S), DP = s.parentS >= 0 ? delta(s.parentS) : null;
    const RA = rot3(DA), RF = rot3(DF), RH = rot3(DH);
    const Q = mul3(tr3(RA), RF), P = mul3(tr3(RF), RH);
    const phiF = twistAngle(Q, s.a0), phi = phiF + twistAngle(P, s.a0);
    const RulnaRel = mul3(Q, axisAngle(s.a0, -phiF)); // Q = swing * twist  ->  swing = Q twist^-1
    const Rulna = mul3(RA, RulnaRel);
    const ulna = affineAbout(Rulna, s.e0, applyAffine(DF, s.e0));
    const spin = affineAbout(axisAngle(s.u, phi), s.rp, s.rp);
    out.set(s.ulna, ulna); out.set(s.radius, compose(ulna, spin));
    // scapulohumeral rhythm
    const ht = apply3(RA, s.h0), down = DP ? apply3(rot3(DP), [0, 0, -1]) : [0, 0, -1];
    const theta = Math.acos(Math.max(-1, Math.min(1, dot(unit(ht), unit(down)))));
    const psi = Math.max(RHYTHM_LIMITS[0], Math.min(RHYTHM_LIMITS[1], RHYTHM_K * (Math.max(theta, SETTING_PHASE) - Math.max(s.theta0, SETTING_PHASE))));
    const axis = DP ? apply3(rot3(DP), s.forward) : s.forward;
    // pivot halfway between glenoid and acromioclavicular point: both joints move by half
    const gt = scale(add(applyAffine(DS, s.g0), applyAffine(DS, s.ac0)), .5);
    const turn = affineAbout(axisAngle(axis, s.sigma * psi), gt, gt);
    const scapula = compose(turn, DS); out.set(s.scapula, scapula);
    const sct = applyAffine(DS, s.sc0), acBase = sub(applyAffine(DS, s.ac0), sct), acNew = sub(applyAffine(scapula, s.ac0), sct);
    const c = cross(unit(acBase), unit(acNew)), sn = norm(c), cs = dot(unit(acBase), unit(acNew));
    const Rc = sn > 1e-12 ? axisAngle(c, Math.atan2(sn, cs)) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    out.set(s.clavicle, compose(affineAbout(Rc, sct, sct), DS));
    angles.push({ side: s.side, pronation_rad: phi, forearm_twist_rad: phiF, scapular_rotation_rad: psi });
  }
  for (const v of info.spine || []) {
    const Ma = delta(v.a), Mb = delta(v.b);
    const R = slerpRot(rot3(Ma), rot3(Mb), v.w);
    const p = add(scale(applyAffine(Ma, v.c), 1 - v.w), scale(applyAffine(Mb, v.c), v.w));
    const M = affineAbout(R, v.c, p);
    out.set(v.mesh, M);
    for (const rib of v.ribs) out.set(rib, M);
  }
  return { matrices: out, angles };
}
