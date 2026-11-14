import type * as React from 'react'
import type {
  ConfigFormScope,
  SnapshotStore,
} from './context.js'

export interface IconProps {
  size?: number
}

export type IconComponent = React.ComponentType<IconProps>

export interface ButtonProps {
  variant?: string
  size?: string
  icon?: React.ReactNode
  disabled?: boolean
  onClick?: () => void
  children?: React.ReactNode
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  closeLabel: string
  className?: string
  contentClassName?: string
  children?: React.ReactNode
}

export interface PillProps {
  active?: boolean
  'aria-pressed'?: boolean
  disabled?: boolean
  onClick?: () => void
  children?: React.ReactNode
}

export interface StateDotProps {
  state: string
}

export interface SettingsValueFieldProps {
  id: string
  label: string
  hint?: string
  overriddenLabel?: string
  resetLabel?: string
  invalidLabel?: string
  numeric?: boolean
  placeholder?: string
  disabled?: boolean
  text?: string
  onEdit?: (text: string) => void
  onReset?: () => void
}

export interface SettingsSecretFieldProps {
  id: string
  label: string
  hint?: string
  text?: string
  configured?: boolean
  stateLabel?: string
  disabled?: boolean
  onEdit?: (text: string) => void
}

export interface SettingsFormLabels {
  unavailable: string
  readOnly: string
  saveFailed: string
  save: string
  saving: string
}

export interface SettingsFieldState {
  text: string
  /** Whether saving would leave a user-layer override for the field. */
  overridden?: boolean
  /** Whether the draft is not a value the field accepts; the save stays blocked. */
  invalid?: boolean
}

export interface FormShell {
  /** False while the Host does not serve this namespace; the entry renders nothing. */
  available?: boolean
  writable: boolean
  dirty?: boolean
  invalid?: boolean
  saving: boolean
  /** Whether the last save did not land as staged. */
  failed?: boolean
}

export interface FormActions {
  edit(field: string, value: string): void
  save(): void
  discard(): void
  resetField(field: string): void
}

export interface SettingsFormModelHandle {
  bind<T>(select: () => T): SnapshotStore<T>
  shell(): FormShell
  field(name: string): SettingsFieldState
  actions(): FormActions
  dispose(): void
}

export interface SettingsFieldDescriptor {
  field: string
}

export interface SettingsSecretRegistration {
  field: string
  write(value: string): Promise<void>
}

export interface SettingsFormModelConstructor {
  new (
    scope: ConfigFormScope,
    fields: readonly SettingsFieldDescriptor[],
    secrets: readonly SettingsSecretRegistration[],
  ): SettingsFormModelHandle
}

export interface SettingsFormProps {
  labels: SettingsFormLabels
  state: FormShell
  onSave: () => void
  onDiscard: () => void
  children?: React.ReactNode
}

export interface TooltipProps {
  label: string
  side?: 'top' | 'bottom'
  portal?: boolean
  delayMs?: number
  onlyWhenClipped?: boolean
  disabled?: boolean
  children?: React.ReactNode
}

export type UseDismissOnOutsidePointer = (
  anchorRef: React.RefObject<Element | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
  panelRef: React.RefObject<Element | null>,
) => void

/** Browser module-table exports this plugin consumes. */
export interface ClientPrimitives {
  Button: React.ComponentType<ButtonProps>
  Modal: React.ComponentType<ModalProps>
  Pill: React.ComponentType<PillProps>
  SettingsForm: React.ComponentType<SettingsFormProps>
  SettingsFormModel: SettingsFormModelConstructor
  SettingsSecretField: React.ComponentType<SettingsSecretFieldProps>
  SettingsValueField: React.ComponentType<SettingsValueFieldProps>
  StateDot: React.ComponentType<StateDotProps>
  Tooltip: React.ComponentType<TooltipProps>
  settingsNumberField(field: string): SettingsFieldDescriptor
  settingsTextField(field: string): SettingsFieldDescriptor
  useDismissOnOutsidePointer: UseDismissOnOutsidePointer
  IconApiOutlineRegular?: IconComponent
  IconApiOutlineMedium?: IconComponent
  IconGaugeOutlineRegular?: IconComponent
  IconSettingsOutlineRegular?: IconComponent
  IconSettingsOutline14?: IconComponent
  IconStopFillRegular?: IconComponent
  IconStopFill16?: IconComponent
}

