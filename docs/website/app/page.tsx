import Link from 'next/link'
import type { Metadata } from 'next'
import {
  ArrowRight,
  Bot,
  Boxes,
  Building2,
  Cloud,
  MessagesSquare,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from '@/lib/site-meta'

export const metadata: Metadata = {
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
}

const features: Array<{ title: string; details: string; icon: LucideIcon }> = [
  {
    icon: Bot,
    title: 'Every agent has a role',
    details: 'Identity, instructions, tools, and knowledge per profile.',
  },
  {
    icon: Boxes,
    title: 'Your nakama, one deployment',
    details: 'One server — shared orgs, channels, and ops.',
  },
  {
    icon: Building2,
    title: 'Multi-tenant by design',
    details: 'Orgs, members, profiles, and tools — isolated by tenant.',
  },
  {
    icon: Sparkles,
    title: 'Flexible agent behavior',
    details: 'Soul files, skills, knowledge bases, and MCP per agent.',
  },
  {
    icon: MessagesSquare,
    title: 'Works across channels',
    details: 'Web, CLI, Telegram, WhatsApp, and Discord.',
  },
  {
    icon: Cloud,
    title: 'Self-hosted or managed',
    details: 'Docker, self-host, or getnakama.cloud — open source.',
  },
]

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-fd-border px-6 py-4">
        <nav className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="text-lg font-semibold">Nakama</span>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/docs" className="text-fd-muted-foreground hover:text-fd-foreground">
              Docs
            </Link>
            <a
              href="https://getnakama.cloud/"
              className="text-fd-muted-foreground hover:text-fd-foreground"
              target="_blank"
              rel="noreferrer"
            >
              Managed hosting
            </a>
            <a
              href="https://github.com/ahmadrosid/nakama"
              className="text-fd-muted-foreground hover:text-fd-foreground"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <section className="hero-section relative overflow-hidden border-b border-fd-border">
          <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
          <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden />

          <div className="relative mx-auto max-w-5xl px-6 py-16 text-center md:py-24">
            <h1 className="mx-auto max-w-3xl">
              <span className="hero-gradient hero-title block text-5xl font-bold tracking-tight md:text-7xl">
                Nakama
              </span>
              <span className="mt-4 block text-2xl font-semibold tracking-tight text-fd-foreground md:text-4xl">
                {SITE_TAGLINE}
              </span>
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
              Give each agent a role, assign tools and memory, and run your whole nakama from one
              deployment.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/quickstart" className="hero-cta-primary inline-flex items-center gap-2">
                Get Started
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <a
                href="https://getnakama.cloud/"
                className="hero-cta-secondary"
                target="_blank"
                rel="noreferrer"
              >
                Managed hosting
              </a>
              <a
                href="https://github.com/ahmadrosid/nakama"
                className="hero-cta-secondary"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </div>
          </div>
        </section>

        <section className="border-t border-fd-border px-6 py-16 md:py-20">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <p className="mb-3 text-sm font-medium tracking-wide text-fd-primary uppercase">
                Teams of agents
              </p>
              <h2 className="mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
                One platform, whole nakama
              </h2>
              <p className="text-fd-muted-foreground">
                Profiles, orgs, channels, and tools — one deployment, focused agents.
              </p>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
              {features.map((feature) => {
                const Icon = feature.icon
                return (
                  <li key={feature.title}>
                    <article className="feature-card group flex h-full flex-col rounded-2xl border border-fd-border bg-fd-card p-6">
                      <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-fd-primary/10 text-fd-primary transition-colors group-hover:bg-fd-primary/15">
                        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                      </div>
                      <h3 className="mb-2 text-base font-semibold tracking-tight">
                        {feature.title}
                      </h3>
                      <p className="text-sm leading-relaxed text-fd-muted-foreground">
                        {feature.details}
                      </p>
                    </article>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        <section className="border-t border-fd-border px-6 py-12">
          <p className="mx-auto max-w-3xl text-center text-fd-muted-foreground">
            Deploy once (or use{' '}
            <a href="https://getnakama.cloud/" className="text-fd-primary hover:underline">
              managed hosting
            </a>
            ), create orgs and profiles, and route each task to the right agent.
          </p>
        </section>
      </main>

      <footer className="border-t border-fd-border px-6 py-6 text-center text-sm text-fd-muted-foreground">
        <p>Released under the MIT License.</p>
        <p>Copyright © Nakama contributors</p>
      </footer>
    </div>
  )
}
