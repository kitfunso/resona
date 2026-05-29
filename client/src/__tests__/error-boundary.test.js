import test from 'node:test';
import assert from 'node:assert/strict';
import ErrorBoundary from '../components/ErrorBoundary.js';

// Unit tests for the app-level error boundary (audit FE-4). React.createElement
// elements are plain objects, so the boundary's contract is testable without a
// DOM renderer.

test('getDerivedStateFromError flips to the error state and keeps the message', () => {
  const next = ErrorBoundary.getDerivedStateFromError(new Error('boom'));
  assert.equal(next.hasError, true);
  assert.equal(next.message, 'boom');
});

test('getDerivedStateFromError tolerates a non-Error throw', () => {
  const next = ErrorBoundary.getDerivedStateFromError(undefined);
  assert.equal(next.hasError, true);
  assert.equal(typeof next.message, 'string');
});

test('renders children unchanged when healthy', () => {
  const inst = new ErrorBoundary({ children: 'CHILD' });
  assert.equal(inst.state.hasError, false);
  assert.equal(inst.render(), 'CHILD');
});

test('renders a recoverable fallback (role=alert, Reload) and hides the crashed children', () => {
  const inst = new ErrorBoundary({ children: 'CHILD' });
  inst.state = { hasError: true, message: 'boom' };
  const el = inst.render();
  assert.equal(el.type, 'div');
  assert.equal(el.props.role, 'alert');
  const flat = JSON.stringify(el);
  assert.ok(flat.includes('Reload'), 'fallback offers a Reload control');
  assert.ok(!flat.includes('CHILD'), 'crashed children are not rendered');
});
