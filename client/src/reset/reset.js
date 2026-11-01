export const MINUTE_MS = 60_000;
export const ENERGY = Object.freeze({ low: 'Low on energy', steady: 'Feeling steady', busy: 'A busy mind' });
export const INTENTIONS = Object.freeze({ focus: 'Find some focus', unwind: 'Slow things down', away: 'Step away' });
export const REFLECTIONS = Object.freeze({ better: 'More settled', same: 'About the same', worse: 'Less settled' });

const ACTIONS = Object.freeze({
  focus: Object.freeze({
    low: ['Make the next thing tiny.', 'Write down one task you can finish in five minutes. Start with its first small step.'],
    steady: ['Give one thing your attention.', 'Choose a single task. Close one distracting tab and spend the next ten minutes on that task.'],
    busy: ['Put the rest on paper.', 'Write down the things competing for your attention. Circle one small task and leave the rest for later.'],
  }),
  unwind: Object.freeze({
    low: ['Let one thing wait.', 'Choose one non-urgent task to leave until later. Give yourself a quiet minute before returning.'],
    steady: ['Make a little room.', 'Set your phone aside and notice three things around you. There is no need to change how you feel.'],
    busy: ['Give yourself a stopping point.', 'Write one sentence about where you will pick up next. Let that be enough for this moment.'],
  }),
  away: Object.freeze({
    low: ['Take a comfortable screen break.', 'Look away from the screen and choose a comfortable place to pause. Return when you are ready.'],
    steady: ['Change the scene.', 'If it feels comfortable, stand or move to a different spot for a moment. Leave your screen behind.'],
    busy: ['Leave yourself a return note.', 'Write down your next small step, then take a short break away from the screen.'],
  }),
});

function requireChoice(choices, value) {
  if (!Object.hasOwn(choices, value)) throw new TypeError('Choose one of the available options.');
}

function requireTime(now) {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('Time must be a non-negative number.');
}

export function createClock() {
  return { remainingMs: MINUTE_MS, startedAt: null };
}

export function remainingAt(clock, now) {
  requireTime(now);
  return Math.max(0, clock.remainingMs - (clock.startedAt === null ? 0 : Math.max(0, now - clock.startedAt)));
}

export function resumeClock(clock, now) {
  requireTime(now);
  return clock.startedAt !== null || clock.remainingMs === 0 ? clock : { ...clock, startedAt: now };
}

export function pauseClock(clock, now) {
  return { remainingMs: remainingAt(clock, now), startedAt: null };
}

export function breathPhase(remainingMs) {
  if (remainingMs <= 0) return 'Finished';
  return (MINUTE_MS - remainingMs) % 10_000 < 4_000 ? 'Breathe in' : 'Breathe out';
}

export function buildCard({ energy, intention, reflection, completed }) {
  requireChoice(ENERGY, energy);
  requireChoice(INTENTIONS, intention);
  requireChoice(REFLECTIONS, reflection);
  if (typeof completed !== 'boolean') throw new TypeError('Session completion must be explicit.');
  const [title, action] = reflection === 'worse'
    ? ['You can stop here.', 'Set the guide aside. Choose a quiet break that feels comfortable, without trying to change how you feel.']
    : ACTIONS[intention][energy];
  const message = reflection === 'better'
    ? 'You said you feel more settled. Take that observation with you.'
    : reflection === 'same'
      ? 'About the same is a useful answer. You do not need a different result.'
      : 'You said you feel less settled. There is no score to improve.';
  return { before: ENERGY[energy], intention: INTENTIONS[intention], after: REFLECTIONS[reflection],
    session: completed ? 'Completed a guided minute' : 'Finished the guide early', title, action, message };
}

export function cardText(card) {
  return ['RESONA RESET', '', card.session, `Before: ${card.before}`, `Intention: ${card.intention}`,
    `After: ${card.after}`, '', card.message, '', card.title, card.action, '',
    'A rule-based wellbeing prompt, not medical advice. Your check-in stays in your tab unless you save this card.'].join('\n');
}
