---
name: artifact-design
description: Design artifacts, HTML pages, dashboards, charts, slides, a slide deck or decks, a presentation or presentations, reports, plans, memos, summaries, code snippets, and logs.
include-body-on-match: true
---

Design complete deliverables that the user can revisit in the profile **Artifacts** tab.
These instructions are loaded directly when this skill is active. Read `dashboard-example.html` from this skill's directory only when you build a dashboard.

## Choose the output

- Use HTML for visual reports, plans, memos, slide decks, landing pages, and browser games.
- Keep the format the user requests. Use Markdown for pages only when the user or another active skill requires it.
- Keep code, logs, and structured data in their appropriate formats. Preserve existing formats when moving files or editing artifacts.

## Design the page

1. Use the existing design system when the request provides one. Otherwise, base the design on the subject, audience, and content.
2. Give editorial pages, landing pages, and games a bold treatment. Keep plans, memos, and other working documents polished and restrained.
3. Write the design plan as CSS custom properties before building the page. Define colors, font families, type sizes, spacing, borders, and radii.
4. Use those tokens throughout the page. Give every color token a light and dark value, including chart colors and interaction states.
5. Support both themes through `prefers-color-scheme`. If an existing design system provides an explicit theme signal, respect it.
6. Choose typefaces deliberately. Pair fonts only when the pairing improves hierarchy, and keep a consistent type scale with readable fallback fonts.
7. Use only facts from the request or available sources. Do not add dates, durations, team sizes, customers, quotes, metrics, integrations, or feature details that were not supplied; omit them. Label supplied sample data; a "sample" label does not permit invented content.
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
| **Deck** | Slide decks and presentations: one 16:9 slide at a time. Follow **Slide decks** below. | Use the shared defaults; size slide text in `cqw`. |

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

1. Read `dashboard-example.html` from this skill's directory before you write the page. Copy its `<head>` and `<script>` exactly; they replace the shared token example and the **Ledger** recipe. In the script, change only the `series`, `yTicks`, and `xLabels` values; the drawing code sets all chart styles. In the body, change only the text, the stat cards, and the table rows. Replace every sample label and number with the user's data; sample content must never appear in the artifact.
2. Order the page: title, a one-line subtitle with the channels, period, and comparison source exactly as the user named them (keep a named source, such as the CRM or sheet the targets come from), one row of 3–5 stat cards (two columns on phones; never leave one card alone on a row), the main chart, then the detail table. Put each block in a panel with a 1px border, `--radius`, and no background fill. Use no shadows.
3. Stat card: a sentence-case label in `--muted`, a large value with tabular numbers, and one short delta line. Color the delta by meaning, not by sign: `--good` when the user's data shows it is better (a lower CPA is better), `--bad` when worse, `--muted` when unknown.
4. Line chart: inline SVG with HTML labels, as in the example. Do not load a chart library. Draw 2px lines with no area fill and no point markers, except one dot on the last point of each series. Use 3–5 round y-axis ticks that cover the data (for example 200, 400, 600, 800) with light gridlines. Label the x-axis only at period starts, such as month names. Put the legend above the plot, at the left, with small square swatches.
5. Series colors: `--series-1` (ink) for the first series and `--series-2` (amber) for the second. Add more series colors as tokens with light and dark values.
6. Table: sentence-case headers in `--muted`, plain-text cells (no badges or pills), numeric columns right-aligned with `font-variant-numeric: tabular-nums`. Color only the change column, by meaning.
7. Do not use uppercase labels, gradients, icons, or decorative badges. When the user supplies only approximate points (for example "from ~340 to ~650"), draw a smooth progression between them and do not print the in-between values. Before you save, check the series against every trend the user named: a crossing, peak, or dip must fall in the stated period. To put a crossing at index k, keep the first series higher at every index before k and the second series higher from k on.

## Slide decks

1. Put each slide in a `<section>` with `aspect-ratio: 16 / 9` and `container-type: size`. Fit the frame to the viewport and size slide text in `cqw`, so every slide keeps the same shape and scale at any width.
2. Show one slide at a time. Add previous and next buttons, Left/Right and Home/End keys, and an `n / N` counter. Keep every slide in the DOM.
3. Print one slide per page: show all slides in `@media print`, use `@page { size: 16in 9in; margin: 0; }`, and `break-after: page`.
4. Keep one idea per slide: a title near `5cqw`, body text at least `2.4cqw`, and at most four one-line points. Do not let content overflow the frame.
5. Use the full slide width. Pad the slide by about `6cqw` on each side. Put a metric and its chart side by side in a two-column grid, or let a single block span the full width. Do not leave more than a third of the slide empty. When a slide holds only one sentence, set it as the slide's main text at about `6cqw`, not as a small line under a title.
6. Show a metric as a large number with its change as a direct label, computed from the supplied values, such as `+25%` for 1.2M to 1.5M or `−0.8 pts` for 4% to 3.2%. Do not repeat the number in a sentence below it. When the user supplies a before and after value, put the metric beside a CSS bar chart of both values. Add a CSS bar chart only to compare supplied values. Set each bar height in an inline style as value / max × 100%, for example `style="height: 80%"` for 1.2 when the max is 1.5. Put each bar alone in a track with a fixed height, such as `.track { height: 18cqw; display: flex; align-items: flex-end; }`, and put the value and period labels outside the track, so the labels never shrink a bar or overlap other text.
7. Use a title slide. Do not add an agenda, summary, closing, or thank-you slide unless the user asks for one.
8. Give each supplied fact or topic its own slide, and show each fact on one slide only. When the facts fill fewer slides than the user asked for, make fewer slides and say so in your reply; do not split or repeat a fact to reach the count.
9. Use only the words and facts the user supplied. When an item has no detail, such as "we shipped the new onboarding flow", give it only that sentence, set large as in rule 5. Do not add steps, features, dates, timelines, causes, or results.
10. Write relative dates as the user wrote them, such as "Friday". Do not turn them into calendar dates.
11. When the user requests a slide but supplies no content for it, do not fill it with invented items. Show its title, any supplied facts, and one `To add:` line that names what is missing. This is the only placeholder allowed. Name these gaps in your reply.

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
3. Check the source against the requirements above. Remove placeholder content, unsupported actions, and unapproved resource URLs before saving.
4. If browser preview is explicitly requested and available, preview once. Check phone width, both themes, and the requested interactions; fix visible problems. Never claim visual verification from a source review alone.
