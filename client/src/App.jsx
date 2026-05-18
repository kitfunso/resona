import React, { useEffect, useState } from 'react';
import ParticipantView from './views/ParticipantView.jsx';
import LoginView from './views/LoginView.jsx';
import { fetchMe } from './auth.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  async function reloadUser() {
    setLoading(true);
    try {
      setUser(await fetchMe());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reloadUser(); }, []);

  if (loading) return <div className="app-loading">Loading...</div>;
  if (!user) return <LoginView onSignedIn={reloadUser} />;
  return <ParticipantView user={user} onSignOut={reloadUser} />;
}
