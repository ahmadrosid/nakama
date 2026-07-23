import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import type { ComponentProps, ElementType } from 'react'
import { withBasePath, hrefWithBasePath } from '@/lib/base-path'

function BasePathImage(props: ComponentProps<'img'>) {
  const src =
    typeof props.src === 'string' && props.src.startsWith('/')
      ? withBasePath(props.src)
      : props.src
  const Image = (defaultMdxComponents.img ?? 'img') as ElementType
  return <Image {...props} src={src} />
}

function createBasePathAnchor(DocLink?: MDXComponents['a']) {
  return function BasePathLink(props: ComponentProps<'a'>) {
    // Fumadocs/Next Link already applies `basePath` from next.config.mjs.
    const href = DocLink ? props.href : hrefWithBasePath(props.href)
    if (DocLink) {
      const Link = DocLink as ElementType
      return <Link {...props} href={href} />
    }
    const Anchor = (defaultMdxComponents.a ?? 'a') as ElementType
    return <Anchor {...props} href={href} />
  }
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    img: BasePathImage,
    ...components,
    a: createBasePathAnchor(components?.a),
  }
}
