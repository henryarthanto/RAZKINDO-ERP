import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Unit } from '@/types';

interface UnitState {
  selectedUnitId: string | null;
  units: Unit[];
  
  setSelectedUnit: (unitId: string | null) => void;
  setUnits: (units: Unit[]) => void;
}

// skipHydration: true — see auth-store.ts for rationale
export const useUnitStore = create<UnitState>()(
  persist(
    (set) => ({
      selectedUnitId: null,
      units: [],
      
      setSelectedUnit: (unitId) => set({ selectedUnitId: unitId }),
      setUnits: (units) => set({ units })
    }),
    {
      name: 'razkindo-units',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    }
  )
);
