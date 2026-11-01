import { cn } from "@nakama/ui/utils";
import {
  Alert02Icon,
  PlusSignIcon,
  RefreshIcon,
  Tick02Icon,
} from "hugeicons-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useId,
  useState,
} from "react";
import { ChatComposerNotice } from "@/components/chat/chat-tips";
import { useServiceWorkerUpdate } from "@/hooks/use-service-worker-update";
import { RELEASE_CHANGE_LABELS, type ReleaseNote } from "@/lib/release-notes";

/** The line stays small: only the first lines of the release show. */
const MAX_CHANGES = 3;

type ServiceWorkerUpdateState = ReturnType<typeof useServiceWorkerUpdate>;

const ServiceWorkerUpdateContext = createContext<ServiceWorkerUpdateState>({
  applyUpdate: () => undefined,
  note: null,
  updateReady: false,
  version: null,
});

/** Registers the service worker once for the whole app. */
export function ServiceWorkerUpdateProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ServiceWorkerUpdateContext.Provider value={useServiceWorkerUpdate()}>
      {children}
    </ServiceWorkerUpdateContext.Provider>
  );
}

export function useUpdateReady(): boolean {
  return useContext(ServiceWorkerUpdateContext).updateReady;
}

const CHANGE_ICONS = {
  changed: RefreshIcon,
  fixed: Tick02Icon,
  new: PlusSignIcon,
} as const;

function ChangeList({ id, note }: { id: string; note: ReleaseNote }) {
  // A repeated line adds nothing, and the text is the list key.
  const changes = [
    ...new Map(note.changes.map((change) => [change.text, change])).values(),
  ].slice(0, MAX_CHANGES);

  return (
    <ul className="mt-1.5 space-y-1 pb-0.5 text-foreground text-xs" id={id}>
      {changes.map((change) => {
        const Icon = CHANGE_ICONS[change.kind];

        return (
          <li className="flex items-start gap-2" key={change.text}>
            <Icon
              aria-hidden="true"
              className="mt-px size-3.5 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            <span className="sr-only">
              {RELEASE_CHANGE_LABELS[change.kind]}:
            </span>
            {change.text}
          </li>
        );
      })}
    </ul>
  );
}

/** A line joined to the top of the chat composer while a new build waits. */
export function ServiceWorkerUpdateNotice() {
  const { applyUpdate, note, version } = useContext(ServiceWorkerUpdateContext);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const critical = note?.critical;
  const hasChanges = (note?.changes.length ?? 0) > 0;

  return (
    <ChatComposerNotice
      className={cn(
        critical && "border-amber-500/30 bg-amber-50 dark:bg-amber-500/10"
      )}
      role="status"
    >
      <div className="flex items-center gap-2 text-xs">
        {critical ? (
          <Alert02Icon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-amber-700 dark:text-amber-300"
          />
        ) : (
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-primary"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-foreground">
          {critical ??
            (version ? `Nakama ${version} is ready` : "A new version is ready")}
        </span>
        {hasChanges ? (
          <button
            aria-controls={listId}
            aria-expanded={open}
            className="shrink-0 rounded-md px-1.5 py-1 font-medium text-primary hover:bg-primary/10"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            What's new
          </button>
        ) : null}
        <button
          className="shrink-0 rounded-md px-1.5 py-1 font-medium text-primary hover:bg-primary/10"
          onClick={applyUpdate}
          type="button"
        >
          Reload
        </button>
      </div>
      {open && note ? <ChangeList id={listId} note={note} /> : null}
    </ChatComposerNotice>
  );
}
