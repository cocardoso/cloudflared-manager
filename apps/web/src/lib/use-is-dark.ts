import { useEffect, useState } from 'react';

/** Tracks Kumo's data-mode attribute so charts can follow the theme. */
export function useIsDark() {
  const read = () => document.documentElement.getAttribute('data-mode') === 'dark';
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const update = () => setDark(read());
    window.addEventListener('tm:theme', update);
    return () => window.removeEventListener('tm:theme', update);
  }, []);
  return dark;
}
