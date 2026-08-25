import { Download04Icon } from "hugeicons-react";
import type { SVGProps } from "react";
import { PendingIcon } from "@/components/data-portability/DataImportPreview";
import { Button } from "@/components/ui/button";
import {
  downloadProfilePackArchive,
  useExportProfilePackMutation,
} from "@/hooks/use-profile-pack";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";

const ExportIcon = ({ className }: SVGProps<SVGSVGElement>) => (
  <Download04Icon className={className} />
);

export function ExportProfileButton({
  profileId,
  disabled,
}: {
  profileId: string;
  disabled?: boolean;
}) {
  const exportMutation = useExportProfilePackMutation();

  async function handleExport() {
    try {
      const result = await exportMutation.mutateAsync(profileId);
      downloadProfilePackArchive(result.filename, result.data);
      toast("Profile pack ready.");
    } catch (err) {
      toast(formatError(err));
    }
  }

  return (
    <Button
      aria-label="Export profile"
      className="self-center"
      disabled={disabled || exportMutation.isPending}
      onClick={() => void handleExport()}
      size="sm"
      type="button"
      variant="outline"
    >
      <PendingIcon idle={ExportIcon} pending={exportMutation.isPending} />
      <span>Export</span>
    </Button>
  );
}
