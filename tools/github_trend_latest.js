export const parameters = {
  type: "object",
  properties: {
    daysBack: {
      type: "number",
      description: "How many days back to look for newly created repos. Defaults to 7.",
    },
    perPage: {
      type: "number",
      description: "How many repos to return. Defaults to 5.",
    },
  },
  additionalProperties: false,
};

export async function run(input) {
  const daysBack = clampPositiveInteger(input?.daysBack, 7, 1, 30);
  const perPage = clampPositiveInteger(input?.perPage, 5, 1, 25);
  const createdAfter = daysAgoIsoDate(daysBack);

  const params = new URLSearchParams({
    q: `created:>${createdAfter}`,
    sort: "stars",
    order: "desc",
    per_page: String(perPage),
  });

  const response = await fetch(
    `https://api.github.com/search/repositories?${params.toString()}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "tinyclaw-github-trend",
      },
    },
  );

  const payload = await response.json();

  if (!response.ok) {
    return {
      error: `GitHub API request failed with status ${response.status}`,
      status: response.status,
      payload,
    };
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];

  return {
    createdAfter,
    perPage,
    totalCount: Number(payload?.total_count ?? items.length),
    repositories: items.map((repo) => ({
      name: repo.full_name,
      url: repo.html_url,
      description: repo.description,
      stars: repo.stargazers_count,
      language: repo.language,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
    })),
  };
}

function daysAgoIsoDate(daysBack) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysBack);
  return date.toISOString().slice(0, 10);
}

function clampPositiveInteger(value, fallback, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);

  if (normalized < min) {
    return min;
  }

  if (normalized > max) {
    return max;
  }

  return normalized;
}
