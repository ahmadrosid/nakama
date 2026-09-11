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
import Image from "next/image";
import Link from "next/link";
import { HeroPaperBackground } from "@/components/hero-paper-background";
import { UseCaseRows } from "@/components/use-case-rows";
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
    details:
      "Give each agent its own workspace, memory, instructions, and tools.",
    icon: BotIcon,
    title: "Every agent has a role",
  },
  {
    details:
      "Add the capabilities your team needs with custom plugins, skills, and tools.",
    icon: PackageIcon,
    title: "Build on your own terms",
  },
  {
    details:
      "Run multiple organizations on one instance, each with its own members, agents, and separate data.",
    icon: Building01Icon,
    title: "Built for multiple teams",
  },
  {
    details:
      "Schedule recurring work and let agents turn successful workflows into reusable skills.",
    icon: SparklesIcon,
    title: "Automate and keep learning",
  },
  {
    details:
      "Work with your agents on the web, in the terminal, or through Telegram, WhatsApp, and Discord.",
    icon: MessageMultiple01Icon,
    title: "Meet your team where they work",
  },
  {
    details:
      "Run Nakama on your own infrastructure or let us handle hosting for you.",
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
        <section className="hero-section pt-4 md:pt-8">
          <div className="hero-frame relative isolate w-full overflow-hidden">
            <HeroPaperBackground />

            <div className="relative z-10 mx-auto flex min-h-[24rem] max-w-5xl flex-col items-center justify-center px-5 py-16 sm:min-h-[30rem] sm:py-20">
              <div className="w-full text-center">
                <h1 className="hero-heading text-balance text-4xl text-stone-900 leading-[1.1] tracking-tight sm:text-5xl lg:text-7xl dark:text-white">
                  <span className="block">AI agents that work</span>
                  <span className="block">with your team.</span>
                </h1>

                <p className="mx-auto mt-5 max-w-xl text-balance text-base text-stone-600 sm:text-lg dark:text-white/70">
                  An open-source platform to build, run, and manage AI agents
                  together.
                </p>

                <div className="hero-actions mt-8 flex flex-wrap items-center justify-center gap-3">
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
          </div>
        </section>

        <section
          aria-label="Dashboard preview"
          className="hero-preview mx-auto mt-4 w-[calc(100%_-_3rem)] max-w-6xl sm:mt-6"
        >
          <div className="overflow-hidden rounded-xl border border-black/10 bg-stone-50 shadow-2xl shadow-black/10 dark:border-white/10 dark:bg-[#0d0d0f]">
            <div className="flex items-center gap-1.5 border-stone-200 border-b px-3 py-2.5 dark:border-white/8">
              <span className="size-2.5 rounded-full bg-stone-300 dark:bg-white/15" />
              <span className="size-2.5 rounded-full bg-stone-300 dark:bg-white/15" />
              <span className="size-2.5 rounded-full bg-stone-300 dark:bg-white/15" />
              <span className="ml-2 text-[11px] text-stone-500 dark:text-white/35">
                nakama · dashboard
              </span>
            </div>
            <Image
              alt="Nakama chat preview"
              className="block h-auto w-full dark:hidden"
              height={800}
              src={withBasePath("/screenshots/chat-light.png")}
              width={1280}
            />
            <Image
              alt=""
              aria-hidden
              className="hidden h-auto w-full dark:block"
              height={800}
              src={withBasePath("/screenshots/chat-dark.png")}
              width={1280}
            />
          </div>
        </section>

        <section className="px-6 py-24 md:py-32">
          <p className="landing-lede mx-auto max-w-4xl text-center font-light text-2xl text-stone-600 leading-snug tracking-tight md:text-4xl md:leading-snug dark:text-white/70">
            Build a team of agents around the way you work. Give each one a
            role, memory, and tools, then bring them together for bigger
            projects.
          </p>
        </section>

        <section className="px-6 pb-16 md:pb-24">
          <div className="mx-auto max-w-6xl">
            <div className="mb-10 max-w-2xl">
              <h2 className="landing-section-title font-medium text-3xl tracking-tight md:text-4xl">
                Give your agents a place on the team.
              </h2>
              <p className="mt-3 text-stone-600 dark:text-white/50">
                Inspired by Hermes Agent and OpenClaw, Nakama brings memory,
                skills, tools, and automation into a platform built for teams.
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

        <section className="px-6 pb-16 md:pb-24">
          <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[0.8fr_1.2fr] md:gap-12 lg:gap-20">
            <div className="md:pt-7">
              <h2 className="landing-section-title max-w-sm text-balance font-medium text-3xl tracking-tight md:text-4xl">
                What people are building with Nakama
              </h2>
              <p className="mt-4 max-w-sm text-stone-600 leading-relaxed dark:text-white/50">
                These are workflows our users already run. We’re still exploring
                what else Nakama can help teams do.
              </p>
            </div>
            <UseCaseRows />
          </div>
        </section>

        <section className="border-stone-200 border-t px-6 py-16 md:py-20 dark:border-white/5">
          <div className="mx-auto flex max-w-6xl flex-col items-stretch justify-between gap-8 rounded-2xl border border-stone-200 bg-white p-8 sm:items-start lg:flex-row lg:items-center lg:p-10 dark:border-white/8 dark:bg-[#111113]">
            <div className="max-w-xl">
              <h2 className="landing-section-title font-medium text-2xl tracking-tight md:text-3xl">
                What will you build with Nakama?
              </h2>
              <p className="mt-3 text-stone-600 dark:text-white/50">
                Create your first agent, automate a workflow, or build something
                for your customers. Start with the docs and make it your own.
              </p>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:flex-row">
              <Link
                className="hero-cta-primary inline-flex w-full items-center justify-center gap-2 sm:w-auto"
                href="/quickstart"
              >
                Create your first agent
                <ArrowRight01Icon aria-hidden className="size-4" />
              </Link>
              <a
                className="hero-cta-secondary w-full justify-center sm:w-auto"
                href="https://getnakama.cloud/"
                rel="noreferrer"
                target="_blank"
              >
                Explore managed hosting
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
