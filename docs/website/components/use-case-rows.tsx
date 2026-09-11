const useCases = [
  {
    details:
      "Use Nakama as the agent backend for your customer-facing application.",
    title: "Build an AI product",
  },
  {
    details:
      "Use agents to find ideas and prepare posts for your team's review.",
    title: "Manage social media",
  },
  {
    details:
      "Work with a team of agents to research, draft, and edit your book.",
    title: "Write a book with multiple agents",
  },
  {
    details: "Gather updates and prepare reports on a recurring schedule.",
    title: "Automate daily reports",
  },
  {
    details:
      "Build agents that edit long recordings into videos for Reels and TikTok.",
    title: "Turn podcasts into short clips",
  },
];

export function UseCaseRows() {
  return (
    <ol className="divide-y divide-stone-200 border-stone-200 border-y dark:divide-white/10 dark:border-white/10">
      {useCases.map(({ title, details }, index) => (
        <li className="flex gap-5 py-7 sm:gap-6" key={title}>
          <span
            aria-hidden
            className="pt-1 font-mono text-orange-700 text-sm dark:text-orange-400"
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <h3 className="text-balance font-medium text-lg text-stone-900 tracking-tight sm:text-xl dark:text-white">
              {title}
            </h3>
            <p className="mt-2 max-w-lg text-sm text-stone-600 leading-relaxed dark:text-white/50">
              {details}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
