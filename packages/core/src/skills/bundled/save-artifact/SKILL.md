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
7. Use real content from the request or available sources. Do not invent facts, testimonials, or results. Label necessary assumptions and sample data.
8. Write plain, direct copy. Use meaningful headings and labels; omit filler and placeholder sections.

Avoid generic defaults: cream with terracotta accents, purple gradients, Inter for every subject, emoji section markers, and rounded cards around everything.
Use spacing, alignment, rules, and typography to organize content. Keep an established brand's choices when they fit the request.

## HTML requirements

- Write a complete document with a doctype, language, UTF-8 charset, and viewport metadata.
- Give `<title>` a real name of two to four words, such as `Project Atlas`, rather than a summary.
- Use one main heading, semantic sections, labeled controls, visible keyboard focus, and readable contrast in both themes.
- Support phone widths, including 320px, with at least 16px side gutters. The page must not scroll horizontally.
- Let grids, text, tables, and charts adapt to the available width. Fix overflow rather than hiding clipped content.
- Draw charts to scale. Label units and axes, disclose truncated axes, and preserve the proportions of the underlying data.
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
