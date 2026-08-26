import React, { useState } from 'react';
import HRMonitor from './components/HRMonitor';
import HistoryView from './components/HistoryView';
import SessionDetailView from './components/SessionDetailView';
import Dashboard from './components/Dashboard';
import AndroidApp from './components/android/AndroidApp';
import { isNativePlatform } from './services/platform';

function WebApp() {
  const [view, setView] = useState('monitor'); // 'monitor' | 'history' | 'detail' | 'dashboard'
  const [selectedSessionId, setSelectedSessionId] = useState(null);

  const openHistory = () => setView('history');
  const openDashboard = () => setView('dashboard');
  const openSession = (sessionId) => {
    setSelectedSessionId(sessionId);
    setView('detail');
  };
  const backToMonitor = () => setView('monitor');
  const backToHistory = () => setView('history');

  return (
    <>
      {view === 'monitor' && <HRMonitor onOpenHistory={openHistory} onOpenDashboard={openDashboard} />}
      {view === 'history' && <HistoryView onBack={backToMonitor} onOpenSession={openSession} />}
      {view === 'detail' && <SessionDetailView sessionId={selectedSessionId} onBack={backToHistory} />}
      {view === 'dashboard' && <Dashboard onBack={backToMonitor} />}
    </>
  );
}

// Web and Android intentionally have separate UI shells (different navigation,
// different screens - see AndroidApp) sharing the same underlying session/
// storage/bluetooth services. See services/platform.js.
function App() {
  return <div className="app">{isNativePlatform() ? <AndroidApp /> : <WebApp />}</div>;
}

export default App;
