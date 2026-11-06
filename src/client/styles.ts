/** Styles shared by the status pill and the settings surfaces. */
export const STYLE_ID = 'dsh-cpa-client'

export const CLIENT_CSS = String.raw`
        [role="presentation"]:has(.dsh-cpa-management-dialog) {
          padding: 8px;
        }
        .dsh-cpa-management-dialog.dsh-cpa-management-dialog {
          box-sizing: border-box;
          width: calc(100vw - 16px);
          height: calc(100vh - 16px);
          height: calc(100dvh - 16px);
          max-height: calc(100vh - 16px);
          max-height: calc(100dvh - 16px);
          padding: 8px;
        }
        .dsh-cpa-management-content.dsh-cpa-management-content {
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          min-height: 0;
          height: 100%;
          max-height: calc(100vh - 16px);
          max-height: calc(100dvh - 16px);
          padding: 0;
        }
        .dsh-cpa-management-content > div:last-child {
          flex: 1 1 auto;
          min-height: 0;
          padding: 0;
          overflow: hidden;
        }
        .dsh-cpa-management-content iframe {
          display: block;
          width: 100%;
          height: 100%;
          flex: 1 1 auto;
          min-height: 0;
          border: 0;
          border-radius: 24px;
          background: var(--dsw-alias-bg-layer-1);
        }
        .dsh-cpa-dock {
          display: inline-flex;
          min-width: 0;
          max-width: 100%;
          font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
          line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
        }
        .dsh-cpa-pill {
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          max-width: 100%;
          padding: 1px 8px;
          border: 0;
          border-radius: var(--dsw-radius-sm, 6px);
          background: none;
          color: var(--dsw-alias-label-tertiary);
          font: inherit;
          font-variant-numeric: tabular-nums;
          line-height: inherit;
          white-space: nowrap;
          text-align: left;
          appearance: none;
        }
        button.dsh-cpa-pill {
          cursor: pointer;
        }
        .dsh-cpa-pill svg {
          display: block;
          flex: 0 0 auto;
          width: 14px;
          height: 14px;
        }
        .dsh-cpa-pill[aria-expanded="true"],
        .dsh-cpa-pill:focus-visible {
          background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
          color: var(--dsw-alias-label-secondary);
        }
        @media (hover: hover) {
          .dsh-cpa-pill:hover {
            background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
            color: var(--dsw-alias-label-secondary);
          }
        }
        .dsh-cpa-pill-warn,
        .dsh-cpa-pill-warn[aria-expanded="true"],
        .dsh-cpa-pill-warn:focus-visible {
          color: var(--dsw-alias-state-warn-primary);
        }
        @media (hover: hover) {
          .dsh-cpa-pill-warn:hover {
            color: var(--dsw-alias-state-warn-primary);
          }
        }
        .dsh-cpa-pill-error,
        .dsh-cpa-pill-error[aria-expanded="true"],
        .dsh-cpa-pill-error:focus-visible {
          color: var(--dsw-alias-state-error-primary);
        }
        @media (hover: hover) {
          .dsh-cpa-pill-error:hover {
            color: var(--dsw-alias-state-error-primary);
          }
        }
        .dsh-cpa-pill-label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dsh-cpa-pill-sep {
          flex: 0 0 auto;
          color: var(--dsw-alias-separator-primary, var(--dsw-alias-label-tertiary));
        }
        .dsh-cpa-pill-meta {
          flex: 0 0 auto;
        }
        .dsh-cpa-dialog {
          position: fixed;
          z-index: 1100;
          box-sizing: border-box;
          width: max-content;
          min-width: min(300px, calc(100vw - 24px));
          max-width: min(440px, calc(100vw - 24px), var(--dsh-anchored-max-width, 100vw));
          max-height: min(440px, calc(100vh - 24px));
          max-height: min(440px, calc(100vh - 24px), var(--dsh-anchored-max-height, 100vh));
          padding: 16px;
          overflow: hidden auto;
          border: 0;
          border-radius: var(--dsw-radius-lg, 12px);
          background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay));
          box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgb(0 0 0 / 18%));
          backdrop-filter: var(--dsw-menu-backdrop-filter, blur(12px));
          color: var(--dsw-alias-label-secondary);
          font-size: 12px;
          line-height: 18px;
          cursor: default;
          --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
          --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
          --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
        }
        .dsh-cpa-dialog-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 8px;
          color: var(--dsw-alias-label-primary);
          font-weight: 500;
        }
        .dsh-cpa-dialog-title-label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dsh-cpa-dialog-title-label svg {
          flex: 0 0 auto;
          width: 14px;
          height: 14px;
        }
        .dsh-cpa-dialog-title-value {
          flex: 0 0 auto;
          font-variant-numeric: tabular-nums;
        }
        .dsh-cpa-dialog-title-value-warn {
          color: var(--dsw-alias-state-warn-primary);
        }
        .dsh-cpa-dialog-title-value-error {
          color: var(--dsw-alias-state-error-primary);
        }
        .dsh-cpa-dialog-rule {
          margin-bottom: 10px;
          border-top: 0.5px solid var(--dsw-alias-border-l2);
        }
        .dsh-cpa-dialog-section + .dsh-cpa-dialog-section {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 0.5px solid var(--dsw-alias-border-l2);
        }
        .dsh-cpa-dialog-section-title {
          margin-bottom: 6px;
          color: var(--dsw-alias-label-tertiary);
          font-size: 12px;
          line-height: 18px;
        }
        .dsh-cpa-dialog-details {
          display: grid;
          grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
          gap: 6px 16px;
          margin: 0;
        }
        .dsh-cpa-dialog-details dt,
        .dsh-cpa-dialog-details dd {
          min-width: 0;
          margin: 0;
        }
        .dsh-cpa-dialog-details dt {
          color: var(--dsw-alias-label-tertiary);
          overflow-wrap: anywhere;
        }
        .dsh-cpa-dialog-details dd {
          color: var(--dsw-alias-label-secondary);
          font-variant-numeric: tabular-nums;
          text-align: right;
          overflow-wrap: anywhere;
        }
        .dsh-cpa-dialog-details dd.dsh-cpa-dialog-wide {
          text-align: left;
        }
        .dsh-cpa-dialog-details dd.dsh-cpa-dialog-warn {
          color: var(--dsw-alias-state-warn-primary);
        }
        .dsh-cpa-dialog-details dd.dsh-cpa-dialog-error {
          color: var(--dsw-alias-state-error-primary);
        }
        .dsh-cpa-dialog-details a {
          color: var(--dsw-alias-brand-primary);
          text-decoration: none;
        }
        .dsh-cpa-dialog-details a:hover {
          text-decoration: underline;
        }
        .dsh-cpa-dialog-request a {
          margin-left: 6px;
        }
        .dsh-cpa-summary {
          box-sizing: border-box;
          margin: 0 0 16px;
          padding-top: 12px;
          border-top: 1px solid var(--dsw-alias-border-l2);
        }
        .dsh-cpa-summary-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
        }
        .dsh-cpa-summary-title {
          font-size: 13px;
          font-weight: 600;
          line-height: 20px;
          color: var(--dsw-alias-label-primary);
        }
        .dsh-cpa-summary-status {
          margin-top: 4px;
          font-size: 12px;
          line-height: 20px;
          color: var(--dsw-alias-label-tertiary);
        }
        .dsh-cpa-summary-status-warning {
          color: var(--dsw-alias-state-error-primary);
        }
        .dsh-cpa-summary-block {
          margin-top: 10px;
        }
        .dsh-cpa-summary-block-title {
          margin-bottom: 4px;
          font-size: 12px;
          line-height: 18px;
          color: var(--dsw-alias-label-tertiary);
        }
        .dsh-cpa-summary-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 14px;
        }
        .dsh-cpa-summary-item {
          display: inline-flex;
          gap: 4px;
          min-width: 0;
          font-size: 12px;
          line-height: 20px;
          color: var(--dsw-alias-label-secondary);
        }
        .dsh-cpa-summary-key {
          flex: 0 0 auto;
          color: var(--dsw-alias-label-tertiary);
        }
        .dsh-cpa-summary-value {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .dsh-cpa-summary-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .dsh-cpa-summary-list-row {
          display: flex;
          flex-wrap: wrap;
          gap: 2px 12px;
          min-width: 0;
          font-size: 12px;
          line-height: 20px;
          color: var(--dsw-alias-label-secondary);
        }
        .dsh-cpa-summary-list-main {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dsh-cpa-summary-list-warning {
          color: var(--dsw-alias-state-error-primary);
        }
      `

/** Install or refresh the plugin stylesheet. */
export function installStyles(): void {
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_ID}"]`)
  const style = existing ?? document.createElement('style')
  style.dataset.pluginCss = STYLE_ID
  style.textContent = CLIENT_CSS
  if (existing === null) document.head.appendChild(style)
}
