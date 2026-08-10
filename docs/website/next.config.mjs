import { createMDX } from "fumadocs-mdx/next";

const repoBase = "/nakama";
const isGitHubPages = process.env.NAKAMA_DOCS_GITHUB_PAGES === "true";

/** @type {import('next').NextConfig} */
const config = {
  assetPrefix: isGitHubPages
    ? "https://ahmadrosid.github.io/nakama"
    : undefined,
  basePath: repoBase,
  env: {
    NEXT_PUBLIC_BASE_PATH: repoBase,
  },
  images: { unoptimized: true },
  output: "export",
  reactStrictMode: true,
  trailingSlash: false,
  turbopack: {
    root: import.meta.dirname,
  },
};

export default createMDX()(config);
