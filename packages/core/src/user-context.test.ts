import { expect, test } from "bun:test";
import {
  buildUserContextStatus,
  normalizeUserContextContent,
  parseUserContext,
  renderUserContext,
  USER_CONTEXT_FIELDS,
  USER_CONTEXT_TEMPLATE,
} from "./user-context";

test("normalizeUserContextContent returns undefined when empty", () => {
  expect(normalizeUserContextContent(undefined)).toBeUndefined();
  expect(normalizeUserContextContent(null)).toBeUndefined();
  expect(normalizeUserContextContent("   \n")).toBeUndefined();
});

test("normalizeUserContextContent returns trimmed content", () => {
  expect(normalizeUserContextContent("  # About Me\n\nHello\n  ")).toBe(
    "# About Me\n\nHello"
  );
});

test("buildUserContextStatus omits content by default", () => {
  expect(buildUserContextStatus("# About Me", false)).toEqual({
    active: true,
  });
});

test("USER_CONTEXT_TEMPLATE is the field labels as empty bullets", () => {
  expect(USER_CONTEXT_TEMPLATE).toBe(
    `# About Me

- Name / nickname:
- What you do:
- Current projects:
- Tech stack:
- How you like replies (concise, detailed, casual, formal):
- Always:
- Never:
`
  );
});

test("renderUserContext returns nothing when every answer is blank", () => {
  expect(renderUserContext({})).toBe("");
  expect(renderUserContext({ name: "", role: "   " })).toBe("");
});

test("renderUserContext leaves blank answers out of the file", () => {
  expect(renderUserContext({ name: "Alex", never: "Guess at prices" })).toBe(
    `# About Me

- Name / nickname: Alex
- Never: Guess at prices
`
  );
});

test("renderUserContext keeps extra notes below the bullets", () => {
  expect(
    renderUserContext({ name: "Alex" }, "I am on call every other week.")
  ).toBe(
    `# About Me

- Name / nickname: Alex

I am on call every other week.
`
  );
});

test("renderUserContext keeps extra notes even with no answers", () => {
  expect(renderUserContext({}, "Just some notes.")).toBe(
    `# About Me

Just some notes.
`
  );
});

test("parseUserContext reads the template back as blank answers", () => {
  const parsed = parseUserContext(USER_CONTEXT_TEMPLATE);
  expect(parsed.extra).toBe("");
  for (const field of USER_CONTEXT_FIELDS) {
    expect(parsed.answers[field.key]).toBe("");
  }
});

test("parseUserContext keeps unknown lines as extra", () => {
  const parsed = parseUserContext(`# About Me

- What you do: Backend engineer

## Notes

Ships on Fridays.
`);
  expect(parsed.answers.role).toBe("Backend engineer");
  expect(parsed.extra).toBe("## Notes\n\nShips on Fridays.");
});

test("parse and render round-trip hand-written extra content", () => {
  const original = `# About Me

- Name / nickname: Alex
- Tech stack: Go, Postgres

## Notes

Ships on Fridays.
`;
  const parsed = parseUserContext(original);
  expect(renderUserContext(parsed.answers, parsed.extra)).toBe(original);
});

test("parse and render round-trip a trailing space in an answer", () => {
  const parsed = parseUserContext("# About Me\n\n- Name / nickname: Alex \n");
  expect(parsed.answers.name).toBe("Alex ");
  expect(renderUserContext(parsed.answers, parsed.extra)).toBe(
    "# About Me\n\n- Name / nickname: Alex \n"
  );
});

test("parseUserContext keeps a repeated bullet instead of overwriting it", () => {
  const parsed = parseUserContext(`# About Me

- Always: Answer in English
- Always: Use metric units
`);
  expect(parsed.answers.always).toBe("Answer in English");
  expect(parsed.extra).toBe("- Always: Use metric units");

  const rendered = renderUserContext(parsed.answers, parsed.extra);
  expect(rendered).toBe(`# About Me

- Always: Answer in English

- Always: Use metric units
`);

  // The moved line stays put from here on, so saving twice loses nothing.
  const reparsed = parseUserContext(rendered);
  expect(renderUserContext(reparsed.answers, reparsed.extra)).toBe(rendered);
});

test("parseUserContext tolerates missing content", () => {
  expect(parseUserContext(null)).toEqual({ answers: {}, extra: "" });
  expect(parseUserContext(undefined)).toEqual({ answers: {}, extra: "" });
});
