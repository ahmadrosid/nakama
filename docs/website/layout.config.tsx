import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    githubUrl: "https://github.com/ahmadrosid/nakama",
    links: [
      {
        external: true,
        text: "Managed hosting",
        url: "https://getnakama.cloud/",
      },
    ],
    nav: {
      title: "Nakama",
    },
  };
}
