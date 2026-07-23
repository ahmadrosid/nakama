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
import { withBasePath } from '@/lib/base-path'
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site-meta'

export const metadata: Metadata = {
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
}

const GITHUB_REPO_URL = 'https://github.com/ahmadrosid/nakama'

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
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
    <div className="landing flex min-h-screen flex-col">
      <header className="landing-header sticky top-0 z-40 border-b border-white/5 px-6 py-3.5 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="text-lg font-semibold tracking-tight text-white">
            Nakama
          </Link>
          <div className="flex items-center gap-5 text-sm text-white/55">
            <Link href="/docs" className="transition-colors hover:text-white">
              Docs
            </Link>
            <a
              href="https://getnakama.cloud/"
              className="hidden transition-colors hover:text-white sm:inline"
              target="_blank"
              rel="noreferrer"
            >
              Managed hosting
            </a>
            <a
              href={GITHUB_REPO_URL}
              className="inline-flex items-center justify-center transition-colors hover:text-white"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub repository"
            >
              <GitHubIcon className="size-4" />
            </a>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <section className="hero-section px-4 pt-4 md:px-6 md:pt-6">
          <div className="hero-frame relative mx-auto w-full max-w-6xl overflow-hidden rounded-2xl border border-zinc-500/30">
            <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
            <div className="hero-noise pointer-events-none absolute inset-0" aria-hidden />
            <div className="hero-orb pointer-events-none absolute" aria-hidden />
            <div className="hero-halftone pointer-events-none absolute inset-0" aria-hidden />

            <div className="relative z-20 flex min-h-[28rem] flex-col px-6 pt-12 pb-36 md:min-h-[32rem] md:px-10 md:pt-14 md:pb-40 lg:min-h-[36rem] lg:px-12 lg:pt-16 lg:pb-44">
              <div className="max-w-xl text-center md:text-left">
                <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                  AI agents that work with{' '}
                  <span className="landing-accent">your team.</span>
                </h1>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-3 md:justify-start">
                  <Link
                    href="/quickstart"
                    className="hero-cta-primary inline-flex items-center gap-2"
                  >
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
            </div>

            <div className="hero-preview pointer-events-none absolute right-0 bottom-0 left-[12%] z-10 translate-y-[48%] sm:left-[18%] sm:translate-y-[50%] md:left-[22%] md:translate-y-[52%] lg:left-[26%]">
              <div className="overflow-hidden rounded-t-xl border border-b-0 border-white/12 bg-[#0d0d0f] shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.75)]">
                <div className="flex items-center gap-1.5 border-b border-white/8 px-3 py-2.5">
                  <span className="size-2.5 rounded-full bg-white/15" />
                  <span className="size-2.5 rounded-full bg-white/15" />
                  <span className="size-2.5 rounded-full bg-white/15" />
                  <span className="ml-2 text-[11px] text-white/35">nakama · dashboard</span>
                </div>
                <img
                  src={withBasePath('/nakama-demo.png')}
                  alt="Nakama dashboard preview"
                  className="block w-full"
                  width={960}
                  height={640}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 py-24 md:py-32">
          <p className="landing-lede mx-auto max-w-4xl text-center text-2xl leading-snug font-light tracking-tight text-white/70 md:text-4xl md:leading-snug">
            <span className="landing-accent font-medium">Nakama</span> gives each agent a role,
            tools, and memory — then runs your whole{' '}
            <span className="landing-accent font-medium">team</span> from one deployment.
          </p>
        </section>

        <section className="px-6 pb-16 md:pb-24">
          <div className="mx-auto max-w-6xl">
            <div className="mb-10 max-w-2xl">
              <h2 className="landing-section-title text-3xl font-medium tracking-tight md:text-4xl">
                Your whole nakama.
              </h2>
              <p className="mt-3 text-white/50">
                Profiles, orgs, channels, and tools — focused agents, shared ops.
              </p>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon
                return (
                  <li key={feature.title}>
                    <article className="feature-card group flex h-full flex-col rounded-2xl border border-white/8 bg-[#111113] p-6">
                      <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--landing-brand)_12%,transparent)] text-[var(--landing-brand)] transition-colors group-hover:bg-[color-mix(in_oklab,var(--landing-brand)_18%,transparent)]">
                        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                      </div>
                      <h3 className="mb-2 text-base font-semibold tracking-tight text-white">
                        {feature.title}
                      </h3>
                      <p className="text-sm leading-relaxed text-white/50">{feature.details}</p>
                    </article>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        <section className="border-t border-white/5 px-6 py-16 md:py-20">
          <div className="mx-auto flex max-w-6xl flex-col items-stretch justify-between gap-8 rounded-2xl border border-white/8 bg-[#111113] p-8 sm:items-start lg:flex-row lg:items-center lg:p-10">
            <div className="max-w-xl">
              <h2 className="landing-section-title text-2xl font-medium tracking-tight md:text-3xl">
                Open source forever.
              </h2>
              <p className="mt-3 text-white/50">
                Deploy once — or use managed hosting — create orgs and profiles, and route each task
                to the right agent.
              </p>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:flex-row">
              <Link
                href="/quickstart"
                className="hero-cta-primary inline-flex w-full items-center justify-center gap-2 sm:w-auto"
              >
                Read the docs
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <a
                href="https://github.com/ahmadrosid/nakama"
                className="hero-cta-secondary w-full justify-center sm:w-auto"
                target="_blank"
                rel="noreferrer"
              >
                Open GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 px-6 py-6 text-center text-sm text-white/40">
        <p>Released under the MIT License.</p>
        <p>Copyright © Nakama contributors</p>
      </footer>
    </div>
  )
}
