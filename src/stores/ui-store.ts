import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark' | 'system';
  notifications: { id: string; message: string; type: 'info' | 'success' | 'error' }[];

  setSidebarOpen: (open: boolean) => void;
}

// skipHydration: true — see auth-store.ts for rationale
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      theme: 'system',
      notifications: [],

      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: 'razkindo-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ theme: state.theme }),
      skipHydration: true,
    }
  )
);
