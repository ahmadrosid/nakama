---
name: slide-deck-design
description: Use for slide decks, presentations, and pitch decks. Builds one HTML deck from a tested template with one 16:9 slide at a time on screen, speaker notes, and one slide per page in PDF.
---

Build slide decks as one HTML artifact from the tested template in this skill.
These instructions are loaded directly when this skill is active.
For decks, these rules replace the artifact-design rules: one fixed theme with no `prefers-color-scheme` block, and no Google Fonts. The theme is light unless the user asks for a dark deck.

## Template

1. Read `assets/deck.html` with read_file, using the full path from this skill's directory. It holds the frame, the cover, the numbered list, the statement, and the quote.
2. If a slide needs a pattern from `assets/patterns.html` (table below), read that file. For each pattern you use, copy its CSS to the end of the deck's `<style>` and its slide into `<main>`.
3. Keep the frame, phone, and print CSS, the nav, the notes panel, and the script as they are. Change only the `:root` tokens, the `<title>`, the `aria-label` on `<main>` (the deck name), and the slides.
4. Put each slide in `<section class="slide" aria-label="Name">`. Write the name only; the script adds `Slide n:`.
5. Do not write footers. The script adds one to each slide except the cover, with the cover's brand mark, the deck name, and the slide number.
6. Size slide text and spacing in `cqw`. Use `px` only in the phone media query.
7. Save with save_artifact as one `.html` file, for example `artifacts/q3-results-deck.html`.

## Style

1. Change the accent as one set: `--accent`, `--accent-ink` (darker, for text), `--accent-soft` (near white), `--accent-line` (light, for borders). Use the user's brand color if given; otherwise keep the amber. For a dark deck, set dark values for `--page`, `--bg`, `--ink`, `--muted`, `--subtle`, `--line`, and `--wash` in `:root`.
2. Use the accent only for the one thing to look at on a slide: the key bar, the key stat, the top rows. Labels and kickers stay grey.
3. Use flat colors only. Do not add gradients, glows, blurs, or decorative shadows, also when the user asks for a dark theme. A panel is one solid color with a thin border (`.panel`).
4. Do not decorate. No emoji, no stock "AI" icons (sparkles, rockets, lightning, robots), no pills or badges above a title, and no dots or stripes that mark nothing. Do not set labels in capitals with wide letter spacing.
5. Slide frame, in order: an optional `.kicker`, an `h1` with the point, the content with the `fill` class, and a `.source` line when the user gives a source. Statement and quote slides use `.say` in place of the `h1` and content. Add a kicker only when it gives a fact the `h1` does not, such as the section in a long deck.
6. Write the `h1` as one short claim in the user's words, at most about 10 words. Do not add a second line that restates it, such as "Three features."
7. Write the brand name in `.brand` on the cover. For a supplied logo, put it before the name as inline `<svg>` or an `<img>` data URL; the footers copy it. Without a logo, write the name only. Do not add a dot or an icon in place of a logo.
8. Give `<title>` a name of two to four words, such as `Q3 Results`.

## Patterns

Use the pattern that fits each slide. Remove the samples you do not use.

| Pattern | File | Use for |
|---|---|---|
| Cover (`.cover`) | `deck.html` | The title |
| Numbered list (`.row`) | `deck.html` | Steps, a plan, or related items, up to 4 rows |
| Statement (`.say`) | `deck.html` | One sentence, set large across the slide |
| Quote (`blockquote.say`, `cite`) | `deck.html` | A supplied quote with the speaker's name |
| Split cover (`.cover-split`) | `patterns.html` | Title beside one supplied figure or image. Replaces the cover |
| Compare (`.cols`, `.col`) | `patterns.html` | 2 or 3 columns: before and after, options, plans |
| Image + text (`.media`, `.pic`) | `patterns.html` | One supplied image beside a short text |
| Stats + chart (`.split`, `.stat`, `.chart`) | `patterns.html` | Up to 3 stats beside a bar chart of one series |
| People (`.people`, `.av`) | `patterns.html` | Up to 16 people with one short line each |
| Leaderboard (`.lb`, `.lb-row`) | `patterns.html` | Up to 10 ranked rows |
| Gallery (`.gallery`, `.shot`) | `patterns.html` | Three supplied screenshots with captions |

1. Bars: set each `<i>` height inline to value / max × 84%. Add `on` to the key bar. Write a value as text only on the first bar and the key bar.
2. Leaderboard: set each `<i>` width to value / max × 100%. Add `on` to the top 3 rows.
3. Avatars: `<img class="av" src="data:..." alt="">` for a supplied photo, else `<span class="av">` with initials.
4. Images: use only supplied images, as data URLs. With no image, do not use the split cover, image + text, or gallery.
5. Vary the layouts. Use `.say` only for a point that is one sentence; put short related items in a list or compare slide.

## Content

1. Start with a cover. Add an agenda, summary, or closing slide only when the user asks.
2. One idea per slide, about 25 words, at most 4 rows. Put related short items on one list slide; give an item with its own numbers or detail its own slide. Show each fact on one slide only. Do not split or repeat facts to reach a slide count; make fewer slides and say so.
3. Use only the user's words and facts. Replace all sample text, names, and numbers. Do not add steps, dates, causes, metrics, or results.
4. Speaker notes: `<aside class="notes">` with `<p>` paragraphs at the end of a slide. Put supplied detail that does not fit there. Add `<p class="q"><b>Q:</b> …</p>` only for a supplied question and answer. When there is no extra detail, leave the notes out.
5. Numbers: add a `.source` line only when the user gives a source; do not write a source the user did not give. For a requested number with no data, write `Not measured` (`<span class="big none">` in stats).
6. Show a change as a direct label computed from the supplied values, such as `+25%` or `−0.8 pts`. Compute changes, bar heights, and widths with `bash` when available; otherwise label the change as not verified.
7. Write relative dates as the user wrote them. For a requested slide with no content, show its title and one `To add:` line, and name the gap in your reply.
8. Content must fit. Split slides or cut words; do not make text smaller than the template.

## Resources

1. The deck works offline: keep styles, scripts, fonts, and images in the HTML. Do not link a CDN, font, or other URL.
2. For a brand font, embed it with `@font-face` and `src: url(data:font/woff2;base64,...)`, and put its family first in `--sans` or `--mono`. Embed only the weights used.
3. Do not use `window.print()`, `alert()`, popups, network requests, or browser storage. Users get the PDF from Nakama's artifact controls.
4. If a browser preview is requested and available, step through every slide once and fix overflow. Do not claim visual checks from reading the source.

## Before you save

Answer yes to each, or fix the deck:

1. Does every name, number, quote, and image come from the user?
2. Does each slide have at most one accent, on the thing to look at?
3. Is the deck free of gradients, glows, shadows, emoji, and decorative icons, dots, and badges?
4. Does every kicker add a fact the `h1` does not, and is the `h1` free of filler lines?
5. Do the layouts change from slide to slide where the content allows?
