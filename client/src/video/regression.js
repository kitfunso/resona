// Heart-screen classification bands + age-aware notes.
// Pure function from the features object + demographics to the report-ready
// fields. No I/O.

export function classifyHeart({ features, demographics }) {
  const hr = features?.hrBpm;
  const rmssd = features?.hrvRmssdMs;
  const age = demographics?.ageYears ?? null;

  let hrClassification = 'unknown';
  if (Number.isFinite(hr)) {
    if (hr < 60) hrClassification = 'bradycardia';
    else if (hr > 100) hrClassification = 'tachycardia';
    else hrClassification = 'normal';
  }

  let hrvClassification = 'unknown';
  if (Number.isFinite(rmssd)) {
    if (rmssd < 20) hrvClassification = 'low';
    else if (rmssd > 80) hrvClassification = 'high';
    else hrvClassification = 'typical';
  }

  let ageNote = null;
  if (Number.isFinite(hr) && Number.isFinite(age)) {
    if (age < 25 && hr < 55) ageNote = 'low_for_young_adult';
    else if (age > 60 && hr > 90) ageNote = 'high_for_older_adult';
  }

  return {
    hrBpm: hr ?? null,
    hrvRmssdMs: rmssd ?? null,
    sdnnMs: features?.sdnnMs ?? null,
    snr: features?.snr ?? null,
    beatCount: features?.beatCount ?? 0,
    durationSec: features?.durationSec ?? null,
    hrClassification,
    hrvClassification,
    ageNote,
    quality: {
      grade: features?.grade ?? 'unknown',
      reasons: Array.isArray(features?.reasons) ? [...features.reasons] : [],
    },
  };
}
