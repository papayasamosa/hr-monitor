import { useEffect, useRef } from 'react';

/**
 * Fires `onResume` when the app comes back to the foreground - covers both
 * a backgrounded/reopened native WebView (Capacitor's Android WebView still
 * dispatches standard DOM visibility events, so no extra native plugin is
 * needed) and a browser tab regaining focus. Deliberately does NOT fire on
 * initial mount, only on an actual return-to-foreground transition.
 */
export function useAppForegroundResume(onResume) {
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') onResumeRef.current?.();
    };
    const handleFocus = () => onResumeRef.current?.();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);
}
