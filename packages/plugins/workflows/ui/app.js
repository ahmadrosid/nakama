// ui/style.css
var style_default = `[data-plugin-id="workflows"] {
  &:has(> .workflows-page) {
    display: flex;
    flex-direction: column;
    padding: 0;
    container-type: inline-size;
    overflow: hidden;
  }

  .workflows-page {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--foreground);
  }
  .workflow-layout {
    display: grid;
    flex: 1;
    grid-template-columns: 240px minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
  }
  .workflow-sidebar {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    border-right: 1px solid var(--border);
  }
  .workflow-sidebar ul,
  .workflow-steps {
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .workflow-sidebar ul {
    border-bottom: 1px solid var(--muted);
  }
  .workflow-sidebar li + li {
    border-top: 1px solid var(--muted);
  }
  .workflow-list-row {
    position: relative;
  }
  .workflow-list-delete {
    position: absolute;
    top: 8px;
    right: 8px;
    color: var(--destructive);
    opacity: 0;
  }
  .workflow-list-row:hover .workflow-list-delete,
  .workflow-list-delete:focus-visible {
    opacity: 1;
  }
  .workflow-list-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
    width: 100%;
    height: auto;
    padding: 12px;
    text-align: left;
    white-space: normal;
    border-radius: 0;
    transition: none;
  }
  .workflow-list-item:active {
    transform: none;
  }
  .workflow-list-item:hover,
  .workflow-list-item:focus-visible {
    background: color-mix(in srgb, var(--muted) 25%, transparent);
  }
  .workflow-list-item[aria-current="true"] {
    background: var(--muted);
  }
  .workflow-list-name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 14px;
    font-weight: 500;
    color: var(--foreground);
    white-space: nowrap;
  }
  .workflow-list-meta {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    font-weight: 400;
    color: var(--muted-foreground);
    white-space: nowrap;
  }
  .workflow-list-state {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 11px;
    font-weight: 400;
    color: var(--muted-foreground);
  }
  .workflow-status-dot {
    width: 8px;
    height: 8px;
    background: color-mix(in srgb, var(--muted-foreground) 50%, transparent);
    border-radius: 50%;
  }
  .workflow-status-dot[data-enabled="true"] {
    background: #10b981;
  }
  .workflow-editor,
  .workflow-editor form,
  .editor-fields {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .editor-fields {
    padding: 0;
    margin: 0;
    border: 0;
  }
  .editor-toolbar {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    min-height: 54px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .editor-toolbar p {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
    white-space: nowrap;
  }
  .workflow-actions,
  .workflow-add-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .workflow-scroll {
    flex: 1;
    min-height: 0;
    padding: 24px 20px;
    overflow-y: auto;
  }
  .workflow-content {
    width: 100%;
    max-width: 576px;
    margin-inline: auto;
  }
  .workflow-name {
    flex: 1;
    min-width: 0;
    font-weight: 500;
  }
  .workflow-name,
  .workflow-description {
    border-color: transparent;
    box-shadow: none;
  }
  .workflow-description {
    margin-top: 4px;
    color: var(--muted-foreground);
  }
  .workflow-enabled {
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;
  }
  .workflow-step-card {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-right: 12px;
    border: 1px solid var(--border);
    border-radius: 16px;
  }
  .workflow-step-card[data-selected="true"] {
    border-color: var(--ring);
  }
  .workflow-step-open {
    flex: 1;
    gap: 12px;
    justify-content: flex-start;
    min-width: 0;
    height: auto;
    min-height: 44px;
    padding: 10px 12px;
    text-align: left;
    overflow-wrap: anywhere;
    white-space: normal;
    border-radius: 16px;
  }
  .workflow-connector {
    width: 1px;
    height: 20px;
    margin-inline: auto;
    background: var(--border);
  }
  .workflow-add-actions {
    justify-content: center;
    margin-top: 16px;
  }
  .workflow-empty {
    color: var(--muted-foreground);
  }
  .workflow-error {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    padding: 12px 14px;
    margin: 16px 16px 0;
    color: var(--destructive);
    background: color-mix(in srgb, var(--destructive) 6%, var(--background));
    border: 1px solid color-mix(in srgb, var(--destructive) 25%, transparent);
    border-radius: 6px;
  }
  .workflow-error > svg {
    flex-shrink: 0;
  }
  .workflow-error p {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .workflow-error a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  @container (max-width: 760px) {
    .workflow-layout {
      grid-template-rows: auto minmax(0, 1fr);
      grid-template-columns: minmax(0, 1fr);
    }
    .workflow-sidebar {
      max-height: 180px;
      overflow-y: auto;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
    .editor-toolbar {
      flex-wrap: wrap;
    }
    .workflow-scroll {
      padding: 20px 12px;
    }
  }
}

[data-plugin-id="workflows"] {
  .workflow-editor {
    position: relative;
  }
  .workflow-step-drawer {
    position: absolute;
    inset: 0 0 0 auto;
    z-index: 20;
    display: flex;
    flex-direction: column;
    width: min(420px, 100%);
    min-height: 0;
    outline: none;
    background: var(--background);
    border-left: 1px solid var(--border);
    box-shadow: -12px 0 32px #00000020;
  }
  .workflow-step-drawer[data-expanded="true"] {
    width: 100%;
    border-left: 0;
    box-shadow: none;
  }
  .workflow-drawer-header {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }
  .workflow-drawer-title {
    flex: 1;
    min-width: 0;
  }
  .workflow-drawer-title h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .workflow-drawer-title p {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .workflow-view-nav,
  .workflow-drawer-tabs {
    display: flex;
    gap: 16px;
    padding-inline: 16px;
    border-bottom: 1px solid var(--border);
  }
  .workflow-view-nav [data-slot="button"],
  .workflow-drawer-tabs [data-slot="button"] {
    height: 42px;
    padding-inline: 0;
    color: var(--muted-foreground);
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
  }
  .workflow-view-nav [data-slot="button"] {
    background: transparent;
  }
  .workflow-view-nav [aria-pressed="true"],
  .workflow-drawer-tabs [aria-pressed="true"] {
    color: var(--foreground);
    border-bottom-color: var(--foreground);
  }
  .workflow-drawer-body {
    flex: 1;
    min-height: 0;
    padding: 16px;
    overflow-y: auto;
  }
  .workflow-step-fields {
    display: grid;
    gap: 20px;
  }
  .workflow-step-fields label {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .workflow-step-fields [data-slot="select-trigger"] {
    width: 100%;
  }
  .workflow-step-fields textarea,
  .workflow-step-fields pre,
  .workflow-drawer-body pre {
    font-family: monospace;
    font-size: 13px;
  }
  .workflow-step-fields pre,
  .workflow-drawer-body pre {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
}

[data-plugin-id="workflows"] {
  .workflow-layout[data-empty="true"] {
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
  }
  .workflow-welcome {
    display: flex;
    flex-direction: column;
    gap: 20px;
    align-items: center;
    justify-content: center;
    min-width: 0;
    padding: 48px 24px;
    text-align: center;
  }
  .workflow-welcome-icon {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    color: var(--muted-foreground);
    background: color-mix(in srgb, var(--muted) 40%, transparent);
    border: 1px solid var(--border);
    border-radius: 18px;
  }
  .workflow-welcome-icon svg {
    width: 28px;
    height: 28px;
  }
  .workflow-welcome h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 500;
    letter-spacing: -0.02em;
  }
}

[data-plugin-id="workflows"] {
  .workflow-chat-card {
    min-width: 0;
    max-width: 100%;
    padding: 12px 16px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .workflow-chat-card header {
    display: flex;
    gap: 12px;
    align-items: baseline;
  }
  .workflow-chat-card header {
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .workflow-chat-card h3,
  .workflow-chat-card p {
    margin: 0;
    font-size: 14px;
  }
  .workflow-chat-card h3 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
    white-space: nowrap;
  }
  .workflow-chat-card header > span {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .workflow-chat-card > [role="alert"] {
    margin-bottom: 16px;
    overflow-wrap: anywhere;
  }
  .workflow-chat-card ol {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .workflow-chat-card li {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) minmax(0, 28%);
    gap: 10px;
    align-items: baseline;
    min-width: 0;
  }
  .workflow-chat-card li > div {
    min-width: 0;
  }
  .workflow-chat-card li p,
  .workflow-chat-result {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .workflow-chat-card header > span,
  .workflow-chat-card .workflow-chat-detail,
  .workflow-chat-result {
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .workflow-chat-result {
    min-width: 0;
    text-align: right;
  }
  .workflow-chat-card [data-status="completed"] .workflow-chat-mark {
    color: #10b981;
  }
  .workflow-chat-card [data-status="failed"],
  .workflow-chat-card [role="alert"] {
    color: var(--destructive);
  }
}

[data-plugin-id="workflows"] {
  .workflow-add-actions > svg {
    color: var(--muted-foreground);
  }
  .workflow-view-nav [data-slot="button"] {
    gap: 6px;
  }
  .workflow-tab-badge {
    min-width: 18px;
    padding: 0 5px;
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    color: #fff;
    background: var(--destructive);
    border-radius: 999px;
  }
  .workflow-step-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .workflow-step-kind {
    font-size: 12px;
    font-weight: 400;
    color: var(--muted-foreground);
  }
  .workflow-step-name {
    font-weight: 500;
  }
  .workflow-step-last {
    display: flex;
    flex-shrink: 0;
    flex-direction: column;
    gap: 6px;
    align-items: flex-end;
    width: 112px;
    font-size: 12px;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .workflow-step-last[data-status="completed"] {
    color: #15803d;
  }
  .workflow-step-last[data-status="failed"] {
    color: var(--destructive);
  }
  .workflow-bar {
    position: relative;
    width: 100%;
    height: 6px;
    background: var(--muted);
    border-radius: 3px;
  }
  .workflow-bar > span {
    position: absolute;
    inset-block: 0;
    background: color-mix(in srgb, var(--muted-foreground) 60%, transparent);
    border-radius: 3px;
  }
  [data-status="completed"] > .workflow-bar > span {
    background: #4ade80;
  }
  [data-status="failed"] .workflow-bar > span {
    background: var(--destructive);
  }
  .workflow-run-mark {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    background: var(--muted-foreground);
    border-radius: 50%;
  }
  .workflow-run-mark[data-status="completed"] {
    background: #10b981;
  }
  .workflow-run-mark[data-status="failed"] {
    background: var(--destructive);
  }
  .workflow-run-mark[data-status="running"] {
    background: #3b82f6;
  }
  .workflow-history {
    display: grid;
    flex: 1;
    grid-template-columns: 220px minmax(0, 1fr);
    min-height: 0;
  }
  .workflow-history-list {
    padding: 12px 8px;
    overflow-y: auto;
    border-right: 1px solid var(--border);
  }
  .workflow-history-list h3 {
    margin: 8px 8px 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted-foreground);
  }
  .workflow-history-item {
    gap: 10px;
    justify-content: flex-start;
    width: 100%;
  }
  .workflow-history-item[aria-current="true"] {
    background: var(--muted);
  }
  .workflow-history-detail {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
    max-width: 760px;
    padding: 24px 20px;
    margin-inline: auto;
    overflow-y: auto;
  }
  .workflow-history-detail header {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
  }
  .workflow-history-detail h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .workflow-history-detail header p {
    margin: 2px 0 0;
    font-size: 13px;
  }
  .workflow-history-error {
    display: flex;
    gap: 10px;
    padding: 14px;
    color: var(--destructive);
    background: color-mix(in srgb, var(--destructive) 6%, var(--background));
    border: 1px solid color-mix(in srgb, var(--destructive) 25%, transparent);
    border-radius: 12px;
  }
  .workflow-history-error p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .workflow-history-error p:first-child {
    font-weight: 600;
  }
  .workflow-trace-box {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .workflow-trace-head,
  .workflow-trace > li > details > summary {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) minmax(80px, 200px) 56px;
    gap: 14px;
    align-items: center;
    padding: 12px 16px;
  }
  .workflow-trace-head {
    padding-block: 8px;
    font-size: 12px;
    color: var(--muted-foreground);
    background: color-mix(in srgb, var(--muted) 40%, transparent);
    border-bottom: 1px solid var(--border);
  }
  .workflow-trace-head > :last-child {
    text-align: right;
  }
  .workflow-trace {
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .workflow-trace li + li {
    border-top: 1px solid var(--border);
  }
  .workflow-trace li[data-status="failed"] {
    background: color-mix(in srgb, var(--destructive) 4%, var(--background));
  }
  .workflow-trace li[data-status="skipped"] > details > summary {
    opacity: 0.6;
  }
  .workflow-trace > li > details > summary {
    cursor: pointer;
    list-style: none;
  }
  .workflow-trace > li > details > summary::-webkit-details-marker {
    display: none;
  }
  .workflow-trace-name {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-weight: 500;
  }
  .workflow-trace-name .workflow-empty {
    font-size: 12px;
    font-weight: 400;
  }
  .workflow-trace-time {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--muted-foreground);
    text-align: right;
  }
  .workflow-trace-body {
    display: grid;
    gap: 12px;
    padding: 0 16px 16px 54px;
  }
  .workflow-receipt {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }
  .workflow-receipt h4,
  .workflow-history-result h4 {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
  }
  .workflow-receipt dl {
    padding: 2px 12px;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .workflow-receipt dl > div {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    padding: 6px 0;
  }
  .workflow-receipt dl > div + div {
    border-top: 1px solid var(--muted);
  }
  .workflow-receipt dt {
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  .workflow-receipt dd {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
    white-space: nowrap;
  }
  .workflow-technical summary {
    font-size: 12px;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .workflow-technical pre {
    max-height: 320px;
    overflow: auto;
    font-family: monospace;
    font-size: 12px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .workflow-history-result p {
    padding: 12px 14px;
    margin: 0;
    white-space: pre-wrap;
    background: color-mix(in srgb, var(--muted) 40%, transparent);
    border-radius: 10px;
  }
  @container (max-width: 760px) {
    .workflow-history {
      grid-template-columns: minmax(0, 1fr);
    }
    .workflow-history-list {
      max-height: 180px;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
    .workflow-step-last {
      display: none;
    }
  }
}

[data-plugin-id="workflows"] {
  .editor-toolbar {
    flex-wrap: wrap;
  }
  .workflow-title-row {
    display: flex;
    flex: 1;
    gap: 12px;
    align-items: center;
    min-width: 0;
  }
  .workflow-title-row .workflow-name {
    max-width: 420px;
    padding-inline: 6px;
    font-size: 18px;
    font-weight: 600;
  }
  .workflow-actions [data-slot="select-trigger"] {
    max-width: 176px;
  }
  textarea.workflow-description {
    min-height: 0;
    margin: 0 0 24px;
    resize: none;
    field-sizing: content;
  }
  .workflow-step-card {
    border-radius: 14px;
  }
  .workflow-step-card[data-selected="true"] {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 15%, transparent);
  }
  .workflow-step-open {
    gap: 14px;
    padding: 12px 14px;
    border-radius: 14px;
  }
  .workflow-step-name {
    font-size: 15px;
  }
  .workflow-app-badge {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 32px;
    height: 32px;
    font-size: 13px;
    font-weight: 600;
    border-radius: 9px;
  }
  .workflow-app-badge[data-tint="0"] {
    color: #1d4ed8;
    background: #eff6ff;
  }
  .workflow-app-badge[data-tint="1"] {
    color: #6d28d9;
    background: #f5f3ff;
  }
  .workflow-app-badge[data-tint="2"] {
    color: #c2410c;
    background: #fff7ed;
  }
  .workflow-app-badge[data-tint="3"] {
    color: #15803d;
    background: #f0fdf4;
  }
  .workflow-app-badge[data-tint="4"] {
    color: #be185d;
    background: #fdf2f8;
  }
  .workflow-connector {
    position: relative;
    height: 28px;
  }
  .workflow-connector::after {
    position: absolute;
    bottom: 4px;
    left: -3px;
    width: 6px;
    height: 6px;
    content: "";
    border-right: 1.5px solid var(--muted-foreground);
    border-bottom: 1.5px solid var(--muted-foreground);
    transform: rotate(45deg);
  }
  .workflow-run-badge {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 24px;
    height: 24px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted-foreground);
    background: var(--muted);
    border-radius: 50%;
  }
  .workflow-run-badge[data-status="completed"] {
    color: #15803d;
    background: #f0fdf4;
  }
  .workflow-run-badge[data-status="failed"] {
    color: var(--destructive);
    background: color-mix(in srgb, var(--destructive) 10%, var(--background));
  }
  .workflow-history-item {
    height: auto;
    padding-block: 8px;
  }
  .workflow-history-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    line-height: 1.3;
  }
  .workflow-history-text > :first-child {
    font-weight: 500;
  }
  .workflow-history-text > :last-child {
    font-size: 12px;
    font-weight: 400;
  }
  .workflow-run-chip {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 10px;
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--muted-foreground);
    background: var(--muted);
    border-radius: 999px;
  }
  .workflow-run-chip[data-status="completed"] {
    color: #15803d;
    background: #f0fdf4;
  }
  .workflow-run-chip[data-status="failed"] {
    color: var(--destructive);
    background: color-mix(in srgb, var(--destructive) 10%, var(--background));
  }
}

[data-plugin-id="workflows"] {
  .workflow-drawer-header .workflow-drawer-title h2 {
    font-size: 15px;
    font-weight: 600;
  }
  .workflow-action-picker {
    background: transparent;
  }
  .workflow-action-picker [cmdk-list] {
    max-height: none;
  }
  .workflow-picker-heading {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .workflow-picker-heading .workflow-app-badge {
    width: 22px;
    height: 22px;
    font-size: 11px;
    border-radius: 6px;
  }
  .workflow-picker-item {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .workflow-picker-item > :first-child {
    font-weight: 500;
  }
  .workflow-picker-item > .workflow-empty {
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    white-space: nowrap;
  }
  .workflow-field {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .workflow-field-label {
    font-weight: 500;
  }
  .workflow-field-hint {
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .workflow-required {
    margin-left: 4px;
    color: var(--destructive);
  }
  .workflow-action-button {
    gap: 10px;
    justify-content: flex-start;
    width: 100%;
    height: auto;
    min-height: 42px;
  }
  .workflow-action-button .workflow-app-badge {
    width: 22px;
    height: 22px;
    font-size: 11px;
    border-radius: 6px;
  }
  .workflow-action-button > .workflow-empty {
    margin-left: auto;
    font-weight: 400;
  }
  .workflow-value-field {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .workflow-value-field > [data-slot="input"] {
    flex: 1;
    min-width: 0;
  }
  .workflow-value-chip {
    display: inline-flex;
    flex: 1;
    gap: 6px;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
    min-height: 36px;
    padding: 0 6px 0 12px;
    font-size: 13px;
    font-weight: 500;
    color: #1d4ed8;
    background: #eff6ff;
    border-radius: 999px;
  }
  .workflow-value-chip > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .workflow-value-chip button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    color: inherit;
    cursor: pointer;
    background: transparent;
    border: 0;
    border-radius: 50%;
  }
  .workflow-technical textarea {
    margin-top: 8px;
  }
}

[data-plugin-id="workflows"] {
  .workflow-try {
    display: grid;
    gap: 12px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }
  .workflow-try > [data-slot="button"] {
    justify-self: start;
  }
  .workflow-try-status {
    margin: 0;
    font-weight: 500;
  }
  .workflow-try-status[data-status="completed"] {
    color: #15803d;
  }
  .workflow-try-status[data-status="failed"] {
    color: var(--destructive);
  }
  .workflow-try-heading {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted-foreground);
  }

  .workflow-data-page {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .workflow-data-message {
    padding: 24px 20px;
  }
  .workflow-data {
    position: relative;
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    min-width: 0;
    min-height: 0;
    container-type: inline-size;
  }
  .workflow-data-tables {
    display: flex;
    flex: 1 1 220px;
    flex-direction: column;
    gap: 2px;
    max-width: 260px;
    padding: 16px 12px;
    overflow-y: auto;
    background: color-mix(in srgb, var(--muted) 40%, var(--background));
    border-right: 1px solid var(--border);
  }
  .workflow-data-tables > p {
    margin: 0 8px 8px;
    font-size: 12px;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .workflow-data-tables [data-slot="button"] {
    gap: 10px;
    justify-content: flex-start;
    height: auto;
    min-height: 40px;
    padding: 0 10px;
    color: var(--foreground);
  }
  .workflow-data-tables [aria-current="true"] {
    background: var(--muted);
  }
  .workflow-data-tables svg {
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  .workflow-data-table-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: monospace;
    font-size: 13px;
    text-align: left;
  }
  .workflow-data-count {
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .workflow-data-main {
    display: flex;
    flex: 999 1 480px;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    min-height: 0;
    padding: 20px 24px;
    overflow-y: auto;
  }
  .workflow-data-head {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    align-items: center;
  }
  .workflow-data-head h2 {
    margin: 0;
    font-family: monospace;
    font-size: 16px;
    font-weight: 600;
  }
  .workflow-data-head > .workflow-empty {
    font-size: 13px;
  }
  .workflow-data-views {
    display: flex;
    gap: 4px;
    padding: 3px;
    margin-left: auto;
    background: var(--muted);
    border-radius: 10px;
  }
  .workflow-data-views [data-slot="button"] {
    color: var(--muted-foreground);
    border-radius: 7px;
  }
  .workflow-data-views [aria-selected="true"] {
    color: var(--foreground);
    background: var(--background);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 10%, transparent);
  }
  .workflow-data-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .workflow-data-toolbar [data-slot="input"] {
    flex: 0 1 280px;
    margin-right: auto;
  }
  .workflow-data-body {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: 16px;
    align-items: flex-start;
    min-height: 0;
  }
  .workflow-data-grid {
    display: flex;
    flex: 999 1 420px;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .workflow-data-scroll {
    max-height: 560px;
    overflow: auto;
  }
  .workflow-data-grid table {
    width: 100%;
    border-collapse: collapse;
  }
  .workflow-data-grid th {
    position: sticky;
    top: 0;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    white-space: nowrap;
    background: color-mix(in srgb, var(--muted) 40%, var(--background));
    border-bottom: 1px solid var(--border);
  }
  .workflow-data-grid th > span {
    display: block;
    font-family: monospace;
    font-size: 11px;
    font-weight: 400;
    color: var(--muted-foreground);
  }
  .workflow-data-grid td {
    max-width: 320px;
    height: 40px;
    padding: 0 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  .workflow-data-grid td > button {
    max-width: 100%;
    padding: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font: inherit;
    color: inherit;
    cursor: pointer;
    background: none;
    border: 0;
  }
  .workflow-data-grid tbody tr {
    cursor: pointer;
  }
  .workflow-data-grid tbody tr:hover {
    background: color-mix(in srgb, var(--muted) 50%, transparent);
  }
  .workflow-data-grid tbody tr[aria-selected="true"] {
    background: color-mix(in srgb, var(--primary) 12%, var(--background));
  }
  .workflow-data-grid [data-type="number"],
  .workflow-data-grid [data-type="datetime"],
  .workflow-data-grid [data-type="key"],
  .workflow-data-row [data-type="number"],
  .workflow-data-row [data-type="datetime"] {
    font-family: monospace;
    font-size: 13px;
  }
  .workflow-data-grid [data-type="muted"] {
    color: var(--muted-foreground);
  }
  .workflow-data-type {
    padding: 2px 8px;
    font-size: 12px;
    background: var(--muted);
    border-radius: 6px;
  }
  .workflow-data-empty {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
    padding: 56px 24px;
    text-align: center;
  }
  .workflow-data-empty > svg {
    width: 36px;
    height: 36px;
    color: var(--primary);
  }
  .workflow-data-empty h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }
  .workflow-data-empty p {
    max-width: 420px;
    margin: 0;
    color: var(--muted-foreground);
  }
  .workflow-data-row {
    display: flex;
    flex: 1 1 280px;
    flex-direction: column;
    gap: 8px;
    max-width: 360px;
    max-height: 640px;
    padding: 16px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .workflow-data-row header {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .workflow-data-row h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .workflow-data-row header > span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: monospace;
    font-size: 12px;
    color: var(--muted-foreground);
    white-space: nowrap;
  }
  .workflow-data-row dl {
    margin: 0;
  }
  .workflow-data-row dl > div {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  .workflow-data-row dt {
    display: flex;
    gap: 8px;
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .workflow-data-row dt > span:first-child {
    font-family: monospace;
  }
  .workflow-data-row dt > span:last-child {
    margin-left: auto;
    font-size: 11px;
  }
  .workflow-data-row dd {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .workflow-data-row a {
    color: var(--primary);
    text-decoration: underline;
  }
  .workflow-data-writer {
    padding-top: 8px;
    margin: 0;
    font-size: 13px;
    color: var(--muted-foreground);
  }
  .workflow-data-json {
    max-height: 600px;
    padding: 16px;
    margin: 0;
    overflow: auto;
    font-size: 13px;
    line-height: 1.6;
    background: color-mix(in srgb, var(--muted) 40%, var(--background));
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  @container (max-width: 760px) {
    .workflow-data-tables {
      max-width: none;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
    .workflow-data-row {
      max-width: none;
    }
  }
  @container (max-width: 1100px) {
    .workflow-data-row {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 2;
      width: min(360px, 100%);
      max-width: none;
      max-height: none;
      background: var(--background);
      border-width: 0 0 0 1px;
      border-radius: 0;
      box-shadow: -8px 0 24px
        color-mix(in srgb, var(--foreground) 8%, transparent);
    }
  }
  .workflow-data-main > .workflow-data-grid {
    flex: none;
  }
  .workflow-data-row dd[data-empty] {
    color: var(--muted-foreground);
  }
}
`;

// src/workflow-ops.ts
function parseWorkflowValue(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Workflow values must be JSON serializable.");
  }
  const parsed = JSON.parse(serialized);
  return parsed;
}

// src/ui.tsx
var inject = ["slots", "host", "styles", "ui"];
var stepFields = {
  assert: ["path", "expected"],
  compare: ["left", "op", "right", "tolerance"],
  template: ["template"],
  tool: ["tool", "input"]
};
function parseValue(value) {
  try {
    return parseWorkflowValue(JSON.parse(value));
  } catch {
    return value;
  }
}
function readWorkflowString(value) {
  return value === String(value) ? value : null;
}
function isWorkflowRecord(value) {
  return value instanceof Object && !Array.isArray(value);
}
function draftStep(step) {
  return {
    fields: Object.fromEntries(Object.entries(step).filter(([key]) => key !== "id" && key !== "kind").map(([key, value]) => [
      key,
      value === String(value) && !["left", "right", "expected", "tolerance"].includes(key) ? value : JSON.stringify(value, null, 2)
    ])),
    id: step.id,
    key: crypto.randomUUID(),
    kind: step.kind
  };
}
function serializeSteps(steps) {
  return steps.map(({ id, kind, fields }) => ({
    id,
    kind,
    ...Object.fromEntries((stepFields[kind] ?? []).filter((key) => key !== "tolerance" || fields[key]).map((key) => [
      key,
      key === "input" ? JSON.parse(fields[key] || "{}") : ["left", "right", "expected", "tolerance"].includes(key) ? parseValue(fields[key] ?? "") : fields[key] ?? ""
    ]))
  }));
}
var kindLabels = new Map([
  ["assert", "Check a rule"],
  ["compare", "Compare"],
  ["summarize", "Ask the bot"],
  ["template", "Write a message"],
  ["tool", "Use an app"]
]);
var newStepFields = new Map([
  ["assert", { expected: "", path: "" }],
  ["compare", { left: "", op: "eq", right: "" }],
  ["database", { input: '{"sql":"","params":[]}', tool: "sqlite" }],
  ["template", { template: "" }],
  ["tool", { input: '{"url":""}', tool: "web_fetch" }]
]);
function titleCase(id) {
  return id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function toolParts(name) {
  const split = name.lastIndexOf("__");
  const app = split === -1 ? "" : name.slice(0, split);
  return {
    action: titleCase(split === -1 ? name : name.slice(split + 2)),
    app: titleCase(app.replace(/^plugin[_-]+/, ""))
  };
}
function stepApp(kind, fields) {
  if (kind !== "tool") {
    return kindLabels.get(kind) ?? titleCase(kind);
  }
  if (fields.tool === "sqlite") {
    return "Table";
  }
  const { action, app } = toolParts(fields.tool ?? "");
  return app || action || "Choose an app";
}
function readPreview(value) {
  if (!(value && isWorkflowRecord(value))) {
    return null;
  }
  const columns = Array.isArray(value.columns) ? value.columns.map((column) => String(column)) : [];
  const rows = Array.isArray(value.rows) ? value.rows.filter((row) => isWorkflowRecord(row)) : [];
  return {
    columns,
    rows,
    total: value.total === Number(value.total) ? value.total : rows.length
  };
}
function isUrl(value) {
  return value === String(value) && /^https?:\/\//.test(value);
}
function columnType(rows, column) {
  const values = rows.flatMap((row) => {
    const value = row[column];
    return value == null || value === "" ? [] : [value];
  });
  if (!values.length) {
    return "";
  }
  if (values.every((value) => value === Number(value))) {
    return "number";
  }
  if (values.every((value) => value === true || value === false)) {
    return "boolean";
  }
  if (values.every(isUrl)) {
    return "url";
  }
  if (values.every((value) => value === String(value) && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}|$)/.test(value))) {
    return "datetime";
  }
  return values.every((value) => value === String(value)) ? "text" : "json";
}
function cellText(value, empty = "") {
  if (value == null) {
    return empty;
  }
  return value === String(value) ? value : JSON.stringify(value);
}
function writesTable(sql, table) {
  const name = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(insert(\\s+or\\s+\\w+)?\\s+into|replace\\s+into|update)\\s+["'\`[]?${name}\\b`, "i").test(sql);
}
function downloadCsv(table, columns, rows) {
  const quote = (value) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const csv = [
    columns,
    ...rows.map((row) => columns.map((c) => cellText(row[c])))
  ].map((line) => line.map(quote).join(",")).join(`
`);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = `${table}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
function uniqueStepId(label, taken) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "step";
  let id = base;
  for (let index = 2;taken.includes(id); index += 1) {
    id = `${base}_${index}`;
  }
  return id;
}
function parseInputRecord(text) {
  try {
    const value = parseWorkflowValue(JSON.parse(text || "{}"));
    return isWorkflowRecord(value) ? value : null;
  } catch {
    return null;
  }
}
var builtInActions = [
  {
    hint: "Keep rows you can read later",
    kind: "database",
    label: "Save to a table"
  },
  {
    hint: "Fill a template with earlier results",
    kind: "template",
    label: "Write a message"
  },
  { hint: "Stop if a value is wrong", kind: "assert", label: "Check a rule" },
  { hint: "Compare two values", kind: "compare", label: "Compare" }
];
function formatDuration(ms) {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 60000)}m`;
}
function formatRunTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  });
}
function readableError(message) {
  return /^[a-z]+(?:_[a-z]+)*$/.test(message) ? titleCase(message).replace(/ \w/g, (letter) => letter.toLowerCase()) : message;
}
function relativeTime(iso) {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(minutes) < 60) {
    return format.format(minutes, "minute");
  }
  if (Math.abs(minutes) < 60 * 24) {
    return format.format(Math.round(minutes / 60), "hour");
  }
  return format.format(Math.round(minutes / (60 * 24)), "day");
}
function dayGroup(iso) {
  const day = new Date(iso).toDateString();
  if (day === new Date().toDateString()) {
    return "Today";
  }
  if (day === new Date(Date.now() - 86400000).toDateString()) {
    return "Yesterday";
  }
  return "Earlier";
}
function readableEntries(value) {
  const short = (entry) => {
    if (entry === null || entry === undefined) {
      return "—";
    }
    if (Array.isArray(entry)) {
      return `${entry.length} items`;
    }
    if (isWorkflowRecord(entry)) {
      return `${Object.keys(entry).length} fields`;
    }
    const text = String(entry);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  };
  if (value === null || value === undefined) {
    return [];
  }
  if (isWorkflowRecord(value)) {
    return Object.entries(value).map(([key, entry]) => [key, short(entry)]);
  }
  return [["Value", short(value)]];
}
function runTimeline(run) {
  const timings = new Map;
  const steps = run?.steps ?? [];
  if (!run) {
    return timings;
  }
  const start = Date.parse(run.startedAt);
  const end = Math.max(run.completedAt ? Date.parse(run.completedAt) : 0, ...steps.map((step) => Date.parse(step.completedAt ?? step.startedAt)), start + 1);
  for (const step of steps) {
    const from = Date.parse(step.startedAt);
    const to = step.completedAt ? Date.parse(step.completedAt) : null;
    timings.set(step.stepId, {
      duration: to === null ? null : to - from,
      left: (from - start) / (end - start) * 100,
      status: step.status,
      width: to === null ? 0 : Math.max(1, (to - from) / (end - start) * 100)
    });
  }
  return timings;
}
var stepStatusLabels = new Map([
  ["completed", "Worked"],
  ["failed", "Stopped"],
  ["pending", "Waiting"],
  ["running", "Running"],
  ["skipped", "Skipped"]
]);
function apply(ctx) {
  const React = ctx.React;
  const {
    Button,
    Input,
    Textarea,
    Switch,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    Popover,
    PopoverTrigger,
    PopoverContent,
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem
  } = ctx.ui;
  function Choice({
    label,
    value,
    options,
    onChange,
    disabled = false
  }) {
    return /* @__PURE__ */ React.createElement(Select, {
      disabled,
      onValueChange: (next) => {
        if (next !== null) {
          onChange(String(next));
        }
      },
      value
    }, /* @__PURE__ */ React.createElement(SelectTrigger, {
      "aria-label": label
    }, /* @__PURE__ */ React.createElement(SelectValue, null, options.find((option) => option.value === value)?.label ?? label)), /* @__PURE__ */ React.createElement(SelectContent, null, options.map((option) => /* @__PURE__ */ React.createElement(SelectItem, {
      key: option.value,
      value: option.value
    }, option.label))));
  }
  function AppBadge({ app }) {
    return /* @__PURE__ */ React.createElement("span", {
      "aria-hidden": "true",
      className: "workflow-app-badge",
      "data-tint": app.length % 5
    }, app.charAt(0));
  }
  function ActionPicker({
    tools,
    onPick
  }) {
    const groups = new Map;
    for (const tool of tools) {
      if (tool.name !== "sqlite") {
        const app = toolParts(tool.name).app || "Other";
        groups.set(app, [...groups.get(app) ?? [], tool]);
      }
    }
    return /* @__PURE__ */ React.createElement(Command, {
      className: "workflow-action-picker"
    }, /* @__PURE__ */ React.createElement(CommandInput, {
      "aria-label": "Search actions",
      placeholder: "Search apps and actions"
    }), /* @__PURE__ */ React.createElement(CommandList, null, /* @__PURE__ */ React.createElement(CommandEmpty, null, "No actions found."), [...groups].toSorted(([a], [b]) => Number(a === "Other") - Number(b === "Other")).map(([app, entries]) => /* @__PURE__ */ React.createElement(CommandGroup, {
      heading: /* @__PURE__ */ React.createElement("span", {
        className: "workflow-picker-heading"
      }, /* @__PURE__ */ React.createElement(AppBadge, {
        app
      }), app),
      key: app
    }, entries.map((tool) => {
      const { action: action2 } = toolParts(tool.name);
      return /* @__PURE__ */ React.createElement(CommandItem, {
        key: tool.name,
        onSelect: () => onPick({ kind: "tool", label: action2, tool: tool.name }),
        value: `${app} ${action2} ${tool.name}`
      }, /* @__PURE__ */ React.createElement("span", {
        className: "workflow-picker-item"
      }, /* @__PURE__ */ React.createElement("span", null, action2), tool.description && /* @__PURE__ */ React.createElement("span", {
        className: "workflow-empty"
      }, tool.description.split(/(?<=\.)\s/)[0])));
    }))), /* @__PURE__ */ React.createElement(CommandGroup, {
      heading: "Built in"
    }, builtInActions.map((choice) => /* @__PURE__ */ React.createElement(CommandItem, {
      key: choice.kind,
      onSelect: () => onPick(choice),
      value: `built in ${choice.label}`
    }, /* @__PURE__ */ React.createElement("span", {
      className: "workflow-picker-item"
    }, /* @__PURE__ */ React.createElement("span", null, choice.label), /* @__PURE__ */ React.createElement("span", {
      className: "workflow-empty"
    }, choice.hint)))))));
  }
  function ValueField({
    label,
    value,
    sources,
    onChange
  }) {
    const [open, setOpen] = React.useState(false);
    const trimmed = value.trim();
    const isRef = /^\{\{[^{}]+\}\}$/.test(trimmed);
    const refLabel = sources.flatMap((group) => group.options.map((option) => ({
      label: `${group.label} · ${option.label}`,
      ref: option.ref
    }))).find((option) => option.ref === trimmed)?.label ?? trimmed;
    return /* @__PURE__ */ React.createElement("div", {
      className: "workflow-value-field"
    }, isRef ? /* @__PURE__ */ React.createElement("span", {
      className: "workflow-value-chip"
    }, /* @__PURE__ */ React.createElement("span", null, refLabel), /* @__PURE__ */ React.createElement("button", {
      "aria-label": `Clear ${label}`,
      onClick: () => onChange(""),
      type: "button"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "close"
    }))) : /* @__PURE__ */ React.createElement(Input, {
      "aria-label": label,
      onChange: (event) => onChange(event.target.value),
      value
    }), /* @__PURE__ */ React.createElement(Popover, {
      onOpenChange: setOpen,
      open
    }, /* @__PURE__ */ React.createElement(PopoverTrigger, {
      render: /* @__PURE__ */ React.createElement(Button, {
        size: "sm",
        type: "button",
        variant: "ghost"
      })
    }, "Use a value"), /* @__PURE__ */ React.createElement(PopoverContent, {
      align: "end",
      className: "overflow-hidden p-0 shadow-sm"
    }, /* @__PURE__ */ React.createElement(Command, null, /* @__PURE__ */ React.createElement(CommandInput, {
      "aria-label": "Search values",
      placeholder: "Search"
    }), /* @__PURE__ */ React.createElement(CommandList, null, /* @__PURE__ */ React.createElement(CommandEmpty, null, "Run the workflow once to see values."), sources.map((group) => group.options.length ? /* @__PURE__ */ React.createElement(CommandGroup, {
      heading: group.label,
      key: group.label
    }, group.options.map((option) => /* @__PURE__ */ React.createElement(CommandItem, {
      key: option.ref,
      onSelect: () => {
        onChange(option.ref);
        setOpen(false);
      },
      value: `${group.label} ${option.label}`
    }, /* @__PURE__ */ React.createElement("span", {
      className: "workflow-picker-item"
    }, /* @__PURE__ */ React.createElement("span", null, option.label), option.sample && /* @__PURE__ */ React.createElement("span", {
      className: "workflow-empty"
    }, option.sample))))) : null))))));
  }
  function ToolInputFields({
    schema,
    text,
    sources,
    disabled,
    onChange
  }) {
    const record = parseInputRecord(text);
    const required = schema?.required ?? [];
    const fields = Object.entries(schema?.properties ?? {}).map(([key, property]) => ({
      key,
      property,
      type: Array.isArray(property.type) ? property.type.find((type) => type !== "null") : property.type
    }));
    const simple = fields.filter((field) => field.type !== "object" && field.type !== "array").toSorted((a, b) => Number(required.includes(b.key)) - Number(required.includes(a.key)));
    const setField = (key, next) => onChange(JSON.stringify(Object.fromEntries([...Object.entries(record ?? {}), [key, next]].filter(([, entry]) => entry !== "" && entry !== undefined)), null, 2));
    return /* @__PURE__ */ React.createElement(React.Fragment, null, record === null && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, "The details below must be a JSON object."), record !== null && simple.map(({ key, property, type }) => {
      const label = property.title ?? titleCase(key);
      const current = record[key];
      return /* @__PURE__ */ React.createElement("div", {
        className: "workflow-field",
        key
      }, /* @__PURE__ */ React.createElement("span", {
        className: "workflow-field-label"
      }, label, required.includes(key) && /* @__PURE__ */ React.createElement("span", {
        "aria-label": "required",
        className: "workflow-required"
      }, "*")), property.description && /* @__PURE__ */ React.createElement("span", {
        className: "workflow-field-hint"
      }, property.description), property.enum ? /* @__PURE__ */ React.createElement(Choice, {
        disabled,
        label,
        onChange: setField.bind(null, key),
        options: property.enum.map((option) => ({
          label: String(option),
          value: String(option)
        })),
        value: current === undefined ? "" : String(current)
      }) : type === "boolean" ? /* @__PURE__ */ React.createElement(Switch, {
        "aria-label": label,
        checked: current === true,
        disabled,
        onCheckedChange: (checked) => setField(key, checked)
      }) : /* @__PURE__ */ React.createElement(ValueField, {
        label,
        onChange: (next) => setField(key, (type === "number" || type === "integer") && /^-?\d+(?:\.\d+)?$/.test(next) ? Number(next) : next),
        sources,
        value: current === undefined || current === null ? "" : isWorkflowRecord(current) || Array.isArray(current) ? JSON.stringify(current) : String(current)
      }));
    }), /* @__PURE__ */ React.createElement("details", {
      className: "workflow-technical",
      open: record === null || fields.length !== simple.length || !fields.length
    }, /* @__PURE__ */ React.createElement("summary", null, "Edit as JSON"), /* @__PURE__ */ React.createElement(Textarea, {
      "aria-label": "Details as JSON",
      disabled,
      onChange: (event) => onChange(event.target.value),
      rows: 8,
      spellCheck: false,
      value: text
    })));
  }
  function Icon({
    kind
  }) {
    const paths = {
      add: "M12 5v14M5 12h14",
      close: "m6 6 12 12M6 18 18 6",
      collapse: "M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7",
      delete: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7",
      expand: "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7",
      more: "M5 12h.01M12 12h.01M19 12h.01",
      play: "m8 5 11 7-11 7V5Z",
      table: "M3 4h18v16H3V4ZM3 9h18M9 9v11",
      warning: "M12 3 2 21h20L12 3ZM12 9v5M12 17h.01",
      workflow: "M4 3h6v6H4V3ZM14 15h6v6h-6v-6ZM7 9v9h7M10 6h7v9"
    };
    return /* @__PURE__ */ React.createElement("svg", {
      "aria-hidden": "true",
      fill: "none",
      height: "16",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: kind === "more" ? 3 : 1.5,
      viewBox: "0 0 24 24",
      width: "16"
    }, /* @__PURE__ */ React.createElement("path", {
      d: paths[kind]
    }));
  }
  ctx.styles(style_default);
  function WorkflowError({ message }) {
    const connectionError = /^MCP server "([^"]+)" is not connected\.$/.exec(message);
    return /* @__PURE__ */ React.createElement("div", {
      className: "workflow-error",
      role: "alert"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "warning"
    }), /* @__PURE__ */ React.createElement("p", null, connectionError ? `${connectionError[1]} isn’t connected.` : message), connectionError ? /* @__PURE__ */ React.createElement("a", {
      href: "/system?tab=mcp"
    }, "Open MCP settings") : null);
  }
  const action = (name, input) => ctx.host.call(name, input);
  function WorkflowRunCard({ input, result, status }) {
    const workflowId = input && readWorkflowString(input.workflowId);
    const [workflow, setWorkflow] = React.useState(null);
    const [liveRun, setLiveRun] = React.useState(null);
    const record = result ?? null;
    React.useEffect(() => {
      if (!workflowId) {
        return;
      }
      let active = true;
      let timer;
      const load = async () => {
        try {
          const definition = await action("get_workflow", {
            workflowId
          });
          if (active) {
            setWorkflow(definition);
          }
          if (status === "running") {
            const runs = await action("runs", {
              workflowId
            });
            if (active) {
              setLiveRun(runs.find((run2) => run2.status === "running") ?? null);
            }
          }
        } catch {}
        if (active && status === "running") {
          timer = setTimeout(load, 1500);
        }
      };
      load();
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [workflowId, status]);
    const run = record?.run ?? (status === "running" ? liveRun : null);
    const receipts = run?.steps ?? [];
    const steps = workflow?.steps ?? receipts.map((receipt) => ({ id: receipt.stepId, kind: receipt.kind }));
    const complete = receipts.filter((receipt) => receipt.status === "completed").length;
    const label = run?.status === "failed" || record?.error ? "Failed" : status === "running" ? "Running" : run?.status === "completed" ? "Done" : "Finished";
    return /* @__PURE__ */ React.createElement("section", {
      "aria-label": "Workflow run",
      className: "workflow-chat-card"
    }, /* @__PURE__ */ React.createElement("header", null, /* @__PURE__ */ React.createElement("h3", null, workflow?.name ?? record?.name ?? "Workflow"), /* @__PURE__ */ React.createElement("span", null, label, steps.length ? ` · ${complete} of ${steps.length}` : "")), run?.error || record?.error ? /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, run?.error ?? record?.error) : null, /* @__PURE__ */ React.createElement("ol", null, steps.map((step) => {
      const receipt = receipts.find((item) => item.stepId === step.id);
      const stepStatus = receipt?.status ?? "pending";
      const definition = workflow?.steps.find((item) => item.id === step.id);
      const detail = definition?.kind === "tool" ? definition.tool : definition?.kind === "summarize" ? definition.prompt : definition?.kind === "template" ? definition.template : step.kind;
      const output = receipt?.output === undefined ? undefined : parseWorkflowValue(receipt.output);
      const content = isWorkflowRecord(output) ? readWorkflowString(output.content) : null;
      const meta = receipt?.error ?? (content === null ? stepStatus === "completed" ? step.kind === "summarize" ? "Written" : "Done" : stepStatus : `${content.trim().split(/\s+/).filter(Boolean).length} words`);
      return /* @__PURE__ */ React.createElement("li", {
        "data-status": stepStatus,
        key: step.id
      }, /* @__PURE__ */ React.createElement("span", {
        "aria-label": stepStatus,
        className: "workflow-chat-mark"
      }, stepStatus === "completed" ? "✓" : stepStatus === "failed" ? "×" : "○"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", null, step.id.replaceAll(/[_-]+/g, " ").replaceAll(/\b\w/g, (letter) => letter.toUpperCase())), /* @__PURE__ */ React.createElement("p", {
        className: "workflow-chat-detail"
      }, detail)), /* @__PURE__ */ React.createElement("span", {
        className: "workflow-chat-result"
      }, meta));
    })));
  }
  function WorkflowsPage({
    renderHeaderActions = (children) => children
  }) {
    const [data, setData] = React.useState(null);
    const [selectedId, setSelectedId] = React.useState(null);
    const [error, setError] = React.useState("");
    const [deleteTarget, setDeleteTarget] = React.useState(null);
    const [deleting, setDeleting] = React.useState(false);
    React.useEffect(() => {
      let active = true;
      Promise.all([action("list_workflows"), action("profiles")]).then(([workflows, profiles]) => {
        if (active) {
          setData({ profiles, workflows });
          setSelectedId(workflows[0]?.id ?? null);
        }
      }).catch((error2) => {
        if (active) {
          setError(String(error2.message ?? error2));
        }
      });
      return () => {
        active = false;
      };
    }, []);
    const saved = async (id) => {
      const workflows = await action("list_workflows");
      setData((current) => current && { ...current, workflows });
      setSelectedId((current) => current === selectedId ? id ?? workflows[0]?.id ?? null : current);
    };
    const selected = data?.workflows.find((workflow) => workflow.id === selectedId) ?? null;
    const confirmDeleteWorkflow = async () => {
      if (!deleteTarget) {
        return;
      }
      setDeleting(true);
      try {
        await action("delete_workflow", { workflowId: deleteTarget.id });
        const workflows = await action("list_workflows");
        setData((current) => current && { ...current, workflows });
        setSelectedId((current) => current === deleteTarget.id ? workflows[0]?.id ?? null : current);
        setDeleteTarget(null);
      } catch (error2) {
        setError(error2 instanceof Error ? error2.message : String(error2));
        setDeleteTarget(null);
      } finally {
        setDeleting(false);
      }
    };
    return /* @__PURE__ */ React.createElement("main", {
      className: "workflows-page"
    }, data && renderHeaderActions(/* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSelectedId(""),
      type: "button",
      variant: "outline"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "add"
    }), "New workflow")), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), data ? /* @__PURE__ */ React.createElement("div", {
      className: "workflow-layout",
      "data-empty": data.workflows.length === 0
    }, data.workflows.length > 0 && /* @__PURE__ */ React.createElement("aside", {
      "aria-label": "Workflows",
      className: "workflow-sidebar"
    }, /* @__PURE__ */ React.createElement("ul", null, data.workflows.map((workflow) => /* @__PURE__ */ React.createElement("li", {
      className: "workflow-list-row",
      key: workflow.id
    }, /* @__PURE__ */ React.createElement(Button, {
      "aria-current": selectedId === workflow.id ? "true" : undefined,
      className: "workflow-list-item",
      onClick: () => setSelectedId(workflow.id),
      type: "button",
      variant: "ghost"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "workflow-list-name"
    }, workflow.name), /* @__PURE__ */ React.createElement("span", {
      className: "workflow-list-meta"
    }, workflow.steps.length, " steps ·", " ", data.profiles.find((profile) => profile.id === workflow.profileId)?.name ?? workflow.profileId), /* @__PURE__ */ React.createElement("span", {
      className: "workflow-list-state"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "workflow-status-dot",
      "data-enabled": workflow.enabled
    }), workflow.enabled ? "On" : "Off", workflow.lastRunAt ? ` · Ran ${relativeTime(workflow.lastRunAt)}` : " · Never run")), /* @__PURE__ */ React.createElement(Button, {
      "aria-label": `Delete ${workflow.name}`,
      className: "workflow-list-delete",
      onClick: () => setDeleteTarget(workflow),
      size: "icon-sm",
      type: "button",
      variant: "ghost"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "delete"
    })))))), selected || selectedId === "" ? /* @__PURE__ */ React.createElement(Editor, {
      key: `${selected?.id ?? "new"}:${selected?.version ?? 0}`,
      onSaved: saved,
      profiles: data.profiles,
      workflow: selected
    }) : /* @__PURE__ */ React.createElement("section", {
      className: "workflow-welcome"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-welcome-icon"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "workflow"
    })), /* @__PURE__ */ React.createElement("h2", null, data.workflows.length ? "Select a workflow" : "Create your first workflow"), /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSelectedId(""),
      type: "button"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "add"
    }), "Create workflow"))) : /* @__PURE__ */ React.createElement("p", {
      role: "status"
    }, error ? "Unavailable" : "Loading…"), /* @__PURE__ */ React.createElement(Dialog, {
      onOpenChange: (open) => {
        if (!(open || deleting)) {
          setDeleteTarget(null);
        }
      },
      open: deleteTarget !== null
    }, /* @__PURE__ */ React.createElement(DialogContent, null, /* @__PURE__ */ React.createElement(DialogHeader, null, /* @__PURE__ */ React.createElement(DialogTitle, null, "Delete workflow?"), /* @__PURE__ */ React.createElement(DialogDescription, null, "This removes the workflow and its run history permanently.")), /* @__PURE__ */ React.createElement(DialogFooter, null, /* @__PURE__ */ React.createElement(Button, {
      disabled: deleting,
      onClick: () => setDeleteTarget(null),
      type: "button",
      variant: "outline"
    }, "Cancel"), /* @__PURE__ */ React.createElement(Button, {
      disabled: deleting,
      onClick: () => void confirmDeleteWorkflow(),
      type: "button",
      variant: "destructive"
    }, "Delete")))));
  }
  function Editor({
    workflow,
    profiles,
    onSaved
  }) {
    const [name, setName] = React.useState(workflow?.name ?? "");
    const [description, setDescription] = React.useState(workflow?.description ?? "");
    const [agentId, setAgentId] = React.useState(workflow?.profileId ?? profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? "");
    const [enabled, setEnabled] = React.useState(workflow?.enabled ?? true);
    const summaryStep = workflow?.steps.find((step) => step.kind === "summarize");
    const [summary, setSummary] = React.useState(summaryStep?.prompt ?? "Summarize only the step results.");
    const [steps, setSteps] = React.useState(() => (workflow?.steps.filter((step) => step.kind !== "summarize") ?? []).map(draftStep));
    const [runInput, setRunInput] = React.useState("{}");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [runs, setRuns] = React.useState([]);
    const [confirmDelete, setConfirmDelete] = React.useState(false);
    const [view, setView] = React.useState("workflow");
    const [selection, setSelection] = React.useState("");
    const [panelTab, setPanelTab] = React.useState("configure");
    const [expanded, setExpanded] = React.useState(false);
    const [tools, setTools] = React.useState([]);
    const [picking, setPicking] = React.useState(false);
    const [tried, setTried] = React.useState(null);
    const [toolsError, setToolsError] = React.useState("");
    const panelRef = React.useRef(null);
    React.useEffect(() => {
      let active = true;
      setTools([]);
      setToolsError("");
      action("tools", { agentId }).then((result) => {
        if (active) {
          setTools(result);
        }
      }).catch((error2) => {
        if (active) {
          setToolsError(String(error2.message ?? error2));
        }
      });
      return () => {
        active = false;
      };
    }, [agentId]);
    React.useEffect(() => {
      setPanelTab("configure");
      setExpanded(false);
      setPicking(false);
      if (!selection) {
        return;
      }
      const previous = document.activeElement;
      panelRef.current?.focus();
      return () => {
        if (previous instanceof HTMLElement && previous.isConnected) {
          previous.focus();
        }
      };
    }, [selection]);
    React.useEffect(() => {
      if (!selection) {
        return;
      }
      const onKey = (event) => {
        if (event.key !== "Escape" || event.defaultPrevented) {
          return;
        }
        if (picking) {
          setPicking(false);
        } else if (expanded) {
          setExpanded(false);
        } else {
          setSelection("");
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [selection, expanded, picking]);
    const selectedIndex = steps.findIndex((step) => step.key === selection);
    const selectedStep = steps[selectedIndex];
    const initialDraft = React.useRef(JSON.stringify({ agentId, description, enabled, name, steps, summary }));
    const dirty = initialDraft.current !== JSON.stringify({ agentId, description, enabled, name, steps, summary });
    const mounted = React.useRef(true);
    const inFlight = React.useRef(false);
    React.useEffect(() => {
      mounted.current = true;
      if (workflow) {
        action("runs", { workflowId: workflow.id }).then((result) => {
          if (mounted.current) {
            setRuns(result);
          }
        }).catch((error2) => {
          if (mounted.current) {
            setError(String(error2.message ?? error2));
          }
        });
      }
      return () => {
        mounted.current = false;
      };
    }, [workflow]);
    const perform = async (work) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      setBusy(true);
      setError("");
      try {
        await work();
      } catch (error2) {
        if (mounted.current) {
          setError(error2 instanceof Error ? error2.message : String(error2));
        }
      } finally {
        inFlight.current = false;
        if (mounted.current) {
          setBusy(false);
        }
      }
    };
    const save = (event) => {
      event.preventDefault();
      perform(async () => {
        if (!(name.trim() && agentId && summary.trim())) {
          setSelection(summary.trim() ? "" : "summary");
          throw new Error("Enter a workflow name, choose an agent, and add summary instructions.");
        }
        const result = await action(workflow ? "update_workflow" : "create_workflow", {
          agentId,
          description,
          enabled,
          name,
          steps: [
            ...serializeSteps(steps),
            {
              id: summaryStep?.id ?? "summary",
              kind: "summarize",
              prompt: summary
            }
          ],
          workflowId: workflow?.id
        });
        if (mounted.current) {
          await onSaved(result.id);
        }
      });
    };
    const updateStep = (key, update) => setSteps((current) => current.map((step) => step.key === key ? { ...step, ...update } : step));
    const moveStep = (key, delta) => setSteps((current) => {
      const next = [...current];
      const index = next.findIndex((step) => step.key === key);
      const target = index + delta;
      if (target >= 0 && target < next.length) {
        [next[index], next[target]] = [next[target], next[index]];
      }
      return next;
    });
    const pickAction = (choice) => {
      const fields = choice.tool ? { input: "{}", tool: choice.tool } : { ...newStepFields.get(choice.kind) };
      const kind = choice.kind === "database" ? "tool" : choice.kind;
      if (picking && selectedStep) {
        updateStep(selectedStep.key, { fields, kind });
        setPicking(false);
        return;
      }
      const step = {
        fields,
        id: uniqueStepId(choice.label, steps.map((entry) => entry.id)),
        key: crypto.randomUUID(),
        kind
      };
      setSteps((current) => [...current, step]);
      setSelection(step.key);
    };
    const tryStep = (step) => void perform(async () => {
      const runRecord = parseInputRecord(runInput);
      const request = {
        agentId,
        stepId: step.id,
        steps: parseWorkflowValue([
          ...serializeSteps(steps),
          {
            id: summaryStep?.id ?? "summary",
            kind: "summarize",
            prompt: summary
          }
        ])
      };
      if (runRecord && Object.keys(runRecord).length) {
        request.input = runRecord;
      }
      if (workflow) {
        request.workflowId = workflow.id;
      }
      const result = await action("test_step", request);
      if (mounted.current) {
        setTried({ key: step.key, result });
      }
    });
    const runWorkflow = (previous) => void perform(async () => {
      if (!workflow || dirty || !enabled) {
        return;
      }
      const input = previous ? parseWorkflowValue(previous) : parseWorkflowValue(JSON.parse(runInput || "{}"));
      if (!isWorkflowRecord(input)) {
        throw new Error("Run input must be a JSON object.");
      }
      const result = await action("run_workflow", {
        input,
        workflowId: workflow.id
      });
      const history = await action("runs", {
        workflowId: workflow.id
      });
      if (mounted.current) {
        setRuns(history);
      }
      if (result.error) {
        throw new Error(result.error);
      }
    });
    const title = titleCase;
    const lastRun = runs[0];
    const showPicker = selection === "pick" || picking && Boolean(selectedStep);
    const drawerApp = selectedStep ? stepApp(selectedStep.kind, selectedStep.fields) : profiles.find((profile) => profile.id === agentId)?.name ?? "Bot";
    const valueSources = [
      {
        label: "Run input",
        options: readableEntries(parseInputRecord(runInput) ?? {}).map(([key, sample]) => ({
          label: titleCase(key),
          ref: `{{input.${key}}}`,
          sample
        }))
      },
      ...steps.slice(0, Math.max(selectedIndex, 0)).map((step, index) => {
        const receipt = lastRun?.steps?.find((entry) => entry.stepId === step.id);
        const output = receipt?.output == null ? undefined : parseWorkflowValue(receipt.output);
        const fieldsOut = isWorkflowRecord(output) ? readableEntries(output) : [];
        return {
          label: `Step ${index + 1} · ${titleCase(step.id)}`,
          options: [
            ...fieldsOut.map(([key, sample]) => ({
              label: titleCase(key),
              ref: `{{steps.${step.id}.${key}}}`,
              sample
            })),
            {
              label: "Whole result",
              ref: `{{steps.${step.id}}}`,
              sample: fieldsOut.length ? "" : readableEntries(output)[0]?.[1] ?? ""
            }
          ]
        };
      })
    ];
    const lastTimeline = runTimeline(lastRun);
    const failedInARow = runs.findIndex((run) => run.status !== "failed");
    const needsLook = failedInARow === -1 ? runs.length : failedInARow;
    const tableWriters = steps.filter((step) => step.fields.tool === "sqlite").map((step) => ({ name: title(step.id), sql: step.fields.input ?? "" }));
    const allSteps = [
      ...steps.map((step) => ({
        app: stepApp(step.kind, step.fields),
        id: step.id,
        key: step.key,
        kind: step.kind
      })),
      {
        app: profiles.find((profile) => profile.id === agentId)?.name ?? "Bot",
        id: summaryStep?.id ?? "summary",
        key: "summary",
        kind: "summarize"
      }
    ];
    return /* @__PURE__ */ React.createElement("section", {
      className: "workflow-editor"
    }, /* @__PURE__ */ React.createElement("form", {
      onSubmit: save
    }, /* @__PURE__ */ React.createElement("fieldset", {
      className: "editor-fields",
      disabled: busy
    }, /* @__PURE__ */ React.createElement("header", {
      className: "editor-toolbar"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-title-row"
    }, /* @__PURE__ */ React.createElement(Input, {
      "aria-label": "Workflow name",
      className: "workflow-name",
      maxLength: 200,
      onChange: (event) => setName(event.target.value),
      placeholder: "Untitled workflow",
      required: true,
      value: name
    }), /* @__PURE__ */ React.createElement("label", {
      className: "workflow-enabled"
    }, /* @__PURE__ */ React.createElement(Switch, {
      "aria-label": "On",
      checked: enabled,
      disabled: busy,
      onCheckedChange: setEnabled
    }), "On")), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-actions"
    }, (dirty || !workflow) && /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      size: "sm",
      type: "submit"
    }, busy ? "Saving…" : "Save"), /* @__PURE__ */ React.createElement(Choice, {
      disabled: busy,
      label: "Agent",
      onChange: setAgentId,
      options: profiles.map((profile) => ({
        label: profile.name,
        value: profile.id
      })),
      value: agentId
    }), /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, {
      disabled: busy,
      render: /* @__PURE__ */ React.createElement(Button, {
        "aria-label": "More actions",
        size: "icon-sm",
        type: "button",
        variant: "outline"
      })
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "more"
    })), /* @__PURE__ */ React.createElement(DropdownMenuContent, {
      align: "end"
    }, /* @__PURE__ */ React.createElement(DropdownMenuItem, {
      onClick: () => setSelection("input")
    }, "Run input"), /* @__PURE__ */ React.createElement(DropdownMenuItem, {
      disabled: !workflow,
      onClick: () => setConfirmDelete(true),
      variant: "destructive"
    }, "Delete workflow"))), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy || !workflow || dirty || !enabled,
      onClick: () => runWorkflow(),
      size: "sm",
      type: "button"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "play"
    }), busy ? "Running…" : "Try it"))), /* @__PURE__ */ React.createElement("nav", {
      "aria-label": "Workflow views",
      className: "workflow-view-nav"
    }, [
      ["workflow", "Steps"],
      ["runs", "History"],
      ["data", "Saved data"]
    ].map(([tab, label]) => /* @__PURE__ */ React.createElement(Button, {
      "aria-pressed": view === tab,
      key: tab,
      onClick: () => {
        setSelection("");
        setView(tab);
      },
      type: "button",
      variant: "ghost"
    }, label, tab === "runs" && needsLook > 0 && /* @__PURE__ */ React.createElement("span", {
      "aria-label": `${needsLook} failed`,
      className: "workflow-tab-badge"
    }, needsLook)))), error && /* @__PURE__ */ React.createElement(WorkflowError, {
      message: error
    }), view === "runs" && /* @__PURE__ */ React.createElement(RunHistory, {
      canRun: Boolean(workflow) && !dirty && enabled && !busy,
      onRunAgain: (input) => runWorkflow(input),
      runs,
      stepNames: Object.fromEntries(allSteps.map((step) => [step.id, title(step.id)]))
    }), view === "data" && /* @__PURE__ */ React.createElement("section", {
      "aria-label": "Workflow data",
      className: "workflow-data-page"
    }, /* @__PURE__ */ React.createElement(DatabasePanel, {
      canRun: Boolean(workflow) && !dirty && enabled && !busy,
      onRun: () => runWorkflow(),
      writers: tableWriters
    })), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-scroll",
      hidden: view !== "workflow"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-content"
    }, /* @__PURE__ */ React.createElement(Textarea, {
      "aria-label": "Workflow description",
      className: "workflow-description",
      onChange: (event) => setDescription(event.target.value),
      placeholder: "Description",
      rows: 1,
      value: description
    }), /* @__PURE__ */ React.createElement("ol", {
      className: "workflow-steps"
    }, allSteps.map((step, index) => {
      const timing = lastTimeline.get(step.id);
      return /* @__PURE__ */ React.createElement("li", {
        key: step.key
      }, /* @__PURE__ */ React.createElement("div", {
        className: "workflow-step-card",
        "data-selected": selection === step.key
      }, /* @__PURE__ */ React.createElement(Button, {
        className: "workflow-step-open",
        onClick: () => setSelection(step.key),
        type: "button",
        variant: "ghost"
      }, /* @__PURE__ */ React.createElement(AppBadge, {
        app: step.app
      }), /* @__PURE__ */ React.createElement("span", {
        className: "workflow-step-text"
      }, /* @__PURE__ */ React.createElement("span", {
        className: "workflow-step-kind"
      }, step.key === "summary" ? "Summary" : `Step ${index + 1}`, " ", "· ", step.app), /* @__PURE__ */ React.createElement("span", {
        className: "workflow-step-name"
      }, title(step.id) || "Untitled step")), timing && /* @__PURE__ */ React.createElement("span", {
        className: "workflow-step-last",
        "data-status": timing.status
      }, /* @__PURE__ */ React.createElement("span", null, timing.status === "completed" && "✓ ", stepStatusLabels.get(timing.status) ?? timing.status, timing.duration !== null && ` · ${formatDuration(timing.duration)}`), /* @__PURE__ */ React.createElement("span", {
        "aria-hidden": "true",
        className: "workflow-bar"
      }, /* @__PURE__ */ React.createElement("span", {
        style: {
          left: `${timing.left}%`,
          width: `${timing.width}%`
        }
      })))), /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, {
        disabled: busy,
        render: /* @__PURE__ */ React.createElement(Button, {
          "aria-label": `Options for ${title(step.id)}`,
          size: "icon-sm",
          type: "button",
          variant: "ghost"
        })
      }, /* @__PURE__ */ React.createElement(Icon, {
        kind: "more"
      })), /* @__PURE__ */ React.createElement(DropdownMenuContent, {
        align: "end"
      }, /* @__PURE__ */ React.createElement(DropdownMenuItem, {
        onClick: () => setSelection(step.key)
      }, "Configure"), step.key !== "summary" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(DropdownMenuItem, {
        disabled: index === 0,
        onClick: () => moveStep(step.key, -1)
      }, "Move earlier"), /* @__PURE__ */ React.createElement(DropdownMenuItem, {
        disabled: index === steps.length - 1,
        onClick: () => moveStep(step.key, 1)
      }, "Move later"), /* @__PURE__ */ React.createElement(DropdownMenuItem, {
        onClick: () => setSteps((current) => current.filter((entry) => entry.key !== step.key)),
        variant: "destructive"
      }, "Delete step"))))), index < steps.length && /* @__PURE__ */ React.createElement("div", {
        "aria-hidden": "true",
        className: "workflow-connector"
      }));
    })), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-add-actions"
    }, /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSelection("pick"),
      type: "button",
      variant: "outline"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "add"
    }), "Add step")))))), (selectedStep || selection === "summary" || selection === "pick") && /* @__PURE__ */ React.createElement("aside", {
      "aria-label": "Workflow step",
      className: "workflow-step-drawer",
      "data-expanded": expanded,
      ref: panelRef,
      tabIndex: -1
    }, /* @__PURE__ */ React.createElement("header", {
      className: "workflow-drawer-header"
    }, showPicker ? /* @__PURE__ */ React.createElement("div", {
      className: "workflow-drawer-title"
    }, /* @__PURE__ */ React.createElement("p", null, "Step ", selectedStep ? selectedIndex + 1 : steps.length + 1), /* @__PURE__ */ React.createElement("h2", null, "What should this step do?")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(AppBadge, {
      app: drawerApp
    }), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-drawer-title"
    }, /* @__PURE__ */ React.createElement("p", null, selectedStep ? `Step ${selectedIndex + 1}` : "Summary", " ·", " ", drawerApp), /* @__PURE__ */ React.createElement("h2", null, title(selectedStep?.id ?? summaryStep?.id ?? "summary")))), /* @__PURE__ */ React.createElement(Button, {
      "aria-label": expanded ? "Collapse step" : "Expand step",
      onClick: () => setExpanded((value) => !value),
      size: "icon-sm",
      type: "button",
      variant: "ghost"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: expanded ? "collapse" : "expand"
    })), /* @__PURE__ */ React.createElement(Button, {
      "aria-label": "Close step",
      onClick: () => setSelection(""),
      size: "icon-sm",
      type: "button",
      variant: "ghost"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "close"
    }))), showPicker ? /* @__PURE__ */ React.createElement("div", {
      className: "workflow-drawer-body"
    }, /* @__PURE__ */ React.createElement(ActionPicker, {
      onPick: pickAction,
      tools
    })) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", {
      "aria-label": "Step views",
      className: "workflow-drawer-tabs"
    }, [
      "configure",
      ...selectedStep?.fields.tool === "sqlite" ? ["database"] : [],
      "test"
    ].map((tab) => /* @__PURE__ */ React.createElement(Button, {
      "aria-pressed": panelTab === tab,
      key: tab,
      onClick: () => setPanelTab(tab),
      type: "button",
      variant: "ghost"
    }, {
      configure: "Settings",
      database: "Data",
      test: "Last run"
    }[tab] ?? title(tab)))), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-drawer-body"
    }, panelTab === "configure" && /* @__PURE__ */ React.createElement("div", {
      className: "workflow-step-fields"
    }, toolsError && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, toolsError), selectedStep && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", null, "Step name", /* @__PURE__ */ React.createElement(Input, {
      disabled: busy,
      onChange: (event) => updateStep(selectedStep.key, {
        id: event.target.value
      }),
      value: selectedStep.id
    })), (stepFields[selectedStep.kind] ?? []).map((field) => field === "tool" ? /* @__PURE__ */ React.createElement("div", {
      className: "workflow-field",
      key: field
    }, /* @__PURE__ */ React.createElement("span", {
      className: "workflow-field-label"
    }, "Action"), /* @__PURE__ */ React.createElement(Button, {
      className: "workflow-action-button",
      disabled: busy,
      onClick: () => setPicking(true),
      type: "button",
      variant: "outline"
    }, /* @__PURE__ */ React.createElement(AppBadge, {
      app: drawerApp
    }), /* @__PURE__ */ React.createElement("span", null, selectedStep.fields.tool === "sqlite" ? "Save to a table" : toolParts(selectedStep.fields.tool ?? "").action), /* @__PURE__ */ React.createElement("span", {
      className: "workflow-empty"
    }, "Change"))) : field === "input" && selectedStep.fields.tool !== "sqlite" ? /* @__PURE__ */ React.createElement(ToolInputFields, {
      disabled: busy,
      key: field,
      onChange: (text) => updateStep(selectedStep.key, {
        fields: {
          ...selectedStep.fields,
          input: text
        }
      }),
      schema: tools.find((tool) => tool.name === selectedStep.fields.tool)?.parameters,
      sources: valueSources,
      text: selectedStep.fields.input ?? ""
    }) : field === "op" ? /* @__PURE__ */ React.createElement(Choice, {
      disabled: busy,
      key: field,
      label: "Operator",
      onChange: (value) => updateStep(selectedStep.key, {
        fields: {
          ...selectedStep.fields,
          [field]: value
        }
      }),
      options: ["eq", "near", "contains"].map((op) => ({
        label: op,
        value: op
      })),
      value: selectedStep.fields[field] ?? "eq"
    }) : /* @__PURE__ */ React.createElement("label", {
      key: field
    }, field === "input" ? "Details" : title(field), /* @__PURE__ */ React.createElement(Textarea, {
      disabled: busy,
      onChange: (event) => updateStep(selectedStep.key, {
        fields: {
          ...selectedStep.fields,
          [field]: event.target.value
        }
      }),
      rows: field === "input" || field === "template" ? 8 : 2,
      value: selectedStep.fields[field] ?? ""
    })))), selection === "summary" && /* @__PURE__ */ React.createElement("label", null, "What should the bot write?", /* @__PURE__ */ React.createElement(Textarea, {
      disabled: busy,
      onChange: (event) => setSummary(event.target.value),
      rows: 8,
      value: summary
    }))), panelTab === "database" && /* @__PURE__ */ React.createElement(DatabasePanel, {
      canRun: Boolean(workflow) && !dirty && enabled && !busy,
      onRun: () => runWorkflow(),
      writers: tableWriters
    }), panelTab === "test" && (() => {
      const receipt = runs[0]?.steps?.find((step) => step.stepId === (selectedStep?.id ?? summaryStep?.id ?? "summary"));
      const attempt = selectedStep && tried?.key === selectedStep.key ? tried.result : null;
      return /* @__PURE__ */ React.createElement("div", {
        className: "workflow-step-fields"
      }, selectedStep && /* @__PURE__ */ React.createElement("section", {
        className: "workflow-try"
      }, /* @__PURE__ */ React.createElement(Button, {
        disabled: busy,
        onClick: () => tryStep(selectedStep),
        type: "button",
        variant: "outline"
      }, /* @__PURE__ */ React.createElement(Icon, {
        kind: "play"
      }), busy ? "Trying…" : "Try this step"), attempt && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", {
        className: "workflow-try-status",
        "data-status": attempt.error ? "failed" : "completed"
      }, attempt.error ? "Stopped" : "Worked", " in", " ", formatDuration(attempt.durationMs)), /* @__PURE__ */ React.createElement(StepReceipt, {
        receipt: {
          error: attempt.error ? readableError(attempt.error) : null,
          input: attempt.input,
          output: attempt.output
        }
      }))), receipt ? /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("h3", {
        className: "workflow-try-heading"
      }, "Last run"), /* @__PURE__ */ React.createElement(StepReceipt, {
        receipt
      })) : !attempt && /* @__PURE__ */ React.createElement("p", {
        className: "workflow-empty"
      }, "No results yet. Try this step or run the workflow."));
    })()))), /* @__PURE__ */ React.createElement(Dialog, {
      onOpenChange: (open) => {
        if (!(open || busy)) {
          setSelection("");
        }
      },
      open: selection === "input"
    }, /* @__PURE__ */ React.createElement(DialogContent, null, /* @__PURE__ */ React.createElement(DialogHeader, null, /* @__PURE__ */ React.createElement(DialogTitle, null, "Run input")), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-step-fields",
      style: {
        display: "grid",
        gap: 16,
        maxHeight: "65dvh",
        overflowY: "auto"
      }
    }, selection === "input" && /* @__PURE__ */ React.createElement("label", null, "Run input (JSON)", /* @__PURE__ */ React.createElement(Textarea, {
      disabled: busy,
      onChange: (event) => setRunInput(event.target.value),
      rows: 8,
      spellCheck: false,
      value: runInput
    }))), /* @__PURE__ */ React.createElement(DialogFooter, null, /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => setSelection(""),
      type: "button"
    }, "Done")))), /* @__PURE__ */ React.createElement(Dialog, {
      onOpenChange: (open) => {
        if (!busy) {
          setConfirmDelete(open);
        }
      },
      open: confirmDelete
    }, /* @__PURE__ */ React.createElement(DialogContent, null, /* @__PURE__ */ React.createElement(DialogHeader, null, /* @__PURE__ */ React.createElement(DialogTitle, null, "Delete workflow?"), /* @__PURE__ */ React.createElement(DialogDescription, null, "This removes the workflow and its run history permanently.")), /* @__PURE__ */ React.createElement(DialogFooter, null, /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => setConfirmDelete(false),
      type: "button",
      variant: "outline"
    }, "Cancel"), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => void perform(async () => {
        await action("delete_workflow", {
          workflowId: workflow.id
        });
        if (mounted.current) {
          await onSaved();
        }
      }),
      type: "button",
      variant: "destructive"
    }, "Delete")))));
  }
  function StepReceipt({
    receipt,
    showError = true
  }) {
    const sections = [
      ["What went in", receipt.input],
      ["What came out", receipt.output]
    ].map(([label, value]) => ({
      entries: readableEntries(value == null ? undefined : parseWorkflowValue(value)),
      label: String(label)
    }));
    const recorded = sections.some((section) => section.entries.length);
    return /* @__PURE__ */ React.createElement(React.Fragment, null, showError && receipt.error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, readableError(receipt.error)), recorded ? /* @__PURE__ */ React.createElement("div", {
      className: "workflow-receipt"
    }, sections.map(({ entries, label }) => /* @__PURE__ */ React.createElement("section", {
      key: label
    }, /* @__PURE__ */ React.createElement("h4", null, label), entries.length ? /* @__PURE__ */ React.createElement("dl", null, entries.map(([key, entry]) => /* @__PURE__ */ React.createElement("div", {
      key
    }, /* @__PURE__ */ React.createElement("dt", null, titleCase(key)), /* @__PURE__ */ React.createElement("dd", {
      title: entry
    }, entry)))) : /* @__PURE__ */ React.createElement("p", {
      className: "workflow-empty"
    }, "Nothing")))) : /* @__PURE__ */ React.createElement("p", {
      className: "workflow-empty"
    }, "No data was saved for this step."), /* @__PURE__ */ React.createElement("details", {
      className: "workflow-technical"
    }, /* @__PURE__ */ React.createElement("summary", null, "Technical details"), /* @__PURE__ */ React.createElement("pre", null, JSON.stringify({
      error: receipt.error,
      input: receipt.input,
      output: receipt.output
    }, null, 2))));
  }
  function RunHistory({
    runs,
    stepNames,
    canRun,
    onRunAgain
  }) {
    const [selectedId, setSelectedId] = React.useState("");
    const run = runs.find((entry) => entry.id === selectedId) ?? runs[0];
    if (!run) {
      return /* @__PURE__ */ React.createElement("section", {
        "aria-label": "History",
        className: "workflow-scroll"
      }, /* @__PURE__ */ React.createElement("p", {
        className: "workflow-empty"
      }, "No runs yet."));
    }
    const receipts = run.steps ?? [];
    const timeline = runTimeline(run);
    const failedIndex = receipts.findIndex((step) => step.status === "failed");
    const name = (stepId) => stepNames[stepId] ?? titleCase(stepId);
    return /* @__PURE__ */ React.createElement("div", {
      className: "workflow-history"
    }, /* @__PURE__ */ React.createElement("nav", {
      "aria-label": "Past runs",
      className: "workflow-history-list"
    }, ["Today", "Yesterday", "Earlier"].map((group) => {
      const entries = runs.filter((entry) => dayGroup(entry.startedAt) === group);
      return entries.length ? /* @__PURE__ */ React.createElement("section", {
        key: group
      }, /* @__PURE__ */ React.createElement("h3", null, group), entries.map((entry) => /* @__PURE__ */ React.createElement(Button, {
        "aria-current": entry.id === run.id ? "true" : undefined,
        className: "workflow-history-item",
        key: entry.id,
        onClick: () => setSelectedId(entry.id),
        type: "button",
        variant: "ghost"
      }, /* @__PURE__ */ React.createElement("span", {
        "aria-hidden": "true",
        className: "workflow-run-badge",
        "data-status": entry.status
      }, entry.status === "completed" ? "✓" : entry.status === "failed" ? "!" : "…"), /* @__PURE__ */ React.createElement("span", {
        className: "workflow-history-text"
      }, /* @__PURE__ */ React.createElement("span", null, group === "Earlier" ? formatRunTime(entry.startedAt) : new Date(entry.startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })), /* @__PURE__ */ React.createElement("span", {
        className: "workflow-empty"
      }, stepStatusLabels.get(entry.status) ?? entry.status))))) : null;
    })), /* @__PURE__ */ React.createElement("section", {
      "aria-label": "Run details",
      className: "workflow-history-detail"
    }, /* @__PURE__ */ React.createElement("header", null, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", {
      className: "workflow-run-chip",
      "data-status": run.status
    }, run.status === "failed" ? "Needs a look" : stepStatusLabels.get(run.status) ?? run.status), /* @__PURE__ */ React.createElement("h3", null, run.status === "failed" ? `Stopped at step ${failedIndex + 1}` : run.status === "running" ? "Running…" : `All ${receipts.length} steps worked`), /* @__PURE__ */ React.createElement("p", {
      className: "workflow-empty"
    }, formatRunTime(run.startedAt), run.completedAt && ` · took ${formatDuration(Date.parse(run.completedAt) - Date.parse(run.startedAt))}`)), /* @__PURE__ */ React.createElement(Button, {
      disabled: !canRun,
      onClick: () => onRunAgain(run.input),
      size: "sm",
      type: "button",
      variant: "outline"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "play"
    }), "Run again")), run.error && /* @__PURE__ */ React.createElement("div", {
      className: "workflow-history-error",
      role: "alert"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "warning"
    }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", null, failedIndex >= 0 ? `${name(receipts[failedIndex].stepId)} did not finish` : "This run did not finish"), /* @__PURE__ */ React.createElement("p", null, readableError(run.error)))), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-trace-box"
    }, /* @__PURE__ */ React.createElement("div", {
      "aria-hidden": "true",
      className: "workflow-trace-head"
    }, /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null, "Step"), /* @__PURE__ */ React.createElement("span", null, "When it ran"), /* @__PURE__ */ React.createElement("span", null, "Time")), /* @__PURE__ */ React.createElement("ol", {
      className: "workflow-trace"
    }, receipts.map((receipt) => {
      const timing = timeline.get(receipt.stepId);
      return /* @__PURE__ */ React.createElement("li", {
        "data-status": receipt.status,
        key: receipt.id
      }, /* @__PURE__ */ React.createElement("details", {
        open: receipt.status === "failed"
      }, /* @__PURE__ */ React.createElement("summary", null, /* @__PURE__ */ React.createElement("span", {
        className: "workflow-run-mark",
        "data-status": receipt.status
      }), /* @__PURE__ */ React.createElement("span", {
        className: "workflow-trace-name"
      }, name(receipt.stepId), /* @__PURE__ */ React.createElement("span", {
        className: "workflow-empty"
      }, stepStatusLabels.get(receipt.status) ?? receipt.status)), /* @__PURE__ */ React.createElement("span", {
        "aria-hidden": "true",
        className: "workflow-bar"
      }, /* @__PURE__ */ React.createElement("span", {
        style: {
          left: `${timing?.left ?? 0}%`,
          width: `${timing?.width ?? 0}%`
        }
      })), /* @__PURE__ */ React.createElement("span", {
        className: "workflow-trace-time"
      }, timing?.duration == null ? "—" : formatDuration(timing.duration))), /* @__PURE__ */ React.createElement("div", {
        className: "workflow-trace-body"
      }, /* @__PURE__ */ React.createElement(StepReceipt, {
        receipt,
        showError: false
      }))));
    }))), run.status === "completed" && run.output && /* @__PURE__ */ React.createElement("section", {
      className: "workflow-history-result"
    }, /* @__PURE__ */ React.createElement("h4", null, "Result"), /* @__PURE__ */ React.createElement("p", null, run.output))));
  }
  function DatabasePanel({
    canRun,
    onRun,
    writers
  }) {
    const [table, setTable] = React.useState("");
    const [view, setView] = React.useState("rows");
    const [query, setQuery] = React.useState("");
    const [picked, setPicked] = React.useState(null);
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(true);
    const [retry, setRetry] = React.useState(0);
    React.useEffect(() => {
      let active = true;
      setLoading(true);
      setError("");
      action("database", table ? { table } : {}).then((result) => {
        if (!active) {
          return;
        }
        setData(result);
        if (!table && result.tables[0]) {
          setTable(result.tables[0].name);
        }
      }).catch((error2) => {
        if (active) {
          setError(error2 instanceof Error ? error2.message : String(error2));
        }
      }).finally(() => {
        if (active) {
          setLoading(false);
        }
      });
      return () => {
        active = false;
      };
    }, [table, retry]);
    const pickTable = (name) => {
      setTable(name);
      setQuery("");
      setPicked(null);
    };
    const preview = readPreview(data?.preview);
    const columns = preview?.columns ?? [];
    const rows = preview?.rows ?? [];
    const types = Object.fromEntries(columns.map((column) => [column, columnType(rows, column)]));
    const needle = query.trim().toLowerCase();
    const shown = rows.flatMap((row, index) => !needle || Object.values(row).some((value) => cellText(value).toLowerCase().includes(needle)) ? [{ index, row }] : []);
    const selected = picked == null ? null : rows[picked] ?? null;
    const keyColumn = columns.find((column) => column === "id") ?? columns[0];
    const writer = writers.find((entry) => writesTable(entry.sql, table));
    const total = preview?.total ?? 0;
    if (error) {
      return /* @__PURE__ */ React.createElement("div", {
        className: "workflow-data-message"
      }, /* @__PURE__ */ React.createElement("p", {
        role: "alert"
      }, error), /* @__PURE__ */ React.createElement(Button, {
        onClick: () => setRetry((value) => value + 1),
        type: "button",
        variant: "outline"
      }, "Retry"));
    }
    if (!data && loading) {
      return /* @__PURE__ */ React.createElement("p", {
        className: "workflow-data-message workflow-empty",
        role: "status"
      }, "Loading data…");
    }
    if (!data?.tables.length) {
      return /* @__PURE__ */ React.createElement("div", {
        className: "workflow-data-message workflow-empty"
      }, /* @__PURE__ */ React.createElement("p", null, "No tables yet."), /* @__PURE__ */ React.createElement("p", null, "Add a database step and run it to store data here."));
    }
    return /* @__PURE__ */ React.createElement("div", {
      "aria-busy": loading,
      className: "workflow-data"
    }, /* @__PURE__ */ React.createElement("nav", {
      "aria-label": "Tables",
      className: "workflow-data-tables"
    }, /* @__PURE__ */ React.createElement("p", null, "Tables"), data.tables.map((entry) => /* @__PURE__ */ React.createElement(Button, {
      "aria-current": entry.name === table ? "true" : undefined,
      key: entry.name,
      onClick: () => pickTable(entry.name),
      type: "button",
      variant: "ghost"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "table"
    }), /* @__PURE__ */ React.createElement("span", {
      className: "workflow-data-table-name"
    }, entry.name), /* @__PURE__ */ React.createElement("span", {
      className: "workflow-data-count"
    }, entry.rowCount ?? "")))), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-data-main"
    }, /* @__PURE__ */ React.createElement("header", {
      className: "workflow-data-head"
    }, /* @__PURE__ */ React.createElement("h2", null, table), /* @__PURE__ */ React.createElement("span", {
      className: "workflow-empty"
    }, total, " ", total === 1 ? "row" : "rows", " · ", columns.length, " columns", rows.length < total ? ` · showing first ${rows.length}` : ""), /* @__PURE__ */ React.createElement("div", {
      "aria-label": "Table view",
      className: "workflow-data-views",
      role: "tablist"
    }, [
      ["rows", "Rows"],
      ["schema", "Schema"],
      ["json", "JSON"]
    ].map(([id, label]) => /* @__PURE__ */ React.createElement(Button, {
      "aria-selected": view === id,
      key: id,
      onClick: () => setView(id),
      role: "tab",
      size: "sm",
      type: "button",
      variant: "ghost"
    }, label)))), view === "rows" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-data-toolbar"
    }, /* @__PURE__ */ React.createElement(Input, {
      "aria-label": "Search rows",
      disabled: !rows.length,
      onChange: (event) => setQuery(event.target.value),
      placeholder: "Search rows",
      type: "search",
      value: query
    }), /* @__PURE__ */ React.createElement(Button, {
      disabled: !rows.length,
      onClick: () => downloadCsv(table, columns, rows),
      type: "button",
      variant: "outline"
    }, "Export CSV")), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-data-body"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-data-grid"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-data-scroll"
    }, /* @__PURE__ */ React.createElement("table", null, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, columns.map((column) => /* @__PURE__ */ React.createElement("th", {
      key: column,
      scope: "col"
    }, column, /* @__PURE__ */ React.createElement("span", null, types[column]))))), /* @__PURE__ */ React.createElement("tbody", null, shown.map(({ index, row }) => /* @__PURE__ */ React.createElement("tr", {
      "aria-selected": picked === index,
      key: index,
      onClick: () => setPicked(index)
    }, columns.map((column, at) => /* @__PURE__ */ React.createElement("td", {
      "data-type": types[column],
      key: column
    }, at === 0 ? /* @__PURE__ */ React.createElement("button", {
      onClick: (event) => {
        event.stopPropagation();
        setPicked(index);
      },
      type: "button"
    }, cellText(row[column])) : cellText(row[column])))))))), !rows.length && /* @__PURE__ */ React.createElement("div", {
      className: "workflow-data-empty"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "table"
    }), /* @__PURE__ */ React.createElement("h3", null, "No rows yet"), /* @__PURE__ */ React.createElement("p", null, writer ? `${writer.name} writes to this table. Run the workflow to fill it.` : "Run the workflow to fill this table."), /* @__PURE__ */ React.createElement(Button, {
      disabled: !canRun,
      onClick: onRun,
      type: "button"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "play"
    }), "Try it now")), Boolean(rows.length) && !shown.length && /* @__PURE__ */ React.createElement("p", {
      className: "workflow-data-empty workflow-empty"
    }, "No rows match your search.")), selected && /* @__PURE__ */ React.createElement("aside", {
      "aria-label": "Row details",
      className: "workflow-data-row"
    }, /* @__PURE__ */ React.createElement("header", null, /* @__PURE__ */ React.createElement("h3", null, "Row"), keyColumn && /* @__PURE__ */ React.createElement("span", null, keyColumn, " = ", cellText(selected[keyColumn])), /* @__PURE__ */ React.createElement(Button, {
      onClick: () => void navigator.clipboard.writeText(JSON.stringify(selected, null, 2)),
      size: "sm",
      type: "button",
      variant: "outline"
    }, "Copy JSON"), /* @__PURE__ */ React.createElement(Button, {
      "aria-label": "Close row details",
      onClick: () => setPicked(null),
      size: "icon-sm",
      type: "button",
      variant: "outline"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "close"
    }))), /* @__PURE__ */ React.createElement("dl", null, columns.map((column) => /* @__PURE__ */ React.createElement("div", {
      key: column
    }, /* @__PURE__ */ React.createElement("dt", null, /* @__PURE__ */ React.createElement("span", null, column), /* @__PURE__ */ React.createElement("span", null, types[column])), /* @__PURE__ */ React.createElement("dd", {
      "data-empty": selected[column] == null || undefined,
      "data-type": types[column]
    }, types[column] === "url" && isUrl(selected[column]) ? /* @__PURE__ */ React.createElement("a", {
      href: String(selected[column]),
      rel: "noreferrer",
      target: "_blank"
    }, String(selected[column])) : cellText(selected[column], "null"))))), writer && /* @__PURE__ */ React.createElement("p", {
      className: "workflow-data-writer"
    }, "Written by ", writer.name)))), view === "schema" && /* @__PURE__ */ React.createElement("div", {
      className: "workflow-data-grid"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-data-scroll"
    }, /* @__PURE__ */ React.createElement("table", null, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", {
      scope: "col"
    }, "Column"), /* @__PURE__ */ React.createElement("th", {
      scope: "col"
    }, "Type"), /* @__PURE__ */ React.createElement("th", {
      scope: "col"
    }, "Written by"), /* @__PURE__ */ React.createElement("th", {
      scope: "col"
    }, "Last value"))), /* @__PURE__ */ React.createElement("tbody", null, columns.map((column) => /* @__PURE__ */ React.createElement("tr", {
      key: column
    }, /* @__PURE__ */ React.createElement("td", {
      "data-type": "key"
    }, column), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", {
      className: "workflow-data-type"
    }, types[column] || "unknown")), /* @__PURE__ */ React.createElement("td", null, writer?.name ?? "—"), /* @__PURE__ */ React.createElement("td", {
      "data-type": "muted"
    }, rows.length ? cellText(rows[0]?.[column]) : "—"))))))), view === "json" && /* @__PURE__ */ React.createElement("pre", {
      className: "workflow-data-json"
    }, JSON.stringify(data.preview ?? null, null, 2))));
  }
  ctx.slots.register("tool:run_workflow", WorkflowRunCard);
  ctx.slots.register("page", WorkflowsPage);
}
export {
  apply,
  inject
};
