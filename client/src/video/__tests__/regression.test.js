import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeart } from '../regression.js';

test('72 bpm + 35 ms HRV at age 30 -> normal/typical/no age note', () => {
  const out = classifyHeart({
    features: { hrBpm: 72, hrvRmssdMs: 35, sdnnMs: 45, snr: 4, beatCount: 35, durationSec: 30, reasons: [], grade: 'good' },
    demographics: { ageYears: 30 },
  });
  assert.equal(out.hrClassification, 'normal');
  assert.equal(out.hrvClassification, 'typical');
  assert.equal(out.ageNote, null);
});

test('110 bpm flags tachycardia', () => {
  const out = classifyHeart({
    features: { hrBpm: 110, hrvRmssdMs: 28, sdnnMs: 38, snr: 4, beatCount: 54, durationSec: 30, reasons: [], grade: 'good' },
    demographics: { ageYears: 35 },
  });
  assert.equal(out.hrClassification, 'tachycardia');
});

test('age 22, HR 52 -> bradycardia + low_for_young_adult', () => {
  const out = classifyHeart({
    features: { hrBpm: 52, hrvRmssdMs: 60, sdnnMs: 70, snr: 4, beatCount: 26, durationSec: 30, reasons: [], grade: 'good' },
    demographics: { ageYears: 22 },
  });
  assert.equal(out.hrClassification, 'bradycardia');
  assert.equal(out.ageNote, 'low_for_young_adult');
});

test('low HRV detected', () => {
  const out = classifyHeart({
    features: { hrBpm: 78, hrvRmssdMs: 15, sdnnMs: 22, snr: 4, beatCount: 38, durationSec: 30, reasons: [], grade: 'good' },
    demographics: { ageYears: 40 },
  });
  assert.equal(out.hrvClassification, 'low');
});
