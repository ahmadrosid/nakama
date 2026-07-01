import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    title: 'TinyClaw',
    description: 'Deploy your own AI Agent platform as easily as spinning up WordPress.',
    base: '/tinyclaw/',
    head: [['link', { rel: 'icon', type: 'image/png', href: '/tinyclaw/favicon.png' }]],
    themeConfig: {
      logo: '/tinyclaw/favicon.png',
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
            { text: 'MCP Servers', link: '/mcp' },
          ],
        },
      ],
      socialLinks: [
        { icon: 'github', link: 'https://github.com/ahmadrosid/tinyclaw' },
      ],
      footer: {
        message: 'Released under the MIT License.',
        copyright: 'Copyright © TinyClaw contributors',
      },
    },
  }),
)
