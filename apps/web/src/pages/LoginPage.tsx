import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppContext } from "@/context/use-app-context";
import { useAuth } from "@/context/use-auth";
import { useTheme } from "@/context/use-theme";
import {
  DEMO_LOGIN_EMAIL,
  DEMO_LOGIN_PASSWORD,
  isDemoLoginHost,
} from "@/lib/demo-login";
import { SETUP_PATH } from "@/lib/navigation";
import { ditherLogoSrc } from "@/lib/theme";

function resolvePostAuthPath(
  health: { providerConfigured?: boolean } | null,
  from?: string
): string {
  if (health?.providerConfigured !== true) {
    return SETUP_PATH;
  }

  return from ?? "/chat";
}

export function LoginPage() {
  const demoLogin = isDemoLoginHost();
  const [email, setEmail] = useState(demoLogin ? DEMO_LOGIN_EMAIL : "");
  const [password, setPassword] = useState(
    demoLogin ? DEMO_LOGIN_PASSWORD : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const { health } = useAppContext();
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  if (isAuthenticated) {
    return <Navigate replace to={resolvePostAuthPath(health, from)} />;
  }

  if (health?.userConfigured === false) {
    return <Navigate replace to={SETUP_PATH} />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate(resolvePostAuthPath(health, from), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-svh items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <img
            alt="Nakama"
            className="mb-4 size-14 rounded-xl"
            src={ditherLogoSrc(resolvedTheme)}
          />
          <h1 className="font-semibold text-xl tracking-tight">
            Sign in to Nakama
          </h1>
          {demoLogin ? null : (
            <p className="text-muted-foreground text-sm">
              Enter your credentials to access your account.
            </p>
          )}
        </div>
        {demoLogin ? (
          <div className="space-y-2 rounded-md border bg-muted/40 px-3 py-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Email</span>
              <span className="text-right font-mono">{DEMO_LOGIN_EMAIL}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Password</span>
              <span className="text-right font-mono">
                {DEMO_LOGIN_PASSWORD}
              </span>
            </div>
          </div>
        ) : null}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block font-medium text-sm" htmlFor="email">
              Email
            </label>
            <Input
              id="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
              type="email"
              value={email}
            />
          </div>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="password"
            >
              Password
            </label>
            <Input
              id="password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              type="password"
              value={password}
            />
          </div>
          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-red-800 text-sm dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}
          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
