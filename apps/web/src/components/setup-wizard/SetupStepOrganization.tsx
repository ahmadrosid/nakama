import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/context/use-auth";
import type { SetupAccountDraft } from "@/components/setup-wizard/setup-wizard.shared";

interface SetupStepOrganizationProps {
  account: SetupAccountDraft;
  onNext: () => void;
  onBack: () => void;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugifyOrganizationName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "org"
  );
}

export function SetupStepOrganization({ account, onNext, onBack }: SetupStepOrganizationProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const slugEditedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { setup } = useAuth();

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugEditedRef.current) {
      setSlug(slugifyOrganizationName(value));
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedSlug = slug.trim().toLowerCase();

    if (!trimmedName) {
      setError("Organization name is required.");
      return;
    }

    if (!trimmedSlug || !SLUG_PATTERN.test(trimmedSlug)) {
      setError("Slug must use lowercase letters, numbers, and hyphens.");
      return;
    }

    setIsSubmitting(true);

    try {
      await setup({
        organization: { name: trimmedName, slug: trimmedSlug },
        admin: {
          name: account.name,
          email: account.email,
          phone: account.phone,
          password: account.password,
        },
      });
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="setup-org-name" className="mb-1 block text-sm font-medium">
            Organization name
          </label>
          <Input
            id="setup-org-name"
            value={name}
            onChange={(event) => handleNameChange(event.target.value)}
            placeholder="Acme Corp"
            required
          />
        </div>
        <div>
          <label htmlFor="setup-org-slug" className="mb-1 block text-sm font-medium">
            Slug
          </label>
          <Input
            id="setup-org-slug"
            value={slug}
            onChange={(event) => {
              slugEditedRef.current = true;
              setSlug(event.target.value);
            }}
            placeholder="acme-corp"
            required
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Used in URLs and API context. Lowercase letters, numbers, and hyphens only.
          </p>
        </div>
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="flex-1" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" className="flex-1" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Organization"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
