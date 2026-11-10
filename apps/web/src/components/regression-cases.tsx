import type { ListRegressionCasesResponse } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { Textarea } from "@nakama/ui/textarea";
import { toast } from "@nakama/ui/toast";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { type SubmitEvent, useState } from "react";
import { Link } from "react-router-dom";
import { formatSessionTimestamp } from "@/lib/chat-history";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

/** The server's cap on `expectedResult`. */
const MAX_EXPECTED_RESULT_LENGTH = 20_000;

/** Viewers get 403 from both case routes, so they see neither the action nor the list. */
export function canUseRegressionCases(orgRole: string | undefined): boolean {
  return orgRole === "admin" || orgRole === "member";
}

export type RegressionCaseSource =
  | { sourceId: string; sourceType: "session" }
  | { automationId: string; sourceId: string; sourceType: "automation_run" };

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
  source: RegressionCaseSource;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {open ? (
        <SaveRegressionCaseForm
          initialExpected={expectedResult}
          onDone={() => onOpenChange(false)}
          profileId={profileId}
          source={source}
        />
      ) : null}
    </Dialog>
  );
}

function SaveRegressionCaseForm({
  initialExpected,
  onDone,
  profileId,
  source,
}: {
  initialExpected: string;
  onDone: () => void;
  profileId: string;
  source: RegressionCaseSource;
}) {
  const queryClient = useQueryClient();

  const [expected, setExpected] = useState(() =>
    initialExpected.trim().slice(0, MAX_EXPECTED_RESULT_LENGTH)
  );

  const save = useMutation({
    mutationFn: (expectedResult: string) =>
      client.createRegressionCase(profileId, { ...source, expectedResult }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.profiles.regressionCases(profileId),
      });
      toast("Saved as a test case.");
      onDone();
    },
  });

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
          <DialogDescription>
            The last message sent in this run becomes the input. Edit the
            result below to what a correct answer should say.
          </DialogDescription>
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
            maxLength={MAX_EXPECTED_RESULT_LENGTH}
            onChange={(event) => setExpected(event.target.value)}
            rows={8}
            value={expected}
          />
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
            onClick={onDone}
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

  if (query.error) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {formatError(query.error)}
      </p>
    );
  }

  const cases = query.data.pages.flatMap((page) => page.cases);

  if (cases.length === 0) {
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
      {query.hasNextPage ? (
        <Button
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          variant="outline"
        >
          {query.isFetchingNextPage ? <Spinner className="size-4" /> : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
