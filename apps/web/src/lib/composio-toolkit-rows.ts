import type {
  ComposioCatalogToolkitSummary,
  ComposioToolkitSummary,
  ComposioUserConnectionSummary,
  ListComposioToolkitsResponse,
} from "@nakama/core/contract";

/**
 * The catalog is 200 apps, which buries the ones a team actually asks for. The
 * list opens on these plus whatever the org already enabled; everything else is
 * one click away behind "all apps", and search always covers the full catalog.
 */
const FEATURED_TOOLKIT_SLUGS = new Set([
  "airtable",
  "asana",
  "clickup",
  "discord",
  "dropbox",
  "facebook",
  "github",
  "gmail",
  "googlecalendar",
  "googledocs",
  "googledrive",
  "googlemeet",
  "googlesheets",
  "googletasks",
  "jira",
  "linear",
  "linkedin",
  "notion",
  "one_drive",
  "outlook",
  "reddit",
  "slack",
  "trello",
  "twitter",
  "whatsapp",
  "youtube",
  "zoom",
]);

function compareToolkitRows(a: ToolkitRowModel, b: ToolkitRowModel): number {
  const aActive = isActiveToolkit(a) ? 0 : 1;
  const bActive = isActiveToolkit(b) ? 0 : 1;

  if (aActive !== bActive) {
    return aActive - bActive;
  }

  return a.catalog.name.localeCompare(b.catalog.name);
}

export interface ToolkitRowModel {
  catalog: ComposioCatalogToolkitSummary;
  orgToolkit: ComposioToolkitSummary | undefined;
  userConnection: ComposioUserConnectionSummary | undefined;
}

function matchesToolkitSearch(
  toolkit: ComposioCatalogToolkitSummary,
  query: string
): boolean {
  const haystack =
    `${toolkit.name} ${toolkit.slug} ${toolkit.description ?? ""}`.toLowerCase();

  return haystack.includes(query);
}

function isActiveToolkit(row: ToolkitRowModel): boolean {
  if (row.orgToolkit?.status === "enabled") {
    return true;
  }

  return row.userConnection !== undefined;
}

export function buildToolkitRows(
  data: ListComposioToolkitsResponse
): ToolkitRowModel[] {
  const orgBySlug = new Map(
    data.orgToolkits.map((toolkit) => [toolkit.toolkitSlug, toolkit])
  );

  const userByToolkitId = new Map(
    data.userConnections.map((connection) => [connection.toolkitId, connection])
  );

  return data.catalog.map((catalogToolkit) => {
    const orgToolkit = orgBySlug.get(catalogToolkit.slug);

    const userConnection = orgToolkit
      ? userByToolkitId.get(orgToolkit.id)
      : undefined;

    return { catalog: catalogToolkit, orgToolkit, userConnection };
  });
}

export function searchToolkitRows(input: {
  isOrgAdmin: boolean;
  query: string;
  rows: ToolkitRowModel[];
}): ToolkitRowModel[] {
  const matches = input.rows.filter((row) =>
    matchesToolkitSearch(row.catalog, input.query)
  );

  if (input.isOrgAdmin) {
    return matches.toSorted(compareToolkitRows);
  }

  return matches.filter((row) => row.orgToolkit?.status === "enabled");
}

function isOrgEnabled(row: ToolkitRowModel): boolean {
  return row.orgToolkit?.status === "enabled";
}

export function inUseToolkitRows(rows: ToolkitRowModel[]): ToolkitRowModel[] {
  return rows.filter(isOrgEnabled).toSorted(compareToolkitRows);
}

export function addableToolkitRows(
  rows: ToolkitRowModel[],
  showAllApps: boolean
): ToolkitRowModel[] {
  return rows
    .filter(
      (row) =>
        !isOrgEnabled(row) &&
        (showAllApps || FEATURED_TOOLKIT_SLUGS.has(row.catalog.slug))
    )
    .toSorted((a, b) => a.catalog.name.localeCompare(b.catalog.name));
}
