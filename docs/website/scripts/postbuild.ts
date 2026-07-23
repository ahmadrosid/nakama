import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildLlmsTxt } from '../lib/site-meta'

const ROOT = path.dirname(new URL(import.meta.url).pathname)
const CONTENT_DIR = path.join(ROOT, '..', 'content', 'docs')
const PUBLIC_DIR = path.join(ROOT, '..', 'public')
const WEBSITE_DIR = path.join(ROOT, '..')
const MIRRORS_DIR = path.join(WEBSITE_DIR, 'generated', 'mirrors')
const MIRROR_ROUTES_DIR = path.join(WEBSITE_DIR, 'app', '(mirrors)')

const EXTRA_MIRRORS = ['getting-started.md']

function mdxPathToRelativePath(relativeMdxPath: string): string {
  if (relativeMdxPath === 'docs.mdx') return 'docs/index.md'
  const withoutExt = relativeMdxPath.replace(/\.mdx$/, '')
  if (withoutExt.endsWith('/index')) {
    const dir = withoutExt.slice(0, -'/index'.length)
    return dir ? `${dir}/index.md` : 'index.md'
  }
  return `${withoutExt}.md`
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) return content
  const end = content.indexOf('\n---\n', 4)
  if (end === -1) return content
  return content.slice(end + 5)
}

async function walkMdxFiles(dir: string, base = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const relative = base ? `${base}/${entry.name}` : entry.name
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkMdxFiles(full, relative)))
    } else if (entry.name.endsWith('.mdx')) {
      files.push(relative)
    }
  }

  return files.sort()
}

function mirrorContentType(relativePath: string): string {
  return relativePath.endsWith('.md')
    ? 'text/markdown; charset=utf-8'
    : 'text/plain; charset=utf-8'
}

async function writeMirrorRoute(relativePath: string) {
  const routePath = path.join(MIRROR_ROUTES_DIR, relativePath, 'route.ts')
  const contentType = mirrorContentType(relativePath)
  const routeSource = `import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const dynamic = 'force-static'
export const runtime = 'nodejs'

const RELATIVE_PATH = ${JSON.stringify(relativePath)}

export async function GET() {
  const content = await readFile(
    path.join(process.cwd(), 'generated', 'mirrors', RELATIVE_PATH),
    'utf8',
  )
  return new Response(content, {
    headers: {
      'Content-Type': ${JSON.stringify(contentType)},
    },
  })
}
`

  await mkdir(path.dirname(routePath), { recursive: true })
  await writeFile(routePath, routeSource)
}

async function writeMirrorRoutes(relativePaths: string[]) {
  for (const relativePath of relativePaths) {
    await writeMirrorRoute(relativePath)
  }
}

async function cleanGeneratedMirrors() {
  await rm(MIRROR_ROUTES_DIR, { recursive: true, force: true })
  await rm(MIRRORS_DIR, { recursive: true, force: true })

  const entries = await readdir(PUBLIC_DIR, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(PUBLIC_DIR, entry.name)
    if (entry.isDirectory() && entry.name === 'docs') {
      await rm(full, { recursive: true, force: true })
      continue
    }
    if (
      entry.isFile() &&
      (entry.name.endsWith('.md') || entry.name === 'llms.txt')
    ) {
      await rm(full, { force: true })
    }
  }
}

async function main() {
  await cleanGeneratedMirrors()

  const mdxFiles = await walkMdxFiles(CONTENT_DIR)
  const pages = mdxFiles.map(mdxPathToRelativePath)

  for (const mdxFile of mdxFiles) {
    const sourcePath = path.join(CONTENT_DIR, mdxFile)
    const relativePath = mdxPathToRelativePath(mdxFile)
    const outputPath = path.join(MIRRORS_DIR, relativePath)
    const raw = await readFile(sourcePath, 'utf8')
    const markdown = stripFrontmatter(raw)

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, markdown)
  }

  for (const extra of EXTRA_MIRRORS) {
    const sourcePath = path.join(WEBSITE_DIR, extra)
    const outputPath = path.join(MIRRORS_DIR, extra)
    const raw = await readFile(sourcePath, 'utf8')
    const markdown = stripFrontmatter(raw.replace(/^---[\s\S]*?---\n/, ''))
    await writeFile(outputPath, markdown)
    if (!pages.includes(extra)) pages.push(extra)
  }

  await writeFile(path.join(MIRRORS_DIR, 'llms.txt'), buildLlmsTxt(pages))

  const sitemapUrls = [
    '',
    ...pages.map((page) => {
      const clean = page.replace(/index\.md$/, '').replace(/\.md$/, '')
      return clean ? `/${clean}` : '/'
    }),
  ]

  const siteUrl = process.env.NAKAMA_DOCS_SITE_URL ?? 'https://ahmadrosid.github.io/nakama'
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls
  .map(
    (url) => `  <url>
    <loc>${siteUrl}${url === '/' ? '/' : url}</loc>
  </url>`,
  )
  .join('\n')}
</urlset>
`
  await writeFile(path.join(PUBLIC_DIR, 'sitemap.xml'), sitemap)

  await writeMirrorRoutes([...pages, 'llms.txt'])

  console.log(
    `Generated ${pages.length} markdown mirrors, llms.txt, sitemap.xml, and mirror routes`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
