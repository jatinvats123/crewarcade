'use client';

import { useEffect, useState } from 'react';
import { IconButton } from '@/components/ui/IconButton';

type Theme = 'light' | 'dark';
const KEY = 'crewarcade:theme';

function current(): Theme {
  const set = document.documentElement.dataset.theme;
  return set === 'light' ? 'light' : 'dark'; // dark is the default theme
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(current()), []);
  const toggle = () => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    setTheme(next);
  };
  return (
    <IconButton
      label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      onClick={toggle}
      icon={<span aria-hidden>{theme === 'light' ? '🌙' : '☀️'}</span>}
    />
  );
}
