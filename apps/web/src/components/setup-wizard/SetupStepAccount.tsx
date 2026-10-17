import { Button } from "@nakama/ui/button";
import { Card } from "@nakama/ui/card";
import { Input } from "@nakama/ui/input";
import { cn } from "@nakama/ui/utils";
import { Upload04Icon, ViewIcon, ViewOffIcon } from "hugeicons-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SetupStepBackupImport } from "@/components/setup-wizard/SetupStepBackupImport";
import {
  SETUP_STEPS,
  type SetupAccountDraft,
} from "@/components/setup-wizard/setup-wizard.shared";

interface SetupStepAccountProps {
  onNext: (account: SetupAccountDraft) => void;
}

type SetupAccountMode = "account" | "backup";

const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"];

/** 0 = under 8 characters, 4 = long with mixed character kinds. */
export function passwordStrength(password: string): number {
  if (password.length < 8) {
    return 0;
  }

  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(password)
  ).length;

  return Math.min(
    4,
    1 +
      (kinds >= 2 ? 1 : 0) +
      (kinds >= 3 ? 1 : 0) +
      (password.length >= 12 ? 1 : 0)
  );
}

export function SetupStepAccount({ onNext }: SetupStepAccountProps) {
  const navigate = useNavigate();
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<SetupAccountMode>("account");
  const [initialBackupFile, setInitialBackupFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [showPhone, setShowPhone] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mode === "backup") {
    return (
      <div className="space-y-6">
        <h1 className="font-semibold text-foreground text-xl">
          Restore a backup
        </h1>
        <SetupStepBackupImport
          initialFile={initialBackupFile}
          onBack={() => {
            setInitialBackupFile(null);
            setMode("account");
          }}
          onRestored={() => navigate("/login", { replace: true })}
        />
      </div>
    );
  }

  const strength = passwordStrength(password);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters");

      return;
    }

    onNext({
      email: email.trim(),
      name: name.trim(),
      password,
      phone: showPhone ? phone.trim() : "",
    });
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <Card className="p-6 sm:p-8">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <ol aria-label="Setup progress" className="flex items-center gap-1.5">
            {SETUP_STEPS.map((step) => (
              <li
                aria-current={step.id === 1 ? "step" : undefined}
                className={cn(
                  "h-1.5 rounded-full",
                  step.id === 1 ? "w-6 bg-primary" : "w-1.5 bg-border"
                )}
                key={step.id}
              >
                <span className="sr-only">
                  Step {step.id} of {SETUP_STEPS.length}: {step.label}
                </span>
              </li>
            ))}
          </ol>
          <h1 className="pb-2 font-semibold text-foreground text-xl">
            Create your admin account
          </h1>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="setup-name"
            >
              Your name
            </label>
            <Input
              autoComplete="name"
              className="h-10"
              id="setup-name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Jane Admin"
              required
              value={name}
            />
          </div>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="setup-email"
            >
              Email
            </label>
            <Input
              autoComplete="email"
              className="h-10"
              id="setup-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              required
              type="email"
              value={email}
            />
          </div>
          {showPhone ? (
            <div>
              <label
                className="mb-1 block font-medium text-sm"
                htmlFor="setup-phone"
              >
                Phone{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <Input
                autoComplete="tel"
                autoFocus
                className="h-10"
                id="setup-phone"
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+628123456789"
                type="tel"
                value={phone}
              />
            </div>
          ) : (
            <Button
              className="-ml-2"
              onClick={() => setShowPhone(true)}
              size="sm"
              type="button"
              variant="ghost"
            >
              + Add phone
            </Button>
          )}
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="setup-password"
            >
              Password
            </label>
            <div className="relative">
              <Input
                autoComplete="new-password"
                className="h-10 pr-10"
                id="setup-password"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <Button
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute top-1 right-1"
                onClick={() => setShowPassword((value) => !value)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                {showPassword ? <ViewOffIcon /> : <ViewIcon />}
              </Button>
            </div>
            {password ? (
              <div className="mt-2 space-y-1">
                <div aria-hidden className="grid grid-cols-4 gap-1">
                  {[1, 2, 3, 4].map((level) => (
                    <span
                      className={cn(
                        "h-1 rounded-full",
                        level <= strength ? "bg-primary" : "bg-border"
                      )}
                      key={level}
                    />
                  ))}
                </div>
                <p aria-live="polite" className="text-muted-foreground text-xs">
                  {STRENGTH_LABELS[strength]}
                </p>
              </div>
            ) : null}
          </div>
          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-red-800 text-sm dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}
          <Button className="h-10 w-full" type="submit">
            Continue
          </Button>
        </form>
      </Card>
      <div className="flex justify-center">
        <input
          accept=".zip,application/zip"
          aria-label="Choose a backup file"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = "";

            if (!file) {
              return;
            }

            setInitialBackupFile(file);
            setMode("backup");
          }}
          ref={backupInputRef}
          type="file"
        />
        <Button
          onClick={() => backupInputRef.current?.click()}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Upload04Icon aria-hidden className="size-3.5" />
          Restore a backup
        </Button>
      </div>
    </div>
  );
}
