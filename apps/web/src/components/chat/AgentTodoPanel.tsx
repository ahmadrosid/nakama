import { hasActiveAgentTodos } from "@nakama/core/agent-todo";
import type { AgentTodo } from "@nakama/core/contract";
import { ChevronDownIcon, ListIcon } from "lucide-react";
import { useState } from "react";
import { Matrix } from "@/components/ui/matrix";
import { snake3x2, type Frame } from "@/components/ui/matrix-frames";
import { cn } from "@/lib/utils";

interface AgentTodoPanelProps {
  todos: AgentTodo[];
  embedded?: boolean;
  stack?: boolean;
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
  rows: TODO_MATRIX_ROWS,
  cols: TODO_MATRIX_COLS,
  size: TODO_MATRIX_SIZE,
  gap: TODO_MATRIX_GAP,
  className: "inline-flex h-4 w-auto shrink-0 items-center justify-center",
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

  const completedCount = todos.filter((todo) => todo.status === "completed").length;

  const list = (
    <ul className={cn("space-y-1.5", stack ? "pb-2.5 pl-7 pr-3" : "mt-1")}>
      {todos.map((todo, index) => (
        <TodoRow key={todo.id} todo={todo} index={index} />
      ))}
    </ul>
  );

  const header = (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground",
        stack ? "px-3 py-1.5" : "mb-0.5",
      )}
      onClick={() => setExpanded((current) => !current)}
      aria-expanded={expanded}
    >
      <ChevronDownIcon
        className={cn(
          "size-3.5 shrink-0 transition-transform duration-200",
          !expanded && "-rotate-90",
        )}
        aria-hidden="true"
      />
      <ListIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="tabular-nums transition-opacity duration-200">
        Tasks {completedCount}/{todos.length}
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
          className="relative z-0 w-full shrink-0 overflow-hidden rounded-t-xl rounded-b-none border border-b-0 border-border bg-card shadow-xs"
          aria-label="Agent task plan"
        >
          {header}
          {expandableList}
        </aside>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        embedded
          ? "border-b border-border/80 px-1 pb-3 pt-0.5"
          : "mb-3 rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm",
      )}
      aria-label="Agent task plan"
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
              : "text-muted-foreground/50",
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
          frames={snake3x2}
          fps={4}
          ariaLabel="In progress"
        />
      );
    case "completed":
      return (
        <Matrix
          {...todoMatrixStaticProps}
          pattern={completedPattern}
          ariaLabel="Completed"
          palette={{
            on: "hsl(142 76% 36%)",
            off: "hsl(142 76% 10%)",
          }}
        />
      );
    case "cancelled":
      return (
        <Matrix
          {...todoMatrixStaticProps}
          pattern={cancelledPattern}
          ariaLabel="Cancelled"
          palette={{
            on: "var(--muted-foreground)",
            off: "var(--muted-foreground)",
          }}
        />
      );
    default:
      return (
        <Matrix
          {...todoMatrixStaticProps}
          pattern={pendingPattern}
          ariaLabel="Pending"
          brightness={0.55}
          palette={{
            on: "var(--muted-foreground)",
            off: "var(--muted-foreground)",
          }}
        />
      );
  }
}
