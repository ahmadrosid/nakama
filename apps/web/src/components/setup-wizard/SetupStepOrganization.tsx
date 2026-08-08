import { useRef, useState } from "react";
import type { SetupAccountDraft } from "@/components/setup-wizard/setup-wizard.shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/use-auth";

interface SetupStepOrganizationProps {
  account: SetupAccountDraft;
  onBack: () => void;
  onNext: () => void;
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

export function SetupStepOrganization({
  account,
  onNext,
  onBack,
}: SetupStepOrganizationProps) {
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

    if (!(trimmedSlug && SLUG_PATTERN.test(trimmedSlug))) {
      setError("Slug must use lowercase letters, numbers, and hyphens.");
      return;
    }

    setIsSubmitting(true);

    try {
      await setup({
        admin: {
          email: account.email,
          name: account.name,
          password: account.password,
          phone: account.phone,
        },
        organization: { name: trimmedName, slug: trimmedSlug },
      });
      onNext();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create organization"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="p-6">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label
            className="mb-1 block font-medium text-sm"
            htmlFor="setup-org-name"
          >
            Organization name
          </label>
          <Input
            id="setup-org-name"
            onChange={(event) => handleNameChange(event.target.value)}
            placeholder="Acme Corp"
            required
            value={name}
          />
        </div>
        <div>
          <label
            className="mb-1 block font-medium text-sm"
            htmlFor="setup-org-slug"
          >
            Slug
          </label>
          <Input
            id="setup-org-slug"
            onChange={(event) => {
              slugEditedRef.current = true;
              setSlug(event.target.value);
            }}
            placeholder="acme-corp"
            required
            value={slug}
          />
          <p className="mt-1 text-muted-foreground text-xs">
            Used in URLs and API context. Lowercase letters, numbers, and
            hyphens only.
          </p>
        </div>
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-red-800 text-sm dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}
        <div className="flex gap-3">
          <Button
            className="flex-1"
            onClick={onBack}
            type="button"
            variant="outline"
          >
            Back
          </Button>
          <Button className="flex-1" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Creating..." : "Create Organization"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
