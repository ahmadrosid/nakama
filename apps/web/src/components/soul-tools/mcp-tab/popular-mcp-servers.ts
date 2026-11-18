/**
 * Apps offered as one-click presets. They connect through Composio when it
 * can. An app with a `url` falls back to its own MCP sign-in when Composio
 * cannot connect it. Each `toolkit` must have Composio-managed sign-in; an
 * app without one always uses its own MCP sign-in.
 *
 * Not offered: Canva. Its MCP server refuses an OAuth redirect to any host it
 * has not allowlisted, Composio's `canva_mcp` has no managed sign-in, and the
 * `canva` toolkit can only create blank designs. Higgsfield has no managed
 * sign-in either.
 * Logos are single-path SVGs in the text color, or brand-colored `layers`
 * painted in order.
 */
export const POPULAR_SERVERS = [
  {
    description: "Read and write your pages and databases",
    name: "Notion",
    path: "M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z",
    toolkit: "notion",
    url: "https://mcp.notion.com/mcp",
    viewBox: "0 0 24 24",
  },
  {
    description: "Schedule social posts and answer comments and DMs",
    layers: [
      {
        fill: "#ffffff",
        path: "M 12.07 1.11 C 7.36 1.4, 4.09 2.77, 2.18 5.24 C -0.05 8.15, -0.28 12.88, 1.68 15.53 C 2.06 16.05, 2.05 16.24, 1.55 17.25 C 1.2 17.97, 1.13 18.25, 1.22 18.55 C 1.5 19.43, 2.55 19.45, 4.17 18.62 C 4.49 18.45, 4.9 18.24, 5.08 18.15 C 5.55 17.9, 5.85 17.89, 6.4 18.11 C 7.14 18.39, 7.69 18.48, 8.18 18.38 C 8.45 18.33, 8.48 18.35, 8.48 18.58 C 8.48 19.54, 9.65 20.65, 11.17 21.16 C 12.8 21.71, 14.95 21.75, 16.88 21.28 C 18.11 20.98, 18.27 21.01, 19.22 21.72 C 20.65 22.8, 21.79 23.03, 22.42 22.38 C 22.87 21.92, 22.83 21.39, 22.22 20.01 C 21.79 19.03, 21.79 18.79, 22.23 18.13 C 23.31 16.5, 23.81 14.34, 23.63 12.09 C 23.36 8.86, 22 7.07, 19.39 6.54 C 19.27 6.51, 19.26 6.5, 19.28 6.36 C 19.55 4.62, 19.21 3.47, 18.15 2.56 C 16.96 1.54, 14.51 0.96, 12.07 1.11",
      },
      {
        fill: "#131110",
        path: "M 11.11 1.97 C 6.04 2.43, 3 4.23, 1.66 7.56 C 0.66 10.05, 0.91 13.31, 2.25 15.09 C 2.85 15.88, 2.84 16.25, 2.22 17.51 C 1.87 18.22, 1.86 18.32, 2.15 18.49 C 2.3 18.58, 2.31 18.58, 2.67 18.49 C 3.25 18.35, 3.64 18.17, 4.57 17.61 C 5.27 17.18, 5.9 17.14, 6.75 17.48 C 7.44 17.76, 8.12 17.8, 8.35 17.57 C 8.47 17.45, 8.47 17.45, 8.18 17.06 C 6.88 15.33, 6.6 12.81, 7.51 11 C 8.78 8.44, 11.44 7.19, 15.14 7.41 C 16.85 7.51, 17.14 7.48, 17.64 7.15 C 18.3 6.73, 18.62 6.1, 18.62 5.21 C 18.62 3.53, 17.38 2.49, 14.89 2.06 C 14.25 1.95, 11.95 1.89, 11.11 1.97",
      },
      {
        fill: "#fd84bc",
        path: "M 18.14 7.34 C 17.09 7.63, 16.63 8.46, 17.04 9.35 C 17.09 9.48, 17.27 9.78, 17.43 10.02 C 18.41 11.52, 17.98 13.22, 16.43 13.97 C 15.65 14.34, 15.2 14.39, 12.44 14.39 C 10.89 14.39, 10.19 14.41, 10.11 14.44 C 9.61 14.67, 10.18 15.88, 11.08 16.5 C 11.9 17.06, 12.59 17.22, 14.13 17.22 C 15.45 17.23, 15.46 17.23, 15.67 17.49 C 16.1 17.99, 15.49 18.64, 14.3 18.93 C 12.86 19.29, 11.34 19.13, 9.93 18.49 C 9.11 18.11, 8.92 18.51, 9.56 19.3 C 10.8 20.83, 13.79 21.35, 16.98 20.57 C 18.27 20.26, 18.52 20.31, 19.62 21.14 C 20.75 21.99, 21.56 22.27, 21.89 21.94 C 22.13 21.7, 22.1 21.59, 21.52 20.26 C 21 19.09, 21.02 18.62, 21.59 17.76 C 22.56 16.31, 22.9 15.02, 22.9 12.75 C 22.89 10.01, 22.11 8.4, 20.42 7.62 C 19.74 7.3, 18.71 7.18, 18.14 7.34 M 12.35 10.15 C 11.17 10.41, 10.27 11.13, 9.98 12.04 C 9.74 12.83, 9.66 12.81, 12.06 12.79 C 14.18 12.77, 14.3 12.75, 14.75 12.45 C 15.48 11.95, 15.29 10.8, 14.39 10.34 C 13.93 10.1, 12.98 10.01, 12.35 10.15",
      },
    ],
    name: "Eksis",
    url: "https://api.eksis.io/mcp",
    viewBox: "0 0 24 24",
  },
] as const;

/**
 * Presets Composio can connect, or that have their own MCP sign-in, that the
 * org has not registered as an MCP server yet, matched by name.
 */
export function unregisteredPopularServers(
  registered: readonly { name: string }[] = [],
  composioToolkits: readonly { slug: string }[] = []
) {
  const names = new Set(registered.map((item) => item.name.toLowerCase()));
  const slugs = new Set(composioToolkits.map((item) => item.slug));

  return POPULAR_SERVERS.filter(
    (item) =>
      (("toolkit" in item && slugs.has(item.toolkit)) || "url" in item) &&
      !names.has(item.name.toLowerCase())
  );
}

/**
 * The Composio toolkit to connect `app` through, or null when Composio does
 * not offer it here and the app signs in to its own MCP server instead.
 */
export function composioToolkitFor(
  app: (typeof POPULAR_SERVERS)[number],
  offered: readonly { slug: string }[]
) {
  const slug = "toolkit" in app ? app.toolkit : null;

  return slug && offered.some((toolkit) => toolkit.slug === slug) ? slug : null;
}
