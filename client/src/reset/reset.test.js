import test from 'node:test';
import assert from 'node:assert/strict';
import { ENERGY, INTENTIONS, REFLECTIONS, createClock, remainingAt, resumeClock,
  pauseClock, breathPhase, buildCard, cardText } from './reset.js';

test('late timer callbacks use elapsed time and clamp at completion', () => {
  const clock = resumeClock(createClock(), 1000);
  assert.equal(remainingAt(clock, 18_750), 42_250);
  assert.equal(remainingAt(clock, 61_000), 0);
  assert.equal(remainingAt(clock, 90_000), 0);
});

test('time before start and time spent paused never count', () => {
  const fresh = createClock();
  assert.equal(remainingAt(fresh, 100_000), 60_000);
  const running = resumeClock(fresh, 1000);
  const paused = pauseClock(running, 5500);
  assert.equal(remainingAt(paused, 90_000), 55_500);
  const resumed = resumeClock(paused, 90_000);
  assert.equal(remainingAt(resumed, 100_000), 45_500);
  assert.equal(remainingAt(resumed, 145_500), 0);
  assert.equal(fresh.remainingMs, 60_000);
  assert.equal(running.startedAt, 1000);
});

test('a duplicate start cannot extend a running or completed session', () => {
  const running = resumeClock(createClock(), 500);
  assert.equal(resumeClock(running, 20_000), running);
  const finished = pauseClock(running, 60_500);
  assert.equal(resumeClock(finished, 90_000), finished);
  assert.equal(remainingAt(finished, 90_000), 0);
});

test('breathing phases agree with the visual cycle at boundaries', () => {
  assert.equal(breathPhase(60_000), 'Breathe in');
  assert.equal(breathPhase(56_001), 'Breathe in');
  assert.equal(breathPhase(56_000), 'Breathe out');
  assert.equal(breathPhase(50_001), 'Breathe out');
  assert.equal(breathPhase(50_000), 'Breathe in');
  assert.equal(breathPhase(0), 'Finished');
});

test('timer arithmetic rejects invalid time sources', () => {
  for (const now of [-1, NaN, Infinity, '100']) {
    assert.throws(() => remainingAt(createClock(), now), TypeError);
    assert.throws(() => resumeClock(createClock(), now), TypeError);
  }
});

test('every check-in combination produces an action and preserves the actual response', () => {
  for (const energy of Object.keys(ENERGY)) {
    for (const intention of Object.keys(INTENTIONS)) {
      for (const reflection of Object.keys(REFLECTIONS)) {
        const card = buildCard({ energy, intention, reflection, completed: true });
        assert.equal(card.before, ENERGY[energy]);
        assert.equal(card.after, REFLECTIONS[reflection]);
        assert.equal(card.intention, INTENTIONS[intention]);
        assert.ok(card.action.length > 30);
        assert.ok(card.title.length > 5);
      }
    }
  }
});

test('unchanged and worse reflections never imply a successful improvement', () => {
  const base = { energy: 'busy', intention: 'focus', completed: true };
  const same = buildCard({ ...base, reflection: 'same' });
  assert.match(same.message, /do not need a different result/);
  assert.equal(same.title, 'Put the rest on paper.');
  const worse = buildCard({ ...base, reflection: 'worse' });
  assert.equal(worse.title, 'You can stop here.');
  assert.match(worse.message, /less settled/);
  assert.match(worse.action, /without trying to change how you feel/);
});

test('early finish stays explicit in both card and downloaded text', () => {
  const card = buildCard({ energy: 'low', intention: 'away', reflection: 'same', completed: false });
  const text = cardText(card);
  assert.equal(card.session, 'Finished the guide early');
  assert.ok(text.includes(card.session));
  assert.ok(text.includes(card.action));
  assert.match(text, /Before: Low on energy/);
  assert.match(text, /After: About the same/);
  assert.doesNotMatch(text, /Completed a guided minute/);
});

test('unknown choices, inherited object keys and implicit completion are rejected', () => {
  const base = { energy: 'steady', intention: 'unwind', reflection: 'better', completed: true };
  for (const field of ['energy', 'intention', 'reflection']) {
    for (const value of ['', 'unknown', 'toString', '__proto__', undefined, null]) {
      assert.throws(() => buildCard({ ...base, [field]: value }), TypeError);
    }
  }
  for (const completed of [undefined, 'true', 1, null]) {
    assert.throws(() => buildCard({ ...base, completed }), TypeError);
  }
});
