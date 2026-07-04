"use client"
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"

export interface WhiteboardHandle {
  toPNG: () => string
  clear: () => void
  isBlank: () => boolean
}

const W = 1024
const H = 640

export const Whiteboard = forwardRef<WhiteboardHandle>(function Whiteboard(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  useEffect(() => {
    const c = canvasRef.current!
    const ctx = c.getContext("2d")!
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = "#1a1a2e"
    ctx.lineWidth = 4
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
  }, [])

  const pos = (e: PointerEvent | React.PointerEvent) => {
    const c = canvasRef.current!
    const rect = c.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H }
  }

  const start = (e: React.PointerEvent) => {
    drawing.current = true
    const ctx = canvasRef.current!.getContext("2d")!
    const { x, y } = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext("2d")!
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    dirty.current = true
  }
  const end = () => { drawing.current = false }

  useImperativeHandle(ref, () => ({
    toPNG: () => canvasRef.current!.toDataURL("image/png"),
    clear: () => {
      const ctx = canvasRef.current!.getContext("2d")!
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, W, H)
      dirty.current = false
    },
    isBlank: () => !dirty.current,
  }))

  return (
    <div className="canvas-wrap">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
    </div>
  )
})
