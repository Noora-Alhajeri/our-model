// Inactive standalone transport. The gallery must explicitly install both layers together.
export const COUPLED_KNEE_CASE = 'teen_female_weight050';
export const COUPLED_KNEE_CLIP = 'kick_steps';
export const COUPLED_KNEE_ASSET = 'coupled_knee_motion.json';
export const COUPLED_KNEE_FALSE_CLAIMS = Object.freeze([
  'whole_body_containment_certified', 'continuous_motion_certified', 'full_surface_containment_certified',
  'anatomical_fit_validated', 'physics_validated', 'clinical_anatomy_validated',
  'continuous_motion_containment_certified', 'continuous_runtime_containment_certified',
  'anatomical_solid_validated', 'bone_contact_validated',
]);
const NAMES = ['r_patella', 'l_patella'];
const ARRAY_NAMES = ['bone_times', 'bone_rotations', 'bone_translations', 'skin_times', 'skin_offsets'];
const CLIPS = ['idle', 'kick_steps', 'neutral', 'punch_steps', 'run', 'walk'];
const REST_LIMIT = .007;
const SAMPLE_COLUMNS = ['before_exterior_count', 'after_exterior_count', 'before_unknown_count', 'after_unknown_count',
  'new_known_exterior_count', 'unknown_to_known_exterior_count', 'worsened_known_exterior_count', 'new_unknown_count'];
const PROOF_METHODS = ['atlas_triangle_proof.py', 'atlas_exact_projection_bound.py',
  'degenerate_simplex_guard.py', 'exact_dyadic_ray_parity.py'];
const verifiedPublications = new WeakMap();
const fail = (message) => { throw new Error(`Coupled knee: ${message}`); };
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => record(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const empty = (value) => Array.isArray(value) && value.length === 0;
const sortedValue = (value) => Array.isArray(value) ? value.map(sortedValue)
  : record(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedValue(value[key])])) : value;
const equal = (a, b) => JSON.stringify(sortedValue(a)) === JSON.stringify(sortedValue(b));
const raw = (value) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
const bytesEqual = (a, b) => {
  const first = raw(a), second = raw(b);
  return first.length === second.length && first.every((value, index) => value === second[index]);
};

async function sha(bytes) {
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), (value) => value.toString(16).padStart(2, '0')).join('');
}

function uniqueJSON(text) {
  const value = JSON.parse(text), stack = [];
  // JSON.parse owns grammar validation; this token walk only rejects duplicate decoded object keys.
  for (const token of text.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]/gs) || []) {
    if (token === '{' || token === '[') stack.push({ object: token === '{', key: true, seen: new Set() });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',') { if (stack.at(-1)?.object) stack.at(-1).key = true; }
    else if (token[0] === '"' && stack.at(-1)?.object && stack.at(-1).key) {
      const frame = stack.at(-1), key = JSON.parse(token);
      if (frame.seen.has(key)) fail('duplicate JSON object key');
      frame.seen.add(key); frame.key = false;
    }
  }
  return value;
}

async function checkedArray(value, identity, dtype, shape, label) {
  const Type = { float32: Float32Array, float64: Float64Array, uint16: Uint16Array, uint32: Uint32Array }[dtype];
  if (!keys(identity, ['dtype', 'shape', 'sha256']) || identity.dtype !== dtype
      || !Type || !(value instanceof Type)
      || !equal(identity.shape, shape) || !hash(identity.sha256)
      || value.length !== shape.reduce((a, b) => a * b, 1)
      || await sha(raw(value)) !== identity.sha256) fail(`${label} array identity differs`);
}

function rawIdentity(value, dtype, shape, label) {
  if (!keys(value, ['dtype', 'shape', 'sha256']) || value.dtype !== dtype
      || !equal(value.shape, shape) || !hash(value.sha256)) fail(`${label} raw native identity differs`);
}

async function decode(entry, dtype, shape) {
  if (!keys(entry, ['dtype', 'shape', 'sha256', 'values']) || entry.dtype !== dtype
      || !equal(entry.shape, shape) || !Array.isArray(entry.values)
      || entry.values.length !== shape.reduce((a, b) => a * b, 1)
      || !entry.values.every(numeric)) fail('invalid trajectory encoding');
  const value = dtype === 'float64' ? Float64Array.from(entry.values) : Float32Array.from(entry.values);
  if (!value.every(Number.isFinite)) fail('trajectory overflow');
  const identity = { dtype: entry.dtype, shape: entry.shape, sha256: entry.sha256 };
  await checkedArray(value, identity, dtype, shape, 'trajectory');
  return value;
}

export function coupledKneeDenseTimes(times) {
  if (!times || times.length < 2 || !Array.from(times).every(numeric)
      || Array.from(times).some((time, index) => index > 0 && time <= times[index - 1])) fail('invalid source timing');
  const result = [];
  for (let index = 0; index < times.length; index += 1) {
    result.push(times[index]);
    if (index + 1 < times.length) {
      const midpoint = times[index] * .5 + times[index + 1] * .5;
      if (!(times[index] < midpoint && midpoint < times[index + 1])) fail('unrepresentable source midpoint');
      result.push(midpoint);
    }
  }
  return result;
}

function bracket(times, stamp) {
  if (!numeric(stamp) || stamp < times[0] || stamp > times.at(-1)) fail('invalid or extrapolated seek');
  let left = 0, right = times.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (times[middle] <= stamp) left = middle + 1; else right = middle;
  }
  const low = Math.max(0, left - 1), high = Math.min(low + 1, times.length - 1);
  return [low, high, high === low ? 0 : (stamp - times[low]) / (times[high] - times[low])];
}

// Float64 blend, Float32 offset, Float64 addition, then Float32 rest serialization.
export function coupledKneeRestAt(rest, times, offsets, stamp) {
  const [low, high, alpha] = bracket(times, stamp), result = rest.slice();
  if (!(rest instanceof Float32Array) || !(offsets instanceof Float32Array)
      || offsets.length !== rest.length * times.length) fail('original full-order Float32 rest/offsets required');
  for (let index = 0; index < rest.length; index += 3) {
    const field = [0, 1, 2].map((axis) => Math.fround((1 - alpha) * offsets[low * rest.length + index + axis]
      + alpha * offsets[high * rest.length + index + axis]));
    // Native preserves the complete source vertex bytes when its entire offset is zero.
    if (field.every((value) => value === 0)) continue;
    for (let axis = 0; axis < 3; axis += 1) result[index + axis] = rest[index + axis] + field[axis];
  }
  if (!result.every(Number.isFinite)) fail('nonfinite corrected rest');
  return result;
}

export function coupledKneeFramesAt(THREE, times, rotations, translations, stamp) {
  const [low, high, alpha] = bracket(times, stamp);
  const frames = {};
  for (let index = 0; index < 2; index += 1) {
    const first = new THREE.Quaternion().fromArray(rotations, (low * 2 + index) * 4);
    const second = new THREE.Quaternion().fromArray(rotations, (high * 2 + index) * 4);
    first.slerp(second, alpha).normalize();
    const position = new THREE.Vector3(...[0, 1, 2].map((axis) =>
      (1 - alpha) * translations[(low * 2 + index) * 3 + axis]
      + alpha * translations[(high * 2 + index) * 3 + axis]));
    frames[NAMES[index]] = new THREE.Matrix4().compose(position, first, new THREE.Vector3(1, 1, 1)).elements.slice();
  }
  return frames;
}

export async function loadCoupledKneePublication({ manifest, caseId, manifestURL, signal, fetchBytes }) {
  const asset = manifest?.coupled_knee_motion_asset;
  if (asset === undefined) return null;
  if (!keys(asset, ['data_url', 'sha256', 'case_ids']) || asset.data_url !== COUPLED_KNEE_ASSET
      || !hash(asset.sha256) || !equal(asset.case_ids, [COUPLED_KNEE_CASE])) fail('invalid publication registry');
  if (caseId !== COUPLED_KNEE_CASE) return null;
  const url = new URL(asset.data_url, manifestURL);
  let bytes;
  if (fetchBytes) bytes = await fetchBytes(url, signal);
  else {
    const response = await fetch(url, { signal });
    if (!response.ok) fail('published two-layer asset could not be loaded');
    bytes = await response.arrayBuffer();
  }
  const owned = new Uint8Array(bytes instanceof ArrayBuffer ? bytes : raw(bytes)).slice();
  if (await sha(owned) !== asset.sha256) fail('publication checksum differs');
  const collection = uniqueJSON(new TextDecoder('utf-8', { fatal: true }).decode(owned));
  if (!keys(collection, ['schema', 'case_tracks']) || collection.schema !== 'atlas_coupled_knee_motion_collection_v1'
      || !keys(collection.case_tracks, [COUPLED_KNEE_CASE])) fail('publication collection differs');
  const handle = Object.freeze({ case_id: caseId, data_url: asset.data_url, sha256: asset.sha256 });
  verifiedPublications.set(handle, collection.case_tracks[caseId]);
  return handle;
}

async function sourceMatches(model, payload, disjointRegional = null) {
  const source = payload.source, names = Object.keys(model.motions).sort();
  const meshes = model.activeBoneMeshes || model.sourceBoneMeshes;
  const arrays = { skin_positions: model.skinRest, skin_indices: model.skinIndices, skin_weights: model.skinWeights,
    bone_positions: model.boneRest, bind_frames: model.sourceBindFrames,
    skin_faces: model.sourceTopology.skin_faces, bone_faces: model.sourceTopology.bone_faces };
  if (!keys(source, ['case_id', 'arrays', 'rig', 'bone_meshes', 'motions', 'runtime'])
      || source.case_id !== COUPLED_KNEE_CASE || !equal(names, CLIPS)
      || !keys(source.arrays, Object.keys(arrays)) || !equal(source.rig, model.sourceRig)
      || !equal(source.bone_meshes, meshes) || !keys(source.motions, names)
      || meshes.length !== 132 || new Set(meshes.map((row) => row.name)).size !== 132) fail('predecessor structure differs');
  const dtypes = { skin_positions: 'float32', bone_positions: 'float32', skin_weights: 'float32',
    skin_indices: 'uint16', skin_faces: 'uint32', bone_faces: 'uint32', bind_frames: 'float32' };
  for (const [name, array] of Object.entries(arrays)) {
    if (!ArrayBuffer.isView(array) || !array.every(Number.isFinite)) fail('invalid predecessor arrays');
    await checkedArray(array, source.arrays[name], dtypes[name], model.sourceArrayShapes[name], `source ${name}`);
  }
  if (!bytesEqual(model.skin.geometry.index.array, arrays.skin_faces)) fail('rendered skin topology differs');
  if (model.bones.length !== 132 || new Set(model.bones.map((row) => row.spec.name)).size !== 132
      || model.bones.some((row) => row.control !== row.spec.control_index
        || !equal(row.spec, meshes.find((mesh) => mesh.name === row.spec.name)))) fail('rendered bone ownership differs');
  for (const row of model.bones) {
    const expected = arrays.bone_positions.subarray(row.spec.vertex_start * 3, (row.spec.vertex_start + row.spec.vertex_count) * 3);
    if (!bytesEqual(row.mesh.geometry.getAttribute('position').array, expected)) fail('rendered bone geometry differs');
    const faces = arrays.bone_faces.subarray(row.spec.index_start, row.spec.index_start + row.spec.index_count);
    const renderedFaces = row.mesh.geometry.index?.array;
    if (!renderedFaces || renderedFaces.length !== faces.length
        || faces.some((value, index) => renderedFaces[index] !== value - row.spec.vertex_start)) fail('rendered bone topology differs');
  }
  for (const [clip, motion] of Object.entries(model.motions)) {
    const declared = source.motions[clip];
    if (!record(motion.sourceMetadata) || !record(declared) || !keys(declared.transforms, ['array'])) fail('source recording metadata missing');
    await checkedArray(motion.sourceTransforms, declared.transforms.array, 'float32', [motion.times.length, model.jointCount, 4, 4], 'recorded transforms');
    const actualMeta = { ...motion.sourceMetadata }, declaredMeta = { ...declared };
    delete actualMeta.transforms; delete declaredMeta.transforms;
    if (keys(declared.times, ['array'])) {
      await checkedArray(motion.times, declared.times.array, 'float64', [motion.times.length], 'recorded times');
      actualMeta.times = declared.times;
    } else actualMeta.times = Array.from(motion.times);
    if (!equal(actualMeta, declaredMeta)) fail('recording timing or metadata differs');
  }
  const runtime = source.runtime;
  if (!keys(runtime, ['motion_adjustments', 'terminal_corrections', 'derived_motion_assets', 'neutral_skin_asset_sha256'])
      || !keys(runtime.derived_motion_assets, ['patella_motion_asset', 'lumbar_motion_asset'])
      || Object.values(runtime.derived_motion_assets).some((value) => value !== null)
      || model.patellaMotion != null || model.lumbarMotion != null
      || (model.regionalSkinMotion != null && disjointRegional === null)
      || model.wholeBodySkinTrack != null || !hash(runtime.neutral_skin_asset_sha256)
      || runtime.neutral_skin_asset_sha256 !== model.teenNeutralSkinRefinement?.verified_manifest_asset?.sha256
      || !(model.teenNeutralSkinRest instanceof Float32Array) || !(model.teenNeutralSkinNormals instanceof Float32Array)
      || !Object.hasOwn(model, 'terminalCorrectionsPayload') || !Object.hasOwn(model, 'motionAdjustmentsPayload')
      || !equal(runtime.terminal_corrections, model.terminalCorrectionsPayload)
      || !equal(runtime.motion_adjustments, model.motionAdjustmentsPayload)) fail('runtime or existing neutral layer differs');
  if (disjointRegional !== null) {
    if (model.regionalSkinMotion !== disjointRegional.track
        || await disjointRegional.verifySource(model) !== true) fail('validated disjoint regional source differs');
  }
  return { arrays, meshes };
}

function checkQuality(quality, native = false) {
  const gradient = quality?.maximum_serialized_edge_gradient;
  if (!record(quality) || quality.passes !== true || quality.finite_quality_values !== true
      || quality.all_original_nondegenerate_face_reversed_or_collapsed_count !== 0
      || quality.limits_are_engineering_priors_not_anatomical_truth !== true
      || quality.reversed_or_collapsed_original_face_count !== 0 || quality.zero_length_edge_changed_count !== 0
      || !numeric(quality.maximum_displacement_m) || quality.maximum_displacement_m < 0
      || quality.maximum_displacement_m > (native ? .005 : REST_LIMIT) || !numeric(gradient) || gradient < 0 || gradient > .25
      || !numeric(quality.minimum_edge_length_ratio) || !numeric(quality.maximum_edge_length_ratio)
      || quality.minimum_edge_length_ratio < .7499 || quality.maximum_edge_length_ratio > 1.2501
      || quality.minimum_edge_length_ratio > quality.maximum_edge_length_ratio
      || !numeric(quality.minimum_area_ratio) || !numeric(quality.maximum_area_ratio)
      || quality.minimum_area_ratio < .4 || quality.maximum_area_ratio > 1.9
      || quality.minimum_area_ratio > quality.maximum_area_ratio) fail('finite skin quality gate failed');
}

function checkedMethodMap(methods) {
  if (!record(methods) || Object.keys(methods).length < 4 || Object.keys(methods).length > 2048
      || Object.entries(methods).some(([path, digest]) => !path || !hash(digest))) fail('method bindings incomplete');
}

function qualificationMethods(q) {
  const old = q.historical_method_sha256, current = q.current_method_sha256;
  checkedMethodMap(old); checkedMethodMap(current);
  if (Object.keys(old).some((path) => !Object.hasOwn(current, path))) fail('historical method omitted');
  const changes = Object.keys(old).filter((path) => old[path] !== current[path]).sort();
  const bridgeable = (path) => ['cohort_native_playback.py', 'atlas_native_motion_enclosure.py'].includes(path.split('/').at(-1));
  const copies = q.explicit_historical_method_copies, snapshots = q.method_source_snapshots;
  const entry = (value) => keys(value, ['path', 'sha256']) && typeof value.path === 'string' && value.path && hash(value.sha256);
  if (!equal(changes, q.historical_method_changes) || changes.some((path) => !bridgeable(path))
      || !record(copies) || changes.some((path) => !Object.hasOwn(copies, path))
      || Object.entries(copies).some(([path, value]) => !bridgeable(path) || !entry(value)
        || old[path] !== value.sha256 || value.path === path)
      || !keys(snapshots, ['current', 'historical'])) fail('unsupported historical method bridge');
  for (const [name, expected] of [['current', current], ['historical', Object.fromEntries(Object.entries(copies).map(([path, value]) => [path, value.sha256]))]]) {
    if (!keys(snapshots[name], Object.keys(expected)) || Object.entries(snapshots[name])
      .some(([path, value]) => !entry(value) || value.sha256 !== expected[path])) fail('method snapshot inventory differs');
  }
  return current;
}

function checkProof(proof, inputs, methods, mesh, skinCount) {
  if (!record(proof) || proof.schema !== 'atlas_original_triangle_pose_proof_v1'
      || proof.status !== 'clear_under_original_even_odd_semantics'
      || proof.mathematical_surface_containment_under_original_parity_proved !== true
      || proof.clinical_or_anatomical_containment_certified !== false
      || proof.continuous_runtime_containment_certified !== false || !equal(proof.input_arrays, inputs)) fail('incomplete patella proof');
  const separation = proof.separation, parity = proof.parity;
  if (!record(separation) || separation.all_original_pairs_proved_separated !== true
      || separation.every_original_pair_accounted_for !== true || separation.original_faces_removed !== false
      || separation.clearance_m !== 0 || separation.untested_pair_count !== 0
      || separation.contact_or_clearance_witness_count !== 0 || separation.motion_enclosure_unresolved_pair_count !== 0
      || separation.original_bone_face_count !== mesh.index_count / 3
      || separation.original_skin_face_count !== skinCount
      || !count(separation.total_original_face_pairs)
      || separation.total_original_face_pairs !== mesh.index_count / 3 * skinCount
      || !count(separation.aabb_rejected_pair_count) || !count(separation.exact_clear_pair_count)
      || separation.aabb_rejected_pair_count + separation.exact_clear_pair_count !== separation.total_original_face_pairs
      || !record(parity) || parity.all_components_resolved_inside !== true
      || parity.original_skin_components_excluded !== false || parity.unknown_component_count !== 0
      || parity.outside_component_count !== 0 || !count(parity.component_count) || parity.component_count < 1
      || !Array.isArray(parity.inside) || !Array.isArray(parity.resolved)
      || parity.inside.length !== parity.component_count || parity.resolved.length !== parity.component_count
      || [...parity.inside, ...parity.resolved].some((value) => value !== true)) fail('unaccounted original triangle pairs or parity');
  checkedMethodMap(proof.method_sha256);
  if (!keys(proof.method_sha256, PROOF_METHODS)) fail('exact proof kernel inventory differs');
  for (const [leaf, digest] of Object.entries(proof.method_sha256)) {
    const matches = Object.entries(methods).filter(([path]) => path.endsWith(`/${leaf}`));
    if (matches.length !== 1 || matches[0][1] !== digest) fail('exact proof method differs');
  }
}

function checkNative(value, skinCount, boneCount) {
  if (!keys(value, ['skin', 'anatomy'])) fail('full native array inventory missing');
  rawIdentity(value.skin, '<f4', [skinCount, 3], 'skin');
  rawIdentity(value.anatomy, '<f4', [boneCount, 3], 'anatomy');
}

function checkSkinContacts(value, row, skinFaces) {
  const counts = ['unchanged_pair_identity_proof_count', 'incident_shared_index_pair_exclusions',
    'incident_closed_aabb_rejected_pair_count', 'candidate_narrow_calls'];
  const total = skinFaces.shape[0] * (skinFaces.shape[0] - 1) / 2;
  if (!record(value) || value.completed !== true || value.passes !== true
      || value.schema !== 'atlas_incident_original_skin_pair_nonincrease_v1'
      || value.degenerate_faces_retained !== true || value.anatomical_or_continuous_collision_certified !== false
      || value.all_original_pairs_accounted_for !== true || value.original_face_indices_and_adjacency_preserved !== true
      || value.original_face_count !== skinFaces.shape[0] || !empty(value.new_original_contact_pairs)
      || !equal(value.original_before, row.native_before.skin) || !equal(value.original_after, row.native_after.skin)
      || !equal(value.original_faces, skinFaces) || value.total_original_unordered_pairs !== total
      || counts.some((key) => !count(value[key])) || counts.reduce((sum, key) => sum + value[key], 0) !== total
      || !hash(value.original_contact_report_sha256) || !hash(value.candidate_incident_contact_pairs_sha256)
      || value.candidate_incident_contact_pairs_sha256 !== value.surviving_original_contact_pairs_sha256
      || !count(value.candidate_incident_contact_pair_count)
      || value.candidate_incident_contact_pair_count !== value.surviving_original_contact_pair_count
      || value.candidate_incident_contact_pair_count > value.candidate_narrow_calls) fail('original skin contact gate incomplete');
}

function checkBoneContacts(value, row, boneFaces, boneCount, inventory) {
  const before = { ...row.native_before.anatomy, shape: [1, boneCount, 3] };
  const after = { ...row.native_after.anatomy, shape: [1, boneCount, 3] };
  const summary = value?.finite_contact_summary, protocol = row.bone_contact_protocol;
  const kept = value?.retained_mesh_names, excluded = value?.excluded_mesh_names;
  if (!Array.isArray(kept) || !Array.isArray(excluded) || !equal(kept, [...new Set(kept)].sort())
      || !equal(excluded, [...new Set(excluded)].sort()) || kept.some((name) => excluded.includes(name))
      || !equal([...kept, ...excluded].sort(), inventory.map((mesh) => mesh.name).sort())
      || NAMES.some((name) => !kept.includes(name))) fail('complete bone contact partition missing');
  const k = kept.length, label = value.pose_names;
  const partitions = { expected_intermesh_pair_pose_count: 8646, unchanged_intermesh_identity_proof_count: 8385,
    retained_incident_pair_pose_count: 2 * (k - 2) + 1, excluded_incident_disjoint_pair_pose_count: 2 * (132 - k),
    expected_self_mesh_pose_count: 132, unchanged_self_identity_proof_count: 130, retained_changed_self_mesh_pose_count: 2 };
  if (!record(value) || value.all_pair_pose_coverage !== true || value.bone_mesh_count !== 132
      || value.schema !== 'atlas_complete_contact_by_incident_subset_v1' || value.accepted !== false || value.physics_valid !== false
      || Object.entries(partitions).some(([key, expected]) => value[key] !== expected)
      || !Array.isArray(label) || label.length !== 1 || typeof label[0] !== 'string'
      || !label[0].startsWith(`${COUPLED_KNEE_CLIP}:`) || Number(label[0].slice(COUPLED_KNEE_CLIP.length + 1)) !== row.time_s
      || !hash(value.mesh_metadata_sha256) || !record(protocol)
      || protocol.schema !== 'atlas_native_incident_contact_subset_v1' || !equal(protocol.poses, label)
      || protocol.full_original_mesh_count !== 132 || !equal(protocol.retained_mesh_names, kept)
      || !equal(protocol.editable_mesh_names, NAMES)
      || !equal(value.full_native_input_identities, [before, after]) || !equal(value.original_faces_identity, boneFaces)
      || value.passes_contact_filter !== true || !record(summary)
      || ['original_contact_report_sha256', 'subset_contact_sha256', 'raw_guard_sha256', 'exact_supplement_sha256', 'protocol_sha256']
        .some((key) => !hash(summary[key]))
      || ['invariant_checks_pass', 'normal_triangle_nonregression_pass', 'full_unsupported_inventory_covered',
        'lower_dimensional_nonregression_pass', 'frozen_source_arrays_unchanged', 'topology_and_owner_identities_unchanged',
        'no_original_faces_deleted', 'all_pair_pose_coverage'].some((key) => summary[key] !== true)
      || ['new_known_intermesh_face_pair_occurrences', 'new_known_self_face_pair_occurrences',
        'raw_new_vs_current_intermesh_face_pair_occurrences', 'raw_new_vs_current_self_face_pair_occurrences',
        'candidate_pairs_absent_from_original_on_evaluated_entries', 'remaining_unsupported_count',
        'new_lower_dimensional_contacts_vs_current', 'genuinely_new_contact_occurrences',
        'candidate_contact_occurrences_absent_original'].some((key) => summary[key] !== 0)
      || summary.retained_intermesh_pair_pose_count !== k * (k - 1) / 2 || summary.retained_self_mesh_pose_count !== k
      || summary.clinical_or_physics_certified !== false) fail('original bone contact gate incomplete');
}

async function validateQualification(model, payload, arrays, source) {
  const q = payload.qualification, required = coupledKneeDenseTimes(model.motions[COUPLED_KNEE_CLIP].times);
  const unscoped = Object.keys(model.motions).sort().filter((clip) => clip !== COUPLED_KNEE_CLIP)
    .flatMap((clip) => (model.motions[clip].times.length === 1 ? Array.from(model.motions[clip].times)
      : coupledKneeDenseTimes(model.motions[clip].times)).map((time) => [clip, time]));
  if (required.length !== 723 || !record(q) || q.schema !== 'atlas_coupled_knee_motion_qualification_v1'
      || q.case_id !== COUPLED_KNEE_CASE || q.clip !== COUPLED_KNEE_CLIP
      || ['completed', 'passed', 'all_required_discrete_pose_gates_passed', 'source_unchanged', 'archive_unchanged',
        'proposal_receipt_unchanged', 'resume_receipt_unchanged', 'method_snapshots_unchanged', 'source_bone_motion_absent',
        'neutral_overlay_validated', 'neutral_native_arrays_byte_identical', 'historical_to_current_native_identity_bridge_passed'].some((key) => q[key] !== true)
      || ['accepted', 'published', 'whole_body_containment_certified', 'continuous_motion_certified',
        'clinical_anatomy_validated', 'physics_validated', 'historical_copies_executed'].some((key) => q[key] !== false)
      || q.failure_reason !== null || q.error !== undefined || !empty(q.method_drift)
      || COUPLED_KNEE_FALSE_CLAIMS.some((key) => q[key] !== undefined && q[key] !== false)
      || !hash(q.source_ledger_sha256) || !keys(q.proposal_receipt, ['path', 'sha256'])
      || typeof q.proposal_receipt.path !== 'string' || !q.proposal_receipt.path || !hash(q.proposal_receipt.sha256)
      || !equal(q.required_pose_times_s, required) || !equal(q.target_mesh_names, NAMES)
      || !equal(q.transport_source, payload.source) || q.transport_source_sha256 !== payload.source_sha256
      || !equal(q.archive, payload.archive) || !keys(q.archive_arrays, ARRAY_NAMES)
      || !Array.isArray(q.poses) || q.poses.length !== required.length
      || q.geometry_identity_replay?.completed !== true || q.geometry_identity_replay?.passed !== true
      || q.geometry_identity_replay.pose_count !== required.length || !hash(q.geometry_identity_replay.original_replay_sha256)
      || q.original_report_sha256 !== payload.report_sha256 || !hash(q.original_report_metadata_sha256)
      || !equal(q.sample_columns, SAMPLE_COLUMNS)
      || q.unscoped_native_bypass?.completed !== true || q.unscoped_native_bypass?.passed !== true
      || !equal(q.unscoped_native_bypass.required_schedule, unscoped)
      || !Array.isArray(q.unscoped_native_bypass.poses) || q.unscoped_native_bypass.poses.length !== unscoped.length
      || !record(q.pose_sha256) || Object.keys(q.pose_sha256).length !== required.length
      || Object.values(q.pose_sha256).some((value) => !hash(value))
      || !keys(q.compact_pose_sha256, Object.keys(q.pose_sha256))
      || Object.values(q.compact_pose_sha256).some((value) => !hash(value))) fail('two-layer full-discrete qualification missing or failed');
  const methods = qualificationMethods(q), gateHashes = new Set(Object.values(q.pose_sha256));
  if (gateHashes.size !== required.length || new Set(q.poses.map((row) => row.original_gate_sha256)).size !== required.length
      || q.poses.some((row) => !gateHashes.has(row.original_gate_sha256))) fail('complete original gate bindings missing');
  for (const name of ARRAY_NAMES) {
    const encoded = payload.arrays[name];
    const expected = { dtype: encoded.dtype === 'float64' ? '<f8' : '<f4', shape: encoded.shape, sha256: encoded.sha256 };
    if (!equal(q.archive_arrays[name], expected)) fail('qualification archive array differs');
  }
  const skinCount = source.arrays.skin_positions.length / 3, boneCount = source.arrays.bone_positions.length / 3;
  const skinFaces = { ...payload.source.arrays.skin_faces, dtype: '<u4' };
  const boneFaces = { ...payload.source.arrays.bone_faces, dtype: '<u4' };
  const types = { float32: '<f4', uint16: '<u2', uint32: '<u4' };
  const rawSource = Object.fromEntries(Object.entries(payload.source.arrays).map(([key, value]) => [key, { ...value, dtype: types[value.dtype] }]));
  if (!equal(q.source_identity?.arrays, rawSource)) fail('qualification source arrays differ');
  const inventory = q.original_sampling_inventory;
  if (!Array.isArray(inventory) || inventory.length !== 132 || new Set(inventory.map((row) => row.name)).size !== 132
      || !equal(inventory.map((row) => row.name).sort(), source.meshes.map((row) => row.name).sort())) fail('full132 sampling inventory missing');
  let cursor = 0;
  for (const [position, row] of inventory.entries()) {
    const mesh = source.meshes.find((value) => value.name === row.name);
    const faces = source.arrays.bone_faces.subarray(mesh.index_start, mesh.index_start + mesh.index_count);
    const vertices = new Set(faces), edges = new Set();
    for (let offset = 0; offset < faces.length; offset += 3) for (let corner = 0; corner < 3; corner += 1) {
      const a = faces[offset + corner], b = faces[offset + (corner + 1) % 3];
      edges.add(`${Math.min(a, b)},${Math.max(a, b)}`);
    }
    if (row.sample_start !== cursor || !count(row.sample_count) || row.sample_count < 1
        || source.meshes[position].name !== row.name || row.sample_count !== vertices.size + edges.size + faces.length / 3
        || row.triangle_count !== mesh.index_count / 3 || !count(row.referenced_vertex_count)
        || row.referenced_vertex_count !== vertices.size
        || !count(row.omitted_unreferenced_vertex_count)
        || row.referenced_vertex_count + row.omitted_unreferenced_vertex_count !== mesh.vertex_count) fail('sample inventory changed');
    cursor += row.sample_count;
  }
  const targetFaces = {};
  for (const name of NAMES) {
    const mesh = source.meshes.find((value) => value.name === name);
    if (!mesh) fail('patella mesh missing');
    const local = BigInt64Array.from(source.arrays.bone_faces.subarray(mesh.index_start, mesh.index_start + mesh.index_count),
      (index) => BigInt(index - mesh.vertex_start));
    targetFaces[name] = { dtype: '<i8', shape: [mesh.index_count / 3, 3], sha256: await sha(raw(local)) };
  }
  for (let index = 0; index < required.length; index += 1) {
    const row = q.poses[index];
    if (row.time_s !== required[index] || row.passes !== true || !empty(row.failures)
        || row.unchanged_native_bones_checked_by_exact_bytes !== true || !Array.isArray(row.changed_native_bone_names)
        || new Set(row.changed_native_bone_names).size !== row.changed_native_bone_names.length
        || row.changed_native_bone_names.some((name) => !NAMES.includes(name))
        || !Array.isArray(row.sample_counts) || row.sample_counts.length !== 132
        || row.sample_counts.some((values) => !Array.isArray(values) || values.length !== SAMPLE_COLUMNS.length)
        || !keys(row.proofs, NAMES)) fail('pose coverage or two-layer identity differs');
    checkNative(row.native_before, skinCount, boneCount); checkNative(row.native_after, skinCount, boneCount);
    checkQuality(row.quality, true);
    for (const [meshIndex, mesh] of inventory.entries()) {
      const observation = Object.fromEntries(SAMPLE_COLUMNS.map((key, column) => [key, row.sample_counts[meshIndex][column]]));
      if (['new_known_exterior_count', 'unknown_to_known_exterior_count', 'worsened_known_exterior_count', 'new_unknown_count']
            .some((key) => observation[key] !== 0)
          || ['before_exterior_count', 'after_exterior_count', 'before_unknown_count', 'after_unknown_count']
            .some((key) => !count(observation[key]) || observation[key] > mesh.sample_count)
          || observation.before_exterior_count + observation.before_unknown_count > mesh.sample_count
          || observation.after_exterior_count + observation.after_unknown_count > mesh.sample_count
          || (NAMES.includes(mesh.name) && (observation.after_exterior_count !== 0 || observation.after_unknown_count !== 0))) fail('bone sample nonregression failed');
    }
    checkSkinContacts(row.skin_contacts, row, skinFaces);
    checkBoneContacts(row.bone_contacts, row, boneFaces, boneCount, inventory);
    for (const name of NAMES) {
      const mesh = source.meshes.find((value) => value.name === name), inputs = row.proofs[name].input_arrays;
      if (!keys(inputs, ['bone_vertices', 'bone_faces', 'skin_vertices', 'skin_faces'])
          || !equal(inputs.bone_faces, targetFaces[name]) || !equal(inputs.skin_faces, skinFaces)
          || !equal(inputs.skin_vertices, row.native_after.skin)) fail('proof source face or skin identity differs');
      rawIdentity(inputs.bone_vertices, '<f4', [mesh.vertex_count, 3], 'patella');
      checkProof(row.proofs[name], inputs, methods, mesh, skinFaces.shape[0]);
    }
  }
  for (let index = 0; index < unscoped.length; index += 1) {
    const row = q.unscoped_native_bypass.poses[index];
    if (row.clip !== unscoped[index][0] || row.time_s !== unscoped[index][1]
        || !equal(row.native_before, row.native_after)) fail('neutral or unscoped native bypass changed');
    checkNative(row.native_before, skinCount, boneCount);
  }
  return required;
}

function restQuality(before, after) {
  let displacement = 0;
  if (!(after instanceof Float32Array) || after.length !== before.length || !after.every(Number.isFinite)) fail('invalid corrected rest');
  for (let index = 0; index < before.length; index += 3) {
    displacement = Math.max(displacement, Math.hypot(after[index] - before[index], after[index + 1] - before[index + 1], after[index + 2] - before[index + 2]));
  }
  // The .25 distortion gate belongs to actual posed skin, not its inverse-LBS rest preimage.
  if (displacement > REST_LIMIT) fail('active rest field exceeds graphics budget');
  return { maximum_displacement_m: displacement };
}

function normalsAt(model, positions) {
  const geometry = model.skin.geometry.clone();
  try {
    geometry.getAttribute('position').array.set(positions); geometry.computeVertexNormals();
    const normals = geometry.getAttribute('normal').array.slice();
    if (!(normals instanceof Float32Array) || normals.length !== positions.length || !normals.every(Number.isFinite)) fail('corrected normals invalid');
    return normals;
  } finally { geometry.dispose(); }
}

function posedSkin(model, rest) {
  const positions = new Float32Array(rest.positions.length), normals = new Float32Array(rest.normals.length);
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const offset = vertex * 3, point = [0, 0, 0], normal = [0, 0, 0];
    for (let influence = 0; influence < 8; influence += 1) {
      const entry = vertex * 8 + influence, weight = model.skinWeights[entry];
      if (weight === 0) continue;
      const e = model.deltas[model.skinIndices[entry]].elements;
      for (let axis = 0; axis < 3; axis += 1) {
        point[axis] += weight * (e[axis] * rest.positions[offset] + e[4 + axis] * rest.positions[offset + 1]
          + e[8 + axis] * rest.positions[offset + 2] + e[12 + axis]);
        normal[axis] += weight * (e[axis] * rest.normals[offset] + e[4 + axis] * rest.normals[offset + 1]
          + e[8 + axis] * rest.normals[offset + 2]);
      }
    }
    positions.set(point, offset);
    const length = Math.hypot(...normal) || 1;
    normals.set(normal.map((value) => value / length), offset);
  }
  return { positions, normals };
}

export async function createCoupledKneeMotion(model, publication, THREE, sourceVerificationView = null, disjointRegional = null) {
  if (sourceVerificationView !== null && typeof sourceVerificationView !== 'function') fail('invalid source verification callback');
  if (disjointRegional !== null && (!keys(disjointRegional, ['track', 'case_id', 'clips', 'source_sha256',
    'trajectory_sha256', 'qualification_sha256', 'publication_sha256', 'verifySource', 'verifyRendered'])
      || !Object.isFrozen(disjointRegional) || disjointRegional.case_id !== COUPLED_KNEE_CASE
      || !record(disjointRegional.track) || model.regionalSkinMotion !== disjointRegional.track
      || !Array.isArray(disjointRegional.clips) || !Object.isFrozen(disjointRegional.clips)
      || !disjointRegional.clips.length || !equal(disjointRegional.clips, [...new Set(disjointRegional.clips)].sort())
      || disjointRegional.clips.some((clip) => !CLIPS.includes(clip) || clip === 'neutral' || clip === COUPLED_KNEE_CLIP)
      || ['source_sha256', 'trajectory_sha256', 'qualification_sha256', 'publication_sha256'].some((key) => !hash(disjointRegional[key]))
      || typeof disjointRegional.verifySource !== 'function' || typeof disjointRegional.verifyRendered !== 'function')) fail('invalid validated disjoint regional descriptor');
  if (!verifiedPublications.has(publication)) fail('authenticated two-layer publication required');
  const payload = structuredClone(verifiedPublications.get(publication));
  const expectedKeys = ['schema', 'case_id', 'clip', 'source', 'source_sha256', 'archive', 'arrays',
    'unchanged_clips', 'neutral_policy', 'interpolation_model', 'offset_arithmetic', 'maximum_rest_displacement_m',
    'trajectory_sha256', 'qualification', 'qualification_sha256', 'report_sha256', ...COUPLED_KNEE_FALSE_CLAIMS];
  if (!keys(payload, expectedKeys) || payload.schema !== 'atlas_coupled_knee_motion_v1'
      || payload.case_id !== COUPLED_KNEE_CASE || payload.clip !== COUPLED_KNEE_CLIP
      || ['source_sha256', 'trajectory_sha256', 'qualification_sha256', 'report_sha256'].some((key) => !hash(payload[key]))
      || !keys(payload.archive, ['path', 'sha256']) || typeof payload.archive.path !== 'string' || !payload.archive.path
      || !hash(payload.archive.sha256) || !keys(payload.arrays, ARRAY_NAMES)
      || payload.neutral_policy !== 'preserve_existing_neutral_overlay'
      || payload.interpolation_model !== 'coupled_patella_slerp_and_rest_offsets'
      || payload.offset_arithmetic !== 'float64_linear_cast_float32_then_float64_add_cast_float32'
      || payload.maximum_rest_displacement_m !== REST_LIMIT
      || !equal(payload.unchanged_clips, CLIPS.filter((clip) => clip !== 'neutral' && clip !== COUPLED_KNEE_CLIP))
      || COUPLED_KNEE_FALSE_CLAIMS.some((key) => payload[key] !== false)) fail('invalid scope or incomplete coupled payload');
  const source = await sourceMatches(model, payload, disjointRegional), arrays = {};
  const boneCount = payload.arrays.bone_times?.shape?.[0], skinCount = payload.arrays.skin_times?.shape?.[0];
  if (!Number.isSafeInteger(boneCount) || !Number.isSafeInteger(skinCount)
      || boneCount < 2 || skinCount < 2 || boneCount > 100000 || skinCount > 100000) fail('invalid knot count');
  for (const [name, dtype, shape] of [
    ['bone_times', 'float64', [boneCount]], ['bone_rotations', 'float64', [boneCount, 2, 4]],
    ['bone_translations', 'float64', [boneCount, 2, 3]], ['skin_times', 'float64', [skinCount]],
    ['skin_offsets', 'float32', [skinCount, model.skinRest.length / 3, 3]],
  ]) arrays[name] = await decode(payload.arrays[name], dtype, shape);
  for (let offset = 0; offset < arrays.skin_offsets.length; offset += 3) {
    const norm = Math.hypot(...arrays.skin_offsets.subarray(offset, offset + 3));
    if (norm > REST_LIMIT) fail('serialized rest offsets exceed the declared cap');
  }
  const originalTimes = model.motions[COUPLED_KNEE_CLIP].times;
  for (const times of [arrays.bone_times, arrays.skin_times]) {
    coupledKneeDenseTimes(times);
    if (times[0] !== originalTimes[0] || times.at(-1) !== originalTimes.at(-1)) fail('trajectory does not cover the source domain');
  }
  for (let row = 0; row < boneCount * 2; row += 1) {
    const offset = row * 4, q = arrays.bone_rotations;
    if (Math.abs(Math.hypot(...q.subarray(offset, offset + 4)) - 1) > 1e-10
        || (row >= 2 && Math.abs([0, 1, 2, 3].reduce((sum, axis) => sum + q[offset + axis] * q[offset - 8 + axis], 0)) <= 1e-10)) fail('invalid or ambiguous patella quaternion');
  }
  const schedule = await validateQualification(model, payload, arrays, source);
  const predecessor = model.skinRest.slice(), sourceBinding = structuredClone(payload.source);
  const sourceDomains = Object.fromEntries(Object.entries(model.motions)
    .map(([clip, motion]) => [clip, [motion.times[0], motion.times.at(-1)]]));
  for (const stamp of arrays.skin_times) restQuality(predecessor,
    coupledKneeRestAt(predecessor, arrays.skin_times, arrays.skin_offsets, stamp));
  // The authenticated outer bytes bind Python metadata digests; JS does not emulate Python number formatting.
  const binding = Object.freeze({ schema: payload.schema, case_id: payload.case_id, clip: payload.clip,
    source_sha256: payload.source_sha256, archive_sha256: payload.archive.sha256,
    trajectory_sha256: payload.trajectory_sha256, qualification_sha256: payload.qualification_sha256,
    report_sha256: payload.report_sha256, neutral_unchanged: true, unchanged_clips: payload.unchanged_clips.slice(),
    corrected_clips: [COUPLED_KNEE_CLIP], target_mesh_names: NAMES.slice(),
    qualified_poses: schedule.map((time_s) => ({ clip: COUPLED_KNEE_CLIP, time_s })),
    qualified_pose_count: schedule.length, runtime_accepted: true,
    ...Object.fromEntries(COUPLED_KNEE_FALSE_CLAIMS.map((key) => [key, false])) });
  const evaluate = (clip, absoluteTime) => {
    if (disjointRegional !== null && model.regionalSkinMotion !== disjointRegional.track) fail('disjoint regional track identity changed');
    if (typeof clip !== 'string' || !Object.hasOwn(sourceDomains, clip) || !numeric(absoluteTime)) fail('invalid pose selection');
    const domain = sourceDomains[clip];
    if (absoluteTime < domain[0] || absoluteTime > domain.at(-1)) fail('unscoped seek cannot extrapolate');
    if (clip !== COUPLED_KNEE_CLIP) return null;
    const positions = coupledKneeRestAt(predecessor, arrays.skin_times, arrays.skin_offsets, absoluteTime);
    restQuality(predecessor, positions);
    return { positions, normals: normalsAt(model, positions),
      frames: coupledKneeFramesAt(THREE, arrays.bone_times, arrays.bone_rotations, arrays.bone_translations, absoluteTime),
      saved_pose_qualified: schedule.includes(absoluteTime), continuous_motion_certified: false };
  };
  return Object.freeze({
    get binding() { return structuredClone(binding); },
    get publication() { return { ...publication }; },
    get disjointRegionalSkinBinding() {
      if (disjointRegional === null) return null;
      return { schema: 'atlas_disjoint_coupled_regional_skin_v1', case_id: COUPLED_KNEE_CASE,
        coupled_asset_sha256: publication.sha256, coupled_trajectory_sha256: binding.trajectory_sha256,
        coupled_qualification_sha256: binding.qualification_sha256,
        regional_publication_sha256: disjointRegional.publication_sha256,
        regional_trajectory_sha256: disjointRegional.trajectory_sha256,
        regional_qualification_sha256: disjointRegional.qualification_sha256,
        coupled_clips: [COUPLED_KNEE_CLIP], regional_clips: disjointRegional.clips.slice(),
        component_bindings_are_layer_scoped: true,
        old_coupled_unscoped_skin_bypass_evidence_is_predecessor_only: true,
        neutral_unchanged: true, new_geometric_qualification: false,
        continuous_motion_certified: false, whole_body_containment_certified: false };
    },
    evaluate,
    verifyNativeBinding(value) {
      if (value === null || value === undefined) return false;
      if (!keys(value, Object.keys(binding)) || !equal(value, binding)) fail('native two-layer binding conflicts');
      return true;
    },
    async verifyRendered(clip, absoluteTime) {
      const sourceModel = sourceVerificationView === null ? model : await sourceVerificationView(model);
      await sourceMatches(sourceModel, { source: sourceBinding }, disjointRegional);
      const appended = !Object.hasOwn(sourceDomains, clip);
      if (appended) {
        const motion = model.motions[clip];
        if (sourceVerificationView === null || sourceModel === model || Object.hasOwn(sourceModel.motions, clip)
            || !model.stressMotionIds?.has(clip) || motion?.stressTest !== true || !numeric(absoluteTime)
            || !motion.times?.length || absoluteTime < motion.times[0] || absoluteTime > motion.times.at(-1)) fail('unqualified stress pose selection differs');
      }
      const expected = appended ? null : evaluate(clip, absoluteTime);
      if (expected === null) {
        if (!appended && disjointRegional?.clips.includes(clip)) {
          const regional = await disjointRegional.verifyRendered(clip, absoluteTime);
          if (regional?.active !== true || regional.binding?.source_sha256 !== disjointRegional.source_sha256
              || regional.binding?.trajectory_sha256 !== disjointRegional.trajectory_sha256
              || regional.binding?.qualification_sha256 !== disjointRegional.qualification_sha256
              || model.bones.some((bone) => !equal(bone.mesh.matrix.elements, model.deltas[bone.control].elements))) fail('disjoint rendered regional skin or original-owner bones differ');
          return { active: false, predecessor_bypass: false, disjoint_regional_skin: true,
            regional_skin_motion: regional, coupled_unscoped_skin_evidence_is_predecessor_only: true,
            saved_pose_qualified: false, continuous_motion_certified: false };
        }
        const fallback = clip === 'neutral'
          ? { positions: model.teenNeutralSkinRest, normals: model.teenNeutralSkinNormals }
          : posedSkin(model, { positions: predecessor, normals: model.normalRest });
        if (model.skin.geometry.getAttribute('position').array !== model.skinPositions
            || !bytesEqual(fallback.positions, model.skinPositions)
            || !bytesEqual(fallback.normals, model.skin.geometry.getAttribute('normal').array)
            || model.bones.some((bone) => !equal(bone.mesh.matrix.elements, model.deltas[bone.control].elements))) fail('unscoped rendered predecessor differs');
        return { active: false, predecessor_bypass: true,
          ...(appended ? { stress_test: true, saved_pose_qualified: false, continuous_motion_certified: false } : {}) };
      }
      const posed = posedSkin(model, expected);
      if (model.skin.geometry.getAttribute('position').array !== model.skinPositions
          || !bytesEqual(posed.positions, model.skinPositions)
          || !bytesEqual(posed.normals, model.skin.geometry.getAttribute('normal').array)) fail('rendered skin positions or normals differ');
      for (const name of NAMES) {
        const bone = model.bones.find((row) => row.spec.name === name);
        if (!bone || !equal(bone.mesh.matrix.elements, expected.frames[name])) fail('rendered patella frame differs');
      }
      if (disjointRegional !== null && model.bones.some((bone) => !NAMES.includes(bone.spec.name)
          && !equal(bone.mesh.matrix.elements, model.deltas[bone.control].elements))) fail('unmodified original-owner bone frame differs');
      return { active: true, saved_pose_qualified: expected.saved_pose_qualified,
        binding: structuredClone(binding), continuous_motion_certified: false };
    },
  });
}
