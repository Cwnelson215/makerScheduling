import { useCallback, useEffect, useState } from 'react'
import type { StepId } from './steps'

/**
 * Pages, addressed by the URL hash (`#/employees/ana/availability`) so the browser's Back
 * button, reloads and bookmarks all land where you were. No router dependency: the hash is
 * the whole state.
 */
export type EmployeeTab = 'details' | 'availability' | 'time-off'
export type SettingsTab = 'shifts' | 'priorities'

export type Route =
  | { page: 'employees' }
  | { page: 'employee'; id: string; tab: EmployeeTab }
  | { page: 'coverage' }
  | { page: 'generate' }
  | { page: 'schedule' }
  | { page: 'settings'; tab: SettingsTab }

const EMPLOYEE_TABS: EmployeeTab[] = ['details', 'availability', 'time-off']
const SETTINGS_TABS: SettingsTab[] = ['shifts', 'priorities']

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  switch (parts[0]) {
    case 'employees':
      if (parts[1]) {
        const tab = EMPLOYEE_TABS.find((t) => t === parts[2]) ?? 'details'
        return { page: 'employee', id: parts[1], tab }
      }
      return { page: 'employees' }
    case 'coverage':
    case 'generate':
    case 'schedule':
      return { page: parts[0] }
    case 'settings':
      return { page: 'settings', tab: SETTINGS_TABS.find((t) => t === parts[1]) ?? 'shifts' }
    default:
      return { page: 'employees' }
  }
}

export function routeHash(route: Route): string {
  switch (route.page) {
    case 'employee':
      return `#/employees/${encodeURIComponent(route.id)}/${route.tab}`
    case 'settings':
      return `#/settings/${route.tab}`
    default:
      return `#/${route.page}`
  }
}

/** The step a page belongs to, for the step trail; Settings sits outside it. */
export function stepOf(route: Route): StepId | null {
  switch (route.page) {
    case 'employees':
    case 'employee':
      return 'employees'
    case 'settings':
      return null
    default:
      return route.page
  }
}

export function stepRoute(step: StepId): Route {
  return { page: step }
}

/** The current route, and a way to go somewhere (a new history entry, so Back returns). */
export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))

  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash))
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((next: Route) => {
    const hash = routeHash(next)
    if (window.location.hash !== hash) window.location.hash = hash
  }, [])

  return [route, navigate]
}
