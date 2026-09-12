/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */

import type { ReactNode } from "react";
import { createCollection } from "./ui-collection";
import type { Context, Profile } from "./ui-context";
export function createBrowser(ctx: Context) {
  const React = ctx.React;
  const {
    Button,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
  } = ctx.ui;
  const Collection = createCollection(ctx);
  return function Browser({
    profiles,
    controls,
  }: {
    profiles: Profile[];
    controls: ReactNode;
  }) {
    const [agentId, setAgentId] = React.useState(profiles[0]?.id ?? "");
    const [kind, setKind] = React.useState<"memory" | "knowledge">("memory");
    const selector = (
      <Select
        onValueChange={(value) => setAgentId(value ?? "")}
        value={agentId}
      >
        <SelectTrigger aria-label="Agent">
          <SelectValue placeholder="Choose agent">
            {profiles.find((profile) => profile.id === agentId)?.name}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {profile.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
    const tabs = (
      <div aria-label="Collection" className="sm-tabs" role="group">
        <Button
          aria-pressed={kind === "memory"}
          className="sm-tab"
          onClick={() => setKind("memory")}
          variant="ghost"
        >
          Memory
        </Button>
        <Button
          aria-pressed={kind === "knowledge"}
          className="sm-tab"
          onClick={() => setKind("knowledge")}
          variant="ghost"
        >
          Knowledge
        </Button>
      </div>
    );
    return (
      <>
        {agentId ? (
          <Collection
            agentId={agentId}
            key={`${agentId}:${kind}`}
            kind={kind}
            tabs={tabs}
            toolbar={
              <>
                {selector}
                {controls}
              </>
            }
          />
        ) : (
          <>
            <div className="sm-row">
              {selector}
              {controls}
            </div>
            <p className="sm-empty">No agents available</p>
          </>
        )}
      </>
    );
  };
}
