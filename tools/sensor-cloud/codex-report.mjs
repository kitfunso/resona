const FIELDS = Object.freeze({
  breath: { rmsEnergy: [0, 10], activeSec10: [0, 30], peakEnv: [0, 10] },
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
    steady_phone: { title: 'Keep the phone steady', detail: 'If you repeat the stillness recording, support your phone in the same position.' },
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

function snapshot(modality, readings) {
  if (!readings) return '';
  if (modality === 'breath' && Number.isFinite(readings.activeSec10)) return ` Sound stayed above the relative threshold for ${readings.activeSec10.toFixed(1)} seconds.`;
  if (modality === 'motion' && Number.isFinite(readings.cadence)) return ` The estimated walking cadence was ${Math.round(readings.cadence)} steps per minute.`;
  if (modality === 'motion' && Number.isFinite(readings.dominantFrequencyHz)) return ` The strongest recorded motion frequency was ${readings.dominantFrequencyHz.toFixed(1)} Hz.`;
  if (modality === 'heart' && Number.isFinite(readings.hrBpm)) return ` The estimated pulse was ${Math.round(readings.hrBpm)} beats per minute.`;
  return '';
}

export function reportFromCodexCode(modality, result, readings) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 1 || typeof result.action !== 'string') return null;
  const choices = Object.hasOwn(ACTIONS, modality) ? ACTIONS[modality] : null;
  const action = choices && Object.hasOwn(choices, result.action) ? choices[result.action] : null;
  if (!action) return null;
  if (readings && !codexActionSchema(modality, readings).properties.action.enum.includes(result.action)) return null;
  return { headline: 'Your recording snapshot', interpretation: `${INTERPRETATION[modality]}${snapshot(modality, readings)}`, actions: [{ ...action }], source: 'codex' };
}

export function codexActionSchema(modality, readings) {
  const actions = Object.hasOwn(ACTIONS, modality) ? ACTIONS[modality] : null;
  if (!actions) return null;
  const options = Object.keys(actions).filter((action) => {
    if (modality !== 'motion' || !readings) return true;
    if (action === 'repeat_walk') return Number.isFinite(readings.cadence) || Number.isFinite(readings.stepsDetected);
    if (action === 'steady_phone') return Number.isFinite(readings.dominantFrequencyHz) || Number.isFinite(readings.sampleRate);
    return true;
  });
  return { type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: options } }, required: ['action'] };
}
