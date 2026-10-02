import { useCallback, useState } from 'react'

/**
 * Undo history as plain data, kept apart from React so the rules can be tested directly.
 *
 * Edits that land within `MERGE_MS` of the previous one join the same step, so one paint drag
 * or one burst of typing undoes as a whole rather than cell by cell or letter by letter.
 */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
  /** When the last edit landed; 0 after undo, redo or a replace, so the next edit starts a new step. */
  lastEdit: number
}

export const MERGE_MS = 600
const LIMIT = 100

export function initialHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastEdit: 0 }
}

export function edit<T>(history: History<T>, next: T, now: number): History<T> {
  if (next === history.present) return history
  const merge = history.lastEdit > 0 && now - history.lastEdit < MERGE_MS
  return {
    past: merge ? history.past : [...history.past, history.present].slice(-LIMIT),
    present: next,
    future: [],
    lastEdit: now,
  }
}

/** A wholesale change (loading a file or an example) — always its own step. */
export function replace<T>(history: History<T>, next: T): History<T> {
  return { past: [...history.past, history.present].slice(-LIMIT), present: next, future: [], lastEdit: 0 }
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
    lastEdit: 0,
  }
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
    lastEdit: 0,
  }
}

export function useUndoable<T>(initial: () => T) {
  const [history, setHistory] = useState(() => initialHistory(initial()))
  return {
    value: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    update: useCallback((recipe: (value: T) => T) => {
      const now = Date.now()
      setHistory((h) => edit(h, recipe(h.present), now))
    }, []),
    replace: useCallback((next: T) => setHistory((h) => replace(h, next)), []),
    undo: useCallback(() => setHistory(undo), []),
    redo: useCallback(() => setHistory(redo), []),
  }
}
