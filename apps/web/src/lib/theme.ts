export type Theme = 'light' | 'dark' | 'system';

export function getStoredTheme(): Theme {
  try {
    return (localStorage.getItem('tm.theme') as Theme | null) ?? 'system';
  } catch {
    return 'system';
  }
}

export const isDark = (theme: Theme) =>
  theme === 'dark' || (theme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);

/** Kumo switches palettes via data-mode on the root element. */
export function applyTheme(theme: Theme) {
  try {
    localStorage.setItem('tm.theme', theme);
  } catch {
    /* storage unavailable */
  }
  const dark = isDark(theme);
  document.documentElement.setAttribute('data-mode', dark ? 'dark' : 'light');
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  window.dispatchEvent(new Event('tm:theme'));
}
