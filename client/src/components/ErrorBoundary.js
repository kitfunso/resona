import React from 'react';

// App-level error boundary. A render or lifecycle throw in any child no longer
// blanks the whole app; we show a recoverable fallback instead (audit FE-4).
//
// Written with React.createElement (no JSX) and a .js extension on purpose: the
// client test harness runs `node --test`, which does not transpile JSX, so this
// keeps the boundary importable and unit-testable while still working under Vite.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message ?? 'Something went wrong' };
  }

  componentDidCatch(error, info) {
    // Diagnosis only. The error + component stack carry no user health data.
    console.error('[error-boundary]', error, info?.componentStack ?? '');
  }

  handleReload() {
    if (typeof window !== 'undefined' && window.location) window.location.reload();
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return React.createElement(
      'div',
      {
        role: 'alert',
        style: { padding: '2rem', maxWidth: '32rem', margin: '4rem auto', textAlign: 'center' },
      },
      React.createElement('h1', { className: 'serif', style: { marginBottom: '0.5rem' } }, 'Something went wrong'),
      React.createElement(
        'p',
        { style: { color: 'var(--bone-2)' } },
        'The app hit an unexpected error. Your data was not affected. Try reloading.',
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: this.handleReload,
          style: {
            marginTop: '1rem',
            padding: '0.6rem 1.4rem',
            borderRadius: '999px',
            border: '1px solid var(--brass-line)',
            background: 'var(--ink-3)',
            color: 'var(--bone-0)',
            cursor: 'pointer',
          },
        },
        'Reload',
      ),
    );
  }
}
