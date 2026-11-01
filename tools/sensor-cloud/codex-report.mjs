const FIELDS = Object.freeze({
  breath: { rmsEnergy: [0, 1], activeSec10: [0, 30], peakEnv: [0, 1] },
  motion: { dominantFrequencyHz: [0, 100], sampleRate: [0, 500], stepsDetected: [0, 300, true], cadence: [0, 300], stridesCv: [0, 10], symmetryIndex: [0, 1] },
  heart: { hrBpm: [0, 300], hrvRmssdMs: [0, 1000], sdnnMs: [0, 1000], beatCount: [0, 300, true], durationSec: [0, 120] },
});

const ACTIONS = Object.freeze({
  breath: {
    retry_quiet: { title: 'Try a quieter place', detail: 'Background sound can affect a microphone recording.' },
    none: { title: 'Keep this snapshot', detail: 'You can repeat the recording in similar conditions.' },
  },
  motion: {
    repeat_walk: { title: 'Repeat the walk', detail: 'Keep the phone in the same position if you compare recordings.' },
    none: { title: 'Keep this snapshot', detail: 'Phone motion readings depend on how you carry the device.' },
  },
  heart: {
    retry_light: { title: 'Try steady light', detail: 'Lighting and movement can affect a camera reading.' },
    none: { title: 'Keep this snapshot', detail: 'You can repeat the camera recording in similar conditions.' },
  },
});

const INTERPRETATION = Object.freeze({
  breath: 'The microphone captures sound, which can include background noise. It does not measure lung function.',
  motion: 'Phone movement and walking figures are estimates for this recording, not a medical assessment.',
  heart: 'Camera readings can be affected by lighting and motion. They are not a medical assessment.',
});

export function validateCodexInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (Object.keys(input).some((key) => !['modality', 'readings'].includes(key))) return null;
  const fields = Object.hasOwn(FIELDS, input.modality) ? FIELDS[input.modality] : null;
  const readings = input.readings;
  if (!fields || !readings || typeof readings !== 'object' || Array.isArray(readings)) return null;
  if (Object.keys(readings).some((key) => !Object.hasOwn(fields, key))) return null;
  const accepted = {};
  for (const [key, value] of Object.entries(readings)) {
    if (value == null) continue;
    const [min, max, integer] = fields[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) return null;
    accepted[key] = value;
  }
  return Object.keys(accepted).length ? { modality: input.modality, readings: accepted } : null;
}

export function reportFromCodexCode(modality, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 1 || typeof result.action !== 'string') return null;
  const choices = Object.hasOwn(ACTIONS, modality) ? ACTIONS[modality] : null;
  const action = choices && Object.hasOwn(choices, result.action) ? choices[result.action] : null;
  if (!action) return null;
  return { headline: 'Your recording snapshot', interpretation: INTERPRETATION[modality], actions: [{ ...action }], source: 'codex' };
}

export function codexActionSchema(modality) {
  const actions = Object.hasOwn(ACTIONS, modality) ? ACTIONS[modality] : null;
  if (!actions) return null;
  return { type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: Object.keys(actions) } }, required: ['action'] };
}
