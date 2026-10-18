import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import {
  getUserConfigPath,
  loadUserConfig,
  type ProviderInstance,
  saveUserConfig,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { AuthService } from "./auth-service";
import { OrgService } from "./org-service";

describe("provider model publication removal", () => {
  setupTestConfigDir("nakama-provider-publication-removal-");
  const keptModel = { id: "gpt-4o-mini", name: "Kept" };
  const removedModel = { id: "retired-custom", name: "Removed" };

  async function setup(customModels?: ProviderInstance["customModels"]) {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    const config = {
      defaultProviderId: "provider-one",
      providers: ["provider-one", "provider-one-extra", "provider-two"].map(
        (id) => ({
          apiKey: "private-provider-key",
          createdAt: now,
          id,
          label: id,
          ...(customModels
            ? {
                baseUrl: "https://provider.example.invalid/v1",
                customModels,
                type: "openai_compatible" as const,
              }
            : { type: "openai" as const }),
        })
      ),
    };

    await saveUserConfig(config);
    await db.createUser({
      createdAt: now,
      email: "provider-admin@example.com",
      id: "admin",
      passwordHash: "test",
      updatedAt: now,
    });

    for (const id of ["root", "archived", "other"]) {
      await db.upsertOrganization({
        archivedAt: null,
        createdAt: now,
        id,
        name: id,
        slug: id,
        updatedAt: now,
      });
      await db.upsertOrgMember({
        createdAt: now,
        orgId: id,
        role: "admin",
        userId: "admin",
      });

      for (const [kind, resourceId] of [
        ["model", "provider-one::gpt-4o-mini"],
        ["model", "provider-two::gpt-4o-mini"],
        ["model", "provider-one-extra::gpt-4o-mini"],
        ["knowledge", "provider-one::gpt-4o-mini"],
      ] as const) {
        await db.publishOrgSharedResource({
          createdAt: now,
          id: `${id}_${kind}_${resourceId}`,
          orgId: id,
          resourceId,
          resourceKind: kind,
          updatedAt: now,
        });
      }

      if (customModels) {
        for (const providerId of ["provider-one", "provider-two"]) {
          await db.publishOrgSharedResource({
            createdAt: now,
            id: `${id}_${providerId}_removed`,
            orgId: id,
            resourceId: `${providerId}::${removedModel.id}`,
            resourceKind: "model",
            updatedAt: now,
          });
        }
      }

      if (id === "archived") {
        await db.upsertOrganization({
          archivedAt: now,
          createdAt: now,
          id,
          name: id,
          slug: id,
          updatedAt: now,
        });
      }
    }

    return {
      config,
      db,
      orgService: new OrgService(db, new AuthService()),
      service: new AgentService(config, null, db),
    };
  }

  test("deletion revokes every organization reference but preserves other providers and resource kinds", async () => {
    const { db, service } = await setup();
    expect(await service.deleteProvider("provider-one")).toEqual({
      defaultProviderId: "provider-one-extra",
    });

    for (const id of ["root", "archived", "other"]) {
      const publications = await db.listOrgSharedResources(id);
      expect(publications).toHaveLength(3);
      expect(
        publications.some(
          (entry) =>
            entry.resourceKind === "model" &&
            entry.resourceId === "provider-one::gpt-4o-mini"
        )
      ).toBe(false);
      expect(
        publications.some(
          (entry) =>
            entry.resourceKind === "knowledge" &&
            entry.resourceId === "provider-one::gpt-4o-mini"
        )
      ).toBe(true);
    }

    expect(
      (await loadUserConfig())?.providers.map((entry) => entry.id)
    ).toEqual(["provider-one-extra", "provider-two"]);
    expect(
      (await service.getModels()).providers.map((entry) => entry.id)
    ).toEqual(["provider-one-extra", "provider-two"]);
    await service.deleteProvider("provider-one-extra");
    expect(await service.deleteProvider("provider-two")).toEqual({
      defaultProviderId: null,
    });
    expect((await loadUserConfig())?.providers).toEqual([]);
    expect((await service.listProviders()).providers).toEqual([]);
  });

  test("a deletion retry revokes references after a database failure", async () => {
    const { db, service } = await setup();

    const failure = spyOn(db, "deleteOrgSharedResource").mockRejectedValueOnce(
      new Error("database unavailable")
    );

    try {
      await expect(service.deleteProvider("provider-one")).rejects.toThrow();
      expect(
        (await loadUserConfig())?.providers.some(
          (entry) => entry.id === "provider-one"
        )
      ).toBe(false);
      expect(
        (await service.listProviders()).providers.some(
          (entry) => entry.id === "provider-one"
        )
      ).toBe(false);
    } finally {
      failure.mockRestore();
    }

    await expect(service.deleteProvider("provider-one")).rejects.toThrow();

    for (const org of await db.listOrganizations()) {
      expect(
        (await db.listOrgSharedResources(org.id)).filter(
          (entry) =>
            entry.resourceKind === "model" &&
            entry.resourceId.startsWith("provider-one::")
        )
      ).toEqual([]);
    }
  });

  test("a failed configuration write preserves cached providers and publications", async () => {
    const { config, db, service } = await setup();
    const before = await db.listOrgSharedResources("root");
    const configPath = getUserConfigPath();
    await rm(configPath);
    await mkdir(configPath);

    try {
      await expect(service.deleteProvider("provider-one")).rejects.toThrow();
      expect(
        (await service.listProviders()).providers.map((entry) => entry.id)
      ).toEqual(config.providers.map((entry) => entry.id));
      expect(await db.listOrgSharedResources("root")).toEqual(before);
    } finally {
      await rm(configPath, { recursive: true });
      await saveUserConfig(config);
    }

    await expect(service.deleteProvider("provider-one")).resolves.toMatchObject(
      { defaultProviderId: "provider-one-extra" }
    );
  });

  test("provider deletion waits for publication insertion and then revokes it", async () => {
    const { db, orgService, service } = await setup();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const publish = db.publishOrgSharedResource.bind(db);

    const pending = spyOn(db, "publishOrgSharedResource").mockImplementation(
      async (record) => {
        entered.resolve();
        await release.promise;

        return publish(record);
      }
    );

    const publishing = orgService.publishSharedResource(
      "root",
      { resourceId: "provider-one::gpt-4o-mini", resourceKind: "model" },
      "admin"
    );

    await entered.promise;
    const deleting = service.deleteProvider("provider-one");

    try {
      expect(
        await Promise.race([
          deleting.then(() => true),
          Bun.sleep(20).then(() => false),
        ])
      ).toBe(false);
    } finally {
      release.resolve();
      await Promise.allSettled([publishing, deleting]);
      pending.mockRestore();
    }

    await expect(publishing).resolves.toMatchObject({
      resourceId: "provider-one::gpt-4o-mini",
    });
    await expect(deleting).resolves.toMatchObject({
      defaultProviderId: "provider-one-extra",
    });
    expect(
      (await db.listOrgSharedResources("root")).filter(
        (entry) =>
          entry.resourceKind === "model" &&
          entry.resourceId.startsWith("provider-one::")
      )
    ).toEqual([]);
  });

  test("provider updates remove only invalid model references and never republish restored models", async () => {
    const { db, service } = await setup([keptModel, removedModel]);

    const before = new Map(
      await Promise.all(
        (await db.listOrganizations()).map(
          async (org) =>
            [org.id, await db.listOrgSharedResources(org.id)] as const
        )
      )
    );

    await service.updateProvider("provider-one", { label: "Updated provider" });

    for (const [id, publications] of before) {
      expect(await db.listOrgSharedResources(id)).toEqual(publications);
    }

    const updated = await service.updateProvider("provider-one", {
      customModels: [keptModel],
    });

    expect(updated.provider).toMatchObject({
      id: "provider-one",
      label: "Updated provider",
      modelCount: 1,
    });
    expect(JSON.stringify(updated)).not.toContain("private-provider-key");

    for (const [id, publications] of before) {
      expect(await db.listOrgSharedResources(id)).toEqual(
        publications.filter(
          (entry) => entry.resourceId !== `provider-one::${removedModel.id}`
        )
      );
    }

    await service.updateProvider("provider-one", {
      customModels: [keptModel, removedModel],
    });
    expect(
      (await service.getModels()).models.some(
        (model) => model.id === removedModel.id
      )
    ).toBe(true);
    expect(
      (await db.listOrgSharedResources("root")).some(
        (entry) => entry.resourceId === `provider-one::${removedModel.id}`
      )
    ).toBe(false);
  });

  test("provider shortlist updates preserve other global provider access and publications", async () => {
    const { config, db } = await setup();

    const instance: ProviderInstance = {
      ...config.providers[0]!,
      customModels: [keptModel, removedModel],
    };

    const configured = {
      ...config,
      providers: [instance, ...config.providers.slice(1)],
    };

    await saveUserConfig(configured);
    const service = new AgentService(configured, null, db);
    const before = await db.listOrgSharedResources("root");
    await service.updateProvider("provider-one", {
      customModels: [removedModel],
    });
    expect(await db.listOrgSharedResources("root")).toEqual(
      before.filter(
        (entry) =>
          !(
            entry.resourceKind === "model" &&
            entry.resourceId === "provider-one::gpt-4o-mini"
          )
      )
    );
    expect(
      (await service.getModels()).models.some(
        (model) => model.id === keptModel.id
      )
    ).toBe(true);
    expect((await loadUserConfig())?.providers[0]?.customModels).toEqual([
      removedModel,
    ]);
  });

  test("invalid provider updates and failed file writes retain valid publication records", async () => {
    const { config, db, service } = await setup([keptModel, removedModel]);
    const before = await db.listOrgSharedResources("root");
    await expect(
      service.updateProvider("provider-one", { customModels: [] })
    ).rejects.toThrow();
    expect(await db.listOrgSharedResources("root")).toEqual(before);
    expect((await loadUserConfig())?.providers[0]?.customModels).toEqual([
      keptModel,
      removedModel,
    ]);
    const configPath = getUserConfigPath();
    await rm(configPath);
    await mkdir(configPath);

    try {
      await expect(
        service.updateProvider("provider-one", { customModels: [keptModel] })
      ).rejects.toThrow();
      expect((await service.listProviders()).providers[0]?.modelCount).toBe(2);
      expect(await db.listOrgSharedResources("root")).toEqual(before);
    } finally {
      await rm(configPath, { recursive: true });
      await saveUserConfig(config);
    }
  });

  test("an update retry removes stale references before restoring the model", async () => {
    const { db, service } = await setup([keptModel, removedModel]);

    const failure = spyOn(db, "deleteOrgSharedResource").mockRejectedValueOnce(
      new Error("database unavailable")
    );

    try {
      await expect(
        service.updateProvider("provider-one", { customModels: [keptModel] })
      ).rejects.toThrow();
      expect((await loadUserConfig())?.providers[0]?.customModels).toEqual([
        keptModel,
      ]);
      expect(
        (await db.listOrgSharedResources("root")).some(
          (entry) => entry.resourceId === `provider-one::${removedModel.id}`
        )
      ).toBe(true);
    } finally {
      failure.mockRestore();
    }

    await service.updateProvider("provider-one", {
      customModels: [keptModel, removedModel],
    });

    for (const org of await db.listOrganizations()) {
      expect(
        (await db.listOrgSharedResources(org.id)).some(
          (entry) => entry.resourceId === `provider-one::${removedModel.id}`
        )
      ).toBe(false);
    }
  });

  test("a pending provider update blocks publication of a removed model", async () => {
    const { db, orgService, service } = await setup([keptModel, removedModel]);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const remove = db.deleteOrgSharedResource.bind(db);

    const pending = spyOn(db, "deleteOrgSharedResource").mockImplementation(
      async (orgId, id) => {
        entered.resolve();
        await release.promise;

        return remove(orgId, id);
      }
    );

    const updating = service.updateProvider("provider-one", {
      customModels: [keptModel],
    });

    await entered.promise;
    let publicationFinished = false;

    const publishing = orgService.publishSharedResource(
      "root",
      { resourceId: `provider-one::${removedModel.id}`, resourceKind: "model" },
      "admin"
    );

    const observed = publishing.then(
      () => {
        publicationFinished = true;
      },
      () => {
        publicationFinished = true;
      }
    );

    try {
      await Bun.sleep(20);
      expect(publicationFinished).toBe(false);
    } finally {
      release.resolve();
      await Promise.allSettled([updating, observed]);
      pending.mockRestore();
    }

    await expect(updating).resolves.toMatchObject({
      provider: { id: "provider-one", modelCount: 1 },
    });
    await expect(publishing).rejects.toMatchObject({ status: 400 });
    expect(
      (await db.listOrgSharedResources("root")).some(
        (entry) => entry.resourceId === `provider-one::${removedModel.id}`
      )
    ).toBe(false);
  });
});
