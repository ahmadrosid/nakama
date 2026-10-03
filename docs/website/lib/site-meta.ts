export const SITE_NAME = "Nakama";
export const SITE_TAGLINE = "AI agents that work with your team.";
export const SITE_DESCRIPTION =
  "Nakama is an open-source platform for teams to build and run AI agents with their own memory, tools, and workspaces. Self-host or use managed hosting.";
export const SITE_URL =
  process.env.NAKAMA_DOCS_SITE_URL ?? "https://ahmadrosid.github.io/nakama";
export const AUTHOR_NAME = "Ahmad Rosid";
export const AUTHOR_ROLE = "Creator and maintainer of Nakama";
export const OG_IMAGE_URL = `${SITE_URL}/nakama-demo.png`;

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

/** JSON.stringify does not HTML-escape; unicode-escape markup so `</script>` cannot break out. */
export function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export interface PageMetadata {
  description: string;
  relativePath: string;
  title: string;
}

export function buildPageMetadata(
  relativePath: string,
  pageTitle: string,
  pageDescription: string
) {
  const title =
    pageTitle === SITE_NAME ? SITE_NAME : `${pageTitle} | ${SITE_NAME}`;
  const description = pageDescription || SITE_DESCRIPTION;
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

export function buildLlmsTxt(pages: PageMetadata[]) {
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
    '2. Pick the best page from the inventory below.',
    `3. web_fetch the matching .md page (for example ${SITE_URL}/telegram/index.md).`,
    "4. Do not use knowledge_base_search for these URLs — that tool only searches uploaded profile documents.",
    "5. Answer from the fetched page. Do not guess steps that are not in the docs.",
    "",
    "Markdown mirrors use a `.md` suffix on the same path as the HTML docs.",
    "",
    "## Documentation",
    "",
    ...pages.map(
      (page) =>
        `- [${page.title}](${getMarkdownUrl(page.relativePath)}): ${page.description}`
    ),
  ];

  return `${lines.join("\n")}\n`;
}
