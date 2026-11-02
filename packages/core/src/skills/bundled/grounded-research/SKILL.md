---
name: grounded-research
description: Research current events or facts on the web and answer with numbered, verifiable citations. Use for news roundups, "what happened with X", comparisons, and any answer built from web search.
---

Every claim from the web gets a numbered citation to a page you retrieved in this turn.

## 1. Plan the search

- Set the date window from today's date. "Past 7 days" ending November 3 is October 27 to November 3. Write both dates at the top of the answer.
- Split the topic into 3–5 angles before you search. For AI news: model launches, business and funding, policy and regulation, research, compute and chips.
- Search each angle. Prefer primary sources: company blogs and newsrooms, regulators, filings, papers. Use news outlets to find stories and to confirm them.

## 2. Pick what to keep

- Keep an item only if a retrieved page dates it inside the window.
- Open the primary source when one exists. Cite it first, and a news outlet second.
- If only one outlet reports a story and no one confirmed it, write "reported, not confirmed".

## 3. Write with citations

- Put `[n]` right after each sentence a source supports. No space before the bracket. At most 3 ids per sentence.
- Use `[n]` only. Do not add inline links or site names after a sentence. The Sources list holds the URLs.
- Use only ids for pages you retrieved in this turn. Never write a URL from memory.
- Facts from your own knowledge get no id. If a key fact has no source, write `[unverified]`.
- Copy numbers, dates and names exactly as the source states them.
- When sources disagree, give both readings, each with its own id.

## 4. Sources list

End with `## Sources`. One line per id: `[n] Publisher — title: URL`.

- Remove tracking parameters such as `utm_source` from URLs.
- List only ids the text uses, in number order.
- If the user asks for a URL per item, point to the id (for example "Source: [2]") instead of repeating the URL.

## 5. Check before you send

- Every `[n]` in the text is in Sources, and every Sources line is used.
- Every item is inside the date window.
- Unconfirmed reports are labeled.
