import * as React from "react"
import { useEffect, useId, useMemo, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import { type Frame, vu } from "@/components/ui/matrix-frames"

type MatrixMode = "default" | "vu"

interface CellPosition {
  x: number
  y: number
}

interface MatrixProps extends React.HTMLAttributes<HTMLDivElement> {
  rows: number
  cols: number
  pattern?: Frame
  frames?: Frame[]
  fps?: number
  autoplay?: boolean
  loop?: boolean
  size?: number
  gap?: number
  palette?: {
    on: string
    off: string
  }
  brightness?: number
  ariaLabel?: string
  onFrame?: (index: number) => void
  mode?: MatrixMode
  levels?: number[]
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function ensureFrameSize(frame: Frame, rows: number, cols: number): Frame {
  const result: Frame = []
  for (let r = 0; r < rows; r++) {
    const row = frame[r] || []
    result.push([])
    for (let c = 0; c < cols; c++) {
      result[r][c] = row[c] ?? 0
    }
  }
  return result
}

function useAnimation(
  frames: Frame[] | undefined,
  options: {
    fps: number
    autoplay: boolean
    loop: boolean
    onFrame?: (index: number) => void
  }
): { frameIndex: number } {
  const [frameIndex, setFrameIndex] = useState(0)
  const isPlayingRef = useRef(options.autoplay)
  const frameIndexRef = useRef(0)
  const frameIdRef = useRef<number | undefined>(undefined)
  const lastTimeRef = useRef<number>(0)
  const accumulatorRef = useRef<number>(0)
  const onFrameRef = useRef(options.onFrame)

  useEffect(() => {
    onFrameRef.current = options.onFrame
  }, [options.onFrame])

  useEffect(() => {
    if (!frames || frames.length === 0 || !isPlayingRef.current) {
      return
    }

    const frameInterval = 1000 / options.fps

    const animate = (currentTime: number) => {
      if (!isPlayingRef.current) {
        return
      }

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = currentTime
      }

      const deltaTime = currentTime - lastTimeRef.current
      lastTimeRef.current = currentTime
      accumulatorRef.current += deltaTime

      if (accumulatorRef.current >= frameInterval) {
        accumulatorRef.current -= frameInterval

        const prev = frameIndexRef.current
        const next = prev + 1

        if (next >= frames.length) {
          if (options.loop) {
            frameIndexRef.current = 0
            setFrameIndex(0)
            onFrameRef.current?.(0)
          } else {
            isPlayingRef.current = false
          }
        } else {
          frameIndexRef.current = next
          setFrameIndex(next)
          onFrameRef.current?.(next)
        }
      }

      if (isPlayingRef.current) {
        frameIdRef.current = requestAnimationFrame(animate)
      }
    }

    frameIdRef.current = requestAnimationFrame(animate)

    return () => {
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current)
      }
    }
  }, [frames, options.fps, options.loop, options.autoplay])

  return { frameIndex }
}

export const Matrix = React.forwardRef<HTMLDivElement, MatrixProps>(
  (
    {
      rows,
      cols,
      pattern,
      frames,
      fps = 12,
      autoplay = true,
      loop = true,
      size = 10,
      gap = 2,
      palette = {
        on: "currentColor",
        off: "var(--muted-foreground)",
      },
      brightness = 1,
      ariaLabel,
      onFrame,
      mode = "default",
      levels,
      className,
      ...props
    },
    ref
  ) => {
    const shouldAnimate = Boolean(!pattern && frames && frames.length > 0)
    const animationKey = shouldAnimate
      ? `${autoplay}-${frames?.length ?? 0}-${rows}x${cols}`
      : "static"

    return (
      <MatrixDisplay
        key={animationKey}
        ref={ref}
        rows={rows}
        cols={cols}
        pattern={pattern}
        frames={frames}
        fps={fps}
        autoplay={autoplay}
        loop={loop}
        size={size}
        gap={gap}
        palette={palette}
        brightness={brightness}
        ariaLabel={ariaLabel}
        onFrame={onFrame}
        mode={mode}
        levels={levels}
        className={className}
        shouldAnimate={shouldAnimate}
        {...props}
      />
    )
  }
)

Matrix.displayName = "Matrix"

interface MatrixDisplayProps extends MatrixProps {
  shouldAnimate: boolean
}

const MatrixDisplay = React.forwardRef<HTMLDivElement, MatrixDisplayProps>(
  (
    {
      rows,
      cols,
      pattern,
      frames,
      fps = 12,
      autoplay = true,
      loop = true,
      size = 10,
      gap = 2,
      palette = {
        on: "currentColor",
        off: "var(--muted-foreground)",
      },
      brightness = 1,
      ariaLabel,
      onFrame,
      mode = "default",
      levels,
      className,
      shouldAnimate,
      ...props
    },
    ref
  ) => {
    const { frameIndex } = useAnimation(shouldAnimate ? frames : undefined, {
      fps,
      autoplay: autoplay && !pattern,
      loop,
      onFrame,
    })

    const currentFrame = useMemo(() => {
      if (mode === "vu" && levels && levels.length > 0) {
        return ensureFrameSize(vu(cols, levels), rows, cols)
      }

      if (pattern) {
        return ensureFrameSize(pattern, rows, cols)
      }

      if (frames && frames.length > 0) {
        return ensureFrameSize(frames[frameIndex] || frames[0], rows, cols)
      }

      return ensureFrameSize([], rows, cols)
    }, [pattern, frames, frameIndex, rows, cols, mode, levels])

    const cellPositions = useMemo(() => {
      const positions: CellPosition[][] = []

      for (let row = 0; row < rows; row++) {
        positions[row] = []
        for (let col = 0; col < cols; col++) {
          positions[row][col] = {
            x: col * (size + gap),
            y: row * (size + gap),
          }
        }
      }

      return positions
    }, [rows, cols, size, gap])

    const svgWidth = cols * (size + gap) - gap
    const svgHeight = rows * (size + gap) - gap

    const isAnimating = !pattern && frames && frames.length > 0
    const instanceId = useId().replace(/:/g, "")
    const onGradientId = `matrix-pixel-on-${instanceId}`
    const offGradientId = `matrix-pixel-off-${instanceId}`

    return (
      <div
        ref={ref}
        role="img"
        aria-label={ariaLabel ?? "matrix display"}
        aria-live={isAnimating ? "polite" : undefined}
        className={cn("relative inline-block", className)}
        style={
          {
            "--matrix-on": palette.on,
            "--matrix-off": palette.off,
            "--matrix-gap": `${gap}px`,
            "--matrix-size": `${size}px`,
          } as React.CSSProperties
        }
        {...props}
      >
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          xmlns="http://www.w3.org/2000/svg"
          className="block"
          style={{ overflow: "visible" }}
        >
          <defs>
            <radialGradient id={onGradientId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--matrix-on)" stopOpacity="1" />
              <stop
                offset="70%"
                stopColor="var(--matrix-on)"
                stopOpacity="0.85"
              />
              <stop
                offset="100%"
                stopColor="var(--matrix-on)"
                stopOpacity="0.6"
              />
            </radialGradient>

            <radialGradient id={offGradientId} cx="50%" cy="50%" r="50%">
              <stop
                offset="0%"
                stopColor="var(--matrix-off)"
                stopOpacity="1"
              />
              <stop
                offset="100%"
                stopColor="var(--matrix-off)"
                stopOpacity="0.7"
              />
            </radialGradient>
          </defs>

          <style>
            {`
              .matrix-pixel-${instanceId} {
                transition: opacity 300ms ease-out;
              }
            `}
          </style>

          {currentFrame.map((row, rowIndex) =>
            row.map((value, colIndex) => {
              const pos = cellPositions[rowIndex]?.[colIndex]
              if (!pos) return null

              const opacity = clamp(brightness * value)
              const isOn = opacity > 0.05
              const fill = isOn
                ? `url(#${onGradientId})`
                : `url(#${offGradientId})`

              const radius = (size / 2) * 0.9

              return (
                <circle
                  key={`${rowIndex}-${colIndex}`}
                  className={cn(
                    `matrix-pixel-${instanceId}`,
                    !isOn && "opacity-20 dark:opacity-[0.1]"
                  )}
                  cx={pos.x + size / 2}
                  cy={pos.y + size / 2}
                  r={radius}
                  fill={fill}
                  opacity={isOn ? opacity : 0.1}
                />
              )
            })
          )}
        </svg>
      </div>
    )
  }
)

MatrixDisplay.displayName = "MatrixDisplay"
