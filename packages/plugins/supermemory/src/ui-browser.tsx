/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */

import type { ReactNode } from "react";
import { createCollection } from "./ui-collection";
import { type Context, errorText, type Profile } from "./ui-context";
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
  function DocumentPage({
    agentId,
    documentId,
  }: {
    agentId: string;
    documentId: string;
  }) {
    const [document, setDocument] = React.useState<{
      title: string;
      content: string | null;
      source: string;
    } | null>(null);
    const [error, setError] = React.useState("");
    React.useEffect(() => {
      let active = true;
      ctx.host
        .call("get_document", { agentId, id: documentId })
        .then((result) => {
          if (active) {
            setDocument(
              result as {
                title: string;
                content: string | null;
                source: string;
              }
            );
          }
        })
        .catch((reason) => {
          if (active) {
            setError(errorText(reason));
          }
        });
      return () => {
        active = false;
      };
    }, [agentId, documentId]);
    return (
      <article className="sm-stack">
        <div>
          <Button
            render={
              <a
                aria-label="Back to Knowledge"
                href={`/plugins/supermemory?agent=${encodeURIComponent(agentId)}&tab=knowledge`}
              />
            }
            variant="ghost"
          >
            ← Back to Knowledge
          </Button>
        </div>
        {error ? (
          <p role="alert">{error}</p>
        ) : document ? (
          <>
            <h1
              style={{
                fontSize: "24px",
                fontWeight: 600,
                overflowWrap: "anywhere",
              }}
            >
              {document.title}
            </h1>
            {document.source && <p className="sm-source">{document.source}</p>}
            <div
              style={{
                lineHeight: 1.7,
                overflowWrap: "anywhere",
                whiteSpace: "pre-wrap",
              }}
            >
              {document.content ?? "Content is not available yet."}
            </div>
          </>
        ) : (
          <p role="status">Loading…</p>
        )}
      </article>
    );
  }
  return function Browser({
    profiles,
    controls,
  }: {
    profiles: Profile[];
    controls: ReactNode;
  }) {
    const params = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search
    );
    const requestedAgent = params.get("agent");
    const documentId = params.get("document");
    const [agentId, setAgentId] = React.useState(
      profiles.find((profile) => profile.id === requestedAgent)?.id ??
        profiles[0]?.id ??
        ""
    );
    const [kind, setKind] = React.useState<"memory" | "knowledge">(
      params.get("tab") === "knowledge" ? "knowledge" : "memory"
    );
    if (documentId) {
      return (
        <DocumentPage
          agentId={requestedAgent ?? agentId}
          documentId={documentId}
          key={`${requestedAgent}:${documentId}`}
        />
      );
    }
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
