/**
 * Route prefetching utilities for optimized navigation
 *
 * Preloads route chunks when user hovers over navigation links
 */

// Define lazy import functions that match App.tsx
const routeImports = {
  dashboard: () => import('@/features/dashboard/DashboardPage'),
  inbox: () => import('@/features/inbox/InboxPage'),
  chats: () => import('@/features/chats/ChatsPage'),
  boards: () => import('@/features/boards/BoardsPage'),
  contacts: () => import('@/features/contacts/ContactsPage'),
  settings: () => import('@/features/settings/SettingsPage'),
  activities: () => import('@/features/activities/ActivitiesPage'),
  reports: () => import('@/features/reports/ReportsPage'),
  suggestions: () => import('@/features/suggestions/SuggestionsPage'),
  tutorial: () => import('@/features/tutorial/TutorialPage'),
} as const;

export type RouteName = keyof typeof routeImports;

// Cache to avoid duplicate prefetches
const prefetchedRoutes = new Set<RouteName>();

/**
 * Prefetch a route's chunk before navigation
 * @param route - The route name to prefetch
 */
export const prefetchRoute = (route: RouteName): void => {
  if (prefetchedRoutes.has(route)) return;

  prefetchedRoutes.add(route);

  // Use requestIdleCallback for non-blocking prefetch
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      routeImports[route]().catch(() => {
        // Silent fail - will load on actual navigation
        prefetchedRoutes.delete(route);
      });
    });
  } else {
    // Fallback for Safari
    setTimeout(() => {
      routeImports[route]().catch(() => {
        prefetchedRoutes.delete(route);
      });
    }, 100);
  }
};

/**
 * Prefetch multiple routes at once
 * Useful for predictive loading based on user behavior
 */
export const prefetchRoutes = (routes: RouteName[]): void => {
  routes.forEach(prefetchRoute);
};

/**
 * Prefetch all routes after initial page load
 * Use sparingly - only when bandwidth is not a concern
 */
export const prefetchAllRoutes = (): void => {
  // Wait for initial render to complete
  if ('requestIdleCallback' in window) {
    requestIdleCallback(
      () => {
        Object.keys(routeImports).forEach(route => {
          prefetchRoute(route as RouteName);
        });
      },
      { timeout: 5000 }
    );
  }
};

/**
 * Get the route name from a path
 */
export const getRouteFromPath = (path: string): RouteName | null => {
  const cleanPath = path.replace(/^\//, '').split('/')[0] || 'dashboard';

  if (cleanPath in routeImports) {
    return cleanPath as RouteName;
  }

  // Handle aliases
  if (cleanPath === 'pipeline') return 'boards';

  return null;
};

/**
 * Hook-friendly prefetch handler for NavLink hover
 */
export const createPrefetchHandler = (path: string) => {
  return () => {
    const route = getRouteFromPath(path);
    if (route) {
      prefetchRoute(route);
    }
  };
};
