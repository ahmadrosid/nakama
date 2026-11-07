import { NakamaApiError } from "@nakama/core/api-error";
import { desktopConnectCode } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { useTheme } from "@/context/use-theme";
import { client, formatError } from "@/lib/client";
import { connectReturnUrl, parseConnectRequest } from "@/lib/desktop-connect";
import { markLogoSrc } from "@/lib/theme";

export function DesktopConnectPage() {
  const [searchParams] = useSearchParams();
  const { activeOrg, logout, orgs, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const request = parseConnectRequest(searchParams);
  const [orgId, setOrgId] = useState(activeOrg?.id ?? orgs[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const org = orgs.find((candidate) => candidate.id === orgId);
  const [code, setCode] = useState<string | null>(null);
  const state = request?.state;

  useEffect(() => {
    if (state) {
      void desktopConnectCode(state).then(setCode);
    }
  }, [state]);

  async function connect() {
    if (!(request && org)) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const { computerId, confirmCode } = await client
        .forOrg(org.id)
        .enrollComputer({
          installId: request.installId,
          name: request.name,
          publicKey: request.publicKey,
        });

      window.location.assign(
        connectReturnUrl(request, {
          account: user?.email ?? "",
          computerId,
          confirmCode,
          orgId: org.id,
          orgName: org.name,
        })
      );
    } catch (cause) {
      // Connecting needs a fresh sign-in. Sign out only when the person asks:
      // a link alone must not end their session.
      setNeedsSignIn(cause instanceof NakamaApiError && cause.status === 401);
      setError(formatError(cause));
    } finally {
      setIsSubmitting(false);
    }
  }

  /** Signs out, then comes back to this link after the new sign-in. */
  async function signInAgain() {
    await logout();
    navigate("/login", {
      replace: true,
      state: { from: `${location.pathname}${location.search}` },
    });
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
            {code ? (
              <div className="space-y-1 text-center">
                <p
                  aria-label="Connect code"
                  className="font-mono font-semibold text-2xl tracking-widest"
                >
                  {code}
                </p>
                {/* Security: a link from someone else shows a code the app does not. */}
                <p className="text-muted-foreground text-sm">
                  Connect only if Nakama Desktop shows this code.
                </p>
              </div>
            ) : null}
            {error ? (
              <div
                className="rounded-md bg-red-50 px-3 py-2 text-red-800 text-sm dark:bg-red-950/30 dark:text-red-200"
                role="alert"
              >
                {error}
              </div>
            ) : null}
            {needsSignIn ? (
              <Button
                className="w-full"
                onClick={() => void signInAgain()}
                type="button"
              >
                Sign in again
              </Button>
            ) : (
              <Button
                className="w-full"
                disabled={isSubmitting || !(org && code)}
                onClick={() => void connect()}
                type="button"
              >
                Connect
              </Button>
            )}
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
