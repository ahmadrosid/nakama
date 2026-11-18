import {
  type CreateRegressionCaseRequest,
  type ListRegressionCasesResponse,
  MAX_REGRESSION_EXPECTED_RESULT_LENGTH,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { Textarea } from "@nakama/ui/textarea";
import { toast } from "@nakama/ui/toast";
import {
  type UseMutationResult,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { type SubmitEvent, useState } from "react";
import { Link } from "react-router-dom";
import { formatSessionTimestamp } from "@/lib/chat-history";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

/** A create request without the text the member writes in the dialog. */
type SaveCaseSource = CreateRegressionCaseRequest extends infer Request
  ? Request extends unknown
    ? Omit<Request, "expectedResult">
    : never
  : never;

/** Cuts to the server's cap without splitting a surrogate pair; null when nothing was cut. */
function cutToCap(text: string): string | null {
  if (text.length <= MAX_REGRESSION_EXPECTED_RESULT_LENGTH) {
    return null;
  }

  const cut = text.slice(0, MAX_REGRESSION_EXPECTED_RESULT_LENGTH);

  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export function SaveRegressionCaseDialog({
  expectedResult,
  onOpenChange,
  open,
  profileId,
  source,
}: {
  expectedResult: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  profileId: string;
  source: SaveCaseSource;
}) {
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: (expectedResult: string) =>
      client.createRegressionCase(profileId, { ...source, expectedResult }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.profiles.regressionCases(profileId),
      });
      toast("Saved as a test case.");
      onOpenChange(false);
    },
  });

  // Esc or an overlay click mid-save would let a second save start
  const close = () => {
    if (!save.isPending) {
      save.reset();
      onOpenChange(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
      open={open}
    >
      {open ? (
        <SaveRegressionCaseForm
          initialExpected={expectedResult}
          onCancel={close}
          save={save}
        />
      ) : null}
    </Dialog>
  );
}

function SaveRegressionCaseForm({
  initialExpected,
  onCancel,
  save,
}: {
  initialExpected: string;
  onCancel: () => void;
  save: UseMutationResult<unknown, Error, string>;
}) {
  const [cut] = useState(() => cutToCap(initialExpected.trim()));
  const [expected, setExpected] = useState(() => cut ?? initialExpected.trim());

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (expected.trim()) {
      save.mutate(expected.trim());
    }
  }

  return (
    <DialogContent className="gap-6 p-6 sm:max-w-2xl">
      <form className="space-y-6" onSubmit={handleSubmit}>
        <DialogHeader className="gap-2">
          <DialogTitle>Save as test case</DialogTitle>
        </DialogHeader>
        <div className="space-y-2.5">
          <label
            className="block font-medium text-foreground text-sm"
            htmlFor="regression-case-expected"
          >
            Expected result
          </label>
          <Textarea
            autoFocus
            className="max-h-80 min-h-40 overflow-y-auto text-sm"
            disabled={save.isPending}
            id="regression-case-expected"
            maxLength={MAX_REGRESSION_EXPECTED_RESULT_LENGTH}
            onChange={(event) => setExpected(event.target.value)}
            rows={8}
            value={expected}
          />
          {cut === null ? null : (
            <p className="text-muted-foreground text-sm" role="status">
              The reply was cut to{" "}
              {MAX_REGRESSION_EXPECTED_RESULT_LENGTH.toLocaleString()}{" "}
              characters.
            </p>
          )}
          {save.error ? (
            <p
              className="rounded-md bg-destructive/10 px-3 py-2.5 text-destructive text-sm"
              role="alert"
            >
              {formatError(save.error)}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-3 border-t-0 bg-transparent pt-0 sm:justify-end">
          <Button
            disabled={save.isPending}
            onClick={onCancel}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={save.isPending || !expected.trim()} type="submit">
            {save.isPending ? <Spinner className="size-4" /> : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function RegressionCasesList({ profileId }: { profileId: string }) {
  const query = useInfiniteQuery({
    getNextPageParam: (lastPage: ListRegressionCasesResponse) =>
      lastPage.nextOffset ?? undefined,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      client.listRegressionCases(profileId, pageParam),
    queryKey: queryKeys.profiles.regressionCases(profileId),
  });

  if (query.isPending) {
    return <p className="text-muted-foreground text-sm">Loading test cases…</p>;
  }

  if (!query.data) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {formatError(query.error)}
      </p>
    );
  }

  // Offset paging repeats a row when a case is saved between pages
  const cases = [
    ...new Map(
      query.data.pages
        .flatMap((page) => page.cases)
        .map((item) => [item.id, item])
    ).values(),
  ];

  // A page can filter to nothing (other members' private cases), so empty needs the last page
  if (cases.length === 0 && !query.hasNextPage && !query.error) {
    return (
      <p className="text-muted-foreground text-sm">
        No test cases yet. Save one from a finished chat or automation run.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {cases.map((item) => (
          <li className="space-y-2 p-4" key={item.id}>
            <div className="flex items-center justify-between gap-3 text-muted-foreground text-xs">
              <span>{formatSessionTimestamp(item.createdAt)}</span>
              <Link className="underline" to={item.source.path}>
                {item.source.type === "session"
                  ? "Open chat"
                  : "Open automation"}
              </Link>
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap text-sm">
              {item.input}
            </p>
            <p className="line-clamp-3 whitespace-pre-wrap border-border border-l-2 pl-3 text-muted-foreground text-sm">
              {item.expectedResult}
            </p>
          </li>
        ))}
      </ul>
      {query.error ? (
        <p className="text-destructive text-sm" role="alert">
          {formatError(query.error)}
        </p>
      ) : null}
      {query.hasNextPage || query.error ? (
        <Button
          disabled={query.isFetching}
          onClick={() =>
            void (query.hasNextPage ? query.fetchNextPage() : query.refetch())
          }
          variant="outline"
        >
          {query.isFetching ? (
            <Spinner className="size-4" />
          ) : query.hasNextPage ? (
            "Load more"
          ) : (
            "Retry"
          )}
        </Button>
      ) : null}
    </div>
  );
}
