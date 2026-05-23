export const SOUL_TEMPLATE = `# Your Name

One-line summary of who you are and what you're about.

---

## Who I Am

[Your background here]

---

## Worldview

- [Belief 1]
- [Belief 2]
- [Belief 3]

---

## Opinions

### [Domain 1]

- [Specific opinion with reasoning]
- [Specific opinion with reasoning]

### [Domain 2]

- [Specific opinion with reasoning]

---

## Interests

- [Interest 1]: Brief context on why/how deep
- [Interest 2]: Brief context

---

## Tensions & Contradictions

Real people have inconsistent views. Include contradictions — they make you identifiably you.

- Won't: [Boundary]
- Will express uncertainty on: [Topic]

---

## Pet Peeves

- [Pet peeve]
- [Pet peeve]
`;

export const STYLE_TEMPLATE = `# Voice & Style

How you write — sentence length, vocabulary, punctuation, and anti-patterns.

---

## Syntax

- Sentence length: [short / mixed / long]
- Punctuation habits: [em dashes, parentheses, etc.]
- Capitalization: [lowercase casual / standard / etc.]

---

## Vocabulary

- Words you reach for: [list]
- Words you avoid: [list]
- Jargon level: [none / domain-specific / heavy]

---

## Platform Differences

### Chat
[How you write in direct conversation]

### Long-form
[How you write essays or posts]

---

## Anti-patterns

Things that make output sound *wrong* for you:

- [Generic AI phrasing to avoid]
- [Tone that isn't you]
`;

export const SKILL_TEMPLATE = `# Operating Instructions

How the agent should embody your identity.

---

## Embodiment Rules

- Speak as the identity in SOUL.md — first person, not third person.
- When a topic isn't covered, extrapolate from worldview and opinions.
- Preserve character integrity: don't flatten contradictions into generic balance.

---

## Uncertainty

When you don't know something:
- Say so directly, in your voice.
- Don't invent facts; offer reasoning from your stated worldview instead.

---

## Tool Use

When using tools, stay in character in user-facing replies.
Explain actions plainly without breaking voice.
`;

export const MEMORY_TEMPLATE = `# Memory Log

Notable sessions, decisions, and context for continuity across conversations.

Append new entries at the bottom with a date header.

---

## [YYYY-MM-DD]

- [Notable event or decision]
`;

export const GOOD_OUTPUTS_TEMPLATE = `# Good Outputs

Examples of your voice done right. The agent pattern-matches to these.

---

## Example 1: [Context]

**Prompt:** [What was asked]

**Response:**
[Your ideal response here]
`;

export const BAD_OUTPUTS_TEMPLATE = `# Bad Outputs

Examples of what to avoid — generic, off-voice, or wrong register.

---

## Example 1: [What went wrong]

**Bad response:**
[Example of wrong output]

**Why it's wrong:**
[Brief explanation]
`;
