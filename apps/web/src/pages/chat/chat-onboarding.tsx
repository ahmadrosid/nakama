import { Button } from "@nakama/ui/button";
import { Input } from "@nakama/ui/input";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import {
  Analytics01Icon,
  Building03Icon,
  FlashIcon,
  Mail01Icon,
  Megaphone01Icon,
  PencilEdit01Icon,
  Plug01Icon,
  PlusSignIcon,
  Search01Icon,
  Tick02Icon,
} from "hugeicons-react";
import { type ComponentType, useState } from "react";
import { GOAL_SUGGESTIONS } from "@/components/user-context-presets";
import type { SetupChecklistRow } from "@/pages/chat/chat-page.shared";

type IconComponent = ComponentType<{ className?: string }>;

/** Icons in GOAL_SUGGESTIONS order; the labels are shared with About you. */
const GOAL_ICONS: IconComponent[] = [
  Megaphone01Icon,
  Mail01Icon,
  PencilEdit01Icon,
  Analytics01Icon,
  Search01Icon,
];

const GOAL_OPTIONS = GOAL_SUGGESTIONS.map((label, index) => ({
  icon: GOAL_ICONS[index] ?? PlusSignIcon,
  label,
}));

const CUSTOM_GOAL = "custom";

function GoalCard({
  children,
  dashed = false,
  icon: Icon,
  onSelect,
  selected,
}: {
  children: string;
  dashed?: boolean;
  icon: IconComponent;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "relative flex min-h-28 flex-col items-start gap-3.5 rounded-xl border bg-card p-4 text-left font-medium text-sm transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "border-2 border-foreground p-[15px]" : "border-border",
        dashed && !selected && "border-dashed"
      )}
      onClick={onSelect}
      type="button"
    >
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-lg",
          selected
            ? "bg-foreground text-background"
            : "bg-muted text-muted-foreground"
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      {children}
      {selected ? (
        <span className="absolute top-3.5 right-3.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background">
          <Tick02Icon className="size-3" />
        </span>
      ) : null}
    </button>
  );
}

/** First-run question on the empty chat: what the user wants Nakama for. */
export function ChatGoalPrompt({
  error,
  onSave,
  onSkip,
  saving,
}: {
  error: string | null;
  onSave: (goal: string) => void;
  onSkip: () => void;
  saving: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [customGoal, setCustomGoal] = useState("");

  const goal = (
    selected === CUSTOM_GOAL ? customGoal : (selected ?? "")
  ).trim();

  return (
    <form
      className="fade-in-0 slide-in-from-top-1 flex animate-in flex-col gap-6 px-4 duration-300 motion-reduce:animate-none"
      onSubmit={(event) => {
        event.preventDefault();

        if (goal && !saving) {
          onSave(goal);
        }
      }}
    >
      <h2 className="type-section-title text-2xl tracking-tight">
        What is your goal?
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {GOAL_OPTIONS.map((option) => (
          <GoalCard
            icon={option.icon}
            key={option.label}
            onSelect={() => setSelected(option.label)}
            selected={selected === option.label}
          >
            {option.label}
          </GoalCard>
        ))}
        <GoalCard
          dashed
          icon={PlusSignIcon}
          onSelect={() => setSelected(CUSTOM_GOAL)}
          selected={selected === CUSTOM_GOAL}
        >
          Something else
        </GoalCard>
      </div>

      {selected === CUSTOM_GOAL ? (
        <div className="flex flex-col gap-2">
          <label className="font-medium text-sm" htmlFor="chat-goal-custom">
            Your goal
          </label>
          <Input
            autoFocus
            className="h-12 text-base"
            id="chat-goal-custom"
            onChange={(event) => setCustomGoal(event.target.value)}
            value={customGoal}
          />
        </div>
      ) : null}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          disabled={saving}
          onClick={onSkip}
          type="button"
          variant="ghost"
        >
          Skip for now
        </Button>
        <Button
          className="h-11 rounded-full px-5"
          disabled={!goal || saving}
          type="submit"
        >
          {saving ? <Spinner className="mr-1" /> : null}
          Continue
        </Button>
      </div>
    </form>
  );
}

function GoalPill({ goal }: { goal: string | null }) {
  return goal ? (
    <span className="inline-flex min-h-8 max-w-full items-center self-start truncate rounded-full bg-foreground px-3.5 font-medium text-background text-sm">
      {goal}
    </span>
  ) : null;
}

/** While the server reads the goal and picks setup steps (a few seconds). */
export function ChatSetupFinding({ goal }: { goal: string | null }) {
  return (
    <div className="fade-in-0 flex animate-in flex-col gap-6 px-4 duration-300 motion-reduce:animate-none">
      <GoalPill goal={goal} />
      <div className="flex items-center gap-3">
        <Spinner className="size-6" />
        <h2
          className="type-section-title text-2xl tracking-tight"
          role="status"
        >
          Finding what to set up…
        </h2>
      </div>
      <div
        aria-hidden="true"
        className="flex animate-pulse flex-col gap-3 motion-reduce:animate-none"
      >
        {["w-2/5", "w-1/2", "w-1/3"].map((width) => (
          <div
            className="flex min-h-[76px] items-center gap-3.5 rounded-xl border border-border bg-card px-4"
            key={width}
          >
            <span className="size-9 rounded-lg bg-muted" />
            <span className={cn("h-3 rounded-full bg-muted", width)} />
          </div>
        ))}
      </div>
    </div>
  );
}

const SETUP_ITEM_ICON: Record<
  SetupChecklistRow["item"]["kind"],
  IconComponent
> = {
  connect_toolkit: Plug01Icon,
  enable_skill: FlashIcon,
  write_context: Building03Icon,
};

const SETUP_ITEM_ACTION: Record<SetupChecklistRow["item"]["kind"], string> = {
  connect_toolkit: "Connect",
  enable_skill: "Turn on",
  write_context: "Write",
};

function SetupProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <span
      aria-hidden="true"
      className="block h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <span
        className="block h-full rounded-full bg-foreground transition-[width] duration-300 motion-reduce:transition-none"
        style={{ width: `${total ? (done / total) * 100 : 0}%` }}
      />
    </span>
  );
}

function SetupChecklistRowCard({
  busy,
  onAction,
  onSkip,
  row,
}: {
  busy: boolean;
  onAction: () => void;
  onSkip: () => void;
  row: SetupChecklistRow;
}) {
  const Icon = SETUP_ITEM_ICON[row.item.kind];
  const done = row.status === "done";

  return (
    <li
      className={cn(
        "flex min-h-[76px] flex-wrap items-center gap-3.5 rounded-xl border px-4 py-3",
        done ? "border-border bg-muted/40" : "border-border bg-card"
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          done
            ? "bg-foreground text-background"
            : "bg-muted text-muted-foreground"
        )}
      >
        {done ? (
          <Tick02Icon className="size-4" />
        ) : (
          <Icon className="size-[18px]" />
        )}
      </span>
      <span
        className={cn(
          "min-w-0 flex-[1_1_14rem] font-medium text-sm",
          done && "text-muted-foreground line-through"
        )}
      >
        {row.item.title}
      </span>
      {done ? (
        <span className="px-3 font-medium text-muted-foreground text-sm">
          Done
        </span>
      ) : (
        <span className="flex items-center gap-1">
          {row.status === "skipped" ? (
            <span className="px-3 text-muted-foreground text-sm">Skipped</span>
          ) : (
            <Button
              disabled={busy}
              onClick={onSkip}
              type="button"
              variant="ghost"
            >
              Skip
            </Button>
          )}
          <Button
            className="h-10 rounded-full px-4"
            disabled={busy}
            onClick={onAction}
            type="button"
          >
            {busy ? <Spinner className="mr-1" /> : null}
            {SETUP_ITEM_ACTION[row.item.kind]}
          </Button>
        </span>
      )}
    </li>
  );
}

/** The steps picked for the user's goal; each opens the screen that does it. */
export function ChatSetupChecklist({
  busyKey,
  error,
  goal,
  onAction,
  onFinish,
  onSkip,
  rows,
}: {
  busyKey: string | null;
  error: string | null;
  goal: string | null;
  onAction: (row: SetupChecklistRow) => void;
  onFinish: () => void;
  onSkip: (row: SetupChecklistRow) => void;
  rows: SetupChecklistRow[];
}) {
  const done = rows.filter((row) => row.status === "done").length;

  return (
    <section
      aria-labelledby="chat-setup-heading"
      className="fade-in-0 flex animate-in flex-col gap-5 px-4 duration-300 motion-reduce:animate-none"
    >
      <GoalPill goal={goal} />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2
            className="type-section-title text-2xl tracking-tight"
            id="chat-setup-heading"
          >
            Set up {rows.length} {rows.length === 1 ? "thing" : "things"}
          </h2>
          <span className="text-muted-foreground text-sm tabular-nums">
            {done} of {rows.length} done
          </span>
        </div>
        <SetupProgressBar done={done} total={rows.length} />
      </div>

      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <SetupChecklistRowCard
            busy={busyKey === row.key}
            key={row.key}
            onAction={() => onAction(row)}
            onSkip={() => onSkip(row)}
            row={row}
          />
        ))}
      </ul>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          className="h-11 rounded-full px-5"
          onClick={onFinish}
          type="button"
        >
          Start chatting
        </Button>
      </div>
    </section>
  );
}

/** Reopens an unfinished checklist from the empty chat. */
export function ChatSetupPill({
  done,
  onOpen,
  total,
}: {
  done: number;
  onOpen: () => void;
  total: number;
}) {
  return (
    <button
      className="inline-flex min-h-9 items-center gap-2.5 self-end rounded-full border border-border bg-card px-3.5 font-medium text-xs transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onOpen}
      type="button"
    >
      Setup · {done} of {total} done
      <span className="w-12">
        <SetupProgressBar done={done} total={total} />
      </span>
    </button>
  );
}
