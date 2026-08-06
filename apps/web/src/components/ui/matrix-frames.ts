export type Frame = number[][]

function emptyFrame(rows: number, cols: number): Frame {
  return Array.from({ length: rows }, () => Array(cols).fill(0))
}

function setPixel(frame: Frame, row: number, col: number, value: number): void {
  if (row >= 0 && row < frame.length && col >= 0 && col < frame[0].length) {
    frame[row][col] = value
  }
}

function createSnakeFrames(rows: number, cols: number, snakeLength = 5): Frame[] {
  const frames: Frame[] = []
  const path: Array<[number, number]> = []

  let x = 0
  let y = 0
  let dx = 1
  let dy = 0

  const visited = new Set<string>()
  while (path.length < rows * cols) {
    path.push([y, x])
    visited.add(`${y},${x}`)

    const nextX = x + dx
    const nextY = y + dy

    if (
      nextX >= 0 &&
      nextX < cols &&
      nextY >= 0 &&
      nextY < rows &&
      !visited.has(`${nextY},${nextX}`)
    ) {
      x = nextX
      y = nextY
    } else {
      const newDx = -dy
      const newDy = dx
      dx = newDx
      dy = newDy

      const nextX = x + dx
      const nextY = y + dy

      if (
        nextX >= 0 &&
        nextX < cols &&
        nextY >= 0 &&
        nextY < rows &&
        !visited.has(`${nextY},${nextX}`)
      ) {
        x = nextX
        y = nextY
      } else {
        break
      }
    }
  }

  for (let frame = 0; frame < path.length; frame++) {
    const f = emptyFrame(rows, cols)

    for (let i = 0; i < snakeLength; i++) {
      const idx = frame - i
      if (idx >= 0 && idx < path.length) {
        const [y, x] = path[idx]
        const brightness = 1 - i / snakeLength
        setPixel(f, y, x, brightness)
      }
    }

    frames.push(f)
  }

  return frames
}

export const snake3x2: Frame[] = createSnakeFrames(3, 2, 2)

export function vu(columns: number, levels: number[]): Frame {
  const rows = 7
  const frame = emptyFrame(rows, columns)

  for (let col = 0; col < Math.min(columns, levels.length); col++) {
    const level = Math.max(0, Math.min(1, levels[col]))
    const height = Math.floor(level * rows)

    for (let row = 0; row < rows; row++) {
      const rowFromBottom = rows - 1 - row
      if (rowFromBottom < height) {
        let brightness = 1
        if (row < rows * 0.3) {
          brightness = 1
        } else if (row < rows * 0.6) {
          brightness = 0.8
        } else {
          brightness = 0.6
        }
        frame[row][col] = brightness
      }
    }
  }

  return frame
}
