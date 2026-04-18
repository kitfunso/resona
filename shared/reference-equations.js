// Hankinson NHANES III reference equations (1999).
// Source: Hankinson JL, Odencrantz JR, Fedan KB. Spirometric reference values
// from a sample of the general U.S. population. Am J Respir Crit Care Med.
// 1999;159(1):179-187.
//
// Coefficients are the published values for adults (age >= 20), cross-verified
// against the rspiro R package source (github.com/thlytras/rspiro,
// data-raw/NHtb45.csv, MIT-licensed).
//
// Equation form:
//   value = b0 + b1 * age + b2 * age^2 + b3 * height^2
//   age in years, height in cm, value in litres (L/s for PEF).
//
// NHANES III published 3 ethnic groups: Caucasian, African American,
// Mexican American. It does NOT include South or East Asian cohorts.
// For non-Hankinson ethnicities (south_asian, east_asian, black_non_aa,
// mixed_or_other) we route to Caucasian coefficients and disclose the
// limitation in the generated GP letter.

const HANKINSON = {
  caucasian: {
    male: {
      fev1: { b0:  0.5536, b1: -0.01303, b2: -1.72e-4,  b3: 1.4098e-4 },
      fvc:  { b0: -0.1933, b1:  6.4e-4,  b2: -2.69e-4,  b3: 1.8642e-4 },
      pef:  { b0:  1.0523, b1:  0.08272, b2: -0.001301, b3: 2.4962e-4 },
    },
    female: {
      fev1: { b0:  0.4333, b1: -0.00361, b2: -1.94e-4,  b3: 1.1496e-4 },
      fvc:  { b0: -0.3560, b1:  0.01870, b2: -3.82e-4,  b3: 1.4815e-4 },
      pef:  { b0:  0.9267, b1:  0.06929, b2: -0.001031, b3: 1.8623e-4 },
    },
  },
  african_american: {
    male: {
      fev1: { b0:  0.3411, b1: -0.02309, b2:  0,        b3: 1.3194e-4 },
      fvc:  { b0: -0.1517, b1: -0.01821, b2:  0,        b3: 1.6643e-4 },
      pef:  { b0:  2.2257, b1: -0.04082, b2:  0,        b3: 2.7333e-4 },
    },
    female: {
      fev1: { b0:  0.3433, b1: -0.01283, b2: -9.7e-5,   b3: 1.0846e-4 },
      fvc:  { b0: -0.3039, b1:  0.00536, b2: -2.65e-4,  b3: 1.3606e-4 },
      pef:  { b0:  1.3597, b1:  0.03458, b2: -8.47e-4,  b3: 1.9746e-4 },
    },
  },
  mexican_american: {
    male: {
      fev1: { b0:  0.6306, b1: -0.02928, b2:  0,        b3: 1.5104e-4 },
      fvc:  { b0:  0.2376, b1: -0.00891, b2: -1.82e-4,  b3: 1.7823e-4 },
      pef:  { b0:  0.0870, b1:  0.0658,  b2: -0.001195, b3: 3.0243e-4 },
    },
    female: {
      fev1: { b0:  0.4529, b1: -0.01178, b2: -1.13e-4,  b3: 1.2154e-4 },
      fvc:  { b0:  0.1210, b1:  0.00307, b2: -2.37e-4,  b3: 1.4246e-4 },
      pef:  { b0:  0.2401, b1:  0.06174, b2: -0.001023, b3: 2.2203e-4 },
    },
  },
};

// Maps the 7-option ethnicity dropdown to which Hankinson coefficient set to use,
// plus whether the coefficients are a direct match or a best-available fallback.
const ETHNICITY_ROUTING = {
  caucasian:         { coeffs: 'caucasian',         directMatch: true  },
  african_american:  { coeffs: 'african_american',  directMatch: true  },
  hispanic_or_latino:{ coeffs: 'mexican_american',  directMatch: true  },
  south_asian:       { coeffs: 'caucasian',         directMatch: false },
  east_asian:        { coeffs: 'caucasian',         directMatch: false },
  black_non_aa:      { coeffs: 'african_american',  directMatch: false },
  mixed_or_other:    { coeffs: 'caucasian',         directMatch: false },
};

export const ETHNICITY_OPTIONS = [
  { value: 'caucasian',          label: 'Caucasian / White' },
  { value: 'african_american',   label: 'African American' },
  { value: 'hispanic_or_latino', label: 'Hispanic or Latino' },
  { value: 'south_asian',        label: 'South Asian (Indian, Pakistani, Bangladeshi, Sri Lankan)' },
  { value: 'east_asian',         label: 'East Asian (Chinese, Japanese, Korean, SE Asian)' },
  { value: 'black_non_aa',       label: 'Black (non-African-American, e.g. Caribbean, African)' },
  { value: 'mixed_or_other',     label: 'Mixed or Other' },
];

export function hankinsonPredicted({ sex, ageYears, heightCm, ethnicity = 'caucasian' }) {
  if (!['male', 'female'].includes(sex)) {
    throw new Error(`sex must be "male" or "female", got ${sex}`);
  }
  if (ageYears < 20 || ageYears > 80) {
    throw new Error(`ageYears ${ageYears} outside adult Hankinson range 20-80`);
  }
  if (heightCm < 100 || heightCm > 230) {
    throw new Error(`heightCm ${heightCm} outside plausible range 100-230`);
  }

  const routing = ETHNICITY_ROUTING[ethnicity] || ETHNICITY_ROUTING.caucasian;
  const c = HANKINSON[routing.coeffs][sex];
  const a = ageYears;
  const h = heightCm;
  const calc = ({ b0, b1, b2, b3 }) => b0 + b1 * a + b2 * a * a + b3 * h * h;

  const usedCoeffs = routing.coeffs;
  const directMatch = routing.directMatch;

  const referenceNote = directMatch
    ? `Hankinson NHANES III (${usedCoeffs.replace('_', ' ')}) adult coefficients.`
    : `Hankinson NHANES III does not publish coefficients for ${ethnicity.replace('_', ' ')}. ` +
      `Using ${usedCoeffs.replace('_', ' ')} coefficients as the closest available baseline. ` +
      `Percent-predicted values are indicative only.`;

  return {
    fev1: calc(c.fev1),
    fvc: calc(c.fvc),
    pef: calc(c.pef),
    status: directMatch ? `hankinson-1999-${usedCoeffs}` : `hankinson-1999-${usedCoeffs}-fallback`,
    referenceNote,
    ethnicity,
    ethnicityCoeffs: usedCoeffs,
    ethnicityDirectMatch: directMatch,
  };
}

export const COEFFICIENT_STATUS = 'hankinson-1999-multiethnic';
