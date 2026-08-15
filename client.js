window.__ModuleLoader__.load({
  id: 'dsh-cpa',
  factory(require) {
    const React = require('react')
    const { useEffect, useState } = React

    const STATUS_URL = '/dsh-cpa/status'
    const PANEL_URL = '/dsh-cpa/management'

    function CpaSettingsSection() {
      const [available, setAvailable] = useState(null)
      useEffect(() => {
        let cancelled = false
        fetch(STATUS_URL, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
          .then(response => {
            if (!response.ok) return { available: false }
            return response.json().catch(() => ({ available: false }))
          })
          .then(state => {
            if (!cancelled) setAvailable(Boolean(state.available))
          })
          .catch(() => {
            if (!cancelled) setAvailable(false)
          })
        return () => { cancelled = true }
      }, [])

      if (available === null) {
        return React.createElement('div', {
          style: { padding: '20px', color: 'var(--dsh-text-secondary, #64748b)' },
        }, 'CPA')
      }
      if (!available) {
        return React.createElement('div', {
          style: { padding: '20px', color: 'var(--dsh-text-secondary, #64748b)' },
        }, 'CPA management is unavailable.')
      }
      return React.createElement('iframe', {
        src: PANEL_URL,
        title: 'CPA',
        style: {
          display: 'block',
          width: '100%',
          height: '70vh',
          minHeight: '520px',
          border: '0',
          background: '#fff',
        },
      })
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'cpa',
        order: 25,
        label: 'CPA',
      }, CpaSettingsSection))
    }

    return { name: 'dsh-cpa', inject: ['slots'], apply }
  },
})
