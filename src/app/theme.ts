import { useCallback, useEffect, useState } from 'react'

/**
 * Light or dark, or (until one is picked) whatever the device says. It's a preference of this
 * browser rather than part of the project, so it has its own storage key and never travels in a
 * backup file.
 *
 * The stylesheet keys its dark tokens off `data-theme` on `<html>`, which is always the resolved
 * `light` or `dark`. `index.html` sets it before first paint with the same rule as
 * {@link resolveTheme}, so a reload doesn't flash the wrong theme; keep the two in step.
 */
export type Theme = 'system' | 'light' | 'dark'

export const THEME_KEY = 'scheduleMaker.theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function resolveTheme(theme: Theme, deviceIsDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (deviceIsDark ? 'dark' : 'light') : theme
}

/** Storage can be missing or throw (private windows, blocked site data) — treat that as unset. */
export function loadTheme(storage: Pick<Storage, 'getItem'> | undefined): Theme {
  try {
    const stored = storage?.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function saveTheme(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, theme: Theme): void {
  try {
    if (theme === 'system') storage?.removeItem(THEME_KEY)
    else storage?.setItem(THEME_KEY, theme)
  } catch {
    // The choice still holds for this visit.
  }
}

/**
 * The theme on screen and a way to flip it. Until it's flipped the app follows the device, live;
 * after that the choice sticks. Keeps `<html data-theme>` in step.
 */
export function useTheme(storage: Storage | undefined): ['light' | 'dark', () => void] {
  const [theme, setTheme] = useState(() => loadTheme(storage))
  const [deviceIsDark, setDeviceIsDark] = useState(() => window.matchMedia(DARK_QUERY).matches)
  const resolved = resolveTheme(theme, deviceIsDark)

  useEffect(() => {
    const device = window.matchMedia(DARK_QUERY)
    const onChange = () => setDeviceIsDark(device.matches)
    device.addEventListener('change', onChange)
    return () => device.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const toggle = useCallback(() => {
    const next = resolved === 'dark' ? 'light' : 'dark'
    saveTheme(storage, next)
    setTheme(next)
  }, [resolved, storage])

  return [resolved, toggle]
}
