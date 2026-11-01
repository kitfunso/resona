import { extractFeatures } from '../audio/features.js';
import { analyseGait } from '../imu/gait.js';

const round = (value, places = 2) => Number.isFinite(value) ? Number(value.toFixed(places)) : null;

export function breathReading(pcm, sampleRate) {
  const features = extractFeatures(pcm, sampleRate);
  return {
    soundAboveRelativeThresholdSeconds: features.peakEnv > 0.0001 ? round(features.activeSec10) : null,
    breathRms: round(features.rmsEnergy, 4),
  };
}

export function walkReading(capture) {
  const gait = analyseGait(capture);
  return {
    walkingCadence: gait.stepsDetected >= 2 && gait.cadence > 0 ? round(gait.cadence, 1) : null,
    stepsDetected: gait.stepsDetected >= 2 ? gait.stepsDetected : null,
  };
}

export function analysisPayload(breath, walk) {
  return {
    soundAboveRelativeThresholdSeconds: breath.soundAboveRelativeThresholdSeconds,
    breathRms: breath.breathRms,
    walkingCadence: walk.walkingCadence,
    stepsDetected: walk.stepsDetected,
  };
}
