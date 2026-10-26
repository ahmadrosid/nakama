import { afterEach, describe, expect, mock, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { zipSync } from "fflate";
import { asTestFetch } from "../../providers/test-helpers";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginUserSession,
  seedOrgAdmin,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-skills-marketplace-routes-test-");

const SKILL = `---
name: pdf
description: Work with PDFs.
---

Fill the form.
`;

const BASE = "http://localhost:4310";

function createApp() {
  return createMinimalHonoApp({
    agent: { listProfiles: async () => ({ profiles: [] }) },
    databaseAdapter: createInMemoryDatabaseAdapter(),
  });
}

describe("skills.sh marketplace", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("search returns skills.sh results to platform admins only", async () => {
    let requestedUrl = "";
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(
      mock(async (input) => {
        requestedUrl = String(input);

        return Response.json({
          skills: [
            {
              id: "anthropics/skills/pdf",
              installs: 217_105,
              name: "pdf",
              skillId: "pdf",
              source: "anthropics/skills",
            },
            { id: "broken", name: "no source" },
          ],
        });
      })
    );

    const { app, authService, databaseAdapter } = createApp();

    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin-market@org.com"
    );

    const search = (session: typeof adminSession, orgId: string) =>
      app.fetch(
        new Request(`${BASE}/v1/skills/marketplace?q=pdf`, {
          headers: session.headers({}, orgId),
        })
      );

    const response = await search(adminSession, adminSession.orgId!);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      skills: [
        {
          installs: 217_105,
          name: "pdf",
          skillId: "pdf",
          source: "anthropics/skills",
        },
      ],
    });
    expect(new URL(requestedUrl).searchParams.get("q")).toBe("pdf");

    const tenantAdmin = await seedOrgAdmin(databaseAdapter, {
      authService,
      email: "tenant-market@example.com",
      orgId: "market-tenant",
      userId: "user_market_tenant",
    });

    const tenantSession = await loginUserSession(
      app,
      tenantAdmin.email,
      tenantAdmin.password,
      tenantAdmin.orgId
    );

    expect((await search(tenantSession, tenantAdmin.orgId)).status).toBe(403);

    globalThis.fetch = asTestFetch(
      mock(async () => new Response("down", { status: 503 }))
    );

    expect((await search(adminSession, adminSession.orgId!)).status).toBe(502);
  });

  test("preview lists supporting files, flags scripts and installs nothing", async () => {
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(
      mock(
        async () =>
          new Response(
            zipSync({
              "skills-main/pdf/SKILL.md": new TextEncoder().encode(SKILL),
              "skills-main/pdf/bin/tool": new TextEncoder().encode(
                "#!/bin/sh\necho hi\n"
              ),
              "skills-main/pdf/references/guide.md": new TextEncoder().encode(
                "Read me"
              ),
              "skills-main/pdf/scripts/fill.py": new TextEncoder().encode(
                "print(1)"
              ),
            })
          )
      )
    );

    const { app, databaseAdapter } = createApp();

    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin-preview@org.com"
    );

    const orgId = adminSession.orgId!;

    const response = await app.fetch(
      new Request(`${BASE}/v1/skills/install/preview`, {
        body: JSON.stringify({
          command: "npx skills add anthropics/skills --skill pdf",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);

    const preview = await response.json();

    expect(preview).toMatchObject({
      description: "Work with PDFs.",
      name: "pdf",
    });
    expect(preview.estimatedTokens).toBeGreaterThan(0);
    expect(
      [...preview.files].sort((a, b) => a.path.localeCompare(b.path))
    ).toEqual([
      { executable: true, path: "bin/tool" },
      { executable: false, path: "references/guide.md" },
      { executable: true, path: "scripts/fill.py" },
    ]);
    expect(await databaseAdapter.getSkillByName("pdf", orgId)).toBeNull();
  });
});
