import { RootProvider } from 'fumadocs-ui/provider/next'
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import {
  OG_IMAGE_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from '@/lib/site-meta'
import { withBasePath } from '@/lib/base-path'
import './global.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  icons: {
    icon: withBasePath('/favicon.png'),
  },
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    images: [{ url: OG_IMAGE_URL }],
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col font-sans">
        <RootProvider
          search={{
            options: {
              type: 'static',
              api: withBasePath('/api/search'),
            },
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  )
}
