import { useRef, useState } from "react";
import { UploadIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import type { SetupAccountDraft } from "@/components/setup-wizard/setup-wizard.shared";
import { SetupStepBackupImport } from "@/components/setup-wizard/SetupStepBackupImport";

interface SetupStepAccountProps {
  onNext: (account: SetupAccountDraft) => void;
}

type SetupAccountMode = "account" | "backup";

export function SetupStepAccount({ onNext }: SetupStepAccountProps) {
  const navigate = useNavigate();
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<SetupAccountMode>("account");
  const [initialBackupFile, setInitialBackupFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (mode === "backup") {
    return (
      <SetupStepBackupImport
        initialFile={initialBackupFile}
        onBack={() => {
          setInitialBackupFile(null);
          setMode("account");
        }}
        onRestored={() => navigate("/login", { replace: true })}
      />
    );
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    onNext({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      password,
    });
  };

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="setup-name" className="mb-1 block text-sm font-medium">
            Your name
          </label>
          <Input
            id="setup-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Jane Admin"
            required
          />
        </div>
        <div>
          <label htmlFor="setup-email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <Input
            id="setup-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin@example.com"
            required
          />
        </div>
        <div>
          <label htmlFor="setup-phone" className="mb-1 block text-sm font-medium">
            Phone{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="setup-phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+628123456789"
          />
        </div>
        <div>
          <label htmlFor="setup-password" className="mb-1 block text-sm font-medium">
            Password
          </label>
          <Input
            id="setup-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            required
            minLength={8}
          />
        </div>
        <div>
          <label htmlFor="setup-confirm" className="mb-1 block text-sm font-medium">
            Confirm Password
          </label>
          <Input
            id="setup-confirm"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="••••••••"
            required
          />
        </div>
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}
        <Button type="submit" className="w-full">
          Continue
        </Button>
        <div className="flex justify-center border-t border-border pt-4">
          <input
            ref={backupInputRef}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            aria-label="Choose a backup file"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (!file) {
                return;
              }
              setInitialBackupFile(file);
              setMode("backup");
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => backupInputRef.current?.click()}
          >
            <UploadIcon className="size-3.5" aria-hidden />
            I have a backup
          </Button>
        </div>
      </form>
    </Card>
  );
}
