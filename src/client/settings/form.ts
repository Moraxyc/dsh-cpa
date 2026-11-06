import type { ConfigFormDescribe, ConfigFormScope, SnapshotStore } from '../context.js'
import type {
  FormActions,
  FormShell,
  SettingsFieldDescriptor,
  SettingsFieldState,
  SettingsFormModelHandle,
  SettingsSecretRegistration,
} from '../primitives.js'
import { clientRuntime } from '../runtime.js'

export type CpaSecretField = 'externalApiKey' | 'externalManagementKey'

export type CpaFieldName =
  | 'mode'
  | 'externalUrl'
  | 'externalApiKey'
  | 'externalManagementKey'
  | 'internalBin'
  | 'usageStatisticsEnabled'
  | 'routingStrategy'
  | 'dailyRequestLimit'
  | 'refreshIntervalMs'
  | 'port'
  | 'configPath'
  | 'settingsPath'
  | 'executionsPath'
  | 'authFilesTtlMs'
  | 'quotaTtlMs'
  | 'quotaConcurrency'

export type CpaTextFieldName = Exclude<
  CpaFieldName,
  'externalApiKey' | 'externalManagementKey' | 'usageStatisticsEnabled' | 'routingStrategy'
>

export interface CpaFormProjection extends FormShell {
  mode: SettingsFieldState
  externalUrl: SettingsFieldState
  externalApiKey: SettingsFieldState
  externalApiKeyConfigured: boolean
  externalManagementKey: SettingsFieldState
  externalManagementKeyConfigured: boolean
  internalBin: SettingsFieldState
  usageStatisticsEnabled: SettingsFieldState
  routingStrategy: SettingsFieldState
  dailyRequestLimit: SettingsFieldState
  refreshIntervalMs: SettingsFieldState
  port: SettingsFieldState
  configPath: SettingsFieldState
  settingsPath: SettingsFieldState
  executionsPath: SettingsFieldState
  authFilesTtlMs: SettingsFieldState
  quotaTtlMs: SettingsFieldState
  quotaConcurrency: SettingsFieldState
}

export interface FormInjection extends FormActions {
  hooks: {
    cpaCard: SnapshotStore<CpaFormProjection>
  }
}

interface BooleanFieldPatch {
  kind: 'clear' | 'set'
  value?: boolean
}

interface BooleanFieldDescriptor extends SettingsFieldDescriptor {
  format(value: boolean): string
  parse(text: string): BooleanFieldPatch | undefined
}

function booleanField(field: string): BooleanFieldDescriptor {
  return {
    field,
    format: value => String(value),
    parse: text => {
      const value = text.trim().toLowerCase()
      if (value === '') return { kind: 'clear' }
      if (value === 'true') return { kind: 'set', value: true }
      if (value === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

export class CpaSettingsFormController {
  private readonly scope: ConfigFormScope
  private readonly describe: ConfigFormDescribe
  private readonly form: SettingsFormModelHandle
  private readonly store: SnapshotStore<CpaFormProjection>
  private readonly unsubscribeDescribe: () => void

  constructor(scope: ConfigFormScope, describe: ConfigFormDescribe) {
    const primitives = clientRuntime().primitives
    this.scope = scope
    this.describe = describe
    const secrets: readonly SettingsSecretRegistration[] = [
      { field: 'externalApiKey', write: value => this.writeSecret('externalApiKey', value) },
      { field: 'externalManagementKey', write: value => this.writeSecret('externalManagementKey', value) },
    ]
    this.form = new primitives.SettingsFormModel(scope, [
      primitives.settingsTextField('mode'),
      primitives.settingsTextField('externalUrl'),
      primitives.settingsTextField('internalBin'),
      booleanField('usageStatisticsEnabled'),
      primitives.settingsTextField('routingStrategy'),
      primitives.settingsNumberField('dailyRequestLimit'),
      primitives.settingsNumberField('refreshIntervalMs'),
      primitives.settingsNumberField('port'),
      primitives.settingsTextField('configPath'),
      primitives.settingsTextField('settingsPath'),
      primitives.settingsTextField('executionsPath'),
      primitives.settingsNumberField('authFilesTtlMs'),
      primitives.settingsNumberField('quotaTtlMs'),
      primitives.settingsNumberField('quotaConcurrency'),
    ], secrets)
    this.store = this.form.bind(() => this.projection())
    this.unsubscribeDescribe = describe.subscribe(() => {
      this.store.set(this.projection())
    })
  }

  secretConfigured(field: CpaSecretField): boolean {
    const view = this.describe.getSnapshot().view
    const namespace = view?.namespaces?.find(entry => entry.ns === 'dsh-cpa')
    return namespace?.secrets?.some(secret => secret.set === true
      && secret.path.length === 1
      && secret.path[0] === field) ?? false
  }

  projection(): CpaFormProjection {
    return {
      ...this.form.shell(),
      mode: this.form.field('mode'),
      externalUrl: this.form.field('externalUrl'),
      externalApiKey: this.form.field('externalApiKey'),
      externalApiKeyConfigured: this.secretConfigured('externalApiKey'),
      externalManagementKey: this.form.field('externalManagementKey'),
      externalManagementKeyConfigured: this.secretConfigured('externalManagementKey'),
      internalBin: this.form.field('internalBin'),
      usageStatisticsEnabled: this.form.field('usageStatisticsEnabled'),
      routingStrategy: this.form.field('routingStrategy'),
      dailyRequestLimit: this.form.field('dailyRequestLimit'),
      refreshIntervalMs: this.form.field('refreshIntervalMs'),
      port: this.form.field('port'),
      configPath: this.form.field('configPath'),
      settingsPath: this.form.field('settingsPath'),
      executionsPath: this.form.field('executionsPath'),
      authFilesTtlMs: this.form.field('authFilesTtlMs'),
      quotaTtlMs: this.form.field('quotaTtlMs'),
      quotaConcurrency: this.form.field('quotaConcurrency'),
    }
  }

  inject(): FormInjection {
    return { hooks: { cpaCard: this.store }, ...this.form.actions() }
  }

  async writeSecret(field: CpaSecretField, value: string): Promise<void> {
    await this.scope.mutate([{ op: 'set', path: [field], value }])
  }

  dispose(): void {
    this.unsubscribeDescribe()
    this.form.dispose()
  }
}
