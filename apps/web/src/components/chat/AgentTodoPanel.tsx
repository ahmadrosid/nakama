import { hasActiveAgentTodos } from "@nakama/core/agent-todo";
import type { AgentTodo } from "@nakama/core/contract";
import { ArrowDown01Icon, ListViewIcon } from "hugeicons-react";
import { useState } from "react";
import { Matrix } from "@/components/ui/matrix";
import { type Frame, snake3x2 } from "@/components/ui/matrix-frames";
import { cn } from "@/lib/utils";

interface AgentTodoPanelProps {
  embedded?: boolean;
  stack?: boolean;
  todos: AgentTodo[];
}

const TODO_MATRIX_ROWS = 3;
const TODO_MATRIX_COLS = 2;
const TODO_MATRIX_SIZE = 3;
const TODO_MATRIX_GAP = 1;

const pendingPattern: Frame = [
  [0, 0],
  [0, 0],
  [0, 0],
];

const completedPattern: Frame = [
  [1, 1],
  [1, 1],
  [1, 1],
];

const cancelledPattern: Frame = [
  [0, 0],
  [0, 0],
  [0, 0],
];

const todoMatrixStaticProps = {
  className: "inline-flex h-4 w-auto shrink-0 items-center justify-center",
  cols: TODO_MATRIX_COLS,
  gap: TODO_MATRIX_GAP,
  rows: TODO_MATRIX_ROWS,
  size: TODO_MATRIX_SIZE,
};

export function AgentTodoPanel({
  todos,
  embedded = false,
  stack = false,
}: AgentTodoPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (!hasActiveAgentTodos(todos)) {
    return null;
  }

  const completedCount = todos.filter(
    (todo) => todo.status === "completed"
  ).length;
  const runningTodo =
    todos.find((todo) => todo.status === "in_progress") ??
    todos.find((todo) => todo.status === "pending");
  const headerLabel = expanded
    ? `Tasks ${completedCount}/${todos.length}`
    : (runningTodo?.content ?? `Tasks ${completedCount}/${todos.length}`);

  const list = (
    <ul className={cn("space-y-1.5", stack ? "pr-3 pb-2.5 pl-7" : "mt-1")}>
      {todos.map((todo, index) => (
        <TodoRow index={index} key={todo.id} todo={todo} />
      ))}
    </ul>
  );

  const header = (
    <button
      aria-expanded={expanded}
      className={cn(
        "flex w-full items-center gap-1.5 text-left text-muted-foreground text-xs transition-colors hover:text-foreground",
        stack ? "px-3 py-1.5" : "mb-0.5"
      )}
      onClick={() => setExpanded((current) => !current)}
      type="button"
    >
      <ArrowDown01Icon
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0 transition-transform duration-200",
          !expanded && "-rotate-90"
        )}
      />
      {!expanded && runningTodo?.status === "in_progress" ? (
        <TodoStatusIcon status="in_progress" />
      ) : (
        <ListViewIcon aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate transition-opacity duration-200",
          expanded && "tabular-nums"
        )}
      >
        {headerLabel}
      </span>
    </button>
  );

  const expandableList = (
    <div className="todo-panel-expand" data-expanded={expanded}>
      <div className="overflow-hidden pb-1.5">{list}</div>
    </div>
  );

  if (stack) {
    return (
      <div className="px-3">
        <aside
          aria-label="Agent task plan"
          className="relative z-0 w-full shrink-0 overflow-hidden rounded-t-xl rounded-b-none border border-border border-b-0 bg-card shadow-xs"
        >
          {header}
          {expandableList}
        </aside>
      </div>
    );
  }

  return (
    <aside
      aria-label="Agent task plan"
      className={cn(
        embedded
          ? "border-border/80 border-b px-1 pt-0.5 pb-3"
          : "mb-3 rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm"
      )}
    >
      {header}
      {expandableList}
    </aside>
  );
}

function TodoRow({ todo, index }: { todo: AgentTodo; index: number }) {
  return (
    <li
      className="todo-item-enter flex min-w-0 items-center gap-2 pl-1 text-xs leading-none"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <TodoStatusIcon key={todo.status} status={todo.status} />
      <span
        className={cn(
          "min-w-0 truncate transition-colors duration-300",
          todo.status === "completed" || todo.status === "cancelled"
            ? "text-muted-foreground"
            : todo.status === "in_progress"
              ? "todo-shimmer-text text-foreground"
              : "text-muted-foreground"
        )}
      >
        {todo.content}
      </span>
    </li>
  );
}

function TodoStatusIcon({ status }: { status: AgentTodo["status"] }) {
  switch (status) {
    case "in_progress":
      return (
        <Matrix
          {...todoMatrixStaticProps}
          ariaLabel="In progress"
          fps={4}
          frames={snake3x2}
        />
      );
    case "completed":
      return (
        <Matrix
          {...todoMatrixStaticProps}
          ariaLabel="Completed"
          palette={{
            off: "hsl(142 76% 10%)",
            on: "hsl(142 76% 36%)",
          }}
          pattern={completedPattern}
        />
      );
    case "cancelled":
      return (
        <Matrix
          {...todoMatrixStaticProps}
          ariaLabel="Cancelled"
          palette={{
            off: "var(--muted-foreground)",
            on: "var(--muted-foreground)",
          }}
          pattern={cancelledPattern}
        />
      );
    default:
      return (
        <Matrix
          {...todoMatrixStaticProps}
          ariaLabel="Pending"
          brightness={0.55}
          palette={{
            off: "var(--muted-foreground)",
            on: "var(--muted-foreground)",
          }}
          pattern={pendingPattern}
        />
      );
  }
}
