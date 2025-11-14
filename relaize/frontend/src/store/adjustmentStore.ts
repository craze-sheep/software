import { create } from "zustand";

export type AdjustmentKey =
  | "compensation"
  | "colorTemp"
  | "saturation"
  | "contrast"
  | "sharpness"
  | "dehaze"
  | "denoise"
  | "edgePreserve";

type AdjustmentState = {
  parameters: Record<AdjustmentKey, number>;
  setParameter: (key: AdjustmentKey, value: number) => void;
  reset: () => void;
};

const defaultParams: Record<AdjustmentKey, number> = {
  compensation: 70,
  colorTemp: 20,
  saturation: 120,
  contrast: 1.8,
  sharpness: 60,
  dehaze: 75,
  denoise: 50,
  edgePreserve: 70,
};

export const useAdjustmentStore = create<AdjustmentState>((set) => ({
  parameters: defaultParams,
  setParameter: (key, value) =>
    set((state) => ({
      parameters: {
        ...state.parameters,
        [key]: value,
      },
    })),
  reset: () => set({ parameters: defaultParams }),
}));
