"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import type { LinkSafetyModalProps } from "streamdown";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { splitExternalUrl } from "@/lib/external-link-url";

const LEARN_MORE_HREF =
  "https://www.cisa.gov/secure-our-world/recognize-and-report-phishing";

export function ExternalLinkSafetyModal({
  url,
  isOpen,
  onClose,
  onConfirm,
}: LinkSafetyModalProps) {
  const [copied, setCopied] = useState(false);
  const { prefix, host, suffix } = splitExternalUrl(url);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable in some contexts.
    }
  }

  function handleClose() {
    setCopied(false);
    onClose();
  }

  function handleConfirm() {
    onConfirm();
    handleClose();
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent
        className="flex w-full max-w-md flex-col gap-3 rounded-3xl border bg-background p-6 shadow-lg sm:max-w-md"
        data-streamdown="link-safety-modal"
        showCloseButton={false}
      >
        <div className="flex items-center justify-between gap-3">
          <DialogTitle className="m-0 text-lg leading-none font-semibold text-foreground">
            External site
          </DialogTitle>
          <button
            className="-m-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={handleClose}
            title="Close"
            type="button"
          >
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <div className="flex flex-col gap-2 py-4">
          <DialogDescription className="m-0 text-sm leading-snug text-muted-foreground">
            Verify this link is where you&apos;d like to go.{" "}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href={LEARN_MORE_HREF}
              rel="noreferrer"
              target="_blank"
            >
              How to recognize phishing (CISA)
            </a>
          </DialogDescription>

          <p className="m-0 break-all pt-2 text-sm leading-snug">
            <span className="text-muted-foreground">{prefix}</span>
            <span className="font-semibold text-foreground">{host}</span>
            <span className="text-muted-foreground">{suffix}</span>
          </p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            className="h-9 rounded-full border px-4 leading-none"
            onClick={() => void handleCopy()}
            type="button"
            variant="outline"
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button
            className="h-9 rounded-full px-4 leading-none"
            onClick={handleConfirm}
            type="button"
          >
            Open link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
