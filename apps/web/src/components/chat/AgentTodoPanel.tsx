import { hasActiveAgentTodos } from "@tinyclaw/core/agent-todo";
import type { AgentTodo } from "@tinyclaw/core/contract";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  LoaderCircleIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface AgentTodoPanelProps {
  todos: AgentTodo[];
  embedded?: boolean;
  stack?: boolean;
}

export function AgentTodoPanel({
  todos,
  embedded = false,
  stack = false,
}: AgentTodoPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (!hasActiveAgentTodos(todos)) {
    return null;
  }

  if (stack) {
    return (
      <div className="px-3">
        <aside
          className="relative z-0 w-full shrink-0 overflow-hidden rounded-t-xl rounded-b-none border border-b-0 border-border bg-card shadow-xs"
          aria-label="Agent task plan"
        >
          <div className="px-3 py-2">
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground",
                !expanded && "pb-1.5"
              )}
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
            >
              <ChevronRightIcon
                className={cn(
                  "size-4 shrink-0 transition-transform",
                  expanded && "rotate-90",
                )}
                aria-hidden="true"
              />
              <span>TODOS</span>
            </button>
          </div>
          {expanded ? (
            <ul className="space-y-2 border-t border-border/60 px-3 pb-3 pt-2.5">
              {todos.map((todo) => (
                <TodoRow key={todo.id} todo={todo} />
              ))}
            </ul>
          ) : null}
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
      <h3 className="type-label mb-1 text-muted-foreground">Task plan</h3>
      <ul className="space-y-2">
        {todos.map((todo) => (
          <TodoRow key={todo.id} todo={todo} />
        ))}
      </ul>
    </aside>
  );
}

function TodoRow({ todo }: { todo: AgentTodo }) {
  return (
    <li className="flex items-start gap-2.5 text-xs">
      <TodoStatusIcon status={todo.status} />
      <span
        className={
          todo.status === "completed" || todo.status === "cancelled"
            ? "text-muted-foreground line-through"
            : "text-foreground"
        }
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
        <LoaderCircleIcon
          className="mt-0.5 size-4 shrink-0 animate-spin text-primary"
          aria-label="In progress"
        />
      );
    case "completed":
      return (
        <CheckCircle2Icon
          className="mt-0.5 size-4 shrink-0 text-emerald-600"
          aria-label="Completed"
        />
      );
    case "cancelled":
      return (
        <XCircleIcon
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-label="Cancelled"
        />
      );
    default:
      return (
        <CircleIcon
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-label="Pending"
        />
      );
  }
}
