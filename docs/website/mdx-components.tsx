import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import type { ComponentProps } from 'react'
import { withBasePath } from '@/lib/base-path'

function BasePathImage(props: ComponentProps<'img'>) {
  const src =
    typeof props.src === 'string' && props.src.startsWith('/')
      ? withBasePath(props.src)
      : props.src
  const Image = defaultMdxComponents.img ?? 'img'
  return <Image {...props} src={src} />
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    img: BasePathImage,
    ...components,
  }
}
