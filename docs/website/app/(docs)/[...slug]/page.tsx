import {
  DocsBody,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents, { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { withBasePath } from "@/lib/base-path";
import {
  buildJsonLd,
  buildPageMetadata,
  serializeJsonForHtml,
  slugToRelativePath,
} from "@/lib/site-meta";
import { source } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";

interface PageProps {
  params: Promise<{ slug: string[] }>;
}

export default async function Page(props: PageProps) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) {
    notFound();
  }

  const MDX = page.data.body;
  const relativePath = slugToRelativePath(page.slugs);
  const markdownUrl = withBasePath(`/${relativePath}`);
  const jsonLd = buildJsonLd(
    relativePath,
    buildPageMetadata(relativePath, page.data.title).title ?? page.data.title,
    page.data.description ?? ""
  );

  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: serializeJsonForHtml(jsonLd) }}
        type="application/ld+json"
      />
      <DocsPage full={page.data.full} toc={page.data.toc}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <div className="flex items-center gap-2 border-b pt-2 pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover
            githubUrl={`https://github.com/ahmadrosid/nakama/blob/main/docs/website/content/docs/${page.path}`}
            markdownUrl={markdownUrl}
          />
        </div>
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
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export const dynamicParams = false;

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) {
    notFound();
  }

  const relativePath = slugToRelativePath(page.slugs);
  return buildPageMetadata(relativePath, page.data.title);
}
