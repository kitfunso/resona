import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireMicPermission, recordBlow, unlockAudio } from '../audio/recorder.js';
import { captureMotion } from '../imu/motion.js';

function setGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
}

function audioEnvironment(t, recorderClass) {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped += 1; } }] };
  class FakeContext {
    state = 'running';
    destination = {};
    createBuffer() { return {}; }
    createBufferSource() { return { connect() {}, start() {} }; }
    createMediaStreamSource() { return { disconnect() {} }; }
    async decodeAudioData() { return { sampleRate: 24000, getChannelData: () => new Float32Array([0.1, 0.2]) }; }
  }
  setGlobal(t, 'window', { AudioContext: FakeContext });
  setGlobal(t, 'navigator', { mediaDevices: { getUserMedia: async () => stream } });
  setGlobal(t, 'MediaRecorder', recorderClass);
  unlockAudio();
  return () => stopped;
}

test('microphone permission denial is surfaced', async (t) => {
  setGlobal(t, 'navigator', { mediaDevices: { getUserMedia: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } });
  await assert.rejects(acquireMicPermission(), { name: 'NotAllowedError' });
});

test('recorder construction failure releases the microphone', async (t) => {
  const stopped = audioEnvironment(t, class { constructor() { throw new Error('Cannot record'); } });
  await assert.rejects(recordBlow(), /Cannot record/);
  assert.equal(stopped(), 1);
});

test('aborting a recording stops the recorder and microphone', async (t) => {
  let recorderStopped = 0;
  class Recorder {
    state = 'inactive';
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; recorderStopped += 1; }
  }
  const stopped = audioEnvironment(t, Recorder);
  const controller = new AbortController();
  const capture = recordBlow({ durationMs: 10000, signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(capture, { name: 'AbortError' });
  assert.equal(stopped(), 1);
  assert.equal(recorderStopped, 1);
});

test('successful recording returns audio and releases the microphone', async (t) => {
  class Recorder {
    state = 'inactive';
    listeners = {};
    start() { this.state = 'recording'; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data: new Blob(['test']) });
      this.listeners.stop();
    }
  }
  const stopped = audioEnvironment(t, Recorder);
  const result = await recordBlow({ durationMs: 1 });
  assert.equal(result.sampleRate, 24000);
  assert.equal(result.pcm.length, 2);
  assert.equal(stopped(), 1);
});

test('aborting motion capture removes the sensor listener', async (t) => {
  let installed = 0;
  let removed = 0;
  setGlobal(t, 'window', {
    DeviceMotionEvent: class {},
    addEventListener: () => { installed += 1; },
    removeEventListener: () => { removed += 1; },
  });
  const controller = new AbortController();
  const capture = captureMotion({ durationMs: 10000, signal: controller.signal });
  controller.abort();
  await assert.rejects(capture, { name: 'AbortError' });
  assert.equal(installed, 1);
  assert.equal(removed, 1);
});

test('missing motion samples report an error after removing the listener', async (t) => {
  let removed = 0;
  setGlobal(t, 'window', {
    DeviceMotionEvent: class {}, addEventListener() {}, removeEventListener: () => { removed += 1; },
  });
  await assert.rejects(captureMotion({ durationMs: 1 }), /No motion data/);
  assert.equal(removed, 1);
});
