/**
 * Adapted from AIcss Web Search (https://www.aicss.dev/components/web-search).
 * Production use requires a valid AIcss license per https://www.aicss.dev/pricing
 */
import styles from "./WebSearch.module.css";
import type { WebSearchSiteState, WebSearchSource, WebSourceCardMode } from "./web-search.shared";

const GLOBE_MERIDIANS = {
  L: "M6.057 11.565 C2.081 11.565 0.371 8.159 0.371 5.964 C0.371 3.642 2.152 0.329 6.05 0.329",
  ML: "M6.012 11.55 C4.575 10.496 3.333 8.116 3.321 5.964 C3.307 3.399 4.974 0.977 6.012 0.329",
  MR: "M6.012 11.55 C7.211 10.781 8.715 8.287 8.715 5.964 C8.715 3.399 7.24 1.233 6.012 0.329",
  R: "M6.012 11.55 C9.677 11.55 11.65 8.487 11.65 5.964 C11.65 3.499 9.748 0.329 6.012 0.329",
};

function Globe() {
  const values = [
    GLOBE_MERIDIANS.L,
    GLOBE_MERIDIANS.ML,
    GLOBE_MERIDIANS.MR,
    GLOBE_MERIDIANS.R,
    GLOBE_MERIDIANS.L,
  ].join(";");

  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.85"
      strokeLinecap="round"
      style={{ overflow: "visible" }}
      aria-hidden
    >
      <circle cx="6" cy="6" r="5.7" opacity="0.9" />
      <line x1="0.3" y1="6" x2="11.7" y2="6" opacity="0.9" />
      {["0s", "-1.2s", "-2.4s", "-3.6s", "-4.8s", "-6s"].map((begin) => (
        <path key={begin} d={GLOBE_MERIDIANS.L} opacity="0">
          <animate
            attributeName="d"
            dur="7.2s"
            begin={begin}
            repeatCount="indefinite"
            calcMode="spline"
            keyTimes="0;0.25;0.5;0.75;1"
            keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
            values={values}
          />
          <animate
            attributeName="opacity"
            dur="7.2s"
            begin={begin}
            repeatCount="indefinite"
            calcMode="linear"
            keyTimes="0;0.05;0.7;0.75;1"
            values="0;0.9;0.9;0;0"
          />
        </path>
      ))}
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function CaretIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m4.5 15.75 7.5-7.5 7.5 7.5" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="12" cy="12" r="9" strokeWidth="1.8" strokeDasharray="1.8 3.6" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export interface WebSourceCardProps {
  mode: WebSourceCardMode;
  headerText: string;
  sources: WebSearchSource[];
  siteStates: WebSearchSiteState[];
  isComplete: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formatDisplayUrl?: (source: WebSearchSource) => string;
}

export interface WebSearchProps {
  query: string;
  sources: WebSearchSource[];
  siteStates: WebSearchSiteState[];
  isComplete: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formatDisplayUrl?: (source: WebSearchSource) => string;
}

export function formatWebSearchDisplayUrl(source: WebSearchSource): string {
  const href = source.href ?? source.url;

  try {
    const parsed = new URL(href.startsWith("http") ? href : `https://${href}`);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${host}${path}${parsed.search}`;
  } catch {
    return source.url;
  }
}

export function WebSourceCard({
  mode,
  headerText,
  sources,
  siteStates,
  isComplete,
  open,
  onOpenChange,
  formatDisplayUrl = formatWebSearchDisplayUrl,
}: WebSourceCardProps) {
  const headerLabel =
    mode === "fetch"
      ? isComplete
        ? "Fetched"
        : "Fetching"
      : isComplete
        ? "Searched"
        : "Searching";
  const quoteHeader = mode === "search" || !/^\d+ pages$/.test(headerText);

  return (
    <div className={styles.ws} data-state={isComplete ? "done" : "loading"}>
      <div className={styles.wsRow}>
        {mode === "fetch" ? <LinkIcon /> : <SearchIcon />}

        <span className={styles.wsLabel}>
          <span className={`${styles.wsShimmer}${isComplete ? ` ${styles.isDone}` : ""}`}>
            {headerLabel}{" "}
            {quoteHeader ? (
              <span className={styles.wsQuote}>&ldquo;{headerText}&rdquo;</span>
            ) : (
              <span className={styles.wsQuote}>{headerText}</span>
            )}
          </span>
          {sources.length > 0 ? (
            <button
              type="button"
              className={styles.wsChevron}
              aria-label="Toggle results"
              aria-expanded={open}
              onClick={() => onOpenChange(!open)}
            >
              <CaretIcon />
            </button>
          ) : null}
        </span>
      </div>

      {sources.length > 0 ? (
        <div className={`${styles.wsCollapsible}${open ? "" : ` ${styles.isCollapsed}`}`}>
          <div className={styles.wsCollapsibleInner}>
            <div className={styles.wsResults}>
              <span className={styles.wsRail} aria-hidden />
              <ul className={styles.wsList}>
                {sources.map((source, index) => {
                  const state = siteStates[index] ?? "pending";
                  const href = source.href ?? source.url;
                  const displayUrl = formatDisplayUrl(source);

                  const row = (
                    <>
                      <span className={styles.wsBullet}>
                        <span className={styles.wsDots}>
                          <DotsIcon />
                        </span>
                        <span className={styles.wsGlobe}>
                          <Globe />
                        </span>
                        <span className={styles.wsCheck}>
                          <CheckIcon />
                        </span>
                      </span>
                      <span className={styles.wsTitle}>{source.title}</span>
                      <span className={styles.wsSep}>·</span>
                      <span className={styles.wsUrl}>{displayUrl}</span>
                      <span className={styles.wsArrow}>
                        <ArrowUpIcon />
                      </span>
                    </>
                  );

                  return (
                    <li
                      key={source.url}
                      className={styles.wsSite}
                      data-state={state}
                      style={{ animationDelay: `${index * 40}ms` }}
                    >
                      {state === "done" && href ? (
                        <a
                          href={href.startsWith("http") ? href : `https://${href}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.wsSiteLink}
                        >
                          {row}
                        </a>
                      ) : (
                        row
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WebSearch({
  query,
  sources,
  siteStates,
  isComplete,
  open,
  onOpenChange,
  formatDisplayUrl,
}: WebSearchProps) {
  return (
    <WebSourceCard
      mode="search"
      headerText={query}
      sources={sources}
      siteStates={siteStates}
      isComplete={isComplete}
      open={open}
      onOpenChange={onOpenChange}
      formatDisplayUrl={formatDisplayUrl}
    />
  );
}
