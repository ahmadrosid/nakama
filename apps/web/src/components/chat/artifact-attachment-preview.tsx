import { Button } from "@nakama/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import {
  ArrowDown01Icon,
  Csv02Icon,
  Download04Icon,
  File01Icon,
  Globe02Icon,
  Image01Icon,
  LinkSquare02Icon,
  Video01Icon,
  ViewIcon,
  Xls02Icon,
} from "hugeicons-react";
import type { ReactNode } from "react";
import { useArtifactAttachmentPreviewPanel } from "@/components/chat/use-artifact-attachment-preview-panel";
import { isXlsxFile } from "@/lib/artifact-spreadsheet";
import {
  buildArtifactContentUrl,
  type ChatArtifactRef,
} from "@/lib/chat-artifacts";
import { client } from "@/lib/client";
import { formatBytes } from "@/lib/knowledge-base-files";

interface ArtifactAttachmentPreviewProps {
  artifact: ChatArtifactRef;
  className?: string;
  id: string;
  profileId: string;
  /** `overlay` makes the containing file card the preview target. */
  variant?: "chip" | "icon" | "overlay";
}

export function ArtifactAttachmentPreview({
  profileId,
  id,
  artifact,
  className,
  variant = "chip",
}: ArtifactAttachmentPreviewProps) {
  const { isImage, isVideo, openPanel } = useArtifactAttachmentPreviewPanel({
    artifact,
    id,
    // Preview, download, share and save all go through this id.
    profileId: artifact.ownerProfileId ?? profileId,
  });

  if (variant === "overlay") {
    return (
      <button
        aria-label={`View ${artifact.filename}`}
        className={cn(
          "absolute inset-0 cursor-pointer rounded-[inherit] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
          className
        )}
        onClick={openPanel}
        type="button"
      />
    );
  }

  if (variant === "icon") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="View"
              className={className}
              onClick={openPanel}
              size="icon-sm"
              title="View"
              type="button"
              variant="outline"
            >
              <ViewIcon aria-hidden className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent side="top" sideOffset={8}>
          View
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <FilePreviewCard
      artifact={artifact}
      className={className}
      isImage={isImage}
      isVideo={isVideo}
      onDownload={() => {
        const link = document.createElement("a");
        link.href = `${client.baseUrl}${buildArtifactContentUrl(artifact.ownerProfileId ?? profileId, artifact.path)}`;
        link.download = artifact.filename;
        document.body.append(link);
        link.click();
        link.remove();
      }}
      onOpen={openPanel}
    />
  );
}

/** Cells of the small sheet sketch in a spreadsheet file card. */
const SHEET_CELLS = Array.from({ length: 12 }, (_, cell) => cell);

/** The label, icon and icon color a file card shows for one file. */
function fileCardKind(
  artifact: ChatArtifactRef,
  isImage: boolean,
  isVideo: boolean
) {
  const excel = isXlsxFile(artifact.filename, artifact.mimeType);
  const extension = artifact.filename.split(".").pop()?.toLowerCase() ?? "";

  const fileTypes = new Map<string, string>([
    ["csv", "CSV"],
    ["doc", "Word"],
    ["docx", "Word"],
    ["htm", "Website"],
    ["html", "Website"],
    ["json", "JSON"],
    ["markdown", "Markdown"],
    ["md", "Markdown"],
    ["pdf", "PDF"],
    ["ppt", "PowerPoint"],
    ["pptx", "PowerPoint"],
    ["tsv", "TSV"],
    ["txt", "Text"],
    ["zip", "Archive"],
  ]);

  const label = excel
    ? "Excel"
    : isImage
      ? "Image"
      : isVideo
        ? "Video"
        : (fileTypes.get(extension) ??
          (extension === artifact.filename.toLowerCase()
            ? "File"
            : extension.toUpperCase()));

  const Icon =
    new Map([
      ["Image", Image01Icon],
      ["Video", Video01Icon],
      ["Website", Globe02Icon],
    ]).get(label) ?? File01Icon;

  const iconColor =
    new Map([
      ["Excel", "text-emerald-600 dark:text-emerald-400"],
      ["Website", "text-sky-500"],
    ]).get(label) ?? "text-muted-foreground";

  return { excel, extension, Icon, iconColor, label };
}

/** Colors of the small preview tile, by kind of file. */
const PREVIEW_TILE = {
  doc: {
    badge: "bg-neutral-600",
    line: "bg-border",
    lineStrong: "bg-muted-foreground/40",
    page: "border-border",
    tile: "border-border bg-muted px-3 pt-1",
  },
  media: {
    badge: "bg-neutral-600",
    tile: "items-center justify-center border-border bg-muted text-muted-foreground",
  },
  pdf: {
    badge: "bg-orange-700",
    line: "bg-orange-200 dark:bg-orange-800",
    lineStrong: "bg-orange-300 dark:bg-orange-700",
    page: "border-orange-200 dark:border-orange-800",
    tile: "border-orange-100 bg-orange-50 px-3 pt-1 dark:border-orange-900 dark:bg-orange-950",
  },
  sheet: {
    badge: "bg-emerald-700",
    tile: "grid grid-cols-4 grid-rows-3 border-emerald-200 bg-background dark:border-emerald-900",
  },
  web: {
    badge: "bg-sky-700",
    tile: "items-end gap-0.5 border-sky-100 bg-sky-50 p-1 dark:border-sky-900 dark:bg-sky-950",
  },
} as const;

type PreviewTileKind = keyof typeof PREVIEW_TILE;

/** A small sketch of the file's content, with its type badge. */
function FilePreviewTile({
  badge,
  Icon,
  kind,
}: {
  badge: string;
  Icon: ReturnType<typeof fileCardKind>["Icon"];
  kind: PreviewTileKind;
}) {
  const style = PREVIEW_TILE[kind];

  let sketch: ReactNode = <Icon className="size-4" />;
  if (kind === "web") {
    sketch = (
      <>
        <span className="h-2/5 flex-1 rounded-[1px] bg-sky-300 dark:bg-sky-700" />
        <span className="h-[70%] flex-1 rounded-[1px] bg-sky-300 dark:bg-sky-700" />
        <span className="h-[55%] flex-1 rounded-[1px] bg-sky-300 dark:bg-sky-700" />
        <span className="h-[95%] flex-1 rounded-[1px] bg-sky-600 dark:bg-sky-500" />
      </>
    );
  } else if (kind === "sheet") {
    sketch = SHEET_CELLS.map((cell) => (
      <span
        className={
          cell < 4
            ? "bg-emerald-100 dark:bg-emerald-900"
            : "border-emerald-100 border-t border-r dark:border-emerald-900"
        }
        key={cell}
      />
    ));
  } else if (kind === "pdf" || kind === "doc") {
    const page = PREVIEW_TILE[kind];
    sketch = (
      <span
        className={cn(
          "flex size-full flex-col gap-0.5 rounded-t-[2px] border border-b-0 bg-background p-[3px]",
          page.page
        )}
      >
        <span className={cn("h-0.5 w-[70%]", page.lineStrong)} />
        <span className={cn("h-0.5 w-full", page.line)} />
        <span className={cn("h-0.5 w-[90%]", page.line)} />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "relative flex h-9 w-14 shrink-0 overflow-hidden rounded-md border",
        style.tile
      )}
    >
      {sketch}
      <span
        className={cn(
          "absolute bottom-0.5 left-0.5 rounded-[2px] px-[3px] font-bold text-[8px] text-white leading-tight tracking-wide",
          style.badge
        )}
      >
        {badge}
      </span>
    </span>
  );
}

export function FilePreviewCard({
  artifact,
  className,
  isImage,
  isVideo,
  onOpen,
  onDownload,
}: {
  artifact: ChatArtifactRef;
  className?: string;
  isImage: boolean;
  isVideo: boolean;
  onOpen: () => void;
  onDownload: () => void;
}) {
  const { excel, extension, Icon, label } = fileCardKind(
    artifact,
    isImage,
    isVideo
  );

  const { filename } = artifact;

  const kinds: [boolean, PreviewTileKind][] = [
    [excel || label === "CSV" || label === "TSV", "sheet"],
    [isImage || isVideo, "media"],
    [label === "Website", "web"],
    [label === "PDF", "pdf"],
  ];

  const kind = kinds.find(([match]) => match)?.[1] ?? "doc";

  const badge =
    extension && extension !== filename.toLowerCase()
      ? extension.toUpperCase().slice(0, 4)
      : label.toUpperCase();

  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-full items-center gap-2.5 rounded-xl border border-border bg-background p-1.5 dark:bg-secondary",
        className
      )}
    >
      <button
        aria-label={`Preview ${filename}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpen}
        type="button"
      >
        <FilePreviewTile badge={badge} Icon={Icon} kind={kind} />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span
            className="min-w-0 truncate font-medium text-foreground text-sm"
            title={filename}
          >
            {filename}
          </span>
          <span className="shrink-0 text-muted-foreground text-xs">
            {artifact.sizeBytes > 0 ? formatBytes(artifact.sizeBytes) : label}
          </span>
        </span>
      </button>
      <div className="flex shrink-0">
        <Button
          aria-label={`Open ${filename}`}
          className="h-10 rounded-r-none px-3 text-xs sm:h-8"
          onClick={onOpen}
          variant="outline"
        >
          Open
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={`More actions for ${filename}`}
                className="h-10 w-8 rounded-l-none border-l-0 sm:h-8"
                size="icon"
                variant="outline"
              />
            }
          >
            <ArrowDown01Icon aria-hidden className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDownload}>
              <Download04Icon aria-hidden className="size-4" />
              Download
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** A small card with one open button, for files the user sent. */
export function CompactFileCard({
  artifact,
  className,
  isImage,
  isVideo,
  onOpen,
}: {
  artifact: ChatArtifactRef;
  className?: string;
  isImage: boolean;
  isVideo: boolean;
  onOpen: () => void;
}) {
  const { excel, extension, Icon, iconColor, label } = fileCardKind(
    artifact,
    isImage,
    isVideo
  );

  const sheet = excel || label === "CSV" || label === "TSV";
  const FileIcon = label === "CSV" ? Csv02Icon : sheet ? Xls02Icon : Icon;
  const { filename } = artifact;

  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-full items-center gap-3 rounded-2xl border border-border bg-background py-2 pr-1 pl-2 dark:bg-secondary",
        className
      )}
    >
      <button
        aria-label={`Preview ${filename}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpen}
        type="button"
      >
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            sheet
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : cn("bg-muted", iconColor)
          )}
        >
          <FileIcon aria-hidden className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate font-medium text-foreground text-sm"
            title={filename}
          >
            {filename}
          </span>
          <span className="block text-muted-foreground text-xs">
            {sheet && extension
              ? `Spreadsheet · ${extension.toUpperCase()}`
              : label}
          </span>
        </span>
      </button>
      <Button
        aria-label={`Open ${filename}`}
        className="size-11 shrink-0 text-muted-foreground"
        onClick={onOpen}
        size="icon"
        variant="ghost"
      >
        <LinkSquare02Icon aria-hidden className="size-4.5" />
      </Button>
    </div>
  );
}
