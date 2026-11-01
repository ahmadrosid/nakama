---
name: slide-deck-design
description: Use for slide decks, presentations, and pitch decks. Builds one HTML deck from a tested template with one 16:9 slide at a time on screen and one slide per page in PDF.
---

Build slide decks as one HTML artifact from the tested template in this skill.
These instructions are loaded directly when this skill is active.

## Start from the template

1. Read `assets/deck.html` in this skill's directory with read_file. Build the full path from the skill directory.
2. Keep the frame CSS, the print CSS, and the navigation script exactly as they are. They show one 16:9 slide at a time on screen, Prev/Next buttons, arrow keys, an `n / N` counter, and one slide per page in print and PDF.
3. Change only the tokens in `:root` (both the light and the dark block), the `<title>`, the font link, and the slides.
4. Put each slide in `<section class="slide" aria-label="Slide n">` with a `<div class="frame">` inside. Put all slide content in the frame. The frame holds the padding, so text sized in `cqw` scales with the slide.
5. Size slide text and spacing in `cqw` only. Do not use `px`, `rem`, or `vw` inside a slide.
6. Save the deck with save_artifact as one `.html` file, for example `artifacts/q3-results-deck.html`.

## Design the slides

1. Choose tokens for the subject and audience. Use an existing brand when the request supplies one. Otherwise, the template's neutral colors with an amber accent are the Nakama default.
2. Give `<title>` a real name of two to four words, such as `Q3 Results`.
3. Keep one idea per slide: a title (`h1` on the title slide, `h2` after), body text at least `2.4cqw`, and at most four one-line points.
4. Use the template's slide types: title, points, metric with bars (`.split`, `.metric`, `.bars`), and statement (`.big`). Remove the types you do not use.
5. Use the full slide. Do not leave more than a third of it empty. When a slide holds only one sentence, set it with `.big`, not as a small line under a title.
6. Show a metric as a large number with its change as a direct label, computed from the supplied values, such as `+25%` for 1.2M to 1.5M or `−0.8 pts` for 4% to 3.2%. Do not repeat the number in a sentence below it.
7. Add bars only to compare supplied values. Set each `.fill` height inline as value / max × 100%, for example `style="height: 80%"` for 1.2 when the max is 1.5.
8. Draw icons and diagrams as inline SVG inside the frame, with colors from the tokens.
9. Content must fit in the frame. If it does not, split it across slides or cut words; never shrink text below the sizes above.

## Use only supplied content

1. Use a title slide. Do not add an agenda, summary, closing, or thank-you slide unless the user asks for one.
2. Give each supplied fact or topic its own slide, and show each fact on one slide only. When the facts fill fewer slides than the user asked for, make fewer slides and say so in your reply. Do not split or repeat a fact to reach the count.
3. Use only the words and facts the user supplied. Replace or remove all template sample text and numbers, such as "First point", "1.5M", and "+25%"; none may stay in the saved deck. When an item has no detail, give it only that sentence, set with `.big`. Do not add steps, features, dates, timelines, causes, metrics, or results.
4. Write relative dates as the user wrote them, such as "Friday".
5. When the user requests a slide but supplies no content for it, show its title, any supplied facts, and one `To add:` line that names what is missing. This is the only placeholder allowed. Name these gaps in your reply.
6. Calculate changes and ratios with a tool that runs code, such as `bash`, when one is available. Otherwise, show the source values and label the change as not verified.

## Resources

- Keep styles, scripts, and images inside the HTML. Use inline SVG or data URLs for images.
- Load fonts only from Google Fonts. Load scripts only from `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`, `cdn.tailwindcss.com`, or `code.jquery.com`.
- Do not use `window.print()`, `alert()`, popups, network requests, or browser storage. Users download the PDF with Nakama's artifact controls.

## Workflow

1. Read the template.
2. Plan the slides from the supplied content: one fact or topic per slide.
3. Set the tokens, then write the slides into the template.
4. Check every slide against the rules above, then save.
5. If a browser preview is explicitly requested and available, preview once, step through every slide, and fix overflow. Never claim visual verification from a source review alone.
