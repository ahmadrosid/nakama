'use client'

import { useEffect, useState, type RefObject } from 'react'

export function useIsVisible(
  ref: RefObject<Element | null>,
  rootMargin = '0px',
): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry?.isIntersecting ?? false)
      },
      { rootMargin },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, rootMargin])

  return visible
}
