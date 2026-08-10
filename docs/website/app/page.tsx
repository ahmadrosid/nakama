import {
  ArrowRight01Icon,
  BotIcon,
  Building01Icon,
  CloudIcon,
  MessageMultiple01Icon,
  PackageIcon,
  SparklesIcon,
} from "hugeicons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { HeroPaperBackground } from "@/components/hero-paper-background";
import { withBasePath } from "@/lib/base-path";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site-meta";

export const metadata: Metadata = {
  description: SITE_DESCRIPTION,
  title: SITE_NAME,
};

const GITHUB_REPO_URL = "https://github.com/ahmadrosid/nakama";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="currentColor"
      viewBox="0 0 16 16"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const features: Array<{
  title: string;
  details: string;
  icon: typeof BotIcon;
}> = [
  {
    details: "Identity, instructions, tools, and knowledge per profile.",
    icon: BotIcon,
    title: "Every agent has a role",
  },
  {
    details: "One server — shared orgs, channels, and ops.",
    icon: PackageIcon,
    title: "Your nakama, one deployment",
  },
  {
    details: "Orgs, members, profiles, and tools — isolated by tenant.",
    icon: Building01Icon,
    title: "Multi-tenant by design",
  },
  {
    details: "Soul files, skills, knowledge bases, and MCP per agent.",
    icon: SparklesIcon,
    title: "Flexible agent behavior",
  },
  {
    details: "Web, CLI, Telegram, WhatsApp, and Discord.",
    icon: MessageMultiple01Icon,
    title: "Works across channels",
  },
  {
    details: "Docker, self-host, or getnakama.cloud — open source.",
    icon: CloudIcon,
    title: "Self-hosted or managed",
  },
];

export default function HomePage() {
  return (
    <div className="landing flex min-h-screen flex-col">
      <header className="landing-header sticky top-0 z-40 border-b px-6 py-3.5 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between">
          <Link
            className="font-semibold text-lg text-stone-900 tracking-tight dark:text-white"
            href="/"
          >
            Nakama
          </Link>
          <div className="flex items-center gap-5 text-sm text-stone-600 dark:text-white/55">
            <Link
              className="transition-colors hover:text-stone-900 dark:hover:text-white"
              href="/docs"
            >
              Docs
            </Link>
            <a
              className="hidden transition-colors hover:text-stone-900 sm:inline dark:hover:text-white"
              href="https://getnakama.cloud/"
              rel="noreferrer"
              target="_blank"
            >
              Managed hosting
            </a>
            <a
              aria-label="GitHub repository"
              className="inline-flex items-center justify-center transition-colors hover:text-stone-900 dark:hover:text-white"
              href={GITHUB_REPO_URL}
              rel="noreferrer"
              target="_blank"
            >
              <GitHubIcon className="size-4" />
            </a>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <section className="hero-section px-4 pt-4 md:px-6 md:pt-6">
          <div className="hero-frame relative mx-auto w-full max-w-6xl overflow-hidden rounded-2xl border border-stone-300/70 dark:border-zinc-500/30">
            <HeroPaperBackground />

            <div className="relative z-20 flex min-h-[28rem] flex-col px-6 pt-12 pb-36 md:min-h-[32rem] md:px-10 md:pt-14 md:pb-40 lg:min-h-[36rem] lg:px-12 lg:pt-16 lg:pb-44">
              <div className="max-w-xl text-center md:text-left">
                <h1 className="font-semibold text-4xl text-stone-900 leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl dark:text-white">
                  AI agents that work with{" "}
                  <span className="landing-accent">your team.</span>
                </h1>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-3 md:justify-start">
                  <Link
                    className="hero-cta-primary inline-flex items-center gap-2"
                    href="/quickstart"
                  >
                    Get Started
                    <ArrowRight01Icon aria-hidden className="size-4" />
                  </Link>
                  <a
                    className="hero-cta-secondary"
                    href="https://getnakama.cloud/"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Managed hosting
                  </a>
                  <a
                    className="hero-cta-secondary"
                    href="https://github.com/ahmadrosid/nakama"
                    rel="noreferrer"
                    target="_blank"
                  >
                    GitHub
                  </a>
                </div>
              </div>
            </div>

            <div className="hero-preview pointer-events-none absolute right-0 bottom-0 left-[12%] z-10 translate-y-[48%] sm:left-[18%] sm:translate-y-[50%] md:left-[22%] md:translate-y-[52%] lg:left-[26%]">
              <div className="overflow-hidden rounded-t-xl border border-stone-200 border-b-0 bg-stone-50 shadow-[0_-20px_60px_-20px_rgba(28,25,23,0.18)] dark:border-white/12 dark:bg-[#0d0d0f] dark:shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.75)]">
                <div className="flex items-center gap-1.5 border-stone-200 border-b px-3 py-2.5 dark:border-white/8">
                  <span className="size-2.5 rounded-full bg-stone-300 dark:bg-white/15" />
                  <span className="size-2.5 rounded-full bg-stone-300 dark:bg-white/15" />
                  <span className="size-2.5 rounded-full bg-stone-300 dark:bg-white/15" />
                  <span className="ml-2 text-[11px] text-stone-500 dark:text-white/35">
                    nakama · dashboard
                  </span>
                </div>
                <img
                  alt="Nakama chat preview"
                  className="block w-full dark:hidden"
                  height={640}
                  src={withBasePath("/screenshots/chat-light.png")}
                  width={960}
                />
                <img
                  alt=""
                  aria-hidden
                  className="hidden w-full dark:block"
                  height={640}
                  src={withBasePath("/screenshots/chat-dark.png")}
                  width={960}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 py-24 md:py-32">
          <p className="landing-lede mx-auto max-w-4xl text-center font-light text-2xl text-stone-600 leading-snug tracking-tight md:text-4xl md:leading-snug dark:text-white/70">
            <span className="landing-accent font-medium">Nakama</span> gives
            each agent a role, tools, and memory — then runs your whole{" "}
            <span className="landing-accent font-medium">team</span> from one
            deployment.
          </p>
        </section>

        <section className="px-6 pb-16 md:pb-24">
          <div className="mx-auto max-w-6xl">
            <div className="mb-10 max-w-2xl">
              <h2 className="landing-section-title font-medium text-3xl tracking-tight md:text-4xl">
                Your whole nakama.
              </h2>
              <p className="mt-3 text-stone-600 dark:text-white/50">
                Profiles, orgs, channels, and tools — focused agents, shared
                ops.
              </p>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <li key={feature.title}>
                    <article className="feature-card group flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-6 dark:border-white/8 dark:bg-[#111113]">
                      <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--landing-brand)_12%,transparent)] text-[var(--landing-brand)] transition-colors group-hover:bg-[color-mix(in_oklab,var(--landing-brand)_18%,transparent)]">
                        <Icon
                          aria-hidden
                          className="size-5"
                          strokeWidth={1.75}
                        />
                      </div>
                      <h3 className="mb-2 font-semibold text-base text-stone-900 tracking-tight dark:text-white">
                        {feature.title}
                      </h3>
                      <p className="text-sm text-stone-600 leading-relaxed dark:text-white/50">
                        {feature.details}
                      </p>
                    </article>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="border-stone-200 border-t px-6 py-16 md:py-20 dark:border-white/5">
          <div className="mx-auto flex max-w-6xl flex-col items-stretch justify-between gap-8 rounded-2xl border border-stone-200 bg-white p-8 sm:items-start lg:flex-row lg:items-center lg:p-10 dark:border-white/8 dark:bg-[#111113]">
            <div className="max-w-xl">
              <h2 className="landing-section-title font-medium text-2xl tracking-tight md:text-3xl">
                Open source forever.
              </h2>
              <p className="mt-3 text-stone-600 dark:text-white/50">
                Deploy once — or use managed hosting — create orgs and profiles,
                and route each task to the right agent.
              </p>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:flex-row">
              <Link
                className="hero-cta-primary inline-flex w-full items-center justify-center gap-2 sm:w-auto"
                href="/quickstart"
              >
                Read the docs
                <ArrowRight01Icon aria-hidden className="size-4" />
              </Link>
              <a
                className="hero-cta-secondary w-full justify-center sm:w-auto"
                href="https://github.com/ahmadrosid/nakama"
                rel="noreferrer"
                target="_blank"
              >
                Open GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-stone-200 border-t px-6 py-6 text-center text-sm text-stone-500 dark:border-white/5 dark:text-white/40">
        <p>Released under the MIT License.</p>
        <p>Copyright © Nakama contributors</p>
      </footer>
    </div>
  );
}
