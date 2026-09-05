import { WorkflowRunCard } from "@/components/chat/WorkflowRunToolRow";
import type { WorkflowStepView } from "@/lib/chat-stream-workflow";

const morning: Omit<WorkflowStepView, "status" | "meta">[] = [
  {
    detail: "Web Fetch",
    id: "news",
    kind: "tool",
    tag: "bbc.com",
    title: "News",
    tool: "web_fetch",
  },
  {
    detail: "Web Fetch",
    id: "tech",
    kind: "tool",
    tag: "news.ycombinator.com",
    title: "Tech",
    tool: "web_fetch",
  },
  {
    detail: "Web Fetch",
    id: "markets",
    kind: "tool",
    tag: "bbc.com",
    title: "Markets",
    tool: "web_fetch",
  },
  {
    detail:
      "Write a concise morning brief from the fetched receipts only. Organize …",
    id: "summarize",
    kind: "summarize",
    tag: null,
    title: "Summarize",
    tool: null,
  },
];

function step(
  index: number,
  status: WorkflowStepView["status"],
  meta: string | null = null
): WorkflowStepView {
  return { ...morning[index]!, meta, status };
}

const specimens: {
  label: string;
  statusLabel: string;
  views: WorkflowStepView[];
}[] = [
  {
    label: "Starting",
    statusLabel: "Running",
    views: [],
  },
  {
    label: "Unrun",
    statusLabel: "Off",
    views: morning.map((item) => ({ ...item, meta: null, status: "pending" })),
  },
  {
    label: "Running · first step",
    statusLabel: "Running · step 1 of 4",
    views: [
      step(0, "running"),
      step(1, "pending"),
      step(2, "pending"),
      step(3, "pending"),
    ],
  },
  {
    label: "Running · later step",
    statusLabel: "Running · step 3 of 4",
    views: [
      step(0, "completed", "368 KB"),
      step(1, "completed", "34 KB"),
      step(2, "running"),
      step(3, "pending"),
    ],
  },
  {
    label: "Failed",
    statusLabel: "Failed · step 3 of 4",
    views: [
      step(0, "completed", "368 KB"),
      step(1, "completed", "34 KB"),
      step(2, "failed", "Timed out"),
      step(3, "pending"),
    ],
  },
  {
    label: "Finished",
    statusLabel: "Done · 4 of 4",
    views: [
      step(0, "completed", "368 KB"),
      step(1, "completed", "34 KB"),
      step(2, "completed", "549 KB"),
      step(3, "completed", "Writ"),
    ],
  },
];

export function WorkflowUiGalleryPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      {specimens.map((specimen) => (
        <div className="flex flex-col gap-2" key={specimen.label}>
          <p className="text-muted-foreground text-xs">{specimen.label}</p>
          <WorkflowRunCard
            statusLabel={specimen.statusLabel}
            title="Morning Brief"
            views={specimen.views}
          />
        </div>
      ))}
    </div>
  );
}
