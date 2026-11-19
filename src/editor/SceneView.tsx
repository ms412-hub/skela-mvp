// Scene 화면: 캐릭터 파츠를 그리고, 선택·이동·회전·크기·피벗 조작과 카메라(확대/이동)를 처리한다.
//
// 카메라: 마우스 휠 = 커서 기준 확대/축소, 빈 곳 드래그·가운데/오른쪽 버튼 드래그 = 화면 이동.
// 월드 좌표 = 원본 이미지 픽셀 좌표 (오른쪽 +x, 아래 +y). 화면 = (월드 − 카메라 중심) × 배율 + 캔버스 중앙.
// 기즈모는 화면 크기(px)로 그려서 확대해도 같은 크기로 보인다.
import { useEffect, useRef } from 'react'
import type { Character, EditorState } from '../character/CharacterModel'
import { drawOrder, hitTest, moveByWorld, pivotWorld, setPivotKeepPlace, updatePart, worldCorners, worldMatrices, isDescendant } from '../character/CharacterModel'
import { apply, applyLinear, invert } from '../character/Transform'
import type { Mat, Vec2 } from '../character/Transform'

export type Tool = 'move' | 'rotate' | 'scale' | 'pivot'
export type SceneApi = { frameAll: () => void; frameSelection: () => void }

type Props = {
  char: Character
  state: EditorState // 화면에 보이는 상태 (타임라인 미리보기 포함)
  selection: string[]
  tool: Tool
  showJoints: boolean
  onSelect: (ids: string[]) => void
  beginEdit: () => EditorState // 편집 시작: 편집할 기준 상태를 받는다 (미리보기를 확정)
  onLive: (s: EditorState) => void // 드래그 중
  onCommit: (s: EditorState) => void // 드래그 끝 (되돌리기 한 단계)
  apiRef: { current: SceneApi | null }
}

const GIZMO = 80 // 기즈모 길이(px)
const COL = { x: '#ff4d5e', y: '#4dd67a', free: '#ffd23f', sel: '#4cc3ff', pivot: '#ff9f1c' }

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'move'; axis: 'x' | 'y' | 'free'; sx: number; sy: number; base: EditorState; ids: string[]; moved: boolean }
  | { kind: 'rotate'; start: number; base: EditorState; ids: string[]; P: Vec2; moved: boolean }
  | { kind: 'scale'; axis: 'x' | 'y' | 'uni'; sx: number; sy: number; base: EditorState; id: string; P: Vec2; dir: Vec2; moved: boolean }
  | { kind: 'pivot'; base: EditorState; id: string; moved: boolean }

export default function SceneView(p: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const cam = useRef({ x: p.char.w / 2, y: p.char.h / 2, zoom: 0.5 })
  const props = useRef(p)
  props.current = p
  const drag = useRef<Drag | null>(null)
  const size = useRef({ w: 1, h: 1, dpr: 1 })
  const fitted = useRef(false)

  const toScreen = (q: Vec2): Vec2 => ({ x: (q.x - cam.current.x) * cam.current.zoom + size.current.w / 2, y: (q.y - cam.current.y) * cam.current.zoom + size.current.h / 2 })
  const toWorld = (q: Vec2): Vec2 => ({ x: (q.x - size.current.w / 2) / cam.current.zoom + cam.current.x, y: (q.y - size.current.h / 2) / cam.current.zoom + cam.current.y })

  // 선택된 것 중 조상이 함께 선택되지 않은 것만 (부모와 자식을 같이 움직이면 두 번 움직이므로)
  const roots = (s: EditorState, ids: string[]) => ids.filter((id) => s.parts[id] && !ids.some((o) => o !== id && isDescendant(s, id, o)))

  function frameBox(x0: number, y0: number, x1: number, y1: number) {
    const m = 40
    const z = Math.min((size.current.w - 2 * m) / Math.max(1, x1 - x0), (size.current.h - 2 * m) / Math.max(1, y1 - y0))
    cam.current = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: Math.max(0.05, Math.min(8, z)) }
    draw()
  }
  const frameAll = () => frameBox(0, 0, props.current.char.w, props.current.char.h)
  const frameSelection = () => {
    const { char, state, selection } = props.current
    if (!selection.length) return frameAll()
    const W = worldMatrices(state)
    const pts = selection.filter((id) => state.parts[id]).flatMap((id) => worldCorners(char, state, id, W))
    if (!pts.length) return
    frameBox(Math.min(...pts.map((q) => q.x)), Math.min(...pts.map((q) => q.y)), Math.max(...pts.map((q) => q.x)), Math.max(...pts.map((q) => q.y)))
  }
  p.apiRef.current = { frameAll, frameSelection }

  // 기즈모 정보 (주 선택 = 마지막으로 선택한 파츠)
  function gizmo(s: EditorState, W: Record<string, Mat>) {
    const id = props.current.selection[props.current.selection.length - 1]
    if (!id || !s.parts[id]) return null
    const P = toScreen(pivotWorld(s, id, W))
    const norm = (v: Vec2) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l } }
    const ax = norm(applyLinear(W[id], { x: 1, y: 0 }))
    const ay = norm(applyLinear(W[id], { x: 0, y: 1 }))
    return { id, P, ax, ay }
  }

  function draw() {
    const c = cv.current
    if (!c) return
    const { char, state, selection, tool, showJoints } = props.current
    const { w, h, dpr } = size.current
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#25272f'
    ctx.fillRect(0, 0, w, h)
    const z = cam.current.zoom
    const view: Mat = [z, 0, 0, z, w / 2 - cam.current.x * z, h / 2 - cam.current.y * z]
    // 캐릭터 캔버스 영역 (원본 이미지 크기)
    ctx.setTransform(dpr * view[0], 0, 0, dpr * view[3], dpr * view[4], dpr * view[5])
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, char.w, char.h)
    const W = worldMatrices(state)
    for (const id of drawOrder(char, state)) {
      const d = char.defs[id], ps = state.parts[id]
      if (!d?.image || !ps.visible) continue
      const m = W[id]
      // 화면 행렬 = view · world
      ctx.setTransform(dpr * z * m[0], dpr * z * m[1], dpr * z * m[2], dpr * z * m[3], dpr * (z * m[4] + view[4]), dpr * (z * m[5] + view[5]))
      ctx.drawImage(d.image, 0, 0)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // 테두리
    const tl = toScreen({ x: 0, y: 0 }), br = toScreen({ x: char.w, y: char.h })
    ctx.strokeStyle = '#3a3d4a'
    ctx.lineWidth = 1
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)

    // 관절(pivot)과 뼈(부모 pivot → 자식 pivot)
    if (showJoints) {
      ctx.lineWidth = 2
      for (const id of Object.keys(state.parts)) {
        const par = state.parts[id].parent
        if (!par || !state.parts[par]) continue
        const a = toScreen(pivotWorld(state, par, W)), b = toScreen(pivotWorld(state, id, W))
        ctx.strokeStyle = 'rgba(155,123,255,.75)'
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      }
      for (const id of Object.keys(state.parts)) {
        const q = toScreen(pivotWorld(state, id, W))
        ctx.beginPath(); ctx.arc(q.x, q.y, 4.5, 0, Math.PI * 2)
        ctx.fillStyle = selection.includes(id) ? COL.pivot : '#9b7bff'
        ctx.fill()
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke()
      }
    }

    // 선택 영역
    selection.forEach((id, i) => {
      if (!state.parts[id]) return
      const cs = worldCorners(char, state, id, W).map(toScreen)
      ctx.strokeStyle = i === selection.length - 1 ? COL.sel : 'rgba(76,195,255,.55)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.beginPath(); cs.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke()
      ctx.setLineDash([])
      if (i === selection.length - 1) {
        ctx.fillStyle = COL.sel
        ctx.font = '12px system-ui, sans-serif'
        ctx.fillText(char.defs[id]?.name ?? id, cs[0].x + 2, cs[0].y - 5)
      }
    })

    // 기즈모
    const g = gizmo(state, W)
    if (!g) return
    const { P, ax, ay } = g
    const line = (to: Vec2, col: string, head: 'arrow' | 'box') => {
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(to.x, to.y); ctx.stroke()
      if (head === 'box') { ctx.fillRect(to.x - 6, to.y - 6, 12, 12); return }
      const a = Math.atan2(to.y - P.y, to.x - P.x)
      ctx.beginPath(); ctx.moveTo(to.x + Math.cos(a) * 12, to.y + Math.sin(a) * 12)
      ctx.lineTo(to.x + Math.cos(a + 2.5) * 10, to.y + Math.sin(a + 2.5) * 10)
      ctx.lineTo(to.x + Math.cos(a - 2.5) * 10, to.y + Math.sin(a - 2.5) * 10)
      ctx.closePath(); ctx.fill()
    }
    if (tool === 'move') {
      line({ x: P.x + GIZMO, y: P.y }, COL.x, 'arrow')
      line({ x: P.x, y: P.y - GIZMO }, COL.y, 'arrow')
      ctx.fillStyle = 'rgba(255,210,63,.85)'; ctx.fillRect(P.x - 8, P.y - 8, 16, 16)
    } else if (tool === 'rotate') {
      ctx.strokeStyle = COL.free; ctx.lineWidth = 3
      ctx.beginPath(); ctx.arc(P.x, P.y, GIZMO * 0.9, 0, Math.PI * 2); ctx.stroke()
      ctx.strokeStyle = COL.x; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(P.x + ax.x * GIZMO * 0.9, P.y + ax.y * GIZMO * 0.9); ctx.stroke()
    } else if (tool === 'scale') {
      line({ x: P.x + ax.x * GIZMO, y: P.y + ax.y * GIZMO }, COL.x, 'box')
      line({ x: P.x + ay.x * GIZMO, y: P.y + ay.y * GIZMO }, COL.y, 'box')
      ctx.fillStyle = 'rgba(255,210,63,.85)'; ctx.fillRect(P.x - 8, P.y - 8, 16, 16)
    } else {
      ctx.strokeStyle = COL.pivot; ctx.lineWidth = 3
      ctx.beginPath(); ctx.arc(P.x, P.y, 11, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(P.x - 16, P.y); ctx.lineTo(P.x + 16, P.y); ctx.moveTo(P.x, P.y - 16); ctx.lineTo(P.x, P.y + 16); ctx.stroke()
    }
  }

  // 기즈모의 어느 부분을 눌렀는지
  function hitGizmo(q: Vec2, s: EditorState): Drag | null {
    const W = worldMatrices(s)
    const g = gizmo(s, W)
    if (!g) return null
    const { P, ax, ay, id } = g
    const near = (to: Vec2) => {
      const dx = to.x - P.x, dy = to.y - P.y, L2 = dx * dx + dy * dy
      const t = Math.max(0, Math.min(1, ((q.x - P.x) * dx + (q.y - P.y) * dy) / L2))
      return Math.hypot(q.x - P.x - t * dx, q.y - P.y - t * dy) < 8 && t > 0.15
    }
    const center = Math.abs(q.x - P.x) <= 10 && Math.abs(q.y - P.y) <= 10
    const { tool, selection } = props.current
    if (tool === 'move') {
      const axis = center ? 'free' : near({ x: P.x + GIZMO + 10, y: P.y }) ? 'x' : near({ x: P.x, y: P.y - GIZMO - 10 }) ? 'y' : null
      if (!axis) return null
      return { kind: 'move', axis, sx: q.x, sy: q.y, base: s, ids: roots(s, selection), moved: false }
    }
    if (tool === 'rotate') {
      if (Math.abs(Math.hypot(q.x - P.x, q.y - P.y) - GIZMO * 0.9) > 9) return null
      return { kind: 'rotate', start: Math.atan2(q.y - P.y, q.x - P.x), base: s, ids: roots(s, selection), P, moved: false }
    }
    if (tool === 'scale') {
      const axis = center ? 'uni' : near({ x: P.x + ax.x * (GIZMO + 8), y: P.y + ax.y * (GIZMO + 8) }) ? 'x' : near({ x: P.x + ay.x * (GIZMO + 8), y: P.y + ay.y * (GIZMO + 8) }) ? 'y' : null
      if (!axis) return null
      return { kind: 'scale', axis, sx: q.x, sy: q.y, base: s, id, P, dir: axis === 'x' ? ax : ay, moved: false }
    }
    if (Math.hypot(q.x - P.x, q.y - P.y) <= 16) return { kind: 'pivot', base: s, id, moved: false }
    return null
  }

  useEffect(() => {
    const c = cv.current!, box = wrap.current!
    const resize = () => {
      const r = box.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      size.current = { w: Math.max(1, r.width), h: Math.max(1, r.height), dpr }
      c.width = Math.round(size.current.w * dpr)
      c.height = Math.round(size.current.h * dpr)
      c.style.width = size.current.w + 'px'
      c.style.height = size.current.h + 'px'
      if (!fitted.current && r.width > 10) { fitted.current = true; frameAll() } else draw()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(box)
    resize()
    const local = (e: PointerEvent | WheelEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const q = local(e)
      const before = toWorld(q)
      cam.current.zoom = Math.max(0.05, Math.min(8, cam.current.zoom * Math.exp(-e.deltaY * 0.0015)))
      const after = toWorld(q)
      cam.current.x += before.x - after.x
      cam.current.y += before.y - after.y
      draw()
    }
    const onDown = (e: PointerEvent) => {
      const q = local(e)
      c.setPointerCapture(e.pointerId)
      if (e.button === 1 || e.button === 2 || e.altKey) {
        drag.current = { kind: 'pan', sx: q.x, sy: q.y, cx: cam.current.x, cy: cam.current.y }
        return
      }
      const pr = props.current
      // 1) 기즈모
      const g = hitGizmo(q, pr.state)
      if (g) {
        const base = pr.beginEdit()
        drag.current = { ...g, base } as Drag
        return
      }
      // 2) 파츠
      const hit = hitTest(pr.char, pr.state, toWorld(q))
      if (hit) {
        const multi = e.shiftKey || e.ctrlKey || e.metaKey
        let sel = pr.selection
        if (multi) sel = sel.includes(hit) ? sel.filter((x) => x !== hit) : [...sel, hit]
        else if (!sel.includes(hit)) sel = [hit]
        else sel = [...sel.filter((x) => x !== hit), hit] // 이미 선택된 것을 누르면 주 선택으로
        pr.onSelect(sel)
        if (pr.tool === 'move' && !multi) {
          const base = pr.beginEdit()
          drag.current = { kind: 'move', axis: 'free', sx: q.x, sy: q.y, base, ids: roots(base, sel), moved: false }
        }
        return
      }
      // 3) 빈 곳: 선택 해제 + 화면 이동
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) pr.onSelect([])
      drag.current = { kind: 'pan', sx: q.x, sy: q.y, cx: cam.current.x, cy: cam.current.y }
    }
    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const q = local(e)
      const pr = props.current
      if (d.kind === 'pan') {
        cam.current.x = d.cx - (q.x - d.sx) / cam.current.zoom
        cam.current.y = d.cy - (q.y - d.sy) / cam.current.zoom
        draw()
        return
      }
      let s = d.base
      const W0 = worldMatrices(d.base)
      if (d.kind === 'move') {
        const z = cam.current.zoom
        const dw = { x: d.axis === 'y' ? 0 : (q.x - d.sx) / z, y: d.axis === 'x' ? 0 : (q.y - d.sy) / z }
        for (const id of d.ids) s = moveByWorld(s, id, dw, W0)
      } else if (d.kind === 'rotate') {
        let a = ((Math.atan2(q.y - d.P.y, q.x - d.P.x) - d.start) * 180) / Math.PI
        if (e.ctrlKey || e.metaKey) a = Math.round(a / 15) * 15 // Ctrl: 15° 단위
        for (const id of d.ids) s = updatePart(s, id, { rotation: d.base.parts[id].rotation + a })
      } else if (d.kind === 'scale') {
        const b = d.base.parts[d.id]
        if (d.axis === 'uni') {
          const f = Math.hypot(q.x - d.P.x, q.y - d.P.y) / (Math.hypot(d.sx - d.P.x, d.sy - d.P.y) || 1)
          s = updatePart(s, d.id, { scale: { x: b.scale.x * f, y: b.scale.y * f } })
        } else {
          const p0 = (d.sx - d.P.x) * d.dir.x + (d.sy - d.P.y) * d.dir.y
          const p1 = (q.x - d.P.x) * d.dir.x + (q.y - d.P.y) * d.dir.y
          const f = Math.abs(p0) < 1 ? 1 : p1 / p0
          s = updatePart(s, d.id, { scale: d.axis === 'x' ? { x: b.scale.x * f, y: b.scale.y } : { x: b.scale.x, y: b.scale.y * f } })
        }
      } else if (d.kind === 'pivot') {
        const local = apply(invert(W0[d.id]), toWorld(q))
        s = setPivotKeepPlace(d.base, d.id, local)
      }
      d.moved = true
      pr.onLive(s)
    }
    const onUp = (e: PointerEvent) => {
      const d = drag.current
      drag.current = null
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId)
      if (d && d.kind !== 'pan' && d.moved) props.current.onCommit(props.current.state)
    }
    const noMenu = (e: Event) => e.preventDefault()
    c.addEventListener('wheel', onWheel, { passive: false })
    c.addEventListener('pointerdown', onDown)
    c.addEventListener('pointermove', onMove)
    c.addEventListener('pointerup', onUp)
    c.addEventListener('pointercancel', onUp)
    c.addEventListener('contextmenu', noMenu)
    return () => {
      ro.disconnect()
      c.removeEventListener('wheel', onWheel)
      c.removeEventListener('pointerdown', onDown)
      c.removeEventListener('pointermove', onMove)
      c.removeEventListener('pointerup', onUp)
      c.removeEventListener('pointercancel', onUp)
      c.removeEventListener('contextmenu', noMenu)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { draw() })

  return (
    <div ref={wrap} className="ce-scene-canvas">
      <canvas ref={cv} data-testid="scene" />
    </div>
  )
}
