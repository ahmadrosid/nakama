export interface UserContextField {
  /** Stable id used by form state. Never written to USER.md. */
  key: string;
  /** Bullet text in USER.md. Changing it changes the file format. */
  label: string;
  placeholder: string;
}

/** The questions USER.md asks, in file order. */
export const USER_CONTEXT_FIELDS: readonly UserContextField[] = [
  {
    key: "name",
    label: "Name / nickname",
    placeholder: "Alex",
  },
  {
    key: "role",
    label: "What you do",
    placeholder: "Backend engineer on a payments team",
  },
  {
    key: "projects",
    label: "Current projects",
    placeholder: "Moving the billing API off the monolith",
  },
  {
    key: "stack",
    label: "Tech stack",
    placeholder: "Go, Postgres, Kubernetes",
  },
  {
    key: "replies",
    label: "How you like replies (concise, detailed, casual, formal)",
    placeholder: "Concise, code first, skip the preamble",
  },
  {
    key: "always",
    label: "Always",
    placeholder: "Answer in English",
  },
  {
    key: "never",
    label: "Never",
    placeholder: "Recommend a paid service without saying it is paid",
  },
];

const USER_CONTEXT_HEADING = "# About Me";

export const USER_CONTEXT_TEMPLATE = `${USER_CONTEXT_HEADING}

${USER_CONTEXT_FIELDS.map((field) => `- ${field.label}:`).join("\n")}
`;

export type UserContextAnswers = Record<string, string>;

export interface ParsedUserContext {
  answers: UserContextAnswers;
  /** Everything that is not one of the known bullets, kept verbatim. */
  extra: string;
}

function bulletPrefix(field: UserContextField): string {
  return `- ${field.label}:`;
}

/**
 * Split USER.md into the known answers plus whatever else the user wrote.
 * Round-trips with renderUserContext so a guided form can edit the same string.
 */
export function parseUserContext(
  content: string | null | undefined
): ParsedUserContext {
  const answers: UserContextAnswers = {};
  const extra: string[] = [];

  for (const line of (content ?? "").split("\n")) {
    const prefix = USER_CONTEXT_FIELDS.find((field) =>
      line.startsWith(bulletPrefix(field))
    );

    // A repeated bullet keeps the first line as the answer and falls through to
    // extra, so a hand-written USER.md with two `Always:` rules loses neither.
    if (prefix && !Object.hasOwn(answers, prefix.key)) {
      // Drop the single separating space, so a trailing space survives a round trip.
      answers[prefix.key] = line
        .slice(bulletPrefix(prefix).length)
        .replace(/^ /, "");
      continue;
    }

    if (line.trim() === USER_CONTEXT_HEADING) {
      continue;
    }

    extra.push(line);
  }

  return { answers, extra: extra.join("\n").trim() };
}

/** Render answers back into USER.md. Blank answers are left out entirely. */
export function renderUserContext(
  answers: UserContextAnswers,
  extra?: string | null
): string {
  const bullets = USER_CONTEXT_FIELDS.filter(
    (field) => (answers[field.key] ?? "").trim() !== ""
  ).map((field) => `${bulletPrefix(field)} ${answers[field.key]}`);
  const rest = extra?.trim() ?? "";

  if (bullets.length === 0 && rest === "") {
    return "";
  }

  const sections = [USER_CONTEXT_HEADING, "", ...bullets];

  if (rest !== "") {
    if (bullets.length > 0) {
      sections.push("");
    }
    sections.push(rest);
  }

  return `${sections.join("\n")}\n`;
}

export function normalizeUserContextContent(
  raw: string | null | undefined
): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildUserContextStatus(
  raw: string | null | undefined,
  includeContent: boolean
): {
  active: boolean;
  content?: string;
} {
  const content = normalizeUserContextContent(raw);

  if (!includeContent) {
    return {
      active: content !== undefined,
    };
  }

  return {
    active: content !== undefined,
    ...(content === undefined ? {} : { content }),
  };
}
