import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig } from 'vitepress'

const SITE_NAME = 'Nakama'
const SITE_TAGLINE = 'AI agents that work with your team.'
const SITE_DESCRIPTION = 'Nakama is AI agents that work with your team — self-hosted, multi-tenant, and open source.'
const SITE_URL = 'https://ahmadrosid.github.io/nakama'
const AUTHOR_NAME = 'Ahmad Rosid'
const AUTHOR_ROLE = 'Creator and maintainer of Nakama'
const OG_IMAGE_URL = `${SITE_URL}/nakama-demo.png`

const pageDescriptions: Record<string, string> = {
  'index.md': 'Nakama is AI agents that work with your team — with profiles, tools, channels, and multi-tenant workspaces.',
  'getting-started.md': 'Install Nakama with Bun or Docker, run the server, and complete first-time setup.',
  'overview.md': 'Understand the Nakama mental model: organizations, profiles, tools, and channels.',
  'multi-tenancy.md': 'Learn how organizations, roles, and tenant isolation work in Nakama.',
  'profiles.md': 'See how Nakama profiles define bot behavior, soul files, memory, tools, and model selection.',
  'agent-prompt.md': 'Understand how Nakama builds the final system prompt from soul files, tools, bundled system skills, and runtime context.',
  'builtin-tools.md': 'Review the builtin tools that Nakama profiles can use, how access is controlled, and how memory and artifact workflows use file tools plus bundled skills.',
  'skills.md': 'Learn how reusable skills extend Nakama profiles, including bundled memory, artifact, automation, and skill-authoring workflows.',
  'mcp.md': 'Connect external MCP servers to Nakama profiles and expose new tools safely.',
  'coding-agent.md': 'Hand repo coding work to Codex, Claude Code, or OpenCode from Nakama chat via bash, the coding-delegation skill, and Integrations harness setup.',
  'telegram.md': 'Set up Nakama as a Telegram bot with pairing, commands, and group behavior.',
  'whatsapp.md': 'Set up Nakama on WhatsApp with linking, commands, and troubleshooting.',
}

const pageTitles: Record<string, string> = {
  'index.md': 'Nakama',
  'getting-started.md': 'Getting Started',
  'overview.md': 'Overview',
  'multi-tenancy.md': 'Multi-tenancy',
  'profiles.md': 'Profiles',
  'agent-prompt.md': 'Agent Prompt',
  'builtin-tools.md': 'Builtin Tools',
  'skills.md': 'Skills',
  'mcp.md': 'MCP Servers',
  'coding-agent.md': 'Coding Agent',
  'telegram.md': 'Telegram',
  'whatsapp.md': 'WhatsApp',
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
  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESCRIPTION} ${SITE_TAGLINE}`,
    '',
    `${SITE_NAME} is AI agents that work with your team. Each profile is an agent with its own role, soul, tools, and memory. Organizations, skills, MCP servers, and channels like web, CLI, Telegram, and WhatsApp let you run your nakama from one deployment.`,
    '',
    `Maintainer: ${AUTHOR_NAME} (${AUTHOR_ROLE})`,
    `Website: ${SITE_URL}/`,
    `Repository: https://github.com/ahmadrosid/nakama`,
    '',
    '## AI-friendly access',
    '',
    '- Markdown mirrors are available for docs pages at the same path with a `.md` suffix.',
    '- Canonical HTML pages are available under the main docs site.',
    '',
    '## Docs',
    '',
    ...pages.map((page) => {
      const title = page === 'index.md' ? 'Home' : getPageTitle(page)
      return `- [${title}](${getMarkdownUrl(page)}): ${getPageDescription(page)}`
    }),
  ]

  return `${lines.join('\n')}\n`
}

export default defineConfig({
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  base: '/nakama/',
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

    return [
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
      { text: 'Docs', link: '/getting-started' },
    ],
    sidebar: [
      {
        text: 'Guides',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Telegram', link: '/telegram' },
          { text: 'WhatsApp', link: '/whatsapp' },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Overview', link: '/overview' },
          { text: 'Multi-tenancy', link: '/multi-tenancy' },
          { text: 'Profiles', link: '/profiles' },
          { text: 'Agent Prompts', link: '/agent-prompt' },
        ],
      },
      {
        text: 'Operations',
        items: [
          { text: 'Builtin Tools', link: '/builtin-tools' },
          { text: 'Skills', link: '/skills' },
          { text: 'Coding Agent', link: '/coding-agent' },
          { text: 'MCP Servers', link: '/mcp' },
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
