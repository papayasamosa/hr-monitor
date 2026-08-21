import React, { useCallback, useState } from 'react';
import AndroidHome from './AndroidHome';
import AndroidDeviceSettings from './AndroidDeviceSettings';
import AndroidHistoryView from './AndroidHistoryView';
import AndroidSessionDetail from './AndroidSessionDetail';
import { useRecordingSession } from '../../hooks/useRecordingSession';
import { useAndroidConnection } from '../../hooks/useAndroidConnection';

/**
 * Android's own top-level shell - a deliberately different navigation and
 * screen set from the web app's, sharing the same underlying session
 * recording/storage/CSV logic (useRecordingSession, services/*). Connection
 * state is owned here (not inside AndroidHome) so it survives navigating to
 * Device Settings and back rather than being torn down/recreated.
 */
function AndroidApp() {
  const [view, setView] = useState('home'); // 'home' | 'device' | 'history' | 'detail'
  const [selectedSessionId, setSelectedSessionId] = useState(null);

  const session = useRecordingSession();

  const handleDisconnected = useCallback(() => {
    session.abortRecording('interrupted');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connection = useAndroidConnection({
    onReading: session.processReading,
    onDisconnected: handleDisconnected
  });

  const openDeviceSettings = () => setView('device');
  const openHistory = () => setView('history');
  const openSession = (sessionId) => {
    setSelectedSessionId(sessionId);
    setView('detail');
  };
  const backToHome = () => setView('home');
  const backToHistory = () => setView('history');

  return (
    <div className="android-app">
      {view === 'home' && (
        <AndroidHome
          session={session}
          connection={connection}
          onOpenHistory={openHistory}
          onOpenDeviceSettings={openDeviceSettings}
        />
      )}
      {view === 'device' && <AndroidDeviceSettings connection={connection} onBack={backToHome} />}
      {view === 'history' && <AndroidHistoryView onBack={backToHome} onOpenSession={openSession} />}
      {view === 'detail' && <AndroidSessionDetail sessionId={selectedSessionId} onBack={backToHistory} />}
    </div>
  );
}

export default AndroidApp;
