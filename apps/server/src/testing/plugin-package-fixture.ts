import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type {
  InstallPluginPackageRequest,
  PluginPackageRequest,
} from "@nakama/core/contract";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { Header } from "tar";

export function pluginTarball(
  entries: Array<{
    name: string;
    data?: Uint8Array;
    type?: "File" | "SymbolicLink" | "Link";
  }>
): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? []);
    const header = Buffer.alloc(512);
    new Header({
      linkpath: entry.type ? "../../outside" : undefined,
      mode: 0o644,
      path: entry.name,
      size: data.length,
      type: entry.type ?? "File",
    }).encode(header);
    chunks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

const packages = new Map<
  string,
  { source: PluginPackageRequest; archive: Buffer; integrity: string }
>();
const registry = setupServer(
  http.get(/^https:\/\/registry\.npmjs\.org(?::80)?\//, ({ request }) => {
    const path = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const fixture = packages.get(path.replace(/\/fixture\.tgz$/, ""));
    if (!fixture) {
      return new HttpResponse(null, { status: 404 });
    }
    if (path.endsWith("/fixture.tgz")) {
      return new HttpResponse(new Uint8Array(fixture.archive));
    }
    const { packageName: name, version } = fixture.source;
    return HttpResponse.json({
      "dist-tags": { latest: version },
      name,
      versions: {
        [version]: {
          dist: {
            integrity: fixture.integrity,
            tarball: `https://registry.npmjs.org/${name}/fixture.tgz`,
          },
          name,
          version,
        },
      },
    });
  })
);
registry.listen({ onUnhandledRequest: "bypass" });

export function pluginPackage(
  files: Record<string, string | Uint8Array>,
  options: {
    archive?: Buffer;
    packageJson?: Record<string, unknown>;
    integrity?: string;
  } = {}
): PluginPackageRequest {
  const hash = createHash("sha256");
  for (const [name, data] of Object.entries(files)) {
    hash.update(name).update(data);
  }
  if (options.archive) {
    hash.update(options.archive);
  }
  hash.update(JSON.stringify(options.packageJson ?? {}));
  hash.update(options.integrity ?? "");
  const packageName = `@nakama-test/fixture-${hash.digest("hex").slice(0, 24)}`;
  let version = "1.0.0";
  try {
    version =
      JSON.parse(Buffer.from(files["nakama.plugin.json"] ?? "{}").toString())
        .version ?? version;
  } catch {
    /* Invalid manifest fixtures still need registry metadata. */
  }
  const source = { packageName, version };
  const archive =
    options.archive ??
    pluginTarball(
      Object.entries({
        "package.json": JSON.stringify({
          name: packageName,
          version,
          ...options.packageJson,
        }),
        ...files,
      }).map(([name, data]) => ({
        data: Buffer.from(data),
        name: `package/${name}`,
      }))
    );
  const integrity =
    options.integrity ??
    `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  packages.set(packageName, { archive, integrity, source });
  return source;
}

export function approvedPluginPackage(
  source: PluginPackageRequest
): InstallPluginPackageRequest {
  const fixture = packages.get(source.packageName);
  if (!fixture) {
    throw new Error("Unknown fixture");
  }
  return {
    ...source,
    expectedDigest: createHash("sha256").update(fixture.archive).digest("hex"),
    expectedIntegrity: fixture.integrity,
  };
}
