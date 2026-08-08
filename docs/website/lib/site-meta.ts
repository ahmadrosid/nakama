export const SITE_NAME = "Nakama";
export const SITE_TAGLINE = "AI agents that work with your team.";
export const SITE_DESCRIPTION =
  "Nakama is AI agents that work with your team — self-hosted or on managed hosting at getnakama.cloud, multi-tenant, and open source.";
export const SITE_URL =
  process.env.NAKAMA_DOCS_SITE_URL ?? "https://ahmadrosid.github.io/nakama";
export const AUTHOR_NAME = "Ahmad Rosid";
export const AUTHOR_ROLE = "Creator and maintainer of Nakama";
export const OG_IMAGE_URL = `${SITE_URL}/nakama-demo.png`;

export const pageDescriptions: Record<string, string> = {
  "agent-browser.md":
    "Drive interactive, login-walled websites from Nakama chat or automations with the agent-browser skill and bash.",
  "agent-prompt.md":
    "Understand how Nakama builds the final system prompt from soul files, tools, bundled system skills, and runtime context.",
  "backup-restore.md":
    "Export and restore your Nakama data root with dashboard ZIP backup.",
  "builtin-tools.md":
    "Review the builtin tools that Nakama profiles can use, how access is controlled, and how memory, artifact, and document workflows use file tools plus bundled skills.",
  "cli.md":
    "Use Nakama from the terminal — interactive chat, slash commands, and coding-agent launch.",
  "coding-agent.md":
    "Launch Codex, Claude Code, or OpenCode from Nakama chat or the CLI, with optional provider passthrough from your Nakama LLM provider.",
  "composio.md":
    "Connect SaaS apps through Composio with org-scoped OAuth and profile toolkit assignment.",
  "discord.md":
    "Set up Nakama as a Discord bot with pairing, slash commands, and server behavior.",
  "docker.md":
    "Run Nakama in a single Docker container with persistent data volumes.",
  "docs/index.md":
    "Documentation hub for Nakama — quickstart, deployment, concepts, channels, and reference.",
  "first-time-setup.md":
    "Complete Nakama setup wizard: admin account, organization, provider, and profiles.",
  "getting-started.md":
    "Redirects to Quickstart — install Nakama and complete first-time setup.",
  "index.md":
    "Nakama is AI agents that work with your team — with profiles, tools, channels, multi-tenant workspaces, and managed hosting at getnakama.cloud.",
  "integrations.md":
    "See which dashboard integration sections manage channels, coding-agent harnesses, Composio, and related deployment settings.",
  "mcp.md":
    "Connect external MCP servers to Nakama profiles and expose new tools safely.",
  "multi-tenancy.md":
    "Learn how organizations, roles, and tenant isolation work in Nakama.",
  "org-memory.md":
    "Shared, admin-curated facts for an organization — injected into every profile prompt and distinct from per-profile MEMORY.md.",
  "overview.md":
    "Understand the Nakama mental model: organizations, profiles, tools, channels, and deployment options including managed hosting.",
  "profiles.md":
    "See how Nakama profiles define bot behavior, soul files, memory, tools, and model selection.",
  "providers.md":
    "Configure LLM providers, API keys, and models in Nakama Settings.",
  "quickstart.md":
    "Install Nakama with Bun, Docker, or managed hosting and send your first chat message.",
  "self-improving-skills.md":
    "Let agents save successful workflows as reusable skills, with optional org-admin approval before changes go live.",
  "skills.md":
    "Learn how reusable skills extend Nakama profiles, including bundled memory, artifact, automation, and skill-authoring workflows.",
  "telegram.md":
    "Set up Nakama as a Telegram bot with pairing, commands, and group behavior.",
  "whatsapp.md":
    "Set up Nakama on WhatsApp with linking, commands, and troubleshooting.",
};

export const pageTitles: Record<string, string> = {
  "agent-browser.md": "Agent Browser",
  "agent-prompt.md": "How Agent Prompts Work",
  "backup-restore.md": "Backup and restore",
  "builtin-tools.md": "Builtin Tools",
  "cli.md": "CLI",
  "coding-agent.md": "Coding Agent",
  "composio.md": "Composio",
  "discord.md": "Discord",
  "docker.md": "Docker",
  "docs/index.md": "Documentation",
  "first-time-setup.md": "First-time setup",
  "getting-started.md": "Getting Started",
  "index.md": "Nakama",
  "integrations.md": "Integrations",
  "mcp.md": "MCP Servers",
  "multi-tenancy.md": "How Multi-tenancy Works",
  "org-memory.md": "Org Memory",
  "overview.md": "Overview",
  "profiles.md": "Profiles",
  "providers.md": "Providers",
  "quickstart.md": "Quickstart",
  "self-improving-skills.md": "Self-improving Skills",
  "skills.md": "Skills",
  "telegram.md": "Telegram",
  "whatsapp.md": "WhatsApp",
};

export function slugToRelativePath(slug: string[]): string {
  if (slug.length === 1 && slug[0] === "docs") {
    return "docs/index.md";
  }
  if (slug.length === 0) {
    return "index.md";
  }
  const last = slug.at(-1)!;
  if (last === "index") {
    if (slug.length === 1) {
      return "index.md";
    }
    return `${slug.slice(0, -1).join("/")}/index.md`;
  }
  return `${slug.join("/")}.md`;
}

export function getPageDescription(relativePath: string) {
  return pageDescriptions[relativePath] ?? SITE_DESCRIPTION;
}

export function getPageTitle(relativePath: string, fallbackTitle?: string) {
  return pageTitles[relativePath] ?? fallbackTitle ?? SITE_NAME;
}

export function getCanonicalUrl(relativePath: string) {
  const cleanPath = relativePath.replace(/index\.md$/, "").replace(/\.md$/, "");
  return cleanPath ? `${SITE_URL}/${cleanPath}` : `${SITE_URL}/`;
}

export function getMarkdownUrl(relativePath: string) {
  return `${SITE_URL}/${relativePath}`;
}

export function buildJsonLd(
  relativePath: string,
  title: string,
  description: string
) {
  return {
    "@context": "https://schema.org",
    "@type": relativePath === "index.md" ? "WebSite" : "WebPage",
    author: {
      "@type": "Person",
      jobTitle: AUTHOR_ROLE,
      name: AUTHOR_NAME,
      url: "https://github.com/ahmadrosid",
    },
    description,
    name: title,
    publisher: {
      "@type": "Organization",
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/favicon.png`,
      },
      name: SITE_NAME,
      url: SITE_URL,
    },
    url: getCanonicalUrl(relativePath),
  };
}

export function buildPageMetadata(
  relativePath: string,
  fallbackTitle?: string
) {
  const pageTitle = getPageTitle(relativePath, fallbackTitle);
  const title =
    pageTitle === SITE_NAME ? SITE_NAME : `${pageTitle} | ${SITE_NAME}`;
  const description = getPageDescription(relativePath);
  const canonicalUrl = getCanonicalUrl(relativePath);
  const markdownUrl = getMarkdownUrl(relativePath);

  return {
    alternates: {
      canonical: canonicalUrl,
      types: {
        "text/markdown": markdownUrl,
      },
    },
    authors: [{ name: `${AUTHOR_NAME}, ${AUTHOR_ROLE}` }],
    description,
    openGraph: {
      description,
      images: [{ url: OG_IMAGE_URL }],
      title,
      type: relativePath === "index.md" ? "website" : "article",
      url: canonicalUrl,
    },
    title,
    twitter: {
      card: "summary_large_image" as const,
      description,
      images: [OG_IMAGE_URL],
      title,
    },
  };
}

export function buildLlmsTxt(pages: string[]) {
  const topicRoutes = [
    {
      page: "quickstart.md",
      topics:
        "install, run locally, dev server, first chat, quickstart, bun install, dev:web",
    },
    {
      page: "docker.md",
      topics:
        "Docker, docker run, container, production deploy, docker-build-run, NAKAMA_CONFIG_DIR volume",
    },
    {
      page: "backup-restore.md",
      topics:
        "backup, restore, export zip, import zip, data root, NAKAMA_CONFIG_DIR",
    },
    {
      page: "first-time-setup.md",
      topics:
        "first-time setup, setup wizard, admin account, first organization, onboarding",
    },
    {
      page: "providers.md",
      topics:
        "LLM provider, API key, OpenAI, Anthropic, OpenRouter, Gemini, Ollama, Fireworks, model setup, config.ini",
    },
    {
      page: "cli.md",
      topics:
        "CLI, terminal, dev:cli, slash commands, bun run dev:cli, launch codex claude opencode",
    },
    {
      page: "docs/index.md",
      topics: "documentation hub, docs index, all pages",
    },
    {
      page: "quickstart.md",
      topics: "getting started (legacy URL)",
    },
    {
      page: "telegram.md",
      topics:
        "connect Telegram, Telegram bot, pairing, BotFather, dev:telegram, group chat",
    },
    {
      page: "whatsapp.md",
      topics: "connect WhatsApp, WhatsApp linking, QR code, pairing code",
    },
    {
      page: "discord.md",
      topics:
        "connect Discord, Discord bot, pairing, slash commands, server channels",
    },
    {
      page: "overview.md",
      topics:
        "what is Nakama, mental model, organizations, profiles, tools, channels, managed hosting, deployment options",
    },
    {
      page: "multi-tenancy.md",
      topics:
        "organizations, tenants, roles, members, invites, org admin, multi-tenant",
    },
    {
      page: "profiles.md",
      topics:
        "profiles, soul files, MEMORY.md, knowledge base, artifacts, bot behavior",
    },
    {
      page: "agent-prompt.md",
      topics:
        "system prompt, SOUL.md, how prompts are built, agent instructions",
    },
    {
      page: "builtin-tools.md",
      topics:
        "builtin tools, read_file, write_file, write_docx, web_search, knowledge_base_search, email, bash, sub_agent",
    },
    {
      page: "integrations.md",
      topics:
        "integrations page, channel settings, bridge workers, coding-agent settings, dashboard integrations",
    },
    {
      page: "composio.md",
      topics: "Composio, SaaS OAuth, external app tools, toolkit assignment",
    },
    {
      page: "self-improving-skills.md",
      topics:
        "self-improving skills, write approval, skill proposals, agent workflows, manage-skills",
    },
    {
      page: "skills.md",
      topics:
        "skills, automations, memory skills, save-artifact, manage-skills",
    },
    {
      page: "mcp.md",
      topics: "MCP servers, external tools, MCP integration",
    },
    {
      page: "coding-agent.md",
      topics: "coding agent, Codex, Claude Code, OpenCode, dev:cli launch",
    },
    {
      page: "agent-browser.md",
      topics:
        "agent-browser, browser automation, login wall, snapshot, bash browser, interactive web",
    },
    {
      page: "builtin-tools.md",
      topics: "sub-agent, sub_agent, delegation, research, review, planning",
    },
  ] as const;

  const docSections = [
    {
      heading: "Start here",
      pages: [
        "docs/index.md",
        "quickstart.md",
        "overview.md",
        "first-time-setup.md",
        "providers.md",
      ] as const,
    },
    {
      heading: "Deploy",
      pages: ["docker.md", "backup-restore.md"] as const,
    },
    {
      heading: "Channels",
      pages: ["cli.md", "telegram.md", "whatsapp.md", "discord.md"] as const,
    },
    {
      heading: "Concepts",
      pages: [
        "index.md",
        "multi-tenancy.md",
        "org-memory.md",
        "self-improving-skills.md",
        "profiles.md",
        "agent-prompt.md",
      ] as const,
    },
    {
      heading: "Extend",
      pages: [
        "builtin-tools.md",
        "skills.md",
        "self-improving-skills.md",
        "integrations.md",
        "coding-agent.md",
        "agent-browser.md",
        "mcp.md",
        "composio.md",
      ] as const,
    },
  ] as const;

  const formatDocLine = (page: string) => {
    const title = page === "index.md" ? "Home" : getPageTitle(page);
    return `- [${title}](${getMarkdownUrl(page)}): ${getPageDescription(page)}`;
  };

  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION} ${SITE_TAGLINE}`,
    "",
    `${SITE_NAME} is AI agents that work with your team. Each profile is an agent with its own role, soul, tools, and memory. Organizations, skills, MCP servers, and channels like web, CLI, Telegram, WhatsApp, and Discord let you run your nakama from one deployment — self-hosted, in Docker, or on managed hosting at https://getnakama.cloud/.`,
    "",
    `Maintainer: ${AUTHOR_NAME} (${AUTHOR_ROLE})`,
    `Website: ${SITE_URL}/`,
    "Repository: https://github.com/ahmadrosid/nakama",
    "",
    "## For AI agents",
    "",
    "This file is the entry point for Nakama product documentation.",
    "When a user asks about Nakama setup, behavior, integrations, or troubleshooting:",
    `1. You are reading the index now, or fetch ${SITE_URL}/llms.txt if you do not have it yet.`,
    '2. Pick the best page from "Topic routing" or "Docs" below.',
    `3. web_fetch the matching .md page (for example ${SITE_URL}/telegram.md).`,
    "4. Do not use knowledge_base_search for these URLs — that tool only searches uploaded profile documents.",
    "5. Answer from the fetched page. Do not guess steps that are not in the docs.",
    "",
    "Markdown mirrors use a `.md` suffix on the same path as the HTML docs.",
    "",
    "## Topic routing",
    "",
    "Match the user question to a page:",
    "",
    ...topicRoutes.map(
      ({ topics, page }) =>
        `- ${topics} → [${getPageTitle(page)}](${getMarkdownUrl(page)})`
    ),
    "",
    ...docSections.flatMap((section) => [
      `## Docs — ${section.heading}`,
      "",
      ...section.pages
        .filter((page) => pages.includes(page))
        .map(formatDocLine),
      "",
    ]),
    "## All pages",
    "",
    ...pages.map(formatDocLine),
  ];

  return `${lines.join("\n")}\n`;
}
