import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { ContainmentProjector } from './containment_projection.js';
import { prepareAnatomicalJoints, derivedBoneMatrices } from './anatomical_joints.js';

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  'subject-select', 'age-select', 'sex-select', 'weight-select', 'case-count',
  'height-value', 'torso-value', 'thigh-value', 'skin-toggle', 'anatomy-toggle',
  'rig-toggle', 'opacity-slider', 'opacity-value', 'age-warning', 'report-link',
  'verified-pose-field', 'verified-pose-select', 'verified-pose-status',
  'life-stage', 'scene-title', 'scene-subtitle', 'bone-count', 'joint-count',
  'loading-overlay', 'loading-label', 'error-overlay', 'error-message',
  'motion-select', 'replay-button', 'play-button', 'time-slider', 'time-value',
  'speed-select', 'frame-value', 'motion-source', 'motion-source-link', 'motion-license-link',
  'renderer-select', 'renderer-status', 'native-frame', 'native-loading',
  'camera-follow', 'camera-metric', 'metric-scale-guide',
  'cohort-tab', 'measurements-tab', 'cohort-panel', 'measurement-panel',
  'measurement-form', 'measurement-fields', 'measurement-defaults', 'generate-skin',
  'cancel-generation', 'generation-progress', 'generation-status', 'generation-error',
  'measurement-results', 'measurement-residuals', 'download-measurements',
  'pediatric-presets', 'pediatric-preset', 'pediatric-preset-summary', 'pediatric-preset-boundary',
  'pediatric-reference', 'pediatric-extent-summary', 'pediatric-source-link',
  'generated-layer-actions', 'add-rig', 'add-anatomy',
  'measurement-reference', 'reference-title', 'reference-close', 'reference-scene',
  'reference-figure-label', 'reference-loading', 'reference-protocol', 'reference-measured',
  'reference-target', 'reference-bilateral', 'reference-range', 'reference-sources', 'reference-error',
  'reference-subject', 'reference-position', 'reference-previous', 'reference-next',
  'recorded-controls', 'physics-controls', 'physics-reset', 'physics-play', 'physics-push',
  'physics-mass', 'physics-proxies', 'physics-time', 'physics-source', 'physics-mass-status', 'physics-error',
  'containment-open', 'containment-summary', 'containment-dialog', 'containment-subject', 'containment-close',
  'containment-scope', 'containment-status', 'containment-progress', 'containment-progress-label', 'containment-error',
  'containment-results', 'containment-violations', 'containment-exterior', 'containment-unknown', 'containment-clearance',
  'containment-coverage', 'containment-intersections', 'containment-criterion', 'containment-method',
  'containment-parity', 'containment-surface-bounds', 'containment-assumptions', 'containment-coordinate-reference',
  'containment-regions-label', 'containment-region-rows', 'containment-download', 'containment-run', 'containment-cancel',
  'containment-projection-toggle', 'containment-projection-status',
].map((id) => [id, $(id)]));
const manifestURL = new URL('./manifest.json', window.location.href);
let referenceManifestURL = new URL('./reference_motions/manifest.json', manifestURL);
let referenceBankDirectory = 'reference_motions';
const state = {
  loaded: false, caseId: null, motionId: null, time: 0, duration: 0,
  playing: false, speed: 1, renderFrame: 0, error: null, camera: 'front', followMotion: true, metricFraming: true,
  skin: true, anatomy: true, rig: true, opacity: .35,
  recorded_motion: false, motion_source: null, reference_available: null,
  renderer: 'gallery', nativeAvailable: false, nativeFrame: 0, nativeFrameTime: null, nativeFrameClip: null, nativeError: null,
  subjectMode: 'cohort', generated: false, generationStatus: 'idle', generationJob: null,
  simulationMode: 'playback', physicsAvailable: false, physicsPlaying: false,
  physicsTime: 0, physicsContacts: 0, physicsMass: null, physicsPhase: null, physicsFrame: 0,
  containmentStatus: 'idle', containmentJob: null,
  verifiedPose: null,
  containmentProjection: !/[?&]containment=off(&|$)/.test(window.location?.search || ''),
  containmentReport: null,
};
let containmentProjector = null;
const generatedCases = new Map();
let measurementSchema = null;
let pediatricPresets = [];
let activePediatricPreset = null;
const pediatricComparisons = new Map();
let measurementDefaultsGeneration = 0;
let measurementRun = 0;
let measurementController = null;
let measurementDownload = null;
let measurementSourceId = null;
let measurementJobURL = null;
let measurementCancelRequested = false;
let measurementReference = null;
let referenceRequest = null;
let referenceKey = null;
let manifest;
let referenceManifest = null;
let topology;
let activeModel;
let verifiedPoseCatalog;
let verifiedPoseBackup;
let verifiedPoseGeneration = 0;
let verifiedPoseURLHandled = false;
let loadController;
let loadGeneration = 0;
let scene;
let camera;
let renderer;
let controls;
let ground;
let grid;
let lastFrameTime = 0;
let poseDirty = false;
let renderDirty = true;
let nativeQueue;
let nativeRevision = 0;
let nativeImageURL = null;
let physicsQueue;
let physicsRequestSerial = 0;
let physicsControlPending = false;
let configuredPhysicsMass = null;
let physicsControlGeneration = 0;
let containmentActive = null;
let containmentResult = null;
let currentBounds = new THREE.Box3();
const cameraGeometryBounds = new THREE.Box3();
const scratchBounds = new THREE.Box3();
const unitScale = new THREE.Vector3(1, 1, 1);
const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchQuaternion2 = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchVector = new THREE.Vector3();

function refreshIcons() {
  window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });
}

function absoluteURL(path, base) {
  if (typeof path !== 'string' || !path) throw new Error('Missing asset URL.');
  const url = new URL(path, base);
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('Unsupported asset URL.');
  return url;
}

async function fetchChecked(url, signal, json = true) {
  const response = await fetch(url, { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`Asset request failed (${response.status}): ${url.pathname}`);
  return json ? response.json() : response.arrayBuffer();
}

function parseJSONBuffer(buffer, name) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch {
    throw new Error(`Invalid JSON for ${name}.`);
  }
}

async function verifyHash(buffer, expected, name) {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Missing or invalid ${name} SHA-256.`);
  if (!window.crypto?.subtle) throw new Error('Reference motion verification requires HTTPS or localhost.');
  const digest = await window.crypto.subtle.digest('SHA-256', buffer);
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error(`${name} integrity check failed. The motion and body assets do not match.`);
}

function referenceAssetURL(path, base) {
  const url = absoluteURL(path, base);
  const directory = new URL('.', referenceManifestURL);
  if (url.origin !== directory.origin || !url.pathname.startsWith(directory.pathname)
      || url.search || url.hash) throw new Error('Reference motion asset is outside its managed directory.');
  return url;
}

function selectedReferenceBank(value) {
  const directory = value === undefined ? 'reference_motions' : value;
  if (typeof directory !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(directory)) throw new Error('Invalid recorded motion bank directory.');
  return directory;
}

function referenceBankIdentity(data, directory = referenceBankDirectory) {
  const provider = data?.provider ?? (directory === 'reference_motions' ? 'cmu' : null);
  const dataset = data?.dataset ?? (directory === 'reference_motions' && provider === 'cmu' ? 'CMU' : null);
  if (!['cmu', '100style'].includes(provider) || dataset !== { cmu: 'CMU', '100style': '100STYLE' }[provider]) throw new Error('Selected recording bank has inconsistent source provenance.');
  return { provider, dataset };
}

function recordedMotionSource(source, base = referenceManifestURL) {
  if (!source || typeof source.clip !== 'string' || !source.clip.trim()
      || !Number.isFinite(source.source_fps) || source.source_fps <= 0) throw new Error('Missing recorded motion provenance.');
  const url = absoluteURL(source.url, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid recorded motion source URL.');
  if (source.dataset !== undefined && (typeof source.dataset !== 'string' || !source.dataset.trim())) throw new Error('Invalid recorded motion dataset.');
  if (source.provider !== undefined && (typeof source.provider !== 'string' || !source.provider.trim())) throw new Error('Invalid recorded motion provider.');
  const dataset = source.dataset || url.hostname;
  let licenseURL = null;
  if (source.license_url !== undefined) {
    licenseURL = absoluteURL(source.license_url, base);
    if (!['http:', 'https:'].includes(licenseURL.protocol) || licenseURL.username || licenseURL.password) throw new Error('Invalid recorded motion license URL.');
  }
  return { label: `${dataset} ${source.clip} / ${Number(source.source_fps.toFixed(2))} Hz`, url: url.href, licenseURL: licenseURL?.href || null };
}

function validateReferenceMotionCase(data, id, base) {
  const ids = Object.keys(data?.motions || {});
  const { provider, dataset } = referenceBankIdentity(referenceManifest);
  if (data?.schema !== 'gallery_reference_motion_case_v1' || data.case_id !== id
      || !data.motions || typeof data.motions !== 'object' || Array.isArray(data.motions) || !ids.length || ids.length > 64
      || ids.some((key) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(key) || ['neutral', 'constructor', 'prototype', '__proto__'].includes(key))) throw new Error('Invalid reference motion case.');
  const preferred = data.default_motion_id !== undefined ? data.default_motion_id : referenceManifest?.default_motion_id;
  if (preferred !== undefined && !Object.hasOwn(data.motions, preferred)) throw new Error('Recorded default motion is unavailable.');
  if (data.provider !== undefined && data.provider !== provider) throw new Error('Recorded motion case provider does not match its bank.');
  for (const motion of Object.values(data.motions)) {
    if (typeof motion?.label !== 'string' || !motion.label.trim()) throw new Error('Missing recorded motion label.');
    const source = { ...motion.source, license_url: motion.source?.license_url ?? referenceManifest?.license_url };
    const declared = recordedMotionSource(source, base);
    if ((source.provider !== undefined && source.provider !== provider) || (source.dataset !== undefined && source.dataset !== dataset)
        || !declared.licenseURL
        || motion.report?.recorded_motion !== true || motion.report?.time_warp_applied !== false) throw new Error('Selected recording bank has inconsistent source provenance.');
  }
  return data;
}

function nextAvailableMotion(motions, previous, preferred) {
  if (previous && Object.hasOwn(motions, previous)) return previous;
  if (Object.hasOwn(motions, 'neutral')) return 'neutral';
  if (preferred && Object.hasOwn(motions, preferred)) return preferred;
  return Object.keys(motions)[0] || null;
}

async function loadStressMotions(model, caseId, dataBytes, baseBuffer, signal) {
  const asset = manifest.stress_motion_catalog;
  if (!asset) return null;
  if (model.stressMotions !== undefined || model.stressMotionIds !== undefined
      || model.stressMotionVerification !== undefined) throw new Error('Stress motion catalog is already installed.');
  const falseClaims = ['containment_validated', 'anatomical_fit_validated', 'physics_validated',
    'age_specific_motion_validated', 'prior_motion_qualification_inherited'];
  const read = async (path, digest) => {
    if (typeof path !== 'string' || !/^stress_motions\/[A-Za-z0-9_.-]+$/.test(path)) throw new Error('Invalid stress motion path.');
    const raw = await fetchChecked(absoluteURL(path, manifestURL), signal, false);
    await verifyHash(raw, digest, 'Stress motion payload');
    return raw;
  };
  if (asset.data_url !== 'stress_motions/manifest.json') throw new Error('Invalid stress motion publication.');
  const bank = parseJSONBuffer(await read(asset.data_url, asset.sha256), 'stress catalog');
  const ids = manifest.cases.filter((row) => !row.generated).map((row) => row.id).sort();
  if (bank.schema !== 'atlas_linkage_stress_motion_bank_v1' || bank.completed !== true || bank.test_only !== true
      || falseClaims.some((key) => bank[key] !== false) || !bank.cases || Array.isArray(bank.cases)
      || JSON.stringify(Object.keys(bank.cases).sort()) !== JSON.stringify(ids)
      || !Array.isArray(asset.case_ids) || JSON.stringify([...asset.case_ids].sort()) !== JSON.stringify(ids)) throw new Error('Incomplete or overclaimed stress catalog.');
  const entry = bank.cases[caseId], path = `stress_motions/${caseId}.json`;
  if (entry?.data_url !== path) throw new Error('Stress motion case URL differs.');
  const data = parseJSONBuffer(await read(path, entry.data_sha256), 'stress case');
  if (data.schema !== 'atlas_linkage_stress_motion_case_v1' || data.case_id !== caseId || data.test_only !== true
      || falseClaims.some((key) => data[key] !== false) || data.buffer_url !== `stress_motions/${caseId}.bin`) throw new Error('Stress motion case or scope differs.');
  const sources = data.source_sha256;
  const expected = [`cases/${caseId}.json`, `cases/${caseId}.bin`, 'topology.json', 'topology.bin'];
  if (!sources || Object.keys(sources).sort().join(',') !== [...expected].sort().join(',')) throw new Error('Stress motion source binding is incomplete.');
  await verifyHash(dataBytes, sources[expected[0]], 'Stress source case');
  await verifyHash(baseBuffer, sources[expected[1]], 'Stress source geometry');
  for (const key of expected.slice(2)) await verifyHash(await fetchChecked(absoluteURL(key, manifestURL), signal, false), sources[key], 'Stress source topology');
  const buffer = await read(data.buffer_url, entry.buffer_sha256), additions = {};
  if (!data.motions || Array.isArray(data.motions) || Object.keys(data.motions).length < 1
      || Object.keys(data.motions).length > 32) throw new Error('Invalid stress motion inventory.');
  for (const [id, row] of Object.entries(data.motions)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_]{0,63}$/.test(id) || ['neutral', 'constructor', 'prototype', '__proto__'].includes(id)
        || row.stress_test !== true || typeof row.label !== 'string' || !row.label.trim()) throw new Error('Invalid stress clip.');
    if (row.motion_kind === 'recorded_retarget') {
      if (row.source?.provider !== '100style' || row.source?.dataset !== '100STYLE' || row.source?.license !== 'CC-BY-4.0'
          || row.report?.recorded_motion !== true || row.report?.time_warp_applied !== false) throw new Error('Stress recording provenance differs.');
      recordedMotionSource(row.source);
    } else if (row.motion_kind !== 'generated' || !['generated_walk_sit', 'generated_stairs'].includes(id)
        || row.source != null || row.report?.recorded_motion !== false) throw new Error('Generated stress motion claims a recording.');
    const motion = decodeMotion(row, buffer, {}, model.skeleton, id);
    motion.source = row.source || null;
    motion.stressTest = true;
    motion.motionKind = row.motion_kind;
    if (model.motions[id]) {
      const old = model.motions[id];
      const oldBytes = new Uint8Array(old.sourceTransforms.buffer, old.sourceTransforms.byteOffset, old.sourceTransforms.byteLength);
      const newBytes = new Uint8Array(motion.sourceTransforms.buffer, motion.sourceTransforms.byteOffset, motion.sourceTransforms.byteLength);
      if (old.times.length !== motion.times.length || old.times.some((x, i) => x !== motion.times[i])
          || old.sourceTransforms.constructor !== motion.sourceTransforms.constructor
          || old.sourceTransforms.length !== motion.sourceTransforms.length
          || oldBytes.some((x, i) => x !== newBytes[i])) throw new Error('Stress catalog replaces an existing motion.');
    } else additions[id] = motion;
  }
  const existing = Object.keys(model.motions);
  Object.assign(model.motions, additions);
  model.stressMotionIds = new Set(Object.keys(additions));
  model.stressMotions = { schema: bank.schema, asset_sha256: asset.sha256, test_only: true,
    data_sha256: entry.data_sha256, buffer_sha256: entry.buffer_sha256,
    ...Object.fromEntries(falseClaims.map((key) => [key, false])), added_motion_ids: Object.keys(additions),
    existing_motion_ids_preserved: existing, fitted_clip_layers_applied_to_new_motions: false,
    new_motion_bones_follow_current_original_owners: true, neutral_qualification_scope_unchanged: true };
  await retainStressMotionVerification(model);
  return model.stressMotions;
}

async function applyStressRuntime(model, binding, expected) {
  const { new_motion_adjustments: floor, new_terminal_corrections: terminal, ...identity } = binding || {};
  if (!regionalSkinEqual(identity, expected)) return false;
  if ([floor, terminal].some((payload) => !payload?.clips
      || Object.keys(payload.clips).sort().join(',') !== [...model.stressMotionIds].sort().join(',')
      || Object.values(payload.clips).some((row) => row.enabled !== false))) throw new Error('Stress runtime has unexpected correction scope.');
  const checkedFloor = await validateMotionAdjustments(floor, model.motions);
  const checkedTerminal = await validateTerminalCorrections(terminal, model);
  model.motionAdjustments = { ...model.motionAdjustments, ...checkedFloor };
  model.terminalCorrections = { ...model.terminalCorrections,
    clips: { ...model.terminalCorrections?.clips, ...checkedTerminal.clips } };
  return true;
}

async function loadReferenceManifest() {
  const response = await fetch(referenceManifestURL);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Reference motion manifest request failed (${response.status}).`);
  const data = await response.json();
  if (data.schema !== 'gallery_reference_motion_bank_v1' || data.completed !== true
      || !data.cases || typeof data.cases !== 'object' || Array.isArray(data.cases)) throw new Error('Invalid reference motion manifest.');
  referenceBankIdentity(data);
  const caseIds = new Set(manifest.cases.map((item) => item.id));
  if (Object.keys(data.cases).some((id) => !caseIds.has(id))) throw new Error('Reference motion manifest contains an unknown body.');
  for (const id of caseIds) {
    const entry = data.cases[id];
    if (!entry || typeof entry.available !== 'boolean'
        || (!entry.available && (typeof entry.reason !== 'string' || !entry.reason))) throw new Error(`Missing reference motion availability for ${id}.`);
  }
  return data;
}

async function loadReferenceCase(id, baseDataBytes, baseBuffer, signal) {
  const entry = { ...referenceManifest.cases[id] };
  if (!entry.available) return { available: false, reason: entry.reason };
  await verifyHash(baseDataBytes, entry.base_case_sha256, 'Base body JSON');
  await verifyHash(baseBuffer, entry.base_buffer_sha256, 'Base body binary');
  const dataURL = referenceAssetURL(entry.data_url, referenceManifestURL);
  const dataBytes = await fetchChecked(dataURL, signal, false);
  await verifyHash(dataBytes, entry.data_sha256, 'Reference motion JSON');
  const data = validateReferenceMotionCase(parseJSONBuffer(dataBytes, 'reference motion'), id, dataURL);
  const buffer = await fetchChecked(referenceAssetURL(data.buffer_url, dataURL), signal, false);
  await verifyHash(buffer, entry.buffer_sha256, 'Reference motion binary');
  const verifiedSourceHashes = {
    [`cases/${id}.json`]: entry.base_case_sha256,
    [`cases/${id}.bin`]: entry.base_buffer_sha256,
    [`${referenceBankDirectory}/${id}.json`]: entry.data_sha256,
    [`${referenceBankDirectory}/${id}.bin`]: entry.buffer_sha256,
  };
  return { available: true, data, buffer, verifiedSourceHashes };
}

function typedArray(buffer, descriptor, name) {
  if (!descriptor || typeof descriptor !== 'object') throw new Error(`Missing ${name} array.`);
  const constructors = {
    float32: Float32Array, '<f4': Float32Array, f4: Float32Array,
    float64: Float64Array, '<f8': Float64Array, f8: Float64Array,
    uint16: Uint16Array, '<u2': Uint16Array, u2: Uint16Array,
    uint32: Uint32Array, '<u4': Uint32Array, u4: Uint32Array,
    int32: Int32Array, '<i4': Int32Array, i4: Int32Array,
  };
  const Type = constructors[descriptor.dtype];
  const offset = descriptor.offset ?? 0;
  const count = descriptor.count;
  if (!Type || !Number.isSafeInteger(offset) || !Number.isSafeInteger(count)
      || offset < 0 || count < 0 || offset % Type.BYTES_PER_ELEMENT
      || offset + count * Type.BYTES_PER_ELEMENT > buffer.byteLength) {
    throw new Error(`Invalid binary layout for ${name}.`);
  }
  return new Type(buffer, offset, count);
}

function finiteArray(array, name) {
  for (let i = 0; i < array.length; i += 1) {
    if (!Number.isFinite(array[i])) throw new Error(`${name} contains a non-finite value.`);
  }
}

function validateFaces(faces, count, name) {
  if (faces.length % 3) throw new Error(`${name} is not a triangle index array.`);
  for (const index of faces) {
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error(`${name} has an invalid vertex index.`);
  }
}

function titleCase(value) {
  return String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function setSkinOpacity(skin, opacity) {
  const transparent = opacity < 1;
  const material = skin.material;
  if (material.transparent !== transparent) material.needsUpdate = true;
  material.opacity = opacity;
  material.transparent = transparent;
  material.depthWrite = !transparent;
  skin.renderOrder = transparent ? 3 : 0;
}

function ageLabel(years) {
  if (Number(years) === 0) return 'Newborn';
  return Number(years) < 1 ? `${Math.round(Number(years) * 12)} months` : `${Number(years)} years`;
}

function setOptions(select, options, value) {
  select.replaceChildren(...options.map(({ id, label }) => {
    const option = document.createElement('option');
    option.value = String(id);
    option.textContent = label;
    return option;
  }));
  if (value !== undefined) select.value = String(value);
  select.disabled = !options.length;
}

function motionOptionGroups(motions) {
  const groups = [
    ['authored_pose', 'Reference pose'], ['daily_activity', 'Daily activity'],
    ['floor_play', 'Floor movement'], ['exercise', 'Exercise and play'],
    ['mujoco_simulated', 'MuJoCo simulated (forward dynamics)'], ['styled_locomotion', 'Stylized locomotion'],
    ['prompted', 'From text prompt'], ['uploaded', 'Uploaded motion capture'],
    ['unclassified', 'Other recordings'],
    ['recorded_test', 'Retargeted motion tests'],
    ['generated_test', 'Generated motion tests'],
  ];
  const known = {
    Neutral_ID: ['daily_activity', 'Quiet standing'],
    Neutral_FW: ['daily_activity', 'Walking and turning'],
    Neutral_FR: ['exercise', 'Jogging and turning'],
    Punch_FW: ['styled_locomotion', 'Punch-style walking'],
    Kick_FW: ['styled_locomotion', 'Kick-style walking'],
  };
  const rows = Object.entries(motions).map(([id, motion]) => {
    // Task labels describe the recording, not its retargeting or containment quality.
    const source = motion.source;
    const task = source?.provider === '100style' && source?.dataset === '100STYLE'
      && Object.hasOwn(known, source.clip) ? known[source.clip] : null;
    if (motion.stressTest) return { id, category: motion.motionKind === 'generated' ? 'generated_test' : 'recorded_test', label: motion.label };
    const declared = motion.sourceMetadata?.category;
    // Simulated versions share their recording's source; keep their own group and label.
    if (declared === 'mujoco_simulated') return { id, category: declared, label: motion.label || titleCase(id) };
    return { id, category: id === 'neutral' ? 'authored_pose' : task?.[0] || declared || 'unclassified',
      label: id === 'neutral' ? 'Neutral' : task?.[1] || motion.label || titleCase(id) };
  });
  return groups.filter(([id]) => id !== 'generated_test').map(([id, label]) => ({ id, label, options: rows.filter((row) => row.category === id) }))
    .filter((group) => group.options.length);
}

function setMotionOptions(motions, value) {
  const groups = motionOptionGroups(motions);
  ui['motion-select'].replaceChildren(...groups.map(({ label, options }) => {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const { id, label: caption } of options) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = caption;
      group.append(option);
    }
    return group;
  }));
  ui['motion-select'].value = value || '';
  ui['motion-select'].disabled = !groups.length;
}

function pediatricReferenceCases() {
  return manifest?.pediatric_reference_cases || [];
}

function cohortCases() {
  return [...(manifest?.cases || []), ...pediatricReferenceCases()];
}

function lookupCase(id) {
  return generatedCases.get(id) || cohortCases().find((entry) => entry.id === id);
}

function validatePediatricReferenceCases(rows, originals) {
  if (rows === undefined) return [];
  if (!Array.isArray(rows) || rows.length !== 4) throw new Error('Four complete pediatric reference cases are required.');
  const ids = new Set(originals.map((row) => row.id));
  for (const item of rows) {
    const expected = `anny_mean_${item?.years === .5 ? '6months' : '2years'}_${item?.graphics_sex}`;
    if (!item || ![.5, 2].includes(item.years) || !['female', 'male'].includes(item.graphics_sex)
        || item.id !== expected || ids.has(item.id) || item.generated !== false || item.pediatric_reference !== true
        || item.shape_initialization !== 'anny_pediatric_conditional_mean_v1' || item.neutral_only !== true
        || ['anatomy_validated', 'motion_validated', 'containment_validated'].some((key) => item[key] !== false)
        || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1
        || !Number.isFinite(item.height_m) || item.height_m <= 0 || item.height_m >= 2
        || !Number.isSafeInteger(item.bone_mesh_count) || item.bone_mesh_count <= 0
        || item.data_url !== `pediatric_references/${item.id}/case.json`
        || !/^[a-f0-9]{64}$/.test(item.data_sha256 || '') || !/^[a-f0-9]{64}$/.test(item.buffer_sha256 || '')) {
      throw new Error('Invalid pediatric reference identity or complete-body assets.');
    }
    ids.add(item.id);
  }
  return rows;
}

function updateShapeOptions(years, sex, selected) {
  const weights = [...new Set(manifest.cases.filter((item) => Number(item.years) === Number(years)
    && item.graphics_sex === sex).map((item) => item.weight))].sort((a, b) => a - b);
  const reference = pediatricReferenceCases().find((item) => Number(item.years) === Number(years) && item.graphics_sex === sex);
  const options = [...(reference ? [{ id: 'reference', label: 'ANNY mean' }] : []),
    ...weights.map((weight) => ({ id: weight, label: Number(weight).toFixed(2) }))];
  const value = options.some((option) => String(option.id) === String(selected)) ? selected
    : reference ? 'reference' : weights.includes(.5) ? .5 : weights[0];
  setOptions(ui['weight-select'], options, String(value));
}

function initializeSelectors() {
  setOptions(ui['subject-select'], cohortCases().map((item) => ({ id: item.id, label: `${ageLabel(item.years)} / ${titleCase(item.graphics_sex)} / ${item.pediatric_reference ? 'ANNY reference' : Number(item.weight).toFixed(2)}` })));
  const unique = (key) => [...new Set(manifest.cases.map((item) => item[key]))];
  setOptions(ui['age-select'], unique('years').sort((a, b) => a - b).map((years) => ({ id: years, label: ageLabel(years) })));
  setOptions(ui['sex-select'], unique('graphics_sex').map((sex) => ({ id: sex, label: titleCase(sex) })));
  setOptions(ui['weight-select'], unique('weight').sort((a, b) => a - b).map((weight) => ({ id: weight, label: Number(weight).toFixed(2) })));
}

function updateSubjectLabels(item) {
  if (item.generated) {
    const annyReference = item.shape_initialization?.schema === 'atlas_pediatric_shape_reference_v1'
      && item.shape_initialization.initialization === 'anny_pediatric_conditional_mean_v1';
    ui['case-count'].textContent = 'Custom';
    ui['life-stage'].textContent = annyReference ? 'ANNY reference' : 'Measured body';
    ui['scene-title'].textContent = `${titleCase(item.graphics_sex)} / ${ageLabel(item.years)}`;
    ui['scene-subtitle'].textContent = annyReference ? 'ANNY-initialized skin' : 'Measurement-conditioned skin';
  } else {
  ui['subject-select'].value = item.id;
  ui['age-select'].value = String(item.years);
  ui['sex-select'].value = String(item.graphics_sex);
  updateShapeOptions(item.years, item.graphics_sex, item.pediatric_reference ? 'reference' : item.weight);
  ui['case-count'].textContent = item.pediatric_reference ? 'Reference' : `${String(manifest.cases.indexOf(item) + 1).padStart(2, '0')} / ${manifest.cases.length}`;
  ui['life-stage'].textContent = item.pediatric_reference ? 'ANNY reference' : titleCase(item.life_stage || 'Body cohort');
  ui['scene-title'].textContent = `${titleCase(item.graphics_sex)} / ${ageLabel(item.years)}`;
  ui['scene-subtitle'].textContent = item.pediatric_reference ? 'Reference shape' : `Shape weight ${Number(item.weight).toFixed(2)} / 1.00`;
  }
  for (const [element, field] of [['height-value', 'height_m'], ['torso-value', 'torso_girth_m'], ['thigh-value', 'thigh_girth_m']]) {
    ui[element].textContent = Number.isFinite(item[field]) ? (item[field] * 100).toFixed(1) : '--';
  }
  ui['age-warning'].hidden = !(Number(item.years) < 12) || (item.generated === true && item.bone_mesh_count === 0);
  ui['report-link'].hidden = !item.report_url;
  if (item.report_url) ui['report-link'].href = absoluteURL(item.report_url, manifestURL).href;
  updatePediatricReference(item);
}

function validatePediatricPresets(rows) {
  if (rows === undefined) return [];
  if (!Array.isArray(rows) || rows.length > 4) throw new Error('Invalid pediatric size presets.');
  const ids = new Set();
  for (const row of rows) {
    const profile = row?.request?.profile, values = row?.request?.measurements_cm, reference = row?.reference;
    const source = reference?.linear?.source_url;
    let sourceURL;
    try { sourceURL = new URL(source); } catch { throw new Error('Invalid WHO reference source.'); }
    if (typeof row.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(row.id) || ids.has(row.id)
        || ![.5, 2].includes(profile?.age_years) || !['female', 'male'].includes(profile?.graphics_sex)
        || !values || Object.keys(values).length !== 1 || !Number.isFinite(values.height) || values.height < 35 || values.height > 250
        || reference?.schema !== 'atlas_pediatric_size_reference_v1' || reference.supported !== true
        || reference.profile?.age_years !== profile.age_years || reference.profile?.graphics_sex !== profile.graphics_sex
        || reference.age_months !== profile.age_years * 12 || reference.inferred_sex !== false || reference.interpolated !== false
        || reference.clinical_assessment !== false || reference.age_specific_proportions_validated !== false
        || reference.linear?.kind !== (profile.age_years < 2 ? 'recumbent_length' : 'standing_height')
        || !Number.isFinite(reference.linear.median_cm) || values.height !== reference.upright_size_proxy?.target_extent_cm
        || reference.upright_size_proxy.reference_offset_cm !== (profile.age_years < 2 ? -.7 : 0)
        || Math.abs(values.height - reference.linear.median_cm - reference.upright_size_proxy.reference_offset_cm) > 1e-9
        || reference.upright_size_proxy?.clinical_measurement_equivalent !== false
        || row.height_only !== true || row.affects_existing_cohort !== false || row.anatomy_validated !== false
        || sourceURL.protocol !== 'https:' || sourceURL.hostname !== 'cdn.who.int' || sourceURL.username || sourceURL.password || sourceURL.hash) {
      throw new Error('Unsupported pediatric reference or graphics-size claim.');
    }
    ids.add(row.id);
  }
  return rows;
}

function validatePediatricShapePresets(rows) {
  if (rows === undefined) return [];
  if (!Array.isArray(rows) || rows.length > 4) throw new Error('Invalid ANNY reference presets.');
  const ids = new Set();
  for (const row of rows) {
    const request = row?.request, profile = request?.profile, reference = row?.reference;
    const height = request?.measurements_cm?.height, values = reference?.phenotype_kwargs;
    const expectedId = `anny_mean_${profile?.age_years === .5 ? '6months' : '2years'}_${profile?.graphics_sex}`;
    if (row.id !== expectedId || ids.has(row.id) || typeof row.label !== 'string' || !row.label.startsWith('ANNY reference / ')
        || ![.5, 2].includes(profile?.age_years) || !['female', 'male'].includes(profile?.graphics_sex)
        || request.shape_initialization !== 'anny_pediatric_conditional_mean_v1'
        || Object.keys(request.measurements_cm || {}).length !== 1 || !Number.isFinite(height) || height < 35 || height > 250
        || reference?.schema !== 'atlas_pediatric_shape_reference_v1' || reference.initialization !== request.shape_initialization
        || reference.age_years !== profile.age_years || reference.graphics_sex !== profile.graphics_sex
        || !Number.isFinite(reference.native_height_m) || height !== 100 * reference.native_height_m
        || !/^[0-9a-f]{64}$/.test(reference.recipe_sha256 || '')
        || !values || Object.keys(values).length !== 6
        || ['age', 'gender', 'height', 'weight', 'muscle', 'proportions'].some((key) => !Number.isFinite(values[key]) || values[key] < 0 || values[key] > 1)
        || values.age !== (profile.age_years === .5 ? .025 : .105) || values.gender !== (profile.graphics_sex === 'female' ? 1 : 0)
        || ['chronological_age_validated', 'clinical_anatomy_validated', 'population_median_claimed', 'exact_teaser_reconstruction', 'parameter_means_are_mean_body'].some((key) => reference[key] !== false)
        || row.height_only !== false || row.affects_existing_cohort !== false || row.anatomy_validated !== false) {
      throw new Error('Unsupported ANNY shape reference or validation claim.');
    }
    ids.add(row.id);
  }
  return rows;
}

function renderPediatricPreset(preset) {
  ui['pediatric-preset-summary'].hidden = !preset;
  ui['pediatric-preset-boundary'].hidden = !preset;
  if (!preset) return;
  if (preset.request.shape_initialization) {
    const controls = Array.from(ui['measurement-form'].elements);
    const heightControl = controls.find((control) => control.name === 'measurements_cm.height');
    const heightText = heightControl?.value.trim() || '', targetHeight = heightText ? Number(heightText) : NaN;
    const heightValid = Number.isFinite(targetHeight) && (!heightControl.checkValidity || heightControl.checkValidity());
    const nativeHeight = preset.request.measurements_cm.height;
    const measurementEdited = controls.some((control) => control.name?.startsWith('measurements_cm.')
      && control.value.trim() && Number(control.value) !== preset.request.measurements_cm[control.name.split('.')[1]]);
    const target = heightValid ? `${targetHeight.toFixed(2)} cm` : heightText ? 'invalid' : 'pending';
    ui['pediatric-preset-summary'].textContent = `${preset.label}: native reference extent ${nativeHeight.toFixed(2)} cm; current height target ${target}.${measurementEdited ? ' Measurement-fitted shape requested.' : ''}`;
    ui['pediatric-preset-boundary'].textContent = 'Conditional shape-parameter mean initialization; edited measurements may change the reference shape; not a WHO median, measured child, or validated pediatric anatomy.';
    return;
  }
  ui['pediatric-preset-boundary'].textContent = 'Height-only graphics target; body proportions and pediatric anatomy are not validated.';
  const reference = preset.reference, linear = reference.linear;
  const kind = linear.kind === 'recumbent_length' ? 'recumbent length' : 'standing height';
  ui['pediatric-preset-summary'].textContent = `WHO ${reference.reference_sex}, ${ageLabel(preset.request.profile.age_years)}: median ${kind} ${linear.median_cm.toFixed(2)} cm. Neutral extent target ${preset.request.measurements_cm.height.toFixed(2)} cm${linear.kind === 'recumbent_length' ? ' (length minus 0.7 cm)' : ''}.`;
}

function applyPediatricPreset(id) {
  if (state.generationStatus === 'running' || !measurementSchema) return false;
  const preset = pediatricPresets.find((entry) => entry.id === id);
  if (!preset) return false;
  measurementDefaultsGeneration += 1;
  for (const control of ui['measurement-form'].elements) {
    if (!control.name || !/^(profile|measurements_cm)\./.test(control.name)) continue;
    const [group, key] = control.name.split('.'), value = preset.request[group]?.[key];
    const nativeHeight = preset.request.shape_initialization && group === 'measurements_cm' && key === 'height';
    control.value = typeof value === 'string' ? value : Number.isFinite(value) ? (nativeHeight ? String(value) : String(Number(value.toFixed(2)))) : '';
    if (group === 'measurements_cm' && key === 'height') control.step = nativeHeight ? 'any' : '0.01';
    control.disabled = false;
    control.setCustomValidity?.('');
  }
  activePediatricPreset = preset.id;
  ui['pediatric-preset'].value = preset.id;
  measurementSourceId = ui['subject-select'].value || manifest?.default_case || null;
  ui['measurement-defaults'].disabled = false;
  ui['generate-skin'].disabled = false;
  ui['pediatric-preset'].disabled = false;
  ui['generation-error'].hidden = true;
  ui['generation-status'].textContent = `${preset.request.shape_initialization ? 'ANNY reference' : 'Reference size'} selected / displayed body unchanged`;
  renderPediatricPreset(preset);
  return true;
}

function measurementPresetEdited(event) {
  if (!event.target?.name || !/^(profile|measurements_cm)\./.test(event.target.name)) return;
  const preset = pediatricPresets.find((row) => row.id === activePediatricPreset);
  if (preset?.request.shape_initialization) {
    const controls = Array.from(ui['measurement-form'].elements);
    const age = controls.find((control) => control.name === 'profile.age_years')?.value.trim();
    const sex = controls.find((control) => control.name === 'profile.graphics_sex')?.value;
    if (age && Number(age) === preset.request.profile.age_years && sex === preset.request.profile.graphics_sex) {
      renderPediatricPreset(preset);
      return;
    }
  }
  activePediatricPreset = null;
  ui['pediatric-preset'].value = '';
  renderPediatricPreset(null);
}

function updatePediatricReference(item = lookupCase(state.caseId)) {
  const stored = item && pediatricComparisons.get(item.id);
  const reference = stored?.reference || pediatricPresets.find((row) => row.reference.schema === 'atlas_pediatric_size_reference_v1' && row.request.profile.age_years === item?.years && row.request.profile.graphics_sex === item?.graphics_sex)?.reference;
  ui['pediatric-reference'].hidden = !reference?.supported || !Number.isFinite(item?.height_m);
  if (ui['pediatric-reference'].hidden) return;
  const linear = reference.linear, proxy = reference.upright_size_proxy;
  ui['pediatric-extent-summary'].textContent = `Selected extent ${(item.height_m * 100).toFixed(1)} cm. WHO median ${linear.kind === 'recumbent_length' ? 'length' : 'height'} ${linear.median_cm.toFixed(1)} cm${linear.kind === 'recumbent_length' ? `; upright-size proxy ${proxy.target_extent_cm.toFixed(1)} cm` : ''}.`;
  ui['pediatric-source-link'].href = linear.source_url;
}

function measurementAPIURL(path) {
  const url = absoluteURL(path, manifestURL);
  const directory = new URL('./api/measurements/', manifestURL);
  if (url.origin !== directory.origin || !url.pathname.startsWith(directory.pathname) || url.hash) throw new Error('Invalid measurement service URL.');
  return url;
}

async function measurementRequest(path, options = {}) {
  const response = await fetch(measurementAPIURL(path), options);
  let value;
  try { value = await response.json(); } catch { throw new Error('The measurement service returned an invalid response.'); }
  if (!response.ok) throw new Error(value.error || `Measurement request failed (${response.status}).`);
  return value;
}

function setSubjectMode(mode) {
  if (!['cohort', 'measurements'].includes(mode)) return;
  state.subjectMode = mode;
  document.querySelector('.sidebar').dataset.subjectMode = mode;
  for (const name of ['cohort', 'measurements']) {
    ui[`${name}-tab`].setAttribute('aria-selected', String(mode === name));
    ui[`${name}-tab`].tabIndex = mode === name ? 0 : -1;
  }
  ui['cohort-panel'].hidden = mode !== 'cohort';
  ui['measurement-panel'].hidden = mode !== 'measurements';
  if (mode === 'measurements') {
    const generated = [...generatedCases.values()][0];
    if (generated && state.caseId !== generated.id) loadCase(generated.id);
    else if (!generated && measurementSchema && !measurementSourceId) resetMeasurementDefaults();
  } else if (state.generated) {
    loadCase(ui['subject-select'].value || manifest.default_case);
  }
}

function makeMeasurementField(field, name, value) {
  const label = document.createElement(field.profile ? 'label' : 'div');
  label.className = 'field';
  const caption = document.createElement('span');
  const fieldLabel = field.label || titleCase(field.key);
  caption.textContent = fieldLabel;
  const control = document.createElement(field.options ? 'select' : 'input');
  control.id = `measurement-${field.key}`;
  control.name = name;
  if (field.options) {
    setOptions(control, field.options.map((option) => typeof option === 'string' ? { id: option, label: titleCase(option) } : { id: option.id ?? option.value, label: option.label }), value);
  } else {
    control.type = 'number';
    control.inputMode = 'decimal';
    control.step = field.profile ? String(field.step || 0.1) : '0.01';
    if (Number.isFinite(field.min)) control.min = String(field.min);
    if (Number.isFinite(field.max)) control.max = String(field.max);
    control.placeholder = field.required ? '' : 'Optional';
    if (Number.isFinite(value)) control.value = String(value);
  }
  control.required = Boolean(field.required);
  control.title = field.definition || field.protocol || caption.textContent;
  if (!field.profile) {
    caption.className = 'measurement-field-caption';
    const text = document.createElement('label');
    text.htmlFor = control.id;
    text.textContent = fieldLabel;
    const reference = document.createElement('button');
    reference.type = 'button';
    reference.className = 'icon-button measurement-reference-button';
    reference.dataset.measurementReference = field.key;
    reference.dataset.tooltip = `${fieldLabel} reference`;
    reference.setAttribute('aria-label', `${fieldLabel} reference`);
    reference.setAttribute('aria-haspopup', 'dialog');
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'ruler');
    reference.append(icon);
    caption.replaceChildren(text, reference);
  }
  label.append(caption, control);
  return label;
}

function renderMeasurementSources(rows) {
  if (rows === undefined) rows = [];
  if (!Array.isArray(rows) || rows.length > 8) throw new Error('Invalid measurement reference sources.');
  const links = rows.map((row) => {
    let url;
    try { url = new URL(row.url); } catch { throw new Error('Invalid anthropometry source URL.'); }
    const cdc = url.hostname === 'wwwn.cdc.gov' && url.pathname.startsWith('/nchs/');
    const army = url.hostname === 'ph.health.mil';
    if (url.protocol !== 'https:' || (!cdc && !army) || url.username || url.password || url.hash
        || typeof row.title !== 'string' || !row.title || typeof row.scope !== 'string') throw new Error('Unsupported anthropometry source.');
    const link = document.createElement('a');
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = cdc ? 'CDC NHANES' : 'ANSUR II';
    link.title = `${row.title}. ${row.scope}`;
    return link;
  });
  ui['reference-sources'].replaceChildren(...links);
  ui['reference-sources'].hidden = !links.length;
}

function buildMeasurementForm(schema) {
  if (!Array.isArray(schema.fields) || !schema.fields.length) throw new Error('No body measurement fields are available.');
  const keys = new Set();
  for (const field of schema.fields) {
    if (typeof field.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(field.key) || keys.has(field.key)
        || !Number.isFinite(field.min) || !Number.isFinite(field.max) || field.max <= field.min) throw new Error('Invalid body measurement schema.');
    keys.add(field.key);
  }
  const profile = schema.profile || {};
  const groups = new Map([['Profile', [
    { key: 'age_years', label: `${profile.age_years?.label || 'Age parameter'} (years)`, min: profile.age_years?.min ?? 0, max: profile.age_years?.max ?? 110, step: profile.age_years?.step ?? 0.5, required: true, profile: true },
    { key: 'graphics_sex', label: 'Graphics sex', options: profile.graphics_sex?.values || profile.graphics_sex?.enum || ['female', 'male', 'intermediate'], required: true, profile: true },
  ]]]);
  for (const field of schema.fields) {
    const fallback = ['height', 'shoulder_breadth'].includes(field.key) ? 'Body dimensions' : ['head_girth', 'neck_girth', 'chest_girth', 'waist_girth', 'hip_girth'].includes(field.key) ? 'Head and torso girths' : 'Limb girths';
    const group = field.group || fallback;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(field);
  }
  const elements = [];
  for (const [name, fields] of groups) {
    const section = document.createElement('details');
    section.className = 'measurement-group';
    section.open = ['Profile', 'Body', 'Body dimensions', 'Torso', 'Head and torso girths'].includes(name);
    const heading = document.createElement('summary');
    heading.textContent = name;
    const grid = document.createElement('div');
    grid.className = 'measurement-input-grid';
    for (const field of fields) grid.append(makeMeasurementField(field, `${field.profile ? 'profile' : 'measurements_cm'}.${field.key}`));
    section.append(heading, grid);
    elements.push(section);
  }
  ui['measurement-fields'].replaceChildren(...elements);
  const sizePresets = validatePediatricPresets(schema.pediatric_size_presets);
  const shapePresets = validatePediatricShapePresets(schema.pediatric_shape_presets);
  pediatricPresets = [...sizePresets, ...shapePresets];
  if (new Set(pediatricPresets.map((row) => row.id)).size !== pediatricPresets.length) throw new Error('Duplicate pediatric preset identifiers.');
  ui['pediatric-presets'].hidden = !pediatricPresets.length;
  setOptions(ui['pediatric-preset'], [{ id: '', label: 'Custom measurements' }, ...pediatricPresets.map((row) => ({ id: row.id, label: row.request.shape_initialization ? row.label : `WHO median / ${ageLabel(row.request.profile.age_years)} / ${titleCase(row.request.profile.graphics_sex)}` }))], '');
  ui['pediatric-preset'].disabled = !pediatricPresets.length;
  renderMeasurementSources(schema.reference_sources);
  updatePediatricReference();
  refreshIcons();
}

function validateMeasurementReference(value, key) {
  if (!value || value.key !== key || !Array.isArray(value.lines_m)
      || value.lines_m.length > 16 || !value.lines_m.length
      || (value.value_cm !== null && (!Number.isFinite(value.value_cm) || value.value_cm <= 0))) {
    throw new Error('The measurement reference is unavailable for this skin.');
  }
  for (const line of value.lines_m) {
    if (!Array.isArray(line) || line.length < 2 || line.length > 10000
        || line.some((point) => !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite))) {
      throw new Error('Invalid measurement reference geometry.');
    }
  }
  return value;
}

function initializeMeasurementReference() {
  if (measurementReference) return measurementReference;
  const host = ui['reference-scene'];
  const previewScene = new THREE.Scene();
  previewScene.background = new THREE.Color('#eef3f0');
  const previewCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, .001, 100);
  previewCamera.up.set(0, 0, 1);
  const previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  previewRenderer.domElement.setAttribute('aria-label', 'Neutral selected skin with exact measurement section');
  previewRenderer.domElement.tabIndex = 0;
  host.append(previewRenderer.domElement);
  previewScene.add(new THREE.HemisphereLight('#ffffff', '#a5b4af', 2));
  const light = new THREE.DirectionalLight('#ffffff', 2);
  light.position.set(-3, -4, 5);
  previewScene.add(light);
  const orbit = new OrbitControls(previewCamera, previewRenderer.domElement);
  orbit.enablePan = false;
  orbit.enableZoom = false;
  const view = { scene: previewScene, camera: previewCamera, renderer: previewRenderer, controls: orbit, group: null, bounds: null, data: null };
  const render = () => {
    if (!ui['measurement-reference'].open || !view.bounds) return;
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    const size = view.bounds.getSize(new THREE.Vector3());
    const halfHeight = Math.max(size.z * .56, size.x * .56 * height / width);
    previewCamera.left = -halfHeight * width / height;
    previewCamera.right = -previewCamera.left;
    previewCamera.top = halfHeight;
    previewCamera.bottom = -halfHeight;
    previewCamera.updateProjectionMatrix();
    previewRenderer.setSize(width, height, false);
    previewRenderer.render(previewScene, previewCamera);
  };
  orbit.addEventListener('change', render);
  new ResizeObserver(render).observe(host);
  view.render = render;
  measurementReference = view;
  return view;
}

function drawMeasurementReference(data, model) {
  const view = initializeMeasurementReference();
  if (view.group) { view.scene.remove(view.group); disposeGroup(view.group); }
  const group = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(model.skinRest), 3));
  geometry.setIndex(model.skin.geometry.index.clone());
  geometry.computeVertexNormals();
  const skin = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#79adbf', roughness: .8, side: THREE.DoubleSide }));
  group.add(skin);
  const bounds = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position'));
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(.0005, size.z * .0018);
  const material = new THREE.MeshBasicMaterial({ color: '#bd463d', depthTest: false, depthWrite: false });
  const lines = data.lines_m.map((line) => line.map((point) => new THREE.Vector3(...point)));
  for (const line of data.guide_lines_m || []) {
    if (Array.isArray(line) && line.length >= 2 && line.every((point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))) lines.push(line.map((point) => new THREE.Vector3(...point)));
  }
  for (const line of lines) {
    const path = new THREE.CurvePath();
    for (let index = 1; index < line.length; index += 1) {
      if (line[index - 1].distanceToSquared(line[index]) > 1e-16) path.add(new THREE.LineCurve3(line[index - 1], line[index]));
    }
    if (!path.curves.length) continue;
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, Math.min(2048, Math.max(2, line.length * 3)), radius, 6, false), material);
    mesh.renderOrder = 2;
    group.add(mesh);
    for (const point of line) bounds.expandByPoint(point);
  }
  const center = bounds.getCenter(new THREE.Vector3());
  view.camera.position.set(center.x + size.z * .38, center.y - Math.max(2, size.z * 2), center.z + size.z * .24);
  view.camera.lookAt(center);
  view.controls.target.copy(center);
  view.scene.add(group);
  view.group = group;
  view.bounds = bounds;
  view.data = data;
  view.render();
}

async function openMeasurementReference(key) {
  const field = measurementSchema?.fields.find((entry) => entry.key === key);
  if (!field || !activeModel || !state.loaded) return;
  referenceRequest?.abort();
  const controller = new AbortController();
  referenceRequest = controller;
  referenceKey = key;
  const model = activeModel, caseId = state.caseId;
  const dialog = ui['measurement-reference'];
  if (!dialog.open) dialog.showModal();
  ui['reference-title'].textContent = field.label;
  ui['reference-protocol'].textContent = field.protocol || field.definition || '';
  ui['reference-position'].textContent = `${measurementSchema.fields.indexOf(field) + 1} / ${measurementSchema.fields.length}`;
  ui['reference-measured'].textContent = '--';
  const target = $(`measurement-${key}`).value;
  ui['reference-target'].textContent = target !== '' && Number.isFinite(Number(target)) ? `${Number(target).toFixed(2)} cm` : 'Not specified';
  ui['reference-range'].textContent = `Allowed input: ${field.min} to ${field.max} cm. These are application limits, not population reference ranges.`;
  ui['reference-subject'].textContent = ui['scene-title'].textContent;
  ui['reference-figure-label'].textContent = key.includes('girth') ? 'Complete skin section / neutral pose' : 'Defined span / neutral pose';
  ui['reference-bilateral'].hidden = true;
  ui['reference-error'].hidden = true;
  ui['reference-loading'].hidden = false;
  ui['reference-scene'].style.visibility = 'hidden';
  try {
    const data = validateMeasurementReference(await measurementRequest(`./api/measurements/reference?case_id=${encodeURIComponent(caseId)}&key=${encodeURIComponent(key)}`, { signal: controller.signal }), key);
    if (controller.signal.aborted || state.caseId !== caseId || !dialog.open) return;
    drawMeasurementReference(data, model);
    ui['reference-measured'].textContent = data.value_cm === null ? 'Unavailable' : `${data.value_cm.toFixed(2)} cm`;
    if (data.bilateral_mean) {
      const sizes = (data.observations || []).map((entry) => Number.isFinite(entry.perimeter_m) ? `${(100 * entry.perimeter_m).toFixed(2)} cm` : 'unavailable');
      ui['reference-bilateral'].textContent = sizes.length === 2 ? `Left: ${sizes[0]}. Right: ${sizes[1]}. The input uses their mean.` : 'The input uses the mean of the left and right skin sections.';
      ui['reference-bilateral'].hidden = false;
    }
    ui['reference-scene'].style.visibility = 'visible';
  } catch (error) {
    if (controller.signal.aborted) return;
    ui['reference-error'].textContent = error.message || String(error);
    ui['reference-error'].hidden = false;
  } finally {
    if (!controller.signal.aborted) ui['reference-loading'].hidden = true;
  }
}

function shiftMeasurementReference(offset) {
  const fields = measurementSchema?.fields || [];
  const index = fields.findIndex((field) => field.key === referenceKey);
  if (index >= 0) openMeasurementReference(fields[(index + offset + fields.length) % fields.length].key);
}

async function resetMeasurementDefaults() {
  if (!measurementSchema || state.generationStatus === 'running') return;
  const generation = ++measurementDefaultsGeneration;
  const selected = ui['subject-select'].value || manifest.default_case;
  ui['measurement-defaults'].disabled = true;
  ui['generate-skin'].disabled = true;
  ui['pediatric-preset'].disabled = true;
  for (const control of ui['measurement-fields'].querySelectorAll('input, select')) control.disabled = true;
  ui['generation-error'].hidden = true;
  ui['generation-status'].textContent = 'Measuring selected body';
  try {
    const result = await measurementRequest(`./api/measurements/defaults?case_id=${encodeURIComponent(selected)}`);
    if (generation !== measurementDefaultsGeneration) return;
    const preset = pediatricPresets.find((entry) => entry.request.shape_initialization
      && entry.request.shape_initialization === result.shape_initialization
      && entry.request.profile.age_years === result.profile?.age_years
      && entry.request.profile.graphics_sex === result.profile?.graphics_sex);
    if (result.shape_initialization !== undefined && !preset) throw new Error('Unknown reference initialization in selected body defaults.');
    for (const name of ['profile', 'measurements_cm']) {
      for (const control of ui['measurement-form'].elements) {
        if (!control.name?.startsWith(`${name}.`)) continue;
        const value = result[name]?.[control.name.slice(name.length + 1)];
        const referenceHeight = preset && control.name === 'measurements_cm.height';
        control.value = typeof value === 'string' ? value : Number.isFinite(value)
          ? referenceHeight ? String(value) : String(Number(value.toFixed(2))) : '';
        if (control.name === 'measurements_cm.height') control.step = referenceHeight ? 'any' : '0.01';
      }
    }
    measurementSourceId = selected;
    if (result.pediatric_size_reference) pediatricComparisons.set(selected, result.pediatric_size_reference);
    activePediatricPreset = preset?.id || null;
    ui['pediatric-preset'].value = preset?.id || '';
    renderPediatricPreset(preset || null);
    updatePediatricReference();
    ui['generation-status'].textContent = 'Selected body measurements loaded';
  } catch (error) {
    if (generation !== measurementDefaultsGeneration) return;
    ui['generation-error'].hidden = false;
    ui['generation-error'].textContent = error.message;
    ui['generation-status'].textContent = 'Defaults unavailable';
  } finally {
    if (generation === measurementDefaultsGeneration) {
      ui['measurement-defaults'].disabled = false;
      ui['generate-skin'].disabled = false;
      ui['pediatric-preset'].disabled = !pediatricPresets.length;
      for (const control of ui['measurement-fields'].querySelectorAll('input, select')) control.disabled = false;
    }
  }
}

async function initializeMeasurements() {
  try {
    const schema = await measurementRequest('./api/measurements/schema');
    if (schema.available === false) throw new Error('The local body generation environment is unavailable.');
    buildMeasurementForm(schema);
    measurementSchema = schema;
    ui['measurement-defaults'].disabled = false;
    ui['generate-skin'].disabled = false;
    ui['generation-status'].textContent = 'Ready';
    if (state.subjectMode === 'measurements') await resetMeasurementDefaults();
  } catch (error) {
    ui['generation-status'].textContent = 'Measurement service unavailable';
    ui['generation-status'].title = error.message;
  }
}

function readMeasurementPayload() {
  const payload = { action: 'skin', profile: {}, measurements_cm: {}, seed_case_id: measurementSourceId || ui['subject-select'].value };
  for (const control of ui['measurement-form'].elements) {
    if (!control.name || !control.value.trim()) continue;
    const [group, key] = control.name.split('.');
    if (!Object.hasOwn(payload, group) || !key) continue;
    const value = key === 'graphics_sex' ? control.value : Number(control.value);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Invalid ${key.replaceAll('_', ' ')}.`);
    payload[group][key] = value;
  }
  const preset = pediatricPresets.find((row) => row.id === activePediatricPreset);
  if (preset?.request.shape_initialization && payload.profile.age_years === preset.request.profile.age_years
      && payload.profile.graphics_sex === preset.request.profile.graphics_sex) {
    payload.shape_initialization = preset.request.shape_initialization;
  }
  return payload;
}

function setLayerVisibility(property, visible) {
  state[property] = visible;
  ui[`${property}-toggle`].checked = visible;
  if (activeModel) activeModel[property].visible = visible;
  invalidateNativeFrame();
}

function updateGeneratedLayers(item = generatedCases.get(state.caseId)) {
  const generated = Boolean(item?.generated);
  const busy = state.generationStatus === 'running';
  ui['generated-layer-actions'].hidden = !generated;
  ui['rig-toggle'].disabled = generated && !item.layersAdded.rig;
  ui['anatomy-toggle'].disabled = generated && !item.layersAdded.anatomy;
  ui['add-rig'].disabled = busy || !generated || item.layersAdded.rig;
  ui['add-anatomy'].disabled = busy || !generated || !item.layersAdded.rig || item.layersAdded.anatomy;
  if (generated) {
    ui['bone-count'].textContent = item.layersAdded.anatomy ? `${activeModel?.bones.length || 0} anatomical meshes` : 'Anatomy not added';
    ui['joint-count'].textContent = item.layersAdded.rig ? `${activeModel?.jointCount || 0} rig controls` : 'Rig not added';
  }
  updateContainmentControls();
}

function setGenerationBusy(busy) {
  ui['generate-skin'].disabled = busy || !measurementSchema;
  ui['measurement-defaults'].disabled = busy || !measurementSchema;
  ui['pediatric-preset'].disabled = busy || !pediatricPresets.length;
  ui['cancel-generation'].hidden = !busy;
  ui['cancel-generation'].disabled = false;
  ui['generation-progress'].hidden = !busy;
  for (const control of ui['measurement-fields'].querySelectorAll('input, select')) control.disabled = busy;
  updateGeneratedLayers();
}

function renderMeasurementResults(report) {
  const rows = Array.isArray(report?.measurement_fit) ? report.measurement_fit : null;
  const measurementReport = rows ? report : report?.measurement_fit || report;
  const requested = measurementReport?.requested_cm || measurementReport?.requested_measurements_cm || measurementReport?.requested || {};
  const achieved = measurementReport?.achieved_cm || measurementReport?.achieved_measurements_cm || measurementReport?.achieved || {};
  const entries = [];
  for (const field of measurementSchema?.fields || []) {
    const observation = rows?.find((row) => row.key === field.key);
    const target = observation ? observation.requested_cm : requested[field.key];
    const actual = observation ? observation.achieved_cm : achieved[field.key];
    if (!Number.isFinite(target)) continue;
    const difference = Number.isFinite(actual) ? actual - target : null;
    const row = document.createElement('div');
    const label = document.createElement('dt');
    label.textContent = field.label;
    const values = document.createElement('dd');
    for (const [name, value] of [['Target', target], ['Achieved', actual], ['Difference', difference]]) {
      const span = document.createElement('span');
      span.dataset.label = name;
      const shown = name === 'Difference' && Number.isFinite(value) && Math.abs(value) < 0.005 ? 0 : value;
      span.textContent = Number.isFinite(shown) ? `${name === 'Difference' && shown > 0 ? '+' : ''}${shown.toFixed(2)}` : '--';
      if (!Number.isFinite(value)) span.title = 'Measurement unavailable';
      if (name === 'Difference' && Math.abs(value) > (observation?.tolerance_cm ?? measurementReport.tolerance_cm ?? 0.5)) span.className = 'residual-outside';
      values.append(span);
    }
    row.append(label, values);
    entries.push(row);
  }
  ui['measurement-residuals'].replaceChildren(...entries);
  ui['measurement-results'].hidden = !entries.length;
}

async function installGeneratedCase(result, action) {
  const item = result?.case;
  if (!item || item.generated !== true || typeof item.id !== 'string' || !item.id || !item.data_url) throw new Error('Generation completed without a valid body asset.');
  item.shape_initialization = result.report?.shape_initialization ?? null;
  item.layersAdded = { rig: action === 'anatomy', anatomy: action === 'anatomy' };
  generatedCases.clear();
  generatedCases.set(item.id, item);
  if (action === 'skin') {
    setLayerVisibility('skin', true);
    state.opacity = 1;
    ui['opacity-slider'].value = '100';
    ui['opacity-value'].textContent = '100%';
    measurementDownload = { profile: readMeasurementPayload().profile, report: result.report, case_id: item.id };
    renderMeasurementResults(result.report);
  } else if (measurementDownload) {
    measurementDownload.anatomy_report = result.report;
    measurementDownload.case_id = item.id;
  }
  if (state.subjectMode === 'measurements') {
    await loadCase(item.id);
    if (state.error) throw new Error(state.error);
  }
}

function waitForMeasurementPoll(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Generation cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 800);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

async function cancelMeasurementGeneration() {
  if (state.generationStatus !== 'running') return;
  measurementCancelRequested = true;
  ui['cancel-generation'].disabled = true;
  ui['generation-status'].textContent = 'Cancelling generation';
  if (!measurementJobURL) return;
  try {
    const status = await measurementRequest(measurementJobURL, { method: 'DELETE' });
    if (['completed', 'succeeded'].includes(status.status)) measurementCancelRequested = false;
  } catch (error) {
    measurementCancelRequested = false;
    ui['cancel-generation'].disabled = false;
    ui['generation-error'].hidden = false;
    ui['generation-error'].textContent = error.message;
  }
}

async function runMeasurementGeneration(action = 'skin') {
  if (!measurementSchema || state.generationStatus === 'running') return;
  if (action === 'skin') {
    for (const control of ui['measurement-form'].elements) {
      if (control.checkValidity && !control.checkValidity()) {
        const group = control.closest('details');
        if (group) group.open = true;
      }
    }
    if (!ui['measurement-form'].reportValidity()) return;
  }
  const body = action === 'skin' ? readMeasurementPayload() : { action: 'anatomy', case_id: state.caseId };
  const run = ++measurementRun;
  measurementController = new AbortController();
  measurementJobURL = null;
  measurementCancelRequested = false;
  state.generationStatus = 'running';
  invalidateNativeFrame();
  state.generationJob = null;
  ui['generation-error'].hidden = true;
  ui['generation-status'].textContent = action === 'skin' ? 'Starting skin generation' : 'Starting template anatomy transfer';
  ui['generation-progress'].removeAttribute('value');
  setGenerationBusy(true);
  try {
    const job = await measurementRequest('./api/measurements/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!job.job_id || !job.poll_url) throw new Error('The measurement service did not return a job.');
    measurementJobURL = measurementAPIURL(job.poll_url).href;
    state.generationJob = job.job_id;
    if (measurementCancelRequested) await cancelMeasurementGeneration();
    while (run === measurementRun) {
      const status = await measurementRequest(measurementJobURL, { signal: measurementController.signal });
      if (Number.isFinite(status.progress)) ui['generation-progress'].value = Math.max(0, Math.min(1, status.progress));
      if (!measurementCancelRequested) ui['generation-status'].textContent = status.phase ? titleCase(status.phase) : action === 'skin' ? 'Generating skin' : 'Transferring template anatomy';
      if (['completed', 'succeeded'].includes(status.status)) {
        await installGeneratedCase(status.result, action);
        state.generationStatus = 'completed';
        ui['generation-status'].textContent = action === 'skin' ? status.result.report?.all_requested_within_tolerance === false ? 'Skin generated / measurement targets not all met' : 'Skin generated' : 'Template anatomy added / fit not validated';
        break;
      }
      if (status.status === 'failed') throw new Error(status.error || 'Body generation failed.');
      if (status.status === 'cancelled') { state.generationStatus = 'cancelled'; break; }
      await waitForMeasurementPoll(measurementController.signal);
    }
  } catch (error) {
    state.generationStatus = error.name === 'AbortError' ? 'cancelled' : 'failed';
    if (state.generationStatus === 'failed') {
      ui['generation-error'].hidden = false;
      ui['generation-error'].textContent = error.message;
      ui['generation-status'].textContent = 'Generation failed';
    }
  } finally {
    if (state.generationStatus === 'cancelled') ui['generation-status'].textContent = 'Generation cancelled';
    measurementJobURL = null;
    measurementController = null;
    setGenerationBusy(false);
  }
}

function bodyDrawingBufferRatio(width, height, maximumSize) {
  if (![width, height, maximumSize].every((value) => Number.isFinite(value) && value > 0)
      || !Number.isFinite(width * height)) throw new Error('Invalid body drawing-buffer dimensions.');
  return Math.min(2, Math.sqrt(4194304 / (width * height)), maximumSize / width, maximumSize / height);
}

function bodyCameraClip(bounds, position, target) {
  if (bounds.isEmpty()) throw new Error('Body camera bounds are empty.');
  const forward = target.clone().sub(position), distance = forward.length();
  if (!Number.isFinite(distance) || distance <= 0) throw new Error('Invalid body camera direction.');
  forward.divideScalar(distance);
  const center = bounds.getCenter(new THREE.Vector3()).sub(position);
  const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const radius = Math.abs(forward.x) * half.x + Math.abs(forward.y) * half.y + Math.abs(forward.z) * half.z;
  const depth = center.dot(forward), minimumDepth = depth - radius, maximumDepth = depth + radius;
  if (![minimumDepth, maximumDepth].every(Number.isFinite)) throw new Error('Invalid body camera bounds.');
  return {
    near: Math.min(distance / 50, minimumDepth > 0 ? minimumDepth * 0.5 : 0.0001),
    far: Math.max(50, distance * 20, maximumDepth * 1.01), minimumDepth, maximumDepth,
  };
}

function updateBodyCameraClip() {
  if (!activeModel || cameraGeometryBounds.isEmpty() || state.camera === 'inspection') return;
  const clip = bodyCameraClip(cameraGeometryBounds, camera.position, controls.target);
  if (camera.near !== clip.near || camera.far !== clip.far) {
    camera.near = clip.near;
    camera.far = clip.far;
    camera.updateProjectionMatrix();
  }
}

function initializeScene() {
  const host = $('scene-host');
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8edec');
  camera = new THREE.PerspectiveCamera(33, 1, 0.001, 100);
  camera.up.set(0, 0, 1);
  // Supersampling avoids the tested MSAA skin/bone coverage artifacts without a depth bias.
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  const maximumDrawingSize = Math.min(renderer.capabilities.maxTextureSize,
    renderer.getContext().getParameter(renderer.getContext().MAX_RENDERBUFFER_SIZE));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.domElement.setAttribute('aria-label', 'Interactive full-body anatomy scene');
  renderer.domElement.tabIndex = 0;
  host.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = 0.07;
  controls.maxPolarAngle = Math.PI - 0.07;
  controls.addEventListener('start', () => {
    state.camera = 'orbit';
    updateCameraButtons();
    invalidateNativeFrame();
  });
  controls.addEventListener('change', () => { renderDirty = true; });
  scene.add(new THREE.HemisphereLight('#ffffff', '#a8b8ab', 2.3));
  const keyLight = new THREE.DirectionalLight('#fff7e8', 3.0);
  keyLight.position.set(-2, -4, 6);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight('#d7eef2', 1.6);
  fillLight.position.set(3, 3, 4);
  scene.add(fillLight);
  ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#e1e8e2', roughness: 1 }));
  ground.position.z = -0.005;
  scene.add(ground);
  grid = new THREE.GridHelper(20, 80, '#c3d0c5', '#d0dbd1');
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.004;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);
  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setDrawingBufferSize(width, height, bodyDrawingBufferRatio(width, height, maximumDrawingSize));
    invalidateNativeFrame(true);
    if (activeModel) frameBody(state.camera === 'orbit' ? 'front' : state.camera);
  };
  new ResizeObserver(resize).observe(host);
  resize();
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    showError(new Error('The graphics context was lost. Reload the viewer to restore it.'));
  });
  renderer.setAnimationLoop(animate);
}

class NativeFrameQueue {
  constructor(fetchFrame, commitFrame, fail) {
    this.fetchFrame = fetchFrame;
    this.commitFrame = commitFrame;
    this.fail = fail;
    this.inFlight = false;
    this.pending = null;
    this.lastKey = null;
    this.generation = 0;
  }

  enqueue(request, key, generation) {
    this.generation = generation;
    if (this.lastKey === key || this.pending?.key === key) return;
    this.pending = { request, key, generation };
    if (!this.inFlight) this.drain();
  }

  invalidate(generation) {
    this.generation = generation;
    this.pending = null;
    this.lastKey = null;
  }

  async drain() {
    const job = this.pending;
    if (!job) return;
    this.pending = null;
    this.inFlight = true;
    this.lastKey = job.key;
    const current = () => job.generation === this.generation;
    try {
      const blob = await this.fetchFrame(job.request);
      if (current()) await this.commitFrame(blob, job.request, current);
    } catch (error) {
      if (current()) this.fail(error);
    } finally {
      this.inFlight = false;
      if (this.pending) this.drain();
    }
  }
}

function invalidateNativeFrame(clear = false) {
  renderDirty = true;
  nativeRevision += 1;
  nativeQueue?.invalidate(nativeRevision);
  physicsQueue?.invalidate(nativeRevision);
  if (clear && state.renderer === 'native') {
    ui['native-frame'].hidden = true;
    ui['native-loading'].hidden = false;
    state.nativeFrameTime = null;
    state.nativeFrameClip = null;
  }
}

function setRenderer(mode) {
  if (state.verifiedPose && mode !== 'gallery') return false;
  if (!['gallery', 'native'].includes(mode) || (mode === 'native' && !state.nativeAvailable)) return false;
  invalidatePhysicsControl();
  const leavingPhysics = state.simulationMode === 'physics';
  state.simulationMode = 'playback';
  state.physicsBrowser = false;
  if (leavingPhysics && activeModel?.motions.physics_live) {
    delete activeModel.motions.physics_live;
    for (const key of [...(activeModel.containmentCache?.keys() || [])]) if (key.startsWith('physics_live|')) activeModel.containmentCache.delete(key);
    selectMotion('neutral');
  }
  ui['camera-follow'].disabled = false;
  ui['camera-follow'].dataset.tooltip = state.followMotion ? 'Fix camera in world' : 'Follow horizontal motion';
  setPhysicsPlaying(false);
  ui['recorded-controls'].hidden = false;
  ui['physics-controls'].hidden = true;
  ui['physics-source'].hidden = true;
  ui['physics-error'].hidden = true;
  ui['motion-source'].hidden = !state.recorded_motion;
  state.renderer = mode;
  ui['renderer-select'].value = mode;
  $('scene-host').dataset.renderer = mode;
  ui['native-frame'].hidden = true;
  ui['native-loading'].hidden = mode !== 'native';
  updatePlaybackStatus();
  poseDirty = true;
  invalidateNativeFrame(mode === 'native');
  return true;
}

function nativeFrameRequest() {
  const host = $('scene-host');
  const ratio = Math.min(1.5, window.devicePixelRatio || 1, 1600 / host.clientWidth, 1200 / host.clientHeight);
  const offset = camera.position.clone().sub(controls.target);
  const rounded = (number) => Number(number.toFixed(8));
  return {
    case_id: state.caseId, clip: state.motionId, time: state.time,
    width: Math.max(64, Math.round(host.clientWidth * ratio)), height: Math.max(64, Math.round(host.clientHeight * ratio)),
    lookat: controls.target.toArray().map(rounded), distance: rounded(offset.length()), fovy: camera.fov,
    azimuth: rounded(THREE.MathUtils.radToDeg(Math.atan2(-offset.y, -offset.x))),
    elevation: rounded(-THREE.MathUtils.radToDeg(Math.atan2(offset.z, Math.hypot(offset.x, offset.y)))),
    skin_opacity: state.opacity, anatomy_visible: state.anatomy, skin_visible: state.skin, rig_visible: state.rig,
    muscles_visible: Boolean(state.muscles),
    activation_visible: Boolean(state.muscles && state.activation),
  };
}

async function initializeNativeRenderer(preferNative = false) {
  nativeQueue = new NativeFrameQueue(async (request) => {
    const response = await fetch(new URL('./api/native/frame', manifestURL), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const message = await response.json().catch(() => ({}));
      throw new Error(message.error || `Native renderer request failed (${response.status}).`);
    }
    if (!response.headers.get('Content-Type')?.startsWith('image/png')) throw new Error('The native renderer did not return a PNG frame.');
    return response.blob();
  }, async (blob, request, current) => {
    const url = URL.createObjectURL(blob);
    try {
      const decoded = new Image();
      decoded.src = url;
      await decoded.decode();
      if (!current() || state.renderer !== 'native' || state.simulationMode !== 'playback') { URL.revokeObjectURL(url); return; }
      const previous = nativeImageURL;
      nativeImageURL = url;
      ui['native-frame'].src = url;
      ui['native-frame'].hidden = false;
      ui['native-loading'].hidden = true;
      state.nativeFrame += 1;
      state.nativeFrameTime = request.time;
      state.nativeFrameClip = request.clip;
      updateTimeline();
      updateNativeFrameLabel();
      if (previous) URL.revokeObjectURL(previous);
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }, (error) => {
    state.nativeError = error.message || String(error);
    state.nativeAvailable = false;
    setRenderer('gallery');
    const option = ui['renderer-select'].querySelector('[value="native"]');
    option.disabled = false;
    option.textContent = 'MuJoCo (retry)';
    ui['renderer-select'].title = state.nativeError;
    ui['renderer-status'].textContent = 'Browser 3D / native unavailable';
  });
  try {
    const service = await fetch(manifestURL, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
    if (service.headers.get('X-Atlas-Native') !== 'MuJoCo') throw new Error('Native service unavailable');
    const response = await fetch(new URL('./api/native/status', manifestURL), { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Native MuJoCo service is unavailable on this address.');
    const status = await response.json();
    if (status.available !== true || status.engine !== 'MuJoCo' || status.native_skinning !== true || status.dynamics_simulation !== false) throw new Error('The native service has an unsupported rendering contract.');
    state.nativeAvailable = true;
    state.nativeError = null;
    const option = ui['renderer-select'].querySelector('[value="native"]');
    option.disabled = false;
    option.textContent = 'MuJoCo playback';
    ui['renderer-select'].title = `Native MuJoCo ${status.version}: kinematic rendering`;
    // Default to the browser view, which shows the containment-fitted anatomy; MuJoCo stays one click away.
    setRenderer(preferNative || new URLSearchParams(window.location.search).get('renderer') === 'native' ? 'native' : 'gallery');
  } catch (error) {
    useStaticAnatomyServices();
  }
}

function setPhysicsPlaying(playing) {
  state.physicsPlaying = Boolean(playing && state.simulationMode === 'physics' && state.loaded && !physicsControlPending);
  const label = state.physicsPlaying ? 'Pause physics' : 'Run physics';
  ui['physics-play'].setAttribute('aria-label', label);
  ui['physics-play'].dataset.tooltip = label;
  ui['physics-play'].innerHTML = `<i data-lucide="${state.physicsPlaying ? 'pause' : 'play'}"></i>`;
  refreshIcons();
}

function invalidatePhysicsControl() {
  physicsControlGeneration += 1;
  physicsControlPending = false;
  for (const name of ['physics-reset', 'physics-play', 'physics-push']) ui[name].disabled = false;
}

function updatePlaybackStatus() {
  if (state.simulationMode !== 'playback') return;
  const adjusted = activeModel?.motionAdjustments?.[state.motionId]?.enabled === true;
  const terminals = activeModel?.terminalCorrections?.clips[state.motionId]?.enabled === true;
  const engine = state.renderer === 'native' ? 'Native MuJoCo' : 'Browser 3D';
  ui['renderer-status'].textContent = `${engine} / ${terminals ? 'bind-corrected recording' : adjusted ? 'floor-adjusted recording' : 'kinematic playback'}`;
  ui['renderer-status'].title = terminals
    ? `Four unmeasured terminal channels use authored local bind rotations; recorded joint origins and cadence are preserved.${adjusted ? ' Common vertical floor correction is also applied.' : ''} Finger motion was not recovered. Containment and contacts remain unvalidated.`
    : adjusted
    ? 'Common vertical correction; joint rotations and timing preserved. Foot sliding and stair contact not validated.'
    : 'Kinematic playback, not a dynamics simulation.';
  if (state.renderer === 'native') ui['renderer-status'].title += ' Server-rendered image delivery may be slower than the recorded cadence; Browser 3D renders locally.';
}

function updatePhysicsReadout() {
  ui['physics-time'].textContent = `${state.physicsTime.toFixed(3)} s`;
  ui['frame-value'].textContent = `${state.physicsContacts} contacts`;
  ui['physics-mass-status'].textContent = Number.isFinite(state.physicsMass)
    ? `${state.physicsMass.toFixed(2)} kg / ${configuredPhysicsMass !== null ? 'entered mass' : 'assumed mass'}` : 'Mass estimate / not measured';
}

function physicsFrameRequest() {
  const { clip, time, ...request } = nativeFrameRequest();
  if (configuredPhysicsMass !== null) request.mass_kg = configuredPhysicsMass;
  // Browser display: the server returns dynamics only; skin and bones are posed and contained here.
  if (state.physicsBrowser) return { case_id: request.case_id, pose_only: true, step_count: state.physicsPlaying ? 20 : 0, ...(request.mass_kg !== undefined ? { mass_kg: request.mass_kg } : {}) };
  return { ...request, step_count: state.physicsPlaying ? 8 : 0, collision_visible: ui['physics-proxies'].checked };
}

// One physics state -> the same pose, skin and containment path as recorded playback. Each state
// is a one-frame motion; consecutive states share the containment warm start.
function applyPhysicsPose(pose) {
  const model = activeModel;
  if (!model || !Array.isArray(pose.deltas) || pose.deltas.length !== model.jointCount * 16) return;
  const transforms = Float32Array.from(pose.deltas);
  const motion = decodeMotion({ times: [0], transforms: { offset: 0, count: transforms.length, shape: [1, model.jointCount, 4, 4], dtype: 'float32' }, scenery: {} },
    transforms.buffer, {}, model.skeleton, 'physics_live');
  motion.label = 'MuJoCo live physics';
  ui['native-loading'].hidden = true;
  model.motions.physics_live = motion;
  model.containmentSnapshotOK ||= {};
  model.containmentSnapshotOK.physics_live = false;  // live states are never prefetched
  const serial = (model.physicsSerial = (model.physicsSerial || 0) + 1);
  model.containmentCache?.delete(`physics_live|${serial - 2}`);
  state.motionId = 'physics_live';
  state.time = 0;
  state.duration = 0;
  poseDirty = true;
  updatePoseAt(`physics_live|${serial}`);
  renderDirty = true;
  state.physicsTime = pose.time_s;
  state.physicsContacts = pose.contacts;
  state.physicsMass = pose.mass_kg;
  state.physicsPhase = pose.phase;
  state.physicsFrame += 1;
  if (['failed', 'finished'].includes(pose.phase)) {
    setPhysicsPlaying(false);
    ui['physics-play'].disabled = true;
    ui['physics-push'].disabled = true;
    ui['renderer-status'].textContent = pose.phase === 'finished' ? 'MuJoCo / session completed' : 'MuJoCo / simulation stopped';
  }
  updatePhysicsReadout();
}

function setPhysicsMode() {
  if (state.verifiedPose) return false;
  if (!state.physicsAvailable || !state.loaded) return false;
  invalidatePhysicsControl();
  setPlaying(false);
  if (activeModel?.motions.neutral) selectMotion('neutral');
  state.simulationMode = 'physics';
  ui['camera-follow'].disabled = true;
  ui['camera-follow'].dataset.tooltip = 'Physics uses a fixed camera';
  // MuJoCo integrates the dynamics; the browser shows the skinned body with the fitted anatomy,
  // containment-projected in every frame exactly like recorded playback.
  state.physicsBrowser = true;
  state.renderer = 'gallery';
  setPhysicsPlaying(false);
  ui['renderer-select'].value = 'physics';
  $('scene-host').dataset.renderer = 'gallery';
  ui['native-frame'].hidden = true;
  ui['recorded-controls'].hidden = true;
  ui['physics-controls'].hidden = false;
  ui['physics-source'].hidden = false;
  ui['motion-source'].hidden = true;
  ui['physics-error'].hidden = true;
  ui['renderer-status'].textContent = 'MuJoCo dynamics / anatomy kept inside the skin';
  ui['renderer-status'].title = 'Passive articulated gravity and proxy contacts (anatomical joint limits); no balance or locomotion controller. Every displayed frame is containment-projected.';
  ui['native-loading'].textContent = 'Initializing MuJoCo physics';
  updatePhysicsReadout();
  invalidateNativeFrame(true);
  physicsQueue?.enqueue(physicsFrameRequest(), `init:${++physicsRequestSerial}`, nativeRevision);
  return true;
}

async function physicsControl(action) {
  if (state.simulationMode !== 'physics' || physicsControlPending) return;
  const caseId = state.caseId, generation = ++physicsControlGeneration;
  const current = () => generation === physicsControlGeneration && state.caseId === caseId && state.simulationMode === 'physics';
  setPhysicsPlaying(false);
  physicsControlPending = true;
  invalidateNativeFrame();
  for (const name of ['physics-reset', 'physics-play', 'physics-push']) ui[name].disabled = true;
  ui['physics-error'].hidden = true;
  try {
    // Finish any advancing frame before reset/push, so late requests cannot undo a control action.
    const deadline = performance.now() + 45000;
    while (physicsQueue?.inFlight) {
      if (!current()) return;
      if (performance.now() > deadline) throw new Error('The previous physics step did not finish.');
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    if (!current()) return;
    const response = await fetch(new URL('./api/physics/control', manifestURL), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_id: caseId, action, ...(action === 'push' ? { impulse_ns: [Math.min(2, (state.physicsMass || .5) * .1), 0, 0] } : {}) }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!current()) return;
    if (!response.ok) throw new Error(result.error || `Physics ${action} failed.`);
    if (action === 'reset') state.physicsTime = 0;
    updatePhysicsReadout();
    invalidateNativeFrame();
    if (state.physicsBrowser) physicsQueue?.enqueue(physicsFrameRequest(), `control:${++physicsRequestSerial}`, nativeRevision);
  } catch (error) {
    if (!current()) return;
    ui['physics-error'].textContent = error.message || String(error);
    ui['physics-error'].hidden = false;
  } finally {
    if (current()) {
      physicsControlPending = false;
      for (const name of ['physics-reset', 'physics-play', 'physics-push']) ui[name].disabled = false;
    }
  }
}

async function initializePhysics() {
  physicsQueue = new NativeFrameQueue(async (request) => {
    const response = await fetch(new URL('./api/physics/frame', manifestURL), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(45000),
    });
    if (request.pose_only) {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `MuJoCo physics failed (${response.status}).`);
      return { pose: result };
    }
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `MuJoCo physics failed (${response.status}).`);
    }
    if (!response.headers.get('Content-Type')?.startsWith('image/png')) throw new Error('The physics service did not return a PNG frame.');
    const numberHeader = (name) => {
      const raw = response.headers.get(name);
      if (raw === null || !Number.isFinite(Number(raw))) throw new Error('The physics frame is missing its simulation state.');
      return Number(raw);
    };
    return { blob: await response.blob(), time: numberHeader('X-Physics-Time'), contacts: numberHeader('X-Physics-Contacts'), mass: numberHeader('X-Physics-Mass'), phase: response.headers.get('X-Physics-Phase') };
  }, async (result, request, current) => {
    if (result.pose) {
      if (!current() || state.simulationMode !== 'physics') return;
      applyPhysicsPose(result.pose);
      return;
    }
    const url = URL.createObjectURL(result.blob);
    try {
      const decoded = new Image();
      decoded.src = url;
      await decoded.decode();
      if (!current() || state.simulationMode !== 'physics') { URL.revokeObjectURL(url); return; }
      const previous = nativeImageURL;
      nativeImageURL = url;
      ui['native-frame'].src = url;
      ui['native-frame'].hidden = false;
      ui['native-loading'].hidden = true;
      state.physicsTime = result.time;
      state.physicsContacts = result.contacts;
      state.physicsMass = result.mass;
      state.physicsPhase = result.phase;
      state.physicsFrame += 1;
      if (['failed', 'finished'].includes(result.phase)) {
        setPhysicsPlaying(false);
        ui['physics-play'].disabled = true;
        ui['physics-push'].disabled = true;
        ui['renderer-status'].textContent = result.phase === 'finished' ? 'MuJoCo / session completed' : 'MuJoCo / simulation stopped';
      } else {
        ui['physics-play'].disabled = false;
        ui['physics-push'].disabled = false;
        ui['renderer-status'].textContent = 'MuJoCo / passive dynamics';
      }
      updatePhysicsReadout();
      if (previous) URL.revokeObjectURL(previous);
    } catch (error) { URL.revokeObjectURL(url); throw error; }
  }, (error) => {
    setPhysicsPlaying(false);
    ui['native-loading'].hidden = true;
    ui['physics-error'].textContent = error.message || String(error);
    ui['physics-error'].hidden = false;
  });
  try {
    const response = await fetch(new URL('./api/physics/status', manifestURL), { signal: AbortSignal.timeout(30000) });
    const status = await response.json();
    if (!response.ok || status.available !== true || status.engine !== 'MuJoCo' || status.dynamics_simulation !== true || status.mode !== 'passive') throw new Error('Physics service unavailable.');
    state.physicsAvailable = true;
    ui['renderer-select'].querySelector('[value="physics"]').disabled = false;
  } catch { state.physicsAvailable = false; }
}

function decodeMotion(entry, buffer, arrays, skeleton, id) {
  const { jointCount, bindMatrices, parents, order, localOffsets } = skeleton;
  const times = Float64Array.from(entry.times || []);
  const descriptor = typeof entry.transforms === 'string' ? arrays[entry.transforms] : entry.transforms;
  const transforms = typedArray(buffer, descriptor, `${id} transforms`);
  if (!times.length || transforms.length !== times.length * jointCount * 16) throw new Error(`Invalid ${id} motion dimensions.`);
  finiteArray(times, `${id} times`);
  finiteArray(transforms, `${id} transforms`);
  for (let frame = 1; frame < times.length; frame += 1) {
    if (times[frame] <= times[frame - 1]) throw new Error(`${id} motion times are not strictly increasing.`);
  }
  const positions = new Float32Array(times.length * jointCount * 3);
  const quaternions = new Float32Array(times.length * jointCount * 4);
  const globalFrames = Array.from({ length: jointCount }, () => new THREE.Matrix4());
  const localFrame = new THREE.Matrix4();
  for (let i = 0; i < times.length * jointCount; i += 1) {
    scratchMatrix.fromArray(transforms, i * 16).transpose();
    scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale);
    if (Math.max(Math.abs(scratchScale.x - 1), Math.abs(scratchScale.y - 1), Math.abs(scratchScale.z - 1)) > 0.002) {
      throw new Error(`${id} includes a non-rigid motion transform.`);
    }
    const e = scratchMatrix.elements;
    const columnDot = Math.max(Math.abs(e[0] * e[4] + e[1] * e[5] + e[2] * e[6]), Math.abs(e[0] * e[8] + e[1] * e[9] + e[2] * e[10]), Math.abs(e[4] * e[8] + e[5] * e[9] + e[6] * e[10]));
    if (columnDot > 0.002 || Math.max(Math.abs(e[3]), Math.abs(e[7]), Math.abs(e[11]), Math.abs(e[15] - 1)) > 0.00001) throw new Error(`${id} includes a sheared or non-affine motion transform.`);
    globalFrames[i % jointCount].multiplyMatrices(scratchMatrix, bindMatrices[i % jointCount]);
    if (i % jointCount !== jointCount - 1) continue;
    const frameStart = i - jointCount + 1;
    // Interpolate in local FK space, not independent world delta space.
    for (const joint of order) {
      const parent = parents[joint];
      if (parent < 0 || parent === joint) localFrame.copy(globalFrames[joint]);
      else localFrame.copy(globalFrames[parent]).invert().multiply(globalFrames[joint]);
      localFrame.decompose(scratchPosition, scratchQuaternion, scratchScale);
      if (parent >= 0 && parent !== joint) {
        if (scratchPosition.distanceTo(localOffsets[joint]) > 0.0001) throw new Error(`${id} changes an authored joint offset.`);
        scratchPosition.copy(localOffsets[joint]);
      }
      scratchQuaternion.normalize();
      scratchPosition.toArray(positions, (frameStart + joint) * 3);
      scratchQuaternion.toArray(quaternions, (frameStart + joint) * 4);
    }
  }
  let restIdentity = times.length === 1;
  if (restIdentity) {
    for (let index = 0; index < transforms.length; index += 1) {
      if (Math.abs(transforms[index] - ((index % 16) % 5 === 0 ? 1 : 0)) > 0.0000001) {
        restIdentity = false;
        break;
      }
    }
  }
  const scenery = entry.scenery || { boxes: [] };
  if (!Array.isArray(scenery.boxes || [])) throw new Error('Invalid motion scenery.');
  for (const box of scenery.boxes || []) {
    if (!Array.isArray(box.position) || !Array.isArray(box.size) || box.position.length !== 3 || box.size.length !== 3
        || !box.position.every(Number.isFinite) || !box.size.every((value) => Number.isFinite(value) && value > 0)
        || (box.yaw_rad !== undefined && !Number.isFinite(box.yaw_rad))) throw new Error('Invalid scenery box dimensions.');
  }
  return { times, positions, quaternions, sourceTransforms: transforms, sourceMetadata: structuredClone(entry), duration: times[times.length - 1] - times[0], scenery, restIdentity, label: entry.label || null,
    source: entry.source && typeof entry.source.clip === 'string' && Number.isFinite(entry.source.source_fps) ? structuredClone(entry.source) : null };
}

async function verifyMotionSourceArray(array, identity, shape, name) {
  const dtype = array instanceof Float32Array ? 'float32' : array instanceof Float64Array ? 'float64' : null;
  if (!dtype || new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1 || identity?.dtype !== dtype
      || !Array.isArray(identity.shape) || identity.shape.length !== shape.length || identity.shape.some((size, index) => size !== shape[index])) throw new Error(`Invalid ${name} array identity.`);
  await verifyHash(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), identity.sha256, name);
}

async function validateTerminalCorrections(payload, model) {
  if (!payload || payload.schema !== 'atlas_unmeasured_terminal_bind_v1' || payload.quaternion_order !== 'xyzw'
      || !payload.clips || typeof payload.clips !== 'object' || Array.isArray(payload.clips)
      || payload.local_translations_unchanged !== true || payload.joint_origins_unchanged !== true
      || payload.measured_control_rotations_unchanged !== true || payload.source_arrays_modified !== false
      || payload.source_cadence_unchanged !== true || payload.recorded_finger_motion_recovered !== false
      || payload.containment_validated !== false || payload.anatomical_fit_validated !== false
      || payload.prior_pose_containment_evidence_inherited !== false) throw new Error('Invalid terminal correction scope.');
  await verifyHash(anatomyMetadataBytes(model.sourceRig), payload.source_rig_sha256, 'Terminal correction rig');
  await verifyMotionSourceArray(model.sourceBindFrames, payload.source_bind_frames, [model.jointCount, 4, 4], 'Terminal correction bind frames');
  const channels = { lfingers: ['LeftHandFinger1', 'LeftFingerBase'], lthumb: ['LThumb', 'LeftHand'], rfingers: ['RightHandFinger1', 'RightFingerBase'], rthumb: ['RThumb', 'RightHand'] };
  const clips = {};
  for (const [id, entry] of Object.entries(payload.clips)) {
    const motion = model.motions[id];
    if (!motion || typeof entry?.enabled !== 'boolean') throw new Error('Invalid terminal correction clip.');
    if (!entry.enabled) { if (entry.controls?.length) throw new Error('Inactive terminal correction contains controls.'); continue; }
    if (!['walk', 'walk_sit', 'stairs'].includes(id) || motion.restIdentity || motion.source?.provider !== 'cmu' || !['07_01', '86_09', '143_17'].includes(motion.source?.clip)
        || entry.source_clip !== motion.source.clip || !Array.isArray(entry.controls) || entry.controls.length !== 4
        || entry.constant_rotation_tolerance_rad !== 5e-5 || !Number.isFinite(entry.maximum_source_local_rotation_variation_rad)
        || entry.maximum_source_local_rotation_variation_rad < 0 || entry.maximum_source_local_rotation_variation_rad > 5e-5) throw new Error('Unsupported terminal correction clip scope.');
    await verifyMotionSourceArray(motion.sourceTransforms, entry.source_transforms, [motion.times.length, model.jointCount, 4, 4], 'Terminal correction source transforms');
    await verifyMotionSourceArray(motion.times, entry.source_times, [motion.times.length], 'Terminal correction source times');
    const seen = new Set(), byIndex = {};
    for (const control of entry.controls) {
      const expected = channels[control.source_channel], index = control.index, parent = control.parent_index, quaternion = control.local_bind_quaternion_xyzw;
      if (!expected || seen.has(control.source_channel) || !Number.isSafeInteger(index) || !Number.isSafeInteger(parent)
          || expected[0] !== control.name || expected[1] !== control.parent_name || model.sourceRig.names[index] !== control.name
          || model.sourceRig.names[parent] !== control.parent_name || model.skeleton.parents[index] !== parent
          || model.skeleton.parents.includes(index) || !Array.isArray(quaternion) || quaternion.length !== 4
          || !quaternion.every(Number.isFinite) || Math.abs(Math.hypot(...quaternion) - 1) > 1e-8) throw new Error('Invalid terminal correction control.');
      const q = new THREE.Quaternion().fromArray(quaternion), rotation = new THREE.Matrix4().makeRotationFromQuaternion(q);
      const authored = model.skeleton.inverseBindMatrices[parent].clone().multiply(model.skeleton.bindMatrices[index]);
      if ([0, 1, 2, 4, 5, 6, 8, 9, 10].some((offset) => Math.abs(rotation.elements[offset] - authored.elements[offset]) > 1e-5)) throw new Error('Terminal correction does not match authored local bind rotation.');
      const first = new THREE.Quaternion().fromArray(motion.quaternions, index * 4).normalize();
      for (let frame = 1; frame < motion.times.length; frame += 1) {
        const source = new THREE.Quaternion().fromArray(motion.quaternions, (frame * model.jointCount + index) * 4).normalize();
        if (2 * Math.acos(Math.min(1, Math.abs(first.dot(source)))) > 5.01e-5) throw new Error('Terminal correction would discard varying source rotation.');
      }
      seen.add(control.source_channel); byIndex[index] = [...quaternion];
    }
    clips[id] = { ...entry, byIndex };
  }
  return { ...payload, clips };
}

async function validateMotionAdjustments(data, motions) {
  if (!data || !data.clips || typeof data.clips !== 'object' || Array.isArray(data.clips)) throw new Error('Invalid motion floor adjustment.');
  const result = {};
  for (const [id, curve] of Object.entries(data.clips)) {
    if (!Object.hasOwn(motions, id)) throw new Error('Floor correction names an unavailable motion.');
    if (typeof curve.enabled !== 'boolean') throw new Error('Invalid motion floor adjustment state.');
    if (!curve.enabled) continue;
    if (!Array.isArray(curve.times) || !Array.isArray(curve.offsets_m) || !curve.times.length
        || curve.times.length !== curve.offsets_m.length || curve.times.length > 50000
        || !curve.times.every(Number.isFinite) || !curve.offsets_m.every((value) => Number.isFinite(value) && Math.abs(value) <= .050001)
        || curve.times.some((value, index) => index > 0 && value <= curve.times[index - 1])) throw new Error('Invalid bounded motion floor correction.');
    const motion = motions[id];
    if (!motion.source || motion.source.provider !== 'cmu' || !['07_01', '86_09', '143_17'].includes(motion.source.clip)
        || curve.source_provider !== motion.source.provider || curve.source_clip !== motion.source.clip) throw new Error('Floor correction source does not match the selected recording.');
    const controls = motion.sourceTransforms.length / (motion.times.length * 16);
    if (!Number.isSafeInteger(controls) || controls < 1) throw new Error('Invalid floor correction source dimensions.');
    await verifyMotionSourceArray(motion.sourceTransforms, curve.source_transforms, [motion.times.length, controls, 4, 4], 'Floor correction source transforms');
    await verifyMotionSourceArray(motion.times, curve.source_times, [motion.times.length], 'Floor correction source times');
    if (curve.times[0] !== motion.times[0] || curve.times.at(-1) !== motion.times.at(-1)) throw new Error('Floor correction timeline does not match the selected recording.');
    result[id] = curve;
  }
  return result;
}

function motionFloorOffset(curve, time) {
  if (!curve?.enabled) return 0;
  const { times, offsets_m: offsets } = curve;
  if (time <= times[0]) return offsets[0];
  if (time >= times[times.length - 1]) return offsets[offsets.length - 1];
  let lo = 0, hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  const alpha = (time - times[lo]) / (times[hi] - times[lo]);
  return offsets[lo] + alpha * (offsets[hi] - offsets[lo]);
}

function anatomyMetadataBytes(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (typeof item === 'string' && /^[\x00-\x7f]*$/.test(item)) return item;
    if (Number.isSafeInteger(item) && !Object.is(item, -0)) return item;
    if (item && typeof item === 'object') {
      const keys = Object.keys(item).sort();
      if (keys.some((key) => !/^[\x00-\x7f]*$/.test(key))) throw new Error('Unsupported anatomy metadata key.');
      return Object.fromEntries(keys.map((key) => [key, normalize(item[key])]));
    }
    throw new Error('Unsupported anatomy metadata value.');
  };
  return new TextEncoder().encode(JSON.stringify(normalize(value)));
}

function isChildRegionalCase(caseId) {
  return typeof caseId === 'string' && /^(toddler|child)_(male|female)_weight(025|050|075)$/.test(caseId);
}

const finiteHandMeshNames = ['hand_r__5mc_new', 'hand_l__5mc_new'];

function isFiniteHandCase(caseId) {
  return typeof caseId === 'string' && /^(teen|adult)_(male|female)_weight(025|050|075)$/.test(caseId);
}

function regionalRefinementSchema(caseId) {
  if (isChildRegionalCase(caseId)) return 'atlas_child_regional_refinement_patch_v1';
  if (caseId !== 'adult_female_weight050' && isFiniteHandCase(caseId)) return 'atlas_finite_pose_hand_refinement_patch_v1';
  return typeof caseId === 'string' && /^elder_(male|female)_weight(025|050|075)$/.test(caseId)
    ? 'atlas_elder_regional_refinement_patch_v1' : null;
}

function decodeCoupledPositions(patch, count) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Number.isSafeInteger(count) || count < 1) throw new Error('Invalid coupled position source span.');
  const packed = Object.hasOwn(patch, 'positions_encoding') || Object.hasOwn(patch, 'positions_base64');
  if (packed) {
    const encoded = patch.positions_base64;
    if (Object.hasOwn(patch, 'positions') || patch.positions_encoding !== 'base64-float32-le'
        || typeof encoded !== 'string' || encoded.length !== count * 16 || !/^[A-Za-z0-9+/]+$/.test(encoded)) throw new Error('Invalid packed coupled positions.');
    const binary = atob(encoded);
    if (binary.length !== count * 12) throw new Error('Packed coupled positions differ from the source span.');
    const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0)), view = new DataView(bytes.buffer);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < positions.length; i += 1) positions[i] = view.getFloat32(i * 4, true);
    if (positions.some((value) => !Number.isFinite(value))) throw new Error('Packed coupled positions must be finite.');
    return positions;
  }
  if (!Array.isArray(patch.positions) || patch.positions.length !== count
      || patch.positions.some((point) => !Array.isArray(point) || point.length !== 3
        || point.some((value) => typeof value !== 'number' || !Number.isFinite(value) || !Object.is(Math.fround(value), value)))) throw new Error('Coupled refinement positions must be finite, exact Float32 triples.');
  return Float32Array.from(patch.positions.flat());
}

function coupledRefinementSourcePaths(caseId) {
  const paths = ['topology.json', 'topology.bin', `cases/${caseId}.json`, `cases/${caseId}.bin`, `${referenceBankDirectory}/manifest.json`];
  if (!isChildRegionalCase(caseId)) paths.push(`${referenceBankDirectory}/${caseId}.json`, `${referenceBankDirectory}/${caseId}.bin`);
  return new Set(paths);
}

function baseRefinementSourcePaths(caseId) {
  return new Set(['topology.json', 'topology.bin', `cases/${caseId}.json`, `cases/${caseId}.bin`,
    'reference_motions/manifest.json', `reference_motions/${caseId}.json`, `reference_motions/${caseId}.bin`]);
}

function validateBrowserBaseRefinement(base) {
  if (!base || typeof base !== 'object' || Array.isArray(base) || base.schema !== 'atlas_anatomy_refinement_patch_v1'
      || base.case_id !== 'adult_female_weight050' || base.applied !== true || !Array.isArray(base.patches)
      || ['supplemental', 'case_patches', 'browser_base_refinement'].some((key) => Object.hasOwn(base, key))) throw new Error('Invalid published browser anatomy predecessor.');
  return base;
}

function regionalRefinementCaseIds(asset) {
  if (!asset) return [];
  if (!Object.hasOwn(asset, 'case_ids')) return [asset.case_id];
  const ids = asset.case_ids;
  if (asset.case_id !== 'adult_female_weight050' || !Array.isArray(ids) || !ids.length || ids.length > 30
      || new Set(ids).size !== ids.length || !ids.includes(asset.case_id)
      || ids.some((id) => id !== asset.case_id && !regionalRefinementSchema(id))) throw new Error('Invalid published anatomy correction case registry.');
  return ids;
}

function selectPublishedRegionalPatch(payload, caseId, asset) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid published anatomy correction collection.');
  const collection = Object.hasOwn(payload, 'case_patches') ? payload.case_patches : {};
  if (!collection || typeof collection !== 'object' || Array.isArray(collection) || Object.keys(collection).length > 29
      || Object.entries(collection).some(([id, patch]) => !regionalRefinementSchema(id) || !patch || typeof patch !== 'object'
        || Array.isArray(patch) || patch.case_id !== id || patch.schema !== regionalRefinementSchema(id)
        || patch.applied !== true || Object.hasOwn(patch, 'case_patches'))) throw new Error('Invalid published regional anatomy correction collection.');
  const declared = regionalRefinementCaseIds(asset), expected = [payload.case_id, ...Object.keys(collection)];
  if (payload.case_id !== asset.case_id || declared.length !== expected.length
      || expected.some((id) => !declared.includes(id))) throw new Error('Published anatomy correction registry differs from its payload.');
  if (Object.hasOwn(payload, 'browser_base_refinement')) {
    if (payload.case_id !== 'adult_female_weight050') throw new Error('Invalid published browser anatomy root.');
    validateBrowserBaseRefinement(payload.browser_base_refinement);
  }
  if (caseId === payload.case_id) {
    const { case_patches, browser_base_refinement, ...root } = payload;
    return root;
  }
  if (!Object.hasOwn(collection, caseId)) throw new Error('Published regional anatomy correction is missing.');
  return collection[caseId];
}

function canonicalAnatomyPatchJSON(value) {
  const normalize = (item) => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return item;
    if (Array.isArray(item)) return item.map(normalize);
    if (Object.prototype.toString.call(item) === '[object Object]') return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
    throw new Error('Anatomy correction contains unsupported JSON values.');
  };
  return JSON.stringify(normalize(value));
}

async function fetchPublishedAnatomyRefinement(caseId, signal) {
  const asset = manifest?.anatomy_refinement_asset;
  if (!regionalRefinementCaseIds(asset).includes(caseId)) throw new Error('No published anatomy correction for this case.');
  if (asset.data_url !== 'regional_refinement.json' || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid published anatomy correction declaration.');
  const bytes = await fetchChecked(absoluteURL(asset.data_url, manifestURL), signal, false);
  await verifyHash(bytes, asset.sha256, 'Published anatomy correction');
  const payload = parseJSONBuffer(bytes, 'published anatomy correction');
  return { payload, selected: selectPublishedRegionalPatch(payload, caseId, asset),
    publication: { case_id: caseId, data_url: asset.data_url, sha256: asset.sha256 } };
}

async function loadStaticAnatomyRefinement(caseId, signal) {
  const { payload, selected, publication } = await fetchPublishedAnatomyRefinement(caseId, signal);
  const base = regionalRefinementSchema(caseId)
    ? { schema: 'atlas_anatomy_refinement_patch_v1', case_id: caseId, applied: false, patches: [],
      reason: 'No source-bound regional correction for this case' }
    : validateBrowserBaseRefinement(payload.browser_base_refinement);
  return { refinement: { ...base, supplemental: selected }, publication, delivery: 'published_static', nativeUnavailable: true };
}

async function loadAnatomyRefinementPayload(caseId, signal, nativeAvailable = state.nativeAvailable) {
  const published = regionalRefinementCaseIds(manifest?.anatomy_refinement_asset).includes(caseId);
  const teenPublished = teenRegionalCaseIds(manifest?.teen_regional_refinement_asset).includes(caseId);
  const infantPublished = infantNeutralNeckCaseIds(manifest?.infant_neutral_neck_asset).includes(caseId);
  const infantSkinPublished = infantNeutralSkinCaseIds(manifest?.infant_neutral_skin_asset).includes(caseId);
  const teenSkinPublished = teenNeutralSkinCaseIds(manifest?.teen_neutral_skin_asset).includes(caseId);
  const adultSkinPublished = teenNeutralSkinCaseIds(manifest?.adult_neutral_skin_asset, 'adult').includes(caseId);
  const postPublished = teenPublished || infantPublished || infantSkinPublished || teenSkinPublished || adultSkinPublished;
  if (published && !nativeAvailable) return loadStaticAnatomyRefinement(caseId, signal);
  if (!nativeAvailable || (!published && !postPublished && caseId !== 'adult_female_weight050')) return null;
  let response, refinement;
  // Cold native loads validate the published trajectory before returning its binding.
  const nativeAnatomyTimeoutMs = 60000;
  const timeout = AbortSignal.timeout(nativeAnatomyTimeoutMs);
  try {
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    response = await fetch(new URL(`./api/native/anatomy-refinement?case_id=${encodeURIComponent(caseId)}`, manifestURL), { signal: requestSignal });
    if (response.ok) refinement = await response.json();
  } catch (error) {
    const timedOut = timeout.aborted && ['AbortError', 'TimeoutError'].includes(error.name);
    if (signal?.aborted || (error.name === 'AbortError' && !timedOut)) throw error;
    const unavailable = timedOut || error instanceof TypeError || error.name === 'TypeError' || error.name === 'TimeoutError';
    if (published && unavailable) return loadStaticAnatomyRefinement(caseId, signal);
    if (postPublished && unavailable) return null;
    if (timedOut) throw new Error('The native anatomy response timed out.');
    throw error;
  }
  if (published && [404, 502, 503, 504].includes(response.status)) return loadStaticAnatomyRefinement(caseId, signal);
  if (postPublished && [404, 502, 503, 504].includes(response.status)) return null;
  if (response.status === 404 && !published) return null;
  if (!response.ok) throw new Error(`The native anatomy refinement could not be loaded (${response.status}).`);
  const publication = await verifyPublishedAnatomyRefinement(refinement, caseId, signal);
  return { refinement, publication, delivery: 'native', nativeUnavailable: false };
}

function useStaticAnatomyServices(reason = 'Our Model service unavailable; browser playback only.') {
  const deferred = reason.startsWith('Browser playback selected;');
  state.nativeAvailable = false;
  state.physicsAvailable = false;
  state.nativeError = reason;
  setRenderer('gallery');
  const nativeOption = ui['renderer-select'].querySelector('[value="native"]');
  nativeOption.disabled = false;
  nativeOption.textContent = deferred ? 'MuJoCo playback' : 'MuJoCo (retry)';
  ui['renderer-select'].querySelector('[value="physics"]').disabled = !deferred;
  ui['renderer-select'].title = state.nativeError;
  ui['renderer-status'].textContent = deferred ? 'Browser 3D / source-checked playback' : 'Browser 3D / native unavailable';
}

// Switch on the MuJoCo services for the body already on screen, without reloading its assets.
async function enableNativeServices() {
  if (!state.loaded) return loadCase(state.caseId, { recoverServices: true }).then(() => state.nativeAvailable);
  ui['renderer-status'].textContent = 'Connecting to MuJoCo';
  try {
    const capabilities = await probeAtlasRecovery(AbortSignal.timeout(30000));
    if (!capabilities.nativeAvailable) { useStaticAnatomyServices(); return false; }
    state.nativeAvailable = true;
    state.physicsAvailable = capabilities.physicsAvailable;
    state.nativeError = null;
    const nativeOption = ui['renderer-select'].querySelector('[value="native"]');
    nativeOption.disabled = false;
    nativeOption.textContent = 'MuJoCo playback';
    ui['renderer-select'].querySelector('[value="physics"]').disabled = !capabilities.physicsAvailable;
    if (capabilities.version) ui['renderer-select'].title = `Native MuJoCo ${capabilities.version}: kinematic rendering`;
    return true;
  } catch (error) {
    useStaticAnatomyServices();
    return false;
  }
}

async function probeAtlasRecovery(signal) {
  signal.throwIfAborted();
  const unavailable = { nativeAvailable: false, physicsAvailable: false };
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  let status;
  try {
    const service = await fetch(manifestURL, { method: 'HEAD', signal: requestSignal, cache: 'no-cache' });
    if ([404, 502, 503, 504].includes(service.status)) return unavailable;
    if (!service.ok) throw new Error(`Our Model service probe failed (${service.status}).`);
    if (service.headers.get('X-Atlas-Native') !== 'MuJoCo') return unavailable;
    const response = await fetch(new URL('./api/native/status', manifestURL), { signal: requestSignal, cache: 'no-cache' });
    if ([404, 502, 503, 504].includes(response.status)) return unavailable;
    if (!response.ok) throw new Error(`Native renderer probe failed (${response.status}).`);
    status = await response.json();
    if (!status || Object.prototype.toString.call(status) !== '[object Object]'
        || status.available !== true || status.engine !== 'MuJoCo' || status.native_skinning !== true
        || status.dynamics_simulation !== false) throw new Error('The native service has an unsupported rendering contract.');
  } catch (error) {
    if (signal.aborted || error.name === 'AbortError') throw error;
    if (error instanceof TypeError || error.name === 'TypeError' || error.name === 'TimeoutError') return unavailable;
    throw error;
  }
  let physicsAvailable = false;
  try {
    const response = await fetch(new URL('./api/physics/status', manifestURL), { signal: requestSignal, cache: 'no-cache' });
    const physics = await response.json();
    physicsAvailable = response.ok && physics.available === true && physics.engine === 'MuJoCo'
      && physics.dynamics_simulation === true && physics.mode === 'passive';
  } catch (error) {
    if (signal.aborted || error.name === 'AbortError') throw error;
  }
  return { nativeAvailable: true, physicsAvailable, version: status.version };
}

async function verifyPublishedAnatomyRefinement(refinement, caseId, signal) {
  const asset = manifest?.anatomy_refinement_asset;
  if (!regionalRefinementCaseIds(asset).includes(caseId)) {
    if (refinement && Object.hasOwn(refinement, 'supplemental')) throw new Error('Unexpected anatomy correction without a matching publication.');
    return null;
  }
  if (asset.data_url !== 'regional_refinement.json' || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid published anatomy correction declaration.');
  const supplemental = refinement?.supplemental;
  if (refinement?.case_id !== caseId || refinement.applied !== !regionalRefinementSchema(caseId)
      || supplemental?.applied !== true || supplemental.case_id !== caseId) throw new Error('The Our Model service does not match the published anatomy correction.');
  const { selected: expected, publication } = await fetchPublishedAnatomyRefinement(caseId, signal);
  if (canonicalAnatomyPatchJSON(expected) !== canonicalAnatomyPatchJSON(supplemental)) throw new Error('The Our Model service anatomy correction differs from the published asset.');
  return publication;
}

async function verifyAnatomySourceFiles(model, payload, caseId, baseDataBytes, baseBuffer, signal) {
  if (payload.applied !== true) return;
  if (payload.schema === 'atlas_coupled_refinement_patch_v1' || payload.schema === 'atlas_child_regional_refinement_patch_v1'
      || payload.schema === 'atlas_elder_regional_refinement_patch_v1' || payload.schema === 'atlas_coupled_refinement_patch_v2'
      || payload.schema === 'atlas_finite_pose_hand_refinement_patch_v1') {
    const files = payload.source_file_hashes;
    const allowed = coupledRefinementSourcePaths(caseId);
    if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length !== allowed.size
        || Object.keys(files).some((path) => !allowed.has(path))) throw new Error('Invalid coupled refinement source files or active motion bank.');
    const verified = {};
    for (const [path, expected] of Object.entries(files)) {
      if (model.verifiedSourceHashes?.[path] !== expected || !expected) {
        const bytes = path === `cases/${caseId}.json` ? baseDataBytes : path === `cases/${caseId}.bin` ? baseBuffer
          : await fetchChecked(absoluteURL(`./${path}`, manifestURL), signal, false);
        await verifyHash(bytes, expected, `Coupled refinement source ${path}`);
      }
      verified[path] = expected;
    }
    model.coupledRefinementSourceHashes = verified;
    return;
  }
  const files = payload.source_file_hashes, required = baseRefinementSourcePaths(caseId), verified = {};
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length !== required.size
      || Object.keys(files).some((path) => !required.has(path))) throw new Error('Invalid historical anatomy source files.');
  for (const [path, expected] of Object.entries(files)) {
    if (model.verifiedSourceHashes?.[path] !== expected || !expected) {
      const bytes = path === `cases/${caseId}.json` ? baseDataBytes : path === `cases/${caseId}.bin` ? baseBuffer
        : await fetchChecked(absoluteURL(`./${path}`, manifestURL), signal, false);
      await verifyHash(bytes, expected, `Historical anatomy source ${path}`);
    }
    verified[path] = expected;
  }
  model.refinementSourceHashes = verified;
}

async function applyAnatomyRefinement(model, payload, caseId) {
  if (!payload || payload.schema !== 'atlas_anatomy_refinement_patch_v1' || payload.case_id !== caseId
      || typeof payload.applied !== 'boolean' || !Array.isArray(payload.patches)) throw new Error('Invalid anatomy refinement identity.');
  if (!payload.applied) {
    if (payload.patches.length) throw new Error('Inactive anatomy refinement contains geometry.');
    const { supplemental, ...inactive } = payload;
    model.anatomyRefinement = inactive;
    return false;
  }
  const permitted = new Set(['ulna', 'radius', 'ulna_mirror', 'radius_mirror']);
  const limitations = ['raw_skin_intersection_free', 'raw_strict_gate_passed', 'continuous_containment_certified', 'anatomical_fit_validated'];
  if (caseId !== 'adult_female_weight050' || payload.patches.length !== permitted.size
      || limitations.some((key) => payload.report?.[key] !== false)) throw new Error('Unsupported anatomy refinement scope.');
  const source = model.boneRest;
  if (!(source instanceof Float32Array) || new Uint8Array(new Float32Array([1]).buffer)[0] !== 0) throw new Error('Anatomy refinement requires little-endian Float32 positions.');
  await verifyHash(new Uint8Array(source.buffer, source.byteOffset, source.byteLength), payload.source_bone_positions_sha256, 'Anatomy refinement source');
  const requiredFiles = baseRefinementSourcePaths(caseId);
  if (!payload.source_file_hashes || Object.keys(payload.source_file_hashes).length !== requiredFiles.size
      || Object.keys(payload.source_file_hashes).some((path) => !requiredFiles.has(path))) throw new Error('Anatomy refinement verified source files do not match.');
  for (const path of requiredFiles) {
    const expected = payload.source_file_hashes?.[path];
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)
        || (model.refinementSourceHashes || model.verifiedSourceHashes)?.[path] !== expected) throw new Error('Anatomy refinement verified source files do not match.');
  }
  await verifyHash(anatomyMetadataBytes(model.sourceRig), payload.source_rig_sha256, 'Anatomy refinement rig metadata');
  await verifyHash(anatomyMetadataBytes(model.sourceBoneMeshes), payload.source_mesh_metadata_sha256, 'Anatomy refinement mesh metadata');
  for (const name of ['skin_faces', 'bone_faces']) {
    const faces = model.sourceTopology?.[name];
    if (!(faces instanceof Uint32Array)) throw new Error('Anatomy refinement requires Uint32 triangle indices.');
    await verifyHash(new Uint8Array(faces.buffer, faces.byteOffset, faces.byteLength), payload[`source_${name}_sha256`], `Anatomy refinement ${name}`);
  }
  if (model.skin.geometry.index.array !== model.sourceTopology.skin_faces
      || model.skeleton.parents !== model.sourceRig.parents
      || model.bones.some(({ spec, control, mesh }, index) => spec !== model.sourceBoneMeshes[index]
        || control !== spec.control_index || mesh.geometry.index.count !== spec.index_count
        || mesh.geometry.index.array.some((value, offset) => value + spec.vertex_start !== model.sourceTopology.bone_faces[spec.index_start + offset]))) {
    throw new Error('Anatomy refinement rendered topology or rig differs from its source.');
  }
  const candidate = new Float32Array(source);
  const selected = [], names = new Set(), intervals = [];
  for (const patch of payload.patches) {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid anatomy refinement mesh.');
    const matches = model.bones.filter((bone) => bone.spec.name === patch.name);
    if (!permitted.has(patch.name) || names.has(patch.name) || matches.length !== 1
        || !Number.isSafeInteger(patch.vertex_start) || !Number.isSafeInteger(patch.vertex_count)
        || patch.vertex_start < 0 || patch.vertex_count < 1) throw new Error('Invalid or duplicate anatomy refinement mesh.');
    const { spec, mesh } = matches[0], start = patch.vertex_start * 3, end = start + patch.vertex_count * 3;
    if (spec.vertex_start !== patch.vertex_start || spec.vertex_count !== patch.vertex_count
        || end > source.length || intervals.some(([a, b]) => start < b && end > a)
        || mesh.geometry.getAttribute('position').count !== patch.vertex_count
        || !Array.isArray(patch.positions) || patch.positions.length !== patch.vertex_count) throw new Error('Anatomy refinement span does not match its mesh.');
    for (let vertex = 0; vertex < patch.positions.length; vertex += 1) {
      const point = patch.positions[vertex];
      if (!Array.isArray(point) || point.length !== 3
          || point.some((value) => !Number.isFinite(value) || !Object.is(Math.fround(value), value))) throw new Error('Anatomy refinement positions must be finite, exact Float32 values.');
      candidate.set(point, start + vertex * 3);
    }
    names.add(patch.name);
    intervals.push([start, end]);
    selected.push({ mesh, start, end, name: patch.name, vertex_start: patch.vertex_start, vertex_count: patch.vertex_count });
  }
  await verifyHash(candidate.buffer, payload.output_bone_positions_sha256, 'Anatomy refinement output');
  // Stage every geometry before replacing anything visible or changing the source rest array.
  const staged = [];
  try {
    for (const item of selected) {
      const geometry = item.mesh.geometry.clone();
      staged.push({ ...item, geometry, previous: item.mesh.geometry });
      geometry.getAttribute('position').array.set(candidate.subarray(item.start, item.end));
      geometry.getAttribute('position').needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
  } catch (error) {
    staged.forEach(({ geometry }) => geometry.dispose());
    throw error;
  }
  for (const { mesh, geometry } of staged) mesh.geometry = geometry;
  model.boneRest = candidate;
  model.anatomyRefinement = {
    schema: payload.schema, case_id: caseId, applied: true,
    source_bone_positions_sha256: payload.source_bone_positions_sha256,
    output_bone_positions_sha256: payload.output_bone_positions_sha256,
    source_rig_sha256: payload.source_rig_sha256,
    source_mesh_metadata_sha256: payload.source_mesh_metadata_sha256,
    source_skin_faces_sha256: payload.source_skin_faces_sha256,
    source_bone_faces_sha256: payload.source_bone_faces_sha256,
    verified_source_file_hashes: { ...(model.refinementSourceHashes || model.verifiedSourceHashes) },
    patches: selected.map(({ name, vertex_start, vertex_count }) => ({ name, vertex_start, vertex_count })),
    report: payload.report,
  };
  staged.forEach(({ previous }) => previous.dispose());
  return true;
}

function anatomyRefinementArrays(model) {
  return { skin_positions: model.skinRest, skin_indices: model.skinIndices, skin_weights: model.skinWeights,
    bone_positions: model.boneRest, bind_frames: model.sourceBindFrames,
    skin_faces: model.sourceTopology.skin_faces, bone_faces: model.sourceTopology.bone_faces };
}

async function verifyRefinementArray(array, identity, shape, name) {
  const dtype = array instanceof Float32Array ? 'float32' : array instanceof Uint16Array ? 'uint16' : array instanceof Uint32Array ? 'uint32' : null;
  if (!dtype || !identity || identity.dtype !== dtype || !Array.isArray(shape) || !shape.length
      || shape.some((count) => !Number.isSafeInteger(count) || count < 0)
      || shape.reduce((total, count) => total * count, 1) !== array.length
      || !Array.isArray(identity.shape) || identity.shape.length !== shape.length
      || identity.shape.some((count, index) => count !== shape[index])) throw new Error(`Invalid coupled refinement ${name} array identity.`);
  await verifyHash(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), identity.sha256, `Coupled refinement ${name}`);
}

function renderedAnatomyPositions(model) {
  const positions = new Float32Array(model.boneRest.length);
  for (const { mesh, spec } of model.bones) positions.set(mesh.geometry.getAttribute('position').array, spec.vertex_start * 3);
  return positions;
}

async function coupledOwnershipMetadata(model, payload) {
  const patches = Object.hasOwn(payload, 'ownership_patches') ? payload.ownership_patches : [];
  if (!Array.isArray(patches) || patches.length > 2) throw new Error('Invalid coupled anatomy ownership patch count.');
  const source = model.sourceBoneMeshes, rig = model.sourceRig;
  await verifyHash(anatomyMetadataBytes(source), payload.source_mesh_metadata_sha256, 'Ownership source metadata');
  const result = source.slice(), seen = new Set();
  for (const patch of patches) {
    const expected = { r_patella: [28, 27, 'RightLeg', 'RightUpLeg'], l_patella: [3, 2, 'LeftLeg', 'LeftUpLeg'] }[patch?.name];
    const index = source.findIndex((spec) => spec.name === patch?.name), spec = source[index];
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).sort().join(',') !== 'control_index,name,source_control_index'
        || !expected || !spec || seen.has(patch.name) || !Number.isSafeInteger(patch.source_control_index)
        || !Number.isSafeInteger(patch.control_index) || patch.source_control_index !== spec.control_index
        || patch.source_control_index !== expected[0] || patch.control_index !== expected[1]
        || spec.control_name !== expected[2] || rig.names[patch.source_control_index] !== expected[2] || rig.names[patch.control_index] !== expected[3]
        || rig.parents[patch.source_control_index] !== patch.control_index) throw new Error('Patella ownership must use its authored direct thigh parent.');
    result[index] = { ...spec, control_index: patch.control_index, control_name: expected[3],
      shape_region: `cmu:${expected[3]}`, semantics: 'Thigh-owned patella graphics prior; no independent patellofemoral law.' };
    seen.add(patch.name);
  }
  if (patches.length || Object.hasOwn(payload, 'output_mesh_metadata_sha256')) {
    await verifyHash(anatomyMetadataBytes(result), payload.output_mesh_metadata_sha256, 'Ownership output metadata');
  }
  return patches.length ? result : source;
}

async function validateFiniteHandEvidence(payload, caseId, source, candidate, meshes) {
  const evidence = payload.report?.hand_evidence;
  const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const sourceKeys = Object.keys(source);
  const hands = payload.patches.filter(({ name }) => finiteHandMeshNames.includes(name));
  if (!isFiniteHandCase(caseId) || !evidence || evidence.schema !== 'atlas_finite_pose_hand_evidence_v1'
      || evidence.case_id !== caseId || !hash(evidence.report_sha256) || !hash(evidence.candidate_archive_sha256)
      || !evidence.method_source_sha256 || typeof evidence.method_source_sha256 !== 'object'
      || Array.isArray(evidence.method_source_sha256) || !Object.keys(evidence.method_source_sha256).length
      || Object.keys(evidence.method_source_sha256).length > 64 || Object.keys(evidence.method_source_sha256).some((key) => !key)
      || Object.values(evidence.method_source_sha256).some((value) => !hash(value))
      || evidence.checked_mesh_count !== 132 || meshes.length !== 132 || hands.length !== 2
      || new Set(hands.map(({ name }) => name)).size !== 2
      || ['geometry_quality_pass', 'source_contact_regions_pinned', 'preserved_skin_weights_faces_rig_ownership',
        'finite_native_surface_nonregression_pass'].some((key) => evidence[key] !== true)) throw new Error('Invalid finite hand qualification evidence.');
  let indexEnd = 0;
  if (meshes.some((mesh) => !mesh || typeof mesh.name !== 'string')
      || new Set(meshes.map(({ name }) => name)).size !== 132
      || finiteHandMeshNames.some((name) => !meshes.some((mesh) => mesh.name === name))) throw new Error('Finite hand evidence requires 132 distinct original meshes.');
  for (const mesh of [...meshes].sort((a, b) => a.index_start - b.index_start)) {
    if (mesh.index_start !== indexEnd || !Number.isSafeInteger(mesh.index_count)
        || mesh.index_count <= 0 || mesh.index_count % 3) throw new Error('Finite hand evidence requires complete original triangle spans.');
    indexEnd += mesh.index_count;
  }
  if (indexEnd !== source.bone_faces.length) throw new Error('Finite hand evidence omits original triangles.');
  const poses = evidence.qualification_poses, clips = ['walk', 'idle', 'run', 'punch_steps', 'kick_steps'];
  if (!Array.isArray(poses) || poses.length !== 11 || poses.some((pose) => !pose
      || typeof pose !== 'object' || Array.isArray(pose) || Object.keys(pose).length !== 2
      || !Object.hasOwn(pose, 'clip') || !Object.hasOwn(pose, 'time_s')
      || !['neutral', ...clips].includes(pose.clip) || typeof pose.time_s !== 'number'
      || !Number.isFinite(pose.time_s) || pose.time_s < 0 || pose.time_s > Number.MAX_SAFE_INTEGER
      || (pose.clip === 'neutral' ? pose.time_s !== 0 : pose.time_s <= 0))
      || new Set(poses.map(({ clip, time_s }) => JSON.stringify([clip, time_s]))).size !== 11
      || poses.filter(({ clip }) => clip === 'neutral').length !== 1
      || clips.some((name) => poses.filter(({ clip }) => clip === name).length !== 2)) throw new Error('Invalid finite hand pose coverage.');
  const guard = evidence.contact_guard;
  if (!guard || ['passes_contact_filter', 'normal_triangle_nonregression_pass', 'invariant_checks_pass',
      'all_pair_pose_coverage'].some((key) => guard[key] !== true)
      || guard.expected_intermesh_pair_pose_count !== 95106 || guard.expected_self_mesh_pose_count !== 1452
      || ['new_known_intermesh_face_pair_occurrences', 'new_known_self_face_pair_occurrences',
        'unsupported_changed_comparison_count'].some((key) => guard[key] !== 0)) throw new Error('Invalid finite hand contact qualification.');
  if (!evidence.source_array_sha256 || Object.keys(evidence.source_array_sha256).length !== sourceKeys.length
      || sourceKeys.some((key) => !hash(evidence.source_array_sha256[key]))) throw new Error('Finite hand predecessor arrays must all be bound.');
  const preceding = { ...source, bone_positions: source.bone_positions.slice() };
  for (const patch of payload.patches) {
    if (!finiteHandMeshNames.includes(patch.name)) {
      const begin = patch.vertex_start * 3, end = begin + patch.vertex_count * 3;
      preceding.bone_positions.set(candidate.bone_positions.subarray(begin, end), begin);
    }
  }
  for (const key of sourceKeys) {
    const array = preceding[key];
    await verifyHash(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), evidence.source_array_sha256[key], `Finite hand predecessor ${key}`);
  }
  await verifyHash(anatomyMetadataBytes(meshes), evidence.source_mesh_metadata_sha256, 'Finite hand predecessor ownership');
  if (evidence.source_rig_sha256 !== payload.source_rig_sha256
      || evidence.candidate_bone_positions_sha256 !== payload.output_arrays.bone_positions.sha256) throw new Error('Finite hand rig or output identity differs.');
  const regions = evidence.regions;
  if (!regions || typeof regions !== 'object' || Array.isArray(regions) || Object.keys(regions).length !== 2
      || finiteHandMeshNames.some((name) => !Object.hasOwn(regions, name))) throw new Error('Both finite hand regions are required.');
  for (const patch of hands) {
    const row = regions[patch.name], ids = row?.fixed_vertex_ids;
    const cap = Object.hasOwn(patch, 'maximum_displacement_m') ? patch.maximum_displacement_m : .008;
    if (!row || row.source_positions_sha256 !== patch.source_positions_sha256 || row.positions_sha256 !== patch.positions_sha256
        || row.geometry_quality_pass !== true || typeof row.maximum_displacement_m !== 'number'
        || !Number.isFinite(row.maximum_displacement_m) || row.maximum_displacement_m <= 0
        || typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0
        || row.maximum_displacement_m > cap || cap > .008
        || !Number.isSafeInteger(row.fixed_vertex_count) || row.fixed_vertex_count <= 0
        || !Array.isArray(ids) || ids.length !== row.fixed_vertex_count
        || ids.some((id, index) => !Number.isSafeInteger(id) || id < 0 || id >= patch.vertex_count || (index && id <= ids[index - 1]))
        || ['fixed_vertex_maximum_displacement_m', 'neutral_exterior_count', 'neutral_unknown_count',
          'new_refined_exterior_count', 'new_refined_unknown_count', 'worsened_existing_exterior_count'].some((key) => row[key] !== 0)) throw new Error('Finite hand shape, clearance or fixed-region qualification failed.');
    for (const vertex of ids) {
      const offset = (patch.vertex_start + vertex) * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        if (!Object.is(preceding.bone_positions[offset + axis], candidate.bone_positions[offset + axis])) throw new Error('A finite hand attachment vertex moved.');
      }
    }
  }
  return evidence;
}

async function applyCoupledAnatomyRefinement(model, payload, caseId) {
  const child = isChildRegionalCase(caseId);
  const regional = regionalRefinementSchema(caseId);
  const finiteHand = regional === 'atlas_finite_pose_hand_refinement_patch_v1'
    || (caseId === 'adult_female_weight050' && payload?.schema === 'atlas_coupled_refinement_patch_v2');
  const schema = regional || (finiteHand ? 'atlas_coupled_refinement_patch_v2' : 'atlas_coupled_refinement_patch_v1');
  if (!payload || payload.schema !== schema || payload.case_id !== caseId || payload.applied !== true
      || (!regional && caseId !== 'adult_female_weight050') || referenceBankDirectory !== 'reference_motions_100style'
      || model.anatomyRefinement?.applied !== !regional || model.anatomyRefinement.supplemental) throw new Error('Invalid coupled refinement identity or predecessor.');
  const report = payload.report;
  if (report?.rest_skin_unchanged !== true || ['anatomical_fit_validated', 'full_surface_containment_certified',
    'continuous_motion_containment_certified'].some((key) => report[key] !== false)) throw new Error('Unsupported coupled refinement scope.');
  if (regional && !finiteHand && (report.validation_scope !== 'neutral_only' || report.age_specific_prior_validated !== false
      || report.motion_containment_validated !== false || model.anatomyRefinement.patches?.length !== 0
      || !model.motions?.neutral || (child && Object.keys(model.motions).length !== 1)
      || !Array.isArray(payload.skin_patches) || payload.skin_patches.length
      || (Object.hasOwn(payload, 'ownership_patches') && (!Array.isArray(payload.ownership_patches) || payload.ownership_patches.length)))) throw new Error('Regional corrections require unchanged bindings and neutral-only evidence.');
  if (finiteHand && (report.validation_scope !== 'neutral_and_declared_finite_reference_poses'
      || report.age_specific_prior_validated !== false || report.motion_containment_validated !== false
      || !Array.isArray(payload.skin_patches) || payload.skin_patches.length
      || (!regional && (!report.legacy_report || typeof report.legacy_report !== 'object' || Array.isArray(report.legacy_report)))
      || (regional && (model.anatomyRefinement.patches?.length !== 0 || !model.motions?.neutral
        || (Object.hasOwn(payload, 'ownership_patches') && (!Array.isArray(payload.ownership_patches) || payload.ownership_patches.length)))))) throw new Error('Finite hand correction requires unchanged skin and finite-only qualification.');
  const playbackRestriction = regional === 'atlas_elder_regional_refinement_patch_v1' ? {
    scope: 'neutral_only', withheldClipIds: Object.keys(model.motions).filter((id) => id !== 'neutral').sort(),
    reason: 'The elder fit is qualified in the neutral pose only. Recorded poses failed deformation or contact checks.',
  } : null;
  const source = anatomyRefinementArrays(model), sourceKeys = Object.keys(source);
  const outputKeys = ['bone_positions', 'skin_indices', 'skin_weights'];
  if (!payload.source_arrays || Object.keys(payload.source_arrays).length !== sourceKeys.length
      || sourceKeys.some((key) => !Object.hasOwn(payload.source_arrays, key))
      || !payload.output_arrays || Object.keys(payload.output_arrays).length !== outputKeys.length
      || outputKeys.some((key) => !Object.hasOwn(payload.output_arrays, key))) throw new Error('Coupled refinement must bind all source and mutable output arrays.');
  for (const key of sourceKeys) await verifyRefinementArray(source[key], payload.source_arrays[key], model.sourceArrayShapes?.[key], `source ${key}`);
  const files = payload.source_file_hashes, verifiedFiles = model.coupledRefinementSourceHashes;
  const requiredFiles = coupledRefinementSourcePaths(caseId);
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length !== requiredFiles.size
      || Object.keys(files).some((path) => !requiredFiles.has(path))
      || Object.entries(files).some(([path, expected]) => typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)
        || verifiedFiles?.[path] !== expected)) throw new Error('Coupled refinement verified source files do not match.');
  await verifyHash(anatomyMetadataBytes(model.sourceRig), payload.source_rig_sha256, 'Coupled refinement rig metadata');
  await verifyHash(anatomyMetadataBytes(model.sourceBoneMeshes), payload.source_mesh_metadata_sha256, 'Coupled refinement mesh metadata');
  const activeBoneMeshes = await coupledOwnershipMetadata(model, payload);
  if (model.skin.geometry.index.array !== model.sourceTopology.skin_faces || model.skeleton.parents !== model.sourceRig.parents
      || model.bones.length !== model.sourceBoneMeshes.length
      || model.bones.some(({ spec, control, mesh }, index) => spec !== model.sourceBoneMeshes[index] || control !== spec.control_index
        || mesh.geometry.index.count !== spec.index_count || mesh.geometry.getAttribute('position').count !== spec.vertex_count
        || mesh.geometry.index.array.some((value, offset) => value + spec.vertex_start !== model.sourceTopology.bone_faces[spec.index_start + offset]))) throw new Error('Coupled refinement rendered topology or rig differs from its source.');
  await verifyHash(renderedAnatomyPositions(model).buffer, payload.source_arrays.bone_positions.sha256, 'Coupled refinement rendered source geometry');
  await verifyHash(new Uint8Array(source.bone_positions.buffer, source.bone_positions.byteOffset, source.bone_positions.byteLength),
    regional ? payload.source_arrays.bone_positions.sha256 : model.anatomyRefinement.output_bone_positions_sha256, 'Coupled refinement predecessor');
  const candidate = Object.fromEntries(outputKeys.map((key) => [key, source[key].slice()]));
  const maximumPatches = finiteHand ? (regional ? 2 : 6) : regional ? 132 : 4;
  if (!Array.isArray(payload.patches) || payload.patches.length < 1 || payload.patches.length > maximumPatches
      || !Array.isArray(payload.skin_patches) || payload.skin_patches.length > model.skinRest.length / 3) throw new Error('Invalid coupled refinement patch counts.');
  const legacyNames = ['scapula', 'scapula_mirror', 'r_foot', 'l_foot'];
  const permitted = new Set(finiteHand ? [...finiteHandMeshNames, ...(regional ? [] : legacyNames)]
    : regional ? model.sourceBoneMeshes.map(({ name }) => name) : legacyNames);
  if (finiteHand && (payload.patches.length !== permitted.size
      || new Set(payload.patches.map((patch) => patch?.name)).size !== permitted.size
      || payload.patches.some((patch) => !permitted.has(patch?.name)))) throw new Error('Finite hand corrections require the complete exact mesh set.');
  const names = new Set(), intervals = [], selected = [], previousBonePatches = [], previousSkinPatches = [];
  for (const patch of payload.patches) {
    const matches = model.bones.filter(({ spec }) => spec.name === patch?.name);
    if (!patch || !permitted.has(patch.name) || names.has(patch.name) || matches.length !== 1 || patch.dtype !== 'float32'
        || !Number.isSafeInteger(patch.vertex_start) || !Number.isSafeInteger(patch.vertex_count)
        || patch.vertex_start < 0 || patch.vertex_count < 1) throw new Error('Invalid or duplicate coupled refinement mesh.');
    const maximumDisplacement = Object.hasOwn(patch, 'maximum_displacement_m') ? patch.maximum_displacement_m : (regional ? .008 : .01);
    const displacementCap = regional || (finiteHand && finiteHandMeshNames.includes(patch.name)) ? .008
      : (patch.name === 'scapula' || patch.name === 'scapula_mirror' ? .02 : .01);
    if (typeof maximumDisplacement !== 'number' || !Number.isFinite(maximumDisplacement)
        || maximumDisplacement <= 0 || maximumDisplacement > displacementCap) throw new Error('Coupled refinement maximum displacement must be positive and within its mesh cap.');
    const { spec, mesh } = matches[0], start = patch.vertex_start * 3, end = start + patch.vertex_count * 3;
    if (patch.vertex_start !== spec.vertex_start || patch.vertex_count !== spec.vertex_count || end > source.bone_positions.length
        || intervals.some(([first, last]) => start < last && end > first)) throw new Error('Coupled refinement span does not match its mesh.');
    const positions = decodeCoupledPositions(patch, patch.vertex_count);
    const original = source.bone_positions.subarray(start, end);
    await verifyHash(new Uint8Array(original.buffer, original.byteOffset, original.byteLength), patch.source_positions_sha256, 'Coupled refinement mesh source');
    for (let vertex = 0; vertex < patch.vertex_count; vertex += 1) {
      const point = positions.subarray(vertex * 3, vertex * 3 + 3), offset = start + vertex * 3;
      if (Math.hypot(...Array.from(point, (value, axis) => value - source.bone_positions[offset + axis])) > maximumDisplacement) throw new Error('Coupled refinement exceeds the bounded displacement.');
      candidate.bone_positions.set(point, offset);
    }
    const changed = candidate.bone_positions.subarray(start, end);
    await verifyHash(new Uint8Array(changed.buffer, changed.byteOffset, changed.byteLength), patch.positions_sha256, 'Coupled refinement mesh output');
    selected.push({ mesh, start, end, name: patch.name, vertex_start: patch.vertex_start, vertex_count: patch.vertex_count });
    previousBonePatches.push({ start, positions: original.slice() });
    intervals.push([start, end]); names.add(patch.name);
  }
  const rows = new Set();
  for (const patch of payload.skin_patches) {
    const vertex = patch?.vertex_index, indices = patch?.indices, weights = patch?.weights;
    if (!Number.isSafeInteger(vertex) || vertex < 0 || vertex >= model.skinRest.length / 3 || rows.has(vertex)
        || !Array.isArray(indices) || indices.length !== 8 || indices.some((value) => !Number.isSafeInteger(value) || value < 0 || value >= model.jointCount)
        || !Array.isArray(weights) || weights.length !== 8 || weights.some((value) => !Number.isFinite(value) || value < 0 || !Object.is(Math.fround(value), value))
        || Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) > 1e-5
        || new Set(indices.filter((value, slot) => weights[slot] > 0)).size !== weights.filter((value) => value > 0).length) throw new Error('Skin attachment rows must be unique normalized exact Float32 eight-slot bindings.');
    const offset = vertex * 8;
    previousSkinPatches.push({ vertex, indices: source.skin_indices.slice(offset, offset + 8), weights: source.skin_weights.slice(offset, offset + 8) });
    candidate.skin_indices.set(indices, offset); candidate.skin_weights.set(weights, offset); rows.add(vertex);
  }
  for (const key of outputKeys) await verifyRefinementArray(candidate[key], payload.output_arrays[key], model.sourceArrayShapes[key], `output ${key}`);
  if (finiteHand) await validateFiniteHandEvidence(payload, caseId, source, candidate, activeBoneMeshes);
  let mostInfluencesVertex = 0, maxAuthoredInfluences = 0;
  for (let vertex = 0; vertex < model.skinRest.length / 3; vertex += 1) {
    let count = 0;
    for (let slot = 0; slot < 8; slot += 1) if (candidate.skin_weights[vertex * 8 + slot] > 0) count += 1;
    if (count > maxAuthoredInfluences) { maxAuthoredInfluences = count; mostInfluencesVertex = vertex; }
  }
  // Complete all fallible GPU-geometry preparation before committing the three coupled arrays.
  const staged = [];
  try {
    for (const item of selected) {
      const geometry = item.mesh.geometry.clone();
      staged.push({ ...item, geometry, previous: item.mesh.geometry });
      geometry.getAttribute('position').array.set(candidate.bone_positions.subarray(item.start, item.end));
      geometry.getAttribute('position').needsUpdate = true;
      geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    }
  } catch (error) {
    staged.forEach(({ geometry }) => geometry.dispose());
    throw error;
  }
  for (const { mesh, geometry } of staged) mesh.geometry = geometry;
  model.activeBoneMeshes = activeBoneMeshes;
  model.bones.forEach((bone, index) => { bone.spec = activeBoneMeshes[index]; bone.control = bone.spec.control_index; });
  model.boneRest = candidate.bone_positions; model.skinIndices = candidate.skin_indices; model.skinWeights = candidate.skin_weights;
  model.mostInfluencesVertex = mostInfluencesVertex; model.maxAuthoredInfluences = maxAuthoredInfluences;
  model.coupledRefinementPredecessor = { bonePatches: previousBonePatches, skinPatches: previousSkinPatches };
  if (playbackRestriction) {
    model.motions = { neutral: model.motions.neutral };
    model.playbackRestriction = playbackRestriction;
  }
  model.anatomyRefinement = { ...model.anatomyRefinement, supplemental: {
    schema: payload.schema, case_id: caseId, applied: true, source_arrays: payload.source_arrays, output_arrays: payload.output_arrays,
    source_rig_sha256: payload.source_rig_sha256, source_mesh_metadata_sha256: payload.source_mesh_metadata_sha256,
    ownership_patches: payload.ownership_patches || [],
    ...(Object.hasOwn(payload, 'output_mesh_metadata_sha256') ? { output_mesh_metadata_sha256: payload.output_mesh_metadata_sha256 } : {}),
    verified_source_file_hashes: { ...verifiedFiles }, report: payload.report,
    patches: selected.map(({ name, vertex_start, vertex_count }) => ({ name, vertex_start, vertex_count })),
    skin_patch_count: rows.size,
  } };
  staged.forEach(({ previous }) => previous.dispose());
  return true;
}

function teenRegionalCaseIds(asset) {
  if (asset === undefined || asset === null) return [];
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)
      || Object.keys(asset).sort().join(',') !== 'case_ids,data_url,sha256'
      || asset.data_url !== 'teen_regional_refinement.json' || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || !Array.isArray(asset.case_ids) || !asset.case_ids.length || asset.case_ids.length > 6
      || new Set(asset.case_ids).size !== asset.case_ids.length
      || asset.case_ids.some((id) => typeof id !== 'string' || !/^teen_(male|female)_weight(025|050|075)$/.test(id))) throw new Error('Invalid teen regional correction registry.');
  return asset.case_ids;
}

async function loadTeenRegionalRefinement(caseId, signal) {
  const asset = manifest?.teen_regional_refinement_asset, ids = teenRegionalCaseIds(asset);
  if (!ids.includes(caseId)) return null;
  const bytes = await fetchChecked(absoluteURL(asset.data_url, manifestURL), signal, false);
  await verifyHash(bytes, asset.sha256, 'Published teen regional correction');
  const payload = parseJSONBuffer(bytes, 'teen regional correction'), patches = payload?.case_patches;
  if (payload?.schema !== 'atlas_teen_regional_refinement_collection_v1'
      || Object.keys(payload).sort().join(',') !== 'case_patches,schema'
      || !patches || typeof patches !== 'object' || Array.isArray(patches)
      || Object.keys(patches).length !== ids.length || ids.some((id) => !Object.hasOwn(patches, id))
      || Object.entries(patches).some(([id, patch]) => !ids.includes(id) || patch?.case_id !== id
        || patch.schema !== 'atlas_teen_regional_patch_v1' || patch.applied !== true)) throw new Error('Teen regional collection differs from its registry.');
  return { patch: patches[caseId], publication: { case_id: caseId, data_url: asset.data_url, sha256: asset.sha256 } };
}

function verifyNativeTeenRegionalBinding(refinement, patch) {
  const native = refinement?.post_refinement;
  if (!native) return false;
  if (native.applied !== true || native.schema !== patch.schema || native.case_id !== patch.case_id
      || native.previous_layer_evidence_preserved !== true || native.qualification_algorithms_rerun_by_transport !== false
      || ['source_arrays', 'output_arrays', 'source_rig_sha256', 'source_mesh_metadata_sha256',
        'source_effective_owners_sha256', 'source_motions', 'source_motion_runtime_sha256',
        'source_motion_runtime_json', 'terminal_corrections', 'motion_adjustments', 'qualification']
        .some((key) => canonicalAnatomyPatchJSON(native[key]) !== canonicalAnatomyPatchJSON(patch[key]))) throw new Error('Native teen correction differs from the published post-prior layer.');
  return true;
}

function infantNeutralNeckCaseIds(asset) {
  if (asset === undefined || asset === null) return [];
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)
      || Object.keys(asset).sort().join(',') !== 'case_ids,data_url,sha256'
      || asset.data_url !== 'infant_neutral_neck_refinement.json'
      || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || !Array.isArray(asset.case_ids) || !asset.case_ids.length || asset.case_ids.length > 2
      || new Set(asset.case_ids).size !== asset.case_ids.length
      || asset.case_ids.some((id) => typeof id !== 'string' || !/^infant_(male|female)_weight050$/.test(id))) throw new Error('Invalid infant neutral neck registry.');
  return asset.case_ids;
}

async function loadInfantNeutralNeckRefinement(caseId, signal) {
  const asset = manifest?.infant_neutral_neck_asset, ids = infantNeutralNeckCaseIds(asset);
  if (!ids.includes(caseId)) return null;
  const bytes = await fetchChecked(absoluteURL(asset.data_url, manifestURL), signal, false);
  await verifyHash(bytes, asset.sha256, 'Published infant neutral neck correction');
  const payload = parseJSONBuffer(bytes, 'infant neutral neck correction'), patches = payload?.case_patches;
  if (payload?.schema !== 'atlas_infant_neutral_neck_collection_v1'
      || Object.keys(payload).sort().join(',') !== 'case_patches,schema'
      || !patches || typeof patches !== 'object' || Array.isArray(patches)
      || Object.keys(patches).length !== ids.length || ids.some((id) => !Object.hasOwn(patches, id))
      || Object.entries(patches).some(([id, patch]) => !ids.includes(id) || patch?.case_id !== id
        || patch.schema !== 'atlas_infant_neutral_neck_patch_v1' || patch.applied !== true)) throw new Error('Infant neutral neck collection differs from its registry.');
  return { patch: patches[caseId], publication: { case_id: caseId, data_url: asset.data_url, sha256: asset.sha256 } };
}

function verifyNativeInfantNeutralNeckBinding(refinement, patch) {
  return verifyNativeTeenRegionalBinding({ post_refinement: refinement?.infant_neutral_refinement }, patch);
}

function infantNeutralSkinCaseIds(asset) {
  if (asset === undefined || asset === null) return [];
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)
      || Object.keys(asset).sort().join(',') !== 'case_ids,data_url,sha256'
      || asset.data_url !== 'infant_neutral_skin_refinement.json'
      || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || !Array.isArray(asset.case_ids) || !asset.case_ids.length || asset.case_ids.length > 6
      || new Set(asset.case_ids).size !== asset.case_ids.length
      || asset.case_ids.some((id) => typeof id !== 'string' || !/^infant_(male|female)_weight(025|050|075)$/.test(id))) throw new Error('Invalid infant neutral skin registry.');
  return asset.case_ids;
}

async function loadInfantNeutralSkinRefinement(caseId, signal) {
  const asset = manifest?.infant_neutral_skin_asset, ids = infantNeutralSkinCaseIds(asset);
  if (!ids.includes(caseId)) return null;
  const bytes = await fetchChecked(absoluteURL(asset.data_url, manifestURL), signal, false);
  await verifyHash(bytes, asset.sha256, 'Published infant neutral skin correction');
  const payload = parseJSONBuffer(bytes, 'infant neutral skin correction'), patches = payload?.case_patches;
  if (payload?.schema !== 'atlas_infant_neutral_skin_collection_v1'
      || Object.keys(payload).sort().join(',') !== 'case_patches,schema'
      || !patches || typeof patches !== 'object' || Array.isArray(patches)
      || Object.keys(patches).length !== ids.length || ids.some((id) => !Object.hasOwn(patches, id))
      || Object.entries(patches).some(([id, patch]) => !ids.includes(id) || patch?.case_id !== id
        || patch.schema !== 'atlas_infant_neutral_skin_patch_v1' || patch.applied !== true)) throw new Error('Infant neutral skin collection differs from its registry.');
  return { patch: patches[caseId], publication: { case_id: caseId, data_url: asset.data_url, sha256: asset.sha256 } };
}

function verifyNativeInfantNeutralSkinBinding(refinement, patch) {
  try { return verifyNativeTeenRegionalBinding({ post_refinement: refinement?.infant_neutral_skin_refinement }, patch); }
  catch { return false; }
}

function teenNeutralSkinCaseIds(asset, scope = 'teen') {
  if (!['teen', 'adult'].includes(scope)) throw new Error('Unsupported neutral skin scope.');
  if (asset === undefined || asset === null) return [];
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)
      || Object.keys(asset).sort().join(',') !== 'case_ids,data_url,sha256'
      || asset.data_url !== `${scope}_neutral_skin_refinement.json`
      || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || !Array.isArray(asset.case_ids) || !asset.case_ids.length || asset.case_ids.length > 6
      || new Set(asset.case_ids).size !== asset.case_ids.length
      || asset.case_ids.some((id) => typeof id !== 'string' || !new RegExp(`^${scope}_(male|female)_weight(025|050|075)$`).test(id))) throw new Error('Invalid teen neutral skin registry.');
  return asset.case_ids;
}

async function loadTeenNeutralSkinRefinement(caseId, signal, scope = 'teen') {
  const asset = manifest?.[`${scope}_neutral_skin_asset`], ids = teenNeutralSkinCaseIds(asset, scope);
  if (!ids.includes(caseId)) return null;
  const bytes = await fetchChecked(absoluteURL(asset.data_url, manifestURL), signal, false);
  await verifyHash(bytes, asset.sha256, 'Published teen neutral skin correction');
  const payload = parseJSONBuffer(bytes, 'teen neutral skin correction'), patches = payload?.case_patches;
  if (payload?.schema !== `atlas_${scope}_neutral_skin_collection_v1`
      || Object.keys(payload).sort().join(',') !== 'case_patches,schema'
      || !patches || typeof patches !== 'object' || Array.isArray(patches)
      || Object.keys(patches).length !== ids.length || ids.some((id) => !Object.hasOwn(patches, id))
      || Object.entries(patches).some(([id, patch]) => !ids.includes(id) || patch?.case_id !== id
        || patch.schema !== `atlas_${scope}_neutral_skin_patch_v1` || patch.applied !== true)) throw new Error('Teen neutral skin collection differs from its registry.');
  return { patch: patches[caseId], publication: { case_id: caseId, data_url: asset.data_url, sha256: asset.sha256 } };
}

function verifyNativeTeenNeutralSkinBinding(refinement, patch, scope = 'teen') {
  if (!['teen', 'adult'].includes(scope)) throw new Error('Unsupported neutral skin scope.');
  const native = refinement?.[`${scope}_neutral_skin_refinement`];
  if (native === undefined || native === null) return false;
  verifyNativeTeenRegionalBinding({ post_refinement: native }, patch);
  for (const key of ['activation', 'moving_skin_semantics', 'source_derived_motion_assets']) {
    if (canonicalAnatomyPatchJSON(native[key]) !== canonicalAnatomyPatchJSON(patch[key])) throw new Error('Native teen neutral skin activation or predecessor motion differs.');
  }
  return true;
}

async function applyPatellaMotionPublication(model, caseId, signal) {
  const asset = manifest.patella_motion_asset;
  if (asset === undefined) return null;
  const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!asset || Object.keys(asset).sort().join(',') !== 'case_ids,data_url,sha256'
      || asset.data_url !== 'patella_motion_tracks.json' || !hash(asset.sha256)
      || !Array.isArray(asset.case_ids) || !asset.case_ids.length || new Set(asset.case_ids).size !== asset.case_ids.length
      || asset.case_ids.some((id) => typeof id !== 'string' || !/^(teen|adult)_(male|female)_weight(025|050|075)$/.test(id))) throw new Error('Invalid patella motion publication.');
  if (!asset.case_ids.includes(caseId)) return null;
  const response = await fetch(new URL(asset.data_url, manifestURL), { signal });
  if (!response.ok) throw new Error('Published knee motion could not be loaded.');
  const bytes = await response.arrayBuffer();
  await verifyHash(bytes, asset.sha256, 'Patella motion publication');
  const collection = parseJSONBuffer(bytes, 'patella motion publication');
  if (collection?.schema !== 'atlas_patella_motion_collection_v1'
      || Object.keys(collection).sort().join(',') !== 'case_tracks,schema'
      || !collection.case_tracks || Array.isArray(collection.case_tracks)
      || Object.keys(collection.case_tracks).sort().join(',') !== [...asset.case_ids].sort().join(',')
      || Object.entries(collection.case_tracks).some(([id, entry]) => entry?.case_id !== id)) throw new Error('Patella publication registry differs.');
  const payload = collection.case_tracks[caseId];
  const keys = ['schema', 'case_id', 'mesh_names', 'source_arrays', 'source_rig_sha256', 'source_mesh_metadata_sha256',
    'source_motions', 'source_motion_runtime_json', 'source_motion_runtime_sha256', 'clips', 'qualification', 'frame_semantics'];
  if (!payload || Object.keys(payload).sort().join(',') !== keys.sort().join(',')
      || payload.schema !== 'atlas_patella_motion_publication_v1' || payload.case_id !== caseId
      || JSON.stringify(payload.mesh_names) !== '["r_patella","l_patella"]'
      || payload.frame_semantics !== 'world_rest_to_posed_rigid_delta_floor_already_applied') throw new Error('Invalid patella frame convention.');
  const arrays = anatomyRefinementArrays(model), meshes = model.activeBoneMeshes || model.sourceBoneMeshes;
  if (!payload.source_arrays || Object.keys(payload.source_arrays).sort().join(',') !== Object.keys(arrays).sort().join(',')) throw new Error('Patella source arrays are incomplete.');
  for (const key of Object.keys(arrays)) await verifyRefinementArray(arrays[key], payload.source_arrays[key], model.sourceArrayShapes[key], `patella source ${key}`);
  await verifyHash(anatomyMetadataBytes(model.sourceRig), payload.source_rig_sha256, 'Patella source rig');
  await verifyHash(anatomyMetadataBytes(meshes), payload.source_mesh_metadata_sha256, 'Patella source ownership');
  const clipIds = Object.keys(model.motions).sort().join(',');
  if (!payload.source_motions || !payload.clips || Object.keys(payload.source_motions).sort().join(',') !== clipIds
      || Object.keys(payload.clips).sort().join(',') !== clipIds) throw new Error('Patella motion inventory differs.');
  if (typeof payload.source_motion_runtime_json !== 'string') throw new Error('Patella source runtime is missing.');
  await verifyHash(new TextEncoder().encode(payload.source_motion_runtime_json), payload.source_motion_runtime_sha256, 'Patella source runtime');
  const runtime = JSON.parse(payload.source_motion_runtime_json);
  if (!runtime || Object.keys(runtime).sort().join(',') !== 'motion_adjustments,terminal_corrections') throw new Error('Invalid patella source runtime.');
  for (const [key, field] of [['terminal_corrections', 'terminalCorrectionsPayload'], ['motion_adjustments', 'motionAdjustmentsPayload']]) {
    if (Object.hasOwn(model, field) && canonicalAnatomyPatchJSON(model[field]) !== canonicalAnatomyPatchJSON(runtime[key])) throw new Error('Patella runtime differs from active playback.');
  }
  const terminal = runtime.terminal_corrections === null ? null : await validateTerminalCorrections(runtime.terminal_corrections, model);
  const floor = runtime.motion_adjustments === null ? null : await validateMotionAdjustments(runtime.motion_adjustments, model.motions);
  const evidence = payload.qualification;
  if (!evidence || Object.keys(evidence).sort().join(',') !== ['report_sha256', 'sampled_pose_count', 'sampled_gate_passed',
      'whole_body_containment_certified', 'continuous_containment_certified', 'physics_validated', 'anatomical_fit_validated'].sort().join(',')
      || !hash(evidence.report_sha256) || !Number.isSafeInteger(evidence.sampled_pose_count) || evidence.sampled_pose_count < 31
      || evidence.sampled_gate_passed !== true || ['whole_body_containment_certified', 'continuous_containment_certified',
        'physics_validated', 'anatomical_fit_validated'].some((key) => evidence[key] !== false)) throw new Error('Patella evidence has unsupported scope.');
  const clips = {};
  for (const [id, entries] of Object.entries(payload.clips)) {
    const source = model.motions[id], identity = payload.source_motions[id], count = source.times.length;
    if (!identity || Object.keys(identity).sort().join(',') !== 'times,transforms'
        || !entries || Object.keys(entries).sort().join(',') !== 'rotations_xyzw,times,translations_m') throw new Error('Incomplete patella clip.');
    await verifyMotionSourceArray(source.times, identity.times, [count], 'Patella source times');
    await verifyMotionSourceArray(source.sourceTransforms, identity.transforms, [count, model.jointCount, 4, 4], 'Patella source recording');
    const result = {};
    for (const [key, shape] of Object.entries({ times: [count], rotations_xyzw: [count, 2, 4], translations_m: [count, 2, 3] })) {
      const entry = entries[key];
      if (!entry || Object.keys(entry).sort().join(',') !== 'dtype,sha256,shape,values' || entry.dtype !== 'float64'
          || JSON.stringify(entry.shape) !== JSON.stringify(shape) || !Array.isArray(entry.values)
          || entry.values.length !== shape.reduce((a, b) => a * b, 1) || !entry.values.every(Number.isFinite)) throw new Error('Invalid patella track array.');
      result[key] = Float64Array.from(entry.values);
      await verifyMotionSourceArray(result[key], entry, shape, `Patella ${key}`);
    }
    if (result.times.some((time, index) => time !== source.times[index])
        || (id === 'neutral' && (count !== 1 || result.times[0] !== 0))) throw new Error('Patella cadence differs from its source.');
    const q = result.rotations_xyzw;
    for (let row = 0; row < count * 2; row += 1) {
      const i = row * 4;
      if (Math.abs(Math.hypot(...q.subarray(i, i + 4)) - 1) > 1e-10
          || (row >= 2 && Math.abs(q[i] * q[i - 8] + q[i + 1] * q[i - 7] + q[i + 2] * q[i - 6] + q[i + 3] * q[i - 5]) <= 1e-10)) throw new Error('Patella rotations are invalid or ambiguous.');
    }
    clips[id] = result;
  }
  if (payload.mesh_names.some((name) => model.bones.filter(({ spec }) => spec.name === name).length !== 1)) throw new Error('Patella meshes are missing.');
  model.terminalCorrectionsPayload = runtime.terminal_corrections; model.terminalCorrections = terminal;
  model.motionAdjustmentsPayload = runtime.motion_adjustments; model.motionAdjustments = floor;
  model.patellaMotion = { clips, names: payload.mesh_names, qualification: evidence, asset_sha256: asset.sha256 };
  return model.patellaMotion;
}

async function patellaNativeAvailable(publication, caseId, signal) {
  try {
    const response = await fetch(new URL(`./api/native/patella-motion?case_id=${encodeURIComponent(caseId)}`, manifestURL), { signal });
    const binding = response.ok ? await response.json() : null;
    return binding?.schema === 'atlas_patella_motion_binding_v1' && binding.case_id === caseId
      && binding.active === true && binding.asset_sha256 === publication.asset_sha256;
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    return false;
  }
}

function lumbarPublicationKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function lumbarRigidFrame(matrix) {
  const e = matrix.elements;
  if (!e.every(Number.isFinite) || e[3] !== 0 || e[7] !== 0 || e[11] !== 0 || e[15] !== 1) return false;
  for (let a = 0; a < 3; a += 1) for (let b = 0; b < 3; b += 1) {
    const dot = e[a * 4] * e[b * 4] + e[a * 4 + 1] * e[b * 4 + 1] + e[a * 4 + 2] * e[b * 4 + 2];
    if (Math.abs(dot - Number(a === b)) > 1e-12) return false;
  }
  return Math.abs(matrix.determinant() - 1) <= 1e-12;
}

function lumbarSourceQuaternion(matrix) {
  // Match SciPy 1.15's conditional polar projection, then largest-diagonal/trace quaternion.
  let e = matrix.elements, orthogonal = true;
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
    const dot = e[row] * e[column] + e[4 + row] * e[4 + column] + e[8 + row] * e[8 + column];
    if (Math.abs(dot - Number(row === column)) > 1e-12 + (row === column ? 1e-5 : 0)) orthogonal = false;
  }
  if (!orthogonal) {
    const polar = new THREE.Matrix3().setFromMatrix4(matrix);
    if (!(polar.determinant() > 0)) throw new Error('Lumbar source rotation must be right handed.');
    let converged = false;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const inverseTranspose = polar.clone().invert().transpose().elements;
      let maximumChange = 0;
      for (let index = 0; index < 9; index += 1) {
        const next = .5 * (polar.elements[index] + inverseTranspose[index]);
        maximumChange = Math.max(maximumChange, Math.abs(next - polar.elements[index]));
        polar.elements[index] = next;
      }
      if (maximumChange <= 1e-14) { converged = true; break; }
    }
    if (!converged) throw new Error('Lumbar source rotation projection did not converge.');
    e = [...e];
    for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) e[column * 4 + row] = polar.elements[column * 3 + row];
  }
  const diagonal = [e[0], e[5], e[10], e[0] + e[5] + e[10]];
  let choice = 0;
  for (let index = 1; index < 4; index += 1) if (diagonal[index] > diagonal[choice]) choice = index;
  const q = [0, 0, 0, 0];
  if (choice === 3) {
    q[0] = e[6] - e[9]; q[1] = e[8] - e[2]; q[2] = e[1] - e[4]; q[3] = 1 + diagonal[3];
  } else {
    const i = choice, j = (i + 1) % 3, k = (j + 1) % 3;
    q[i] = 1 - diagonal[3] + 2 * diagonal[i];
    q[j] = e[i * 4 + j] + e[j * 4 + i]; q[k] = e[i * 4 + k] + e[k * 4 + i];
    q[3] = e[j * 4 + k] - e[k * 4 + j];
  }
  return new THREE.Quaternion(...q).normalize();
}

async function applyLumbarMotionPublication(model, caseId, signal) {
  const asset = manifest.lumbar_motion_asset;
  if (asset === undefined) return null;
  const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!lumbarPublicationKeys(asset, ['data_url', 'sha256', 'case_ids'])
      || asset.data_url !== 'lumbar_motion.json' || !hash(asset.sha256)
      || JSON.stringify(asset.case_ids) !== '["adult_male_weight050"]') throw new Error('Invalid lumbar motion publication.');
  if (!asset.case_ids.includes(caseId)) return null;
  const response = await fetch(new URL(asset.data_url, manifestURL), { signal });
  if (!response.ok) throw new Error('Published lumbar motion could not be loaded.');
  const bytes = await response.arrayBuffer();
  await verifyHash(bytes, asset.sha256, 'Lumbar motion publication');
  const collection = parseJSONBuffer(bytes, 'lumbar motion publication');
  if (!lumbarPublicationKeys(collection, ['schema', 'case_configs']) || collection.schema !== 'atlas_lumbar_motion_collection_v1'
      || !lumbarPublicationKeys(collection.case_configs, ['adult_male_weight050'])) throw new Error('Lumbar publication registry differs.');
  const payload = collection.case_configs[caseId];
  if (!lumbarPublicationKeys(payload, ['schema', 'case_id', 'model_config', 'native_frames'])
      || payload.schema !== 'atlas_lumbar_motion_publication_v1' || payload.case_id !== caseId) throw new Error('Invalid lumbar publication wrapper.');
  const config = payload.model_config, names = ['lumbar1', 'lumbar2', 'lumbar3', 'lumbar4'];
  const trueClaims = ['identity_fraction_bypasses_native_geometry_exactly', 'source_surfaces_weights_rig_and_recorded_controls_unchanged',
    'source_sites_are_model_priors_not_clinical_landmarks', 'bound_is_engineering_trial_not_anatomical_measurement'];
  const falseClaims = ['whole_body_containment_certified', 'continuous_motion_certified', 'physics_validated', 'anatomical_validity_certified'];
  if (!lumbarPublicationKeys(config, ['schema', 'case_id', 'source_arrays', 'source_rig_sha256', 'source_mesh_metadata_sha256',
    'source_effective_owners_sha256', 'source_motions', 'source_motion_runtime_json', 'source_motion_runtime_sha256', 'motion_adjustments',
    'terminal_corrections', 'lower_control_index', 'upper_control_index', 'lower_source_model_site_m', 'upper_source_model_site_m',
    'weights', 'maximum_displacement_m', 'law_id', 'law_module_sha256', 'qualification', ...trueClaims, ...falseClaims])
      || config.schema !== 'atlas_lumbar_source_site_model_v1' || config.case_id !== caseId
      || config.law_id !== 'source_site_smoothstep_fraction_v1' || config.maximum_displacement_m !== .025
      || config.law_module_sha256 !== 'eeacf2e87a3ea5725433f73c6dfa4e079483990e7600cd564598d8cd7be6b6c6'
      || trueClaims.some((key) => config[key] !== true) || falseClaims.some((key) => config[key] !== false)) throw new Error('Lumbar publication has unsupported law or claims.');
  const evidence = config.qualification;
  const trueGates = ['finite_strict_zero_original_triangle_pass', 'finite_half_mm_original_triangle_pass', 'actual_runtime_hook_qualified',
    'current_finite_overlap_nonincrease', 'current_rigid_shape_pass', 'current_model_site_nonincrease',
    'current_contact_outside_adjacent_lumbar_nonregression', 'separate_finite_scalar_overlap_nonincrease'];
  const falseGates = ['old_face_pair_contact_guard_pass', 'current_face_pair_contact_guard_pass', 'automatic_acceptance', 'published'];
  const reports = ['native_finite_report', 'scalar_original_solid_report', 'original_skin_triangle_report'];
  if (!lumbarPublicationKeys(evidence, [...trueGates, ...falseGates, ...reports, 'pose_count', 'scalar_fraction_count', 'full_triangle_bone_pose_count'])
      || trueGates.some((key) => evidence[key] !== true) || falseGates.some((key) => evidence[key] !== false)
      || evidence.pose_count !== 41 || evidence.scalar_fraction_count !== 51 || evidence.full_triangle_bone_pose_count !== 164
      || reports.some((key) => !lumbarPublicationKeys(evidence[key], ['path', 'sha256'])
        || typeof evidence[key].path !== 'string' || !evidence[key].path || !hash(evidence[key].sha256))) throw new Error('Lumbar finite qualification is incomplete.');
  const arrays = anatomyRefinementArrays(model), meshes = model.activeBoneMeshes || model.sourceBoneMeshes;
  if (!lumbarPublicationKeys(config.source_arrays, Object.keys(arrays))) throw new Error('Lumbar source arrays are incomplete.');
  for (const key of Object.keys(arrays)) await verifyRefinementArray(arrays[key], config.source_arrays[key], model.sourceArrayShapes[key], `lumbar source ${key}`);
  await verifyHash(anatomyMetadataBytes(model.sourceRig), config.source_rig_sha256, 'Lumbar source rig');
  await verifyHash(anatomyMetadataBytes(meshes), config.source_mesh_metadata_sha256, 'Lumbar source meshes');
  const owners = [...meshes].sort((a, b) => a.vertex_start - b.vertex_start).map(({ name, vertex_start, vertex_count, control_index }) => ({ name, vertex_start, vertex_count, control_index }));
  await verifyHash(anatomyMetadataBytes(owners), config.source_effective_owners_sha256, 'Lumbar effective owners');
  if (!lumbarPublicationKeys(config.source_motions, Object.keys(model.motions))) throw new Error('Lumbar source motion inventory differs.');
  for (const [id, source] of Object.entries(model.motions)) {
    const identity = config.source_motions[id];
    if (!lumbarPublicationKeys(identity, ['times', 'transforms'])) throw new Error('Invalid lumbar recording identity.');
    await verifyMotionSourceArray(source.times, identity.times, [source.times.length], 'Lumbar source times');
    await verifyMotionSourceArray(source.sourceTransforms, identity.transforms, [source.times.length, model.jointCount, 4, 4], 'Lumbar source recording');
  }
  if (typeof config.source_motion_runtime_json !== 'string') throw new Error('Lumbar runtime is missing.');
  await verifyHash(new TextEncoder().encode(config.source_motion_runtime_json), config.source_motion_runtime_sha256, 'Lumbar source runtime');
  const runtime = JSON.parse(config.source_motion_runtime_json);
  if (!lumbarPublicationKeys(runtime, ['motion_adjustments', 'terminal_corrections'])) throw new Error('Invalid lumbar runtime.');
  for (const [key, field] of [['terminal_corrections', 'terminalCorrectionsPayload'], ['motion_adjustments', 'motionAdjustmentsPayload']]) {
    if (canonicalAnatomyPatchJSON(config[key]) !== canonicalAnatomyPatchJSON(runtime[key])
        || (Object.hasOwn(model, field) && canonicalAnatomyPatchJSON(model[field]) !== canonicalAnatomyPatchJSON(runtime[key]))) throw new Error('Lumbar runtime differs from active playback.');
  }
  const terminal = runtime.terminal_corrections === null ? null : await validateTerminalCorrections(runtime.terminal_corrections, model);
  const floor = runtime.motion_adjustments === null ? null : await validateMotionAdjustments(runtime.motion_adjustments, model.motions);
  const lower = config.lower_control_index, upper = config.upper_control_index;
  if (![lower, upper].every((index) => Number.isSafeInteger(index) && index >= 0 && index < model.jointCount) || lower === upper
      || [...names, 'lumbar5', 'thoracic12'].some((name) => meshes.filter((mesh) => mesh.name === name).length !== 1
        || meshes.find((mesh) => mesh.name === name).control_index !== (name === 'thoracic12' ? upper : lower))
      || names.some((name) => model.bones.filter(({ spec }) => spec.name === name).length !== 1)) throw new Error('Lumbar source owner mapping differs.');
  if (!lumbarPublicationKeys(config.weights, names) || !Object.values(config.weights).every(Number.isFinite)
      || !(0 < config.weights.lumbar4 && config.weights.lumbar4 < config.weights.lumbar3
        && config.weights.lumbar3 < config.weights.lumbar2 && config.weights.lumbar2 < config.weights.lumbar1 && config.weights.lumbar1 === 1)) throw new Error('Invalid lumbar source-path weights.');
  const sites = [config.lower_source_model_site_m, config.upper_source_model_site_m];
  if (sites.some((site) => !Array.isArray(site) || site.length !== 3 || !site.every(Number.isFinite))) throw new Error('Invalid lumbar model sites.');
  const lowerSite = new THREE.Vector3().fromArray(sites[0]), upperSite = new THREE.Vector3().fromArray(sites[1]);
  const closure = upperSite.clone().sub(lowerSite);
  if (!(closure.length() > 0 && closure.length() <= .025)) throw new Error('Lumbar source closure exceeds its engineering bound.');
  const exported = payload.native_frames;
  if (!lumbarPublicationKeys(exported, ['control_indices', 'bind_frames', 'neutral_world_frames'])
      || JSON.stringify(exported.control_indices) !== JSON.stringify([lower, upper])) throw new Error('Lumbar native frame owners differ.');
  const frames = {};
  for (const key of ['bind_frames', 'neutral_world_frames']) {
    const entry = exported[key];
    if (!lumbarPublicationKeys(entry, ['dtype', 'shape', 'sha256', 'values']) || entry.dtype !== 'float64'
        || JSON.stringify(entry.shape) !== '[2,4,4]' || !Array.isArray(entry.values)
        || entry.values.length !== 32 || !entry.values.every(Number.isFinite)) throw new Error('Invalid lumbar native frame array.');
    const values = Float64Array.from(entry.values);
    await verifyMotionSourceArray(values, entry, [2, 4, 4], 'Lumbar native frame');
    frames[key] = [0, 16].map((offset) => new THREE.Matrix4().fromArray(values, offset).transpose());
    if (!frames[key].every(lumbarRigidFrame)) throw new Error('Lumbar native frame is not proper rigid.');
  }
  const neutral = model.motions.neutral;
  if (!neutral || neutral.times.length !== 1 || neutral.times[0] !== 0
      || neutral.sourceTransforms.some((value, index) => value !== Number(index % 16 % 5 === 0))) throw new Error('Lumbar neutral must retain the original identity recording.');
  for (const [slot, control] of [lower, upper].entries()) {
    const authored = new THREE.Matrix4().fromArray(model.sourceBindFrames, control * 16).transpose();
    const rotation = lumbarSourceQuaternion(authored);
    const expectedNeutral = new THREE.Matrix4().makeRotationFromQuaternion(rotation).setPosition(new THREE.Vector3().setFromMatrixPosition(authored));
    expectedNeutral.elements[14] += motionFloorOffset(floor?.neutral, 0);
    const serialized = new THREE.Quaternion(...[rotation.x, rotation.y, rotation.z, rotation.w].map(Math.fround)).normalize();
    const expectedBind = new THREE.Matrix4().makeRotationFromQuaternion(serialized).setPosition(new THREE.Vector3().setFromMatrixPosition(authored));
    for (const [key, expected] of [['bind_frames', expectedBind], ['neutral_world_frames', expectedNeutral]]) {
      if (frames[key][slot].elements.some((value, index) => Math.abs(value - expected.elements[index]) > 1e-12)) throw new Error('Lumbar native frame differs from the authored source.');
    }
  }
  model.terminalCorrectionsPayload = runtime.terminal_corrections; model.terminalCorrections = terminal;
  model.motionAdjustmentsPayload = runtime.motion_adjustments; model.motionAdjustments = floor;
  model.lumbarMotion = { names, lower, upper, lowerSite, upperSite, closure, weights: { ...config.weights },
    inverseBind: frames.bind_frames.map((frame) => frame.clone().invert()), neutralWorld: frames.neutral_world_frames,
    qualification: evidence, asset_sha256: asset.sha256, source_motion_runtime_sha256: config.source_motion_runtime_sha256 };
  return model.lumbarMotion;
}

function lumbarPoseDelta(model, name, neutral) {
  const law = model.lumbarMotion;
  if (!law || !law.names.includes(name)) return null;
  const deltas = [law.lower, law.upper].map((control, slot) => {
    const authored = model.posedFrames[control];
    const world = neutral ? law.neutralWorld[slot].clone() : new THREE.Matrix4()
      .makeRotationFromQuaternion(lumbarSourceQuaternion(authored)).setPosition(new THREE.Vector3().setFromMatrixPosition(authored));
    return world.multiply(law.inverseBind[slot]);
  });
  const before = law.upperSite.clone().applyMatrix4(deltas[1]).sub(law.lowerSite.clone().applyMatrix4(deltas[0]));
  const lower = deltas[0], e = lower.elements, v = law.closure;
  const transformed = new THREE.Vector3(e[0] * v.x + e[4] * v.y + e[8] * v.z,
    e[1] * v.x + e[5] * v.y + e[9] * v.z, e[2] * v.x + e[6] * v.y + e[10] * v.z);
  const x = Math.min(1, Math.max(0, before.dot(transformed) / transformed.lengthSq()));
  const fraction = x * x * (3 - 2 * x);
  if (fraction === 0) return null;
  transformed.multiplyScalar(fraction * law.weights[name]);
  lower.elements[12] += transformed.x; lower.elements[13] += transformed.y; lower.elements[14] += transformed.z;
  return lower;
}

async function lumbarNativeAvailable(publication, caseId, signal) {
  try {
    const response = await fetch(new URL(`./api/native/lumbar-motion?case_id=${encodeURIComponent(caseId)}`, manifestURL), { signal });
    const binding = response.ok ? await response.json() : null;
    return binding?.schema === 'atlas_lumbar_motion_binding_v1' && binding.case_id === caseId
      && binding.active === true && binding.asset_sha256 === publication.asset_sha256;
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    return false;
  }
}

async function loadNativePlaybackRuntime(model, caseId, signal) {
  const payloads = [];
  for (const path of ['terminal-corrections', 'motion-adjustment']) {
    try {
      const response = await fetch(new URL(`./api/native/${path}?case_id=${encodeURIComponent(caseId)}`, manifestURL), { signal });
      if (!response.ok) return false;
      payloads.push(await response.json());
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      return false;
    }
  }
  const terminal = await validateTerminalCorrections(payloads[0], model);
  const floor = await validateMotionAdjustments(payloads[1], model.motions);
  model.terminalCorrectionsPayload = payloads[0]; model.terminalCorrections = terminal;
  model.motionAdjustmentsPayload = payloads[1]; model.motionAdjustments = floor;
  return true;
}

function teenRegionalMeshKind(name) {
  if (['cerv3', 'cerv4', 'cerv5', 'cerv6', 'rotatedcerv7', 'thoracic1', 'scapula', 'scapula_mirror'].includes(name)) return 'posterior';
  if (['r_foot', 'l_foot'].includes(name)) return 'connected_component';
  if (['radius', 'ulna', 'radius_mirror', 'ulna_mirror'].includes(name)
      || /^hand_[rl]__(lunate|scaphoid|pisiform|triquetral|capitate|trapezium|trapezoid|hamate|1mc|2mc|3mc|4mc_new|5mc_new)$/.test(name)) return 'wrist';
  return null;
}

function teenRegionalIds(ids, count, nonempty = true) {
  return Array.isArray(ids) && (!nonempty || ids.length > 0)
    && ids.every((id, index) => Number.isSafeInteger(id) && id >= 0 && id < count && (!index || id > ids[index - 1]));
}

function teenRegionalTopology(model) {
  const meshes = model.activeBoneMeshes || model.sourceBoneMeshes, faces = model.sourceTopology.bone_faces;
  if (!Array.isArray(meshes) || meshes.length !== 132 || new Set(meshes.map((mesh) => mesh?.name)).size !== 132
      || meshes.some((mesh) => typeof mesh?.name !== 'string') || model.bones.length !== 132
      || model.skin.geometry.index.array !== model.sourceTopology.skin_faces || model.skeleton.parents !== model.sourceRig.parents
      || model.bones.some(({ spec, control, mesh }, index) => spec !== meshes[index] || control !== spec.control_index
        || mesh.geometry.index.count !== spec.index_count || mesh.geometry.getAttribute('position').count !== spec.vertex_count
        || mesh.geometry.index.array.some((value, offset) => value + spec.vertex_start !== faces[spec.index_start + offset]))) throw new Error('Teen regional rendered topology or ownership differs.');
  let end = 0;
  for (const mesh of [...meshes].sort((a, b) => a.vertex_start - b.vertex_start)) {
    if (mesh.vertex_start !== end || !Number.isSafeInteger(mesh.vertex_count) || mesh.vertex_count < 1
        || !Number.isSafeInteger(mesh.control_index) || mesh.control_index < 0 || mesh.control_index >= model.jointCount) throw new Error('Incomplete teen anatomy vertex spans.');
    end += mesh.vertex_count;
  }
  if (end * 3 !== model.boneRest.length) throw new Error('Teen anatomy vertex coverage differs.');
  end = 0;
  for (const mesh of [...meshes].sort((a, b) => a.index_start - b.index_start)) {
    if (mesh.index_start !== end || !Number.isSafeInteger(mesh.index_count) || mesh.index_count < 3 || mesh.index_count % 3
        || faces.subarray(end, end + mesh.index_count).some((id) => id < mesh.vertex_start || id >= mesh.vertex_start + mesh.vertex_count)) throw new Error('Incomplete teen anatomy triangle spans.');
    end += mesh.index_count;
  }
  if (end !== faces.length) throw new Error('Teen anatomy triangle coverage differs.');
  return meshes;
}

async function stressMotionIdentity(motion) {
  const hashes = {};
  for (const key of ['times', 'sourceTransforms', 'positions', 'quaternions']) {
    if (!ArrayBuffer.isView(motion[key]) || motion[key] instanceof DataView) throw new Error('Stress motion array is missing.');
    hashes[key] = [motion[key].constructor.name, motion[key].length, await neutralSkinArrayHash(motion[key])];
  }
  return canonicalAnatomyPatchJSON({ hashes, sourceMetadata: motion.sourceMetadata,
    source: motion.source, motionKind: motion.motionKind, stressTest: motion.stressTest,
    duration: motion.duration, restIdentity: motion.restIdentity, scenery: motion.scenery, label: motion.label });
}

async function retainStressMotionVerification(model) {
  const original = Object.fromEntries(model.stressMotions.existing_motion_ids_preserved.map((id) => [id, model.motions[id]]));
  const appended = {};
  for (const id of model.stressMotions.added_motion_ids) appended[id] = Object.freeze({
    motion: model.motions[id], identity: await stressMotionIdentity(model.motions[id]) });
  Object.defineProperty(model, 'stressMotionVerification', { enumerable: true, value: Object.freeze({
    provenance: canonicalAnatomyPatchJSON(model.stressMotions),
    original: Object.freeze(original), appended: Object.freeze(appended),
  }) });
}

async function checkedOriginalMotionView(model) {
  const evidence = model.stressMotions, ids = model.stressMotionIds, retained = model.stressMotionVerification;
  if (evidence === undefined && ids === undefined && retained === undefined) {
    if (Object.values(model.motions).some((motion) => motion.stressTest === true)) throw new Error('Unbound stress motion.');
    return model;
  }
  const falseClaims = ['containment_validated', 'anatomical_fit_validated', 'physics_validated',
    'age_specific_motion_validated', 'prior_motion_qualification_inherited', 'fitted_clip_layers_applied_to_new_motions'];
  if (!evidence || !(ids instanceof Set) || !retained || !Object.isFrozen(retained)
      || evidence.schema !== 'atlas_linkage_stress_motion_bank_v1' || evidence.test_only !== true
      || falseClaims.some((key) => evidence[key] !== false)
      || evidence.new_motion_bones_follow_current_original_owners !== true || evidence.neutral_qualification_scope_unchanged !== true
      || ['asset_sha256', 'data_sha256', 'buffer_sha256'].some((key) => !regionalSkinHash(evidence[key]))
      || canonicalAnatomyPatchJSON(evidence) !== retained.provenance) throw new Error('Stress motion verification binding differs.');
  const originals = Object.keys(retained.original), additions = Object.keys(retained.appended);
  const same = (a, b) => Array.isArray(a) && a.length === new Set(a).size
    && regionalSkinEqual([...a].sort(), [...b].sort());
  if (!originals.includes('neutral') || !same(evidence.existing_motion_ids_preserved, originals)
      || !same(evidence.added_motion_ids, additions) || !same([...ids], additions)
      || additions.some((id) => originals.includes(id) || !/^[A-Za-z0-9][A-Za-z0-9_]{0,63}$/.test(id)
        || ['neutral', 'constructor', 'prototype', '__proto__'].includes(id))
      || !same(Object.keys(model.motions), [...originals, ...additions])) throw new Error('Stress motion inventory differs.');
  for (const id of originals) if (model.motions[id] !== retained.original[id] || model.motions[id].stressTest === true) throw new Error('Original motion was replaced.');
  for (const id of additions) {
    const motion = model.motions[id], saved = retained.appended[id];
    if (motion !== saved.motion || motion.stressTest !== true || await stressMotionIdentity(motion) !== saved.identity) throw new Error('Appended stress motion differs.');
  }
  return { ...model, motions: retained.original };
}

async function validateTeenRegionalSource(model, patch, sourceBoneRest = model.boneRest) {
  model = await checkedOriginalMotionView(model);
  const arrays = { ...anatomyRefinementArrays(model), bone_positions: sourceBoneRest }, keys = Object.keys(arrays);
  for (const field of ['source_arrays', 'output_arrays']) {
    if (!patch[field] || typeof patch[field] !== 'object' || Array.isArray(patch[field])
        || Object.keys(patch[field]).length !== keys.length || keys.some((key) => !Object.hasOwn(patch[field], key))) throw new Error('Teen correction must bind all seven arrays.');
  }
  for (const key of keys) await verifyRefinementArray(arrays[key], patch.source_arrays[key], model.sourceArrayShapes[key], `teen source ${key}`);
  const meshes = teenRegionalTopology(model);
  await verifyHash(anatomyMetadataBytes(model.sourceRig), patch.source_rig_sha256, 'Teen regional rig');
  await verifyHash(anatomyMetadataBytes(meshes), patch.source_mesh_metadata_sha256, 'Teen regional mesh metadata');
  const owners = [...meshes].sort((a, b) => a.vertex_start - b.vertex_start).map(({ name, vertex_start, vertex_count, control_index }) => ({ name, vertex_start, vertex_count, control_index }));
  await verifyHash(anatomyMetadataBytes(owners), patch.source_effective_owners_sha256, 'Teen regional effective owners');
  const clips = Object.keys(model.motions);
  if (!patch.source_motions || typeof patch.source_motions !== 'object' || Array.isArray(patch.source_motions)
      || Object.keys(patch.source_motions).length !== clips.length || clips.some((id) => !Object.hasOwn(patch.source_motions, id))) throw new Error('Teen correction motion inventory differs.');
  for (const id of clips) {
    const motion = model.motions[id], identity = patch.source_motions[id];
    if (!identity || Object.keys(identity).sort().join(',') !== 'times,transforms') throw new Error('Invalid teen correction recording identity.');
    await verifyMotionSourceArray(motion.times, identity.times, [motion.times.length], 'Teen correction source times');
    await verifyMotionSourceArray(motion.sourceTransforms, identity.transforms, [motion.times.length, model.jointCount, 4, 4], 'Teen correction source transforms');
  }
  // Preserve the publisher's canonical numeric spelling when hashing Python JSON.
  if (typeof patch.source_motion_runtime_json !== 'string') throw new Error('Teen correction canonical runtime declaration is missing.');
  const runtime = JSON.parse(patch.source_motion_runtime_json);
  const declared = { terminal_corrections: patch.terminal_corrections, motion_adjustments: patch.motion_adjustments };
  if (canonicalAnatomyPatchJSON(runtime) !== canonicalAnatomyPatchJSON(declared)) throw new Error('Teen correction runtime declaration differs.');
  await verifyHash(new TextEncoder().encode(patch.source_motion_runtime_json), patch.source_motion_runtime_sha256, 'Teen correction runtime settings');
  for (const [key, field] of [['terminal_corrections', 'terminalCorrectionsPayload'], ['motion_adjustments', 'motionAdjustmentsPayload']]) {
    if (Object.hasOwn(model, field) && canonicalAnatomyPatchJSON(model[field]) !== canonicalAnatomyPatchJSON(declared[key])) throw new Error('Native and published teen runtime settings differ.');
  }
  const terminal = patch.terminal_corrections === null ? null : await validateTerminalCorrections(patch.terminal_corrections, model);
  const floor = patch.motion_adjustments === null ? null : await validateMotionAdjustments(patch.motion_adjustments, model.motions);
  return { arrays, meshes, terminal, floor };
}

function validateTeenRegionalQualification(patch, model, schema = 'atlas_teen_regional_qualification_v1') {
  const evidence = patch.qualification, hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const zero = (row, fields) => row && fields.every((key) => Number.isSafeInteger(row[key]) && row[key] === 0);
  const counts = ['new_known_exterior_count', 'worsened_known_exterior_count', 'new_unknown_count'];
  if (evidence?.schema !== schema || evidence.case_id !== patch.case_id
      || evidence.scope !== 'declared_finite_reference_samples_only'
      || ['shape_quality_pass', 'bone_contact_nonregression_pass', 'finite_native_surface_nonregression_pass',
        'unchanged_skin_weights_faces_rig_ownership'].some((key) => evidence[key] !== true)
      || ['whole_body_containment_certified', 'continuous_motion_certified', 'anatomical_fit_validated',
        'physics_validated', 'full_surface_containment_certified'].some((key) => evidence[key] !== false)
      || !zero(evidence, counts) || !hash(evidence.report_sha256) || !hash(evidence.candidate_archive_sha256)
      || !evidence.method_source_sha256 || typeof evidence.method_source_sha256 !== 'object' || Array.isArray(evidence.method_source_sha256)
      || !Object.keys(evidence.method_source_sha256).length || Object.keys(evidence.method_source_sha256).length > 64
      || Object.entries(evidence.method_source_sha256).some(([key, value]) => !key || !hash(value))) throw new Error('Invalid finite-only teen qualification.');
  const poses = evidence.poses, poseKey = (pose) => JSON.stringify([pose.clip, pose.time_s]);
  if (!Array.isArray(poses) || !poses.length || poses.length > 10000 || !model.motions.neutral
      || poses.some((pose) => !pose || Object.keys(pose).sort().join(',') !== 'clip,time_s'
        || typeof pose.clip !== 'string' || !Object.hasOwn(model.motions, pose.clip)
        || typeof pose.time_s !== 'number' || !Number.isFinite(pose.time_s) || pose.time_s < 0 || pose.time_s > Number.MAX_SAFE_INTEGER
        || pose.time_s < model.motions[pose.clip].times[0] || pose.time_s > model.motions[pose.clip].times.at(-1))
      || new Set(poses.map(poseKey)).size !== poses.length) throw new Error('Invalid teen finite pose schedule.');
  for (const [clip, motion] of Object.entries(model.motions)) {
    const stamps = poses.filter((pose) => pose.clip === clip).map((pose) => pose.time_s);
    if (!motion.times.length || motion.times.some((value, index) => !Number.isFinite(value) || (index && value <= motion.times[index - 1]))
        || (clip === 'neutral' ? stamps.length !== 1 || stamps[0] !== 0 : stamps.length < 7)
        || !stamps.includes(motion.times[0]) || !stamps.includes(motion.times.at(-1))) throw new Error('Teen qualification omits current clip endpoints or finite coverage.');
  }
  const guard = evidence.contact_guard;
  if (['passes_contact_filter', 'all_pair_pose_coverage', 'invariant_checks_pass'].some((key) => guard?.[key] !== true)
      || guard.mesh_count !== 132 || guard.expected_intermesh_pair_pose_count !== 8646 * poses.length
      || guard.expected_self_mesh_pose_count !== 132 * poses.length
      || !zero(guard, ['new_known_intermesh_face_pair_occurrences', 'new_known_self_face_pair_occurrences', 'unsupported_changed_comparison_count'])) throw new Error('Teen full-mesh finite contact coverage differs.');
  const changes = patch.bone_patches, regions = evidence.regions;
  if (!Array.isArray(changes) || !changes.length || changes.length > 40
      || new Set(changes.map((change) => change?.name)).size !== changes.length
      || !regions || typeof regions !== 'object' || Array.isArray(regions) || Object.keys(regions).length !== changes.length
      || changes.some((change) => !teenRegionalMeshKind(change?.name) || !Object.hasOwn(regions, change.name))) throw new Error('Invalid teen regional patch inventory.');
  if (Object.hasOwn(evidence, 'regional_displacement_limits_m')) {
    const limits = evidence.regional_displacement_limits_m;
    const cervical = changes.find((change) => change.name === 'rotatedcerv7');
    if (patch.case_id !== 'teen_male_weight050' || !limits || typeof limits !== 'object' || Array.isArray(limits)
        || Object.keys(limits).length !== 1 || !Object.hasOwn(limits, 'rotatedcerv7') || limits.rotatedcerv7 !== .0082
        || cervical?.maximum_displacement_m !== .0082 || regions.rotatedcerv7?.maximum_displacement_m !== .0082) throw new Error('Invalid explicit case-specific C7 displacement qualification.');
  }
  for (const change of changes) {
    const region = regions[change.name], results = region?.pose_results;
    if (region?.shape_quality_pass !== true || region.maximum_displacement_m !== change.maximum_displacement_m
        || !Array.isArray(results) || results.length !== poses.length || new Set(results.map(poseKey)).size !== poses.length
        || results.some((row) => !poses.some((pose) => poseKey(pose) === poseKey(row))
          || !zero(row, [...counts, 'target_exterior_count', 'target_unknown_count'])
          || !Number.isSafeInteger(row.target_sample_count) || row.target_sample_count !== region.target_scope?.sample_count)) throw new Error('Teen target sample qualification differs.');
  }
  return evidence;
}

function validateTeenRegionalScope(scope, spec, faces, kind) {
  if (!scope || !(kind === 'wrist' ? ['regional', 'whole_mesh'].includes(scope.kind) : scope.kind === kind)
      || !teenRegionalIds(scope.original_vertex_ids, spec.vertex_count) || !teenRegionalIds(scope.original_face_ids, spec.index_count / 3)
      || scope.sampling !== 'original_vertices_unique_edge_midpoints_triangle_centroids'
      || !Number.isSafeInteger(scope.sample_count) || scope.sample_count < 1
      || typeof scope.sample_selection_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(scope.sample_selection_sha256)) throw new Error('Teen target scope must name original sampled vertices and faces.');
  const selected = new Set(scope.original_vertex_ids), faceIds = new Set(scope.original_face_ids), edges = new Set();
  for (let offset = 0; offset < spec.index_count; offset += 3) {
    const triangle = Array.from(faces.subarray(spec.index_start + offset, spec.index_start + offset + 3), (id) => id - spec.vertex_start);
    const selectedCount = triangle.filter((id) => selected.has(id)).length;
    if (kind === 'connected_component' && ((selectedCount !== 0 && selectedCount !== 3) || faceIds.has(offset / 3) !== (selectedCount === 3))) throw new Error('Teen component scope cuts original triangles.');
    for (let corner = 0; corner < 3; corner += 1) { const a = triangle[corner], b = triangle[(corner + 1) % 3]; edges.add(`${Math.min(a, b)},${Math.max(a, b)}`); }
  }
  if (scope.sample_count > spec.vertex_count + edges.size + spec.index_count / 3
      || (scope.kind === 'whole_mesh' && (selected.size !== spec.vertex_count || faceIds.size !== spec.index_count / 3))) throw new Error('Teen target sampling inventory differs.');
  return selected;
}

function postPriorRegionalRefinement(model) {
  return model?.teenRegionalRefinement || model?.infantNeutralNeckRefinement;
}

function validateInfantNeutralNeckScope(model, patch) {
  const names = ['cerv3', 'cerv4', 'cerv5', 'cerv6', 'rotatedcerv7'];
  const proofNames = ['cerv5', 'cerv6', 'rotatedcerv7'];
  const evidence = patch?.qualification, proofs = evidence?.original_triangle_proofs;
  if (Object.keys(model.motions).join(',') !== 'neutral' || model.motions.neutral.times.length !== 1
      || model.motions.neutral.times[0] !== 0 || !Array.isArray(patch?.bone_patches)
      || patch.bone_patches.map(({ name }) => name).sort().join(',') !== names.join(',')
      || patch.bone_patches.some((change) => !(change.maximum_displacement_m > 0 && change.maximum_displacement_m <= .008))
      || Object.hasOwn(evidence || {}, 'regional_displacement_limits_m')
      || names.some((name) => Object.hasOwn(evidence?.regions?.[name] || {}, 'regional_displacement_limits_m'))
      || !proofs || typeof proofs !== 'object' || Array.isArray(proofs)
      || Object.keys(proofs).sort().join(',') !== proofNames.join(',')) throw new Error('Infant correction requires only the qualified neutral cervical scope.');
  for (const name of proofNames) {
    const proof = proofs[name], spec = model.sourceBoneMeshes.find((mesh) => mesh.name === name);
    const identity = (value, count) => value && Object.keys(value).sort().join(',') === 'dtype,sha256,shape' && value.dtype === 'float32'
      && Array.isArray(value.shape) && value.shape.length === 2 && value.shape[0] === count && value.shape[1] === 3
      && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256);
    if (!spec || !proof || Object.keys(proof).sort().join(',') !== 'clearance_m,mathematical_surface_containment_under_original_parity_proved,native_bone_positions,native_skin_positions,report_sha256,untested_required_pair_count'
        || typeof proof.report_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(proof.report_sha256)
        || proof.report_sha256 !== evidence.report_sha256
        || proof.clearance_m !== 0 || proof.mathematical_surface_containment_under_original_parity_proved !== true
        || proof.untested_required_pair_count !== 0
        || !identity(proof.native_bone_positions, spec.vertex_count)
        || !identity(proof.native_skin_positions, model.skinRest.length / 3)
        || canonicalAnatomyPatchJSON(proof.native_skin_positions) !== canonicalAnatomyPatchJSON(proofs.cerv5.native_skin_positions)) throw new Error('Infant original-triangle qualification binding is incomplete.');
  }
}

async function applyTeenRegionalRefinement(model, patch, caseId, publication) {
  return applyPostPriorRegionalRefinement(model, patch, caseId, publication, false);
}

async function applyInfantNeutralNeckRefinement(model, patch, caseId, publication) {
  return applyPostPriorRegionalRefinement(model, patch, caseId, publication, true);
}

async function applyPostPriorRegionalRefinement(model, patch, caseId, publication, infant) {
  const validCase = infant ? /^infant_(male|female)_weight050$/.test(caseId) : /^teen_(male|female)_weight(025|050|075)$/.test(caseId);
  const schema = infant ? 'atlas_infant_neutral_neck_patch_v1' : 'atlas_teen_regional_patch_v1';
  if (!validCase || patch?.schema !== schema
      || patch.case_id !== caseId || patch.applied !== true || postPriorRegionalRefinement(model)
      || ['skin_patches', 'ownership_patches'].some((key) => Object.hasOwn(patch, key) && (!Array.isArray(patch[key]) || patch[key].length))) throw new Error('Invalid bone-only teen correction identity.');
  if (infant) validateInfantNeutralNeckScope(model, patch);
  await verifyRenderedAnatomyRefinement(model);
  const { arrays, terminal, floor } = await validateTeenRegionalSource(model, patch);
  const qualification = validateTeenRegionalQualification(patch, model,
    infant ? 'atlas_infant_neutral_neck_qualification_v1' : 'atlas_teen_regional_qualification_v1');
  await verifyHash(renderedAnatomyPositions(model).buffer, patch.source_arrays.bone_positions.sha256, 'Teen rendered predecessor');
  const candidate = arrays.bone_positions.slice(), selected = [];
  let changed = false;
  for (const change of patch.bone_patches) {
    const matches = model.bones.filter(({ spec }) => spec.name === change.name), bound = change.maximum_displacement_m;
    const kind = teenRegionalMeshKind(change.name), region = qualification.regions[change.name];
    const regionalCap = qualification.regional_displacement_limits_m?.[change.name] ?? .008;
    if (matches.length !== 1 || typeof bound !== 'number' || !Number.isFinite(bound) || bound <= 0 || bound > .01
        || (bound > regionalCap && (kind !== 'wrist' || region.wrist_10mm_bound_explicitly_qualified !== true))) throw new Error('Invalid teen regional displacement bound.');
    const { mesh, spec } = matches[0], start = spec.vertex_start * 3, end = start + spec.vertex_count * 3;
    if (change.vertex_start !== spec.vertex_start || change.vertex_count !== spec.vertex_count
        || !teenRegionalIds(change.fixed_vertex_ids, spec.vertex_count, kind !== 'wrist')) throw new Error('Teen regional span or attachment pins differ.');
    const scoped = validateTeenRegionalScope(region.target_scope, spec, arrays.bone_faces, kind);
    const original = arrays.bone_positions.subarray(start, end), points = decodeCoupledPositions(change, spec.vertex_count), pins = new Set(change.fixed_vertex_ids);
    await verifyRefinementArray(original, change.source_positions, [spec.vertex_count, 3], 'teen source region');
    await verifyRefinementArray(points, change.output_positions, [spec.vertex_count, 3], 'teen output region');
    for (let id = 0; id < spec.vertex_count; id += 1) {
      const offset = id * 3, fixed = pins.has(id) || (kind === 'connected_component' && !scoped.has(id));
      if (Math.hypot(...[0, 1, 2].map((axis) => points[offset + axis] - original[offset + axis])) > bound
          || (fixed && [0, 1, 2].some((axis) => !Object.is(points[offset + axis], original[offset + axis])))) throw new Error('Teen correction moves a fixed vertex or exceeds its bound.');
      changed ||= [0, 1, 2].some((axis) => !Object.is(points[offset + axis], original[offset + axis]));
    }
    candidate.set(points, start); selected.push({ mesh, start, end });
  }
  if (!changed) throw new Error('Teen correction contains no changed geometry.');
  const output = { ...arrays, bone_positions: candidate };
  for (const key of Object.keys(output)) await verifyRefinementArray(output[key], patch.output_arrays[key], model.sourceArrayShapes[key], `teen output ${key}`);
  const staged = [];
  const metadata = structuredClone({ ...patch, bone_patches: undefined, verified_manifest_asset: publication,
    applied_mesh_names: patch.bone_patches.map(({ name }) => name), previous_layer_evidence_preserved: true,
    qualification_algorithms_rerun_by_transport: false });
  delete metadata.bone_patches;
  const precedingRest = arrays.bone_positions.slice();
  const terminalPayload = structuredClone(patch.terminal_corrections), floorPayload = structuredClone(patch.motion_adjustments);
  try {
    for (const item of selected) {
      const geometry = item.mesh.geometry.clone();
      staged.push({ ...item, geometry, previous: item.mesh.geometry });
      geometry.getAttribute('position').array.set(candidate.subarray(item.start, item.end));
      geometry.getAttribute('position').needsUpdate = true;
      geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    }
  } catch (error) { staged.forEach(({ geometry }) => geometry.dispose()); throw error; }
  model.teenRegionalPredecessorBoneRest = precedingRest;
  for (const { mesh, geometry } of staged) mesh.geometry = geometry;
  model.boneRest = candidate;
  model.terminalCorrections = terminal; model.motionAdjustments = floor;
  model.terminalCorrectionsPayload = terminalPayload;
  model.motionAdjustmentsPayload = floorPayload;
  if (infant) model.infantNeutralNeckRefinement = metadata;
  else model.teenRegionalRefinement = metadata;
  staged.forEach(({ previous }) => previous.dispose());
  return true;
}

async function verifyRenderedTeenRegionalRefinement(model) {
  const patch = postPriorRegionalRefinement(model);
  await validateTeenRegionalSource(model, patch, model.teenRegionalPredecessorBoneRest);
  const output = anatomyRefinementArrays(model);
  for (const key of Object.keys(output)) await verifyRefinementArray(output[key], patch.output_arrays[key], model.sourceArrayShapes[key], `rendered teen output ${key}`);
  await verifyHash(renderedAnatomyPositions(model).buffer, patch.output_arrays.bone_positions.sha256, 'Rendered teen mesh positions');
}

async function verifyRenderedAnatomyRefinement(model) {
  await checkedOriginalMotionView(model);
  if (model?.scopedSkinRest) {
    const track = model.scopedSkinRest, active = state.motionId === 'neutral' && state.time === 0;
    await verifyRefinementArray(track.positions, track.binding.corrected_rest, model.sourceArrayShapes.skin_positions, 'Scoped neutral retained positions');
    if (active) await verifyRefinementArray(model.skinPositions, track.binding.corrected_rest, model.sourceArrayShapes.skin_positions, 'Scoped neutral rendered positions');
    const previous = await verifyRenderedAnatomyRefinement({ ...model, scopedSkinRest: null });
    return { ...previous, scoped_skin_rest: { ...track.binding, active }, previous_layer_evidence_preserved: true };
  }
  if (model?.coupledKneeMotion) {
    const stamp = state.time + model.motions[state.motionId].times[0];
    const coupled = await model.coupledKneeMotion.verifyRendered(state.motionId, stamp);
    const previous = await verifyRenderedAnatomyRefinement({ ...model, coupledKneeMotion: null });
    return { ...previous, coupled_knee_motion: coupled, previous_layer_evidence_preserved: true };
  }
  if (model?.regionalSkinMotion) {
    const regional = await verifyRenderedRegionalSkinMotion(model);
    const previous = await verifyRenderedAnatomyRefinement({ ...model, regionalSkinMotion: null });
    return { ...previous, regional_skin_motion: regional, previous_layer_evidence_preserved: true };
  }
  if (model?.teenNeutralSkinRefinement) {
    await verifyRenderedTeenNeutralSkinRefinement(model);
    const previous = await verifyRenderedAnatomyRefinement({ ...model, teenNeutralSkinRefinement: null });
    return { ...previous, applied: true, teen_neutral_skin: model.teenNeutralSkinRefinement,
      neutral_skin_active: teenNeutralSkinActive(model, state.motionId, state.time), previous_layer_evidence_preserved: true };
  }
  if (model?.adultNeutralSkinRefinement) {
    await verifyRenderedTeenNeutralSkinRefinement(model, 'adult');
    const previous = await verifyRenderedAnatomyRefinement({ ...model, adultNeutralSkinRefinement: null });
    return { ...previous, applied: true, adult_neutral_skin: model.adultNeutralSkinRefinement,
      neutral_skin_active: teenNeutralSkinActive(model, state.motionId, state.time, 'adult'), previous_layer_evidence_preserved: true };
  }
  if (model?.infantNeutralSkinRefinement) {
    await verifyRenderedInfantNeutralSkinRefinement(model);
    const previous = await verifyRenderedAnatomyRefinement({ ...model,
      skinRest: model.infantNeutralSkinPredecessorRest, infantNeutralSkinRefinement: null });
    return { ...previous, applied: true, infant_neutral_skin: model.infantNeutralSkinRefinement,
      previous_layer_evidence_preserved: true };
  }
  const refinement = model?.anatomyRefinement;
  const post = postPriorRegionalRefinement(model);
  if (post) await verifyRenderedTeenRegionalRefinement(model);
  if (!refinement?.applied && !refinement?.supplemental?.applied) return post ? {
    applied: true, bone_vertex_count: model.boneRest.length / 3,
    rest_and_mesh_positions_sha256: post.output_arrays.bone_positions.sha256,
    ...(model.infantNeutralNeckRefinement ? { infant_neutral_neck: post } : { teen_regional: post }), previous_layer_evidence_preserved: true,
  } : { applied: false };
  const supplemental = refinement.supplemental;
  const expected = supplemental?.output_arrays.bone_positions.sha256 || refinement.output_bone_positions_sha256;
  const geometryPositions = renderedAnatomyPositions(model);
  const legacyRest = post ? model.teenRegionalPredecessorBoneRest : model.boneRest;
  await verifyHash(new Uint8Array(legacyRest.buffer, legacyRest.byteOffset, legacyRest.byteLength), expected, 'Verified legacy anatomy rest positions');
  if (!post) await verifyHash(geometryPositions.buffer, expected, 'Rendered anatomy mesh positions');
  if (supplemental) {
    const active = model.activeBoneMeshes || model.sourceBoneMeshes;
    await coupledOwnershipMetadata(model, supplemental);
    await verifyHash(anatomyMetadataBytes(active), supplemental.output_mesh_metadata_sha256 || supplemental.source_mesh_metadata_sha256, 'Rendered ownership metadata');
    if (model.bones.some(({ spec, control }, index) => spec !== active[index] || control !== spec.control_index)) throw new Error('Rendered anatomy ownership differs from the verified correction.');
    const arrays = { ...anatomyRefinementArrays(model), bone_positions: legacyRest }, preceding = { ...arrays };
    for (const key of ['bone_positions', 'skin_indices', 'skin_weights']) {
      await verifyRefinementArray(arrays[key], supplemental.output_arrays[key], model.sourceArrayShapes[key], `rendered output ${key}`);
      preceding[key] = arrays[key].slice();
    }
    for (const { start, positions } of model.coupledRefinementPredecessor.bonePatches) preceding.bone_positions.set(positions, start);
    for (const { vertex, indices, weights } of model.coupledRefinementPredecessor.skinPatches) {
      preceding.skin_indices.set(indices, vertex * 8); preceding.skin_weights.set(weights, vertex * 8);
    }
    for (const key of Object.keys(arrays)) await verifyRefinementArray(preceding[key], supplemental.source_arrays[key], model.sourceArrayShapes[key], `predecessor ${key}`);
    if (refinement.applied) await verifyHash(preceding.bone_positions.buffer, refinement.output_bone_positions_sha256, 'Historical forearm output');
  }
  return { applied: true, bone_vertex_count: geometryPositions.length / 3,
    rest_and_mesh_positions_sha256: post ? post.output_arrays.bone_positions.sha256 : expected,
    patches: refinement.patches, report: refinement.report || supplemental?.report, base_stage_applied: refinement.applied,
    ...(post ? { ...(model.infantNeutralNeckRefinement ? { infant_neutral_neck: post } : { teen_regional: post }),
      legacy_output_bone_positions_sha256: expected, previous_layer_evidence_preserved: true } : {}),
    ...(supplemental ? { supplemental, ...(refinement.applied ? { historical_forearm_output_sha256: refinement.output_bone_positions_sha256 } : {}), predecessor_arrays_verified: true } : {}) };
}

function validateInfantSkinQuality(quality, bound) {
  const limits = { maximum_displacement_m: bound, maximum_edge_gradient: .35,
    minimum_edge_length_ratio: .65, maximum_edge_length_ratio: 1.35,
    minimum_area_ratio: .4, maximum_area_ratio: 1.9, minimum_normal_alignment: 0 };
  if (!quality || Object.entries(limits).some(([key, limit]) => typeof quality[key] !== 'number'
      || !Number.isFinite(quality[key]) || (key.startsWith('maximum') ? quality[key] < 0 || quality[key] > limit : quality[key] < limit))
      || !(quality.minimum_normal_alignment > 0 && quality.minimum_normal_alignment <= 1.000000000000001)
      || !Number.isSafeInteger(quality.original_degenerate_face_count) || quality.original_degenerate_face_count < 0
      || quality.reversed_or_collapsed_original_face_count !== 0) throw new Error('Infant neutral skin quality exceeds its fixed limits.');
}

function measuredInfantSkinQuality(before, after, faces) {
  const vector = (array, a, b) => [0, 1, 2].map((axis) => array[a * 3 + axis] - array[b * 3 + axis]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const result = { maximum_displacement_m: 0, maximum_edge_gradient: 0, minimum_edge_length_ratio: Infinity,
    maximum_edge_length_ratio: 0, minimum_area_ratio: Infinity, maximum_area_ratio: 0,
    minimum_normal_alignment: Infinity, original_degenerate_face_count: 0, reversed_or_collapsed_original_face_count: 0 };
  const edges = new Set(), delta = Float64Array.from(after, (value, id) => value - before[id]);
  for (let id = 0; id < before.length; id += 3) result.maximum_displacement_m = Math.max(result.maximum_displacement_m, Math.hypot(...delta.subarray(id, id + 3)));
  for (let id = 0; id < faces.length; id += 3) {
    const [a, b, c] = faces.subarray(id, id + 3);
    const old = cross(vector(before, b, a), vector(before, c, a)), next = cross(vector(after, b, a), vector(after, c, a));
    const oldArea = Math.hypot(...old), newArea = Math.hypot(...next), dot = old.reduce((sum, value, axis) => sum + value * next[axis], 0);
    if (oldArea <= 1e-12) result.original_degenerate_face_count += 1;
    else {
      result.minimum_area_ratio = Math.min(result.minimum_area_ratio, newArea / oldArea);
      result.maximum_area_ratio = Math.max(result.maximum_area_ratio, newArea / oldArea);
      result.minimum_normal_alignment = Math.min(result.minimum_normal_alignment, newArea > 0 ? dot / (oldArea * newArea) : 0);
      if (dot <= 0) result.reversed_or_collapsed_original_face_count += 1;
    }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = `${Math.min(u, v)},${Math.max(u, v)}`;
      if (edges.has(key)) continue;
      edges.add(key);
      const length = Math.hypot(...vector(before, u, v));
      if (length <= 1e-12) continue;
      const ratio = Math.hypot(...vector(after, u, v)) / length;
      result.minimum_edge_length_ratio = Math.min(result.minimum_edge_length_ratio, ratio);
      result.maximum_edge_length_ratio = Math.max(result.maximum_edge_length_ratio, ratio);
      result.maximum_edge_gradient = Math.max(result.maximum_edge_gradient, Math.hypot(...vector(delta, u, v)) / length);
    }
  }
  return result;
}

function validateInfantNeutralSkinQualification(model, patch) {
  const evidence = patch.qualification, bound = patch.skin_patch?.maximum_displacement_m;
  const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (evidence?.schema !== 'atlas_infant_neutral_skin_qualification_v1' || evidence.case_id !== patch.case_id
      || evidence.scope !== 'declared_finite_reference_samples_only'
      || evidence.sampling !== 'referenced_vertices_unique_edge_midpoints_triangle_centroids'
      || !Array.isArray(evidence.poses) || evidence.poses.length !== 1
      || Object.keys(evidence.poses[0] || {}).sort().join(',') !== 'clip,time_s'
      || evidence.poses[0].clip !== 'neutral' || evidence.poses[0].time_s !== 0
      || ['shape_quality_pass', 'finite_native_surface_nonregression_pass', 'bone_geometry_weights_faces_rig_ownership_unchanged'].some((key) => evidence[key] !== true)
      || ['whole_body_containment_certified', 'continuous_motion_certified', 'anatomical_fit_validated', 'physics_validated', 'full_surface_containment_certified'].some((key) => evidence[key] !== false)
      || !hash(evidence.report_sha256) || !hash(evidence.candidate_archive_sha256)
      || !evidence.method_source_sha256 || typeof evidence.method_source_sha256 !== 'object' || Array.isArray(evidence.method_source_sha256)
      || !Object.keys(evidence.method_source_sha256).length || Object.keys(evidence.method_source_sha256).length > 64
      || Object.entries(evidence.method_source_sha256).some(([name, value]) => !name || !hash(value))) throw new Error('Invalid finite neutral skin qualification.');
  const inventory = teenRegionalTopology(model), targets = evidence.target_mesh_names, rows = evidence.meshes, proofs = evidence.original_triangle_proofs || {};
  const names = inventory.map((mesh) => mesh.name), faces = model.sourceTopology.bone_faces;
  if (!rows || typeof rows !== 'object' || Array.isArray(rows) || Object.keys(rows).length !== names.length || names.some((name) => !Object.hasOwn(rows, name))
      || !Array.isArray(targets) || !targets.length || targets.some((name) => typeof name !== 'string' || !names.includes(name))
      || targets.join(',') !== [...new Set(targets)].sort().join(',') || !proofs || typeof proofs !== 'object' || Array.isArray(proofs)
      || Object.keys(proofs).some((name) => !targets.includes(name))) throw new Error('Complete original infant mesh diagnostics and explicit targets are required.');
  for (const mesh of inventory) {
    const row = rows[mesh.name], vertices = new Set(), edges = new Set();
    for (let offset = 0; offset < mesh.index_count; offset += 3) {
      const triangle = Array.from(faces.subarray(mesh.index_start + offset, mesh.index_start + offset + 3));
      triangle.forEach((id) => vertices.add(id));
      for (let corner = 0; corner < 3; corner += 1) { const a = triangle[corner], b = triangle[(corner + 1) % 3]; edges.add(`${Math.min(a, b)},${Math.max(a, b)}`); }
    }
    const counts = { referenced_vertex_count: vertices.size, unique_edge_count: edges.size, triangle_count: mesh.index_count / 3,
      sample_count: vertices.size + edges.size + mesh.index_count / 3 };
    if (!row || Object.entries(counts).some(([key, value]) => !Number.isSafeInteger(row[key]) || row[key] !== value)
        || ['new_known_exterior_count', 'worsened_known_exterior_count', 'unknown_to_known_exterior_count', 'unresolved_new_unknown_count'].some((key) => row[key] !== 0)
        || !Number.isSafeInteger(row.new_unknown_count) || row.new_unknown_count < 0) throw new Error('Infant mesh sampling or nonregression inventory differs.');
    for (const prefix of ['before', 'after']) {
      const exterior = row[`${prefix}_exterior_count`], unknown = row[`${prefix}_unknown_count`];
      if (!Number.isSafeInteger(exterior) || !Number.isSafeInteger(unknown) || exterior < 0 || unknown < 0
          || exterior + unknown > row.sample_count) throw new Error('Infant residual finite diagnostics are incomplete.');
    }
    const proof = proofs[mesh.name];
    const resolved = proof !== undefined && row.after_exterior_count === 0;
    if (row.after_exterior_count > row.before_exterior_count || row.new_unknown_count > row.after_unknown_count
        || (row.new_unknown_count > 0 && !resolved)
        || (row.after_unknown_count > row.before_unknown_count && !(resolved && row.new_unknown_count > 0))) throw new Error('Infant whole-body sampled diagnostics regress without exact resolution.');
    if (proof !== undefined) {
      const identity = (value, count) => value && Object.keys(value).sort().join(',') === 'dtype,sha256,shape' && value.dtype === 'float32'
        && Array.isArray(value.shape) && value.shape.length === 2 && value.shape[0] === count && value.shape[1] === 3 && hash(value.sha256);
      if (!proof || Object.keys(proof).sort().join(',') !== 'clearance_m,mathematical_surface_containment_under_original_parity_proved,native_bone_positions,native_skin_positions,report_sha256,untested_required_pair_count'
          || !hash(proof.report_sha256) || typeof proof.clearance_m !== 'number' || !(proof.clearance_m >= 0 && proof.clearance_m <= .001) || proof.untested_required_pair_count !== 0
          || proof.mathematical_surface_containment_under_original_parity_proved !== true
          || !identity(proof.native_bone_positions, mesh.vertex_count) || !identity(proof.native_skin_positions, model.skinRest.length / 3)
          || canonicalAnatomyPatchJSON(proof.native_skin_positions) !== canonicalAnatomyPatchJSON(evidence.native_skin_positions)) throw new Error('Infant exact target evidence does not bind complete native surfaces.');
    } else if (targets.includes(mesh.name) && (row.after_exterior_count || row.after_unknown_count)) throw new Error('Infant target samples are not all known inside.');
  }
  const contacts = evidence.skin_self_contacts;
  if (!contacts || ['before_count', 'after_count', 'new_count'].some((key) => !Number.isSafeInteger(contacts[key]) || contacts[key] < 0)
      || contacts.new_count !== 0 || contacts.after_count > contacts.before_count) throw new Error('Infant skin introduces a self-contact.');
  validateInfantSkinQuality(evidence.skin_quality, bound);
}

async function applyInfantNeutralSkinRefinement(model, patch, caseId, publication) {
  if (!/^infant_(male|female)_weight(025|050|075)$/.test(caseId) || patch?.case_id !== caseId
      || patch.schema !== 'atlas_infant_neutral_skin_patch_v1' || patch.applied !== true || model.infantNeutralSkinRefinement
      || Object.keys(model.motions).join(',') !== 'neutral' || model.motions.neutral.times.length !== 1 || model.motions.neutral.times[0] !== 0
      || ['bone_patches', 'skin_patches', 'ownership_patches'].some((key) => Object.hasOwn(patch, key) && (!Array.isArray(patch[key]) || patch[key].length))) throw new Error('Invalid infant neutral-only skin correction.');
  await verifyRenderedAnatomyRefinement(model);
  const { arrays, terminal, floor } = await validateTeenRegionalSource(model, patch);
  const change = patch.skin_patch, bound = change?.maximum_displacement_m;
  if (typeof bound !== 'number' || !Number.isFinite(bound) || !(bound > 0 && bound <= .008)) throw new Error('Infant skin displacement exceeds 8mm.');
  const candidate = decodeCoupledPositions(change, model.skinRest.length / 3);
  await verifyRefinementArray(model.skinRest, change.source_positions, model.sourceArrayShapes.skin_positions, 'infant source skin');
  await verifyRefinementArray(candidate, change.output_positions, model.sourceArrayShapes.skin_positions, 'infant candidate skin');
  if (!candidate.some((value, index) => !Object.is(value, model.skinRest[index]))) throw new Error('Infant skin correction changes no geometry.');
  validateInfantNeutralSkinQualification(model, patch);
  validateInfantSkinQuality(measuredInfantSkinQuality(model.skinRest, candidate, model.sourceTopology.skin_faces), bound);
  const output = { ...arrays, skin_positions: candidate };
  for (const key of Object.keys(output)) await verifyRefinementArray(output[key], patch.output_arrays[key], model.sourceArrayShapes[key], `infant skin output ${key}`);
  const metadata = structuredClone({ ...patch, skin_patch: undefined, verified_manifest_asset: publication,
    previous_layer_evidence_preserved: true, qualification_algorithms_rerun_by_transport: false });
  delete metadata.skin_patch;
  const predecessor = model.skinRest.slice(), previous = model.skin.geometry;
  const terminalPayload = structuredClone(patch.terminal_corrections), floorPayload = structuredClone(patch.motion_adjustments);
  const geometry = previous.clone();
  let skinPositions, normalRest;
  try {
    geometry.setIndex(previous.index);
    skinPositions = geometry.getAttribute('position').array;
    skinPositions.set(candidate);
    geometry.getAttribute('position').needsUpdate = true;
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    normalRest = geometry.getAttribute('normal').array.slice();
  } catch (error) { geometry.dispose(); throw error; }
  model.infantNeutralSkinPredecessorRest = predecessor;
  model.skinRest = candidate; model.skinPositions = skinPositions; model.normalRest = normalRest;
  model.skin.geometry = geometry; model.infantNeutralSkinRefinement = metadata;
  model.terminalCorrections = terminal; model.motionAdjustments = floor;
  model.terminalCorrectionsPayload = terminalPayload; model.motionAdjustmentsPayload = floorPayload;
  previous.dispose();
  return true;
}

async function verifyRenderedInfantNeutralSkinRefinement(model) {
  const patch = model.infantNeutralSkinRefinement;
  await validateTeenRegionalSource({ ...model, skinRest: model.infantNeutralSkinPredecessorRest }, patch);
  const output = anatomyRefinementArrays(model);
  for (const key of Object.keys(output)) await verifyRefinementArray(output[key], patch.output_arrays[key], model.sourceArrayShapes[key], `rendered infant skin ${key}`);
  if (model.skin.geometry.getAttribute('position').array !== model.skinPositions) throw new Error('Infant rendered skin buffer differs.');
  await verifyHash(new Uint8Array(model.skinPositions.buffer, model.skinPositions.byteOffset, model.skinPositions.byteLength), patch.output_arrays.skin_positions.sha256, 'Rendered infant neutral skin positions');
}

async function neutralSkinArrayHash(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function validateTeenNeutralSkinQuality(quality, bound) {
  validateInfantSkinQuality(quality, bound);
  if (quality.maximum_edge_gradient > .25) throw new Error('Teen neutral skin exceeds its edge-gradient limit.');
}

function measuredTeenNeutralSkinQuality(before, after, faces) {
  const quality = measuredInfantSkinQuality(before, after, faces);
  const vector = (array, a, b) => [0, 1, 2].map((axis) => array[a * 3 + axis] - array[b * 3 + axis]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const delta = Float64Array.from(after, (value, id) => value - before[id]);
  for (let offset = 0; offset < faces.length; offset += 3) {
    const [a, b, c] = faces.subarray(offset, offset + 3);
    const old = cross(vector(before, b, a), vector(before, c, a)), next = cross(vector(after, b, a), vector(after, c, a));
    if (old.some((value) => value !== 0) && old.reduce((sum, value, axis) => sum + value * next[axis], 0) <= 0) throw new Error('Teen skin reverses or collapses an original face.');
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const length = Math.hypot(...vector(before, u, v)), change = Math.hypot(...vector(delta, u, v));
      if (length === 0 && change !== 0) throw new Error('Teen skin changes an original zero-length edge.');
      if (length > 0) quality.maximum_edge_gradient = Math.max(quality.maximum_edge_gradient, change / length);
    }
  }
  return quality;
}

function validateTeenNeutralSkinPredecessor(model, patch) {
  const assets = patch.source_derived_motion_assets;
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)
      || Object.keys(assets).sort().join(',') !== 'lumbar_motion_asset,patella_motion_asset') throw new Error('Teen neutral skin predecessor motion bindings are missing.');
  for (const [key, field] of [['patella_motion_asset', 'patellaMotion'], ['lumbar_motion_asset', 'lumbarMotion']]) {
    if (assets[key] !== null && (typeof assets[key] !== 'string' || !/^[a-f0-9]{64}$/.test(assets[key]))) throw new Error('Invalid teen predecessor motion hash.');
    if (assets[key] !== (model[field]?.asset_sha256 ?? null)) throw new Error('Teen neutral skin predecessor motion asset differs.');
  }
  for (const [key, field] of [['terminal_corrections', 'terminalCorrectionsPayload'], ['motion_adjustments', 'motionAdjustmentsPayload']]) {
    if (canonicalAnatomyPatchJSON(model[field] ?? null) !== canonicalAnatomyPatchJSON(patch[key])) throw new Error('Teen neutral skin predecessor runtime differs.');
  }
}

async function validateTeenNeutralSkinQualification(model, patch, scope = 'teen') {
  if (!['teen', 'adult'].includes(scope)) throw new Error('Unsupported neutral skin scope.');
  const evidence = patch.qualification, hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const methods = evidence?.method_source_sha256;
  if (evidence?.schema !== `atlas_${scope}_neutral_skin_qualification_v1` || evidence.moving_skin_unchanged !== true
      || ['unrestricted_moving_clip_use_qualified', 'continuous_motion_containment_certified', 'clinical_anatomy_validated',
        'bone_contact_validated', 'anatomical_solid_validated'].some((key) => evidence[key] !== false)
      || !methods || typeof methods !== 'object' || Array.isArray(methods)
      || !Object.keys(methods).length || Object.keys(methods).length > 1024
      || Object.entries(methods).some(([key, value]) => !key || !hash(value))) throw new Error('Invalid neutral-only teen skin qualification.');
  const expected = teenRegionalTopology(model).map((mesh) => mesh.name).filter((name) => name.startsWith('hand_r__')
    || name.startsWith('hand_l__') || ['radius', 'radius_mirror', 'ulna', 'ulna_mirror', 'humerus', 'humerus_mirror'].includes(name)).sort();
  if (expected.length !== 60 || expected.filter((name) => name.startsWith('hand_r__')).length !== 27
      || expected.filter((name) => name.startsWith('hand_l__')).length !== 27 || !Array.isArray(evidence.target_mesh_names)
      || evidence.target_mesh_names.join(',') !== expected.join(',')
      || !evidence.original_triangle_proofs || Object.keys(evidence.original_triangle_proofs).sort().join(',') !== expected.join(',')
      || Object.values(evidence.original_triangle_proofs).some((proof) => proof?.clearance_m !== 0)) throw new Error('Teen neutral skin requires complete exact evidence for all 60 hand and arm meshes.');
  const identity = (value, count) => value && Object.keys(value).sort().join(',') === 'dtype,sha256,shape'
    && value.dtype === 'float32' && Array.isArray(value.shape) && value.shape.length === 2
    && value.shape[0] === count && value.shape[1] === 3 && hash(value.sha256);
  if (!identity(evidence.native_before_skin_positions, model.skinRest.length / 3)
      || !identity(evidence.native_bone_positions, model.boneRest.length / 3)) throw new Error('Teen neutral skin native source identities are missing.');
  // Reuse the complete finite inventory checker without truncating the retained method map.
  const methodMapHash = await neutralSkinArrayHash(anatomyMetadataBytes(methods));
  validateInfantNeutralSkinQualification(model, { ...patch, qualification: { ...evidence,
    schema: 'atlas_infant_neutral_skin_qualification_v1', method_source_sha256: { complete_method_map_sha256: methodMapHash } } });
  if (expected.some((name) => evidence.meshes[name].after_exterior_count !== 0)) throw new Error('Teen neutral exact targets retain known exterior samples.');
  validateTeenNeutralSkinQuality(evidence.skin_quality, patch.skin_patch.maximum_displacement_m);
  validateTeenNeutralSkinQuality(evidence.native_skin_quality, patch.skin_patch.maximum_displacement_m);
  const contacts = evidence.rest_skin_self_contacts;
  if (!contacts || ['before_count', 'after_count', 'new_count'].some((key) => !Number.isSafeInteger(contacts[key]) || contacts[key] < 0)
      || contacts.new_count !== 0 || contacts.after_count > contacts.before_count) throw new Error('Teen neutral rest skin introduces a self-contact.');
}

function teenNeutralSkinActive(model, clip, time, scope = 'teen') {
  return ['teen', 'adult'].includes(scope) && model?.[`${scope}NeutralSkinRefinement`]?.applied === true && clip === 'neutral' && time === 0;
}

function skinRestForPose(model, clip, time) {
  if (model?.adultNeutralSkinRefinement && (model.teenNeutralSkinRefinement || model.regionalSkinMotion || model.coupledKneeMotion)) throw new Error('Adult neutral skin composition is not qualified.');
  if (model?.regionalSkinMotion?.clips[clip]) {
    if (typeof time !== 'number' || !Number.isFinite(time)) throw new Error('Regional playback time must be finite and numeric.');
    return regionalSkinRestForPose(model, clip, time + model.motions[clip].times[0]);
  }
  if (teenNeutralSkinActive(model, clip, time, 'adult')) return { positions: model.adultNeutralSkinRest, normals: model.adultNeutralSkinNormals };
  return teenNeutralSkinActive(model, clip, time)
    ? { positions: model.teenNeutralSkinRest, normals: model.teenNeutralSkinNormals }
    : { positions: model.skinRest, normals: model.normalRest };
}

function scopedSkinRestForPose(model, predecessor, clip, time) {
  const track = model.scopedSkinRest;
  if (!track || clip !== 'neutral' || time !== 0) return predecessor;
  if (predecessor.positions.length !== track.predecessor.length
      || predecessor.positions.some((value, index) => value !== track.predecessor[index])) throw new Error('Scoped neutral predecessor changed.');
  return { positions: track.positions, normals: track.normals };
}

function scopedSkinRestPolicy(caseId) {
  const policies = {
    adult_female_weight050: { targets: ['cerv5'], vertices: 134, displacement: .005, gradient: .15, minArea: .9, maxArea: 1.1 },
    adult_male_weight025: { targets: ['humerus', 'humerus_mirror', 'radius', 'radius_mirror'], vertices: 599, displacement: .012, gradient: .25, minArea: .4, maxArea: 1.9 },
  };
  return Object.hasOwn(policies, caseId) ? policies[caseId] : null;
}

async function loadScopedSkinRest(model, caseId, signal) {
  const asset = manifest?.scoped_skin_rest_asset;
  if (!asset) return null;
  if (!regionalSkinKeys(asset, ['data_url', 'sha256', 'case_ids']) || asset.data_url !== 'scoped_skin_rest.json'
      || !regionalSkinHash(asset.sha256) || !Array.isArray(asset.case_ids) || !asset.case_ids.length
      || asset.case_ids.some(id => typeof id !== 'string' || !scopedSkinRestPolicy(id))
      || !regionalSkinEqual(asset.case_ids, [...new Set(asset.case_ids)].sort())) throw new Error('Invalid scoped neutral skin registry.');
  if (!asset.case_ids.includes(caseId)) return null;
  const policy = scopedSkinRestPolicy(caseId);
  const raw = await fetchChecked(absoluteURL(asset.data_url, manifestURL), signal, false);
  await verifyHash(raw, asset.sha256, 'Scoped neutral skin publication');
  const data = JSON.parse(new TextDecoder().decode(raw)), payload = data?.case_patches?.[caseId];
  if (!regionalSkinKeys(data, ['schema', 'case_patches']) || data.schema !== 'atlas_scoped_skin_rest_collection_v1'
      || !regionalSkinKeys(data.case_patches, asset.case_ids) || payload?.schema !== 'atlas_scoped_skin_rest_v1'
      || payload.case_id !== caseId || !regionalSkinEqual(payload.scope, [{ clip: 'neutral', time_s: 0 }])
      || !regionalSkinHash(payload.validation_sha256) || !regionalSkinHash(payload.source_sha256)
      || !regionalSkinHash(payload.qualification_sha256) || !payload.method_source_sha256
      || !Object.keys(payload.method_source_sha256).length || Object.values(payload.method_source_sha256).some(value => !regionalSkinHash(value))
      || ['whole_body_containment_certified', 'continuous_motion_certified', 'anatomical_fit_validated'].some(key => payload[key] !== false)) throw new Error('Scoped neutral skin scope or evidence differs.');
  // The verified publication binds Python metadata digests; JS numeric formatting is not substituted.
  const runtime = payload.source?.runtime;
  const predecessors = Object.fromEntries(Object.entries(manifest).filter(([key]) => key.endsWith('_asset') && key !== 'scoped_skin_rest_asset'));
  if (!regionalSkinKeys(runtime, ['motion_adjustments', 'terminal_corrections', 'predecessor_assets'])
      || !regionalSkinEqual(runtime.predecessor_assets, predecessors)) throw new Error('Scoped neutral predecessor publications differ.');
  // Reuse complete array, rig and recording identity checks, not regional acceptance gates.
  await validateRegionalSkinSource(model, { ...payload, source: { ...payload.source, runtime: {
    motion_adjustments: runtime.motion_adjustments, terminal_corrections: runtime.terminal_corrections,
    derived_motion_assets: { patella_motion_asset: model.patellaMotion?.asset_sha256 ?? null, lumbar_motion_asset: model.lumbarMotion?.asset_sha256 ?? null },
    neutral_skin_asset_sha256: model.teenNeutralSkinRefinement?.verified_manifest_asset?.sha256 ?? null,
  } } });
  const ids = payload.vertex_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > policy.vertices || ids.some((id, i) => !Number.isSafeInteger(id)
      || id < 0 || id >= model.skinRest.length / 3 || (i > 0 && id <= ids[i - 1]))) throw new Error('Invalid scoped neutral support.');
  const values = await decodeRegionalSkinArray(payload.positions, 'float32', [ids.length, 3], 'Scoped neutral positions');
  const predecessor = skinRestForPose(model, 'neutral', 0).positions.slice(), positions = predecessor.slice();
  ids.forEach((id, i) => positions.set(values.subarray(i * 3, i * 3 + 3), id * 3));
  await verifyRefinementArray(predecessor, payload.predecessor_rest, [positions.length / 3, 3], 'Scoped neutral predecessor rest');
  await verifyRefinementArray(positions, payload.corrected_rest, [positions.length / 3, 3], 'Scoped neutral corrected rest');
  const quality = measuredTeenNeutralSkinQuality(predecessor, positions, model.sourceTopology.skin_faces);
  validateTeenNeutralSkinQuality(quality, policy.displacement);
  if (quality.maximum_edge_gradient > policy.gradient || quality.minimum_area_ratio < policy.minArea || quality.maximum_area_ratio > policy.maxArea) throw new Error('Scoped neutral skin quality failed.');
  const q = payload.qualification, inventory = regionalSkinInventory(model, teenRegionalTopology(model)).sampling;
  const complete = q?.quality;
  if (complete?.complete_original_face_count !== model.sourceTopology.skin_faces.length / 3
      || complete.unsupported_original_face_count !== 0 || complete.reversed_or_collapsed_original_face_count !== 0
      || complete.zero_length_edge_changed_count !== 0 || complete.small_nonzero_faces_omitted !== false || complete.passes !== true
      || ['maximum_displacement_m', 'maximum_serialized_edge_gradient', 'minimum_area_ratio', 'maximum_area_ratio'].some(key => typeof complete[key] !== 'number' || !Number.isFinite(complete[key]))
      || complete.maximum_displacement_m < 0 || complete.maximum_displacement_m > policy.displacement || complete.maximum_serialized_edge_gradient < 0 || complete.maximum_serialized_edge_gradient > policy.gradient
      || complete.minimum_area_ratio < policy.minArea || complete.maximum_area_ratio > policy.maxArea || complete.minimum_area_ratio > complete.maximum_area_ratio) throw new Error('Scoped neutral complete original-face quality failed.');
  const zero = ['new_known_exterior', 'unknown_to_exterior', 'worsened_known_exterior', 'new_unknown', 'new_skin_contacts'];
  if (q?.passed !== true || q.clip !== 'neutral' || q.time_s !== 0 || q.original_bones_byte_identical !== true || q.fixed_skin_byte_identical !== true
      || q.predecessor_rest_positions?.sha256 !== payload.predecessor_rest.sha256 || q.rest_positions?.sha256 !== payload.corrected_rest.sha256
      || !regionalSkinEqual(q.native_before?.anatomy, q.native_after?.anatomy)
      || !regionalSkinKeys(q.nonregression, zero) || zero.some(key => q.nonregression[key] !== 0)
      || Object.keys(inventory).length !== 132 || !regionalSkinKeys(q.meshes, Object.keys(inventory))) throw new Error('Scoped neutral complete nonregression evidence differs.');
  for (const [name, expected] of Object.entries(inventory)) {
    const row = q.meshes[name];
    if (row?.sample_count !== expected.sample_count
        || ['new_known_exterior_count', 'worsened_known_exterior_count', 'unknown_to_known_exterior_count', 'new_unknown_count', 'unresolved_new_unknown_count'].some(key => row[key] !== 0)
        || ['before_exterior_count', 'after_exterior_count', 'before_unknown_count', 'after_unknown_count'].some(key => !Number.isSafeInteger(row[key]) || row[key] < 0)
        || row.after_exterior_count > row.before_exterior_count || row.after_unknown_count > row.before_unknown_count) throw new Error('Scoped neutral mesh nonregression failed.');
  }
  const contact = q.skin_self_contacts;
  if (contact?.full_original_skin_triangle_audit !== true || contact.triangle_index_space !== 'original_skin_faces'
      || ['before_count', 'after_count', 'new_count'].some(key => !Number.isSafeInteger(contact[key]) || contact[key] < 0)
      || contact.new_count !== 0 || contact.after_count > contact.before_count
      || !regionalSkinHash(contact.before_pairs_sha256) || !regionalSkinHash(contact.after_pairs_sha256)
      || (contact.after_count === contact.before_count && contact.before_pairs_sha256 !== contact.after_pairs_sha256)) throw new Error('Scoped neutral original skin self-contact failed.');
  if (!regionalSkinKeys(q.exact_targets, policy.targets)) throw new Error('Scoped neutral original-triangle target inventory differs.');
  for (const name of policy.targets) {
    const proof = q.exact_targets[name], separation = proof?.separation, parity = proof?.parity;
    const meta = teenRegionalTopology(model).find(row => row.name === name);
    if (q.meshes[name].after_exterior_count !== 0 || q.meshes[name].after_unknown_count !== 0
        || proof?.schema !== 'atlas_original_triangle_pose_proof_v1' || proof.mathematical_surface_containment_under_original_parity_proved !== true
        || proof.continuous_runtime_containment_certified !== false || proof.clinical_or_anatomical_containment_certified !== false
        || separation?.original_bone_face_count !== meta.index_count / 3 || separation.original_skin_face_count !== model.sourceTopology.skin_faces.length / 3
        || separation.every_original_pair_accounted_for !== true || separation.all_original_pairs_proved_separated !== true
        || separation.untested_pair_count !== 0 || separation.contact_or_clearance_witness_count !== 0
        || separation.original_faces_removed !== false || separation.point_sampling_used !== false
        || parity?.all_components_resolved_inside !== true || parity.original_skin_components_excluded !== false) throw new Error(`Scoped original-triangle proof differs: ${name}`);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(model.sourceTopology.skin_faces, 1));
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal').array.slice(); geometry.dispose();
  const binding = { schema: payload.schema, case_id: caseId, scope: payload.scope, source_sha256: payload.source_sha256,
    qualification_sha256: payload.qualification_sha256, corrected_rest: payload.corrected_rest,
    whole_body_containment_certified: false, continuous_motion_certified: false, anatomical_fit_validated: false };
  model.scopedSkinRest = { predecessor, positions, normals, binding, asset_sha256: asset.sha256 };
  return model.scopedSkinRest;
}

async function applyTeenNeutralSkinRefinement(model, patch, caseId, publication, scope = 'teen') {
  if (!['teen', 'adult'].includes(scope) || !new RegExp(`^${scope}_(male|female)_weight(025|050|075)$`).test(caseId) || patch?.case_id !== caseId
      || patch.schema !== `atlas_${scope}_neutral_skin_patch_v1` || patch.applied !== true || model.teenNeutralSkinRefinement || model.adultNeutralSkinRefinement
      || (scope === 'adult' && (model.regionalSkinMotion || model.coupledKneeMotion))
      || !patch.activation || Object.keys(patch.activation).sort().join(',') !== 'clip,time_s'
      || patch.activation.clip !== 'neutral' || patch.activation.time_s !== 0
      || patch.moving_skin_semantics !== 'unchanged_predecessor_rest'
      || Object.keys(model.motions).sort().join(',') !== 'idle,kick_steps,neutral,punch_steps,run,walk'
      || model.motions.neutral.times.length !== 1 || model.motions.neutral.times[0] !== 0
      || ['bone_patches', 'skin_patches', 'ownership_patches'].some((key) => Object.hasOwn(patch, key) && (!Array.isArray(patch[key]) || patch[key].length))) throw new Error('Invalid neutral-only teen skin correction.');
  for (const [clip, motion] of Object.entries(model.motions)) {
    if (motion.times.length < (clip === 'neutral' ? 1 : 2)
        || motion.times.some((time, index) => typeof time !== 'number' || !Number.isFinite(time) || (index > 0 && time <= motion.times[index - 1]))) throw new Error('Teen neutral skin requires all six finite unchanged recordings.');
  }
  await verifyRenderedAnatomyRefinement(model);
  validateTeenNeutralSkinPredecessor(model, patch);
  const { arrays } = await validateTeenRegionalSource(model, patch);
  const change = patch.skin_patch, bound = change?.maximum_displacement_m;
  if (typeof bound !== 'number' || !Number.isFinite(bound) || !(bound > 0 && bound <= .012)) throw new Error('Teen neutral skin displacement exceeds 12mm.');
  const candidate = decodeCoupledPositions(change, model.skinRest.length / 3);
  await verifyRefinementArray(model.skinRest, change.source_positions, model.sourceArrayShapes.skin_positions, 'teen neutral source skin');
  await verifyRefinementArray(candidate, change.output_positions, model.sourceArrayShapes.skin_positions, 'teen neutral candidate skin');
  if (!candidate.some((value, index) => !Object.is(value, model.skinRest[index]))) throw new Error('Teen neutral correction changes no skin geometry.');
  await validateTeenNeutralSkinQualification(model, patch, scope);
  validateTeenNeutralSkinQuality(measuredTeenNeutralSkinQuality(model.skinRest, candidate, model.sourceTopology.skin_faces), bound);
  const output = { ...arrays, skin_positions: candidate };
  for (const key of Object.keys(output)) await verifyRefinementArray(output[key], patch.output_arrays[key], model.sourceArrayShapes[key], `teen neutral output ${key}`);
  const geometry = model.skin.geometry.clone();
  let normalRest;
  try {
    geometry.setIndex(model.skin.geometry.index);
    geometry.getAttribute('position').array.set(candidate);
    geometry.computeVertexNormals();
    normalRest = geometry.getAttribute('normal').array.slice();
  } finally { geometry.dispose(); }
  if (normalRest.some((value) => !Number.isFinite(value))) throw new Error('Teen neutral skin normals are nonfinite.');
  const metadata = structuredClone({ ...patch, skin_patch: undefined, verified_manifest_asset: publication,
    previous_layer_evidence_preserved: true, qualification_algorithms_rerun_by_transport: false });
  delete metadata.skin_patch;
  const normalHash = await neutralSkinArrayHash(normalRest), predecessorNormalHash = await neutralSkinArrayHash(model.normalRest);
  model[`${scope}NeutralSkinRest`] = candidate;
  model[`${scope}NeutralSkinNormals`] = normalRest;
  model[`${scope}NeutralSkinNormalHash`] = normalHash;
  model[`${scope}NeutralSkinPredecessorNormalHash`] = predecessorNormalHash;
  model[`${scope}NeutralSkinRefinement`] = metadata;
  return true;
}

async function verifyRenderedTeenNeutralSkinRefinement(model, scope = 'teen') {
  if (!['teen', 'adult'].includes(scope)) throw new Error('Unsupported neutral skin scope.');
  const patch = model[`${scope}NeutralSkinRefinement`];
  validateTeenNeutralSkinPredecessor(model, patch);
  await validateTeenRegionalSource(model, patch);
  const output = { ...anatomyRefinementArrays(model), skin_positions: model[`${scope}NeutralSkinRest`] };
  for (const key of Object.keys(output)) await verifyRefinementArray(output[key], patch.output_arrays[key], model.sourceArrayShapes[key], `verified teen neutral output ${key}`);
  const normalRest = model[`${scope}NeutralSkinNormals`], normalHash = model[`${scope}NeutralSkinNormalHash`];
  await verifyHash(new Uint8Array(model.normalRest.buffer, model.normalRest.byteOffset, model.normalRest.byteLength), model[`${scope}NeutralSkinPredecessorNormalHash`], 'Predecessor skin normals');
  await verifyHash(new Uint8Array(normalRest.buffer, normalRest.byteOffset, normalRest.byteLength), normalHash, 'Neutral skin normals');
  if (model.skin.geometry.getAttribute('position').array !== model.skinPositions) throw new Error('Teen rendered skin buffer differs.');
  if (teenNeutralSkinActive(model, state.motionId, state.time, scope)) {
    await verifyHash(new Uint8Array(model.skinPositions.buffer, model.skinPositions.byteOffset, model.skinPositions.byteLength), patch.output_arrays.skin_positions.sha256, 'Rendered teen neutral skin positions');
    const normals = model.skin.geometry.getAttribute('normal').array;
    await verifyHash(new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength), normalHash, 'Rendered neutral skin normals');
  }
}

async function loadCoupledKneeMotion(model, caseId, signal) {
  const asset = manifest?.coupled_knee_motion_asset;
  if (asset === undefined) return null;
  if (!regionalSkinKeys(asset, ['data_url', 'sha256', 'case_ids']) || asset.data_url !== 'coupled_knee_motion.json'
      || !regionalSkinHash(asset.sha256) || !Array.isArray(asset.case_ids)
      || asset.case_ids.length !== 1 || asset.case_ids[0] !== 'teen_female_weight050') throw new Error('Invalid coupled knee publication registry.');
  if (!asset.case_ids.includes(caseId)) return null;
  const coupled = await import('./coupled_knee_motion.js');
  const publication = await coupled.loadCoupledKneePublication({ manifest, caseId, manifestURL, signal,
    fetchBytes: (url, requestSignal) => fetchChecked(url, requestSignal, false) });
  return coupled.createCoupledKneeMotion(model, publication, THREE, checkedOriginalMotionView,
    model.regionalSkinMotion ? disjointRegionalSkinDescriptor(model) : null);
}

async function coupledKneeNativeAvailable(track, caseId, signal) {
  let response, binding;
  const nativeAnatomyTimeoutMs = 60000;
  const timeout = AbortSignal.timeout(nativeAnatomyTimeoutMs);
  try {
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    response = await fetch(new URL(`./api/native/coupled-knee-motion?case_id=${encodeURIComponent(caseId)}`, manifestURL), { signal: requestSignal });
    if (response.ok) binding = await response.json();
  } catch (error) {
    const timedOut = timeout.aborted && ['AbortError', 'TimeoutError'].includes(error?.name);
    if (signal?.aborted || (error?.name === 'AbortError' && !timedOut)) throw error;
    if (timedOut || error instanceof TypeError || error?.name === 'TypeError') return false;
    throw error;
  }
  if (!response.ok) return false;
  // A reachable but conflicting native service must not silently become an offline success.
  return track.verifyNativeBinding(binding);
}

function regionalSkinFalseClaims() {
  return ['whole_body_containment_certified', 'continuous_motion_certified', 'full_surface_containment_certified',
    'anatomical_fit_validated', 'physics_validated', 'clinical_anatomy_validated', 'continuous_motion_containment_certified',
    'continuous_runtime_containment_certified', 'anatomical_solid_validated', 'bone_contact_validated'];
}

function regionalSkinHash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function regionalSkinEqual(a, b) { return canonicalAnatomyPatchJSON(a) === canonicalAnatomyPatchJSON(b); }
function regionalSkinKeys(value, keys) { return lumbarPublicationKeys(value, keys); }

function regionalSkinMotionCaseIds(asset) {
  if (asset === undefined) return [];
  if (!regionalSkinKeys(asset, ['data_url', 'sha256', 'case_ids']) || asset.data_url !== 'regional_skin_motion.json'
      || !regionalSkinHash(asset.sha256) || !Array.isArray(asset.case_ids) || !asset.case_ids.length
      || new Set(asset.case_ids).size !== asset.case_ids.length
      || asset.case_ids.some((id) => typeof id !== 'string' || !/^(teen|adult|elder)_(male|female)_weight(025|050|075)$/.test(id))) throw new Error('Invalid regional skin motion publication registry.');
  return asset.case_ids;
}

async function loadRegionalSkinMotion(caseId, signal) {
  const asset = manifest?.regional_skin_motion_asset, ids = regionalSkinMotionCaseIds(asset);
  if (!ids.includes(caseId)) return null;
  const bytes = await fetchChecked(absoluteURL(asset.data_url, manifestURL), signal, false);
  await verifyHash(bytes, asset.sha256, 'Published regional skin motion');
  const data = parseJSONBuffer(bytes, 'regional skin motion');
  if (!regionalSkinKeys(data, ['schema', 'case_tracks']) || data.schema !== 'atlas_regional_skin_motion_collection_v1'
      || !regionalSkinKeys(data.case_tracks, ids) || Object.entries(data.case_tracks).some(([id, row]) =>
        row?.schema !== 'atlas_regional_skin_motion_v1' || row.case_id !== id)) throw new Error('Regional skin motion collection differs from its registry.');
  return { payload: data.case_tracks[caseId], publication: { case_id: caseId, data_url: asset.data_url,
    sha256: asset.sha256, hash_verified: true } };
}

function regionalStressMotionSource(model, payload, original) {
  const descriptor = payload.source.runtime.stress_motion_source, evidence = model.stressMotions;
  const ids = Object.keys(model.motions).sort(), added = [...(model.stressMotionIds || [])].sort();
  if (!/^elder_(male|female)_weight(025|050|075)$/.test(payload.case_id)
      || !regionalSkinKeys(descriptor, ['schema', 'asset_sha256', 'data_sha256', 'buffer_sha256', 'motion_ids', 'stress_motion_ids'])
      || descriptor.schema !== 'atlas_regional_stress_motion_source_v1' || !evidence
      || ['asset_sha256', 'data_sha256', 'buffer_sha256'].some((key) => !regionalSkinHash(descriptor[key]) || descriptor[key] !== evidence[key])
      || !regionalSkinEqual(Object.keys(original.motions), ['neutral']) || !added.length
      || !regionalSkinEqual(descriptor.motion_ids, ids) || !regionalSkinEqual(descriptor.stress_motion_ids, added)
      || !regionalSkinEqual(ids.filter((id) => !added.includes(id)), ['neutral'])
      || added.some((id) => model.motions[id].stressTest !== true)) throw new Error('Regional source-bound stress motion domain differs.');
  return descriptor;
}

async function regionalStressDisabledRuntime(model, descriptor) {
  const arrays = anatomyRefinementArrays(model), count = arrays.skin_positions.length / 3;
  let floor = Infinity;
  for (let index = 2; index < arrays.skin_positions.length; index += 3) floor = Math.min(floor, arrays.skin_positions[index]);
  const footIds = ['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase'].map((name) => model.sourceRig.names.indexOf(name));
  const seeds = new Uint8Array(count), width = arrays.skin_indices.length / count;
  if (footIds.every((id) => id >= 0)) for (let vertex = 0; vertex < count; vertex += 1) {
    let weight = 0;
    for (let slot = 0; slot < width; slot += 1) {
      const index = vertex * width + slot;
      if (footIds.includes(arrays.skin_indices[index])) weight += arrays.skin_weights[index];
    }
    seeds[vertex] = Number(weight > 1e-8);
  }
  const selected = seeds.slice(), faces = arrays.skin_faces;
  let faceCount = 0;
  for (let offset = 0; offset < faces.length; offset += 3) {
    if (!seeds[faces[offset]] && !seeds[faces[offset + 1]] && !seeds[faces[offset + 2]]) continue;
    faceCount += 1;
    for (let corner = 0; corner < 3; corner += 1) selected[faces[offset + corner]] = 1;
  }
  const disabled = {
    motion_adjustments: { enabled: false, reason: 'No CMU floor correction for this provider or recorded-source contract', times: [], offsets_m: [] },
    terminal_corrections: { enabled: false, reason: 'No CMU terminal correction for this provider or unmeasured-channel contract', controls: [] },
  };
  // Elder neutral-only loading skips the native runtime request, including offline playback.
  // Reconstruct the two disabled source builders instead of trusting the incoming declaration.
  const clips = (name) => Object.fromEntries(descriptor.motion_ids.map((id) => [id, { ...disabled[name] }]));
  return {
    motion_adjustments: {
      schema: 'atlas_recorded_floor_adjustment_v1', floor_z_m: floor, maximum_offset_m: .05,
      clearance_m: .0005, clips: clips('motion_adjustments'), source_arrays_modified: false,
      adjustment: 'One nonnegative common world-Z translation after local forward kinematics',
      interpolation: 'Linear in time between offset knots; source cadence and joint rotations unchanged',
      relative_joint_transforms_preserved: true, skin_anatomy_relationship_preserved: true,
      horizontal_motion_unchanged: true, stair_geometry_reconstructed: false,
      foot_locking_performed: false, physics_validated: false, continuous_contact_certified: false,
      training_interpolation_reserve_m: .0001,
      foot_weight_seed_vertex_count: seeds.reduce((sum, value) => sum + value, 0),
      foot_surface_selection: 'All vertices incident to any triangle with positive (>1e-8 summed) authored Foot/ToeBase weight',
      complete_incident_foot_triangle_count: faceCount,
      foot_surface_vertex_count: selected.reduce((sum, value) => sum + value, 0),
    },
    terminal_corrections: {
      schema: 'atlas_unmeasured_terminal_bind_v1', clips: clips('terminal_corrections'),
      source_rig_sha256: await neutralSkinArrayHash(anatomyMetadataBytes(model.sourceRig)),
      source_bind_frames: { dtype: model.sourceBindFrames instanceof Float32Array ? 'float32' : 'float64',
        shape: [model.jointCount, 4, 4], sha256: await neutralSkinArrayHash(model.sourceBindFrames) },
      quaternion_order: 'xyzw', operation: 'Replace declared terminal local rotations before forward kinematics',
      local_translations_unchanged: true, joint_origins_unchanged: true,
      measured_control_rotations_unchanged: true, source_arrays_modified: false,
      recorded_finger_motion_recovered: false, source_cadence_unchanged: true,
      affected_geometry: 'Only skin vertices and anatomical meshes influenced by the four terminal controls',
      prior_pose_containment_evidence_inherited: false, containment_validated: false,
      anatomical_fit_validated: false, physics_validated: false,
    },
  };
}

async function validateRegionalStressRuntime(model, runtime, descriptor) {
  const expected = await regionalStressDisabledRuntime(model, descriptor);
  for (const [name, field] of [['terminal_corrections', 'terminalCorrectionsPayload'], ['motion_adjustments', 'motionAdjustmentsPayload']]) {
    const full = runtime[name], prior = model[field];
    const neutral = { ...expected[name], clips: { neutral: expected[name].clips.neutral } };
    if (!regionalSkinEqual(full, expected[name]) || (Object.hasOwn(model, field)
        && !regionalSkinEqual(prior, neutral) && !regionalSkinEqual(prior, expected[name]))) throw new Error('Regional stress playback runtime differs from the preserved neutral source.');
  }
  for (const id of descriptor.motion_ids) {
    if (model.motionAdjustments?.[id]?.enabled === true || model.terminalCorrections?.clips?.[id]?.enabled === true
        || model.terminalCorrections?.clips?.[id]?.controls?.length) throw new Error('Regional stress playback enables an unqualified runtime correction.');
  }
}

async function validateRegionalSkinSource(model, payload) {
  const original = await checkedOriginalMotionView(model);
  const stress = Object.hasOwn(payload.source?.runtime || {}, 'stress_motion_source');
  const descriptor = stress ? regionalStressMotionSource(model, payload, original) : null;
  if (!stress) model = original;
  const source = payload.source, arrays = anatomyRefinementArrays(model), meshes = teenRegionalTopology(model);
  if (!regionalSkinKeys(source, ['case_id', 'arrays', 'rig', 'bone_meshes', 'motions', 'runtime'])
      || source.case_id !== payload.case_id || !regionalSkinKeys(source.arrays, Object.keys(arrays))
      || !regionalSkinEqual(source.rig, model.sourceRig) || !regionalSkinEqual(source.bone_meshes, meshes)
      || !regionalSkinKeys(source.motions, Object.keys(model.motions))) throw new Error('Regional motion predecessor structure differs.');
  for (const [name, array] of Object.entries(arrays)) await verifyRefinementArray(array, source.arrays[name], model.sourceArrayShapes[name], `regional source ${name}`);
  await verifyRefinementArray(renderedAnatomyPositions(model), source.arrays.bone_positions, model.sourceArrayShapes.bone_positions, 'Regional rendered source anatomy');
  for (const [clip, motion] of Object.entries(model.motions)) {
    const expected = source.motions[clip];
    if (!expected || !motion.sourceMetadata || !regionalSkinKeys(expected.transforms, ['array'])) throw new Error('Complete regional recording metadata is missing.');
    await verifyMotionSourceArray(motion.sourceTransforms, expected.transforms.array, [motion.times.length, model.jointCount, 4, 4], 'Regional recorded transforms');
    const actual = { ...motion.sourceMetadata }, declared = { ...expected };
    delete actual.transforms; delete declared.transforms;
    if (regionalSkinKeys(expected.times, ['array'])) {
      await verifyMotionSourceArray(motion.times, expected.times.array, [motion.times.length], 'Regional source times');
      actual.times = expected.times;
    } else actual.times = Array.from(motion.times);
    if (!regionalSkinEqual(actual, declared)) throw new Error('Regional recording metadata or timing differs.');
  }
  const runtime = source.runtime;
  if (!regionalSkinKeys(runtime, ['motion_adjustments', 'terminal_corrections', 'derived_motion_assets', 'neutral_skin_asset_sha256', ...(stress ? ['stress_motion_source'] : [])])
      || !regionalSkinKeys(runtime.derived_motion_assets, ['patella_motion_asset', 'lumbar_motion_asset'])) throw new Error('Regional runtime bindings are incomplete.');
  for (const [name, field] of [['patella_motion_asset', 'patellaMotion'], ['lumbar_motion_asset', 'lumbarMotion']]) {
    if (runtime.derived_motion_assets[name] !== (model[field]?.asset_sha256 ?? null)) throw new Error('Regional predecessor bone-motion layer differs.');
  }
  const neutral = model.teenNeutralSkinRefinement?.verified_manifest_asset?.sha256 ?? null;
  if (runtime.neutral_skin_asset_sha256 !== neutral || (payload.case_id.startsWith('teen_') && !regionalSkinHash(neutral))
      || (/^(adult|elder)_/.test(payload.case_id) && neutral !== null)) throw new Error('Regional neutral overlay binding differs.');
  if (stress) await validateRegionalStressRuntime(model, runtime, descriptor);
  else for (const [name, field] of [['terminal_corrections', 'terminalCorrectionsPayload'], ['motion_adjustments', 'motionAdjustmentsPayload']]) {
    if (Object.hasOwn(model, field) && !regionalSkinEqual(model[field], runtime[name])) throw new Error('Regional active playback runtime differs.');
  }
  const terminal = await validateTerminalCorrections(runtime.terminal_corrections, model);
  const floor = await validateMotionAdjustments(runtime.motion_adjustments, model.motions);
  return { arrays, meshes, terminal, floor };
}

async function decodeRegionalSkinArray(entry, dtype, shape) {
  if (!regionalSkinKeys(entry, ['dtype', 'shape', 'sha256', 'values']) || entry.dtype !== dtype
      || !regionalSkinEqual(entry.shape, shape) || !regionalSkinHash(entry.sha256) || !Array.isArray(entry.values)
      || entry.values.length !== shape.reduce((a, b) => a * b, 1)
      || entry.values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid regional trajectory array.');
  const array = dtype === 'float64' ? Float64Array.from(entry.values) : Float32Array.from(entry.values);
  if (array.some((value) => !Number.isFinite(value))) throw new Error('Nonfinite regional trajectory array.');
  await verifyHash(new Uint8Array(array.buffer), entry.sha256, 'Regional trajectory array');
  return array;
}

function regionalSkinSchedule(model, clips) {
  const result = [];
  for (const name of [...clips].sort()) {
    const times = model.motions[name]?.times;
    if (name === 'neutral' || !times || times.length < 2 || times.some((value, index) => !Number.isFinite(value)
        || (index && value <= times[index - 1]))) throw new Error('Regional correction requires complete moving timelines.');
    for (let index = 0; index < times.length; index += 1) {
      result.push({ clip: name, time_s: times[index] });
      if (index + 1 < times.length) {
        const midpoint = times[index] * .5 + times[index + 1] * .5;
        if (!(midpoint > times[index] && midpoint < times[index + 1])) throw new Error('Regional source midpoint is not representable.');
        result.push({ clip: name, time_s: midpoint });
      }
    }
  }
  return result;
}

function regionalSkinCorrectedRest(model, track, clip, time) {
  const domain = model.motions[clip]?.times;
  if (typeof time !== 'number' || !Number.isFinite(time) || !domain || time < domain[0] || time > domain.at(-1)) throw new Error('Regional skin seek is outside its original timeline.');
  const data = track.clips[clip];
  if (!data) return null;
  let lo = 0, hi = data.times.length - 1;
  while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); if (data.times[mid] <= time) lo = mid; else hi = mid - 1; }
  hi = Math.min(lo + 1, data.times.length - 1);
  const alpha = lo === hi ? 0 : (time - data.times[lo]) / (data.times[hi] - data.times[lo]);
  const stride = track.ids.length * 3, result = model.skinRest.slice();
  for (let index = 0; index < track.ids.length; index += 1) {
    const delta = [], delivered = [], vertex = track.ids[index];
    for (let axis = 0; axis < 3; axis += 1) {
      const j = index * 3 + axis, offset = Math.fround(data.offsets[lo * stride + j] * (1 - alpha) + data.offsets[hi * stride + j] * alpha);
      result[vertex * 3 + axis] = model.skinRest[vertex * 3 + axis] + offset;
      delta.push(offset); delivered.push(result[vertex * 3 + axis] - model.skinRest[vertex * 3 + axis]);
    }
    if (Math.hypot(...delta) > track.bound || Math.hypot(...delivered) > track.bound) throw new Error('Serialized regional rest displacement exceeds its bound.');
  }
  return result;
}

function regionalSkinInventory(model, meshes) {
  const faces = model.sourceTopology.bone_faces, sampling = {};
  for (const mesh of meshes) {
    const vertices = new Set(), edges = new Set();
    for (let offset = mesh.index_start; offset < mesh.index_start + mesh.index_count; offset += 3) {
      const triangle = faces.subarray(offset, offset + 3);
      triangle.forEach((id) => vertices.add(id));
      for (let corner = 0; corner < 3; corner += 1) { const a = triangle[corner], b = triangle[(corner + 1) % 3]; edges.add(`${Math.min(a, b)},${Math.max(a, b)}`); }
    }
    sampling[mesh.name] = { referenced_vertex_count: vertices.size, unique_edge_count: edges.size,
      triangle_count: mesh.index_count / 3, sample_count: vertices.size + edges.size + mesh.index_count / 3 };
  }
  const surface = { skin_vertex_count: model.skinRest.length / 3, skin_triangle_count: model.sourceTopology.skin_faces.length / 3,
    bone_vertex_count: model.boneRest.length / 3, bone_triangle_count: faces.length / 3,
    bone_meshes: [...meshes].sort((a, b) => a.vertex_start - b.vertex_start).map(({ name, vertex_start, vertex_count, index_start, index_count }) =>
      ({ name, vertex_start, vertex_count, index_start, index_count })) };
  return { sampling, surface };
}

function regionalSkinNativeIdentity(value, count) {
  return regionalSkinKeys(value, ['dtype', 'shape', 'sha256']) && value.dtype === 'float32'
    && regionalSkinEqual(value.shape, [count, 3]) && regionalSkinHash(value.sha256);
}

function validateRegionalSkinQuality(quality, bound) {
  validateTeenNeutralSkinQuality(quality, bound);
  if (quality.minimum_edge_length_ratio > quality.maximum_edge_length_ratio
      || quality.minimum_area_ratio > quality.maximum_area_ratio) throw new Error('Regional skin quality ranges are inconsistent.');
}

async function validateRegionalSkinQualification(model, payload, track, meshes) {
  const evidence = payload.qualification, flags = regionalSkinFalseClaims(), schedule = regionalSkinSchedule(model, Object.keys(track.clips));
  const keys = ['schema', 'case_id', 'source_sha256', 'trajectory_sha256', 'scope', 'sampling', 'accepted', 'neutral_unchanged',
    'bone_geometry_weights_faces_rig_ownership_unchanged', 'report_sha256', 'method_source_sha256', 'surface_inventory', 'sampling_inventory', 'target_mesh_names', 'poses', ...flags];
  const perClip = evidence?.schema === 'atlas_regional_skin_motion_qualification_v2';
  if (perClip) keys.push('target_mesh_names_by_clip');
  const methods = evidence?.method_source_sha256;
  if (!regionalSkinKeys(evidence, keys) || (!perClip && evidence.schema !== 'atlas_regional_skin_motion_qualification_v1')
      || evidence.case_id !== payload.case_id || evidence.source_sha256 !== payload.source_sha256
      || evidence.trajectory_sha256 !== payload.trajectory_sha256 || evidence.scope !== 'source_frames_and_midpoints_only'
      || evidence.sampling !== 'referenced_vertices_unique_edge_midpoints_triangle_centroids' || evidence.accepted !== true
      || evidence.neutral_unchanged !== true || evidence.bone_geometry_weights_faces_rig_ownership_unchanged !== true
      || flags.some((key) => evidence[key] !== false) || !regionalSkinHash(evidence.report_sha256)
      || !methods || typeof methods !== 'object' || Array.isArray(methods) || !Object.keys(methods).length
      || Object.entries(methods).some(([key, value]) => !key || !regionalSkinHash(value))) throw new Error('Invalid finite-only regional motion qualification.');
  const inventory = regionalSkinInventory(model, meshes), targets = evidence.target_mesh_names;
  if (!regionalSkinEqual(inventory.surface, evidence.surface_inventory) || !regionalSkinEqual(inventory.sampling, evidence.sampling_inventory)
      || !Array.isArray(targets) || !targets.length || targets.some((name) => !Object.hasOwn(inventory.sampling, name))
      || !regionalSkinEqual(targets, [...new Set(targets)].sort()) || !Array.isArray(evidence.poses) || evidence.poses.length !== schedule.length) throw new Error('Regional surface, sampling or pose inventory differs.');
  const targetsByClip = perClip ? evidence.target_mesh_names_by_clip
    : Object.fromEntries(Object.keys(track.clips).map((clip) => [clip, targets]));
  if (!regionalSkinKeys(targetsByClip, Object.keys(track.clips))
      || Object.values(targetsByClip).some((names) => !Array.isArray(names) || !names.length
        || names.some((name) => typeof name !== 'string' || !Object.hasOwn(inventory.sampling, name))
        || !regionalSkinEqual(names, [...new Set(names)].sort()))
      || !regionalSkinEqual(targets, [...new Set(Object.values(targetsByClip).flat())].sort())) throw new Error('Regional per-clip target scope differs.');
  const localFaces = {};
  for (const mesh of meshes.filter((row) => targets.includes(row.name))) {
    const values = model.sourceTopology.bone_faces.slice(mesh.index_start, mesh.index_start + mesh.index_count);
    for (let index = 0; index < values.length; index += 1) values[index] -= mesh.vertex_start;
    localFaces[mesh.name] = { dtype: values instanceof Uint32Array ? 'uint32' : 'uint16', shape: [mesh.index_count / 3, 3], sha256: await neutralSkinArrayHash(values) };
  }
  const zero = ['new_known_exterior_count', 'worsened_known_exterior_count', 'unknown_to_known_exterior_count', 'unresolved_new_unknown_count'];
  for (let index = 0; index < schedule.length; index += 1) {
    const pose = schedule[index], row = evidence.poses[index], poseTargets = targetsByClip[pose.clip];
    if (!row || row.clip !== pose.clip || row.time_s !== pose.time_s || !regionalSkinHash(row.report_sha256)
        || row.all_bones_byte_identical !== true || row.fixed_skin_vertices_byte_identical !== true
        || !regionalSkinKeys(row.meshes, Object.keys(inventory.sampling)) || !regionalSkinKeys(row.original_triangle_proofs, poseTargets)) throw new Error('Regional qualified pose is missing, duplicated or incomplete.');
    for (const native of [row.native_before, row.native_after]) {
      if (!regionalSkinKeys(native, ['skin', 'anatomy']) || !regionalSkinNativeIdentity(native.skin, model.skinRest.length / 3)
          || !regionalSkinNativeIdentity(native.anatomy, model.boneRest.length / 3)) throw new Error('Regional native geometry identities are incomplete.');
    }
    if (!regionalSkinEqual(row.native_before.anatomy, row.native_after.anatomy)) throw new Error('Regional correction changes original bones.');
    const rest = regionalSkinCorrectedRest(model, track, pose.clip, pose.time_s);
    await verifyRefinementArray(rest, row.rest_positions, model.sourceArrayShapes.skin_positions, 'Regional qualified rest geometry');
    validateRegionalSkinQuality(row.rest_skin_quality, track.bound);
    validateRegionalSkinQuality(row.native_skin_quality, .012);
    const contact = row.skin_self_contacts;
    if (!contact || contact.full_original_skin_triangle_audit !== true || contact.triangle_index_space !== 'original_skin_faces'
        || ['before_count', 'after_count', 'new_count'].some((key) => !Number.isSafeInteger(contact[key]) || contact[key] < 0)
        || contact.new_count !== 0 || contact.after_count > contact.before_count || !regionalSkinHash(contact.before_pairs_sha256)
        || !regionalSkinHash(contact.after_pairs_sha256) || (contact.after_count === contact.before_count
          && contact.before_pairs_sha256 !== contact.after_pairs_sha256)) throw new Error('Regional skin contact evidence regresses.');
    for (const mesh of meshes) {
      const value = row.meshes[mesh.name], count = inventory.sampling[mesh.name].sample_count, proof = row.original_triangle_proofs[mesh.name];
      if (!value || value.sample_count !== count || [...zero, 'new_unknown_count', 'before_exterior_count', 'after_exterior_count', 'before_unknown_count', 'after_unknown_count']
          .some((key) => !Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > count)
          || zero.some((key) => value[key] !== 0) || value.before_exterior_count + value.before_unknown_count > count
          || value.after_exterior_count + value.after_unknown_count > count || value.after_exterior_count > value.before_exterior_count
          || value.new_unknown_count > value.after_unknown_count || (value.new_unknown_count > 0 && !proof)
          || value.after_unknown_count > value.before_unknown_count + value.new_unknown_count) throw new Error('Regional original-mesh diagnostics regress.');
      if (proof && (!regionalSkinHash(proof.report_sha256) || proof.mathematical_surface_containment_under_original_parity_proved !== true
          || proof.all_original_triangles_checked !== true || ['exterior_count', 'unknown_count', 'untested_required_pair_count'].some((key) => proof[key] !== 0)
          || typeof proof.clearance_m !== 'number' || !Number.isFinite(proof.clearance_m) || proof.clearance_m < 0 || proof.clearance_m > .001
          || !regionalSkinNativeIdentity(proof.bone_vertices, mesh.vertex_count) || value.after_exterior_count !== 0
          || !regionalSkinEqual(proof.native_bone_array, row.native_after.anatomy) || !regionalSkinEqual(proof.skin_vertices, row.native_after.skin)
          || !regionalSkinEqual(proof.bone_faces, localFaces[mesh.name]) || !regionalSkinEqual(proof.skin_faces, payload.source.arrays.skin_faces))) throw new Error('Regional exact target proof differs from original native surfaces.');
    }
  }
  track.schedule = schedule;
}

const verifiedRegionalSkinTracks = new WeakMap();

async function applyRegionalSkinMotion(model, payload, caseId, publication) {
  const keys = ['schema', 'case_id', 'source', 'source_sha256', 'vertex_ids', 'clips', 'unchanged_clips', 'neutral_policy',
    'maximum_rest_displacement_m', 'interpolation_model', 'offset_arithmetic', 'trajectory_sha256', 'qualification', 'qualification_sha256'];
  if (!/^(teen|adult|elder)_(male|female)_weight(025|050|075)$/.test(caseId) || model.regionalSkinMotion || model.coupledKneeMotion || model.adultNeutralSkinRefinement
      || !regionalSkinKeys(payload, keys) || payload.schema !== 'atlas_regional_skin_motion_v1' || payload.case_id !== caseId
      || publication?.hash_verified !== true || publication.case_id !== caseId || !regionalSkinHash(publication.sha256)
      || publication.data_url !== 'regional_skin_motion.json' || !regionalSkinHash(payload.source_sha256)
      || !regionalSkinHash(payload.trajectory_sha256) || !regionalSkinHash(payload.qualification_sha256)
      || payload.interpolation_model !== 'rest_offsets_linear_then_authored_skinning'
      || payload.offset_arithmetic !== 'float64_linear_cast_float32_then_float64_add_cast_float32'
      || payload.neutral_policy !== 'preserve_existing_neutral_overlay') throw new Error('Invalid regional skin motion layer.');
  const source = await validateRegionalSkinSource(model, payload), bound = payload.maximum_rest_displacement_m;
  if (typeof bound !== 'number' || !Number.isFinite(bound) || !(bound > 0 && bound <= .02)
      || !teenRegionalIds(payload.vertex_ids, model.skinRest.length / 3) || !payload.clips || typeof payload.clips !== 'object'
      || Array.isArray(payload.clips) || !Object.keys(payload.clips).length) throw new Error('Regional motion support or displacement bound differs.');
  const clips = Object.keys(payload.clips).sort(), unchanged = Object.keys(model.motions).filter((name) => name !== 'neutral' && !clips.includes(name)).sort();
  if (!regionalSkinEqual(payload.unchanged_clips, unchanged) || clips.some((name) => name === 'neutral' || !Object.hasOwn(model.motions, name))) throw new Error('Regional unchanged clip inventory differs.');
  const track = { ids: payload.vertex_ids.slice(), clips: {}, bound, source: structuredClone(payload.source), payload: structuredClone(payload), publication: structuredClone(publication), cache: null };
  for (const name of clips) {
    const row = payload.clips[name], count = row?.times?.shape?.[0];
    if (!regionalSkinKeys(row, ['times', 'offsets']) || !Number.isSafeInteger(count) || count < 2) throw new Error('Invalid regional motion knot inventory.');
    const times = await decodeRegionalSkinArray(row.times, 'float64', [count]);
    const offsets = await decodeRegionalSkinArray(row.offsets, 'float32', [count, track.ids.length, 3]);
    const original = model.motions[name].times;
    if (times[0] !== original[0] || times.at(-1) !== original.at(-1) || times.some((time, index) => index && time <= times[index - 1])) throw new Error('Regional trajectory does not cover its complete source domain.');
    track.clips[name] = { times, offsets };
    for (const time of times) validateRegionalSkinQuality(measuredTeenNeutralSkinQuality(model.skinRest,
      regionalSkinCorrectedRest(model, track, name, time), model.sourceTopology.skin_faces), bound);
  }
  await validateRegionalSkinQualification(model, payload, track, source.meshes);
  // This guards the owned JS copy against mutation; it is not a Python metadata digest.
  track.payloadIntegrity = await neutralSkinArrayHash(new TextEncoder().encode(canonicalAnatomyPatchJSON(track.payload)));
  const mutable = new Set(track.ids), edges = new Map(), faces = model.sourceTopology.skin_faces;
  for (let offset = 0; offset < faces.length; offset += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = faces[offset + corner], b = faces[offset + (corner + 1) % 3];
      if (mutable.has(a) || mutable.has(b)) edges.set(`${Math.min(a, b)},${Math.max(a, b)}`, [a, b]);
    }
  }
  track.edges = Array.from(edges.values(), ([a, b]) => [a, b, Math.hypot(...[0, 1, 2].map((axis) => model.skinRest[a * 3 + axis] - model.skinRest[b * 3 + axis]))]);
  // The verified outer publication authenticates Python metadata hashes; no JS numeric formatter is substituted.
  track.binding = { schema: payload.schema, case_id: caseId, source_sha256: payload.source_sha256,
    trajectory_sha256: payload.trajectory_sha256, qualification_sha256: payload.qualification_sha256,
    corrected_clips: clips, unchanged_clips: unchanged, neutral_unchanged: true, qualified_poses: track.schedule,
    runtime_accepted: true, ...Object.fromEntries(regionalSkinFalseClaims().map((key) => [key, false])) };
  if (payload.qualification.schema === 'atlas_regional_skin_motion_qualification_v2') {
    track.binding.target_mesh_names_by_clip = structuredClone(payload.qualification.target_mesh_names_by_clip);
  }
  if (Object.hasOwn(payload.source.runtime, 'stress_motion_source')) {
    track.binding.motion_domain = 'source_bound_stress';
    track.binding.stress_motion_source = structuredClone(payload.source.runtime.stress_motion_source);
  }
  if (!Object.hasOwn(model, 'terminalCorrectionsPayload')) { model.terminalCorrectionsPayload = structuredClone(payload.source.runtime.terminal_corrections); model.terminalCorrections = source.terminal; }
  if (!Object.hasOwn(model, 'motionAdjustmentsPayload')) { model.motionAdjustmentsPayload = structuredClone(payload.source.runtime.motion_adjustments); model.motionAdjustments = source.floor; }
  verifiedRegionalSkinTracks.set(track, { binding: canonicalAnatomyPatchJSON(track.binding),
    publication: canonicalAnatomyPatchJSON(track.publication), payloadIntegrity: track.payloadIntegrity,
    clips: Object.freeze(clips.slice()) });
  model.regionalSkinMotion = track;
  return true;
}

function disjointRegionalSkinDescriptor(model) {
  const track = model.regionalSkinMotion, verified = verifiedRegionalSkinTracks.get(track);
  if (!verified || track.binding.case_id !== 'teen_female_weight050'
      || verified.clips.some((clip) => clip === 'neutral' || clip === 'kick_steps' || model.stressMotionIds?.has(clip))) throw new Error('A validated disjoint regional track is required.');
  const source = track.binding.source_sha256, trajectory = track.binding.trajectory_sha256;
  const qualification = track.binding.qualification_sha256, publication = track.publication.sha256;
  const verifySource = async (sourceModel) => {
    if (model.regionalSkinMotion !== track || sourceModel.regionalSkinMotion !== track
        || verifiedRegionalSkinTracks.get(track) !== verified
        || canonicalAnatomyPatchJSON(track.binding) !== verified.binding
        || canonicalAnatomyPatchJSON(track.publication) !== verified.publication
        || track.payloadIntegrity !== verified.payloadIntegrity
        || !regionalSkinEqual(Object.keys(track.clips).sort(), verified.clips)
        || !regionalSkinEqual(track.binding.corrected_clips, verified.clips)) throw new Error('Validated disjoint regional identity changed.');
    // Verify the actual inventory; the coupled caller may already hold its checked original-motion view.
    await verifyRegionalSkinTrackSource(model);
    return true;
  };
  return Object.freeze({ track, case_id: track.binding.case_id, clips: verified.clips,
    source_sha256: source, trajectory_sha256: trajectory, qualification_sha256: qualification,
    publication_sha256: publication, verifySource,
    async verifyRendered(clip, absoluteTime) {
      if (!verified.clips.includes(clip) || state.motionId !== clip
          || absoluteTime !== state.time + model.motions[clip].times[0]) throw new Error('Disjoint regional rendered pose differs.');
      await verifySource(model);
      return verifyRenderedRegionalSkinMotion(model);
    } });
}

function regionalSkinRestForPose(model, clip, time, fresh = false) {
  const track = model.regionalSkinMotion;
  if (!fresh && track.cache?.clip === clip && track.cache.time === time) return track.cache;
  const positions = regionalSkinCorrectedRest(model, track, clip, time);
  if (positions === null) return { positions: model.skinRest, normals: model.normalRest };
  for (const [a, b, length] of track.edges) {
    const delta = [0, 1, 2].map((axis) => (positions[a * 3 + axis] - model.skinRest[a * 3 + axis])
      - (positions[b * 3 + axis] - model.skinRest[b * 3 + axis]));
    const change = Math.hypot(...delta);
    if ((length === 0 && change !== 0) || (length > 0 && change / length > .25)) throw new Error('Active regional edge displacement exceeds its finite graphics limit.');
  }
  const geometry = model.skin.geometry.clone();
  let normals;
  try { geometry.getAttribute('position').array.set(positions); geometry.computeVertexNormals(); normals = geometry.getAttribute('normal').array.slice(); }
  finally { geometry.dispose(); }
  if (normals.some((value) => !Number.isFinite(value))) throw new Error('Regional rest normals are nonfinite.');
  const result = { clip, time, positions, normals };
  if (!fresh) track.cache = result;
  return result;
}

async function regionalSkinNativeAvailable(track, caseId, signal) {
  let binding;
  try {
    const response = await fetch(new URL(`./api/native/regional-skin-motion?case_id=${encodeURIComponent(caseId)}`, manifestURL), { signal });
    if (!response.ok) return false;
    binding = await response.json();
  } catch (error) { if (signal?.aborted || error?.name === 'AbortError') throw error; return false; }
  if (!binding || binding.runtime_accepted !== true) return false;
  if (Object.keys(track.binding).some((key) => !regionalSkinEqual(binding[key], track.binding[key]))) throw new Error('Native regional skin binding conflicts with the published trajectory.');
  return true;
}

async function verifyRegionalSkinTrackSource(model) {
  const track = model.regionalSkinMotion;
  if (track.payloadIntegrity !== await neutralSkinArrayHash(new TextEncoder().encode(canonicalAnatomyPatchJSON(track.payload)))
      || !regionalSkinEqual(track.ids, track.payload.vertex_ids) || track.bound !== track.payload.maximum_rest_displacement_m
      || !regionalSkinKeys(track.clips, Object.keys(track.payload.clips))) throw new Error('Owned regional trajectory metadata changed.');
  for (const [clip, data] of Object.entries(track.clips)) {
    await verifyMotionSourceArray(data.times, track.payload.clips[clip].times, [data.times.length], 'Active regional knot times');
    await verifyMotionSourceArray(data.offsets, track.payload.clips[clip].offsets, [data.times.length, track.ids.length, 3], 'Active regional offsets');
  }
  await validateRegionalSkinSource(model, track.payload);
}

async function verifyRenderedRegionalSkinMotion(model) {
  const track = model.regionalSkinMotion;
  await verifyRegionalSkinTrackSource(model);
  if (!track.clips[state.motionId]) return { active: false, neutral_unchanged: true };
  const stamp = state.time + model.motions[state.motionId].times[0];
  const expected = regionalSkinRestForPose(model, state.motionId, stamp, true), active = skinRestForPose(model, state.motionId, state.time);
  if (await neutralSkinArrayHash(expected.positions) !== await neutralSkinArrayHash(active.positions)
      || await neutralSkinArrayHash(expected.normals) !== await neutralSkinArrayHash(active.normals)) throw new Error('Active regional rest positions or normals changed.');
  const qualified = track.payload.qualification.poses.find((row) => row.clip === state.motionId && row.time_s === stamp);
  if (qualified) await verifyRefinementArray(expected.positions, qualified.rest_positions, model.sourceArrayShapes.skin_positions, 'Active qualified regional rest positions');
  const posed = regionalSkinPosedArrays(model, expected);
  if (model.skin.geometry.getAttribute('position').array !== model.skinPositions
      || await neutralSkinArrayHash(posed.positions) !== await neutralSkinArrayHash(model.skinPositions)
      || await neutralSkinArrayHash(posed.normals) !== await neutralSkinArrayHash(model.skin.geometry.getAttribute('normal').array)) throw new Error('Rendered regional skin coordinates or normals differ from the active trajectory.');
  return { active: true, saved_pose_qualified: Boolean(qualified), binding: structuredClone(track.binding), full_surface_containment_certified: false };
}

function regionalSkinPosedArrays(model, rest) {
  const positions = new Float32Array(rest.positions.length), normals = new Float32Array(rest.normals.length);
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const offset = vertex * 3, x = rest.positions[offset], y = rest.positions[offset + 1], z = rest.positions[offset + 2];
    const nx = rest.normals[offset], ny = rest.normals[offset + 1], nz = rest.normals[offset + 2];
    let px = 0, py = 0, pz = 0, normalX = 0, normalY = 0, normalZ = 0;
    for (let influence = 0; influence < 8; influence += 1) {
      const id = vertex * 8 + influence, weight = model.skinWeights[id];
      if (weight === 0) continue;
      const e = model.deltas[model.skinIndices[id]].elements;
      px += weight * (e[0] * x + e[4] * y + e[8] * z + e[12]);
      py += weight * (e[1] * x + e[5] * y + e[9] * z + e[13]);
      pz += weight * (e[2] * x + e[6] * y + e[10] * z + e[14]);
      normalX += weight * (e[0] * nx + e[4] * ny + e[8] * nz);
      normalY += weight * (e[1] * nx + e[5] * ny + e[9] * nz);
      normalZ += weight * (e[2] * nx + e[6] * ny + e[10] * nz);
    }
    positions.set([px, py, pz], offset);
    const length = Math.hypot(normalX, normalY, normalZ) || 1;
    normals.set([normalX / length, normalY / length, normalZ / length], offset);
  }
  return { positions, normals };
}

function updateAnatomyRefinementStatus() {
  const post = postPriorRegionalRefinement(activeModel);
  const applied = activeModel?.adultNeutralSkinRefinement?.applied === true || activeModel?.teenNeutralSkinRefinement?.applied === true || activeModel?.infantNeutralSkinRefinement?.applied === true || post?.applied === true || activeModel?.anatomyRefinement?.applied === true || activeModel?.anatomyRefinement?.supplemental?.applied === true;
  if (applied) {
    ui['report-link'].title = 'Published source case report; it does not describe the runtime regional correction.';
  } else {
    ui['report-link'].removeAttribute('title');
  }
}

function containmentAPIURL(path) {
  const url = absoluteURL(path, manifestURL), directory = new URL('./api/containment/', manifestURL);
  if (url.origin !== directory.origin || !url.pathname.startsWith(directory.pathname) || url.search || url.hash) throw new Error('Invalid containment service URL.');
  return url;
}

async function containmentRequest(path, options = {}) {
  const response = await fetch(containmentAPIURL(path), options);
  const value = await response.json().catch(() => { throw new Error('The containment service returned an invalid response.'); });
  if (!response.ok) throw new Error(value.error || `Containment request failed (${response.status}).`);
  return value;
}

function validateContainmentResult(result, model, caseId) {
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const clearance = (value) => value === null || Number.isFinite(value);
  if (!result || result.schema !== 'atlas_containment_result_v1' || (caseId !== undefined && result.case_id !== caseId)
      || !['violations', 'inconclusive', 'sampled_clear'].includes(result.verdict)
      || !['violation_count', 'exterior_count', 'unknown_count', 'checked_pose_count', 'checked_bone_count', 'sample_count'].every((key) => count(result[key]))
      || result.checked_pose_count < 1 || result.checked_bone_count < 1 || result.checked_bone_count > model.bones.length || result.sample_count < 1
      || !clearance(result.min_clearance_m) || !Number.isFinite(result.clearance_m) || result.clearance_m < 0
      || typeof result.method !== 'string' || !result.method || typeof result.scope !== 'string' || !result.scope
      || result.continuous_containment_certified !== false || result.anatomical_fit_validated !== false
      || result.raw_triangle_intersection_count !== null || !Array.isArray(result.pose_results)
      || result.pose_results.length !== result.checked_pose_count
      || !Array.isArray(result.regional_results) || result.regional_results.length !== result.checked_bone_count) throw new Error('Invalid containment result or certification scope.');
  if (result.exterior_count > result.violation_count || result.violation_count + result.unknown_count > result.sample_count
      || (result.verdict === 'violations') !== (result.violation_count > 0)
      || (result.verdict === 'sampled_clear' && (result.unknown_count > 0 || !Number.isFinite(result.min_clearance_m)
        || result.min_clearance_m < result.clearance_m || result.checked_bone_count !== model.bones.length || result.native_browser_coordinate_parity_pass !== true))
      || (result.verdict === 'inconclusive' && result.unknown_count === 0 && result.checked_bone_count === model.bones.length && result.native_browser_coordinate_parity_pass === true)) throw new Error('Containment verdict is inconsistent with the checked samples.');
  const names = new Set(model.bones.map(({ spec }) => spec.name)), seen = new Set();
  for (const region of result.regional_results) {
    if (!region || !names.has(region.name) || seen.has(region.name)
        || !['violation_count', 'exterior_count', 'unknown_count'].every((key) => count(region[key]))
        || region.exterior_count > region.violation_count || !clearance(region.min_clearance_m)) throw new Error('Invalid containment mesh result.');
    seen.add(region.name);
  }
  if (['violation_count', 'exterior_count', 'unknown_count'].some((key) => result.regional_results.reduce((sum, region) => sum + region[key], 0) !== result[key])) throw new Error('Containment totals do not match their mesh results.');
  return result;
}

async function verifyContainmentIdentity(result, model) {
  for (const [name, array, expected] of [
    ['anatomy geometry', model.boneRest, result.bone_positions_sha256],
    ['skin geometry', model.skinRest, result.skin_positions_sha256],
    ['skin faces', model.sourceTopology.skin_faces, result.source_array_sha256?.skin_faces],
    ['bone faces', model.sourceTopology.bone_faces, result.source_array_sha256?.bone_faces],
    ['skin controls', model.skinIndices, result.source_array_sha256?.skin_indices],
    ['skin weights', model.skinWeights, result.source_array_sha256?.skin_weights],
    ['bind frames', model.sourceBindFrames, result.source_array_sha256?.bind_frames],
  ]) await verifyHash(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), expected, `Audited ${name}`);
  const activeBoneMeshes = model.activeBoneMeshes || model.sourceBoneMeshes;
  if (model.skin.geometry.index.array !== model.sourceTopology.skin_faces || model.skeleton.parents !== model.sourceRig.parents
      || model.bones.length !== activeBoneMeshes.length
      || model.bones.some(({ spec, control, mesh }, index) => spec !== activeBoneMeshes[index] || control !== spec.control_index
        || mesh.geometry.index.count !== spec.index_count || mesh.geometry.getAttribute('position').count !== spec.vertex_count
        || mesh.geometry.index.array.some((value, offset) => value + spec.vertex_start !== model.sourceTopology.bone_faces[spec.index_start + offset]))) throw new Error('Audited source metadata does not match rendered geometry ownership.');
  const renderedRest = new Float32Array(model.boneRest.length);
  for (const { spec, mesh } of model.bones) renderedRest.set(mesh.geometry.getAttribute('position').array, spec.vertex_start * 3);
  await verifyHash(renderedRest.buffer, result.bone_positions_sha256, 'Audited rendered anatomy rest positions');
  await verifyHash(anatomyMetadataBytes(model.sourceRig), result.source_rig_sha256, 'Audited rig metadata');
  await verifyHash(anatomyMetadataBytes(activeBoneMeshes), result.source_mesh_metadata_sha256, 'Audited bone metadata');
  if (!result.source_motion_sha256 || Object.keys(result.source_motion_sha256).length !== Object.keys(model.motions).length) throw new Error('Audited motions do not match the displayed motion set.');
  for (const [id, motion] of Object.entries(model.motions)) {
    const source = result.source_motion_sha256[id];
    for (const [name, array] of [['transforms', motion.sourceTransforms], ['times_float64', motion.times]]) {
      await verifyHash(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), source?.[name], `Audited ${id} ${name}`);
    }
  }
  const terminal = result.runtime_terminal_corrections;
  if (model.terminalCorrections || Object.values(terminal?.clips || {}).some((entry) => entry.enabled)) {
    const audited = await validateTerminalCorrections(terminal, model);
    for (const id of Object.keys(model.motions)) {
      const current = model.terminalCorrections?.clips[id]?.byIndex || {};
      if (JSON.stringify(audited.clips[id]?.byIndex || {}) !== JSON.stringify(current)) throw new Error('Audited terminal motion differs from the displayed correction.');
    }
  }
  const auditedFloor = result.runtime_motion_adjustments ? await validateMotionAdjustments(result.runtime_motion_adjustments, model.motions) : {};
  for (const id of Object.keys(model.motions)) {
    const current = model.motionAdjustments?.[id], audited = auditedFloor[id];
    if (Boolean(current?.enabled) !== Boolean(audited?.enabled)
        || (current?.enabled && (JSON.stringify(current.times) !== JSON.stringify(audited.times)
          || JSON.stringify(current.offsets_m) !== JSON.stringify(audited.offsets_m)))) throw new Error('Audited floor adjustment differs from the displayed trajectory.');
  }
}

function containmentVerdict(result) {
  return result.verdict === 'violations' ? 'Clearance violations detected'
    : result.verdict === 'inconclusive' ? 'Inconclusive / unresolved geometry' : 'No violations in checked samples';
}

function updateContainmentControls() {
  const busy = containmentActive !== null;
  const available = Boolean(!state.verifiedPose && state.loaded && activeModel?.bones.length && state.nativeAvailable && state.generationStatus !== 'running');
  ui['containment-open'].disabled = !available;
  ui['containment-open'].title = !state.nativeAvailable ? 'Local containment service required' : !activeModel?.bones.length ? 'Anatomy must be added first' : '';
  ui['containment-run'].disabled = !available || busy;
  ui['containment-cancel'].hidden = !busy;
  ui['containment-cancel'].disabled = Boolean(containmentActive?.cancelRequested);
  ui['containment-progress'].hidden = !busy;
  ui['containment-progress-label'].hidden = !busy;
  ui['containment-download'].hidden = !containmentResult;
  ui['containment-results'].hidden = !containmentResult;
}

function setContainmentStatus(text, verdict = '') {
  ui['containment-status'].textContent = text;
  ui['containment-status'].dataset.verdict = verdict;
  ui['containment-summary'].textContent = text === 'Not checked' ? '' : text;
}

function renderContainmentResult(result) {
  containmentResult = result;
  setContainmentStatus(containmentVerdict(result), result.verdict);
  const number = (value) => value.toLocaleString('en-US');
  const mm = (value) => value === null ? 'Unresolved' : `${(value * 1000).toFixed(2)} mm`;
  ui['containment-violations'].textContent = number(result.violation_count);
  ui['containment-exterior'].textContent = number(result.exterior_count);
  ui['containment-unknown'].textContent = number(result.unknown_count);
  ui['containment-clearance'].textContent = mm(result.min_clearance_m);
  ui['containment-coverage'].textContent = `${number(result.checked_pose_count)} / ${number(result.checked_bone_count)}`;
  ui['containment-intersections'].textContent = 'Not checked';
  ui['containment-criterion'].textContent = `${number(result.sample_count)} samples; ${(result.clearance_m * 1000).toFixed(2)} mm inward clearance required. Positive clearance is inside; negative is inferred exterior. Unresolved samples are not accepted as inside.`;
  ui['containment-method'].textContent = result.method;
  ui['containment-assumptions'].textContent = result.boundary_assumptions || 'Geometric query assumptions were not supplied. Inferred classifications are not independent inside/outside certificates.';
  ui['containment-coordinate-reference'].textContent = result.coordinate_parity_reference || 'Native coordinates are compared with the float64 NumPy gallery equations. Actual browser execution is checked separately.';
  const errors = [result.maximum_native_browser_skin_error_m, result.maximum_native_browser_bone_error_m];
  ui['containment-parity'].textContent = errors.every((value) => Number.isFinite(value) && value >= 0)
    ? `Native/reference coordinate difference: ${(Math.max(...errors) * 1000).toFixed(4)} mm. ${result.native_browser_coordinate_parity_pass === true ? 'Within the reported tolerance.' : 'Coordinate agreement did not pass.'}`
    : 'Native/reference coordinate agreement is unresolved.';
  const bounds = Array.isArray(result.neutral_triangle_bounds) ? result.neutral_triangle_bounds : [];
  ui['containment-surface-bounds'].textContent = bounds.length
    ? `Conditional neutral surface bounds: ${bounds.filter((row) => row.all_triangles_clear_under_query_assumptions === true).length} / ${bounds.length} meshes clear under the query assumptions. Not an independent certificate.`
    : 'Whole-triangle surface bounds were not reported.';
  ui['containment-scope'].textContent = result.scope;
  ui['containment-regions-label'].textContent = `Anatomical mesh results (${number(result.checked_bone_count)})`;
  const regions = [...result.regional_results].sort((a, b) => b.violation_count - a.violation_count || b.unknown_count - a.unknown_count || a.name.localeCompare(b.name));
  ui['containment-region-rows'].replaceChildren(...regions.map((region) => {
    const row = document.createElement('tr');
    for (const value of [region.name.replaceAll('_', ' '), number(region.violation_count), number(region.exterior_count), number(region.unknown_count), region.min_clearance_m === null ? '--' : (region.min_clearance_m * 1000).toFixed(2)]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    return row;
  }));
  updateContainmentControls();
}

function containmentJobCurrent(job) {
  return containmentActive === job && activeModel === job.model && state.caseId === job.caseId && loadGeneration === job.loadGeneration;
}

async function deleteContainmentJob(job) {
  if (!job.url) return;
  return containmentRequest(job.url, { method: 'DELETE', signal: AbortSignal.timeout(30000) });
}

function invalidateContainmentAudit() {
  const previous = containmentActive;
  containmentActive = null;
  if (previous) {
    previous.cancelRequested = true;
    previous.controller.abort();
    if (previous.url) deleteContainmentJob(previous).catch(() => {});
  }
  containmentResult = null;
  state.containmentStatus = 'idle'; state.containmentJob = null;
  ui['containment-error'].hidden = true;
  ui['containment-region-rows'].replaceChildren();
  ui['containment-scope'].textContent = 'Neutral and available recorded poses. Current passive-physics state is excluded.';
  setContainmentStatus('Not checked');
  updateContainmentControls();
}

async function cancelContainmentAudit() {
  const job = containmentActive;
  if (!job || job.cancelRequested) return;
  job.cancelRequested = true;
  setContainmentStatus('Cancelling check'); updateContainmentControls();
  try { await deleteContainmentJob(job); }
  catch (error) {
    if (!containmentJobCurrent(job)) return;
    job.cancelRequested = false;
    ui['containment-error'].textContent = error.message; ui['containment-error'].hidden = false;
    updateContainmentControls();
  }
}

async function runContainmentAudit() {
  if (containmentActive || !state.loaded || !activeModel?.bones.length || !state.nativeAvailable || state.generationStatus === 'running') return;
  const job = { model: activeModel, caseId: state.caseId, loadGeneration, controller: new AbortController(), url: null, id: null, cancelRequested: false };
  containmentActive = job; containmentResult = null;
  state.containmentStatus = 'queued'; state.containmentJob = null;
  ui['containment-error'].hidden = true;
  ui['containment-progress'].removeAttribute('value');
  ui['containment-progress-label'].textContent = 'Preparing immutable geometry snapshot';
  setContainmentStatus('Starting check'); updateContainmentControls();
  try {
    // Keep the acknowledgement so a case change can still cancel a just-created job.
    const started = await containmentRequest('./api/containment/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ case_id: job.caseId, scope: 'neutral_and_reference' }), signal: AbortSignal.timeout(30000) });
    if (started.case_id !== job.caseId || typeof started.job_id !== 'string' || !started.job_id || typeof started.poll_url !== 'string') throw new Error('Invalid containment job identity.');
    job.url = containmentAPIURL(started.poll_url).href; job.id = started.job_id;
    if (!containmentJobCurrent(job)) { await deleteContainmentJob(job); return; }
    state.containmentJob = job.id;
    if (job.cancelRequested) await deleteContainmentJob(job);
    while (containmentJobCurrent(job)) {
      const status = await containmentRequest(job.url, { signal: job.controller.signal });
      if (!containmentJobCurrent(job)) return;
      if (status.case_id !== job.caseId || status.job_id !== job.id || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(status.status)) throw new Error('Containment job response does not match this body.');
      state.containmentStatus = status.status;
      const progress = status.progress;
      if (progress && Number.isSafeInteger(progress.poses_done) && Number.isSafeInteger(progress.poses_total)
          && progress.poses_done >= 0 && progress.poses_total > 0 && progress.poses_done <= progress.poses_total) {
        ui['containment-progress'].value = progress.poses_done / progress.poses_total;
        ui['containment-progress-label'].textContent = `${progress.poses_done} / ${progress.poses_total} poses checked`;
        if (Number.isSafeInteger(progress.bones_done) && Number.isSafeInteger(progress.bones_total)
            && progress.bones_total > 0 && progress.bones_done >= 0 && progress.bones_done <= progress.bones_total) {
          ui['containment-progress'].value = Math.min(1, (progress.poses_done + progress.bones_done / progress.bones_total) / progress.poses_total);
          ui['containment-progress-label'].textContent += `; ${progress.bones_done} / ${progress.bones_total} meshes in current pose`;
        }
      }
      if (status.status === 'completed') {
        const result = validateContainmentResult(status.result, job.model, job.caseId);
        await verifyContainmentIdentity(result, job.model);
        if (!containmentJobCurrent(job)) return;
        renderContainmentResult(result);
        break;
      }
      if (status.status === 'failed') throw new Error(status.error || 'Containment check failed. No acceptance result is available.');
      if (status.status === 'cancelled') { setContainmentStatus('Check cancelled / no result'); break; }
      if (!job.cancelRequested) setContainmentStatus(status.status === 'queued' ? 'Check queued' : 'Checking containment');
      await waitForMeasurementPoll(job.controller.signal);
    }
  } catch (error) {
    if (!containmentJobCurrent(job)) return;
    state.containmentStatus = 'failed';
    setContainmentStatus('Check failed / no result');
    ui['containment-error'].textContent = error.message; ui['containment-error'].hidden = false;
  } finally {
    if (containmentActive === job) { containmentActive = null; state.containmentJob = null; updateContainmentControls(); }
  }
}

function openContainmentAudit() {
  if (!state.loaded || !activeModel?.bones.length) return;
  ui['containment-subject'].textContent = `${ui['scene-title'].textContent} / ${state.caseId}`;
  if (!ui['containment-dialog'].open) ui['containment-dialog'].showModal();
  if (!containmentActive && !containmentResult) runContainmentAudit();
}

function downloadContainmentAudit() {
  if (!containmentResult) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ case_id: state.caseId, ...containmentResult }, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${state.caseId}-containment-audit.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildModel(data, buffer, motionEntries = data.motions) {
  const arrays = data.arrays || {};
  if (data.generated && (!data.rig || !Array.isArray(data.bone_meshes) || !arrays.skin_faces || !arrays.bone_faces)) throw new Error('Generated body metadata is incomplete.');
  const read = (name) => typedArray(buffer, arrays[name], name);
  const rigMeta = data.rig || manifest.rig;
  const boneSpecs = data.bone_meshes || manifest.bone_meshes;
  const caseTopology = {
    skin_faces: arrays.skin_faces ? read('skin_faces') : topology.skin_faces,
    bone_faces: arrays.bone_faces ? read('bone_faces') : topology.bone_faces,
  };
  const sourceArrayShapes = Object.fromEntries(['skin_positions', 'skin_indices', 'skin_weights', 'bone_positions',
    'bind_frames', 'skin_faces', 'bone_faces'].map((key) => [key, (arrays[key] || manifest.topology?.arrays?.[key])?.shape?.slice()]));
  if (!Array.isArray(rigMeta.names) || !rigMeta.names.length || !Array.isArray(boneSpecs)) throw new Error('Invalid body rig or anatomy metadata.');
  const skinRest = read('skin_positions');
  const skinIndices = read('skin_indices');
  const skinWeights = read('skin_weights');
  const boneRest = read('bone_positions');
  const bindFrames = read('bind_frames');
  const jointCount = rigMeta.names.length;
  const skinCount = skinRest.length / 3;
  if (!Number.isInteger(skinCount) || !skinCount || boneRest.length % 3
      || skinIndices.length !== skinCount * 8 || skinWeights.length !== skinCount * 8
      || bindFrames.length !== jointCount * 16) throw new Error('Invalid body array dimensions.');
  for (const [name, array] of Object.entries({ skinRest, skinWeights, boneRest, bindFrames })) finiteArray(array, name);
  let mostInfluencesVertex = 0;
  let maxAuthoredInfluences = 0;
  for (let vertex = 0; vertex < skinCount; vertex += 1) {
    let sum = 0;
    let influenceCount = 0;
    for (let influence = 0; influence < 8; influence += 1) {
      const index = vertex * 8 + influence;
      if (!Number.isInteger(skinIndices[index]) || skinIndices[index] < 0 || skinIndices[index] >= jointCount || skinWeights[index] < 0) throw new Error('Invalid skin influence.');
      sum += skinWeights[index];
      if (skinWeights[index] > 0) influenceCount += 1;
    }
    if (Math.abs(sum - 1) > 0.0002) throw new Error('Skin weights do not sum to one.');
    if (influenceCount > maxAuthoredInfluences) { maxAuthoredInfluences = influenceCount; mostInfluencesVertex = vertex; }
  }
  validateFaces(caseTopology.skin_faces, skinCount, 'Skin faces');
  validateFaces(caseTopology.bone_faces, boneRest.length / 3, 'Bone faces');
  const parents = rigMeta.parents;
  if (!Array.isArray(parents) || parents.length !== jointCount || parents.some((parent) => !Number.isInteger(parent) || parent < -1 || parent >= jointCount)) throw new Error('Invalid rig hierarchy.');
  const order = [];
  const visited = new Uint8Array(jointCount);
  const visit = (joint) => {
    if (visited[joint] === 2) return;
    if (visited[joint] === 1) throw new Error('Cyclic rig hierarchy.');
    visited[joint] = 1;
    const parent = parents[joint];
    if (parent >= 0 && parent !== joint) visit(parent);
    visited[joint] = 2;
    order.push(joint);
  };
  for (let joint = 0; joint < jointCount; joint += 1) visit(joint);
  const bindMatrices = Array.from({ length: jointCount }, (_, joint) => new THREE.Matrix4().fromArray(bindFrames, joint * 16).transpose());
  const inverseBindMatrices = bindMatrices.map((matrix) => matrix.clone().invert());
  const localOffsets = bindMatrices.map((matrix, joint) => {
    const parent = parents[joint];
    const local = parent >= 0 && parent !== joint ? inverseBindMatrices[parent].clone().multiply(matrix) : matrix;
    return new THREE.Vector3().setFromMatrixPosition(local);
  });
  const skeleton = { jointCount, parents, order, bindMatrices, inverseBindMatrices, localOffsets };
  const motions = Object.fromEntries(Object.entries(motionEntries || {}).map(([id, entry]) => [id, decodeMotion(entry, buffer, arrays, skeleton, id)]));
  if (!Object.keys(motions).length) throw new Error('No body motion frames were exported.');
  for (const spec of boneSpecs) {
    const { vertex_start: start, vertex_count: count, index_start: indexStart, index_count: indexCount, control_index: control } = spec;
    if (![start, count, indexStart, indexCount, control].every(Number.isSafeInteger)
        || start < 0 || count < 1 || start + count > boneRest.length / 3
        || indexStart < 0 || indexCount < 0 || indexStart + indexCount > caseTopology.bone_faces.length
        || indexCount % 3 || control < 0 || control >= jointCount) throw new Error(`Invalid bone mesh: ${spec.name}`);
    for (let i = 0; i < indexCount; i += 1) {
      const index = caseTopology.bone_faces[indexStart + i] - start;
      if (index < 0 || index >= count) throw new Error(`Invalid local bone index: ${spec.name}`);
    }
  }
  const group = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const skinPositions = new Float32Array(skinRest);
  geometry.setAttribute('position', new THREE.BufferAttribute(skinPositions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(caseTopology.skin_faces, 1));
  geometry.computeVertexNormals();
  const normalRest = new Float32Array(geometry.getAttribute('normal').array);
  geometry.getAttribute('normal').setUsage(THREE.DynamicDrawUsage);
  const skin = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#79adbf', transparent: true, opacity: state.opacity, roughness: 0.63, metalness: 0, side: THREE.DoubleSide, depthWrite: false }));
  skin.frustumCulled = false;
  setSkinOpacity(skin, state.opacity);
  skin.visible = state.skin;
  group.add(skin);
  const boneMaterial = new THREE.MeshStandardMaterial({ color: '#e2d4b5', roughness: 0.68, metalness: 0, side: THREE.DoubleSide });
  const anatomy = new THREE.Group();
  const bones = [];
  for (const spec of boneSpecs) {
    const { vertex_start: start, vertex_count: count, index_start: indexStart, index_count: indexCount, control_index: control } = spec;
    const localFaces = new Uint32Array(indexCount);
    for (let i = 0; i < indexCount; i += 1) {
      localFaces[i] = caseTopology.bone_faces[indexStart + i] - start;
    }
    const boneGeometry = new THREE.BufferGeometry();
    boneGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(boneRest.subarray(start * 3, (start + count) * 3)), 3));
    boneGeometry.setIndex(new THREE.BufferAttribute(localFaces, 1));
    boneGeometry.computeVertexNormals();
    const mesh = new THREE.Mesh(boneGeometry, boneMaterial);
    mesh.name = spec.name;
    mesh.matrixAutoUpdate = false;
    anatomy.add(mesh);
    bones.push({ mesh, control, spec });
  }
  anatomy.visible = state.anatomy;
  group.add(anatomy);
  const bindOrigins = new Float32Array(jointCount * 3);
  for (let joint = 0; joint < jointCount; joint += 1) {
    bindOrigins.set([bindFrames[joint * 16 + 3], bindFrames[joint * 16 + 7], bindFrames[joint * 16 + 11]], joint * 3);
  }
  const rig = new THREE.Group();
  const links = parents.flatMap((parent, joint) => parent >= 0 && parent !== joint ? [[parent, joint]] : []);
  const rigPositions = new Float32Array(jointCount * 3);
  const linePositions = new Float32Array(links.length * 6);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage));
  const rigLines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: '#b94c3e', depthTest: false, transparent: true, opacity: 0.9 }));
  rigLines.frustumCulled = false;
  rigLines.renderOrder = 4;
  rig.add(rigLines);
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', new THREE.BufferAttribute(rigPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const rigPoints = new THREE.Points(pointGeometry, new THREE.PointsMaterial({ color: '#aa463b', size: 5, sizeAttenuation: false, depthTest: false }));
  rigPoints.renderOrder = 5;
  rigPoints.frustumCulled = false;
  rig.add(rigPoints);
  rig.visible = state.rig;
  group.add(rig);
  const scenery = new THREE.Group();
  group.add(scenery);
  const deltas = Array.from({ length: jointCount }, () => new THREE.Matrix4());
  const posedFrames = Array.from({ length: jointCount }, () => new THREE.Matrix4());
  const bounds = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position'));
  return { group, skin, anatomy, rig, bones, motions, skinRest, skinIndices, skinWeights, skinPositions, normalRest, boneRest, bindOrigins, rigPositions, linePositions, links, lineGeometry, pointGeometry, deltas, jointCount, bounds, scenery, data, skeleton, posedFrames, mostInfluencesVertex, maxAuthoredInfluences, sourceRig: rigMeta, sourceBoneMeshes: boneSpecs, sourceTopology: caseTopology, sourceBindFrames: bindFrames, sourceArrayShapes, trackedRoot: null };
}

function disposeGroup(group) {
  const materials = new Set();
  group.traverse((object) => {
    object.geometry?.dispose();
    if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
  });
  materials.forEach((material) => material.dispose());
}

function clearVerifiedPose() {
  verifiedPoseGeneration += 1;
  if (verifiedPoseBackup && activeModel) {
    activeModel.bones.forEach(({ mesh }, index) => {
      mesh.geometry.getAttribute('position').array.set(verifiedPoseBackup.bones[index]);
      mesh.geometry.getAttribute('position').needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    });
    activeModel.rig.visible = state.rig;
    ['renderer-select', 'rig-toggle', 'speed-select', 'motion-select'].forEach((id) => { ui[id].disabled = false; });
    ['play-button', 'replay-button', 'time-slider'].forEach((id) => { ui[id].disabled = !(state.duration > 0); });
    poseDirty = true;
  }
  verifiedPoseBackup = null;
  state.verifiedPose = null;
  ui['verified-pose-select'].value = '';
  ui['verified-pose-status'].hidden = true;
}

async function refreshVerifiedPoses(caseId, generation) {
  try {
    const response = await fetch(new URL('./verified_poses/catalog.json', manifestURL), { cache: 'no-cache' });
    if (response.status === 404) return;
    if (!response.ok) throw new Error('Verified pose catalog is unavailable.');
    const catalog = await response.json();
    if (catalog.schema !== 'atlas_verified_pose_catalog_v1' || catalog.full_motion_validated !== false || !Array.isArray(catalog.poses)) throw new Error('Invalid verified pose scope.');
    if (generation !== loadGeneration || state.caseId !== caseId) return;
    verifiedPoseCatalog = catalog;
    const entries = catalog.poses.filter((row) => row.case_id === caseId);
    ui['verified-pose-select'].replaceChildren(new Option('Live motion', ''), ...entries.map((row) => new Option(row.label, row.id)));
    ui['verified-pose-field'].hidden = !entries.length;
    const requested = new URLSearchParams(window.location.search).get('verified_pose');
    if (!verifiedPoseURLHandled && entries.some((row) => row.id === requested)) {
      verifiedPoseURLHandled = true;
      await showVerifiedPose(requested);
    }
  } catch (error) {
    if (generation !== loadGeneration) return;
    ui['verified-pose-status'].hidden = false;
    ui['verified-pose-status'].textContent = error.message;
  }
}

function verifiedPoseArrays(data, buffer, model) {
  const result = {};
  for (const name of ['before_skin', 'after_skin', 'before_anatomy', 'after_anatomy', 'skin_faces', 'bone_faces']) {
    const descriptor = data.arrays?.[name];
    const integer = name.endsWith('_faces');
    if (!descriptor || descriptor.dtype !== (integer ? 'uint32' : 'float32')
        || !Array.isArray(descriptor.shape) || descriptor.shape.length !== 2 || descriptor.shape[1] !== 3
        || !Number.isSafeInteger(descriptor.shape[0]) || descriptor.shape[0] < 1
        || !Number.isSafeInteger(descriptor.byte_offset) || descriptor.byte_offset < 0
        || descriptor.byte_length !== descriptor.shape[0] * 12) throw new Error('Invalid verified pose array: ' + name);
    result[name] = typedArray(buffer, { dtype: descriptor.dtype, offset: descriptor.byte_offset, count: descriptor.shape[0] * 3 }, name);
    finiteArray(result[name], name);
  }
  for (const name of ['before_skin', 'after_skin']) if (result[name].length !== model.skinPositions.length) throw new Error('Snapshot skin topology differs.');
  for (const name of ['before_anatomy', 'after_anatomy']) if (result[name].length !== model.boneRest.length) throw new Error('Snapshot anatomy topology differs.');
  for (const name of ['skin_faces', 'bone_faces']) {
    const source = model.sourceTopology[name];
    if (result[name].length !== source.length || result[name].some((value, index) => value !== source[index])) throw new Error('Snapshot source faces differ.');
  }
  return result;
}

async function showVerifiedPose(id) {
  clearVerifiedPose();
  if (!id) {
    updatePose();
    updatePlaybackStatus();
    updateContainmentControls();
    return;
  }
  const entry = verifiedPoseCatalog?.poses.find((row) => row.id === id && row.case_id === state.caseId);
  if (!entry || !state.loaded) return;
  let generation = verifiedPoseGeneration;
  const model = activeModel;
  setPlaying(false);
  ui['verified-pose-status'].hidden = false;
  ui['verified-pose-status'].textContent = 'Verifying native pose snapshot';
  try {
    if (entry.full_motion_validated !== false || entry.entire_body_containment_validated !== false
        || !/^verified_poses\/[a-zA-Z0-9_-]+\.json$/.test(entry.data_url)) throw new Error('Invalid regional pose scope.');
    const bytes = await fetchChecked(absoluteURL(entry.data_url, manifestURL), undefined, false);
    await verifyHash(bytes, entry.sha256, 'Native pose metadata');
    const data = parseJSONBuffer(bytes, 'native pose');
    if (data.schema !== 'atlas_verified_pose_v1' || data.id !== id || data.case_id !== state.caseId
        || data.clip !== entry.clip || data.time_s !== entry.time_s
        || !Number.isFinite(data.time_s) || data.frozen_pose !== true
        || data.coordinates !== 'world_meters_z_up' || data.geometry_source !== 'native_mujoco_float32_readback'
        || data.full_motion_validated !== false || data.entire_body_containment_validated !== false
        || !Array.isArray(data.target_scope) || !data.target_scope.length
        || data.target_scope.some((name) => !model.bones.some(({ spec }) => spec.name === name))
        || JSON.stringify(data.target_scope) !== JSON.stringify(entry.target_scope)
        || !/^verified_poses\/[a-zA-Z0-9_-]+\.bin$/.test(data.buffer_url)
        || !data.source_sha256 || ['manifest.json', 'topology.json', 'topology.bin', `cases/${state.caseId}.json`, `cases/${state.caseId}.bin`].some((path) => !Object.hasOwn(data.source_sha256, path))) throw new Error('Native pose identity or scope differs.');
    for (const [path, digest] of Object.entries(data.source_sha256)) {
      if (path.includes('..') || path.startsWith('/') || !/^[a-zA-Z0-9_./-]+$/.test(path)) throw new Error('Invalid snapshot source path.');
      await verifyHash(await fetchChecked(absoluteURL(path, manifestURL), undefined, false), digest, 'Native pose source');
    }
    const buffer = await fetchChecked(absoluteURL(data.buffer_url, manifestURL), undefined, false);
    await verifyHash(buffer, data.buffer_sha256, 'Native pose geometry');
    const arrays = verifiedPoseArrays(data, buffer, model);
    if (generation !== verifiedPoseGeneration || model !== activeModel) return;
    const motion = model.motions[data.clip];
    if (!motion || data.time_s < motion.times[0] || data.time_s > motion.times[motion.times.length - 1]) throw new Error('Snapshot motion or time is unavailable.');
    selectMotion(data.clip);
    generation = verifiedPoseGeneration;
    state.time = data.time_s - model.motions[data.clip].times[0];
    poseDirty = true;
    updatePose();
    setRenderer('gallery');
    verifiedPoseBackup = { bones: model.bones.map(({ mesh }) => new Float32Array(mesh.geometry.getAttribute('position').array)) };
    model.skinPositions.set(arrays.after_skin);
    model.skin.geometry.getAttribute('position').needsUpdate = true;
    model.skin.geometry.computeVertexNormals();
    for (const { mesh, spec } of model.bones) {
      mesh.geometry.getAttribute('position').array.set(arrays.after_anatomy.subarray(spec.vertex_start * 3, (spec.vertex_start + spec.vertex_count) * 3));
      mesh.geometry.getAttribute('position').needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
      mesh.matrix.identity();
      mesh.matrixWorldNeedsUpdate = true;
    }
    state.verifiedPose = { id, clip: data.clip, time_s: data.time_s, target_scope: data.target_scope,
      full_motion_validated: false, entire_body_containment_validated: false };
    model.rig.visible = false;
    applyContainmentProjection(model);
    currentBounds.setFromBufferAttribute(model.skin.geometry.getAttribute('position'));
    cameraGeometryBounds.copy(currentBounds);
    for (const { mesh } of model.bones) cameraGeometryBounds.union(scratchBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrix));
    ['renderer-select', 'rig-toggle', 'play-button', 'replay-button', 'time-slider', 'speed-select', 'motion-select'].forEach((key) => { ui[key].disabled = true; });
    ui['verified-pose-select'].value = id;
    ui['verified-pose-status'].hidden = false;
    ui['verified-pose-status'].textContent = `Single pose: ${data.clip}, ${data.time_s.toFixed(5)} s. Verified targets: ${data.target_scope.join(', ')}. Whole body and continuous motion not validated.`;
    ui['renderer-status'].textContent = 'Native geometry / frozen regional verification';
    ui['frame-value'].textContent = 'Single verified pose';
    updateTimeline();
    updateContainmentControls();
    frameBody('back');
    poseDirty = false;
  } catch (error) {
    if (generation !== verifiedPoseGeneration || model !== activeModel) return;
    clearVerifiedPose();
    updatePose();
    updatePlaybackStatus();
    ui['verified-pose-status'].hidden = false;
    ui['verified-pose-status'].textContent = error.message;
  }
}

async function loadCase(id, { recoverServices = false } = {}) {
  const item = lookupCase(id);
  if (!item) return;
  clearVerifiedPose();
  ui['verified-pose-field'].hidden = true;
  const generation = ++loadGeneration;
  loadController?.abort();
  loadController = new AbortController();
  const { signal } = loadController;
  if (recoverServices) useStaticAnatomyServices();
  let capabilities = { nativeAvailable: state.nativeAvailable, physicsAvailable: state.physicsAvailable };
  // Browser playback uses the same source-checked published assets without
  // constructing and validating a second, unused native model.
  if (!recoverServices && state.renderer === 'gallery') capabilities = {
    nativeAvailable: false, physicsAvailable: false,
    reason: 'Browser playback selected; choose MuJoCo to load the native model.',
  };
  invalidatePhysicsControl();
  setPhysicsPlaying(false);
  ui['physics-mass'].value = '';
  configuredPhysicsMass = null;
  state.physicsTime = 0;
  state.physicsMass = null;
  state.physicsContacts = 0;
  if (ui['measurement-reference'].open) ui['measurement-reference'].close();
  state.caseId = id;
  state.generated = Boolean(item.generated);
  if (item.generated) {
    setLayerVisibility('rig', Boolean(item.layersAdded.rig));
    setLayerVisibility('anatomy', Boolean(item.layersAdded.anatomy));
  }
  invalidateNativeFrame(true);
  state.loaded = false;
  invalidateContainmentAudit();
  if (ui['containment-dialog'].open) ui['containment-dialog'].close();
  state.error = null;
  state.recorded_motion = false;
  state.motion_source = null;
  state.reference_available = null;
  ui['motion-source'].hidden = true;
  setPlaying(false);
  updateSubjectLabels(item);
  ui['error-overlay'].hidden = true;
  ui['loading-overlay'].hidden = false;
  ui['loading-label'].textContent = 'Loading body assets';
  ['motion-select', 'play-button', 'replay-button', 'time-slider'].forEach((key) => { ui[key].disabled = true; });
  let candidate;
  try {
    if (recoverServices) {
      capabilities = await probeAtlasRecovery(signal);
      if (generation !== loadGeneration) return;
    }
    const dataURL = absoluteURL(item.data_url, manifestURL);
    const dataBytes = await fetchChecked(dataURL, signal, false);
    if (item.generated || item.pediatric_reference) await verifyHash(dataBytes, item.data_sha256, 'Body JSON');
    const data = parseJSONBuffer(dataBytes, 'body');
    if (item.generated && (data.schema !== 'atlas_measurement_case_v1' || data.generated !== true || data.case_id !== id)) throw new Error('Generated body identity does not match its result.');
    if (item.pediatric_reference && (data.schema !== 'atlas_pediatric_reference_case_v1'
        || data.generated !== false || data.pediatric_reference !== true || data.case_id !== id
        || data.buffer_url !== 'body.bin'
        || !data.rig || !Array.isArray(data.bone_meshes) || data.bone_meshes.length !== item.bone_mesh_count
        || Object.keys(data.arrays || {}).sort().join(',') !== 'bind_frames,bone_faces,bone_positions,skin_faces,skin_indices,skin_positions,skin_weights'
        || Object.keys(data.motions || {}).join(',') !== 'neutral')) {
      throw new Error('Pediatric reference must retain its complete neutral body, rig and anatomy.');
    }
    const buffer = await fetchChecked(absoluteURL(data.buffer_url, dataURL), signal, false);
    if (item.generated || item.pediatric_reference) await verifyHash(buffer, item.buffer_sha256, 'Body binary');
    if (generation !== loadGeneration) return;
    let reference = item.generated || item.pediatric_reference ? null : { available: false, reason: 'The selected recording bank is unavailable; only the authored neutral pose is shown.' };
    if (referenceManifest && !item.generated && !item.pediatric_reference) {
      ui['loading-label'].textContent = 'Verifying recorded motion';
      reference = await loadReferenceCase(id, dataBytes, buffer, signal);
      if (generation !== loadGeneration) return;
    }
    if (!data.motions?.neutral) throw new Error('The body has no neutral reference pose.');
    // Cases carrying the recorded natural-motion library keep all of their own clips.
    const ownLibrary = data.motion_library?.schema === 'natural_motion_library_v1' && !item.pediatric_reference;
    candidate = buildModel(data, buffer, ownLibrary ? data.motions : { neutral: data.motions.neutral });
    candidate.caseBufferSha256 = ownLibrary ? await sha256Hex(buffer) : null;
    if (item.pediatric_reference && (candidate.motions.neutral.times.length !== 1 || candidate.motions.neutral.times[0] !== 0
        || candidate.motions.neutral.sourceTransforms.some((value, index) => value !== (index % 16 % 5 === 0 ? 1 : 0))
        || Math.abs(candidate.bounds.max.z - candidate.bounds.min.z - item.height_m) > 1e-7)) {
      throw new Error('Pediatric reference neutral geometry differs from its declaration.');
    }
    if (reference?.available) {
      candidate.verifiedSourceHashes = reference.verifiedSourceHashes;
      for (const [motionId, entry] of Object.entries(reference.data.motions)) {
        const motion = decodeMotion(entry, reference.buffer, {}, candidate.skeleton, motionId);
        motion.source = { ...entry.source, ...referenceBankIdentity(referenceManifest), license_url: entry.source.license_url ?? referenceManifest.license_url };
        motion.sourceMetadata.source = { ...entry.source, ...referenceBankIdentity(referenceManifest), reference_motion_bank: referenceBankDirectory };
        candidate.motions[motionId] = motion;
      }
    }
    let stress = null;
    if (!item.pediatric_reference) {
    const correction = await loadAnatomyRefinementPayload(id, signal, capabilities.nativeAvailable);
    if (correction) {
      const { refinement, publication } = correction;
      await verifyAnatomySourceFiles(candidate, refinement, id, dataBytes, buffer, signal);
      await applyAnatomyRefinement(candidate, refinement, id);
      if (Object.hasOwn(refinement, 'supplemental')) {
        if (!refinement.supplemental || typeof refinement.supplemental !== 'object') throw new Error('Invalid supplemental anatomy refinement.');
        await verifyAnatomySourceFiles(candidate, refinement.supplemental, id, dataBytes, buffer, signal);
        await applyCoupledAnatomyRefinement(candidate, refinement.supplemental, id);
        candidate.anatomyRefinement.supplemental.verified_manifest_asset = publication;
      }
      candidate.anatomyRefinementDelivery = correction.delivery;
      if (generation !== loadGeneration) { disposeGroup(candidate.group); return; }
      if (correction.nativeUnavailable) capabilities = { ...capabilities, nativeAvailable: false, physicsAvailable: false };
    }
    const teenCorrection = await loadTeenRegionalRefinement(id, signal);
    const infantCorrection = await loadInfantNeutralNeckRefinement(id, signal);
    const infantSkinCorrection = await loadInfantNeutralSkinRefinement(id, signal);
    if (teenCorrection && capabilities.nativeAvailable
        && !verifyNativeTeenRegionalBinding(correction?.refinement, teenCorrection.patch)) {
      capabilities = { nativeAvailable: false, physicsAvailable: false,
        reason: 'Native service has not loaded the published teen correction; browser playback only.' };
    }
    if (infantCorrection && capabilities.nativeAvailable
        && !verifyNativeInfantNeutralNeckBinding(correction?.refinement, infantCorrection.patch)) {
      capabilities = { nativeAvailable: false, physicsAvailable: false,
        reason: 'Native service has not loaded the infant neck correction; browser playback only.' };
    }
    if (infantSkinCorrection && capabilities.nativeAvailable
        && !verifyNativeInfantNeutralSkinBinding(correction?.refinement, infantSkinCorrection.patch)) {
      capabilities = { nativeAvailable: false, physicsAvailable: false,
        reason: 'Native service has not loaded the infant skin correction; browser playback only.' };
    }
    if (candidate.playbackRestriction) reference = { ...reference, available: false,
      reason: candidate.playbackRestriction.reason };
    if (reference?.available && capabilities.nativeAvailable) {
      if (!await loadNativePlaybackRuntime(candidate, id, signal)) {
        capabilities = { nativeAvailable: false, physicsAvailable: false,
          reason: 'Native playback settings are unavailable; browser playback only.' };
      }
    }
    if (teenCorrection) {
      await applyTeenRegionalRefinement(candidate, teenCorrection.patch, id, teenCorrection.publication);
    }
    if (infantCorrection) {
      await applyInfantNeutralNeckRefinement(candidate, infantCorrection.patch, id, infantCorrection.publication);
    }
    if (infantSkinCorrection) {
      await applyInfantNeutralSkinRefinement(candidate, infantSkinCorrection.patch, id, infantSkinCorrection.publication);
    }
    const patella = await applyPatellaMotionPublication(candidate, id, signal);
    if (patella && capabilities.nativeAvailable) {
      if (!await patellaNativeAvailable(patella, id, signal)) {
        capabilities = { nativeAvailable: false, physicsAvailable: false,
          reason: 'Native service has not loaded the published knee motion; browser playback only.' };
      }
    }
    const lumbar = await applyLumbarMotionPublication(candidate, id, signal);
    if (lumbar && capabilities.nativeAvailable && !await lumbarNativeAvailable(lumbar, id, signal)) {
      capabilities = { nativeAvailable: false, physicsAvailable: false,
        reason: 'Native service has not loaded the published lumbar motion; browser playback only.' };
    }
    const teenSkinCorrection = await loadTeenNeutralSkinRefinement(id, signal);
    if (teenSkinCorrection) {
      const nativeBinding = verifyNativeTeenNeutralSkinBinding(correction?.refinement, teenSkinCorrection.patch);
      if (capabilities.nativeAvailable && !nativeBinding) capabilities = { nativeAvailable: false, physicsAvailable: false,
        reason: 'Native service has not loaded the neutral teen skin correction; browser playback only.' };
      await applyTeenNeutralSkinRefinement(candidate, teenSkinCorrection.patch, id, teenSkinCorrection.publication);
    }
    const adultSkinCorrection = await loadTeenNeutralSkinRefinement(id, signal, 'adult');
    if (adultSkinCorrection) {
      const nativeBinding = verifyNativeTeenNeutralSkinBinding(correction?.refinement, adultSkinCorrection.patch, 'adult');
      if (capabilities.nativeAvailable && !nativeBinding) capabilities = { nativeAvailable: false, physicsAvailable: false,
        reason: 'Native service has not loaded the neutral adult skin correction; browser playback only.' };
      await applyTeenNeutralSkinRefinement(candidate, adultSkinCorrection.patch, id, adultSkinCorrection.publication, 'adult');
    }
    const regionalSkin = await loadRegionalSkinMotion(id, signal);
    const deferredRegionalSkin = regionalSkin && Object.hasOwn(regionalSkin.payload?.source?.runtime || {}, 'stress_motion_source');
    if (regionalSkin && !deferredRegionalSkin) {
      await applyRegionalSkinMotion(candidate, regionalSkin.payload, id, regionalSkin.publication);
      if (capabilities.nativeAvailable && !await regionalSkinNativeAvailable(candidate.regionalSkinMotion, id, signal)) {
        capabilities = { nativeAvailable: false, physicsAvailable: false,
          reason: 'Native service has not loaded the published regional skin motion; browser playback only.' };
      }
    }
    const coupledKnee = await loadCoupledKneeMotion(candidate, id, signal);
    if (coupledKnee) {
      if (capabilities.nativeAvailable && !await coupledKneeNativeAvailable(coupledKnee, id, signal)) capabilities = { nativeAvailable: false, physicsAvailable: false,
        reason: 'Native service has not loaded the coupled knee motion; browser playback only.' };
      candidate.coupledKneeMotion = coupledKnee;
    }
    const scopedSkin = await loadScopedSkinRest(candidate, id, signal);
    if (scopedSkin && capabilities.nativeAvailable) {
      let matched = false;
      try {
        const binding = await fetchChecked(new URL(`./api/native/scoped-skin-rest?case_id=${encodeURIComponent(id)}`, manifestURL), signal);
        matched = regionalSkinEqual(binding, scopedSkin.binding);
      } catch (error) { if (signal?.aborted) throw error; }
      if (!matched) capabilities = { nativeAvailable: false, physicsAvailable: false,
        reason: 'Native service has not loaded the scoped neutral skin correction; browser playback only.' };
    }
    stress = !item.generated ? await loadStressMotions(candidate, id, dataBytes, buffer, signal) : null;
    if (stress && capabilities.nativeAvailable) {
      let matched = false;
      try {
        const binding = await fetchChecked(new URL(`./api/native/stress-motions?case_id=${encodeURIComponent(id)}`, manifestURL), signal);
        matched = await applyStressRuntime(candidate, binding, stress);
      } catch (error) { if (signal?.aborted) throw error; }
      if (!matched) capabilities = { nativeAvailable: false, physicsAvailable: false,
        reason: 'Native service has not loaded the retargeted stress catalog; browser playback only.' };
    }
    if (deferredRegionalSkin) {
      if (!stress) throw new Error('Regional source-bound stress catalog is unavailable.');
      await applyRegionalSkinMotion(candidate, regionalSkin.payload, id, regionalSkin.publication);
      if (capabilities.nativeAvailable && !await regionalSkinNativeAvailable(candidate.regionalSkinMotion, id, signal)) {
        capabilities = { nativeAvailable: false, physicsAvailable: false,
          reason: 'Native service has not loaded the published regional skin motion; browser playback only.' };
      }
    }
    }
    if (generation !== loadGeneration) { disposeGroup(candidate.group); return; }
    if (activeModel) {
      scene.remove(activeModel.group);
      disposeGroup(activeModel.group);
    }
    activeModel = candidate;
    scene.add(candidate.group);
    if (capabilities.nativeAvailable) {
      state.nativeAvailable = true;
      state.physicsAvailable = capabilities.physicsAvailable;
      state.nativeError = null;
      const nativeOption = ui['renderer-select'].querySelector('[value="native"]');
      nativeOption.disabled = false;
      nativeOption.textContent = 'MuJoCo playback';
      ui['renderer-select'].querySelector('[value="physics"]').disabled = !capabilities.physicsAvailable;
      if (capabilities.version) ui['renderer-select'].title = `Native MuJoCo ${capabilities.version}: kinematic rendering`;
      if (recoverServices) setRenderer('native');
    } else {
      useStaticAnatomyServices(capabilities.reason);
    }
    const nextMotion = nextAvailableMotion(candidate.motions, state.motionId, reference?.data?.default_motion_id || referenceManifest?.default_motion_id);
    state.reference_available = reference ? reference.available : null;
    if (item.pediatric_reference) {
      ui['age-warning'].hidden = false;
      ui['age-warning'].textContent = 'Transferred anatomy; pediatric fit not validated';
      ui['age-warning'].removeAttribute('title');
    } else if (stress) {
      ui['age-warning'].hidden = false;
      ui['age-warning'].textContent = 'Motion tests: not age-specific or containment validated';
      ui['age-warning'].removeAttribute('title');
    } else if (ownLibrary) {
      ui['age-warning'].hidden = false;
      ui['age-warning'].textContent = 'Recorded human motion (100STYLE, adult performers), retargeted to this body';
      ui['age-warning'].removeAttribute('title');
    } else if (reference && !reference.available) {
      ui['age-warning'].hidden = false;
      ui['age-warning'].textContent = 'Recorded motion unavailable';
      ui['age-warning'].title = reference.reason;
    } else {
      ui['age-warning'].textContent = 'Adult-derived anatomy; demonstration motion only';
      ui['age-warning'].removeAttribute('title');
    }
    setMotionOptions(candidate.motions, nextMotion);
    ui['bone-count'].textContent = `${candidate.bones.length} anatomical meshes`;
    ui['joint-count'].textContent = `${candidate.jointCount} rig controls`;
    updateGeneratedLayers(item);
    updateAnatomyRefinementStatus();
    state.loaded = true;
    updateContainmentControls();
    selectMotion(nextMotion);
    if (state.simulationMode === 'physics') setPhysicsMode();
    frameBody('front');
    ui['loading-overlay'].hidden = true;
    refreshIcons();
    refreshVerifiedPoses(id, generation);
  } catch (error) {
    if (candidate && candidate !== activeModel) disposeGroup(candidate.group);
    if (signal.aborted || generation !== loadGeneration) return;
    showError(error);
  }
}

function showError(error) {
  state.error = error.message || String(error);
  state.loaded = false;
  setPlaying(false);
  ui['loading-overlay'].hidden = true;
  ui['error-overlay'].hidden = false;
  ui['error-message'].textContent = state.error;
  console.error(error);
}

function rebuildScenery(scenery) {
  const group = activeModel.scenery;
  disposeGroup(group);
  group.clear();
  const boxes = scenery.boxes || [];
  if (!Array.isArray(boxes)) throw new Error('Invalid motion scenery.');
  const materials = {
    chair: new THREE.MeshStandardMaterial({ color: '#a5b6a4', roughness: 0.8 }),
    step: new THREE.MeshStandardMaterial({ color: '#bccac2', roughness: 0.9 }),
  };
  const used = new Set();
  for (const box of boxes) {
    if (!Array.isArray(box.position) || !Array.isArray(box.size) || box.position.length !== 3 || box.size.length !== 3
        || !box.position.every(Number.isFinite) || !box.size.every((value) => Number.isFinite(value) && value > 0)
        || (box.yaw_rad !== undefined && !Number.isFinite(box.yaw_rad))) throw new Error('Invalid scenery box dimensions.');
    const kind = box.kind === 'chair' ? 'chair' : 'step';
    used.add(kind);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...box.size), materials[kind]);
    mesh.position.fromArray(box.position);
    mesh.rotation.z = box.yaw_rad || 0;
    group.add(mesh);
  }
  for (const kind of Object.keys(materials)) if (!used.has(kind)) materials[kind].dispose();
}

function selectMotion(id) {
  clearVerifiedPose();
  invalidateNativeFrame(true);
  if (!activeModel?.motions[id]) return;
  setPlaying(false);
  state.motionId = id;
  state.time = 0;
  state.duration = activeModel.motions[id].duration;
  state.motion_source = activeModel.motions[id].source;
  state.recorded_motion = Boolean(state.motion_source);
  ui['motion-source'].hidden = !state.recorded_motion || state.simulationMode === 'physics';
  if (state.recorded_motion) {
    const source = recordedMotionSource(state.motion_source);
    ui['motion-source-link'].textContent = source.label;
    ui['motion-source-link'].href = source.url;
    ui['motion-license-link'].hidden = !source.licenseURL;
    if (source.licenseURL) ui['motion-license-link'].href = source.licenseURL;
    else ui['motion-license-link'].removeAttribute('href');
  } else {
    ui['motion-source-link'].textContent = '';
    ui['motion-source-link'].removeAttribute('href');
    ui['motion-license-link'].hidden = true;
    ui['motion-license-link'].removeAttribute('href');
  }
  activeModel.trackedRoot = null;
  ui['motion-select'].value = id;
  ui['time-slider'].max = String(state.duration || 1);
  ui['time-slider'].value = '0';
  ui['time-slider'].disabled = !state.duration;
  ui['play-button'].disabled = !state.duration;
  ui['replay-button'].disabled = !state.duration;
  rebuildScenery(activeModel.motions[id].scenery);
  // Keep fitted frames for the current and the two most recently viewed motions only.
  activeModel.containmentRecent = [id, ...(activeModel.containmentRecent || []).filter((motion) => motion !== id)].slice(0, 3);
  if (activeModel.containmentCache) {
    for (const key of [...activeModel.containmentCache.keys()]) {
      if (!activeModel.containmentRecent.includes(key.split('|')[0])) activeModel.containmentCache.delete(key);
    }
  }
  const model = activeModel, caseId = state.caseId;
  if (state.containmentProjection && !state.verifiedPose && model.caseBufferSha256) {
    loadPrecomputedContainment(model, caseId, id).then((ok) => {
      if (activeModel !== model || state.motionId !== id) return;
      if (!ok) prefetchContainment(model, id);
      poseDirty = true;
      updateContainmentProjectionStatus();
    });
  }
  poseDirty = true;
  updatePose();
  if (model.precomputedState?.[id] !== 'pending') prefetchContainment(model, id);
  updateTimeline();
  frameBody(state.camera === 'orbit' ? 'front' : state.camera);
  updatePlaybackStatus();
}

function setPlaying(playing) {
  state.playing = Boolean(playing && !state.verifiedPose && state.loaded && state.duration > 0 && state.simulationMode === 'playback');
  ui['play-button'].setAttribute('aria-label', state.playing ? 'Pause motion' : 'Play motion');
  ui['play-button'].dataset.tooltip = state.playing ? 'Pause' : 'Play';
  ui['play-button'].innerHTML = `<i data-lucide="${state.playing ? 'pause' : 'play'}"></i>`;
  refreshIcons();
}

function motionInterval(motion, time) {
  const target = time + motion.times[0];
  let lo = 0;
  let hi = motion.times.length - 1;
  while (lo < hi - 1) {
    const middle = (lo + hi) >> 1;
    if (motion.times[middle] <= target) lo = middle;
    else hi = middle;
  }
  const alpha = hi === lo ? 0 : THREE.MathUtils.clamp((target - motion.times[lo]) / (motion.times[hi] - motion.times[lo]), 0, 1);
  return { lo, hi, alpha };
}

function cameraTrackingDelta(previous, current, following) {
  return previous && following ? new THREE.Vector3(current.x - previous.x, current.y - previous.y, 0) : new THREE.Vector3();
}

function motionFramingBounds(model, motion, adjusted = false) {
  if (motion.restIdentity) return model.bounds.clone();
  if (model.motionFramingRadius === undefined) {
    const paths = new Float64Array(model.jointCount);
    for (const joint of model.skeleton.order) {
      const parent = model.skeleton.parents[joint];
      if (parent >= 0 && parent !== joint) paths[joint] = paths[parent] + model.skeleton.localOffsets[joint].length();
    }
    let radius = 0;
    // Fixed rig lengths and normalized skin weights bound all rotated skin positions about the root.
    for (let vertex = 0; vertex < model.skinRest.length / 3; vertex += 1) {
      let extent = 0;
      const offset = vertex * 3;
      for (let slot = 0; slot < 8; slot += 1) {
        const index = vertex * 8 + slot, weight = model.skinWeights[index];
        if (!weight) continue;
        const joint = model.skinIndices[index], origin = joint * 3;
        extent += weight * (paths[joint] + Math.hypot(model.skinRest[offset] - model.bindOrigins[origin], model.skinRest[offset + 1] - model.bindOrigins[origin + 1], model.skinRest[offset + 2] - model.bindOrigins[origin + 2]));
      }
      radius = Math.max(radius, extent);
    }
    model.motionFramingRadius = radius * 1.01;
  }
  const bounds = new THREE.Box3(), root = model.skeleton.order[0], point = new THREE.Vector3();
  for (let frame = 0; frame < motion.times.length; frame += 1) bounds.expandByPoint(point.fromArray(motion.positions, (frame * model.jointCount + root) * 3));
  return bounds.expandByScalar(model.motionFramingRadius + (adjusted ? .050001 : 0));
}

function setCameraFollowing(following) {
  if (state.simulationMode !== 'playback') return false;
  state.followMotion = Boolean(following);
  ui['camera-follow'].setAttribute('aria-pressed', String(state.followMotion));
  ui['camera-follow'].classList.toggle('active', state.followMotion);
  ui['camera-follow'].dataset.tooltip = state.followMotion ? 'Fix camera in world' : 'Follow horizontal motion';
  if (activeModel) frameBody(['front', 'side', 'back'].includes(state.camera) ? state.camera : 'front');
  return true;
}

// Enforces phi_S(x) <= -delta for every anatomy vertex of the displayed frame (see
// containment_projection.js). The uncorrected source pose is kept per mesh so the
// projection can be toggled without re-posing.
function applyContainmentProjection(model, cacheKey = null) {
  model.muscleFrameKey = null;   // set below only when this frame's fit is a keyed, reproducible one
  for (const { mesh } of model.bones) (mesh.userData.sourceMatrix ||= new THREE.Matrix4()).copy(mesh.matrix);
  if (cacheKey && state.containmentProjection && containmentPool && !state.verifiedPose) {
    const [motionId, index] = cacheKey.split('|');
    if (!(model.containmentSnapshotOK && motionId in model.containmentSnapshotOK)) {
      if (verifyContainmentSnapshot(model, motionId, Number(index))) queueMicrotask(() => prefetchContainment(model, motionId));
    }
  }
  model.boneDisplacements = null;
  if (!state.containmentProjection || typeof ContainmentProjector === 'undefined') { state.containmentReport = null; updateContainmentProjectionStatus(); return null; }
  containmentProjector ||= new ContainmentProjector();
  model.containmentCache ||= new Map();
  const loadingMotion = cacheKey && model.precomputedState?.[cacheKey.split('|')[0]] === 'pending';
  if (loadingMotion && !model.containmentCache.has(cacheKey)) {
    model.anatomy.visible = false;
    model.anatomyHiddenForFit = true;
    state.containmentReport = null;
    if (ui['containment-projection-status']) ui['containment-projection-status'].textContent = 'Loading anatomy fit for this motion.';
    return null;
  }
  if (model.anatomyHiddenForFit) { model.anatomy.visible = state.anatomy; model.anatomyHiddenForFit = false; }
  let result = cacheKey ? model.containmentCache.get(cacheKey) : null;
  if (!result) {
    const bones = model.bones.map(({ mesh, control, spec }) => ({ name: spec.name, local: mesh.geometry.getAttribute('position').array,
      matrix: mesh.matrix.elements, anchor: state.verifiedPose || !model.rigPositions ? null : Array.from(model.rigPositions.subarray(control * 3, control * 3 + 3)) }));
    const [motionKey, frameKey] = cacheKey ? cacheKey.split('|') : [null, null];
    const previous = model.lastContainment;
    const warm = previous && cacheKey && previous.motion === motionKey && previous.frame === Number(frameKey) - 1 ? previous.warm : null;
    result = containmentProjector.project(model.skinPositions, model.sourceTopology.skin_faces, bones, { bodyHeight: model.bounds.max.z - model.bounds.min.z, warm });
    model.lastContainment = cacheKey ? { motion: motionKey, frame: Number(frameKey), warm: result.warm } : null;
    if (cacheKey) model.containmentCache.set(cacheKey, result);
  }
  const { corrections, displacements, report } = result;
  corrections.forEach((correction, index) => {
    if (!correction) return;
    const mesh = model.bones[index].mesh;
    mesh.matrix.premultiply(scratchMatrix.fromArray(correction));
    mesh.matrixWorldNeedsUpdate = true;
  });
  // Displacements are world offsets after the matrix correction: x' = C M x + D.
  model.bones.forEach(({ mesh }, index) => setContainmentDeformation(mesh, displacements?.[index] || null));
  model.boneDisplacements = displacements || null;   // muscles follow D at their attachments
  model.muscleFrameKey = cacheKey && !state.verifiedPose ? cacheKey : null;
  state.containmentReport = report;
  updateContainmentProjectionStatus();
  return report;
}

function restoreContainmentSource(model) {
  for (const { mesh } of model.bones) {
    if (mesh.userData.sourceMatrix) { mesh.matrix.copy(mesh.userData.sourceMatrix); mesh.matrixWorldNeedsUpdate = true; }
    setContainmentDeformation(mesh, null);
  }
  model.boneDisplacements = null;
}

// Local containment deformations are shown as one relative morph target, so the source
// bone geometry is never modified. World displacements are mapped through the inverse of the
// mesh's current (corrected) linear transform.
const containmentMorphInverse = new THREE.Matrix3();
function setContainmentDeformation(mesh, displacement) {
  const geometry = mesh.geometry;
  let attribute = geometry.morphAttributes.position?.[0];
  if (!displacement) {
    if (attribute && mesh.morphTargetInfluences?.[0]) {
      mesh.morphTargetInfluences[0] = 0;
      mesh.userData.containmentDeformed = false;
    }
    return;
  }
  const count = geometry.getAttribute('position').count;
  if (!attribute || attribute.count !== count || !attribute.userData?.containment) {
    attribute = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    attribute.userData = { containment: true };
    geometry.morphAttributes.position = [attribute];
    geometry.morphTargetsRelative = true;
    mesh.updateMorphTargets();
  }
  const e = containmentMorphInverse.setFromMatrix4(mesh.matrix).invert().elements, out = attribute.array;
  for (let i = 0; i < count * 3; i += 3) {
    const x = displacement[i], y = displacement[i + 1], z = displacement[i + 2];
    out[i] = e[0] * x + e[3] * y + e[6] * z; out[i + 1] = e[1] * x + e[4] * y + e[7] * z; out[i + 2] = e[2] * x + e[5] * y + e[8] * z;
  }
  attribute.needsUpdate = true;
  geometry.dispose(); // rebuilds the morph texture with the new displacements
  mesh.morphTargetInfluences[0] = 1;
  mesh.userData.containmentDeformed = true;
}

function setContainmentProjection(enabled) {
  state.containmentProjection = Boolean(enabled);
  ui['containment-projection-toggle'].checked = state.containmentProjection;
  if (activeModel && state.loaded) {
    restoreContainmentSource(activeModel);
    applyContainmentProjection(activeModel);
    renderDirty = true;
  }
  return state.containmentReport;
}

function updateContainmentProjectionStatus() {
  const status = ui['containment-projection-status'];
  if (!status) return;
  const report = state.containmentReport;
  if (!state.containmentProjection || !report) { status.textContent = state.containmentProjection ? '' : 'Off: source anatomy pose shown unchanged.'; return; }
  const corrected = report.corrected_bones;
  status.textContent = !report.closed_skin ? 'Skin surface is not closed; containment cannot be certified for this body.'
    : report.failed_bones
    ? `${report.failed_bones} mesh(es) could not be contained in this frame.`
    : corrected
      ? `All ${report.checked_vertices.toLocaleString()} anatomy vertices inside skin (δ = ${report.margin_mm.toFixed(2)} mm). ${corrected} mesh(es) corrected: max shift ${report.max_translation_mm.toFixed(1)} mm, min scale ${report.min_scale.toFixed(3)}, ${report.deformed_bones} locally deformed (max ${report.max_deformation_mm.toFixed(1)} mm).`
      : `All ${report.checked_vertices.toLocaleString()} anatomy vertices inside skin (δ = ${report.margin_mm.toFixed(2)} mm); no correction needed.`;
  status.classList.toggle('containment-projection-failed', !report.all_vertices_contained);
  const progress = containmentPool && activeModel?.containmentSnapshotOK?.[state.motionId] ? containmentPrefetchStatus(activeModel, state.motionId) : null;
  if (progress && progress.done < progress.total) status.textContent += ` Preparing motion: ${Math.round(100 * progress.done / progress.total)}%.`;
}

// ---- Precomputed containment fits ----
// scripts/precompute_containment.mjs stores every keyframe's fit per case and motion. A file is
// used only when it was produced by this exact containment module from this exact case buffer,
// and (as for worker results) only after the displayed keyframe pose is verified to equal the
// snapshot the fit was computed from.
async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

let jointsModuleSha256 = null;
function jointsModuleHash() {
  jointsModuleSha256 ||= fetch(new URL('./anatomical_joints.js', window.location.href), { cache: 'no-cache' })
    .then((r) => r.arrayBuffer()).then(sha256Hex);
  return jointsModuleSha256;
}
let containmentModuleSha256 = null;
async function containmentModuleHash() {
  containmentModuleSha256 ||= fetch(new URL('./containment_projection.js', window.location.href), { cache: 'no-cache' })
    .then((response) => response.arrayBuffer()).then(sha256Hex);
  return containmentModuleSha256;
}

function loadPrecomputedContainment(model, caseId, motionId) {
  model.precomputedState ||= {};
  model.precomputedLoads ||= {};
  if (model.precomputedLoads[motionId]) return model.precomputedLoads[motionId];
  model.precomputedState[motionId] = 'pending';
  const load = (async () => {
    const base = new URL(`./cases/${caseId}.containment/${motionId}`, manifestURL).href;
    const metaResponse = await fetch(base + '.json');
    if (!metaResponse.ok) return false;
    const meta = await metaResponse.json();
    const motion = model.motions[motionId];
    if (meta.schema !== 'containment_precomputed_v2' || meta.case_id !== caseId || meta.motion_id !== motionId
        || meta.bone_count !== model.bones.length || meta.frame_count !== motion?.times.length
        || meta.case_buffer_sha256 !== model.caseBufferSha256 || meta.module_sha256 !== await containmentModuleHash()
        || meta.joints_sha256 !== await jointsModuleHash()) return false;
    const response = await fetch(base + '.bin');
    if (!response.ok || typeof DecompressionStream === 'undefined') return false;
    const raw = await new Response(response.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
    const matrices = new Float32Array(raw, 0, meta.matrix_count * 16);
    const values = new Int16Array(raw, meta.matrix_count * 64, meta.displacement_value_count);
    const previous = new Map();
    let cursor = 0;
    model.containmentCache ||= new Map();
    meta.frames.forEach((frame, index) => {
      const corrections = new Array(model.bones.length).fill(null), displacements = new Array(model.bones.length).fill(null), seen = new Set();
      for (const entry of frame.entries) {
        if (entry.matrix !== undefined) corrections[entry.bone] = Array.from(matrices.subarray(entry.matrix * 16, entry.matrix * 16 + 16));
      }
      // The writer emits displacement values in bone-index order (not entry order): read them
      // the same way, otherwise displacements land on the wrong bones.
      for (const entry of [...frame.entries].filter((row) => row.count).sort((a, b) => a.bone - b.bone)) {
        {
          const base = entry.delta ? previous.get(entry.bone) : null, quantized = new Int32Array(entry.count), displacement = new Float32Array(entry.count);
          for (let k = 0; k < entry.count; k += 1) {
            quantized[k] = (base ? base[k] : 0) + values[cursor + k];
            displacement[k] = quantized[k] * meta.step_m;
          }
          cursor += entry.count;
          previous.set(entry.bone, quantized); seen.add(entry.bone);
          displacements[entry.bone] = displacement;
        }
      }
      for (const bone of [...previous.keys()]) if (!seen.has(bone)) previous.delete(bone);
      const key = `${motionId}|${index}`;
      if (!model.containmentCache.has(key)) model.containmentCache.set(key, { corrections, displacements, report: { ...frame.report, rows: [] } });
    });
    if (cursor !== meta.displacement_value_count) throw new Error('Precomputed containment stream is incomplete');
    return true;
  })().catch(() => false).then((ok) => {
    model.precomputedState[motionId] = ok ? 'ready' : 'missing';
    return ok;
  });
  model.precomputedLoads[motionId] = load;
  return load;
}

// ---- Background containment fitting (Web Workers) ----
// Keyframes of the selected motion are fitted ahead of playback in a small worker pool.
// Snapshots come straight from the stored keyframe transforms and are used only after they
// have been verified to reproduce the displayed pose exactly for this model and motion.
const containmentPool = (() => {
  if (typeof Worker === 'undefined') return null;
  const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  let workers;
  try { workers = Array.from({ length: size }, () => new Worker(new URL('./containment_worker.js', window.location.href), { type: 'module' })); }
  catch { return null; }
  const pending = new Map(), load = new Array(size).fill(0);
  let serial = 0, modelSerial = 0;
  workers.forEach((worker, index) => {
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id); load[index] -= 1;
      if (data.error) job.reject(new Error(data.error)); else job.resolve(data);
    };
    worker.onerror = () => { for (const [id, job] of pending) if (job.worker === index) { pending.delete(id); job.reject(new Error('Containment worker failed')); } };
  });
  return {
    size,
    ensure(model) {
      if (model.containmentWorkerKey) return model.containmentWorkerKey;
      const key = `model${++modelSerial}`;
      const bones = model.bones.map(({ mesh, spec }) => ({ name: spec.name, local: new Float32Array(mesh.geometry.getAttribute('position').array) }));
      for (const worker of workers) worker.postMessage({ type: 'init', modelKey: key, faces: model.sourceTopology.skin_faces, bones });
      model.containmentWorkerKey = key;
      return key;
    },
    project(model, snapshot, { worker = null, sequence = null, frame = null } = {}) {
      const modelKey = this.ensure(model);
      const index = worker ?? load.indexOf(Math.min(...load));
      const id = ++serial;
      load[index] += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, worker: index });
        workers[index].postMessage({ type: 'project', id, modelKey, sequence, frame, ...snapshot },
          [snapshot.skin.buffer, snapshot.matrices.buffer, ...(snapshot.anchors ? [snapshot.anchors.buffer] : [])]);
      });
    },
  };
})();

function containmentSnapshot(model, motionId, index) {
  const motion = model.motions[motionId], jointCount = model.jointCount;
  const source = motion.sourceTransforms;
  const deltas = new Float64Array(jointCount * 16);
  for (let joint = 0; joint < jointCount; joint += 1) {
    // Stored row-major; convert to column-major like THREE.Matrix4.elements.
    const o = (index * jointCount + joint) * 16;
    for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) deltas[joint * 16 + c * 4 + r] = source[o + r * 4 + c];
  }
  const rest = model.skinRest, count = rest.length / 3, skin = new Float32Array(rest.length);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = rest[vertex * 3], y = rest[vertex * 3 + 1], z = rest[vertex * 3 + 2];
    let px = 0, py = 0, pz = 0;
    for (let influence = 0; influence < 8; influence += 1) {
      const slot = vertex * 8 + influence, weight = model.skinWeights[slot];
      if (weight === 0) continue;
      const e = model.skinIndices[slot] * 16;
      px += weight * (deltas[e] * x + deltas[e + 4] * y + deltas[e + 8] * z + deltas[e + 12]);
      py += weight * (deltas[e + 1] * x + deltas[e + 5] * y + deltas[e + 9] * z + deltas[e + 13]);
      pz += weight * (deltas[e + 2] * x + deltas[e + 6] * y + deltas[e + 10] * z + deltas[e + 14]);
    }
    skin[vertex * 3] = px; skin[vertex * 3 + 1] = py; skin[vertex * 3 + 2] = pz;
  }
  const matrices = new Float64Array(model.bones.length * 16), anchors = new Float64Array(model.bones.length * 3);
  model.bones.forEach(({ control }, bone) => {
    matrices.set(deltas.subarray(control * 16, control * 16 + 16), bone * 16);
    const e = control * 16, x = model.bindOrigins[control * 3], y = model.bindOrigins[control * 3 + 1], z = model.bindOrigins[control * 3 + 2];
    anchors[bone * 3] = deltas[e] * x + deltas[e + 4] * y + deltas[e + 8] * z + deltas[e + 12];
    anchors[bone * 3 + 1] = deltas[e + 1] * x + deltas[e + 5] * y + deltas[e + 9] * z + deltas[e + 13];
    anchors[bone * 3 + 2] = deltas[e + 2] * x + deltas[e + 6] * y + deltas[e + 10] * z + deltas[e + 14];
  });
  return { skin, matrices, anchors, bodyHeight: model.bounds.max.z - model.bounds.min.z };
}

// True when the snapshot of the displayed keyframe equals the displayed source pose.
function verifyContainmentSnapshot(model, motionId, index) {
  model.containmentSnapshotOK ||= {};
  if (motionId in model.containmentSnapshotOK) return model.containmentSnapshotOK[motionId];
  const snapshot = containmentSnapshot(model, motionId, index);
  let error = 0;
  for (let i = 0; i < snapshot.skin.length; i += 1) error = Math.max(error, Math.abs(snapshot.skin[i] - model.skinPositions[i]));
  model.bones.forEach(({ mesh }, bone) => {
    const source = mesh.userData.sourceMatrix?.elements;
    if (!source) { error = Infinity; return; }
    for (let k = 0; k < 16; k += 1) error = Math.max(error, Math.abs(snapshot.matrices[bone * 16 + k] - source[k]));
  });
  model.containmentSnapshotOK[motionId] = error < 2e-5;
  return model.containmentSnapshotOK[motionId];
}

let containmentPrefetchGeneration = 0;
function containmentPrefetchStatus(model, motionId) {
  const motion = model?.motions[motionId];
  if (!motion || !model.containmentCache) return null;
  let done = 0;
  for (let i = 0; i < motion.times.length; i += 1) if (model.containmentCache.has(`${motionId}|${i}`)) done += 1;
  return { done, total: motion.times.length };
}

function prefetchContainment(model, motionId) {
  const generation = ++containmentPrefetchGeneration;
  if (!containmentPool || !state.containmentProjection || state.verifiedPose || !model?.motions[motionId]) return;
  if (!model.containmentSnapshotOK?.[motionId]) return;
  model.containmentCache ||= new Map();
  const motion = model.motions[motionId], count = motion.times.length;
  const start = Math.max(0, motion.times.findIndex((t) => t - motion.times[0] >= state.time - 1e-9));
  // Contiguous chunks, one per worker, each fitted in frame order (temporal warm start).
  const size = containmentPool.size, chunk = Math.ceil(count / size);
  for (let worker = 0; worker < size; worker += 1) {
    const frames = [];
    for (let k = worker * chunk; k < Math.min(count, (worker + 1) * chunk); k += 1) frames.push((start + k) % count);
    const run = async () => {
      for (const index of frames) {
        if (generation !== containmentPrefetchGeneration || activeModel !== model || state.motionId !== motionId) return;
        const key = `${motionId}|${index}`;
        if (model.containmentCache.has(key)) continue;
        try {
          const result = await containmentPool.project(model, containmentSnapshot(model, motionId, index),
            { worker, sequence: `${motionId}:${generation}:${worker}`, frame: index });
          if (!model.containmentCache.has(key)) model.containmentCache.set(key, result);
        } catch { /* the synchronous path still covers this frame */ }
        updateContainmentProjectionStatus();
      }
    };
    run();
  }
}

// Largest playback time not beyond `target` whose nearest keyframes up to it are fitted.
// With the muscle layer shown, playback never skips a keyframe whose muscles are not contained yet
// (~1-2 s each, computed in a worker while the current keyframe stays on screen): the first pass
// through a clip runs slower, showing every keyframe's contained muscles and computed activation;
// later passes replay from the frame cache at full speed.
function musclePlaybackLimit(model, motionId, from, target) {
  if (!state.muscles || !model?.muscles || state.renderer !== 'gallery') return target;
  const motion = model.motions[motionId], cache = model.muscles.cache;
  if (!motion || motion.times.length < 2) return target;
  const base = motion.times[0];
  if (model.muscles.waitingKey) return from;   // the displayed keyframe's muscles are still being contained
  for (let i = 0; i < motion.times.length; i += 1) {
    const t = motion.times[i] - base;
    if (t <= from + 1e-9) continue;
    if (!cache?.has(`${motionId}|${i}`)) {
      // main-thread fallback, or no bone fit cached for it yet: step onto it (contained when shown)
      if (!musclesWorkerReady(model) || !model.containmentCache?.has(`${motionId}|${i}`)) return Math.min(target, t);
      requestMusclePrefetch(model, motionId, i);   // prepared in the worker while this keyframe stays on screen
      const previous = i > 0 ? motion.times[i - 1] - base : 0;
      return Math.min(target, Math.max(from, previous));
    }
    if (t >= target) return target;
  }
  return target;
}

let muscleWorker = null, muscleWorkerFailed = false, muscleRequestOnly = false, muscleModelSerial = 0;
const musclePending = new Set();
function musclesWorkerReady(model) {
  if (muscleWorkerFailed || typeof Worker === 'undefined' || !model?.muscles) return false;
  if (!muscleWorker) {
    try { muscleWorker = new Worker(new URL('./muscle_worker.js', window.location.href), { type: 'module' }); }
    catch (_) { muscleWorkerFailed = true; return false; }
    muscleWorker.onmessage = onMuscleWorkerMessage;
    muscleWorker.onerror = () => { muscleWorkerFailed = true; muscleWorker = null; musclePending.clear(); poseDirty = true; };
  }
  if (!model.muscles.workerKey) {
    model.muscles.workerKey = `muscles${++muscleModelSerial}`;
    muscleWorker.postMessage({ type: 'init', modelKey: model.muscles.workerKey, faces: model.sourceTopology.skin_faces,
      closure: model.muscles.closure, ring: muscleTopology.meta.ring,
      muscles: muscleTopology.meta.muscles.map(({ vertex_start, vertex_count }) => ({ vertex_start, vertex_count })) });
  }
  return true;
}

function postMuscleJob(model, key, out, anchors) {
  const id = `${model.muscles.workerKey}|${key}`;
  if (musclePending.has(id)) return;
  musclePending.add(id);
  muscleWorker.postMessage({ type: 'contain', id, key, modelKey: model.muscles.workerKey, skin: Float32Array.from(model.skinPositions),
    positions: Float32Array.from(out), anchors: anchors ? Float32Array.from(anchors) : null, bodyHeight: model.bounds.max.z - model.bounds.min.z });
}

function onMuscleWorkerMessage({ data }) {
  musclePending.delete(data.id);
  const model = activeModel;
  if (!model?.muscles || model.muscles.workerKey !== data.modelKey) return;
  if (data.error) { muscleWorkerFailed = true; poseDirty = true; return; }   // fall back to the main thread
  const cache = (model.muscles.cache ||= new Map());
  if (cache.size >= 320) cache.delete(cache.keys().next().value);
  cache.set(data.key, { rings: data.rings, positions: data.positions, stats: data.stats });
  if (model.muscles.waitingKey === data.key && model.muscleFrameKey === data.key) {
    model.muscles.waitingKey = null;
    updateMuscleLayer(model);
    renderDirty = true;
  }
}

// Prepare keyframe `index` for the worker: evaluate its pose (bones from the cached fit only),
// post its muscles, then the displayed pose is re-evaluated from the caches in this frame.
function requestMusclePrefetch(model, motionId, index) {
  const key = `${motionId}|${index}`;
  if (!model.muscles?.workerKey || musclePending.has(`${model.muscles.workerKey}|${key}`) || musclePending.size >= 2) return;
  if (!model.containmentCache?.has(key)) return;   // bone fit not ready: never fitted synchronously here
  const motion = model.motions[motionId], keep = state.time;
  muscleRequestOnly = key;
  try { state.time = motion.times[index] - motion.times[0]; updatePoseAt(key); }
  finally { muscleRequestOnly = false; state.time = keep; }
  poseDirty = true;
}

function containmentPlaybackLimit(model, motionId, from, target) {
  if (!state.containmentProjection || !model?.containmentSnapshotOK?.[motionId] || !containmentPool) return target;
  const motion = model.motions[motionId], cache = model.containmentCache;
  if (!cache) return from;
  const base = motion.times[0];
  for (let i = 0; i < motion.times.length; i += 1) {
    const t = motion.times[i] - base;
    if (t <= from + 1e-9) continue;
    if (!cache.has(`${motionId}|${i}`)) {
      // Playback snaps to the nearest keyframe: stay before the midpoint to an unfitted one.
      const previous = i > 0 ? motion.times[i - 1] - base : t;
      return Math.min(target, Math.max(from, (previous + t) / 2 - 1e-6));
    }
    if (t >= target) return target;
  }
  return target;
}

// With the containment projection on, playback shows the motion's source frames so each
// projected frame is computed once and reused; paused poses are projected at any time.
function containmentFrameKey(model) {
  if (!state.containmentProjection || state.verifiedPose) return null;
  const motion = model.motions[state.motionId];
  if (!motion) return null;
  if (state.motionId === 'physics_live') return { key: `physics_live|${model.physicsSerial || 0}`, time: 0 };
  if (motion.restIdentity || motion.times.length < 2) return { key: `${state.motionId}|0`, time: state.time };
  const target = state.time + motion.times[0];
  let index = 0;
  for (let i = 1; i < motion.times.length; i += 1) if (Math.abs(motion.times[i] - target) < Math.abs(motion.times[index] - target)) index = i;
  const time = motion.times[index] - motion.times[0];
  if (!state.playing && Math.abs(time - state.time) > 1e-9) return null;
  return { key: `${state.motionId}|${index}`, time };
}

function updatePose() {
  if (!activeModel || !state.loaded || !poseDirty || state.verifiedPose) return;
  const frame = typeof containmentFrameKey === 'function' ? containmentFrameKey(activeModel) : null, liveTime = state.time;
  if (frame) state.time = frame.time;
  try { updatePoseAt(frame?.key ?? null); } finally { state.time = liveTime; }
}

function updatePoseAt(containmentKey) {
  const model = activeModel;
  const motion = model.motions[state.motionId];
  const { lo, hi, alpha } = motionInterval(motion, state.time);
  const floorOffset = motionFloorOffset(model.motionAdjustments?.[state.motionId], state.time);
  for (const joint of model.skeleton.order) {
    if (motion.restIdentity) {
      model.deltas[joint].identity();
      model.rigPositions.set(model.bindOrigins.subarray(joint * 3, joint * 3 + 3), joint * 3);
      continue;
    }
    const a = lo * model.jointCount + joint;
    const b = hi * model.jointCount + joint;
    scratchPosition.fromArray(motion.positions, a * 3);
    scratchVector.fromArray(motion.positions, b * 3);
    scratchPosition.lerp(scratchVector, alpha);
    scratchQuaternion.fromArray(motion.quaternions, a * 4);
    scratchQuaternion2.fromArray(motion.quaternions, b * 4);
    scratchQuaternion.slerp(scratchQuaternion2, alpha).normalize();
    const terminalBind = model.terminalCorrections?.clips[state.motionId]?.byIndex[joint];
    if (terminalBind) scratchQuaternion.fromArray(terminalBind);
    scratchMatrix.compose(scratchPosition, scratchQuaternion, unitScale);
    const parent = model.skeleton.parents[joint];
    if (parent < 0 || parent === joint) {
      model.posedFrames[joint].copy(scratchMatrix);
      model.posedFrames[joint].elements[14] += floorOffset;
    }
    else model.posedFrames[joint].multiplyMatrices(model.posedFrames[parent], scratchMatrix);
    model.deltas[joint].multiplyMatrices(model.posedFrames[joint], model.skeleton.inverseBindMatrices[joint]);
    scratchVector.fromArray(model.bindOrigins, joint * 3).applyMatrix4(model.deltas[joint]).toArray(model.rigPositions, joint * 3);
  }
  const stressTest = model.stressMotionIds?.has(state.motionId) === true;
  const coupledPose = !stressTest && model.coupledKneeMotion?.evaluate(state.motionId, state.time + motion.times[0]) || null;
  const normals = model.skin.geometry.getAttribute('normal').array;
  const predecessorRest = coupledPose || skinRestForPose(model, state.motionId, state.time);
  const activeRest = model.scopedSkinRest
    ? scopedSkinRestForPose(model, predecessorRest, state.motionId, state.time) : predecessorRest;
  // Native skinning has seven influences; the binary layout pads to eight.
  for (let vertex = 0; vertex < model.skinRest.length / 3; vertex += 1) {
    const offset = vertex * 3;
    if (motion.restIdentity) {
      model.skinPositions.set(activeRest.positions.subarray(offset, offset + 3), offset);
      normals.set(activeRest.normals.subarray(offset, offset + 3), offset);
      continue;
    }
    const x = activeRest.positions[offset], y = activeRest.positions[offset + 1], z = activeRest.positions[offset + 2];
    const nx = activeRest.normals[offset], ny = activeRest.normals[offset + 1], nz = activeRest.normals[offset + 2];
    let px = 0, py = 0, pz = 0, normalX = 0, normalY = 0, normalZ = 0;
    for (let influence = 0; influence < 8; influence += 1) {
      const skinOffset = vertex * 8 + influence;
      const weight = model.skinWeights[skinOffset];
      if (weight === 0) continue;
      const e = model.deltas[model.skinIndices[skinOffset]].elements;
      px += weight * (e[0] * x + e[4] * y + e[8] * z + e[12]);
      py += weight * (e[1] * x + e[5] * y + e[9] * z + e[13]);
      pz += weight * (e[2] * x + e[6] * y + e[10] * z + e[14]);
      normalX += weight * (e[0] * nx + e[4] * ny + e[8] * nz);
      normalY += weight * (e[1] * nx + e[5] * ny + e[9] * nz);
      normalZ += weight * (e[2] * nx + e[6] * ny + e[10] * nz);
    }
    model.skinPositions[offset] = px;
    model.skinPositions[offset + 1] = py;
    model.skinPositions[offset + 2] = pz;
    const norm = Math.hypot(normalX, normalY, normalZ) || 1;
    normals[offset] = normalX / norm;
    normals[offset + 1] = normalY / norm;
    normals[offset + 2] = normalZ / norm;
  }
  model.skin.geometry.getAttribute('position').needsUpdate = true;
  model.skin.geometry.getAttribute('normal').needsUpdate = true;
  for (const { mesh, control, spec } of model.bones) {
    const coupledFrame = coupledPose?.frames[spec.name];
    const patellaIndex = stressTest ? -1 : model.patellaMotion?.names.indexOf(spec.name) ?? -1;
    if (coupledFrame) {
      mesh.matrix.fromArray(coupledFrame);
    } else if (patellaIndex >= 0) {
      const track = model.patellaMotion.clips[state.motionId];
      scratchPosition.fromArray(track.translations_m, (lo * 2 + patellaIndex) * 3);
      scratchVector.fromArray(track.translations_m, (hi * 2 + patellaIndex) * 3);
      scratchPosition.lerp(scratchVector, alpha);
      scratchQuaternion.fromArray(track.rotations_xyzw, (lo * 2 + patellaIndex) * 4);
      scratchQuaternion2.fromArray(track.rotations_xyzw, (hi * 2 + patellaIndex) * 4);
      scratchQuaternion.slerp(scratchQuaternion2, alpha).normalize();
      mesh.matrix.compose(scratchPosition, scratchQuaternion, unitScale);
    } else if (!stressTest && model.lumbarMotion?.names.includes(spec.name)) {
      mesh.matrix.copy(lumbarPoseDelta(model, spec.name, model.motions[state.motionId].restIdentity) || model.deltas[control]);
    } else mesh.matrix.copy(model.deltas[control]);
    mesh.matrixWorldNeedsUpdate = true;
  }
  // SKEL-level joints: forearm pronation (radius about the ulna) and scapulohumeral rhythm.
  if (model.jointsRest !== model.boneRest) {
    model.jointsRest = model.boneRest;
    model.anatomicalJoints = prepareAnatomicalJoints({ boneRest: model.boneRest, meshes: model.bones.map(({ spec }) => spec),
      bindRowMajor: model.sourceBindFrames, names: model.sourceRig.names, parents: model.sourceRig.parents });
  }
  if (model.anatomicalJoints) {
    const { matrices, angles } = derivedBoneMatrices(model.anatomicalJoints, (j) => model.deltas[j].elements);
    for (const [index, matrix] of matrices) { model.bones[index].mesh.matrix.fromArray(matrix); model.bones[index].mesh.matrixWorldNeedsUpdate = true; }
    model.jointAngles = angles;
  }
  if (typeof applyContainmentProjection === 'function') applyContainmentProjection(model, containmentKey);
  if (typeof updateMuscleLayer === 'function') updateMuscleLayer(model);
  for (let link = 0; link < model.links.length; link += 1) {
    const [parent, joint] = model.links[link];
    model.linePositions.set(model.rigPositions.subarray(parent * 3, parent * 3 + 3), link * 6);
    model.linePositions.set(model.rigPositions.subarray(joint * 3, joint * 3 + 3), link * 6 + 3);
  }
  model.lineGeometry.getAttribute('position').needsUpdate = true;
  model.pointGeometry.getAttribute('position').needsUpdate = true;
  currentBounds.setFromBufferAttribute(model.skin.geometry.getAttribute('position'));
  // Include every bone even when its layer is hidden, so layer toggles cannot alter clipping.
  cameraGeometryBounds.copy(currentBounds);
  for (const { mesh } of model.bones) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    cameraGeometryBounds.union(scratchBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrix));
  }
  const root = model.skeleton.order[0];
  const rootPosition = new THREE.Vector3().fromArray(model.rigPositions, root * 3);
  const movement = cameraTrackingDelta(model.trackedRoot, rootPosition, state.followMotion);
  camera.position.add(movement);
  controls.target.add(movement);
  model.trackedRoot = rootPosition;
  if (state.renderer === 'gallery') ui['frame-value'].textContent = `Frame ${(alpha === 1 ? hi : lo) + 1} / ${motion.times.length}`;
  poseDirty = false;
}

function updateCameraButtons() {
  document.querySelectorAll('[data-camera]').forEach((button) => {
    const active = button.dataset.camera === state.camera;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function metricFramingBounds(bounds, neutralBounds, enabled) {
  const framed = bounds.clone();
  if (!enabled) return framed;
  const center = bounds.getCenter(new THREE.Vector3());
  const floor = neutralBounds.min.z;
  framed.expandByPoint(new THREE.Vector3(center.x - 1, center.y - .3, floor));
  framed.expandByPoint(new THREE.Vector3(center.x + 1, center.y + .3, floor + 2));
  return framed;
}

function setMetricFraming(enabled) {
  state.metricFraming = Boolean(enabled);
  ui['camera-metric'].setAttribute('aria-pressed', String(state.metricFraming));
  ui['camera-metric'].classList.toggle('active', state.metricFraming);
  ui['camera-metric'].dataset.tooltip = state.metricFraming ? 'Frame each body individually' : 'Use shared metric framing';
  if (activeModel) frameBody(['front', 'side', 'back'].includes(state.camera) ? state.camera : 'front');
  return state.metricFraming;
}

function updateMetricScaleGuide() {
  const guide = ui['metric-scale-guide'];
  if (!state.metricFraming || !activeModel || !state.loaded) { guide.hidden = true; return; }
  const lower = new THREE.Vector3(controls.target.x, controls.target.y, activeModel.bounds.min.z);
  const upper = lower.clone().add(new THREE.Vector3(0, 0, 2));
  lower.project(camera); upper.project(camera);
  const height = $('scene-host').clientHeight;
  const top = (1 - upper.y) * height / 2, bottom = (1 - lower.y) * height / 2;
  guide.hidden = !Number.isFinite(top + bottom) || top < 8 || bottom > height - 8 || bottom - top < 35;
  if (!guide.hidden) {
    guide.style.top = `${top}px`;
    guide.style.height = `${bottom - top}px`;
  }
}

function frameBody(view = 'front') {
  if (!activeModel) return;
  state.camera = view;
  updateCameraButtons();
  const contentBounds = !state.followMotion && !state.verifiedPose
    ? motionFramingBounds(activeModel, activeModel.motions[state.motionId], activeModel.motionAdjustments?.[state.motionId]?.enabled)
    : currentBounds.isEmpty() ? activeModel.bounds : currentBounds;
  const bounds = metricFramingBounds(contentBounds, activeModel.bounds, state.metricFraming);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const vertical = Math.max(size.z, activeModel.bounds.max.z - activeModel.bounds.min.z) * 1.2;
  const horizontal = (view === 'side' ? size.y : size.x) * 1.26;
  const field = THREE.MathUtils.degToRad(camera.fov);
  const distance = Math.max(vertical / (2 * Math.tan(field / 2)), horizontal / (2 * Math.tan(field / 2) * camera.aspect)) + Math.max(size.x, size.y) * 0.45;
  const direction = view === 'side' ? new THREE.Vector3(1, 0, 0.045) : new THREE.Vector3(0, view === 'back' ? 1 : -1, 0.045);
  camera.position.copy(center).addScaledVector(direction.normalize(), distance);
  camera.near = Math.max(0.001, distance / 1000);
  camera.far = Math.max(50, distance * 20);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.minDistance = Math.max(size.z * 0.15, 0.08);
  controls.maxDistance = Math.max(distance * 5, 5);
  controls.update();
  updateBodyCameraClip();
  ground.position.z = activeModel.bounds.min.z - 0.005;
  grid.position.z = activeModel.bounds.min.z - 0.004;
  updateMetricScaleGuide();
  invalidateNativeFrame();
}

function cameraPose() {
  return { position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray(), fov: camera.fov, near: camera.near, far: camera.far };
}

function setCameraPose(pose) {
  if (!camera || !controls || !pose || !['position', 'target', 'up'].every((key) => Array.isArray(pose[key]) && pose[key].length === 3 && pose[key].every(Number.isFinite))
      || ![pose.fov, pose.near, pose.far].every(Number.isFinite) || pose.fov <= 0 || pose.fov >= 180 || pose.near <= 0 || pose.far <= pose.near) throw new Error('Invalid inspection camera pose.');
  const distance = Math.hypot(...pose.position.map((value, index) => value - pose.target[index]));
  if (distance <= 1e-8 || Math.hypot(...pose.up) <= 1e-8) throw new Error('Inspection camera direction and up vector must be nonzero.');
  controls.minDistance = Math.min(controls.minDistance, distance * 0.5);
  controls.maxDistance = Math.max(controls.maxDistance, distance * 2);
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  camera.position.fromArray(pose.position);
  camera.up.fromArray(pose.up).normalize();
  camera.fov = pose.fov;
  camera.near = pose.near;
  camera.far = pose.far;
  controls.target.fromArray(pose.target);
  camera.updateProjectionMatrix();
  controls.update();
  controls.enableDamping = damping;
  state.camera = 'inspection';
  updateCameraButtons();
  invalidateNativeFrame();
  return cameraPose();
}

function frameRegion(meshNames, view = 'front') {
  if (!activeModel || !state.loaded || !Array.isArray(meshNames) || !meshNames.length || !['front', 'side', 'back'].includes(view)) throw new Error('Loaded body, explicit mesh names and a camera view are required.');
  const requested = new Set(meshNames);
  const selected = activeModel.bones.filter(({ spec }) => requested.has(spec.name));
  if (selected.length !== requested.size) throw new Error('An inspection mesh is not present in this body.');
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  const controlIds = new Set(selected.map(({ control }) => control));
  for (const { mesh } of selected) {
    const vertices = mesh.geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i += 1) bounds.expandByPoint(point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrix));
  }
  let skinVertexCount = 0;
  for (let vertex = 0; vertex < activeModel.skinPositions.length / 3; vertex += 1) {
    let support = 0;
    for (let influence = 0; influence < 8; influence += 1) {
      const offset = vertex * 8 + influence;
      if (controlIds.has(activeModel.skinIndices[offset])) support += activeModel.skinWeights[offset];
    }
    if (support >= 0.25) {
      bounds.expandByPoint(point.fromArray(activeModel.skinPositions, vertex * 3));
      skinVertexCount += 1;
    }
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const vertical = Math.max(size.z, 0.01) * 1.3;
  const horizontal = Math.max(view === 'side' ? size.y : size.x, 0.01) * 1.3;
  const field = THREE.MathUtils.degToRad(camera.fov);
  const distance = Math.max(vertical / (2 * Math.tan(field / 2)), horizontal / (2 * Math.tan(field / 2) * camera.aspect)) + Math.max(size.x, size.y) * 0.6;
  const direction = view === 'side' ? new THREE.Vector3(1, 0, 0.045) : new THREE.Vector3(0, view === 'back' ? 1 : -1, 0.045);
  controls.minDistance = Math.max(0.005, size.length() * 0.02);
  controls.maxDistance = Math.max(10, distance * 10);
  const position = center.clone().addScaledVector(direction.normalize(), distance);
  const clip = bodyCameraClip(cameraGeometryBounds.isEmpty() ? bounds : cameraGeometryBounds, position, center);
  const pose = setCameraPose({ position: position.toArray(), target: center.toArray(), up: [0, 0, 1],
    fov: camera.fov, near: clip.near, far: clip.far });
  return { ...pose, meshNames: [...requested], skinVertexCount, regionBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function updateTimeline() {
  ui['time-slider'].value = String(state.time);
  const shownTime = state.renderer === 'native' && state.nativeFrameClip === state.motionId && Number.isFinite(state.nativeFrameTime) ? state.nativeFrameTime : state.time;
  ui['time-value'].textContent = `${formatTime(shownTime)} / ${formatTime(state.duration)}`;
}

function updateNativeFrameLabel() {
  const motion = activeModel?.motions[state.nativeFrameClip];
  if (state.renderer !== 'native' || !motion || state.nativeFrameClip !== state.motionId) return;
  let lo = 0;
  let hi = motion.times.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (motion.times[mid] <= state.nativeFrameTime) lo = mid + 1;
    else hi = mid;
  }
  ui['frame-value'].textContent = `Frame ${Math.max(1, lo)} / ${motion.times.length}`;
}

function motionClockReady() {
  return state.simulationMode === 'playback' && (state.renderer !== 'native'
    || (state.nativeFrameClip === state.motionId && Number.isFinite(state.nativeFrameTime)));
}

function animate(timestamp) {
  const rawElapsed = lastFrameTime ? Math.max(0, (timestamp - lastFrameTime) / 1000) : 0;
  const elapsed = state.recorded_motion ? rawElapsed : Math.min(rawElapsed, 0.1);
  lastFrameTime = timestamp;
  if (state.playing && state.loaded && motionClockReady()) {
    const target = Math.min(state.duration, state.time + elapsed * state.speed);
    state.time = state.renderer === 'gallery'
      ? musclePlaybackLimit(activeModel, state.motionId, state.time, containmentPlaybackLimit(activeModel, state.motionId, state.time, target)) : target;
    poseDirty = true;
    if (state.time >= state.duration) setPlaying(false);
    updateTimeline();
  }
  renderDirty = renderDirty || poseDirty;
  updatePose();
  controls.update();
  updateBodyCameraClip();
  updateMetricScaleGuide();
  if (state.renderer === 'native' && state.loaded && !(state.generated && state.generationStatus === 'running')) {
    if (state.simulationMode === 'physics' && physicsQueue && !physicsControlPending) {
      const request = physicsFrameRequest();
      const key = JSON.stringify(request) + (state.physicsPlaying ? `:${++physicsRequestSerial}` : '');
      physicsQueue.enqueue(request, key, nativeRevision);
    } else if (state.simulationMode === 'playback' && nativeQueue) {
      const request = nativeFrameRequest();
      nativeQueue.enqueue(request, JSON.stringify(request), nativeRevision);
    }
  } else if (state.renderer === 'gallery' && state.simulationMode === 'physics' && state.physicsBrowser && physicsQueue && !physicsControlPending && state.physicsPlaying) {
    physicsQueue.enqueue(physicsFrameRequest(), `pose:${++physicsRequestSerial}`, nativeRevision);
  }
  if (state.renderer === 'gallery' && renderDirty) {
    renderer.render(scene, camera);
    renderDirty = false;
  }
  state.renderFrame += 1;
}

function chooseByFilters(event) {
  const years = Number(ui['age-select'].value);
  const sex = ui['sex-select'].value;
  const reference = pediatricReferenceCases().find((entry) => Number(entry.years) === years && entry.graphics_sex === sex);
  const selected = event?.target === ui['weight-select'] ? ui['weight-select'].value
    : reference ? 'reference' : ui['weight-select'].value;
  updateShapeOptions(years, sex, selected);
  const weight = Number(ui['weight-select'].value);
  const item = ui['weight-select'].value === 'reference' ? reference
    : manifest.cases.find((entry) => Number(entry.years) === years && String(entry.graphics_sex) === sex && Number(entry.weight) === weight);
  if (item) loadCase(item.id);
}

function bindControls() {
  if (typeof initializeMotionInput === 'function') initializeMotionInput();
  if (typeof initializeMuscleLayer === 'function') initializeMuscleLayer();
  ui['verified-pose-select'].addEventListener('change', () => showVerifiedPose(ui['verified-pose-select'].value));
  ui['camera-follow'].addEventListener('click', () => setCameraFollowing(!state.followMotion));
  ui['camera-metric'].addEventListener('click', () => setMetricFraming(!state.metricFraming));
  ui['pediatric-preset'].addEventListener('change', () => {
    if (!ui['pediatric-preset'].value) { activePediatricPreset = null; renderPediatricPreset(null); }
    else applyPediatricPreset(ui['pediatric-preset'].value);
  });
  ui['measurement-fields'].addEventListener('input', measurementPresetEdited);
  ui['containment-open'].addEventListener('click', openContainmentAudit);
  ui['containment-close'].addEventListener('click', () => ui['containment-dialog'].close());
  ui['containment-run'].addEventListener('click', runContainmentAudit);
  ui['containment-cancel'].addEventListener('click', cancelContainmentAudit);
  ui['containment-download'].addEventListener('click', downloadContainmentAudit);
  for (const mode of ['cohort', 'measurements']) {
    ui[`${mode}-tab`].addEventListener('click', () => setSubjectMode(mode));
    ui[`${mode}-tab`].addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'cohort' : event.key === 'End' ? 'measurements' : mode === 'cohort' ? 'measurements' : 'cohort';
      setSubjectMode(next);
      ui[`${next}-tab`].focus();
    });
  }
  ui['measurement-form'].addEventListener('submit', (event) => { event.preventDefault(); runMeasurementGeneration('skin'); });
  ui['measurement-fields'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-measurement-reference]');
    if (button) openMeasurementReference(button.dataset.measurementReference);
  });
  ui['reference-close'].addEventListener('click', () => ui['measurement-reference'].close());
  ui['measurement-reference'].addEventListener('close', () => { referenceRequest?.abort(); referenceKey = null; });
  ui['reference-previous'].addEventListener('click', () => shiftMeasurementReference(-1));
  ui['reference-next'].addEventListener('click', () => shiftMeasurementReference(1));
  ui['measurement-defaults'].addEventListener('click', resetMeasurementDefaults);
  ui['cancel-generation'].addEventListener('click', cancelMeasurementGeneration);
  ui['add-rig'].addEventListener('click', () => {
    const item = generatedCases.get(state.caseId);
    if (!item || state.generationStatus === 'running') return;
    item.layersAdded.rig = true;
    setLayerVisibility('rig', true);
    updateGeneratedLayers(item);
  });
  ui['add-anatomy'].addEventListener('click', () => runMeasurementGeneration('anatomy'));
  ui['download-measurements'].addEventListener('click', () => {
    if (!measurementDownload) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(measurementDownload, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'body-measurements.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  ui['renderer-select'].addEventListener('change', () => {
    if (ui['renderer-select'].value === 'physics') {
      // Physics services start on demand when the page opened in fast browser playback.
      if (state.physicsAvailable) setPhysicsMode();
      else enableNativeServices().then((ok) => { if (ok && state.physicsAvailable) setPhysicsMode(); });
    } else if (ui['renderer-select'].value === 'native' && !state.nativeAvailable) enableNativeServices().then((ok) => { if (ok) setRenderer('native'); });
    else setRenderer(ui['renderer-select'].value);
  });
  ui['physics-play'].addEventListener('click', () => { setPhysicsPlaying(!state.physicsPlaying); invalidateNativeFrame(); });
  ui['physics-reset'].addEventListener('click', () => physicsControl('reset'));
  ui['physics-push'].addEventListener('click', () => physicsControl('push'));
  ui['physics-proxies'].addEventListener('change', () => invalidateNativeFrame());
  ui['physics-mass'].addEventListener('change', () => {
    if (!ui['physics-mass'].reportValidity()) return;
    invalidatePhysicsControl();
    configuredPhysicsMass = ui['physics-mass'].value === '' ? null : Number(ui['physics-mass'].value);
    setPhysicsPlaying(false);
    invalidateNativeFrame(true);
  });
  ui['subject-select'].addEventListener('change', () => loadCase(ui['subject-select'].value));
  ['age-select', 'sex-select', 'weight-select'].forEach((key) => ui[key].addEventListener('change', chooseByFilters));
  for (const [key, property, group] of [['skin-toggle', 'skin', 'skin'], ['anatomy-toggle', 'anatomy', 'anatomy'], ['rig-toggle', 'rig', 'rig']]) {
    ui[key].addEventListener('change', () => { state[property] = ui[key].checked; if (activeModel) activeModel[group].visible = state[property]; invalidateNativeFrame(); });
  }
  ui['containment-projection-toggle'].checked = state.containmentProjection;
  ui['containment-projection-toggle'].addEventListener('change', () => { setContainmentProjection(ui['containment-projection-toggle'].checked); invalidateNativeFrame(); });
  ui['opacity-slider'].addEventListener('input', () => {
    state.opacity = Number(ui['opacity-slider'].value) / 100;
    ui['opacity-value'].textContent = `${Math.round(state.opacity * 100)}%`;
    if (activeModel) setSkinOpacity(activeModel.skin, state.opacity);
    invalidateNativeFrame();
  });
  ui['motion-select'].addEventListener('change', () => selectMotion(ui['motion-select'].value));
  ui['play-button'].addEventListener('click', () => {
    if (state.time >= state.duration) { state.time = 0; poseDirty = true; invalidateNativeFrame(true); }
    setPlaying(!state.playing);
  });
  ui['replay-button'].addEventListener('click', () => { state.time = 0; poseDirty = true; invalidateNativeFrame(true); updateTimeline(); setPlaying(true); });
  ui['time-slider'].addEventListener('input', () => { setPlaying(false); state.time = Number(ui['time-slider'].value); poseDirty = true; updatePose(); updateTimeline(); invalidateNativeFrame(); });
  ui['speed-select'].addEventListener('change', () => { state.speed = Number(ui['speed-select'].value); });
  document.querySelectorAll('[data-camera]').forEach((button) => button.addEventListener('click', () => frameBody(button.dataset.camera)));
  $('frame-button').addEventListener('click', () => frameBody(state.camera === 'orbit' ? 'front' : state.camera));
  $('retry-button').addEventListener('click', () => { if (manifest && topology) loadCase(state.caseId || manifest.default_case); else window.location.reload(); });
  document.addEventListener('visibilitychange', () => { lastFrameTime = 0; });
}

window.galleryQA = {
  get state() { return { ...state, renderCount: state.renderFrame, meshCount: activeModel?.bones.length || 0 }; },
  get playbackRestriction() { return activeModel?.playbackRestriction ? {
    ...activeModel.playbackRestriction, withheldClipIds: [...activeModel.playbackRestriction.withheldClipIds],
  } : null; },
  get loaded() { return state.loaded; },
  get anatomyRefinement() { return activeModel?.anatomyRefinement || null; },
  get teenRegionalRefinement() { return activeModel?.teenRegionalRefinement || null; },
  get infantNeutralNeckRefinement() { return activeModel?.infantNeutralNeckRefinement ? structuredClone(activeModel.infantNeutralNeckRefinement) : null; },
  get infantNeutralSkinRefinement() { return activeModel?.infantNeutralSkinRefinement ? structuredClone(activeModel.infantNeutralSkinRefinement) : null; },
  get teenNeutralSkinRefinement() { return activeModel?.teenNeutralSkinRefinement ? structuredClone(activeModel.teenNeutralSkinRefinement) : null; },
  get teenNeutralSkinActive() { return teenNeutralSkinActive(activeModel, state.motionId, state.time); },
  get adultNeutralSkinRefinement() { return activeModel?.adultNeutralSkinRefinement ? structuredClone(activeModel.adultNeutralSkinRefinement) : null; },
  get adultNeutralSkinActive() { return teenNeutralSkinActive(activeModel, state.motionId, state.time, 'adult'); },
  get scopedSkinRest() { return activeModel?.scopedSkinRest ? structuredClone({ ...activeModel.scopedSkinRest.binding,
    asset_sha256: activeModel.scopedSkinRest.asset_sha256 }) : null; },
  get scopedSkinRestActive() { return Boolean(activeModel?.scopedSkinRest && state.motionId === 'neutral' && state.time === 0); },
  get regionalSkinMotion() { return activeModel?.regionalSkinMotion ? structuredClone({ ...activeModel.regionalSkinMotion.binding,
    asset_sha256: activeModel.regionalSkinMotion.publication.sha256 }) : null; },
  get regionalSkinMotionActive() { return Boolean(activeModel?.regionalSkinMotion?.clips[state.motionId]); },
  get coupledKneeMotion() { return activeModel?.coupledKneeMotion ? {
    ...activeModel.coupledKneeMotion.binding, asset_sha256: activeModel.coupledKneeMotion.publication.sha256,
  } : null; },
  get coupledKneeMotionActive() { return Boolean(activeModel?.coupledKneeMotion && state.motionId === 'kick_steps'); },
  get disjointCoupledRegionalSkin() { return activeModel?.coupledKneeMotion?.disjointRegionalSkinBinding ?? null; },
  get patellaMotion() { return activeModel?.patellaMotion ? structuredClone({
    asset_sha256: activeModel.patellaMotion.asset_sha256, mesh_names: activeModel.patellaMotion.names,
    qualification: activeModel.patellaMotion.qualification,
  }) : null; },
  get lumbarMotion() { return activeModel?.lumbarMotion ? structuredClone({
    asset_sha256: activeModel.lumbarMotion.asset_sha256, mesh_names: activeModel.lumbarMotion.names,
    source_motion_runtime_sha256: activeModel.lumbarMotion.source_motion_runtime_sha256,
    qualification: activeModel.lumbarMotion.qualification,
  }) : null; },
  get terminalCorrections() { return activeModel?.terminalCorrections || null; },
  get motionAdjustments() { return activeModel?.motionAdjustments || null; },
  get motionCatalog() { return Object.fromEntries(Object.entries(activeModel?.motions || {}).map(([id, motion]) => [id, { label: motion.label, source: motion.source, duration: motion.duration, frameCount: motion.times.length }])); },
  get referenceBank() { return { directory: referenceBankDirectory, provider: referenceManifest?.provider || null, dataset: referenceManifest?.dataset || null }; },
  get terminalSamples() {
    const model = activeModel, entry = model?.terminalCorrections?.clips[state.motionId];
    if (!entry?.enabled) return { skin: [], bones: [] };
    const joints = new Set(entry.controls.map(({ index }) => index)), vertices = new Set();
    for (const joint of joints) {
      let bestVertex = -1, bestWeight = 0;
      for (let vertex = 0; vertex < model.skinRest.length / 3; vertex += 1) {
        for (let slot = 0; slot < 8; slot += 1) {
          const offset = vertex * 8 + slot;
          if (model.skinIndices[offset] === joint && model.skinWeights[offset] > bestWeight) { bestWeight = model.skinWeights[offset]; bestVertex = vertex; }
        }
      }
      if (bestVertex >= 0) vertices.add(bestVertex);
    }
    return { skin: [...vertices].map((index) => ({ index, position: Array.from(model.skinPositions.subarray(index * 3, index * 3 + 3)) })),
      bones: model.bones.filter(({ control }) => joints.has(control)).map(({ spec, mesh }) => ({ name: spec.name, index: spec.vertex_start,
        position: new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), 0).applyMatrix4(mesh.matrix).toArray() })) };
  },
  get containmentResult() { return containmentResult; },
  get containmentProjection() { return state.containmentReport ? structuredClone(state.containmentReport) : null; },
  containmentDebug(name) {
    const bone = activeModel?.bones.find(({ spec }) => spec.name === name);
    if (!bone) return null;
    const { mesh, control } = bone, morph = mesh.geometry.morphAttributes.position?.[0];
    return { local: Array.from(mesh.geometry.getAttribute('position').array), source: mesh.userData.sourceMatrix?.toArray() || null,
      final: mesh.matrix.toArray(), morph: morph ? Array.from(morph.array) : null, deformed: Boolean(mesh.userData.containmentDeformed),
      influence: mesh.morphTargetInfluences?.[0] ?? null, anchor: Array.from(activeModel.rigPositions.subarray(control * 3, control * 3 + 3)) };
  },
  setContainmentProjection,
  get skinFaces() { return activeModel?.sourceTopology.skin_faces || null; },
  get skinPositions() { return activeModel ? new Float32Array(activeModel.skinPositions) : null; },
  muscleWorldPositions() {
    const m = activeModel?.muscles;
    return m && m.mesh.visible ? new Float32Array(m.mesh.geometry.getAttribute('position').array) : null;
  },
  get muscleStats() { return activeModel?.muscles?.last || null; },
  get muscleWorker() { return { started: Boolean(muscleWorker), failed: muscleWorkerFailed, pending: [...musclePending],
    waiting: activeModel?.muscles?.waitingKey || null, cached: activeModel?.muscles?.cache ? [...activeModel.muscles.cache.keys()].slice(-5) : [],
    boneFits: activeModel?.containmentCache ? activeModel.containmentCache.size : 0,
    nextFit: activeModel?.containmentCache?.has(`${state.motionId}|1`) || false }; },
  get muscleActivation() { return activeModel?.muscles?.coloured ? { ...activeModel.muscles.activation } : null; },
  anatomyWorldPositions() {
    if (!activeModel || !state.loaded) return null;
    const out = new Float32Array(activeModel.boneRest.length), point = new THREE.Vector3();
    for (const { mesh, spec } of activeModel.bones) {
      const positions = mesh.geometry.getAttribute('position');
      const morph = mesh.userData.containmentDeformed ? mesh.geometry.morphAttributes.position?.[0] : null;
      for (let index = 0; index < positions.count; index += 1) {
        point.fromBufferAttribute(positions, index);
        if (morph) point.x += morph.array[index * 3], point.y += morph.array[index * 3 + 1], point.z += morph.array[index * 3 + 2];
        point.applyMatrix4(mesh.matrix).toArray(out, (spec.vertex_start + index) * 3);
      }
    }
    return out;
  },
  openContainmentAudit,
  runContainmentAudit,
  cancelContainmentAudit,
  async verifyAnatomyRefinement() {
    return verifyRenderedAnatomyRefinement(activeModel);
  },
  get measurementReference() {
    return { key: referenceKey, open: ui['measurement-reference'].open, data: measurementReference?.data || null,
      figureVertexCount: measurementReference?.group?.children[0]?.geometry?.getAttribute('position')?.count || 0 };
  },
  openMeasurementReference,
  get renderFrame() { return state.renderFrame; },
  get caseIds() { return cohortCases().map((item) => item.id); },
  skinSamples(indices) {
    if (!activeModel || !state.loaded) return null;
    const count = activeModel.skinPositions.length / 3;
    if (!Array.isArray(indices) || !indices.length || indices.length > 1024
      || new Set(indices).size !== indices.length
      || indices.some((index) => !Number.isInteger(index) || index < 0 || index >= count)) {
      throw new Error('One to 1024 distinct valid skin vertex indices are required.');
    }
    return indices.map((index) => ({ index,
      position: Array.from(activeModel.skinPositions.subarray(index * 3, index * 3 + 3)) }));
  },
  boneSamples(names) {
    if (!activeModel || !state.loaded) return null;
    if (!Array.isArray(names) || !names.length || names.length > 8 || new Set(names).size !== names.length) throw new Error('One to eight distinct anatomy mesh names are required.');
    return names.map((name) => {
      const bone = activeModel.bones.find(({ spec }) => spec.name === name);
      if (!bone) throw new Error('Unknown anatomy mesh.');
      const { spec, control, mesh } = bone, vertices = mesh.geometry.getAttribute('position');
      return { name, control, vertex_start: spec.vertex_start,
        positions: Array.from({ length: vertices.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(vertices, index).applyMatrix4(mesh.matrix).toArray()) };
    });
  },
  get samples() {
    if (!activeModel || !state.loaded) return null;
    const model = activeModel;
    const sampleIds = [...new Set([0, Math.floor(model.skinRest.length / 9), Math.floor(model.skinRest.length / 6), model.skinRest.length / 3 - 1, model.mostInfluencesVertex])];
    return {
      skin: sampleIds.map((index) => ({ index, rest: Array.from(model.skinRest.subarray(index * 3, index * 3 + 3)), position: Array.from(model.skinPositions.subarray(index * 3, index * 3 + 3)), indices: Array.from(model.skinIndices.subarray(index * 8, index * 8 + 8)), weights: Array.from(model.skinWeights.subarray(index * 8, index * 8 + 8)) })),
      bones: model.bones.slice(0, 3).map(({ mesh, control, spec }) => {
        const vertices = mesh.geometry.getAttribute('position');
        const first = new THREE.Vector3().fromBufferAttribute(vertices, 0);
        const second = new THREE.Vector3().fromBufferAttribute(vertices, Math.min(1, vertices.count - 1));
        return { name: spec.name, index: spec.vertex_start, control, restDistance: first.distanceTo(second), position: first.clone().applyMatrix4(mesh.matrix).toArray(), posedDistance: first.applyMatrix4(mesh.matrix).distanceTo(second.applyMatrix4(mesh.matrix)) };
      }),
      rig: Array.from(model.rigPositions), deltas: model.deltas.map((matrix) => matrix.toArray()),
      bounds: { min: currentBounds.min.toArray(), max: currentBounds.max.toArray() },
      skinInfluences: 8, maxAuthoredInfluences: model.maxAuthoredInfluences, boneCount: model.bones.length, jointCount: model.jointCount,
      floorOffset: motionFloorOffset(model.motionAdjustments?.[state.motionId], state.time),
    };
  },
  get projectedBounds() {
    if (!activeModel || !state.loaded) return null;
    const min = [Infinity, Infinity];
    const max = [-Infinity, -Infinity];
    const point = new THREE.Vector3();
    for (let offset = 0; offset < activeModel.skinPositions.length; offset += 3) {
      point.fromArray(activeModel.skinPositions, offset).project(camera);
      min[0] = Math.min(min[0], point.x); min[1] = Math.min(min[1], point.y);
      max[0] = Math.max(max[0], point.x); max[1] = Math.max(max[1], point.y);
    }
    return { min, max, allSkinInFrame: Math.min(...min) >= -1 && Math.max(...max) <= 1 };
  },
  get rendererInfo() { return renderer ? { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles } : null; },
  capturePixels: () => {
    if (!renderer || !state.loaded) return null;
    if (state.renderer === 'native') {
      const source = ui['native-frame'];
      if (source.hidden || !source.naturalWidth) return null;
      const canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(source, 0, 0);
      return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { width, height, pixels };
  },
  selectCase: (id) => loadCase(id),
  setCase: (id) => loadCase(id),
  get generatedCaseIds() { return [...generatedCases.keys()]; },
  get measurementSchema() { return measurementSchema; },
  get pediatricPreset() { return activePediatricPreset; },
  applyPediatricPreset,
  setSubjectMode: (mode) => setSubjectMode(mode),
  selectMotion: (id) => selectMotion(id),
  setMotion: (id) => selectMotion(id),
  seek: (time) => { if (state.verifiedPose) return; setPlaying(false); state.time = THREE.MathUtils.clamp(Number(time), 0, state.duration); poseDirty = true; updatePose(); updateTimeline(); invalidateNativeFrame(); },
  // Exact keyframe: exercises the same stored-fit path (precomputed / worker results) as playback.
  seekFrame: (index) => {
    const motion = activeModel?.motions[state.motionId];
    if (!motion || state.verifiedPose) return;
    setPlaying(false);
    state.time = motion.times[Math.max(0, Math.min(motion.times.length - 1, index))] - motion.times[0];
    poseDirty = true; updatePose(); updateTimeline(); invalidateNativeFrame();
  },
  showVerifiedPose,
  geometryDigests: async () => {
    if (!activeModel || !state.loaded) return null;
    updatePose();
    const anatomy = new Float32Array(activeModel.boneRest.length);
    const point = new THREE.Vector3();
    for (const { mesh, spec } of activeModel.bones) {
      const positions = mesh.geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index += 1) point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrix).toArray(anatomy, (spec.vertex_start + index) * 3);
    }
    const digest = async (array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', array)), byte => byte.toString(16).padStart(2, '0')).join('');
    return { skin: await digest(activeModel.skinPositions), anatomy: await digest(anatomy),
      bone_count: activeModel.bones.length,
      all_bones_visible: activeModel.anatomy.visible && activeModel.bones.every(({ mesh }) => mesh.visible),
      skin_visible: activeModel.skin.visible, skin_opacity: activeModel.skin.material.opacity };
  },
  setRenderer: (mode) => mode === 'physics' ? setPhysicsMode() : setRenderer(mode),
  setCamera: (view) => frameBody(view),
  setCameraFollowing,
  setMetricFraming,
  get cameraPose() { return camera && controls ? cameraPose() : null; },
  setCameraPose: (pose) => setCameraPose(pose),
  frameRegion: (meshNames, view = 'front') => frameRegion(meshNames, view),
};

async function start() {
  try {
    refreshIcons();
    bindControls();
    initializeScene();
    await initializeNativeRenderer();
    await initializePhysics();
    manifest = await fetchChecked(manifestURL);
    if (!Array.isArray(manifest.cases) || !manifest.cases.length || !manifest.rig?.names?.length || !Array.isArray(manifest.bone_meshes)) throw new Error('Invalid body gallery manifest.');
    validatePediatricReferenceCases(manifest.pediatric_reference_cases, manifest.cases);
    referenceBankDirectory = selectedReferenceBank(manifest.active_reference_motion_bank);
    referenceManifestURL = new URL(`./${referenceBankDirectory}/manifest.json`, manifestURL);
    referenceManifest = await loadReferenceManifest();
    const topologyBuffer = await fetchChecked(absoluteURL(manifest.topology.url, manifestURL), undefined, false);
    topology = {
      skin_faces: typedArray(topologyBuffer, manifest.topology.arrays.skin_faces, 'skin_faces'),
      bone_faces: typedArray(topologyBuffer, manifest.topology.arrays.bone_faces, 'bone_faces'),
    };
    initializeSelectors();
    const requestedCase = new URLSearchParams(window.location.search).get('case');
    const initialCase = lookupCase(requestedCase)?.id || manifest.default_case || manifest.cases[0].id;
    await loadCase(initialCase);
    await initializeMeasurements();
  } catch (error) {
    showError(error);
  }
}


// Motion input: a text prompt (retrieved recording) or uploaded motion capture (BVH, ASF+AMC),
// retargeted on the server to the selected body and added to its motion list.
function initializeMotionInput() {
  const form = $('motion-input');
  const prompt = $('motion-prompt'), upload = $('motion-upload'), status = $('motion-input-status');
  if (![form, prompt, upload, status].every((element) => typeof element?.addEventListener === 'function')) return;
  const setStatus = (text, error = false) => { status.textContent = text; status.title = text; status.classList.toggle('error', error); };
  const encode = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data_base64: String(reader.result).split(',')[1] || '' });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  async function submit(body) {
    if (!activeModel || !state.caseId) return;
    const model = activeModel, caseId = state.caseId;
    form.classList.add('busy');
    [...form.elements].forEach((element) => { element.disabled = true; });
    try {
      const response = await fetch(new URL('./api/motion/input', window.location.href), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ case_id: caseId, ...body }) });
      const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      if (activeModel !== model) return;
      const bytes = Uint8Array.from(atob(result.buffer_base64), (c) => c.charCodeAt(0));
      let id = result.motion_id;
      for (let k = 2; model.motions[id]; k += 1) id = `${result.motion_id}_${k}`;
      const motion = decodeMotion(result.entry, bytes.buffer, {}, model.skeleton, id);
      motion.source = result.entry.source;
      model.motions[id] = motion;
      setMotionOptions(model.motions, id);
      selectMotion(id);
      const match = result.report?.prompt?.candidates?.[0];
      setStatus(match ? `Recording: ${match.description} (${match.trial ? 'CMU ' + match.trial : 'library'})` : `Uploaded: ${result.entry.label}`);
    } catch (error) {
      setStatus(String(error?.message || error), true);
    } finally {
      form.classList.remove('busy');
      [...form.elements].forEach((element) => { element.disabled = false; });
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!prompt.value.trim()) return;
    setStatus('Finding and retargeting a recording...');
    submit({ prompt: prompt.value.trim() });
  });
  upload.addEventListener('change', async () => {
    const files = [...upload.files].slice(0, 2);
    upload.value = '';
    if (!files.length) return;
    setStatus('Retargeting uploaded motion capture...');
    try { submit({ files: await Promise.all(files.map(encode)) }); } catch (error) { setStatus(String(error?.message || error), true); }
  });
}

// ---- Muscle layer (MS-Human-700, 700 muscle-tendon units fitted into this skin) ----
// Each muscle vertex is stored at the body's rest pose with its two bone meshes and a blend
// weight; every frame it follows those bones exactly as drawn (skeletal motion plus the rigid
// containment correction): x = (1 - w) Ma p + w Mb p.
let muscleTopology = null;
async function loadMuscleTopology() {
  if (muscleTopology) return muscleTopology;
  const meta = await (await fetch(new URL('./muscles/topology.json', manifestURL))).json();
  const raw = await (await fetch(new URL('./muscles/topology.bin', manifestURL))).arrayBuffer();
  const a = meta.arrays;
  muscleTopology = { meta, faces: new Uint32Array(raw, a.faces.offset, a.faces.count),
    muscleId: new Uint16Array(raw, a.muscle_id.offset, a.muscle_id.count),
    owners: new Uint16Array(raw, a.owners.offset, a.owners.count), blend: new Float32Array(raw, a.blend.offset, a.blend.count) };
  return muscleTopology;
}

async function loadMuscleLayer(model, caseId) {
  const topology = await loadMuscleTopology();
  // Gallery bodies: ./muscles/<id>.*; custom (measurement) bodies: served with the body itself.
  const custom = String(caseId).startsWith('custom_');
  const muscleURL = (suffix) => custom ? new URL(`/api/measurements/results/${caseId}/muscles${suffix}`, location.href)
    : new URL(`./muscles/${caseId}${suffix}`, manifestURL);
  const report = await (await fetch(muscleURL('.json'))).json();
  if (model.caseBufferSha256 && report.case_buffer_sha256 !== model.caseBufferSha256) throw new Error('Muscle layer belongs to a different body build.');
  const restResponse = await fetch(muscleURL('.bin'));
  if (!restResponse.ok) throw new Error('no muscle layer for this body');
  const rest = new Float32Array(await restResponse.arrayBuffer());
  // Per-ring bone anchors (rest frame); optional for older builds.
  let anchorRest = null;
  try {
    const response = await fetch(muscleURL('.anchors.bin'));
    if (response.ok) anchorRest = new Float32Array(await response.arrayBuffer());
  } catch (_) { anchorRest = null; }
  const count = rest.length / 3, samples = topology.meta.samples, ring = topology.meta.ring;
  // One red per muscle, as MS-Human-700 draws its muscle-tendon paths (MuJoCo muscles have no
  // separate tendon), slightly varied so neighbouring muscles stay distinguishable.
  const colors = new Float32Array(count * 3), alongOf = new Float32Array(count), shade = new THREE.Color();
  topology.meta.muscles.forEach((m, index) => {
    shade.setHSL(.995 + ((index * 37) % 11) / 11 * .02, .62, .30 + ((index * 53) % 9) / 9 * .08);
    const n = m.samples || samples;
    for (let v = m.vertex_start; v < m.vertex_start + m.vertex_count; v += 1) {
      colors.set([shade.r, shade.g, shade.b], v * 3);
      alongOf[v] = n > 1 ? Math.floor((v - m.vertex_start) / ring) / (n - 1) : .5;
    }
  });
  model.muscleAlong = alongOf;
  model.muscleBaseColors = colors.slice();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rest), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(topology.faces, 1));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: 0 }));
  mesh.frustumCulled = false;
  model.group.add(mesh);
  const { MuscleContainment } = await import('./muscle_containment.js');
  // Each ring's nearest rest vertex on each of its two bones: the ring follows the local deformation
  // D of those bone points (the skeleton's containment fit), so attachments stay on the fitted bone.
  const rings = count / ring, nearA = new Uint32Array(rings), nearB = new Uint32Array(rings);
  const owners0 = topology.owners;
  for (let r = 0; r < rings; r += 1) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < ring; k += 1) { const i = (r * ring + k) * 3; cx += rest[i] / ring; cy += rest[i + 1] / ring; cz += rest[i + 2] / ring; }
    for (const [slot, target] of [[0, nearA], [1, nearB]]) {
      const bone = model.bones[owners0[r * ring * 2 + slot]].mesh.geometry.getAttribute('position').array;
      let best = 0, bestD = Infinity;
      for (let j = 0; j < bone.length; j += 3) {
        const d = (bone[j] - cx) ** 2 + (bone[j + 1] - cy) ** 2 + (bone[j + 2] - cz) ** 2;
        if (d < bestD) { bestD = d; best = j / 3; }
      }
      target[r] = best;
    }
  }
  model.muscles = { mesh, rest, report, count, containment: new MuscleContainment(), anchorRest, nearA, nearB,
    anchors: anchorRest ? new Float32Array(anchorRest.length) : null,
    closure: Uint32Array.from(topology.meta.closure_faces || []), last: null };
  updateMuscleLayer(model);
  renderDirty = true;
}

function updateMuscleLayer(model) {
  if (!state.muscles) { if (model.muscles) model.muscles.mesh.visible = false; return; }
  if (!model.muscles) {
    if (!model.musclesLoading && state.caseId) {
      model.musclesLoading = loadMuscleLayer(model, state.caseId).catch((error) => {
        const status = ui['containment-projection-status'];
        if (status) status.textContent = `Muscle layer unavailable: ${error.message || error}`;
      });
    }
    return;
  }
  const { mesh, rest, count } = model.muscles, owners = muscleTopology.owners, blend = muscleTopology.blend;
  if (muscleRequestOnly) {   // preparing another keyframe for the worker: only that keyframe, once
    const id = `${model.muscles.workerKey}|${muscleRequestOnly}`;
    if (model.muscleFrameKey !== muscleRequestOnly || model.muscles.cache?.has(muscleRequestOnly) || musclePending.has(id)) return;
  }
  const out = muscleRequestOnly ? (model.muscles.scratch ||= new Float32Array(count * 3)) : mesh.geometry.getAttribute('position').array;
  for (let v = 0; v < count; v += 1) {
    const x = rest[v * 3], y = rest[v * 3 + 1], z = rest[v * 3 + 2], w = blend[v];
    const a = model.bones[owners[v * 2]].mesh.matrix.elements, b = model.bones[owners[v * 2 + 1]].mesh.matrix.elements;
    out[v * 3] = (1 - w) * (a[0] * x + a[4] * y + a[8] * z + a[12]) + w * (b[0] * x + b[4] * y + b[8] * z + b[12]);
    out[v * 3 + 1] = (1 - w) * (a[1] * x + a[5] * y + a[9] * z + a[13]) + w * (b[1] * x + b[5] * y + b[9] * z + b[13]);
    out[v * 3 + 2] = (1 - w) * (a[2] * x + a[6] * y + a[10] * z + a[14]) + w * (b[2] * x + b[6] * y + b[10] * z + b[14]);
  }
  const ring = muscleTopology.meta.ring, { anchorRest, anchors } = model.muscles;
  if (anchorRest && anchors) {
    for (let r = 0; r < anchorRest.length / 3; r += 1) {
      const v = r * ring, x = anchorRest[r * 3], y = anchorRest[r * 3 + 1], z = anchorRest[r * 3 + 2], w = blend[v];
      const a = model.bones[owners[v * 2]].mesh.matrix.elements, b = model.bones[owners[v * 2 + 1]].mesh.matrix.elements;
      anchors[r * 3] = (1 - w) * (a[0] * x + a[4] * y + a[8] * z + a[12]) + w * (b[0] * x + b[4] * y + b[8] * z + b[12]);
      anchors[r * 3 + 1] = (1 - w) * (a[1] * x + a[5] * y + a[9] * z + a[13]) + w * (b[1] * x + b[5] * y + b[9] * z + b[13]);
      anchors[r * 3 + 2] = (1 - w) * (a[2] * x + a[6] * y + a[10] * z + a[14]) + w * (b[2] * x + b[6] * y + b[10] * z + b[14]);
    }
  }
  const D = model.boneDisplacements;
  if (D) {
    const { nearA, nearB } = model.muscles;
    for (let r = 0; r < count / ring; r += 1) {
      const v = r * ring, w = blend[v], da = D[owners[v * 2]], db = D[owners[v * 2 + 1]];
      if (!da && !db) continue;
      const ia = nearA[r] * 3, ib = nearB[r] * 3;
      const dx = (1 - w) * (da ? da[ia] : 0) + w * (db ? db[ib] : 0), dy = (1 - w) * (da ? da[ia + 1] : 0) + w * (db ? db[ib + 1] : 0),
        dz = (1 - w) * (da ? da[ia + 2] : 0) + w * (db ? db[ib + 2] : 0);
      for (let k = 0; k < ring; k += 1) { const i = (v + k) * 3; out[i] += dx; out[i + 1] += dy; out[i + 2] += dz; }
      if (anchors) { anchors[r * 3] += dx; anchors[r * 3 + 1] += dy; anchors[r * 3 + 2] += dz; }
    }
  }
  // Same guarantee as the skeleton: every muscle vertex, and the tube surface between rings,
  // inside the skin in the displayed frame. A keyed frame's result is cached as the rings the
  // containment moved (the rest follow the bones), so replaying a frame needs no field or tests.
  const key = model.muscleFrameKey, cache = (model.muscles.cache ||= new Map());
  const hit = key ? cache.get(key) : null;
  if (muscleRequestOnly) { if (!hit && musclesWorkerReady(model)) postMuscleJob(model, key, out, anchors); return; }
  if (!hit && key && musclesWorkerReady(model)) {
    // contained off the main thread; never drawn uncontained: hidden until the worker returns
    postMuscleJob(model, key, out, anchors);
    model.muscles.waitingKey = key;
    mesh.visible = false;
    return;
  }
  if (hit) {
    for (let n = 0; n < hit.rings.length; n += 1) out.set(hit.positions.subarray(n * ring * 3, (n + 1) * ring * 3), hit.rings[n] * ring * 3);
    model.muscles.last = { ...hit.stats, cached: true };
  } else {
    const carried = key ? out.slice() : null;
    model.muscles.last = model.muscles.containment.apply(model.skinPositions, model.sourceTopology.skin_faces, model.muscles.closure,
      out, ring, model.bounds.max.z - model.bounds.min.z, { anchors, muscles: muscleTopology.meta.muscles });
    if (key) {
      const changed = [];
      for (let r = 0; r < count / ring; r += 1) {
        for (let i = r * ring * 3; i < (r + 1) * ring * 3; i += 1) if (out[i] !== carried[i]) { changed.push(r); break; }
      }
      const positions = new Float32Array(changed.length * ring * 3);
      changed.forEach((r, n) => positions.set(out.subarray(r * ring * 3, (r + 1) * ring * 3), n * ring * 3));
      if (cache.size >= 320) cache.delete(cache.keys().next().value);   // bounded (~35 MB): the longest clip, idle, has 302 keyframes
      cache.set(key, { rings: Uint32Array.from(changed), positions, stats: model.muscles.last });
    }
  }
  mesh.geometry.getAttribute('position').needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  colourMuscleActivation(model);
  mesh.visible = true;
}

// ---- Computed muscle activation (static optimisation on MS-Human-700, scripts/compute_muscle_activations.py) ----
// muscles/activations/<motion>.bin: uint8 frame-major (frames x 700, topology order), a = value / 255.
// Computed once on the MS-Human-700 adult reference body; shown on whichever body is displayed.
const muscleActivations = new Map();   // motion -> { promise, data (null = none for this motion) }
function muscleActivation(motionId, onReady) {
  let entry = muscleActivations.get(motionId);
  if (!entry) {
    entry = { ready: false, data: null };
    entry.promise = (async () => {
      const meta = await fetch(new URL(`./muscles/activations/${motionId}.json`, manifestURL));
      if (!meta.ok) return null;
      const info = await meta.json();
      const raw = await fetch(new URL(`./muscles/activations/${motionId}.bin`, manifestURL));
      if (!raw.ok) return null;
      const values = new Uint8Array(await raw.arrayBuffer());
      if (values.length !== info.frame_count * info.muscle_count) throw new Error('Activation file size does not match its header.');
      return { info, values };
    })().catch(() => null).then((data) => { entry.data = data; entry.ready = true; onReady(); });
    muscleActivations.set(motionId, entry);
  }
  return entry;
}

// Colour ramp over sqrt(a): resting muscle (dim rose) -> red -> orange -> yellow at full activation.
const ACTIVATION_RAMP = [[0, [.36, .27, .27]], [.45, [.78, .16, .10]], [.75, [.98, .45, .08]], [1, [1, .92, .35]]];
function activationColour(a, out, offset) {
  const x = Math.sqrt(Math.max(0, Math.min(1, a)));
  let k = 1;
  while (k < ACTIVATION_RAMP.length - 1 && x > ACTIVATION_RAMP[k][0]) k += 1;
  const [x0, c0] = ACTIVATION_RAMP[k - 1], [x1, c1] = ACTIVATION_RAMP[k], w = (x - x0) / (x1 - x0 || 1);
  out[offset] = c0[0] + (c1[0] - c0[0]) * w; out[offset + 1] = c0[1] + (c1[1] - c0[1]) * w; out[offset + 2] = c0[2] + (c1[2] - c0[2]) * w;
}

function colourMuscleActivation(model) {
  const muscles = model.muscles; if (!muscles) return;
  const attribute = muscles.mesh.geometry.getAttribute('color'), colors = attribute.array;
  const status = $('activation-status'), legend = $('activation-legend');
  if (legend) legend.hidden = !state.activation;
  const entry = state.activation ? muscleActivation(state.motionId, () => {
    if (activeModel === model) { colourMuscleActivation(model); renderDirty = true; }
  }) : null;
  const data = entry?.ready ? entry.data : null;
  if (!data) {
    if (muscles.coloured) { colors.set(model.muscleBaseColors); attribute.needsUpdate = true; muscles.coloured = false; }
    if (status) status.textContent = !state.activation ? '' : entry.ready ? `No computed activation for this motion.` : 'Loading computed activation…';
    return;
  }
  const { info, values } = data, times = info.times, n = info.muscle_count;
  let f = 0;
  while (f < times.length - 2 && times[f + 1] <= state.time) f += 1;
  const g = Math.min(f + 1, times.length - 1);
  const w = g > f ? Math.max(0, Math.min(1, (state.time - times[f]) / (times[g] - times[f]))) : 0;
  const per = muscles.activationScratch ||= new Float32Array(n * 3);
  let peak = 0, peakIndex = 0;
  for (let m = 0; m < n; m += 1) {
    const a = ((1 - w) * values[f * n + m] + w * values[g * n + m]) / 255;
    if (a > peak) { peak = a; peakIndex = m; }
    activationColour(a, per, m * 3);
  }
  const ids = muscleTopology.muscleId;
  for (let v = 0; v < muscles.count; v += 1) {
    const m = ids[v] * 3;
    colors[v * 3] = per[m]; colors[v * 3 + 1] = per[m + 1]; colors[v * 3 + 2] = per[m + 2];
  }
  attribute.needsUpdate = true; muscles.coloured = true;
  muscles.activation = { motion: state.motionId, frame: f, peak, peak_muscle: muscleTopology.meta.muscles[peakIndex].name };
  if (status) status.textContent = `Computed by static optimisation (MS-Human-700 reference adult) · most active: ${muscleTopology.meta.muscles[peakIndex].name} ${(peak * 100).toFixed(0)}%`;
}

function initializeMuscleLayer() {
  const toggle = $('muscles-toggle');
  if (!toggle || typeof toggle.addEventListener !== 'function') return;
  state.muscles = toggle.checked;
  toggle.addEventListener('change', () => {
    state.muscles = toggle.checked;
    if (activeModel) { updateMuscleLayer(activeModel); renderDirty = true; }
    invalidateNativeFrame();   // MuJoCo view: request a frame with the new layer state
  });
  const activation = $('activation-toggle');
  if (activation && typeof activation.addEventListener === 'function') {
    state.activation = activation.checked;
    activation.addEventListener('change', () => {
      state.activation = activation.checked;
      if (state.activation && !state.muscles) { toggle.checked = true; state.muscles = true; }
      if (activeModel) { updateMuscleLayer(activeModel); renderDirty = true; }
      invalidateNativeFrame();
    });
  }
}

start();
