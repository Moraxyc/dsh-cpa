import type { ManagementContext, ManagementWebScope } from '../../lib/server/management.js'
import { startServer } from './http.ts'
import type { TestServer } from './http.ts'

export type RouteWebServer = ManagementWebScope['webServer']
export type ManagementRoute = Parameters<RouteWebServer['register']>[0]

export interface RouteRecorder {
  readonly routes: ManagementRoute[]
  readonly webServer: RouteWebServer
}

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

export interface CarrierScope {
  readonly scope: ManagementWebScope
  unload(): void
}

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

export function serveRoute(route: ManagementRoute): Promise<TestServer> {
  return startServer((req, res) => route.handler(req, res))
}
