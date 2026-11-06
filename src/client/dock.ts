import type * as React from 'react'
import type { CpaAccountPublic, ExecutionRecord } from './wire.js'
import { fetchExecutionStatus, READOUT_REFRESH_MS } from './api.js'
import type { ExecutionStatusResponse } from './api.js'
import { activeSelection, detailGroups, readoutPresentation } from './readout.js'
import type { DetailGroup, SessionModelSelection } from './readout.js'
import { clientRuntime } from './runtime.js'

const DIALOG_GAP = 8
const DIALOG_MARGIN = 12
const DIALOG_MEASURE: React.CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

export interface CpaDockProps {
  sessionId?: string
  useProjection: <T>(key: string) => T | undefined
}

function shouldShowReadout(
  readout: ExecutionStatusResponse | null,
  execution: ExecutionRecord | null | undefined,
  selection: SessionModelSelection | undefined,
): boolean {
  if (readout === null) return false
  const chosen = activeSelection(selection)
  if (readout.route !== undefined && chosen !== undefined && chosen.provider !== readout.route) {
    return false
  }
  if (execution !== null && execution !== undefined) return true
  return readout.accounts.length > 0
}

interface ReadoutDialogState {
  anchorRef: React.RefObject<HTMLSpanElement | null>
  open: boolean
  panelRef: React.RefObject<HTMLDivElement | null>
  position: React.CSSProperties | undefined
  setOpen: (open: boolean) => void
}

function useReadoutDialog(): ReadoutDialogState {
  const { React, primitives } = clientRuntime()
  const [open, setOpen] = React.useState(false)
  const anchorRef = React.useRef<HTMLSpanElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const position = primitives.useAnchoredPosition({
    open,
    anchorRef,
    panelRef,
    side: 'top',
    gap: DIALOG_GAP,
    margin: DIALOG_MARGIN,
  })
  primitives.useDismissOnOutsidePointer(anchorRef, open, setOpen, panelRef)
  React.useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])
  return { anchorRef, open, panelRef, position, setOpen }
}

function DetailSection({ group, showTitle }: { group: DetailGroup; showTitle: boolean }): React.ReactElement {
  const { React } = clientRuntime()
  return React.createElement('section', { className: 'dsh-cpa-dialog-section' },
    showTitle
      ? React.createElement('div', { className: 'dsh-cpa-dialog-section-title' }, group.title)
      : null,
    React.createElement('dl', { className: 'dsh-cpa-dialog-details' },
      group.rows.map((row, index) => React.createElement(React.Fragment, {
        key: `${group.title}-${row.label}-${index}`,
      },
        React.createElement('dt', null, row.label),
        React.createElement('dd', {
          className: [
            row.wide ? 'dsh-cpa-dialog-wide' : '',
            row.tone === 'error' ? 'dsh-cpa-dialog-error' : row.tone === 'warn' ? 'dsh-cpa-dialog-warn' : '',
          ].filter(Boolean).join(' ') || undefined,
        }, row.value),
      )),
    ),
  )
}

export function CpaDock(props: CpaDockProps): React.ReactElement | null {
  const { React, primitives, ReactDOM } = clientRuntime()
  const projection = props.useProjection<ExecutionRecord | null>('cpaUsage')
  const selection = props.useProjection<SessionModelSelection>('modelSelection')
  const [readout, setReadout] = React.useState<ExecutionStatusResponse | null>(null)
  const { anchorRef, open, panelRef, position, setOpen } = useReadoutDialog()

  React.useEffect(() => {
    setReadout(null)
    setOpen(false)
    if (props.sessionId === undefined || props.sessionId === '') return undefined
    let cancelled = false
    async function refresh(): Promise<void> {
      try {
        const body = await fetchExecutionStatus(props.sessionId ?? '')
        if (!cancelled) setReadout(body)
      } catch {
        // The readout is best-effort; keep the last successful snapshot.
      }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, READOUT_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [props.sessionId, setOpen])

  const execution = projection ?? readout?.execution
  const accounts: readonly CpaAccountPublic[] = readout?.accounts ?? []
  const visible = shouldShowReadout(readout, execution, selection)
  const presentation = visible ? readoutPresentation(accounts, readout?.quota, execution, selection) : null
  // An older Host omits `route`. Without an execution, only a model that resolved
  // to a CPA account proves the session is on CPA.
  const shown = presentation !== null
    && presentation.primary !== ''
    && (execution !== null && execution !== undefined
      || readout?.route !== undefined
      || presentation.account !== undefined)
  const groups = presentation !== null && shown
    ? detailGroups(accounts, readout?.quota, execution, readout?.executions, selection)
    : []

  React.useEffect(() => {
    if (!shown || groups.length === 0) setOpen(false)
  }, [shown, groups.length, setOpen])

  if (presentation === null || !shown) return null
  const titleToneClass = presentation.tone === 'error'
    ? 'dsh-cpa-dialog-title-value-error'
    : presentation.tone === 'warn' ? 'dsh-cpa-dialog-title-value-warn' : ''
  const ApiIcon = primitives.IconApiOutlineRegular
    ?? primitives.IconApiOutlineMedium
    ?? (() => null)
  const ReadingIcon = presentation.mode === 'quota'
    ? primitives.IconGaugeOutlineRegular ?? ApiIcon
    : ApiIcon
  const pillClassName = [
    'dsh-cpa-pill',
    presentation.tone === 'error' ? 'dsh-cpa-pill-error' : '',
    presentation.tone === 'warn' ? 'dsh-cpa-pill-warn' : '',
  ].filter(Boolean).join(' ')
  const pillChildren = [
    React.createElement(ReadingIcon, { size: 14, key: 'icon' }),
    React.createElement('span', { className: 'dsh-cpa-pill-label', key: 'label' }, presentation.primary),
    presentation.secondary === '' ? null : React.createElement(React.Fragment, { key: 'meta' },
      React.createElement('span', { className: 'dsh-cpa-pill-sep', 'aria-hidden': true }, '·'),
      React.createElement('span', { className: 'dsh-cpa-pill-meta' }, presentation.secondary),
    ),
  ].filter(Boolean)
  const openable = groups.length > 0
  const pill = openable
    ? React.createElement('button', {
      type: 'button',
      className: pillClassName,
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      'aria-label': presentation.full,
      onClick: () => setOpen(!open),
    }, ...pillChildren)
    : React.createElement('span', {
      className: pillClassName,
      'aria-label': presentation.full,
    }, ...pillChildren)
  const trigger = React.createElement(primitives.Tooltip, {
    label: presentation.full,
    side: 'top',
    portal: true,
    delayMs: 200,
    onlyWhenClipped: true,
    disabled: open,
  }, pill)
  const dialog = open && groups.length > 0 ? ReactDOM.createPortal(
    React.createElement('div', {
      ref: panelRef,
      className: 'dsh-cpa-dialog',
      role: 'dialog',
      'aria-label': 'CPA 状态',
      style: position ?? DIALOG_MEASURE,
    },
      React.createElement('div', { className: 'dsh-cpa-dialog-title' },
        React.createElement('span', { className: 'dsh-cpa-dialog-title-label' },
          React.createElement(ReadingIcon, { size: 14 }),
          'CPA 状态',
        ),
        presentation.headline === '' ? null : React.createElement('span', {
          className: ['dsh-cpa-dialog-title-value', titleToneClass].filter(Boolean).join(' '),
        }, presentation.headline),
      ),
      React.createElement('div', { className: 'dsh-cpa-dialog-rule', 'aria-hidden': true }),
      groups.map((group, index) => React.createElement(DetailSection, {
        key: `${group.title}-${index}`,
        group,
        showTitle: groups.length > 1,
      })),
    ),
    document.body,
  ) : null
  return React.createElement('span', { ref: anchorRef, className: 'dsh-cpa-dock' }, trigger, dialog)
}
