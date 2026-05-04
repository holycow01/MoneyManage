/**
 * Local-only preferences. Persisted to AsyncStorage via Zustand's
 * `persist` middleware so changes survive a relaunch.
 *
 * Things that live on the server (currency, theme, name) are not
 * here — those go into the `users` table and are written via Supabase.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type WeekStart = 0 | 1; // 0 = Sunday, 1 = Monday
export type AutoLockMinutes = 0 | 1 | 5 | 30;

export type Preferences = {
  weekStartsOn: WeekStart;
  monthStartsOnDay: number; // 1, 15, or any custom day-of-month

  biometricEnabled: boolean;
  autoLockMinutes: AutoLockMinutes;

  budgetAlertsEnabled: boolean;
  weeklyInsightsEnabled: boolean;
  dailyReminderEnabled: boolean;
  dailyReminderHour: number; // 0..23

  /** Hydrated from AsyncStorage. False until the persist layer fires. */
  _hydrated: boolean;
};

type Store = Preferences & {
  set: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  reset: () => void;
};

const DEFAULTS: Preferences = {
  weekStartsOn: 1,
  monthStartsOnDay: 1,

  biometricEnabled: true,
  autoLockMinutes: 1,

  budgetAlertsEnabled: true,
  weeklyInsightsEnabled: true,
  dailyReminderEnabled: false,
  dailyReminderHour: 21,

  _hydrated: false,
};

export const usePreferencesStore = create<Store>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Partial<Preferences>),
      reset: () => set({ ...DEFAULTS, _hydrated: true }),
    }),
    {
      name: "pulse.preferences",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => {
        const { set: _set, reset: _reset, _hydrated, ...rest } = s;
        return rest;
      },
      onRehydrateStorage: () => (state) => {
        if (state) state._hydrated = true;
      },
    },
  ),
);
