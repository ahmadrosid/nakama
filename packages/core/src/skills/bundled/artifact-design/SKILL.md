---
name: artifact-design
description: Design artifacts such as HTML pages, dashboards, charts, reports, plans, memos, summaries, code snippets, and logs. For slide decks and presentations, use slide-deck-design.
---

Design complete deliverables that the user can revisit in the profile **Artifacts** tab.
These instructions are loaded directly when this skill is active.

## Choose the output

- Use HTML for visual reports, plans, memos, landing pages, and browser games.
- For slide decks and presentations, follow the slide-deck-design skill. It holds the deck template; load it with load_skill.
- Keep the format the user requests. Use Markdown for pages only when the user or another active skill requires it.
- Keep code, logs, and structured data in their appropriate formats. Preserve existing formats when moving files or editing artifacts.

## Design the page

1. Use the existing design system when the request provides one. Otherwise, base the design on the subject, audience, and content.
2. Give editorial pages, landing pages, and games a bold treatment. Keep plans, memos, and other working documents polished and restrained.
3. Write the design plan as CSS custom properties before building the page. Define colors, font families, type sizes, spacing, borders, and radii.
4. Use those tokens throughout the page, except in SVG attributes (see **Print and PDF**). Give every color token a light and dark value, including chart colors and interaction states.
5. Support both themes through `prefers-color-scheme`. If an existing design system provides an explicit theme signal, respect it.
6. Choose typefaces deliberately. Pair fonts only when the pairing improves hierarchy, and keep a consistent type scale with readable fallback fonts.
7. Use only facts from the request or available sources. Do not add dates, durations, team sizes, customers, quotes, metrics, integrations, or feature details that were not supplied; omit them. Label supplied sample data; a "sample" label does not permit invented content.
   - Calculate totals, ratios, and deltas from the source rows with a tool that runs code, such as `bash`. Do not do arithmetic in the reply. If no tool can calculate, show the source rows and label the totals as not verified.
   - When a source metric differs from the target metric, such as impressions against a reach target, label that target as not verified. Do not calculate a variance for it.
8. Write plain, direct copy. Use meaningful headings and labels; omit filler and placeholder sections.

Avoid generic defaults: cream with terracotta accents, purple gradients, Inter for every subject, emoji, and grids of boxed items (a dashboard's stat-card row is the one exception).
Organize content with spacing, rules, and typography; show features and phases as rows divided by `--rule`, without a per-item background or border. Keep an established brand's choices when they fit the request.

## Nakama style recipes

When no other brand is supplied, use Nakama's neutral surfaces, amber accents, and clear typography.
Choose one recipe; adapt it to the subject. These names are design guides, not labels to put on the page.

| Style | Use and layout | Token overrides |
| --- | --- | --- |
| **Brief** | Plans and memos: one readable column, a clear decision, ruled action rows. Keep sections open. | Use the shared defaults. |
| **Ledger** | Reports and dashboards: aligned tabular numbers, directly labeled charts, mono values. Dashboards follow **Dashboards** below. Amber highlights the main finding; neutral tones show context. | `--width: 64rem; --title: clamp(1.75rem, 4vw, 2.5rem);` |
| **Feature** | Launch pages and explainers: a large heading beside one useful subject visual, then open sections. Stack columns on phones. | `--width: 72rem; --title: clamp(2.5rem, 7vw, 5rem);` |

Use this shared token example, then apply only the chosen overrides. Every color alias follows the active theme.
Inter is intentional for Nakama styling; use other typefaces when the subject calls for them.
Load named fonts through Google Fonts or use the fallbacks. Artifacts do not inherit app fonts or CSS.

```css
:root {
  color-scheme: light;
  --bg: #ffffff; --text: #171717; --surface: #f5f5f5;
  --muted: #52525b; --line: #e5e5e5;
  --primary: #b45309; --on-primary: #ffffff;
  --focus: var(--primary); --chart-focus: var(--primary);
  --chart-context: var(--muted);
  --sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, monospace;
  --small: .875rem; --body: 1rem; --section: 1.5rem;
  --title: clamp(2rem, 5vw, 3rem); --width: 48rem;
  --gutter: clamp(1rem, 4vw, 3rem); --gap: 2rem;
  --radius: .625rem; --rule: 1px solid var(--line);
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #0a0a0b; --text: #fafafa; --surface: #1f1f23;
    --muted: #a1a1aa; --line: #27272a;
    --primary: #f59e0b; --on-primary: #0a0a0b;
  }
}
body { margin: 0; padding-inline: var(--gutter); background: var(--bg); color: var(--text); font-family: var(--sans); }
```

Use `--on-primary` on filled primary actions. Reserve amber for meaningful emphasis and `--radius` for controls or panels. Use no shadows.
Separate sections by at least `--gap`. Give ruled rows at least `.75rem` vertical padding.

## Dashboards

Use this layout when the user asks for a dashboard, KPI page, or performance report with metrics and a chart.

1. Start from the shared tokens and the **Ledger** recipe. Add these tokens, each with a light and a dark value: `--grid` (#f0f0f0 / #1c1c1f), `--series-1` (#171717 / #fafafa), `--series-2` (#d97706 / #f59e0b), `--good` (#15803d / #4ade80), `--bad` (#c2410c / #fb923c).
2. Order the page: title, a one-line subtitle with the channels, period, and comparison source exactly as the user named them (keep a named source, such as the CRM or sheet the targets come from), one row of 3–5 stat cards (two columns on phones; never leave one card alone on a row), the main chart, then the detail table. Put each block in a panel with a 1px border, `--radius`, and no background fill, with 1rem between blocks. Panel headings are 1rem at weight 600. Use no shadows.
3. Stat card: a sentence-case label in `--muted`, a large value at weight 700 with tabular numbers, and one short delta line. Color the delta by meaning, not by sign: `--good` when the user's data shows it is better (a lower CPA is better), `--bad` when worse, `--muted` when unknown.
4. Line chart, with no chart library: a `position: relative` box about 16rem high, with room on the left for y labels and below for x labels. Inside it, put one SVG with `viewBox="0 0 100 100"`, `preserveAspectRatio="none"` and `position: absolute; inset: 0`. The SVG holds only gridlines and one `<polyline>` per series, each with `vector-effect="non-scaling-stroke"`. Never put `<text>` or `<circle>` in it: the stretch distorts them. Place tick labels, x labels, and dots as absolutely positioned HTML elements, at `left: i / (n − 1) × 100%` and `top: 100% − (v − min) / (max − min) × 100%`, labels in `--muted` at 13px. Draw 2px lines with no area fill and no point markers, except one dot on the last point of each series. Use 3–5 round y-axis ticks that cover the data (for example 200, 400, 600, 800) with 1px gridlines in `--grid`. Label the x-axis only at period starts, such as month names. Put the legend above the plot, at the left, with small square swatches.
5. Series colors: `--series-1` (ink) for the first series and `--series-2` (amber) for the second. Add more series colors as tokens with light and dark values.
6. Table: inside a `<div>` with `overflow-x: auto`, so it scrolls on phones instead of losing columns. Sentence-case headers in `--muted`, plain-text cells (no badges or pills), numeric columns right-aligned with `font-variant-numeric: tabular-nums`. Color only the change column, by meaning.
7. Do not use uppercase labels, gradients, icons, or decorative badges. When the user supplies only approximate points (for example "from ~340 to ~650"), draw a smooth progression between them and do not print the in-between values. Before you save, check the series against every trend the user named: a crossing, peak, or dip must fall in the stated period. To put a crossing at index k, keep the first series higher at every index before k and the second series higher from k on.

## HTML requirements

- Write a complete document with a doctype, language, UTF-8 charset, and viewport metadata.
- Give `<title>` a real name of two to four words, such as `Project Atlas`, rather than a summary.
- Use one main heading, semantic sections, labeled controls, visible keyboard focus, and readable contrast in both themes.
- Support phone widths, including 320px, with 16px gutters on both sides. The page must not scroll horizontally; put tables in an `overflow-x: auto` wrapper inside the gutter.
- Let grids, text, and charts adapt to the available width. Fix overflow rather than hiding clipped content.
- Draw charts to scale: compute bars and axis ticks from the same maximum, start bars at zero, and label units.
- Keep chart text at least 12px at 320px. SVG text shrinks with a scaled `viewBox`, so use HTML labels or CSS bars (`width: n%`) for simple charts.
- Every link and button must work in the page: target an existing `#id`, toggle content, or show inline feedback. Never use `href="#"`; omit actions that cannot work.
- Render all essential content on load. Do not hide it behind entrance animations or scroll effects. Respect reduced-motion preferences.
- Keep the HTML at or below 16,000,000 UTF-8 bytes, including embedded assets. A tool or server may impose a lower limit; respect that limit.

## Print and PDF

PDF export renders the HTML without a browser, on A4 paper, in the light theme, and runs no scripts. Write every page so it prints correctly.

1. In SVG attributes, write colors as hex values, such as `fill="#edf2df"`. Never write `fill="var(--surface)"` or `stroke="var(--line)"`: the PDF renderer cannot read `var()` there and draws the shape black. Use the light theme value. For dark mode, give the shape a class and set hex values in the dark media query, such as `.steam { stroke: #708772; }`.
2. Add `@page { size: A4; margin: 0; }`. Slide decks keep their own `@page` rule.
3. Make the layout work at 800px wide, the width of an A4 page. Keep nav labels and short buttons on one line with `white-space: nowrap`.
4. In `@media print`, add `break-inside: avoid` to sections, panels, figures, and table rows, so a page break does not cut them.
5. Give buttons an explicit `line-height`, such as `1.2`, so their text stays centered in the PDF.

## Resources and frame limits

Treat these as authoring requirements. Do not claim that Nakama enforces them merely because the page follows these instructions.

- Keep styles, application code, images, and other assets inside the HTML. Use inline SVG or data URLs for images.
- External scripts may use HTTPS only from `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`, `cdn.tailwindcss.com`, or `code.jquery.com`.
- External fonts may use Google Fonts stylesheets from `fonts.googleapis.com` and font files from `fonts.gstatic.com`. System fonts need no request.
- Do not load other remote resources, embed external frames, submit forms to external services, or make network requests from page code.
- Do not use `window.print()`, `alert()`, `confirm()`, `prompt()`, popups, or page-triggered downloads. Use inline feedback for interactions.
- Do not request camera or microphone access unless the runtime explicitly grants that capability for the requested task.
- Do not depend on parent-page access, host credentials, or persistent browser storage. Keep ordinary interaction state in page memory.
- Use Nakama's artifact controls for downloads and sharing. Never add secrets or credentials to an artifact.

## Workflow

1. Choose the output format.
2. For HTML, define the CSS tokens, then build the complete page. Keep the design plan in the CSS; do not create a separate planning artifact.
3. Check the source against the requirements above, including **Print and PDF**. Remove placeholder content, unsupported actions, and unapproved resource URLs before saving.
4. If browser preview is explicitly requested and available, preview once. Check phone width, both themes, and the requested interactions; fix visible problems. Never claim visual verification from a source review alone.
