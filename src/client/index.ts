import { createPlugin } from './plugin.js'
import { installClientRuntime } from './runtime.js'
import { installStyles } from './styles.js'

window.__ModuleLoader__.load({
  id: 'dsh-cpa',
  factory(require) {
    installClientRuntime(require)
    installStyles()
    return createPlugin()
  },
})
