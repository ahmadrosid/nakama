import type { LucideIcon } from "lucide-react";
import { BlocksIcon, BookOpenIcon, BrainIcon, PlugIcon } from "lucide-react";
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { KnowledgeTab } from "@/components/soul-tools/KnowledgeTab";
import { SoulTab } from "@/components/soul-tools/SoulTab";
import { McpTab } from "@/components/soul-tools/McpTab";
import { ToolsTab } from "@/components/soul-tools/ToolsTab";

const TABS = [
  { id: "soul" as const, label: "Soul", icon: BrainIcon },
  { id: "knowledge" as const, label: "Knowledge", icon: BookOpenIcon },
  { id: "tools" as const, label: "Tools", icon: BlocksIcon },
  { id: "mcp" as const, label: "MCP", icon: PlugIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

function resolveTab(value: string | null): TabId {
  if (value === "knowledge" || value === "tools" || value === "mcp") {
    return value;
  }

  return "soul";
}

export function SoulPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = resolveTab(searchParams.get("tab"));

  const setTab = useCallback(
    (nextTab: TabId) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextTab === "soul") {
            next.delete("tab");
          } else {
            next.set("tab", nextTab);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Soul and tools"
        className="segmented-control"
      >
        {TABS.map((item) => (
          <SegmentedTab
            key={item.id}
            id={`soul-tools-tab-${item.id}`}
            label={item.label}
            icon={item.icon}
            active={tab === item.id}
            controls={`soul-tools-panel-${item.id}`}
            onSelect={() => setTab(item.id)}
          />
        ))}
      </div>

      <div
        id={`soul-tools-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`soul-tools-tab-${tab}`}
      >
        {tab === "soul" ? (
          <SoulTab />
        ) : tab === "knowledge" ? (
          <KnowledgeTab />
        ) : tab === "tools" ? (
          <ToolsTab />
        ) : (
          <McpTab />
        )}
      </div>
    </div>
  );
}

function SegmentedTab({
  id,
  label,
  icon: Icon,
  active,
  controls,
  onSelect,
}: {
  id: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  controls: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      data-active={active || undefined}
      className="segmented-control-item"
      onClick={onSelect}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}
