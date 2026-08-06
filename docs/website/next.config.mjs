import { createMDX } from 'fumadocs-mdx/next'

const repoBase = '/nakama'
const isGitHubPages = process.env.NAKAMA_DOCS_GITHUB_PAGES === 'true'

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'export',
  trailingSlash: false,
  images: { unoptimized: true },
  basePath: repoBase,
  assetPrefix: isGitHubPages ? 'https://ahmadrosid.github.io/nakama' : undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: repoBase,
  },
  turbopack: {
    root: import.meta.dirname,
  },
}

export default createMDX()(config)
