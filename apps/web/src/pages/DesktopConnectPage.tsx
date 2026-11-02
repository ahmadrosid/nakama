import { Button } from "@nakama/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { useTheme } from "@/context/use-theme";
import { client, formatError } from "@/lib/client";
import { markLogoSrc } from "@/lib/theme";

/** Nakama Desktop listens only on this computer, on a one-time port. */
const RETURN_ADDRESS = /^http:\/\/127\.0\.0\.1:\d{1,5}\/[A-Za-z0-9/_-]*$/;

export interface ConnectRequest {
  installId: string;
  name: string;
  publicKey: string;
  returnTo: string;
  state: string;
}

/** Null for a link that did not come from Nakama Desktop on this computer. */
export function parseConnectRequest(
  params: URLSearchParams
): ConnectRequest | null {
  const request = {
    installId: params.get("install")?.trim() ?? "",
    name: params.get("name")?.trim() ?? "",
    publicKey: params.get("key")?.trim() ?? "",
    returnTo: params.get("return")?.trim() ?? "",
    state: params.get("state")?.trim() ?? "",
  };

  const complete = Object.values(request).every((value) => value.length > 0);

  return complete && RETURN_ADDRESS.test(request.returnTo) ? request : null;
}

/** Where the browser goes after Connect: back to the app on this computer. */
export function connectReturnUrl(
  request: ConnectRequest,
  result: {
    account: string;
    computerId: string;
    orgId: string;
    orgName: string;
  }
): string {
  // RETURN_ADDRESS allows no query, so the result is the whole query.
  const query = new URLSearchParams({
    account: result.account,
    computerId: result.computerId,
    orgId: result.orgId,
    orgName: result.orgName,
    state: request.state,
  });

  return `${request.returnTo}?${query.toString()}`;
}

export function DesktopConnectPage() {
  const [searchParams] = useSearchParams();
  const { activeOrg, orgs, user } = useAuth();
  const { resolvedTheme } = useTheme();
  const request = parseConnectRequest(searchParams);
  const [orgId, setOrgId] = useState(activeOrg?.id ?? orgs[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const org = orgs.find((candidate) => candidate.id === orgId);

  async function connect() {
    if (!(request && org)) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const { computerId } = await client.forOrg(org.id).enrollComputer({
        installId: request.installId,
        name: request.name,
        publicKey: request.publicKey,
      });

      window.location.assign(
        connectReturnUrl(request, {
          account: user?.email ?? "",
          computerId,
          orgId: org.id,
          orgName: org.name,
        })
      );
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex h-svh items-center justify-center bg-background px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <img
            alt="Nakama"
            className="mb-4 size-14 rounded-xl"
            src={markLogoSrc(resolvedTheme)}
          />
          <h1 className="font-semibold text-xl tracking-tight">
            Connect Nakama Desktop
          </h1>
          {request ? (
            <p className="mt-1 text-muted-foreground text-sm">{request.name}</p>
          ) : null}
        </div>
        {request ? (
          <div className="space-y-4">
            {orgs.length > 1 ? (
              <Select
                disabled={isSubmitting}
                onValueChange={(value) => value && setOrgId(String(value))}
                value={orgId}
              >
                <SelectTrigger aria-label="Organization" className="h-9 w-full">
                  <SelectValue>{org?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {error ? (
              <div
                className="rounded-md bg-red-50 px-3 py-2 text-red-800 text-sm dark:bg-red-950/30 dark:text-red-200"
                role="alert"
              >
                {error}
              </div>
            ) : null}
            <Button
              className="w-full"
              disabled={isSubmitting || !org}
              onClick={() => void connect()}
              type="button"
            >
              Connect
            </Button>
          </div>
        ) : (
          <div
            className="rounded-md bg-red-50 px-3 py-2 text-center text-red-800 text-sm dark:bg-red-950/30 dark:text-red-200"
            role="alert"
          >
            This link is not valid.
          </div>
        )}
      </div>
    </div>
  );
}
