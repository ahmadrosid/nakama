import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface ContentPage {
  description: string;
  markdown: string;
  mdxPath: string;
  relativePath: string;
  title: string;
}

function mdxPathToRelativePath(relativeMdxPath: string): string {
  if (relativeMdxPath === "docs.mdx") {
    return "docs/index.md";
  }
  const withoutExtension = relativeMdxPath.replace(/\.mdx$/, "");
  if (withoutExtension.endsWith("/index")) {
    const directory = withoutExtension.slice(0, -"/index".length);
    return directory ? `${directory}/index.md` : "index.md";
  }
  return `${withoutExtension}.md`;
}

function frontmatterValue(frontmatter: string, key: string): string {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!match) {
    throw new Error(`Missing ${key} in MDX frontmatter`);
  }
  const value = match[1].trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value) as string;
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function parseMdxPage(
  source: string,
  mdxPath: string
): ContentPage {
  if (!source.startsWith("---\n")) {
    throw new Error(`Missing frontmatter in ${mdxPath}`);
  }
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error(`Unclosed frontmatter in ${mdxPath}`);
  }
  const frontmatter = source.slice(4, end);
  return {
    description: frontmatterValue(frontmatter, "description"),
    markdown: source.slice(end + 5),
    mdxPath,
    relativePath: mdxPathToRelativePath(mdxPath),
    title: frontmatterValue(frontmatter, "title"),
  };
}

async function walkMdxFiles(dir: string, base = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMdxFiles(fullPath, relative)));
    } else if (entry.name.endsWith(".mdx")) {
      files.push(relative);
    }
  }
  return files.sort();
}

export async function readContentPages(
  contentDirectory: string
): Promise<ContentPage[]> {
  const mdxFiles = await walkMdxFiles(contentDirectory);
  return Promise.all(
    mdxFiles.map(async (mdxPath) =>
      parseMdxPage(
        await readFile(path.join(contentDirectory, mdxPath), "utf8"),
        mdxPath
      )
    )
  );
}
