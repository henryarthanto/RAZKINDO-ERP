'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// =====================================================================
// VIEW CONFIGURATION STORE - Dynamic Font Size & View Settings
// =====================================================================
interface ViewState {
  fontSize: number;

  // Actions
  setFontSize: (size: number) => void;
  resetViewSettings: () => void;
}

const DEFAULT_VIEW_SETTINGS = {
  fontSize: 14,
};

export const useViewStore = create<ViewState>()(
  persist(
    (set) => ({
      ...DEFAULT_VIEW_SETTINGS,

      setFontSize: (fontSize) => {
        set({ fontSize });
        // Inject CSS variable for dynamic font
        if (typeof document !== 'undefined') {
          document.documentElement.style.setProperty('--dynamic-font', `${fontSize}px`);
          document.documentElement.style.fontSize = `${fontSize}px`;
        }
      },

      resetViewSettings: () => {
        set(DEFAULT_VIEW_SETTINGS);
        if (typeof document !== 'undefined') {
          document.documentElement.style.setProperty('--dynamic-font', `${DEFAULT_VIEW_SETTINGS.fontSize}px`);
          document.documentElement.style.fontSize = `${DEFAULT_VIEW_SETTINGS.fontSize}px`;
        }
      },
    }),
    {
      name: 'razkindo-view-settings',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state?.fontSize) {
          document.documentElement.style.setProperty('--dynamic-font', `${state.fontSize}px`);
          document.documentElement.style.fontSize = `${state.fontSize}px`;
        }
      },
      skipHydration: true,
    }
  )
);
