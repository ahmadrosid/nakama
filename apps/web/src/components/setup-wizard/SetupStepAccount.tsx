import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import type { SetupAccountDraft } from "@/components/setup-wizard/setup-wizard.shared";

interface SetupStepAccountProps {
  onNext: (account: SetupAccountDraft) => void;
}

export function SetupStepAccount({ onNext }: SetupStepAccountProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

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
      </form>
    </Card>
  );
}
