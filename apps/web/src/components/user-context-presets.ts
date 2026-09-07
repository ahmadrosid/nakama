/**
 * Answer presets for the guided USER.md form, plus the pure string codecs that
 * read and write them. Kept apart from the form so the tables stay readable and
 * the parsing round trips can be tested on their own.
 */

import {
  Briefcase01Icon,
  ChartLineData01Icon,
  CloudServerIcon,
  CustomerSupportIcon,
  Megaphone01Icon,
  MoneyBag01Icon,
  Mortarboard01Icon,
  PaintBrush01Icon,
  QuillWrite01Icon,
  SourceCodeIcon,
  Target01Icon,
} from "hugeicons-react";

/* ------------------------------------------------------------------ */
/* Who you are                                                         */
/* ------------------------------------------------------------------ */

export const ROLE_PRESETS = [
  {
    hint: "Code first, fewer basics explained.",
    Icon: SourceCodeIcon,
    label: "Software engineer",
  },
  {
    hint: "Thinks in flows, components, and copy.",
    Icon: PaintBrush01Icon,
    label: "Designer",
  },
  {
    hint: "Frames answers as tradeoffs and user impact.",
    Icon: Target01Icon,
    label: "Product manager",
  },
  {
    hint: "Short summaries, decisions, next steps.",
    Icon: Briefcase01Icon,
    label: "Founder / Leader",
  },
  {
    hint: "Comfortable with stats, notebooks, pipelines.",
    Icon: ChartLineData01Icon,
    label: "Data / ML",
  },
  {
    hint: "Assumes shell, infra, and incident context.",
    Icon: CloudServerIcon,
    label: "DevOps / SRE",
  },
  {
    hint: "Audience, message, and channel come first.",
    Icon: Megaphone01Icon,
    label: "Marketing",
  },
  {
    hint: "Customer-ready wording you can paste.",
    Icon: MoneyBag01Icon,
    label: "Sales / Customer success",
  },
  {
    hint: "Step by step, checklist friendly.",
    Icon: CustomerSupportIcon,
    label: "Support / Operations",
  },
  {
    hint: "Explains the why, not just the what.",
    Icon: Mortarboard01Icon,
    label: "Student / Researcher",
  },
  {
    hint: "Cares about voice, structure, clarity.",
    Icon: QuillWrite01Icon,
    label: "Writer / Content",
  },
] as const;

export function isPresetRole(role: string): boolean {
  return ROLE_PRESETS.some((preset) => preset.label === role);
}

/* ------------------------------------------------------------------ */
/* What you work on, shaped by the role picked before                  */
/* ------------------------------------------------------------------ */

interface WorkHints {
  chips: readonly string[];
  projects: string;
  stack: string;
  stackHint: string;
}

const GENERIC_WORK: WorkHints = {
  chips: ["Notion", "Google Workspace", "Slack", "Excel", "Figma", "Python"],
  projects: "What you are spending most of your week on",
  stack: "The tools and languages you actually use",
  stackHint: "Tools count too. Examples come back in these.",
};

const WORK_BY_ROLE: Record<string, WorkHints> = {
  "Data / ML": {
    chips: [
      "Python",
      "SQL",
      "pandas",
      "PyTorch",
      "dbt",
      "BigQuery",
      "Snowflake",
      "Jupyter",
    ],
    projects: "Churn model for the growth team",
    stack: "Python, SQL, dbt",
    stackHint: "Snippets come back in these, not in something random.",
  },
  Designer: {
    chips: [
      "Figma",
      "Framer",
      "Webflow",
      "Illustrator",
      "Storybook",
      "Notion",
      "Tailwind",
    ],
    projects: "Redesigning the onboarding flow",
    stack: "Figma, Framer, Tailwind",
    stackHint: "Design tools and any frontend stack you hand off to.",
  },
  "DevOps / SRE": {
    chips: [
      "Kubernetes",
      "Terraform",
      "AWS",
      "GCP",
      "Docker",
      "Prometheus",
      "Grafana",
      "Ansible",
      "Bash",
    ],
    projects: "Moving the cluster to Kubernetes without downtime",
    stack: "Kubernetes, Terraform, AWS",
    stackHint: "Commands and manifests come back for this stack.",
  },
  "Founder / Leader": {
    chips: [
      "Notion",
      "Slack",
      "Google Workspace",
      "Linear",
      "Stripe",
      "HubSpot",
    ],
    projects: "Closing the seed round, hiring the first engineers",
    stack: "Notion, Slack, Stripe",
    stackHint: "The tools your team lives in.",
  },
  Marketing: {
    chips: [
      "HubSpot",
      "Google Analytics",
      "Meta Ads",
      "Mailchimp",
      "Canva",
      "WordPress",
      "Ahrefs",
    ],
    projects: "Launch campaign for the new pricing",
    stack: "HubSpot, Google Analytics, Canva",
    stackHint: "Channels and tools. Drafts land in the right format.",
  },
  "Product manager": {
    chips: [
      "Notion",
      "Jira",
      "Linear",
      "Figma",
      "Amplitude",
      "Mixpanel",
      "Sheets",
    ],
    projects: "Q3 roadmap for the payments team",
    stack: "Linear, Figma, Amplitude",
    stackHint: "Where specs, tickets, and metrics live.",
  },
  "Sales / Customer success": {
    chips: [
      "Salesforce",
      "HubSpot",
      "Intercom",
      "Gong",
      "Sheets",
      "LinkedIn Sales Navigator",
    ],
    projects: "Closing the Q3 enterprise pipeline",
    stack: "Salesforce, Gong, Sheets",
    stackHint: "CRM and outreach tools, so drafts fit your workflow.",
  },
  "Software engineer": {
    chips: [
      "TypeScript",
      "Python",
      "Go",
      "Rust",
      "Java",
      "React",
      "Node.js",
      "Postgres",
      "Docker",
      "Kubernetes",
      "AWS",
    ],
    projects: "Moving the billing API off the monolith",
    stack: "Go, Postgres, Kubernetes",
    stackHint:
      "Examples come back in these languages, not in something random.",
  },
  "Student / Researcher": {
    chips: ["Python", "R", "LaTeX", "Zotero", "Jupyter", "MATLAB", "Excel"],
    projects: "Thesis on urban air quality sensors",
    stack: "Python, LaTeX, Zotero",
    stackHint: "Tools you write and analyse with.",
  },
  "Support / Operations": {
    chips: ["Zendesk", "Intercom", "Freshdesk", "Notion", "Sheets", "Zapier"],
    projects: "Cutting first-response time in half",
    stack: "Zendesk, Notion, Zapier",
    stackHint: "Helpdesk and ops tools. Macros and steps match them.",
  },
  "Writer / Content": {
    chips: [
      "Google Docs",
      "Notion",
      "WordPress",
      "Grammarly",
      "Canva",
      "Substack",
    ],
    projects: "Weekly newsletter and the product docs refresh",
    stack: "Google Docs, WordPress, Substack",
    stackHint: "Where drafts live and get published.",
  },
};

export function workHintsForRole(role: string): WorkHints {
  return WORK_BY_ROLE[role] ?? GENERIC_WORK;
}

/* ------------------------------------------------------------------ */
/* How replies should sound                                            */
/* ------------------------------------------------------------------ */

export const REPLY_LENGTH = [
  {
    example: "Use PUT /v1/user/context with { content }. Done.",
    label: "Concise",
    value: "concise",
  },
  {
    example:
      "There are two ways to do this. PUT replaces the whole file, which matters because...",
    label: "Detailed",
    value: "detailed",
  },
] as const;

export const REPLY_TONE = [
  {
    example: "Yep, that works. One gotcha though:",
    label: "Casual",
    value: "casual",
  },
  {
    example: "This approach is viable. One caveat applies:",
    label: "Formal",
    value: "formal",
  },
] as const;

const KNOWN_REPLY_WORDS = new Set<string>(
  [...REPLY_LENGTH, ...REPLY_TONE].map((option) => option.value)
);

/**
 * "concise, casual, code first" -> picked [concise, casual], custom "code first".
 * Only leading known words are consumed, so free text is kept verbatim.
 */
export function splitReplies(raw: string): {
  custom: string;
  picked: string[];
} {
  const picked: string[] = [];
  let rest = raw;

  for (;;) {
    const match = /^\s*([A-Za-z]+)\s*(?:,\s*|$)/.exec(rest);
    if (!(match && KNOWN_REPLY_WORDS.has(match[1].toLowerCase()))) {
      break;
    }
    picked.push(match[1].toLowerCase());
    rest = rest.slice(match[0].length);
  }

  return { custom: rest, picked };
}

export function joinReplies(picked: string[], custom: string): string {
  return [...picked, custom].filter((part) => part !== "").join(", ");
}

export const REPLY_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
] as const;

export function browserLanguageLabel(): string | null {
  if (typeof navigator === "undefined") {
    return null;
  }
  const code = navigator.language.split("-")[0]?.toLowerCase();
  return REPLY_LANGUAGES.find((entry) => entry.code === code)?.label ?? null;
}

/** "Reply in Bahasa Indonesia. Cite sources." -> language + the rest, verbatim. */
export function splitAlways(raw: string): { language: string; rest: string } {
  const match = /^Reply in ([^.]+?)\.(?: (.*))?$/s.exec(raw);
  if (!match) {
    return { language: "", rest: raw };
  }
  return { language: match[1], rest: match[2] ?? "" };
}

export function joinAlways(language: string, rest: string): string {
  if (language === "") {
    return rest;
  }
  return rest === ""
    ? `Reply in ${language}.`
    : `Reply in ${language}. ${rest}`;
}
