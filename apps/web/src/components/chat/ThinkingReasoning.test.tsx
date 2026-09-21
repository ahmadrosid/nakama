import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantTurnSegmentView } from "./assistant-tool-group";
import { ThinkingReasoning } from "./ThinkingReasoning";

test.each([true, false])(
  "completed tool group renders saved timing only: %s",
  (hasTiming) => {
    const html = renderToStaticMarkup(
      <AssistantTurnSegmentView
        segment={{
          kind: "work",
          tools: ["t1", "t2"].map((id) => ({
            content: "{}",
            id,
            role: "tool",
            tool: "sample",
            toolStatus: "done",
            ...(hasTiming
              ? { toolCompletedAt: 9000, toolStartedAt: 1000 }
              : {}),
          })),
        }}
      />
    );
    expect(html).toContain("2 tools");
    if (hasTiming) {
      expect(html).toContain("8s");
    } else {
      expect(html).not.toContain("1s");
    }
  }
);

test.each([
  [8000, "Thought</span> for 8s"],
  [65_000, "Thought</span> for 1m 5s"],
  [0, "Thought</span> for 1s"],
])(
  "completed reasoning renders its recorded duration: %s",
  (duration, label) => {
    const html = renderToStaticMarkup(
      <ThinkingReasoning
        isThinkingStreaming={false}
        isWorkActive={false}
        text="Let me think"
        thinkingDurationMs={duration}
      />
    );
    expect(html).toContain(label);
  }
);

test.each([undefined, Number.NaN, -1])(
  "history without a valid duration does not invent one: %s",
  (duration) => {
    const html = renderToStaticMarkup(
      <ThinkingReasoning
        isThinkingStreaming={false}
        isWorkActive={false}
        startedAt="2020-01-01T00:00:00Z"
        text="Let me think"
        thinkingDurationMs={duration}
      />
    );
    expect(html).toContain("Thought</span>");
    expect(html).not.toContain("Thought</span> for");
  }
);
