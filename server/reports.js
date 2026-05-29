// server/reports.js
//
// The deterministic (LLM-free) report layer for the analyze-* endpoints,
// extracted verbatim from index.js. Holds everything that produces or
// sanitises report content WITHOUT calling the model:
//   - atsFlags / classifierFallback: blow effort-quality heuristics
//   - personalReportFallback / neuroReportFallback / heartReportFallback:
//     offline reports used when the LLM is unreachable or returns junk
//   - scrubInternalTokens / scrubReport: belt-and-braces output sanitiser
//
// These are pure functions of their arguments (no DB, no app, no prompt
// constants). scrubReport MUTATES its argument in place AND returns it;
// callers rely on the in-place mutation (they call it statement-position),
// so do not change it to return-only.

// ATS 2019 informational flags (feasible subset on phone audio).
// - ATS says PEF should occur within 120ms of exhalation onset. Our peak-time
//   can't reliably resolve sub-120ms because the envelope is low-pass filtered
//   at 20Hz (50ms time constant). Use 500ms as the "clearly not a sharp burst"
//   threshold instead, which rules out speech and talking.
// - ATS says forced exhalation time ≥ 6s. Most phone blows end early; we flag
//   below 3.5s as "short" rather than hard-rejecting, since 3-6s is usable
//   for screening.
export function atsFlags(features) {
  const flags = [];
  if (features.peakTimeSec > 0.5) flags.push('peak_late');
  if ((features.activeSec05 ?? 0) < 3.5) flags.push('short_exhalation');
  return flags;
}

export function classifierFallback({ features, estimate }) {
  const sec = features.activeSec05 ?? 0;
  const peak = features.peakEnv ?? 0;
  if (sec < 1.0) {
    return {
      valid: false,
      reason: 'short_duration',
      coaching_message:
        'That was a very short blow. Take a deep breath first, then blow hard and steady for at least 4 seconds.',
      atsFlags: atsFlags(features),
    };
  }
  if (sec < 2.5) {
    return {
      valid: false,
      reason: 'partial_sustain',
      coaching_message:
        "You only sustained for a moment. Try to keep pushing air out steadily, don't stop until the countdown ends.",
      atsFlags: atsFlags(features),
    };
  }
  if (peak < 0.08) {
    return {
      valid: false,
      reason: 'low_volume',
      coaching_message:
        'We could barely hear you. Hold the bottom of the phone right to your lips and blow harder.',
      atsFlags: atsFlags(features),
    };
  }
  if (estimate.effortScore < -0.75) {
    return {
      valid: false,
      reason: 'weak_effort',
      coaching_message:
        'That looked sub-standard. Stand up, deep breath, and give it everything you have for the full 6 seconds.',
      atsFlags: atsFlags(features),
    };
  }
  return {
    valid: true,
    reason: 'valid_effort',
    coaching_message: 'Good blow.',
    atsFlags: atsFlags(features),
  };
}

export function personalReportFallback({ estimate }) {
  const pp = Math.round(estimate.percentPredicted.fev1);
  const below = pp < 80;
  const above = pp > 115;

  const headline = below
    ? `Your FEV1 came in lower than expected.`
    : above
    ? `Your FEV1 came in above the expected range.`
    : `Your FEV1 is roughly in line with expectations.`;

  const interpretation =
    `You pushed out ${estimate.fev1.toFixed(2)} L in the first second (FEV1), ` +
    `${estimate.fvc.toFixed(2)} L in total (FVC), with a peak flow of ${estimate.pef.toFixed(2)} L/s. ` +
    `That is ${pp}% of the expected value for someone your age, sex, and height.`;

  const actions = below
    ? [
        { title: 'Book a GP appointment this week', detail: 'Mention these numbers and ask specifically for formal spirometry and, if relevant, a chest X-ray.' },
        { title: 'Skip smoking and vaping', detail: 'Nicotine and smoke worsen FEV1 noticeably within weeks. If you already smoke, NHS Stop Smoking services are free.' },
        { title: 'Track your breath for a month', detail: 'Note any new shortness of breath with exercise, morning cough, or wheezing to share with your GP.' },
      ]
    : above
    ? [
        { title: 'Keep doing what you are doing', detail: 'Regular cardio and healthy body weight keep your lungs in the top bracket for your age.' },
        { title: 'Do not start smoking or vaping', detail: 'These are the fastest ways to pull numbers like yours back down to average within a few years.' },
        { title: 'Treat this as a screening, not a record', detail: 'A phone microphone can over-read max effort. Real clinical spirometry may read 10-15% lower.' },
      ]
    : [
        { title: 'Get 150 minutes of cardio a week', detail: 'Brisk walking, cycling, or swimming maintains and slowly improves lung capacity.' },
        { title: 'Avoid smoking and vaping', detail: 'Even a few years of smoking shifts FEV1 trajectory. Clean air in = healthier numbers.' },
        { title: 'Re-check once a year', detail: 'A normal result today does not rule out future decline. An annual screen helps spot trends early.' },
      ];

  const whenToWorry = below
    ? 'See a GP promptly if you develop new shortness of breath, chest tightness, a persistent cough, or wheezing.'
    : 'See a GP if you notice sudden shortness of breath, new wheezing, or a cough that lasts more than three weeks.';

  return { headline, interpretation, actions, whenToWorry };
}

export function neuroReportFallback({ tremor, gait }) {
  const isParkinsonian = tremor?.classification === 'parkinsonian_like';
  const isEssential = tremor?.classification === 'essential_like';
  const cadence = gait?.cadence ?? 0;
  const cvPct = (gait?.stridesCv ?? 0) * 100;

  const headline = isParkinsonian
    ? 'Low-frequency signal detected. Screening only.'
    : isEssential
    ? 'Slight higher-frequency tremor signature.'
    : 'Your Neuro screen looks as expected.';

  const freq = tremor?.dominantFrequencyHz != null ? tremor.dominantFrequencyHz.toFixed(1) : 'n/a';
  const interpretation =
    `Dominant arm-motion frequency landed at ${freq} Hz. ` +
    (gait
      ? `Walking cadence measured ${Math.round(cadence)} steps per minute with ${cvPct.toFixed(1)}% stride variability. `
      : '') +
    'These are screening numbers from a phone sensor, not clinical measurements.';

  const actions = isParkinsonian
    ? [
        { title: 'Book a GP appointment', detail: 'Describe the screening reading and mention any rest tremor, stiffness, or slowness you have noticed.' },
        { title: 'Track for a week', detail: 'Note when any hand shake happens. At rest? Holding objects? Under stress?' },
        { title: 'Cut late-day caffeine', detail: 'Caffeine can amplify baseline tremor. Stop after lunch for 7 days and retest.' },
      ]
    : isEssential
    ? [
        { title: 'Dial back caffeine', detail: 'Two coffees a day or fewer for a week. Essential-type signals often drop noticeably.' },
        { title: 'Sleep seven hours', detail: 'Fatigue and poor sleep amplify this pattern. Guard bedtime for seven nights.' },
        { title: 'Retest in a week', detail: 'If the signal persists at rest in quiet conditions, mention it to your GP.' },
      ]
    : cadence > 0 && cvPct > 15
    ? [
        { title: 'Add a 10-minute walk break', detail: 'Stride variability over 15% often comes from fragmented walking at work. Block a walk in your calendar.' },
        { title: 'Try a standing desk afternoon', detail: 'Alternate sitting and standing. Gentle movement at a standing desk resets posture.' },
        { title: 'Stretch hip flexors daily', detail: 'Tight hips shorten stride. 2 minutes morning and evening.' },
      ]
    : [
        { title: 'Keep movement regular', detail: 'Aim for a short walk every 60 minutes of desk time.' },
        { title: 'Try a walking meeting', detail: 'One meeting a day on foot keeps cadence strong.' },
        { title: 'Retest monthly', detail: 'Your numbers today form your personal baseline. Track the trend, not one reading.' },
      ];

  const whenToWorry = isParkinsonian
    ? 'See a GP soon if you notice a shake while your hand is fully at rest, especially on one side, or new stiffness and slower movements.'
    : 'See a GP if you develop unexplained falls, new persistent unsteadiness, or a tremor that does not fade within a week.';

  return { headline, interpretation, actions, whenToWorry };
}

export function heartReportFallback({ heart }) {
  const hr = Math.round(heart?.hrBpm ?? 0);
  const hrvLine = Number.isFinite(heart?.hrvRmssdMs)
    ? `Your beat-to-beat variability was ${heart.hrvRmssdMs.toFixed(0)} milliseconds. `
    : '';
  const hrClass = heart?.hrClassification ?? 'normal';
  const ageNote = heart?.ageNote ?? null;

  if (hrClass === 'tachycardia') {
    return {
      headline: `Resting heart rate came in around ${hr} bpm.`,
      interpretation:
        `${hr} bpm sits above the typical resting range of 60 to 100 beats per minute. ` +
        hrvLine +
        'A 30-second phone reading often runs slightly high because being on camera lifts the heart rate. Retry seated, after a slow breath.',
      actions: [
        { title: 'Take a 5-minute seated reset', detail: 'Sit, slow your breath, then retake the reading in the same light.' },
        { title: 'Audit your caffeine timing', detail: 'Cut caffeine after lunch for 3 days and see if your resting reading settles.' },
        { title: 'Track across quiet readings', detail: 'If resting heart rate stays above 100 across several calm checks, mention it to your GP.' },
      ],
      whenToWorry:
        'See a GP if your resting heart rate stays above 100 across several quiet readings, or you notice palpitations, breathlessness at rest, or dizziness.',
    };
  }

  if (hrClass === 'bradycardia') {
    return {
      headline: `Resting heart rate came in around ${hr} bpm.`,
      interpretation:
        `${hr} bpm sits below the typical resting range of 60 to 100 beats per minute. ` +
        hrvLine +
        'A lower resting heart rate is often a fitness signature in healthy adults, especially with regular cardio.',
      actions: [
        { title: 'Keep your training going', detail: 'Regular endurance work commonly drops resting heart rate. A low number alone is rarely a concern.' },
        { title: 'Note any symptoms', detail: 'Watch for dizziness, fainting, or unexplained breathlessness. These are the signals that matter, not the number alone.' },
        { title: 'Retest after gentle activity', detail: 'Take another reading 10 minutes after a short walk. Resting heart rate often climbs slightly into the typical range.' },
      ],
      whenToWorry:
        'See a GP if you have unexplained dizziness, fainting, or breathlessness, especially with a heart rate that stays below 50.',
    };
  }

  if (hrClass === 'unknown') {
    return {
      headline: `Resting heart rate reading was unclear.`,
      interpretation:
        'The 30-second phone capture could not lock onto a clean pulse this time. ' +
        hrvLine +
        'Retry in brighter even light with your face held steady in the oval.',
      actions: [
        { title: 'Move into brighter light', detail: 'Daylight or a steady soft lamp beats variable indoor light for the camera.' },
        { title: 'Hold the phone steady', detail: 'Rest your elbows on a desk and keep your face centred in the oval for the full 30 seconds.' },
        { title: 'Retake in a quieter moment', detail: 'A calm pause, then a single clean attempt, usually beats several rushed retakes.' },
      ],
      whenToWorry:
        'See a GP if you notice palpitations, fainting, or chest discomfort, even without a clear reading from a phone screen.',
    };
  }

  const ageLine =
    ageNote === 'low_for_young_adult'
      ? ' A resting reading below 55 is common in fit young adults and is rarely a concern on its own.'
      : ageNote === 'high_for_older_adult'
      ? ' A resting reading above 90 after age 60 deserves a calmer retest and a GP conversation if it persists.'
      : '';

  return {
    headline: `Your resting heart rate landed around ${hr} bpm.`,
    interpretation:
      `${hr} bpm sits within the typical resting range of 60 to 100 beats per minute. ` +
      hrvLine +
      'A phone-camera reading is a screening number, not a clinical measurement.' +
      ageLine,
    actions: [
      { title: 'Take a walking break every hour', detail: 'Set a 50-minute timer at the desk, walk for 5. Hourly movement keeps resting heart rate and recovery in a good place.' },
      { title: 'Aim for seven hours of sleep', detail: 'Short sleep raises resting heart rate within a day or two. Guard the seven hours for the next week.' },
      { title: 'Retest on a quiet Monday', detail: 'Build a baseline. Take the same screen at the same time of day to see your honest trend.' },
    ],
    whenToWorry:
      'See a GP if you notice sudden palpitations, fainting, or chest discomfort, or if you feel unusually breathless climbing one flight of stairs.',
  };
}

// Defensive scrub: strip internal classification tokens that should never
// appear in user-facing narrative. Belt-and-braces against GLM ignoring the
// "never echo these tokens" rule in the system prompt.
export function scrubInternalTokens(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/\bparkinsonian_like\b/gi, 'a low-frequency tremor signal')
    .replace(/\bessential_like\b/gi, 'a slightly higher-frequency tremor signal')
    .replace(/\bphysiological\b(?=[\s.,:;])/gi, 'the expected everyday tremor pattern')
    .replace(/\btachycardia\b/gi, 'a higher resting heart rate')
    .replace(/\bbradycardia\b/gi, 'a lower resting heart rate')
    .replace(/\blow_for_young_adult\b/gi, 'lower than the typical young adult range')
    .replace(/\bhigh_for_older_adult\b/gi, 'higher than the typical older adult range')
    .replace(/\b(low_snr|few_frames|few_beats|hr_methods_disagree|no_peak|fallback_roi)\b/gi, 'a noisy reading');
}

// Mutates `report` in place AND returns it. Callers invoke it statement-position
// and rely on the mutation; preserve both behaviours.
export function scrubReport(report) {
  if (!report || typeof report !== 'object') return report;
  if (report.headline) report.headline = scrubInternalTokens(report.headline);
  if (report.interpretation) report.interpretation = scrubInternalTokens(report.interpretation);
  if (report.whenToWorry) report.whenToWorry = scrubInternalTokens(report.whenToWorry);
  if (Array.isArray(report.actions)) {
    for (const a of report.actions) {
      if (a?.title) a.title = scrubInternalTokens(a.title);
      if (a?.detail) a.detail = scrubInternalTokens(a.detail);
    }
  }
  return report;
}
