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
    Icon: SourceCodeIcon,
    label: "Software engineer",
  },
  {
    Icon: PaintBrush01Icon,
    label: "Designer",
  },
  {
    Icon: Target01Icon,
    label: "Product manager",
  },
  {
    Icon: Briefcase01Icon,
    label: "Founder / Leader",
  },
  {
    Icon: ChartLineData01Icon,
    label: "Data / ML",
  },
  {
    Icon: CloudServerIcon,
    label: "DevOps / SRE",
  },
  {
    Icon: Megaphone01Icon,
    label: "Marketing",
  },
  {
    Icon: MoneyBag01Icon,
    label: "Sales / Customer success",
  },
  {
    Icon: CustomerSupportIcon,
    label: "Support / Operations",
  },
  {
    Icon: Mortarboard01Icon,
    label: "Student / Researcher",
  },
  {
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
}

const GENERIC_WORK: WorkHints = {
  chips: ["Notion", "Google Workspace", "Slack", "Excel", "Figma", "Python"],
  projects: "What you are spending most of your week on",
  stack: "The tools and languages you actually use",
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
  },
  "Student / Researcher": {
    chips: ["Python", "R", "LaTeX", "Zotero", "Jupyter", "MATLAB", "Excel"],
    projects: "Thesis on urban air quality sensors",
    stack: "Python, LaTeX, Zotero",
  },
  "Support / Operations": {
    chips: ["Zendesk", "Intercom", "Freshdesk", "Notion", "Sheets", "Zapier"],
    projects: "Cutting first-response time in half",
    stack: "Zendesk, Notion, Zapier",
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
    label: "Concise",
    value: "concise",
  },
  {
    label: "Detailed",
    value: "detailed",
  },
] as const;

export const REPLY_TONE = [
  {
    label: "Casual",
    value: "casual",
  },
  {
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

export const USER_CONTEXT_SECTIONS = [
  { id: "about", title: "What do you do?" },
  { id: "work", title: "What are you working on?" },
  { id: "style", title: "How should replies sound?" },
  { id: "review", title: "What Nakama will remember" },
] as const;
