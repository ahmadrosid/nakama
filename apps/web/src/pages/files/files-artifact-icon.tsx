import { File02Icon, Film02Icon, Image02Icon } from "hugeicons-react";
import { classifyArtifactType } from "@/components/soul-tools/artifacts-tab-filters";
import { cn } from "@/lib/utils";

export function ArtifactIcon({
  mimeType,
  filename,
  className,
}: {
  mimeType: string;
  filename: string;
  className?: string;
}) {
  const kind = classifyArtifactType({
    filename,
    mimeType,
    path: filename,
    sizeBytes: 0,
    updatedAt: "",
  });
  const iconClass = cn("size-4 text-muted-foreground", className);

  if (kind === "image") {
    return <Image02Icon aria-hidden className={iconClass} />;
  }

  if (kind === "video") {
    return <Film02Icon aria-hidden className={iconClass} />;
  }

  return <File02Icon aria-hidden className={iconClass} />;
}
