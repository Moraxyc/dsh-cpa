import type * as React from 'react'

/** One profile-backed form write issued by a settings field. */
export interface SettingsFormPatch {
  op: 'set'
  path: readonly string[]
  value: string
}

/** Snapshot store returned by `SettingsFormModel.bind()`. */
export interface SnapshotStore<T> {
  set(value: T): void
}

/** Profile-backed scope owned by `configForms.get(namespace)`. */
export interface ConfigFormScope {
  mutate(patch: readonly SettingsFormPatch[]): Promise<void>
}

export interface ConfigNamespaceSecret {
  path: readonly string[]
  set: boolean
}

export interface ConfigNamespaceView {
  ns: string
  revision: number
  secrets?: readonly ConfigNamespaceSecret[]
}

export interface ConfigFormView {
  namespaces?: readonly ConfigNamespaceView[]
}

export interface ConfigFormSnapshot {
  view?: ConfigFormView
}

/** Read-only companion of a profile-backed form scope. */
export interface ConfigFormDescribe {
  subscribe(listener: () => void): () => void
  getSnapshot(): ConfigFormSnapshot
}

export interface ConfigFormsService {
  get(namespace: string): ConfigFormScope
  describe(): ConfigFormDescribe
  whileServed(namespaces: readonly string[], callback: () => () => void): () => void
}

export interface SlotRegistration {
  name: string
  id: string
  order?: number
  label?: string | (() => string)
  inject?: () => object
}

/**
 * A slot renders components without constraining their props. `never` accepts
 * every component signature under contravariant parameter checking.
 */
export type SlotComponent = React.ComponentType<never>

export interface SlotsService {
  inject(key: string, callback: () => () => void): () => void
  register(options: SlotRegistration, component: SlotComponent): () => void
}

export type EffectCleanup = () => void | Promise<void>

/** Subset of the Client plugin context this bundle consumes. */
export interface ClientContext {
  configForms: ConfigFormsService
  slots: SlotsService
  effect(callback: () => EffectCleanup, label?: string): void
}
