---
name: save-artifact
description: Create or save artifacts, HTML pages, reports, plans, memos, summaries, code snippets, and logs for later use.
include-body-on-match: true
---

Create complete deliverables that the user can revisit in the profile **Artifacts** tab.
These instructions are loaded directly when this skill is active. No additional instruction file is required.

## Choose the output

- Use HTML for visual reports, plans, memos, landing pages, and browser games.
- Keep the format the user requests. Use Markdown for pages only when the user or another active skill requires it.
- Keep code, logs, and structured data in their appropriate formats. Preserve existing formats when moving files or editing artifacts.
- `write_file` writes UTF-8 text. Use a suitable tool or skill for binary formats; changing an extension does not create a PDF or image.
- Save under `artifacts/`, relative to the profile workspace. Do not put soul files, memory, or knowledge-base uploads there.

## Design the page

1. Use the existing design system when the request provides one. Otherwise, base the design on the subject, audience, and content.
2. Give editorial pages, landing pages, and games a bold treatment. Keep plans, memos, and other working documents polished and restrained.
3. Write the design plan as CSS custom properties before building the page. Define colors, font families, type sizes, spacing, borders, and radii.
4. Use those tokens throughout the page. Give every color token a light and dark value, including chart colors and interaction states.
5. Support both themes through `prefers-color-scheme`. If an existing design system provides an explicit theme signal, respect it.
6. Choose typefaces deliberately. Pair fonts only when the pairing improves hierarchy, and keep a consistent type scale with readable fallback fonts.
7. Use only facts from the request or available sources. Do not add dates, deadlines, team sizes, customers, quotes, or metrics that were not supplied; omit them. Label sample data where it appears.
8. Write plain, direct copy. Use meaningful headings and labels; omit filler and placeholder sections.

Avoid generic defaults: cream with terracotta accents, purple gradients, Inter for every subject, emoji, and rows of rounded cards.
Organize content with spacing, rules, and typography; show features and phases as ruled rows or a definition list. Keep an established brand's choices when they fit the request.

## Nakama style recipes

When no other brand is supplied, use Nakama's neutral surfaces, amber accents, and clear typography.
Choose one recipe; adapt it to the subject. These names are design guides, not labels to put on the page.

| Style | Use and layout | Token overrides |
| --- | --- | --- |
| **Brief** | Plans and memos: one readable column, a clear decision, ruled action rows. Keep sections open. | Use the shared defaults. |
| **Ledger** | Reports and dashboards: aligned tabular numbers, directly labeled charts, mono values. Amber highlights the main finding; neutral tones show context. | `--width: 64rem; --title: clamp(1.75rem, 4vw, 2.5rem);` |
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
```

Use `--on-primary` on filled primary actions. Reserve amber for meaningful emphasis and `--radius` for controls or panels. Use no shadows.
Separate sections by at least `--gap`. Give ruled rows at least `.75rem` vertical padding.

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

1. Choose the output format and a short filename, such as `artifacts/project-atlas.html`. Use subdirectories when grouping related files.
2. For HTML, define the CSS tokens, then build the complete page. Keep the design plan in the CSS; do not create a separate planning artifact.
3. Check the source against the requirements above. Remove placeholder content, unsupported actions, and unapproved resource URLs before saving.
4. For a new artifact, use `write_file` to save the content. Existing names receive a date suffix automatically; use the returned path.
5. When the user requests an edit, read the existing artifact and use `edit_file` to update it. Preserve unrelated content.
6. If browser preview is explicitly requested and available, preview once. Check phone width, both themes, and the requested interactions; fix visible problems.
7. Return the saved path and state whether a browser preview ran. Never claim visual verification from a source review alone.

Saving creates an artifact, not a public publication. Share or publish only when the user requests it and a supported action is available.
Web chat shows saved artifacts as attachment chips with previews. Nakama derives the file type, size, and timestamp; do not create metadata files.
