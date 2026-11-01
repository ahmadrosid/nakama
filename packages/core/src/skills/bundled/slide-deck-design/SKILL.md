---
name: slide-deck-design
description: Use for slide decks, presentations, and pitch decks. Builds one HTML deck from a tested template with one 16:9 slide at a time on screen, speaker notes, and one slide per page in PDF.
---

Build slide decks as one HTML artifact from the tested template in this skill.
These instructions are loaded directly when this skill is active.
For decks, these rules replace the artifact-design rules: use the light theme only, with no dark-mode block, and do not link Google Fonts.

## Start from the template

1. Read `assets/deck.html` in this skill's directory with read_file. Build the full path from the skill directory. It holds the frame, two cover layouts, the numbered list, and the statement slide.
2. When a slide needs stats with a chart, people, a leaderboard, or screenshots, also read `assets/patterns.html`. For each pattern you use, copy its CSS to the end of the deck's `<style>` and its slide into `<main>`.
3. Keep the frame CSS, the print CSS, the phone CSS, the nav, the notes panel, and the script exactly as they are. They show one 16:9 slide at a time, move with the arrow keys, Space, Page Up/Down, Home, and End, open a slide from a `#n` hash, toggle speaker notes with **N**, and print one slide per page.
4. Change only the tokens in `:root`, the `<title>`, the `aria-label` on `<main>`, and the slides.
5. Put each slide in `<section class="slide" aria-label="Slide n: Name">`.
6. Size slide text and spacing in `cqw` only. Do not use `px`, `rem`, or `vw` inside a slide, except in the phone media query.
7. Save the deck with save_artifact as one `.html` file, for example `artifacts/q3-results-deck.html`.

## Style

1. Keep the light theme. Change the accent as one set: `--accent`, `--accent-ink` (a darker shade for text), `--accent-soft` (a near-white tint), and `--accent-line` (a light tint for borders). Use the user's brand color when the request supplies one. Otherwise keep the template's amber.
2. Use the accent only for the one thing to look at: the kicker, the key bar, the key stat, the top 3 rows. Everything else is ink, muted, or subtle.
3. Every slide except the cover has the same frame, in this order:
   - a `.kicker`: a short mono label, such as `Growth · Last 14 days`
   - an `h1` on two lines: the point in ink, then `<br><span>` with a second line in grey. Each line is short, usually two to five words. A statement slide has `.say` in place of the `h1` and the content
   - the content, with the `fill` class so it sits at the bottom of the slide
   - a `.source` line under the content when the slide shows numbers
   - a `.foot` with the brand mark, the deck name, and the slide number as two digits (`02`)
4. Put the brand in `.brand` on the cover and in `.mark` in each footer. When the user supplies a logo, replace the `<i>` dot with it as inline `<svg>` or an `<img>` with a data URL. Otherwise keep the dot and write the brand or deck name.
5. Give `<title>` a real name of two to four words, such as `Q3 Results`.

## Slide patterns

Use these patterns. Remove the ones you do not use, and do not invent new layouts when one of these fits.

| Pattern | File | Classes | Use for |
|---|---|---|---|
| Title cover | `deck.html` | `.cover-title` | A large title on the full slide. Add `visual` for a gradient background |
| Split cover | `deck.html` | `.cover`, `.cover-grid`, `.visual.hero` | Title beside a panel that shows one supplied figure or image |
| Numbered list | `deck.html` | `.row`, `.n` | Steps, a plan, or a roadmap, up to 4 rows |
| Statement | `deck.html` | `.say` | One sentence, set large |
| Stats + chart | `patterns.html` | `.split`, `.stat`, `.chart`, `.bar` | Up to 3 stats beside a bar chart of one series |
| People | `patterns.html` | `.people`, `.person`, `.av` | Up to 16 people with one short line each |
| Leaderboard | `patterns.html` | `.lb`, `.lb-row`, `.av` | Up to 10 ranked rows in two columns |
| Gallery | `patterns.html` | `.gallery`, `.shot`, `figcaption` | Three screenshots, each with a caption |

1. Bars: set each bar's `<i>` height inline as value / max × 84%, for example `style="height: 42%"` for 50 when the max is 100. Add `on` to the one key bar. Write a value as text before `<i>` only for the first bar and the key bar. Put one label per bar in `.bar-labels`; leave some empty when they crowd.
2. Leaderboard: set each bar's `<i>` width inline as value / max × 100%. Add `on` to the top 3 rows. Rank numbers have two digits (`01`).
3. Avatars: use `<img class="av" src="data:..." alt="">` when the user supplies a photo. Otherwise use `<span class="av">` with initials.
4. Gallery: replace each sample SVG with the user's screenshot as `<img src="data:..." alt="What it shows">`. When there are no screenshots, do not use the gallery.
5. Cover: choose the layout that fits the deck. The split cover is not the default. Use it only when the panel shows something the user supplied, such as a before and after value or a product image. Otherwise use the title cover, plain or with `visual`. Do not invent a diagram or figure to fill the panel. Keep the cover `h1` to 3 short lines or fewer.

## Content rules

1. One idea per slide. Keep each slide to about 25 words, not counting the kicker, the source, and the footer.
2. At most 4 bullets or rows per slide. When there are more, split them across slides.
3. Put details, context, and likely questions in the speaker notes: `<aside class="notes">` at the end of each slide, with `<p>` paragraphs. Mark a question with `<p class="q"><b>Q:</b> …</p>`. Notes do not show on the slide or in the PDF.
4. Give every number a source: add a `.source` line that says where the number comes from and the date. When a number has no data, write `Not measured` with `<span class="big none">` (stats pattern) or in the text. Do not guess or leave the stat out silently.
5. Show a change as a direct label computed from the supplied values, such as `+25%` for 1.2M to 1.5M or `−0.8 pts` for 4% to 3.2%. Do not repeat the number in a sentence below it.
6. Content must fit the slide. If it does not, split it across slides or cut words. Do not set text smaller than the template does.

## Use only supplied content

1. Use a cover slide. Do not add an agenda, summary, closing, or thank-you slide unless the user asks for one.
2. Give each supplied fact or topic its own slide, and show each fact on one slide only. When the facts fill fewer slides than the user asked for, make fewer slides and say so in your reply. Do not split or repeat a fact to reach the count.
3. Use only the words and facts the user supplied. Replace or remove all template sample text, names, initials, and numbers, such as "Name One", "1.5M", and "+25%"; none may stay in the saved deck. When an item has no detail, give it only that sentence, set with `.say`. Do not add steps, features, dates, timelines, causes, metrics, or results.
4. Write relative dates as the user wrote them, such as "Friday".
5. When the user requests a slide but supplies no content for it, show its title, any supplied facts, and one `To add:` line that names what is missing. This is the only placeholder allowed. Name these gaps in your reply.
6. Calculate changes, ratios, bar heights, and bar widths with a tool that runs code, such as `bash`, when one is available. Otherwise, show the source values and label the change as not verified.

## Resources

- The deck must work offline. Keep styles, scripts, fonts, and images inside the HTML. Do not link a CDN, Google Fonts, or any other URL.
- Use inline SVG or data URLs for images and logos.
- Fonts: keep the template's system font stacks in `--sans` and `--mono`. To use a brand font, embed it: add an `@font-face` rule with `src: url(data:font/woff2;base64,...) format("woff2")` and put its family name first in `--sans` or `--mono`. Embed only the weights the deck uses. Do not link a font file.
- Do not use `window.print()`, `alert()`, popups, network requests, or browser storage. Users download the PDF with Nakama's artifact controls.

## Workflow

1. Read the template.
2. Plan the slides from the supplied content: one fact or topic per slide, and a pattern for each. Read `assets/patterns.html` if a slide needs one of its patterns.
3. Set the tokens, then write the slides and their notes into the template.
4. Check every slide against the rules above, then save.
5. If a browser preview is explicitly requested and available, preview once, step through every slide, and fix overflow. Never claim visual verification from a source review alone.
