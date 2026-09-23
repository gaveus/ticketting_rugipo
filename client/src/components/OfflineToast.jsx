import React, { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

/**
 * §9 — offline / network detection. A small non-blocking notice that appears
 * when the browser loses connectivity and disappears when it returns. Forms
 * are NEVER auto-resubmitted; the student stays in control.
 */
export default function OfflineToast() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [justRestored, setJustRestored] = useState(false);

  useEffect(() => {
    const goOffline = () => { setOnline(false); setJustRestored(false); };
    const goOnline = () => { setOnline(true); setJustRestored(true); };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  useEffect(() => {
    if (!justRestored) return;
    const t = setTimeout(() => setJustRestored(false), 4000);
    return () => clearTimeout(t);
  }, [justRestored]);

  if (online && !justRestored) return null;

  return (
    <div className={`net-toast ${online ? 'net-toast--ok' : 'net-toast--off'}`} role="status" aria-live="polite">
      {online
        ? <><Wifi size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} /><span><strong>Connection Restored</strong> — you are back online.</span></>
        : <><WifiOff size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} /><span><strong>You're Offline</strong> — your internet connection appears to be unavailable. Some RUGIPO ICT services may not work until your connection returns.</span></>}
    </div>
  );
}
