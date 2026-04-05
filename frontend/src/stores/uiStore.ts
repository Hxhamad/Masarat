import { create } from 'zustand';

type Theme = 'dark' | 'light';

const THEME_KEY = 'masarat_theme';

function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch { /* ignore */ }
  return 'dark';
}

const initialTheme = loadTheme();
document.documentElement.setAttribute('data-theme', initialTheme);

interface UIState {
  theme: Theme;
  infoPanelOpen: boolean;

  toggleTheme: () => void;
  setInfoPanelOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: initialTheme,
  infoPanelOpen: false,

  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      return { theme: next };
    }),

  setInfoPanelOpen: (infoPanelOpen) => set({ infoPanelOpen }),
}));
