import type {
  AuditChainVerificationResult,
  AuditEvent,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { InputGroup, InputGroupInput } from "@nakama/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nakama/ui/table";
import {
  ArrowRight01Icon,
  Download01Icon,
  RefreshIcon,
  Search01Icon,
} from "hugeicons-react";
import { useRef, useState } from "react";
import { useAuth } from "@/context/use-auth";
import {
  type AuditEventsFilters,
  useAuditEventCategories,
  useAuditEvents,
} from "@/hooks/use-audit-events";
import { client, formatError } from "@/lib/client";

const PAGE_SIZE = 50;

const SEARCH_PLACEHOLDER = "Search action, resource, actor, IP";

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  second: "2-digit",
  year: "numeric",
});

type OutcomeFilter = "all" | "success" | "failure";

function actorLabel(event: AuditEvent): string {
  if (event.actorMode === "agent") {
    return `Agent \u00b7 ${event.resourceId ?? "tool"}`;
  }

  if (event.actorMode === "token") {
    return event.actorUserId ? `Token \u00b7 ${event.actorUserId}` : "Token";
  }

  if (event.actorMode === "anonymous") {
    return event.actorUserId
      ? `Anonymous \u00b7 ${event.actorUserId}`
      : "Anonymous";
  }

  if (event.actorMode === "session") {
    const suffix = event.sessionId
      ? event.sessionId.replaceAll("-", "").slice(0, 12)
      : (event.actorUserId ?? "");

    return suffix ? `Dashboard \u00b7 ${suffix}` : "Dashboard";
  }

  return "System";
}

function resourceLabel(event: AuditEvent): string {
  const category = event.action.split(".")[0] ?? event.action;

  return event.resourceId ? `${category}/${event.resourceId}` : category;
}

function requestLabel(event: AuditEvent): string {
  if (!event.method && event.status === null) {
    return "\u2014";
  }

  return `${event.method ?? ""} ${event.route ?? ""} \u2192 ${event.status ?? ""}`.trim();
}

function formatTime(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : TIME_FORMAT.format(date);
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function EventsPage() {
  const { activeOrg, user } = useAuth();
  const isPlatformAdmin = Boolean(user?.isPlatformAdmin);
  const orgId = activeOrg?.id ?? "";

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [category, setCategory] = useState("all");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const debounceTimerRef = useRef<number | null>(null);

  const trimmedSearch = search.trim();

  const filters: AuditEventsFilters = {
    category: category === "all" ? undefined : category,
    limit: PAGE_SIZE,
    offset,
    outcome: outcome === "all" ? undefined : outcome,
    search: trimmedSearch || undefined,
  };

  const eventsQuery = useAuditEvents({ filters, isPlatformAdmin, orgId });
  const categoriesQuery = useAuditEventCategories(orgId, isPlatformAdmin);

  function onSearchChange(value: string) {
    setSearchInput(value);

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(() => {
      setSearch(value);
      setOffset(0);
    }, 300);
  }

  function toggleRow(id: string) {
    setExpanded((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  const events = eventsQuery.data?.events ?? [];
  const total = eventsQuery.data?.total ?? 0;
  const categories = categoriesQuery.data?.categories ?? [];

  return (
    <section className="mx-auto min-w-0 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">
          {isPlatformAdmin ? "All events" : "Events"}
        </h1>
        {isPlatformAdmin ? <PlatformAdminControls /> : null}
      </div>

      <EventsFilterBar
        categories={categories}
        category={category}
        onCategoryChange={(next) => {
          setCategory(next);
          setOffset(0);
        }}
        onOutcomeChange={(next) => {
          setOutcome(next);
          setOffset(0);
        }}
        onSearchChange={onSearchChange}
        outcome={outcome}
        searchInput={searchInput}
      />

      <div className="mt-4">
        <EventsTable
          events={events}
          expanded={expanded}
          isLoading={eventsQuery.isLoading}
          onToggle={toggleRow}
        />
      </div>

      {total > PAGE_SIZE ? (
        <EventsPagination
          count={events.length}
          isFetching={eventsQuery.isFetching}
          offset={offset}
          onOffsetChange={setOffset}
          total={total}
        />
      ) : null}
    </section>
  );
}

function PlatformAdminControls() {
  const [verifying, setVerifying] = useState(false);

  const [verification, setVerification] =
    useState<AuditChainVerificationResult | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportAuditTrail() {
    setExporting(true);
    setExportError(null);

    try {
      // fetchRaw throws on a non-2xx status; blob() throws if the stream
      // breaks mid-download, so a partial file is never saved.
      const response = await client.exportAuditEventsResponse();
      downloadBlob(`audit-${Date.now()}.jsonl`, await response.blob());
    } catch (error) {
      setExportError(formatError(error) || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function verifyChain() {
    setVerifying(true);

    try {
      setVerification(await client.verifyAuditChain());
    } catch (error) {
      setVerification({
        brokenId: null,
        brokenSeq: null,
        checked: 0,
        legacy: 0,
        ok: false,
        reason: formatError(error) || "Verification request failed",
      });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {exportError ? (
        <span
          className="rounded-full bg-destructive/10 px-2 py-1 text-destructive text-xs"
          role="alert"
        >
          {exportError}
        </span>
      ) : null}
      {verification ? (
        <span
          className={
            verification.ok
              ? "rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-600 text-xs dark:text-emerald-400"
              : "rounded-full bg-destructive/10 px-2 py-1 text-destructive text-xs"
          }
        >
          {verification.ok
            ? `Chain verified (${verification.checked} rows)`
            : `Broken at #${verification.brokenSeq ?? "?"}: ${verification.reason ?? "mismatch"}`}
        </span>
      ) : null}
      <Button
        disabled={verifying}
        onClick={() => {
          void verifyChain();
        }}
        size="sm"
        variant="outline"
      >
        <RefreshIcon className="size-4" />
        Verify
      </Button>
      <Button
        disabled={exporting}
        onClick={() => {
          void exportAuditTrail();
        }}
        size="sm"
        variant="outline"
      >
        <Download01Icon className="size-4" />
        Export
      </Button>
    </div>
  );
}

function EventsFilterBar({
  categories,
  category,
  onCategoryChange,
  onOutcomeChange,
  onSearchChange,
  outcome,
  searchInput,
}: {
  categories: string[];
  category: string;
  onCategoryChange: (value: string) => void;
  onOutcomeChange: (value: OutcomeFilter) => void;
  onSearchChange: (value: string) => void;
  outcome: OutcomeFilter;
  searchInput: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <InputGroup className="min-w-56 flex-1">
        <Search01Icon className="text-muted-foreground" />
        <InputGroupInput
          aria-label="Search events"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={SEARCH_PLACEHOLDER}
          value={searchInput}
        />
      </InputGroup>
      <Select
        onValueChange={(value) => {
          // SAFETY: the Select only offers the three outcome values.
          onOutcomeChange((value ?? "all") as OutcomeFilter);
        }}
        value={outcome}
      >
        <SelectTrigger aria-label="Filter by outcome" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All outcomes</SelectItem>
          <SelectItem value="success">Success</SelectItem>
          <SelectItem value="failure">Failed</SelectItem>
        </SelectContent>
      </Select>
      <Select
        onValueChange={(value) => {
          onCategoryChange(value ?? "all");
        }}
        value={category}
      >
        <SelectTrigger aria-label="Filter by action" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All actions</SelectItem>
          {categories.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EventsTable({
  events,
  expanded,
  isLoading,
  onToggle,
}: {
  events: AuditEvent[];
  expanded: Set<string>;
  isLoading: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>Time</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Resource</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Client</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={7}>
              Loading events...
            </TableCell>
          </TableRow>
        ) : null}
        {!isLoading && events.length === 0 ? (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={7}>
              No events match the current filters.
            </TableCell>
          </TableRow>
        ) : null}
        {events.map((event) => (
          <EventRow
            event={event}
            expanded={expanded.has(event.id)}
            key={event.id}
            onToggle={() => onToggle(event.id)}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function EventsPagination({
  count,
  isFetching,
  offset,
  onOffsetChange,
  total,
}: {
  count: number;
  isFetching: boolean;
  offset: number;
  onOffsetChange: (next: number) => void;
  total: number;
}) {
  const hasMore = offset + count < total;

  return (
    <div className="mt-3 flex items-center justify-center gap-2">
      <Button
        disabled={offset === 0 || isFetching}
        onClick={() => onOffsetChange(Math.max(0, offset - PAGE_SIZE))}
        size="sm"
        variant="outline"
      >
        Previous
      </Button>
      <span className="text-muted-foreground text-xs">
        {count === 0 ? 0 : offset + 1}-{offset + count} of {total}
      </span>
      <Button
        disabled={!hasMore || isFetching}
        onClick={() => onOffsetChange(offset + PAGE_SIZE)}
        size="sm"
        variant="outline"
      >
        Next
      </Button>
    </div>
  );
}

function EventRow({
  event,
  expanded,
  onToggle,
}: {
  event: AuditEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const detail =
    Object.keys(event.metadata).length > 0
      ? JSON.stringify(event.metadata, null, 2)
      : null;

  return (
    <>
      <TableRow
        className={expanded ? "bg-muted/30" : undefined}
        onClick={onToggle}
      >
        <TableCell className="w-8">
          <ArrowRight01Icon
            className={`size-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {formatTime(event.createdAt)}
        </TableCell>
        <TableCell className="font-mono text-xs">{event.action}</TableCell>
        <TableCell className="whitespace-nowrap">{actorLabel(event)}</TableCell>
        <TableCell className="max-w-48 truncate">
          {resourceLabel(event)}
        </TableCell>
        <TableCell>
          <span
            className={
              event.outcome === "success"
                ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 text-xs dark:text-emerald-400"
                : "rounded-full bg-destructive/10 px-2 py-0.5 text-destructive text-xs"
            }
          >
            {event.outcome === "success" ? "Success" : "Failed"}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {event.clientIp ?? "\u2014"}
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell />
          <TableCell className="pb-4" colSpan={6}>
            <EventDetailList detail={detail} event={event} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function EventDetailList({
  detail,
  event,
}: {
  detail: string | null;
  event: AuditEvent;
}) {
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">Org</dt>
      <dd className="font-mono text-xs">{event.orgId ?? "Installation"}</dd>
      <dt className="text-muted-foreground">Request</dt>
      <dd className="font-mono text-xs">{requestLabel(event)}</dd>
      <dt className="text-muted-foreground">Actor</dt>
      <dd>{actorLabel(event)}</dd>
      <dt className="text-muted-foreground">Forwarded for</dt>
      <dd className="font-mono text-xs">{event.forwardedFor ?? "\u2014"}</dd>
      <dt className="text-muted-foreground">User agent</dt>
      <dd className="break-all">{event.userAgent ?? "\u2014"}</dd>
      <dt className="text-muted-foreground">Request ID</dt>
      <dd className="font-mono text-xs">{event.requestId ?? "\u2014"}</dd>
      <dt className="text-muted-foreground">Chain</dt>
      <dd className="font-mono text-xs">
        {event.seq === null
          ? "Not chained (written before the chain existed)"
          : `#${event.seq}`}
      </dd>
      <dt className="text-muted-foreground">Hash</dt>
      <dd className="break-all font-mono text-xs">{event.hash || "\u2014"}</dd>
      <dt className="text-muted-foreground">Details</dt>
      <dd className="break-all font-mono text-xs">{detail ?? "\u2014"}</dd>
    </dl>
  );
}
