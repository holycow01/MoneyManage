/**
 * The entry store: a single source of truth for the quick-entry UI.
 *
 * The screen reads `expression` (for the calculator readout) and `amount`
 * (the evaluated number, used for save). Every keypress goes through
 * `pressKey` which keeps the two in sync.
 *
 * `selectedAccountId` is *not* cleared on `reset()` — most users log
 * several entries against the same account so we keep it sticky.
 */
import { create } from "zustand";

import { appendKey, evaluate } from "@/lib/calculator";

export type EntryState = {
  /** Raw expression, e.g. "120+5×3". Empty string means "no input yet". */
  expression: string;
  /** Live evaluation of the expression. 0 when expression is empty. */
  amount: number;

  selectedCategoryId: string | null;
  selectedAccountId: string | null;
  note: string;

  /** Apply a key from the keypad: 0-9, ".", "+", "−", "×", "÷", "⌫", "C". */
  pressKey: (key: string) => void;

  setCategory: (id: string | null) => void;
  setAccount: (id: string | null) => void;
  setNote: (note: string) => void;

  /** Hydrate the amount directly (used by shortcut taps). */
  setAmount: (amount: number) => void;

  /** Reset for the next entry. Keeps `selectedAccountId` (sticky). */
  reset: () => void;
};

export const useEntryStore = create<EntryState>((set) => ({
  expression: "",
  amount: 0,
  selectedCategoryId: null,
  selectedAccountId: null,
  note: "",

  pressKey: (key) =>
    set((s) => {
      const expression = appendKey(s.expression, key);
      return { expression, amount: evaluate(expression) };
    }),

  setCategory: (selectedCategoryId) => set({ selectedCategoryId }),
  setAccount: (selectedAccountId) => set({ selectedAccountId }),
  setNote: (note) => set({ note }),

  setAmount: (amount) =>
    set({
      amount,
      expression: amount ? String(amount) : "",
    }),

  reset: () =>
    set((s) => ({
      expression: "",
      amount: 0,
      selectedCategoryId: null,
      note: "",
      selectedAccountId: s.selectedAccountId, // sticky
    })),
}));
