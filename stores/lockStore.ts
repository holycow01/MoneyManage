import { create } from "zustand";

type LockState = {
  /** Are we currently showing the lock screen? */
  isLocked: boolean;
  /** Has AuthGate completed its initial check? */
  isInitialized: boolean;
  setLocked: (locked: boolean) => void;
  setInitialized: (v: boolean) => void;
};

export const useLockStore = create<LockState>((set) => ({
  isLocked: true, // start locked; AuthGate decides on mount
  isInitialized: false,
  setLocked: (isLocked) => set({ isLocked }),
  setInitialized: (isInitialized) => set({ isInitialized }),
}));
