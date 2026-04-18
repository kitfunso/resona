import React from 'react';
import ParticipantView from './views/ParticipantView.jsx';
import ProjectorView from './views/ProjectorView.jsx';

export default function App() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (path === '/projector' || path === '/projector/') {
    return <ProjectorView />;
  }
  return <ParticipantView />;
}
