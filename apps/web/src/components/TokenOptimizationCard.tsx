import type { TokenOptimizationResponse } from "@nakama/core/contract";
import { GithubIcon } from "hugeicons-react";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { client, formatError } from "@/lib/client";

/**
 * Palette: categorical slots 1 and 2, validated for both surfaces (six checks;
 * worst adjacent pair ΔE 24.7 protan / 33.6 normal in light, 26.8 / 31.8 in
 * dark). Do not substitute a hue without re-running that check.
 */
/** Where each optimiser lives, so the card can point at what it is running. */
const OPTIMIZER_HOMEPAGE: Record<string, string> = {
  omni: "https://github.com/fajarhide/omni",
};

const CHART_STYLE = `
.tokenopt { --out: #2a78d6; --in: #eb6834; --grid: rgb(0 0 0 / 0.08); }
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .tokenopt {
    --out: #3987e5; --in: #d95926; --grid: rgb(255 255 255 / 0.1);
  }
}
:root[data-theme="dark"] .tokenopt {
  --out: #3987e5; --in: #d95926; --grid: rgb(255 255 255 / 0.1);
}
`;

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDay(day: string): string {
  return `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;
}

/** Turns needed in each arm before the token comparison means anything. */
const MIN_TURNS = 5;

type Day = TokenOptimizationResponse["days"][number];

/**
 * Stacked bars, one per day. Full height is what the tools produced; the lower
 * segment is what reached the model, the upper is what never had to.
 */
function DailyChart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map((day) => day.bytesIn), 1);
  const height = 120;
  const slot = 100 / days.length;
  const width = slot * 0.62;

  return (
    <figure className="m-0 mb-4">
      <div className="relative">
        <svg
          className="w-full"
          height={height}
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 100 ${height}`}
        >
          <title>Bytes produced per day, and the part saved</title>
          <line
            stroke="var(--grid)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            x1={0}
            x2={100}
            y1={height / 2}
            y2={height / 2}
          />
          {days.map((day, index) => {
            const total = (day.bytesIn / max) * (height - 6);
            const sent =
              ((day.bytesIn - day.bytesRemoved) / max) * (height - 6);
            const out = Math.max(0, total - sent);
            const x = index * slot + (slot - width) / 2;
            return (
              <g
                key={day.day}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  fill="transparent"
                  height={height}
                  width={slot}
                  x={index * slot}
                  y={0}
                />
                {sent > 0 ? (
                  <rect
                    fill="var(--in)"
                    height={sent}
                    rx={1}
                    width={width}
                    x={x}
                    y={height - sent}
                  />
                ) : null}
                {out > 0 ? (
                  <rect
                    fill="var(--out)"
                    height={out}
                    rx={1}
                    width={width}
                    x={x}
                    /* 2px surface gap between the fills, per the mark spec */
                    y={height - sent - out - 2}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
        {/* Selective labels, not one per bar: 30 of them collide, and the
            reader needs anchors rather than a full axis. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-4 h-4"
        >
          {days.map((day, index) =>
            index % 7 === 0 || index === days.length - 1 ? (
              <span
                className="absolute -translate-x-1/2 text-[10px] text-muted-foreground tabular-nums"
                key={day.day}
                style={{ left: `${(index + 0.5) * slot}%` }}
              >
                {formatDay(day.day)}
              </span>
            ) : null
          )}
        </div>
        {hover !== null && days[hover] ? (
          <div className="pointer-events-none absolute top-0 right-0 rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm">
            <p className="font-medium">{days[hover].day}</p>
            <p className="text-muted-foreground">
              {formatBytes(days[hover].bytesRemoved)} saved from{" "}
              {formatBytes(days[hover].bytesIn)}
            </p>
          </div>
        ) : null}
      </div>
    </figure>
  );
}

export function TokenOptimizationCard() {
  const [data, setData] = useState<TokenOptimizationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client
      .getTokenOptimization()
      .then((next) => !cancelled && setData(next))
      .catch((cause) => !cancelled && setError(formatError(cause)));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(next: boolean) {
    setSaving(true);
    try {
      await client.setTokenOptimization(next);
      setData(await client.getTokenOptimization());
      setError(null);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setSaving(false);
    }
  }

  if (error && !data) {
    return <p className="p-4 text-destructive text-sm">{error}</p>;
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
        <Spinner /> Loading
      </div>
    );
  }

  // A server older than this page answers without `arms` or `days`. Saying so
  // beats white-screening on a version skew.
  if (!(data.arms?.optimized && data.days?.length)) {
    return (
      <p className="p-4 text-muted-foreground text-sm">
        The server is running an older build than this page. Restart it to see
        this panel.
      </p>
    );
  }

  const { arms, byTool, days, inputTokens, optimizers, totals, windowDays } =
    data;
  const omni = optimizers?.[0];
  // Denominator is everything the handled tools produced, both arms. Dividing
  // by the optimised calls alone would be a percentage of a set chosen after
  // the fact, and it would not match the per-session figure on the chat chip.
  const percent =
    totals.bytesIn > 0 ? (100 * totals.bytesRemoved) / totals.bytesIn : 0;

  return (
    <div className="tokenopt space-y-5 p-4">
      {/** biome-ignore lint/security/noDangerouslySetInnerHtml: static palette, no interpolation */}
      <style dangerouslySetInnerHTML={{ __html: CHART_STYLE }} />

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-sm">{omni?.id ?? "omni"}</p>
            {omni && OPTIMIZER_HOMEPAGE[omni.id] ? (
              <a
                aria-label={`${omni.id} on GitHub`}
                className="text-muted-foreground transition-colors hover:text-foreground"
                href={OPTIMIZER_HOMEPAGE[omni.id]}
                rel="noreferrer noopener"
                target="_blank"
              >
                <GithubIcon aria-hidden size={14} />
              </a>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {omni?.tools.map((tool) => (
              <span
                className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground leading-none"
                key={tool}
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
        <Switch
          checked={Boolean(omni?.enabled)}
          disabled={saving}
          onCheckedChange={toggle}
        />
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      {omni?.enabled && omni.installed === false ? (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-amber-700 text-xs dark:text-amber-400">
          The <code className="font-mono">{omni.id}</code> binary is not on this
          host, so nothing is being shortened. Tool output passes through
          untouched until it is installed.
        </p>
      ) : null}

      {totals.calls === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing measured in the last {windowDays} days.
        </p>
      ) : (
        <>
          <div>
            {/* A stat tile is read by its number, so the number leads. The
                colour is the "saved" series colour, not a decorative one,
                so colour still carries identity here. */}
            <p className="font-semibold text-4xl tabular-nums leading-none">
              <span style={{ color: "var(--out)" }}>{percent.toFixed(0)}%</span>
              <span className="ml-2 font-normal text-lg text-muted-foreground">
                of tool output saved
              </span>
            </p>
            <p className="mt-1.5 text-muted-foreground text-sm">
              {formatBytes(totals.bytesRemoved)} saved from{" "}
              {formatBytes(totals.bytesIn)} tool output, last {windowDays} days
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2.5 rounded-[2px]"
                  style={{ background: "var(--out)" }}
                />
                <span className="text-muted-foreground">saved</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2.5 rounded-[2px]"
                  style={{ background: "var(--in)" }}
                />
                <span className="text-muted-foreground">sent to the model</span>
              </span>
            </div>
            <DailyChart days={days} />
          </div>

          {/* The only tokens on this card. Shown per turn because the arms
              never have the same turn count, and only once both arms have
              enough turns to be worth printing. */}
          {inputTokens.optimized.turns < MIN_TURNS ||
          inputTokens.control.turns < MIN_TURNS ? (
            // Say the threshold rather than hide the block. An absent panel
            // reads as unbuilt; a stated one reads as not enough data yet,
            // which is what it is.
            <div className="rounded border border-border border-dashed p-3">
              <p className="font-medium text-sm">
                Provider input tokens per turn
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                Needs {MIN_TURNS} turns in each arm before the two are worth
                comparing. So far {inputTokens.optimized.turns} optimised and{" "}
                {inputTokens.control.turns} passthrough.
              </p>
            </div>
          ) : (
            <div className="rounded border border-border p-3">
              <p className="mb-2 font-medium text-sm">
                Provider input tokens per turn
              </p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="tabular-nums">
                    {inputTokens.optimized.inputTokensPerTurn.toLocaleString()}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    optimised, {inputTokens.optimized.turns} turns
                  </p>
                </div>
                <div>
                  <p className="tabular-nums">
                    {inputTokens.control.inputTokensPerTurn.toLocaleString()}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    passthrough, {inputTokens.control.turns} turns
                  </p>
                </div>
              </div>
              <p className="mt-2 text-muted-foreground text-xs">
                Counted by the provider, not estimated here. Turns fall into an
                arm by what happened rather than by assignment, so a difference
                in the work itself can explain part of any gap.
              </p>
            </div>
          )}

          {byTool?.length ? (
            <table className="w-full text-sm">
              <tbody>
                {byTool.map((row) => (
                  <tr className="border-border/60 border-t" key={row.tool}>
                    <td className="py-1.5">{row.tool}</td>
                    <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                      {row.calls} calls
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatBytes(row.bytesIn - row.bytesOut)} saved
                    </td>
                  </tr>
                ))}
                <tr className="border-border/60 border-t text-muted-foreground">
                  <td className="py-1.5">passthrough</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {arms.control.calls} calls
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatBytes(arms.control.bytesIn)} sent
                  </td>
                </tr>
              </tbody>
            </table>
          ) : null}
        </>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              className="text-muted-foreground text-xs underline decoration-dotted underline-offset-2"
              type="button"
            >
              What this counts
            </button>
          }
        />
        <TooltipContent className="max-w-xs text-xs" side="top">
          Share of tool output saved before it reached the conversation, over{" "}
          {windowDays} days. Bytes, not tokens and not cost: shortened results
          are re-sent later as cache reads billed at a fraction, so this
          percentage is not a percentage off a bill.
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
