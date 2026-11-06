import type { ClientPlugin, ClientRequire } from './runtime.js'

declare global {
  interface Window {
    __ModuleLoader__: {
      load(registration: {
        id: string
        factory(require: ClientRequire): ClientPlugin
      }): void
    }
  }
}

export {}
