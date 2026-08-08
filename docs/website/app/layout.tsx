import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { withBasePath } from "@/lib/base-path";
import {
  OG_IMAGE_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site-meta";
import "./global.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  description: SITE_DESCRIPTION,
  icons: {
    icon: [
      {
        media: "(prefers-color-scheme: light)",
        url: withBasePath("/favicon-light.png"),
      },
      {
        media: "(prefers-color-scheme: dark)",
        url: withBasePath("/favicon.png"),
      },
      { url: withBasePath("/favicon.png") },
    ],
  },
  metadataBase: new URL(SITE_URL),
  openGraph: {
    description: SITE_DESCRIPTION,
    images: [{ url: OG_IMAGE_URL }],
    title: SITE_NAME,
    url: SITE_URL,
  },
  title: SITE_NAME,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      className={`${jakarta.variable} ${jetbrains.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col font-sans">
        <RootProvider
          search={{
            options: {
              api: withBasePath("/api/search"),
              type: "static",
            },
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
