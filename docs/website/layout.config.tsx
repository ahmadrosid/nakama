import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'Nakama',
    },
    links: [
      {
        text: 'Managed hosting',
        url: 'https://getnakama.cloud/',
        external: true,
      },
    ],
    githubUrl: 'https://github.com/ahmadrosid/nakama',
  }
}
