import { createRelativeLink } from 'fumadocs-ui/mdx'
import {
  DocsBody,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  buildJsonLd,
  buildPageMetadata,
  slugToRelativePath,
} from '@/lib/site-meta'
import { source } from '@/lib/source'
import { getMDXComponents } from '@/mdx-components'
import defaultMdxComponents from 'fumadocs-ui/mdx'

interface PageProps {
  params: Promise<{ slug: string[] }>
}

export default async function Page(props: PageProps) {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  const MDX = page.data.body
  const relativePath = slugToRelativePath(page.slugs)
  const jsonLd = buildJsonLd(
    relativePath,
    buildPageMetadata(relativePath, page.data.title).title ?? page.data.title,
    page.data.description ?? '',
  )

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <DocsPage toc={page.data.toc} full={page.data.full}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsBody>
          <MDX
            components={getMDXComponents({
              ...defaultMdxComponents,
              a: createRelativeLink(source, page),
            })}
          />
        </DocsBody>
      </DocsPage>
    </>
  )
}

export async function generateStaticParams() {
  return source.generateParams()
}

export const dynamicParams = false

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  const relativePath = slugToRelativePath(page.slugs)
  return buildPageMetadata(relativePath, page.data.title)
}
