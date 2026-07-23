import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig } from 'vitepress'

const SITE_NAME = 'Nakama'
const SITE_TAGLINE = 'AI agents that work with your team.'
const SITE_DESCRIPTION = 'Nakama is AI agents that work with your team — self-hosted or on managed hosting at getnakama.cloud, multi-tenant, and open source.'
const SITE_URL = process.env.NAKAMA_DOCS_SITE_URL ?? 'https://docs.getnakama.com'
const AUTHOR_NAME = 'Ahmad Rosid'
const AUTHOR_ROLE = 'Creator and maintainer of Nakama'
const OG_IMAGE_URL = `${SITE_URL}/nakama-demo.png`

const pageDescriptions: Record<string, string> = {
  'index.md': 'Nakama is AI agents that work with your team — with profiles, tools, channels, multi-tenant workspaces, and managed hosting at getnakama.cloud.',
  'docs/index.md': 'Documentation hub for Nakama — quickstart, deployment, concepts, channels, and reference.',
  'quickstart.md': 'Install Nakama with Bun, Docker, or managed hosting and send your first chat message.',
  'getting-started.md': 'Redirects to Quickstart — install Nakama and complete first-time setup.',
  'first-time-setup.md': 'Complete Nakama setup wizard: admin account, organization, provider, and profiles.',
  'providers.md': 'Configure LLM providers, API keys, and models in Nakama Settings.',
  'cli.md': 'Use Nakama from the terminal — interactive chat, slash commands, and coding-agent launch.',
  'docker.md': 'Run Nakama in a single Docker container with persistent data volumes.',
  'backup-restore.md': 'Export and restore your Nakama data root with dashboard ZIP backup.',
  'overview.md': 'Understand the Nakama mental model: organizations, profiles, tools, channels, and deployment options including managed hosting.',
  'multi-tenancy.md': 'Learn how organizations, roles, and tenant isolation work in Nakama.',
  'profiles.md': 'See how Nakama profiles define bot behavior, soul files, memory, tools, and model selection.',
  'agent-prompt.md': 'Understand how Nakama builds the final system prompt from soul files, tools, bundled system skills, and runtime context.',
  'builtin-tools.md': 'Review the builtin tools that Nakama profiles can use, how access is controlled, and how memory, artifact, and document workflows use file tools plus bundled skills.',
  'skills.md': 'Learn how reusable skills extend Nakama profiles, including bundled memory, artifact, automation, and skill-authoring workflows.',
  'integrations.md': 'See which dashboard integration sections manage channels, coding-agent harnesses, Composio, and related deployment settings.',
  'mcp.md': 'Connect external MCP servers to Nakama profiles and expose new tools safely.',
  'composio.md': 'Connect SaaS apps through Composio with org-scoped OAuth and profile toolkit assignment.',
  'coding-agent.md': 'Launch Codex, Claude Code, or OpenCode from Nakama chat or the CLI, with optional inference gateway routing through your Nakama provider.',
  'agent-browser.md': 'Drive interactive, login-walled websites from Nakama chat or automations with the agent-browser skill and bash.',
  'telegram.md': 'Set up Nakama as a Telegram bot with pairing, commands, and group behavior.',
  'whatsapp.md': 'Set up Nakama on WhatsApp with linking, commands, and troubleshooting.',
  'discord.md': 'Set up Nakama as a Discord bot with pairing, slash commands, and server behavior.',
}

const pageTitles: Record<string, string> = {
  'index.md': 'Nakama',
  'docs/index.md': 'Documentation',
  'quickstart.md': 'Quickstart',
  'getting-started.md': 'Getting Started',
  'first-time-setup.md': 'First-time setup',
  'providers.md': 'Providers',
  'cli.md': 'CLI',
  'docker.md': 'Docker',
  'backup-restore.md': 'Backup and restore',
  'overview.md': 'Overview',
  'multi-tenancy.md': 'Multi-tenancy',
  'profiles.md': 'Profiles',
  'agent-prompt.md': 'Agent Prompt',
  'builtin-tools.md': 'Builtin Tools',
  'skills.md': 'Skills',
  'integrations.md': 'Integrations',
  'mcp.md': 'MCP Servers',
  'composio.md': 'Composio',
  'coding-agent.md': 'Coding Agent',
  'agent-browser.md': 'Agent Browser',
  'telegram.md': 'Telegram',
  'whatsapp.md': 'WhatsApp',
  'discord.md': 'Discord',
}

function getPageDescription(relativePath: string) {
  return pageDescriptions[relativePath] ?? SITE_DESCRIPTION
}

function getPageTitle(relativePath: string, fallbackTitle?: string) {
  return pageTitles[relativePath] ?? fallbackTitle ?? SITE_NAME
}

function getCanonicalUrl(relativePath: string) {
  const cleanPath = relativePath.replace(/index\.md$/, '').replace(/\.md$/, '')
  return cleanPath ? `${SITE_URL}/${cleanPath}` : `${SITE_URL}/`
}

function getMarkdownUrl(relativePath: string) {
  return `${SITE_URL}/${relativePath}`
}

function buildJsonLd(relativePath: string, title: string, description: string) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': relativePath === 'index.md' ? 'WebSite' : 'WebPage',
    name: title,
    description,
    url: getCanonicalUrl(relativePath),
    author: {
      '@type': 'Person',
      name: AUTHOR_NAME,
      jobTitle: AUTHOR_ROLE,
      url: 'https://github.com/ahmadrosid',
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/favicon.png`,
      },
    },
  })
}

function buildLlmsTxt(pages: string[]) {
  const topicRoutes = [
    {
      topics:
        "install, run locally, dev server, first chat, quickstart, bun install, dev:web",
      page: "quickstart.md",
    },
    {
      topics:
        "Docker, docker run, container, production deploy, docker-build, NAKAMA_CONFIG_DIR volume",
      page: "docker.md",
    },
    {
      topics: "backup, restore, export zip, import zip, data root, NAKAMA_CONFIG_DIR",
      page: "backup-restore.md",
    },
    {
      topics:
        "first-time setup, setup wizard, admin account, first organization, onboarding",
      page: "first-time-setup.md",
    },
    {
      topics:
        "LLM provider, API key, OpenAI, Anthropic, OpenRouter, Gemini, Ollama, Fireworks, model setup, config.ini",
      page: "providers.md",
    },
    {
      topics:
        "CLI, terminal, dev:cli, slash commands, bun run dev:cli, launch codex claude opencode",
      page: "cli.md",
    },
    {
      topics: "documentation hub, docs index, all pages",
      page: "docs/index.md",
    },
    {
      topics: "getting started (legacy URL)",
      page: "quickstart.md",
    },
    {
      topics: "connect Telegram, Telegram bot, pairing, BotFather, dev:telegram, group chat",
      page: "telegram.md",
    },
    {
      topics: "connect WhatsApp, WhatsApp linking, QR code, pairing code",
      page: "whatsapp.md",
    },
    {
      topics: "connect Discord, Discord bot, pairing, slash commands, server channels",
      page: "discord.md",
    },
    {
      topics: "what is Nakama, mental model, organizations, profiles, tools, channels, managed hosting, deployment options",
      page: "overview.md",
    },
    {
      topics: "organizations, tenants, roles, members, invites, org admin, multi-tenant",
      page: "multi-tenancy.md",
    },
    {
      topics: "profiles, soul files, MEMORY.md, knowledge base, artifacts, bot behavior",
      page: "profiles.md",
    },
    {
      topics: "system prompt, SOUL.md, how prompts are built, agent instructions",
      page: "agent-prompt.md",
    },
    {
      topics: "builtin tools, read_file, write_file, write_docx, web_search, knowledge_base_search, email, bash, sub_agent",
      page: "builtin-tools.md",
    },
    {
      topics: "integrations page, channel settings, bridge workers, coding-agent settings, dashboard integrations",
      page: "integrations.md",
    },
    {
      topics: "Composio, SaaS OAuth, external app tools, toolkit assignment",
      page: "composio.md",
    },
    {
      topics: "skills, automations, memory skills, save-artifact, manage-skills",
      page: "skills.md",
    },
    {
      topics: "MCP servers, external tools, MCP integration",
      page: "mcp.md",
    },
    {
      topics: "coding agent, Codex, Claude Code, OpenCode, dev:cli launch",
      page: "coding-agent.md",
    },
    {
      topics: "agent-browser, browser automation, login wall, snapshot, bash browser, interactive web",
      page: "agent-browser.md",
    },
    {
      topics: "sub-agent, sub_agent, delegation, research, review, planning",
      page: "builtin-tools.md",
    },
  ] as const

  const docSections = [
    {
      heading: 'Start here',
      pages: [
        'docs/index.md',
        'quickstart.md',
        'overview.md',
        'first-time-setup.md',
        'providers.md',
      ] as const,
    },
    {
      heading: 'Deploy',
      pages: ['docker.md', 'backup-restore.md'] as const,
    },
    {
      heading: 'Channels',
      pages: ['cli.md', 'telegram.md', 'whatsapp.md', 'discord.md'] as const,
    },
    {
      heading: 'Concepts',
      pages: ['index.md', 'multi-tenancy.md', 'profiles.md', 'agent-prompt.md'] as const,
    },
    {
      heading: 'Extend',
      pages: [
        'builtin-tools.md',
        'skills.md',
        'integrations.md',
        'coding-agent.md',
        'agent-browser.md',
        'mcp.md',
        'composio.md',
      ] as const,
    },
  ] as const

  const formatDocLine = (page: string) => {
    const title = page === 'index.md' ? 'Home' : getPageTitle(page)
    return `- [${title}](${getMarkdownUrl(page)}): ${getPageDescription(page)}`
  }

  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESCRIPTION} ${SITE_TAGLINE}`,
    '',
    `${SITE_NAME} is AI agents that work with your team. Each profile is an agent with its own role, soul, tools, and memory. Organizations, skills, MCP servers, and channels like web, CLI, Telegram, WhatsApp, and Discord let you run your nakama from one deployment — self-hosted, in Docker, or on managed hosting at https://getnakama.cloud/.`,
    '',
    `Maintainer: ${AUTHOR_NAME} (${AUTHOR_ROLE})`,
    `Website: ${SITE_URL}/`,
    `Repository: https://github.com/ahmadrosid/nakama`,
    '',
    '## For AI agents',
    '',
    'This file is the entry point for Nakama product documentation.',
    'When a user asks about Nakama setup, behavior, integrations, or troubleshooting:',
    `1. You are reading the index now, or fetch ${SITE_URL}/llms.txt if you do not have it yet.`,
    '2. Pick the best page from "Topic routing" or "Docs" below.',
    `3. web_fetch the matching .md page (for example ${SITE_URL}/telegram.md).`,
    '4. Do not use knowledge_base_search for these URLs — that tool only searches uploaded profile documents.',
    '5. Answer from the fetched page. Do not guess steps that are not in the docs.',
    '',
    'Markdown mirrors use a `.md` suffix on the same path as the HTML docs.',
    '',
    '## Topic routing',
    '',
    'Match the user question to a page:',
    '',
    ...topicRoutes.map(
      ({ topics, page }) =>
        `- ${topics} → [${getPageTitle(page)}](${getMarkdownUrl(page)})`,
    ),
    '',
    ...docSections.flatMap((section) => [
      `## Docs — ${section.heading}`,
      '',
      ...section.pages.filter((page) => pages.includes(page)).map(formatDocLine),
      '',
    ]),
    '## All pages',
    '',
    ...pages.map(formatDocLine),
  ]

  return `${lines.join('\n')}\n`
}

export default defineConfig({
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  base: '/',
  sitemap: {
    hostname: SITE_URL,
  },
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/nakama/favicon.png' }],
    ['meta', { name: 'author', content: `${AUTHOR_NAME}, ${AUTHOR_ROLE}` }],
  ],
  transformHead({ pageData }) {
    const pageTitle = getPageTitle(pageData.relativePath, pageData.title)
    const title = pageTitle === SITE_NAME ? SITE_NAME : `${pageTitle} | ${SITE_NAME}`
    const description = getPageDescription(pageData.relativePath)
    const canonicalUrl = getCanonicalUrl(pageData.relativePath)
    const markdownUrl = getMarkdownUrl(pageData.relativePath)
    const head: Array<[string, Record<string, string>] | [string, Record<string, string>, string]> = [
      ['link', { rel: 'canonical', href: canonicalUrl }],
      ['link', { rel: 'alternate', type: 'text/markdown', href: markdownUrl }],
      ['meta', { property: 'og:type', content: pageData.relativePath === 'index.md' ? 'website' : 'article' }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:image', content: OG_IMAGE_URL }],
      ['meta', { property: 'og:url', content: canonicalUrl }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: OG_IMAGE_URL }],
      ['meta', { name: 'description', content: description }],
      ['meta', { name: 'author', content: `${AUTHOR_NAME}, ${AUTHOR_ROLE}` }],
      ['script', { type: 'application/ld+json' }, buildJsonLd(pageData.relativePath, title, description)],
    ]

    if (pageData.relativePath === 'getting-started.md') {
      head.push(['meta', { 'http-equiv': 'refresh', content: `0;url=${SITE_URL}/quickstart` }])
      head[0] = ['link', { rel: 'canonical', href: `${SITE_URL}/quickstart` }]
    }

    return head
  },
  async buildEnd(siteConfig) {
    const pages = [...siteConfig.pages].sort()

    await Promise.all(
      pages.map(async (relativePath) => {
        const sourcePath = path.join(siteConfig.srcDir, relativePath)
        const outputPath = path.join(siteConfig.outDir, relativePath)
        const markdown = await readFile(sourcePath, 'utf8')

        await mkdir(path.dirname(outputPath), { recursive: true })
        await writeFile(outputPath, markdown)
      }),
    )

    await writeFile(path.join(siteConfig.outDir, 'llms.txt'), buildLlmsTxt(pages))
  },
  themeConfig: {
    logo: {
      src: '/favicon.png',
      alt: 'Nakama logo',
    },
    nav: [
      { text: 'Docs', link: '/docs/' },
      { text: 'Managed hosting', link: 'https://getnakama.cloud/' },
    ],
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Documentation', link: '/docs/' },
          { text: 'Quickstart', link: '/quickstart' },
          { text: 'Overview', link: '/overview' },
          { text: 'First-time setup', link: '/first-time-setup' },
          { text: 'Providers', link: '/providers' },
        ],
      },
      {
        text: 'Deploy',
        items: [
          { text: 'Docker', link: '/docker' },
          { text: 'Backup and restore', link: '/backup-restore' },
        ],
      },
      {
        text: 'Channels',
        items: [
          { text: 'CLI', link: '/cli' },
          { text: 'Telegram', link: '/telegram' },
          { text: 'WhatsApp', link: '/whatsapp' },
          { text: 'Discord', link: '/discord' },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Multi-tenancy', link: '/multi-tenancy' },
          { text: 'Profiles', link: '/profiles' },
          { text: 'Agent Prompts', link: '/agent-prompt' },
        ],
      },
      {
        text: 'Extend',
        items: [
          { text: 'Builtin Tools', link: '/builtin-tools' },
          { text: 'Skills', link: '/skills' },
          { text: 'Integrations', link: '/integrations' },
          { text: 'Coding Agent', link: '/coding-agent' },
          { text: 'Agent Browser', link: '/agent-browser' },
          { text: 'MCP Servers', link: '/mcp' },
          { text: 'Composio', link: '/composio' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/ahmadrosid/nakama' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Nakama contributors',
    },
  },
})
