import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceGuide, voiceAssetsAvailable } from './voice.js';

function fakePlayer() {
  const played = [];
  const stopped = [];
  const guide = createVoiceGuide({ makeAudio: (url) => ({
    currentTime: 0,
    readyState: 4,
    load() {},
    addEventListener() {},
    removeEventListener() {},
    play() { played.push(url); return Promise.resolve(); },
    pause() { stopped.push(url); },
  }) });
  guide.prepare();
  return { guide, played, stopped };
}

test('voice is available only when both audio assets are served', async () => {
  const audio = { ok: true, headers: { get: () => 'audio/wav' } };
  const html = { ok: true, headers: { get: () => 'text/html' } };
  assert.equal(await voiceAssetsAvailable(async () => audio), true);
  assert.equal(await voiceAssetsAvailable(async (url) => url.includes('-out') ? html : audio), false);
  assert.equal(await voiceAssetsAvailable(async () => { throw new Error('offline'); }), false);
});

test('voice plays once at each phase boundary and stops when paused', () => {
  const { guide, played, stopped } = fakePlayer();
  guide.update({ enabled: true, active: true, remaining: 60_000 });
  guide.update({ enabled: true, active: true, remaining: 59_900 });
  guide.update({ enabled: true, active: true, remaining: 56_000 });
  assert.deepEqual(played, ['/reset-voice-in.wav', '/reset-voice-out.wav']);
  guide.update({ enabled: true, active: false, remaining: 55_500 });
  assert.deepEqual(stopped, ['/reset-voice-in.wav', '/reset-voice-out.wav']);
  guide.update({ enabled: true, active: true, remaining: 55_500 });
  assert.equal(played.length, 2);
  guide.update({ enabled: true, active: true, remaining: 50_000 });
  assert.equal(played.at(-1), '/reset-voice-in.wav');
  guide.update({ enabled: false, active: true, remaining: 49_900 });
  assert.equal(stopped.at(-1), '/reset-voice-in.wav');
});

test('late callbacks and completion do not play stale instructions', () => {
  const { guide, played, stopped } = fakePlayer();
  guide.update({ enabled: true, active: true, remaining: 60_000 });
  guide.update({ enabled: true, active: true, remaining: 55_700 });
  guide.update({ enabled: true, active: true, remaining: 55_600 });
  guide.update({ enabled: true, active: true, remaining: 0 });
  assert.deepEqual(played, ['/reset-voice-in.wav']);
  assert.deepEqual(stopped, ['/reset-voice-in.wav']);
});

test('a resumed phase is not repeated, but a new session resets it', () => {
  const { guide, played } = fakePlayer();
  guide.update({ enabled: true, active: true, remaining: 60_000 });
  guide.stop();
  guide.update({ enabled: true, active: true, remaining: 59_950 });
  assert.equal(played.length, 1);
  guide.reset();
  guide.update({ enabled: true, active: true, remaining: 60_000 });
  assert.equal(played.length, 2);
});

test('audio that starts after its cue deadline is stopped', async () => {
  let clock = 0;
  let playing;
  let stopped = 0;
  let resolvePlay;
  const guide = createVoiceGuide({ now: () => clock, makeAudio: () => ({
    currentTime: 0, readyState: 4, load() {}, addEventListener: (_, cb) => { playing = cb; }, removeEventListener() {},
    pause: () => { stopped += 1; }, play: () => new Promise((resolve) => { resolvePlay = resolve; }),
  }) });
  guide.prepare();
  guide.update({ enabled: true, active: true, remaining: 60_000 });
  clock = 300;
  playing();
  assert.equal(stopped, 1);
  resolvePlay();
  await Promise.resolve();
});

test('playback failures are reported without leaking a stale failure after stop', async () => {
  let errors = 0;
  const guide = createVoiceGuide({
    makeAudio: () => ({ currentTime: 0, readyState: 4, load() {}, addEventListener() {}, removeEventListener() {}, play: () => Promise.reject(new Error('blocked')), pause() {} }),
    onError: () => { errors += 1; },
  });
  guide.prepare();
  guide.update({ enabled: true, active: true, remaining: 60_000 });
  await new Promise(setImmediate);
  assert.equal(errors, 1);
  guide.update({ enabled: true, active: true, remaining: 56_000 });
  guide.stop();
  await new Promise(setImmediate);
  assert.equal(errors, 1);
});
