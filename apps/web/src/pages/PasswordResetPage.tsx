import { Button } from "@nakama/ui/button";
import { Input } from "@nakama/ui/input";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTheme } from "@/context/use-theme";
import { client, formatError } from "@/lib/client";
import { ditherLogoSrc } from "@/lib/theme";

export function PasswordResetPage() {
  const [searchParams] = useSearchParams();
  const initialToken = searchParams.get("token")?.trim() ?? "";
  const [token, setToken] = useState(initialToken);
  const [enteringToken, setEnteringToken] = useState(Boolean(initialToken));
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requested, setRequested] = useState(false);
  const [completed, setCompleted] = useState(false);
  const { resolvedTheme } = useTheme();

  async function handleRequest(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await client.requestPasswordReset({ email });
      if (response.token) {
        setToken(response.token);
        setEnteringToken(true);
      } else {
        setRequested(true);
      }
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReset(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await client.resetPassword({ newPassword, token });
      setCompleted(true);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setIsSubmitting(false);
    }
  }

  let heading = "Reset password";
  if (requested) {
    heading = "Check your email";
  } else if (completed) {
    heading = "Password reset";
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
          <h1 className="font-semibold text-xl tracking-tight">{heading}</h1>
        </div>

        {requested || completed ? (
          <Link
            className="block text-center font-medium text-primary text-sm hover:underline"
            to="/login"
          >
            Return to sign in
          </Link>
        ) : null}

        {enteringToken || requested ? null : (
          <form className="space-y-4" onSubmit={handleRequest}>
            <div>
              <label className="mb-1 block font-medium text-sm" htmlFor="email">
                Email
              </label>
              <Input
                autoComplete="email"
                id="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>
            <PasswordResetError error={error} />
            <Button className="w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Sending..." : "Send reset link"}
            </Button>
            <Button
              className="w-full"
              onClick={() => {
                setError(null);
                setEnteringToken(true);
              }}
              type="button"
              variant="outline"
            >
              Use reset token
            </Button>
          </form>
        )}

        {enteringToken && !completed ? (
          <form className="space-y-4" onSubmit={handleReset}>
            <div>
              <label
                className="mb-1 block font-medium text-sm"
                htmlFor="reset-token"
              >
                Reset token
              </label>
              <Input
                autoCapitalize="none"
                autoComplete="off"
                id="reset-token"
                onChange={(event) => setToken(event.target.value)}
                required
                spellCheck={false}
                value={token}
              />
            </div>
            <div>
              <label
                className="mb-1 block font-medium text-sm"
                htmlFor="new-password"
              >
                New password
              </label>
              <Input
                autoComplete="new-password"
                id="new-password"
                minLength={8}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </div>
            <PasswordResetError error={error} />
            <Button className="w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Resetting..." : "Reset password"}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function PasswordResetError({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }

  return (
    <div
      className="rounded-md bg-red-50 px-3 py-2 text-red-800 text-sm dark:bg-red-950/30 dark:text-red-200"
      role="alert"
    >
      {error}
    </div>
  );
}
