---
name: slide-deck-design
description: Use for slide decks, presentations, and pitch decks. Builds one HTML deck from a tested template with one 16:9 slide at a time on screen, speaker notes, and one slide per page in PDF.
---

Build slide decks as one HTML artifact from the tested template in this skill.
For decks, these rules replace the artifact-design rules: one fixed theme with no `prefers-color-scheme` block, and no Google Fonts. The theme is light unless the user asks for a dark deck.

## Template

1. Read `assets/deck.html` with read_file, using the full path from this skill's directory. It holds the frame, cover, numbered list, statement, and quote.
2. For a pattern in the table below, read only its file in `assets/patterns/`. Copy its CSS to the end of the deck's `<style>` and its slide into `<main>`.
3. Keep the frame, phone, and print CSS, the nav, the notes panel, and the script as they are. Change only the `:root` tokens, the `<title>`, the `aria-label` on `<main>` (the deck name), and the slides.
4. Put each slide in `<section class="slide" aria-label="Name">`. The script adds `Slide n:` and a footer on each slide except the cover. Do not write footers.
5. Size slide text and spacing in `cqw`; use `px` only in the phone media query.
6. Save with save_artifact as one `.html` file, such as `artifacts/q3-results-deck.html`.

## Style

1. Change the accent as one set: `--accent`, `--accent-ink` (darker, for text), `--accent-soft` (near white), `--accent-line` (light, for borders). Use the user's brand color, else keep the amber. For a dark deck, also set dark `--page`, `--bg`, `--ink`, `--muted`, `--subtle`, `--line`, and `--wash`.
2. Put the accent only on the one thing to look at on a slide, such as the key bar or key stat. Labels stay grey.
3. Use flat colors only, also on a dark deck: no gradients, glows, blurs, or decorative shadows. A panel is one solid color with a thin border (`.panel`).
4. Do not decorate: no emoji, no stock "AI" icons (sparkles, rockets, lightning, robots), no badges above a title, no dots or stripes that mark nothing, and no labels in wide-spaced capitals.
5. Slide order: an optional `.kicker`, an `h1`, the content with the `fill` class, and a `.source` line when the user gives a source. Statement and quote slides use `.say` in place of the `h1` and content. Add a kicker only when it gives a fact the `h1` does not.
6. Write the `h1` as one short claim in the user's words, about 10 words at most, with no second line that restates it ("Three features.").
7. Write the brand name in `.brand` on the cover. Put a supplied logo before it as inline `<svg>` or an `<img>` data URL; the footers copy it. Without a logo, use the name only, with no dot or icon.
8. Give `<title>` a name of two to four words, such as `Q3 Results`.

## Patterns

In `deck.html`: cover (`.cover`), numbered list (`.row`, up to 4 rows), statement (`.say`, one sentence set large), quote (`blockquote.say` with `cite`).

| File in `assets/patterns/` | Classes | Use for |
|---|---|---|
| `split-cover.html` | `.cover-split`, `.hero` | Title beside one supplied figure or image, in place of the cover |
| `compare.html` | `.cols`, `.col` | 2 or 3 columns: before and after, options, plans |
| `image-text.html` | `.media`, `.pic` | One supplied image beside a short text |
| `stats-chart.html` | `.split`, `.stat`, `.chart` | Up to 3 stats beside a bar chart of one series |
| `people.html` | `.people`, `.av` | Up to 16 people with one short line each |
| `leaderboard.html` | `.lb`, `.lb-row` | Up to 10 ranked rows |
| `gallery.html` | `.gallery`, `.shot` | Three supplied screenshots with captions |

1. Bars: set each `<i>` height inline to value / max × 84%. Add `on` to the key bar. Write a value only on the first bar and the key bar.
2. Leaderboard: set each `<i>` width to value / max × 100%. Add `on` to the top 3 rows.
3. Avatars: `<img class="av" src="data:..." alt="">` for a supplied photo, else `<span class="av">` with initials.
4. Use only supplied images, as data URLs. Without one, skip the split cover, image + text, and gallery.
5. Vary the layouts. Use `.say` only for a one-sentence point; put short related items in a list or compare slide.

## Content

1. Start with a cover. Add an agenda, summary, or closing slide only when asked.
2. One idea per slide, about 25 words, at most 4 rows. Group related short items on one list slide; give an item with its own numbers its own slide. Show each fact once. Do not split or repeat facts to reach a slide count; make fewer slides and say so.
3. Use only the user's words and facts. Replace all sample text, names, and numbers. Do not add steps, dates, causes, metrics, or results.
4. Speaker notes: `<aside class="notes">` with `<p>` paragraphs at the end of a slide, for supplied detail that does not fit. Add `<p class="q"><b>Q:</b> …</p>` only for a supplied question and answer. With no extra detail, leave notes out.
5. Add a `.source` line only for a source the user gave. For a requested number with no data, write `Not measured` (`<span class="big none">` in stats).
6. Show a change as a label computed from the supplied values, such as `+25%` or `−0.8 pts`. Compute changes, bar heights, and widths with `bash` when available; otherwise mark the change as not verified.
7. Write relative dates as the user wrote them. For a requested slide with no content, show its title and one `To add:` line, and name the gap in your reply.
8. Content must fit: split slides or cut words, never make text smaller than the template.

## Resources

1. The deck works offline: keep styles, scripts, fonts, and images in the HTML, with no CDN, font, or other URL. Embed a brand font with `@font-face` and a `data:font/woff2;base64,...` URL, first in `--sans` or `--mono`, only the weights used.
2. Do not use `window.print()`, `alert()`, popups, network requests, or browser storage. Users get the PDF from Nakama's artifact controls.
3. If a browser preview is requested and available, step through every slide once and fix overflow. Do not claim visual checks from reading the source.

Before you save, check every slide against Style and Content, and fix what fails.
