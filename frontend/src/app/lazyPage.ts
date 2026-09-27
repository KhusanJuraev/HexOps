import type { PageEntry } from './modules'

// Each page is a separate chunk (route-level lazy loading).
export const lazyPage = (load: PageEntry['page']) => async () => {
  try {
    return { Component: (await load()).default }
  } catch (error) {
    // A rejected lazy() leaves React Router with an unresolved route, and it then
    // renders nothing at all: the whole app goes blank. Resolve to a component
    // that throws instead, so the route's own errorElement shows inside the shell.
    // Browsers cache failed module imports, so recovery is a reload (RouteError).
    return {
      Component: function PageLoadFailed(): never {
        throw error
      },
    }
  }
}
