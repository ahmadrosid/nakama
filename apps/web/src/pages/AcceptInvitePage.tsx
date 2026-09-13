import { Button } from "@nakama/ui/button";
import { Input } from "@nakama/ui/input";
import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { useTheme } from "@/context/use-theme";
import { client, formatError } from "@/lib/client";
import { ditherLogoSrc } from "@/lib/theme";

export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { refreshSession } = useAuth();
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();

  if (!token) {
    return <Navigate replace to="/login" />;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await client.acceptOrgInvite({ password, token });
      await refreshSession();
      navigate("/chat", { replace: true });
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
            src={ditherLogoSrc(resolvedTheme)}
          />
          <h1 className="font-semibold text-xl tracking-tight">
            Accept invitation
          </h1>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="password"
            >
              Password
            </label>
            <Input
              autoComplete="current-password"
              id="password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            <p className="mt-1 text-muted-foreground text-xs">
              Use your existing password, or choose one if this is your first
              time joining.
            </p>
          </div>
          {error ? (
            <div
              className="rounded-md bg-red-50 px-3 py-2 text-red-800 text-sm dark:bg-red-950/30 dark:text-red-200"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Joining..." : "Join organization"}
          </Button>
        </form>
      </div>
    </div>
  );
}
