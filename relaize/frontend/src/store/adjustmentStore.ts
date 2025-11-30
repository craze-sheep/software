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

export const DEFAULT_ADJUSTMENT_PARAMS: Record<AdjustmentKey, number> = {
  compensation: 65,
  colorTemp: 10,
  saturation: 118,
  contrast: 1.5,
  sharpness: 55,
  dehaze: 55,
  denoise: 45,
  edgePreserve: 70,
};

type AdjustmentState = {
  parameters: Record<AdjustmentKey, number>;
  setParameter: (key: AdjustmentKey, value: number) => void;
  setParameters: (values: Partial<Record<AdjustmentKey, number>>) => void;
  reset: () => void;
};

export const useAdjustmentStore = create<AdjustmentState>((set) => ({
  parameters: { ...DEFAULT_ADJUSTMENT_PARAMS },
  setParameter: (key, value) =>
    set((state) => ({
      parameters: {
        ...state.parameters,
        [key]: value,
      },
    })),
  setParameters: (values) =>
    set((state) => ({
      parameters: {
        ...state.parameters,
        ...values,
      },
    })),
  reset: () => set({ parameters: { ...DEFAULT_ADJUSTMENT_PARAMS } }),
}));
