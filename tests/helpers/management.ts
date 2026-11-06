import type { ManagementContext, ManagementWebScope } from '../../lib/server/management.js'
import { startServer } from './http.ts'
import type { TestServer } from './http.ts'

/** The web carrier the management panel registers its routes on. */
export type RouteWebServer = ManagementWebScope['webServer']
export type ManagementRoute = Parameters<RouteWebServer['register']>[0]

export interface RouteRecorder {
  readonly routes: ManagementRoute[]
  readonly webServer: RouteWebServer
}

/** In-memory carrier that tracks which routes are currently registered on it. */
export function createRouteRecorder(): RouteRecorder {
  const routes: ManagementRoute[] = []
  return {
    routes,
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index !== -1) routes.splice(index, 1)
        }
      },
    },
  }
}

export function findRoute(routes: readonly ManagementRoute[], path: string): ManagementRoute {
  const route = routes.find(candidate => candidate.path === path)
  if (route === undefined) throw new Error(`route is not registered: ${path}`)
  return route
}

/** A scope bound to one carrier, plus the handle that releases everything its effects registered. */
export interface CarrierScope {
  readonly scope: ManagementWebScope
  unload(): void
}

/** One scope per carrier: effects run on install and their releases run on `unload`. */
export function createCarrierScope(webServer: RouteWebServer): CarrierScope {
  const releases: Array<() => void> = []
  return {
    scope: {
      webServer,
      effect(task) {
        releases.push(task())
      },
    },
    unload() {
      for (const release of releases.splice(0).reverse()) release()
    },
  }
}

/** Synchronous stand-in for the host inject seam: each injection runs its factory once. */
export function injectedContext(webServer: RouteWebServer): ManagementContext {
  return {
    inject(_deps, factory) {
      const carrier = createCarrierScope(webServer)
      factory(carrier.scope)
      return { dispose: carrier.unload }
    },
    logger: { warn() {} },
  }
}

/** Serves a single management route over real HTTP so handlers get genuine request and response objects. */
export function serveRoute(route: ManagementRoute): Promise<TestServer> {
  return startServer((req, res) => route.handler(req, res))
}
