export type Theme = 'light' | 'dark';
const KEY = 'cm.theme';

export function initTheme(): void {
  const t = localStorage.getItem(KEY);
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
}

export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem(KEY, next);
  document.documentElement.setAttribute('data-theme', next);
  return next;
}
