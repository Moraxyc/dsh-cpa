import type * as React from 'react'
import type { ClientContext } from './context.js'
import type { ClientPrimitives } from './primitives.js'

export interface ClientReactDOM {
  createPortal(children: React.ReactNode, container: Element): React.ReactPortal
}

export interface ClientRequire {
  (id: 'react'): typeof React
  (id: 'react-dom'): ClientReactDOM
  (id: '@deepseek-ai/dsh-client-ui-primitives'): ClientPrimitives
}

export interface ClientRuntime {
  React: typeof React
  ReactDOM: ClientReactDOM
  primitives: ClientPrimitives
}

export interface ClientPlugin {
  name: string
  inject: readonly string[]
  apply(ctx: ClientContext): void
}

let activeRuntime: ClientRuntime | undefined

export function installClientRuntime(require: ClientRequire): void {
  activeRuntime = {
    React: require('react'),
    ReactDOM: require('react-dom'),
    primitives: require('@deepseek-ai/dsh-client-ui-primitives'),
  }
}

export function clientRuntime(): ClientRuntime {
  if (activeRuntime === undefined) {
    throw new Error('dsh-cpa: client runtime is not installed')
  }
  return activeRuntime
}
