import { ArrowRight01Icon } from "hugeicons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyCommand } from "@/components/copy-command";
import { withBasePath } from "@/lib/base-path";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site-meta";

export const metadata: Metadata = {
  description: SITE_DESCRIPTION,
  title: SITE_NAME,
};

const GITHUB_REPO_URL = "https://github.com/ahmadrosid/nakama";
const DEMO_URL = "https://demo.getnakama.cloud";
const MANAGED_URL = "https://getnakama.cloud/";
const DOCKER_COMMAND = `docker pull ghcr.io/ahmadrosid/nakama:latest
docker run -d -p 4310:4310 -v nakama-data:/nakama/data --name nakama ghcr.io/ahmadrosid/nakama:latest`;

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

const proofPoints: Array<{ title: string; details: string }> = [
  {
    details:
      "API, web dashboard, and Telegram / WhatsApp / Discord workers in one image.",
    title: "Single Docker container",
  },
  {
    details:
      "Organizations isolate profiles, sessions, tools, skills, and usage by org_id.",
    title: "Multi-tenant orgs",
  },
  {
    details:
      "Each profile has SOUL.md, STYLE.md, INSTRUCTIONS.md, MEMORY.md, and tool access.",
    title: "Profiles with a soul",
  },
  {
    details:
      "Web dashboard, CLI, Telegram, WhatsApp, and Discord on one backend.",
    title: "Same agents, many channels",
  },
];

export default function HomePage() {
  return (
    <div className="landing flex min-h-screen flex-col">
      <header className="landing-header sticky top-0 z-40 border-b px-6 py-3.5">
        <nav className="mx-auto flex max-w-6xl items-center justify-between">
          <Link
            className="landing-display text-2xl text-stone-900 dark:text-white"
            href="/"
          >
            Nakama
          </Link>
          <div className="flex items-center gap-5 text-sm text-stone-600 dark:text-white/55">
            <a
              className="transition-colors hover:text-stone-900 dark:hover:text-white"
              href="#deploy"
            >
              Deploy
            </a>
            <Link
              className="transition-colors hover:text-stone-900 dark:hover:text-white"
              href="/quickstart"
            >
              Docs
            </Link>
            <a
              className="hidden transition-colors hover:text-stone-900 sm:inline dark:hover:text-white"
              href={DEMO_URL}
              rel="noreferrer"
              target="_blank"
            >
              Demo
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
          <div className="hero-frame relative mx-auto w-full max-w-6xl overflow-hidden rounded-lg border">
            <div className="relative z-20 flex min-h-[28rem] flex-col px-6 pt-12 pb-36 md:min-h-[32rem] md:px-10 md:pt-14 md:pb-40 lg:min-h-[36rem] lg:px-12 lg:pt-16 lg:pb-44">
              <div className="max-w-2xl text-center md:text-left">
                <p className="mb-4 font-mono text-stone-500 text-xs uppercase tracking-wide dark:text-white/40">
                  Open source · self-host or managed
                </p>
                <h1 className="landing-display text-4xl text-stone-900 leading-[1.08] sm:text-5xl lg:text-6xl dark:text-white">
                  AI agents that work with{" "}
                  <span className="landing-accent">your team.</span>
                </h1>
                <p className="mt-5 max-w-xl text-base text-stone-600 leading-relaxed md:text-lg dark:text-white/60">
                  Multi-tenant agent platform for builders who want profiles,
                  tools, and channels on infrastructure they control — one
                  Docker container, or run from source with Bun.
                </p>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-3 md:justify-start">
                  <a
                    className="hero-cta-primary inline-flex items-center gap-2"
                    href="#deploy"
                  >
                    Self-host with Docker
                    <ArrowRight01Icon aria-hidden className="size-4" />
                  </a>
                  <a
                    className="hero-cta-secondary"
                    href={DEMO_URL}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Try the demo
                  </a>
                  <Link className="hero-cta-secondary" href="/quickstart">
                    Quickstart
                  </Link>
                </div>
              </div>
            </div>

            <div className="hero-preview pointer-events-none absolute right-0 bottom-0 left-[12%] z-10 translate-y-[48%] sm:left-[18%] sm:translate-y-[50%] md:left-[22%] md:translate-y-[52%] lg:left-[26%]">
              <div className="overflow-hidden rounded-t-lg border border-stone-300 border-b-0 bg-stone-50 dark:border-white/12 dark:bg-[#0d0d0f]">
                <div className="flex items-center gap-1.5 border-stone-200 border-b px-3 py-2.5 dark:border-white/8">
                  <span className="size-2.5 rounded-full border border-stone-300 dark:border-white/20" />
                  <span className="size-2.5 rounded-full border border-stone-300 dark:border-white/20" />
                  <span className="size-2.5 rounded-full border border-stone-300 dark:border-white/20" />
                  <span className="ml-2 font-mono text-[11px] text-stone-500 dark:text-white/35">
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

        <section className="px-6 pt-28 pb-16 md:pt-36 md:pb-24" id="deploy">
          <div className="mx-auto max-w-6xl">
            <div className="mb-8 max-w-2xl">
              <h2 className="landing-section-title text-3xl md:text-4xl">
                Deploy in two commands.
              </h2>
              <p className="mt-3 text-stone-600 dark:text-white/50">
                Pull the prebuilt image, start the container, open{" "}
                <code className="font-mono text-[13px]">
                  http://localhost:4310
                </code>
                , then finish the setup wizard.
              </p>
            </div>

            <CopyCommand command={DOCKER_COMMAND} />

            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-600 dark:text-white/50">
              <Link
                className="underline-offset-4 hover:text-stone-900 hover:underline dark:hover:text-white"
                href="/docker"
              >
                Docker docs
              </Link>
              <Link
                className="underline-offset-4 hover:text-stone-900 hover:underline dark:hover:text-white"
                href="/first-time-setup"
              >
                First-time setup
              </Link>
              <Link
                className="underline-offset-4 hover:text-stone-900 hover:underline dark:hover:text-white"
                href="/quickstart"
              >
                Bun from source
              </Link>
              <a
                className="underline-offset-4 hover:text-stone-900 hover:underline dark:hover:text-white"
                href={MANAGED_URL}
                rel="noreferrer"
                target="_blank"
              >
                Managed hosting
              </a>
            </div>
          </div>
        </section>

        <section className="border-stone-200 border-t px-6 py-16 md:py-24 dark:border-white/10">
          <div className="mx-auto max-w-6xl">
            <div className="mb-10 max-w-2xl">
              <h2 className="landing-section-title text-3xl md:text-4xl">
                Built for teams that self-host.
              </h2>
              <p className="mt-3 text-stone-600 dark:text-white/50">
                Facts from the product — not slogans.
              </p>
            </div>

            <ul className="border border-stone-200 dark:border-white/10">
              {proofPoints.map((point) => (
                <li
                  className="proof-row grid gap-2 px-5 py-5 sm:grid-cols-[14rem_1fr] sm:gap-8"
                  key={point.title}
                >
                  <h3 className="font-medium text-stone-900 dark:text-white">
                    {point.title}
                  </h3>
                  <p className="text-sm text-stone-600 leading-relaxed dark:text-white/50">
                    {point.details}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-stone-200 border-t px-6 py-16 md:py-20 dark:border-white/10">
          <div className="mx-auto flex max-w-6xl flex-col items-stretch justify-between gap-8 border border-stone-200 bg-white p-8 sm:items-start lg:flex-row lg:items-center lg:p-10 dark:border-white/10 dark:bg-[#111113]">
            <div className="max-w-xl">
              <h2 className="landing-section-title text-2xl md:text-3xl">
                Open source under MIT.
              </h2>
              <p className="mt-3 text-stone-600 dark:text-white/50">
                Clone the repo, run Docker or Bun, create orgs and profiles, and
                route work to the right agent.
              </p>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:flex-row">
              <a
                className="hero-cta-primary inline-flex w-full items-center justify-center gap-2 sm:w-auto"
                href="#deploy"
              >
                Copy Docker commands
                <ArrowRight01Icon aria-hidden className="size-4" />
              </a>
              <a
                className="hero-cta-secondary w-full justify-center sm:w-auto"
                href={GITHUB_REPO_URL}
                rel="noreferrer"
                target="_blank"
              >
                Open GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-stone-200 border-t px-6 py-6 text-center text-sm text-stone-500 dark:border-white/10 dark:text-white/40">
        <p>Released under the MIT License.</p>
        <p>Copyright © Nakama contributors</p>
      </footer>
    </div>
  );
}
