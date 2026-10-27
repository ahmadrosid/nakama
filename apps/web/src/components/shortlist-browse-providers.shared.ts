import type { ShortlistCapabilityProvider } from "@/lib/models";
import { isShortlistCapabilityProvider } from "@/lib/models";

export type ShortlistBrowseProvider = ShortlistCapabilityProvider;

export const isShortlistBrowseProvider = isShortlistCapabilityProvider;

export const SHORTLIST_BROWSE_COPY: Record<
  ShortlistBrowseProvider,
  { browseLabel: string; footerHint: string }
> = {
  cerebras: {
    browseLabel: "Browse Cerebras",
    footerHint:
      "Add models by ID or browse Cerebras. Reasoning-capable models enable thinking by default. Pricing from browse is saved for usage cost on the Status page.",
  },
  cloudflare: {
    browseLabel: "Browse Cloudflare",
    footerHint:
      "Add models by ID or browse the Workers AI text generation models on your account. Saved models replace the built-in list. Pricing from browse is saved for usage cost on the Status page.",
  },
  fireworks: {
    browseLabel: "Browse Fireworks",
    footerHint:
      "Add models by ID or browse Fireworks serverless models. Reasoning-capable models enable thinking by default. Pricing from browse is saved for usage cost on the Status page.",
  },
};
