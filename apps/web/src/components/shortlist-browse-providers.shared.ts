import type { ShortlistCapabilityProvider } from "@/lib/models";
import { isShortlistCapabilityProvider } from "@/lib/models";

export type ShortlistBrowseProvider = ShortlistCapabilityProvider;

export const isShortlistBrowseProvider = isShortlistCapabilityProvider;

export const SHORTLIST_BROWSE_COPY: Record<
  ShortlistBrowseProvider,
  { browseLabel: string }
> = {
  cerebras: { browseLabel: "Browse Cerebras" },
  cloudflare: { browseLabel: "Browse Cloudflare" },
  fireworks: { browseLabel: "Browse Fireworks" },
};
