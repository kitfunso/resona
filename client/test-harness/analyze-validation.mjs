// Bland-Altman + error analysis for rPPG HR vs a reference device.
// Reads the CSV exported by validate.html and reports agreement statistics.
//
// Usage: node client/test-harness/analyze-validation.mjs resona-validation.csv

import fs from 'node:fs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('usage: node analyze-validation.mjs <resona-validation.csv>');
  process.exit(2);
}

// Minimal CSV parse (handles quoted fields with commas).
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inQ = false; else cur += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
}

const all = parseCsv(fs.readFileSync(file, 'utf8'));
const num = (x) => (x === '' || x == null ? NaN : Number(x));

// The product only SHOWS a number for grade good/fair; 'poor' short-circuits to
// coaching. Agreement is measured on what users would actually see.
const shown = all.filter((r) => r.grade !== 'poor');
const paired = shown.filter((r) => Number.isFinite(num(r.rppgHr)) && Number.isFinite(num(r.refHr)));

const nPoor = all.length - shown.length;
console.log(`\nResona Heart — accuracy vs reference`);
console.log(`  rows total: ${all.length}   shown (good/fair): ${shown.length}   poor/excluded: ${nPoor}`);
console.log(`  paired (rPPG + reference both present): ${paired.length}`);

if (paired.length < 2) {
  console.log('\n  Not enough paired readings to compute statistics. Collect more (see VALIDATION-PROTOCOL.md).');
  process.exit(0);
}

const diffs = paired.map((r) => num(r.rppgHr) - num(r.refHr));
const abs = diffs.map(Math.abs);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const bias = mean(diffs);
const sd = Math.sqrt(mean(diffs.map((d) => (d - bias) ** 2)) * paired.length / Math.max(1, paired.length - 1));
const mae = mean(abs);
const rmse = Math.sqrt(mean(diffs.map((d) => d * d)));
const loaLo = bias - 1.96 * sd;
const loaHi = bias + 1.96 * sd;
const within5 = (abs.filter((x) => x <= 5).length / abs.length) * 100;
const within10 = (abs.filter((x) => x <= 10).length / abs.length) * 100;

// Pearson r.
const xs = paired.map((r) => num(r.refHr)), ys = paired.map((r) => num(r.rppgHr));
const mx = mean(xs), my = mean(ys);
let sxy = 0, sxx = 0, syy = 0;
for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;

const f = (x) => x.toFixed(2);
console.log(`\n  MAE (mean abs error):     ${f(mae)} bpm`);
console.log(`  RMSE:                     ${f(rmse)} bpm`);
console.log(`  Bias (rPPG - ref):        ${f(bias)} bpm`);
console.log(`  SD of differences:        ${f(sd)} bpm`);
console.log(`  95% limits of agreement:  ${f(loaLo)} to ${f(loaHi)} bpm  (Bland-Altman)`);
console.log(`  within +/-5 bpm:          ${within5.toFixed(0)}%`);
console.log(`  within +/-10 bpm:         ${within10.toFixed(0)}%`);
console.log(`  Pearson r:                ${f(r)}`);

// Reference bars (illustrative; see protocol). ANSI/AAMI EC13 HR: within +/-5 bpm or +/-10%.
const consumerPass = mae <= 5 && loaLo >= -10 && loaHi <= 10;
console.log(`\n  vs consumer-wearable bar (MAE <=5 bpm AND LoA within +/-10 bpm): ${consumerPass ? 'PASS' : 'FAIL'}`);
if (paired.length < 20) console.log(`  NOTE: n=${paired.length} is below the >=20 paired-reading floor for even a sanity estimate.`);
console.log(`  NOTE: single-subject data does NOT establish multi-skin-tone validity — grants will expect a multi-subject study across Fitzpatrick types.\n`);
