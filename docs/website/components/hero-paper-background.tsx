'use client'

import { useEffect, useRef, useState } from 'react'
import { Dithering, GrainGradient } from '@paper-design/shaders-react'
import { useTheme } from 'fumadocs-ui/provider/base'
import { useIsVisible } from '@/lib/use-is-visible'

export function HeroPaperBackground() {
  const { resolvedTheme } = useTheme()
  const ref = useRef<HTMLDivElement | null>(null)
  const visible = useIsVisible(ref)
  const [showShaders, setShowShaders] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowShaders(true)
    }, 400)

    return () => window.clearTimeout(timer)
  }, [])

  const isDark = resolvedTheme === 'dark'

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {showShaders && (
        <GrainGradient
          className="absolute inset-0 animate-fd-fade-in duration-[800ms]"
          style={{ width: '100%', height: '100%' }}
          colors={
            isDark
              ? ['#39BE1C', '#9c2f05', '#7A2A0000']
              : ['#fcfc51', '#ffa057', '#7A2A0020']
          }
          colorBack="#00000000"
          softness={1}
          intensity={0.9}
          noise={0.5}
          speed={visible ? 1 : 0}
          shape="corners"
          fit="cover"
          minPixelRatio={1}
          maxPixelCount={1920 * 1080}
        />
      )}
      {showShaders && (
        <Dithering
          width={720}
          height={720}
          colorBack="#00000000"
          colorFront={isDark ? '#DF3F00' : '#fa8023'}
          shape="sphere"
          type="4x4"
          scale={0.5}
          size={3}
          speed={0}
          frame={5000 * 120}
          className="absolute animate-fd-fade-in duration-[400ms] max-lg:bottom-[-50%] max-lg:left-[-200px] lg:top-[-5%] lg:right-0"
          minPixelRatio={1}
        />
      )}
    </div>
  )
}
