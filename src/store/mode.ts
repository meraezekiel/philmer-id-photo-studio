/**
 * Which flow the app is in: the ID wizard or Photo Print. Remembered per
 * machine so a shop that mostly prints photos starts on that card.
 */

import { create } from 'zustand'

export type AppMode = 'id' | 'edit'

const MODE_KEY = 'philmer.mode'

function readMode(): AppMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'edit' ? 'edit' : 'id'
  } catch {
    // Private mode, blocked storage, or tests with no window.
    return 'id'
  }
}

interface ModeState {
  mode: AppMode
  setMode: (mode: AppMode) => void
}

export const useMode = create<ModeState>((set) => ({
  mode: readMode(),
  setMode: (mode) => {
    try {
      window.localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* the choice simply is not remembered */
    }
    set({ mode })
  },
}))
