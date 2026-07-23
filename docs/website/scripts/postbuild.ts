import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildLlmsTxt } from '../lib/site-meta'

const ROOT = path.dirname(new URL(import.meta.url).pathname)
const CONTENT_DIR = path.join(ROOT, '..', 'content', 'docs')
const OUT_DIR = path.join(ROOT, '..', 'out')
const WEBSITE_DIR = path.join(ROOT, '..')

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

async function main() {
  const mdxFiles = await walkMdxFiles(CONTENT_DIR)
  const pages = mdxFiles.map(mdxPathToRelativePath)

  for (const mdxFile of mdxFiles) {
    const sourcePath = path.join(CONTENT_DIR, mdxFile)
    const relativePath = mdxPathToRelativePath(mdxFile)
    const outputPath = path.join(OUT_DIR, relativePath)
    const raw = await readFile(sourcePath, 'utf8')
    const markdown = stripFrontmatter(raw)

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, markdown)
  }

  for (const extra of EXTRA_MIRRORS) {
    const sourcePath = path.join(WEBSITE_DIR, extra)
    const outputPath = path.join(OUT_DIR, extra)
    const raw = await readFile(sourcePath, 'utf8')
    const markdown = stripFrontmatter(raw.replace(/^---[\s\S]*?---\n/, ''))
    await writeFile(outputPath, markdown)
    if (!pages.includes(extra)) pages.push(extra)
  }

  await writeFile(path.join(OUT_DIR, 'llms.txt'), buildLlmsTxt(pages))

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
  await writeFile(path.join(OUT_DIR, 'sitemap.xml'), sitemap)

  await writeFile(path.join(OUT_DIR, '.nojekyll'), '')
  console.log(`Postbuild: ${pages.length} markdown mirrors, llms.txt, sitemap.xml`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
