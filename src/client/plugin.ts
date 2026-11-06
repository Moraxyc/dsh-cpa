import type { ClientContext } from './context.js'
import { CpaDock } from './dock.js'
import type { ClientPlugin } from './runtime.js'
import { CpaSettingsFormController } from './settings/form.js'
import { CpaPluginItem } from './settings/panel.js'

export function createPlugin(): ClientPlugin {
  function apply(ctx: ClientContext): void {
    const scope = ctx.configForms.get('dsh-cpa')
    const describe = ctx.configForms.describe()
    const form = new CpaSettingsFormController(scope, describe)
    ctx.effect(() => async () => { form.dispose() }, 'dsh-cpa: settings form')
    ctx.effect(() => ctx.configForms.whileServed(['dsh-cpa'], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item',
      id: 'cpa',
      order: 25,
      label: 'CPA',
      inject: () => form.inject(),
    }, CpaPluginItem))), 'dsh-cpa: plugin settings page')
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
      name: 'conversation.composer.dock',
      id: 'cpa',
      order: 2,
    }, CpaDock))
  }

  return {
    name: 'dsh-cpa',
    inject: ['slots', 'configForms'],
    apply,
  }
}
