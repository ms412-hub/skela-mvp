import { getApiKey, setStoredApiKey, generateInpaintWithGemini } from './gemini'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { AssetLayer, AssetPanel } from './Assets'
import type { AssetItem } from './Assets'
import { buildSkin, deformSkin } from './meshSkin'
import type { DeformStats, Skin } from './meshSkin'

type Pt = { id: number; name: string; x: number; y: number }
type P = { x: number; y: number }
type Props = {
  img: HTMLImageElement
  width: number
  height: number
  pts: Pt[]
  links: [number, number][]
  onPtsLoad: (pts: Pt[]) => void
  onLinksLoad: (links: [number, number][]) => void
}

type Chain = {
  key: string
  label: string
  ids: [number, number, number] // 윗관절 → 중간관절 → 끝관절
  kind: 'arm' | 'leg'
  upLabel: string
  loLabel: string
}

// MediaPipe 번호: 11/12 어깨, 13/14 팔꿈치, 15/16 손목, 23/24 골반, 25/26 무릎, 27/28 발목
const CHAINS: Chain[] = [
  { key: 'armR', label: '오른팔', ids: [12, 14, 16], kind: 'arm', upLabel: '윗팔', loLabel: '아래팔' },
  { key: 'armL', label: '왼팔', ids: [11, 13, 15], kind: 'arm', upLabel: '윗팔', loLabel: '아래팔' },
  { key: 'legR', label: '오른다리', ids: [24, 26, 28], kind: 'leg', upLabel: '허벅지', loLabel: '종아리' },
  { key: 'legL', label: '왼다리', ids: [23, 25, 27], kind: 'leg', upLabel: '허벅지', loLabel: '종아리' },
]

const HAND_EXTEND = 45 // 손목 너머로 손까지 포함
const FOOT_EXTEND = 40 // 발목 너머로 발까지 포함

const LIMB_COLORS: Record<string, string> = {
  armR: '#e63946',
  armL: '#1d6fe0',
  legR: '#2a9d3f',
  legL: '#f08a00',
}

/* ───────────── 공통 수학 도구 ───────────── */

const toRad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

function rot(v: P, d: number): P {
  const c = Math.cos(toRad(d))
  const s = Math.sin(toRad(d))
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

/* ───────────── 파츠 오려내기 ───────────── */

// a→b 선분을 따라가는 직사각형 영역
function segmentPoly(a: P, b: P, halfW: number, extendEnd: number): P[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const end = { x: b.x + ux * extendEnd, y: b.y + uy * extendEnd }
  return [
    { x: a.x + nx * halfW, y: a.y + ny * halfW },
    { x: end.x + nx * halfW, y: end.y + ny * halfW },
    { x: end.x - nx * halfW, y: end.y - ny * halfW },
    { x: a.x - nx * halfW, y: a.y - ny * halfW },
  ]
}

function tracePath(ctx: CanvasRenderingContext2D, poly: P[], ox = 0, oy = 0) {
  ctx.beginPath()
  poly.forEach((q, i) => {
    if (i === 0) ctx.moveTo(q.x - ox, q.y - oy)
    else ctx.lineTo(q.x - ox, q.y - oy)
  })
  ctx.closePath()
}

// 원본에서 poly 영역만 오려낸 조각
function cutPart(img: CanvasImageSource, W: number, H: number, poly: P[]) {
  const xs = poly.map((q) => q.x)
  const ys = poly.map((q) => q.y)
  const x0 = Math.max(0, Math.floor(Math.min(...xs)))
  const y0 = Math.max(0, Math.floor(Math.min(...ys)))
  const x1 = Math.min(W, Math.ceil(Math.max(...xs)))
  const y1 = Math.min(H, Math.ceil(Math.max(...ys)))
  const bw = Math.max(1, x1 - x0)
  const bh = Math.max(1, y1 - y0)

  const canvas = document.createElement('canvas')
  canvas.width = bw
  canvas.height = bh
  const ctx = canvas.getContext('2d')!
  ctx.save()
  tracePath(ctx, poly, x0, y0)
  ctx.clip()
  ctx.drawImage(img, -x0, -y0, W, H)
  ctx.restore()

  return { canvas, bw, bh, cx: x0 + bw / 2, cy: y0 + bh / 2 }
}

// 원본에서 사용자가 오려낸 파츠 영역을 배경색으로 지운 이미지 (중복 노출 방지)
function eraseParts(img: HTMLImageElement, W: number, H: number, polys: P[][]) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, W, H)
  const [r, g, b] = ctx.getImageData(2, 2, 1, 1).data
  const bg = `rgb(${r},${g},${b})`
  ctx.fillStyle = bg
  ctx.strokeStyle = bg
  ctx.lineWidth = 4
  for (const poly of polys) {
    tracePath(ctx, poly)
    ctx.fill()
    ctx.stroke()
  }
  return { canvas: c, bg }
}

function buildRig(
  img: HTMLImageElement,
  W: number,
  H: number,
  pts: Pt[],
  armHW: number,
  legHW: number,
  partPolys: P[][] = [],
) {
  const erased = eraseParts(img, W, H, partPolys)
  const srcImg = erased.canvas
  const get = (id: number) => pts.find((p) => p.id === id)!
  // 이미지 좌표(y 아래로) → Three 좌표(y 위로, 중앙이 원점)
  const w2 = (p: P) => ({ x: p.x - W / 2, y: H / 2 - p.y })

  const base = document.createElement('canvas')
  base.width = W
  base.height = H
  const bctx = base.getContext('2d')!
  bctx.drawImage(srcImg, 0, 0, W, H)
  const bg = erased.bg

  // 오려낸 자리를 배경색으로 덮기 (경계선까지)
  const erase = (poly: P[]) => {
    bctx.save()
    bctx.fillStyle = bg
    bctx.strokeStyle = bg
    bctx.lineWidth = 4
    tracePath(bctx, poly)
    bctx.fill()
    bctx.stroke()
    bctx.restore()
  }

  const limbs = CHAINS.map((ch) => {
    const [a, m, e] = ch.ids.map(get)
    const hw = ch.kind === 'arm' ? armHW : legHW
    const ext = ch.kind === 'arm' ? HAND_EXTEND : FOOT_EXTEND

    const upPoly = segmentPoly(a, m, hw, hw * 0.6) // 관절 쪽을 살짝 겹치게
    const loPoly = segmentPoly(m, e, hw, ext)
    const up = cutPart(srcImg, W, H, upPoly)
    const lo = cutPart(srcImg, W, H, loPoly)
    erase(upPoly)
    erase(loPoly)

    const wa = w2(a)
    const wm = w2(m)
    const upC = w2({ x: up.cx, y: up.cy })
    const loC = w2({ x: lo.cx, y: lo.cy })

    return {
      key: ch.key,
      pivotA: wa,
      elbowRel: { x: wm.x - wa.x, y: wm.y - wa.y },
      up: { ...up, off: { x: upC.x - wa.x, y: upC.y - wa.y } },
      lo: { ...lo, off: { x: loC.x - wm.x, y: loC.y - wm.y } },
    }
  })

  return { base, bg, limbs, src: srcImg }
}

function mkTex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/* ───────────── 자세 계산 + 가이드 이미지 ───────────── */

// 슬라이더 각도를 적용한 뒤의 관절 위치 (이미지 좌표)
function posedChains(pts: Pt[], W: number, H: number, angles: Record<string, number>) {
  const get = (id: number) => pts.find((p) => p.id === id)!
  const toW = (p: P) => ({ x: p.x - W / 2, y: H / 2 - p.y })
  const toI = (p: P) => ({ x: p.x + W / 2, y: H / 2 - p.y })
  return CHAINS.map((ch) => {
    const a = toW(get(ch.ids[0]))
    const m = toW(get(ch.ids[1]))
    const e = toW(get(ch.ids[2]))
    const up = angles[ch.key + '_up'] ?? 0
    const lo = angles[ch.key + '_lo'] ?? 0
    // 메시 모드에서 윗관절(어깨/골반)을 직접 끌면 생기는 평행이동 (세계 좌표, y 위)
    const a2 = { x: a.x + (angles[ch.key + '_dx'] ?? 0), y: a.y + (angles[ch.key + '_dy'] ?? 0) }
    const vm = rot({ x: m.x - a.x, y: m.y - a.y }, up)
    const m2 = { x: a2.x + vm.x, y: a2.y + vm.y }
    const ve = rot({ x: e.x - m.x, y: e.y - m.y }, up + lo)
    const e2 = { x: m2.x + ve.x, y: m2.y + ve.y }
    return { key: ch.key, a: toI(a2), m: toI(m2), e: toI(e2) }
  })
}

// 모든 관절의 현재 위치(이미지 좌표). 추가 관절은 연결된 가장 가까운 기본 관절의 이동량만큼 따라감
function posedPoints(
  pts: Pt[],
  links: [number, number][],
  W: number,
  H: number,
  angles: Record<string, number>,
) {
  const rest = new Map(pts.map((p) => [p.id, { x: p.x, y: p.y }]))
  const cur = new Map(rest)
  const disp = new Map<number, P>()
  for (const ch of posedChains(pts, W, H, angles)) {
    for (const [i, q] of [[0, ch.a], [1, ch.m], [2, ch.e]] as const) {
      const id = CHAINS.find((c) => c.key === ch.key)!.ids[i]
      const r = rest.get(id)!
      cur.set(id, q)
      disp.set(id, { x: q.x - r.x, y: q.y - r.y })
    }
  }
  const isBase = (id: number) => id < 100
  for (const p of pts) {
    if (isBase(p.id)) continue
    // 연결을 따라 가장 가까운 기본 관절 찾기 (BFS)
    const seen = new Set([p.id])
    const queue = [p.id]
    let base: number | null = null
    while (queue.length && base === null) {
      const id = queue.shift()!
      for (const [a, b] of links) {
        const o = a === id ? b : b === id ? a : null
        if (o === null || seen.has(o)) continue
        seen.add(o)
        if (isBase(o)) {
          base = o
          break
        }
        queue.push(o)
      }
    }
    const d = base !== null ? disp.get(base) : undefined
    if (d) cur.set(p.id, { x: p.x + d.x, y: p.y + d.y })
  }
  return cur
}

// AI에게 줄 뼈대 가이드 이미지
function renderGuide(
  pts: Pt[],
  W: number,
  H: number,
  angles: Record<string, number>,
  links: [number, number][] = [],
) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  const get = (id: number) => pts.find((p) => p.id === id)!
  const lw = Math.max(6, Math.round(W / 90))
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const line = (a: P, b: P, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  const dot = (p: P, color: string) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(p.x, p.y, lw * 0.9, 0, Math.PI * 2)
    ctx.fill()
  }

  // 몸통(고정)
  const ls = get(11)
  const rs = get(12)
  const lh = get(23)
  const rh = get(24)
  line(ls, rs, '#222')
  line(lh, rh, '#222')
  line(ls, lh, '#222')
  line(rs, rh, '#222')

  // 머리(고정): 코 위치에 어깨 폭 비례 원
  const nose = get(0)
  const headR = Math.hypot(ls.x - rs.x, ls.y - rs.y) * 0.38
  ctx.strokeStyle = '#222'
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.arc(nose.x, nose.y, headR, 0, Math.PI * 2)
  ctx.stroke()

  // 팔다리(자세 적용)
  for (const ch of posedChains(pts, W, H, angles)) {
    const color = LIMB_COLORS[ch.key]
    line(ch.a, ch.m, color)
    line(ch.m, ch.e, color)
    dot(ch.a, '#222')
    dot(ch.m, '#222')
    dot(ch.e, '#222')
  }

  // 사용자가 추가한 관절과 연결선
  if (links.length || pts.some((p) => p.id >= 100)) {
    const cur = posedPoints(pts, links, W, H, angles)
    for (const [a, b] of links) {
      const pa = cur.get(a)
      const pb = cur.get(b)
      if (pa && pb) line(pa, pb, '#7a3cff')
    }
    for (const p of pts) {
      if (p.id >= 100) dot(cur.get(p.id)!, '#4cc9f0')
    }
  }
  return c
}

function downloadUrl(name: string, url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}

/* ───────────── IK: 끝 점을 끌면 관절이 따라옴 ───────────── */

// 기본 자세(각도 0)일 때의 팔다리 정보 (Three 좌표: y가 위)
function chainRest(pts: Pt[], W: number, H: number, ch: Chain) {
  const get = (id: number) => pts.find((p) => p.id === id)!
  const toW = (p: P) => ({ x: p.x - W / 2, y: H / 2 - p.y })
  const a = toW(get(ch.ids[0]))
  const m = toW(get(ch.ids[1]))
  const e = toW(get(ch.ids[2]))
  return {
    a,
    L1: Math.hypot(m.x - a.x, m.y - a.y),
    L2: Math.hypot(e.x - m.x, e.y - m.y),
    th1: Math.atan2(m.y - a.y, m.x - a.x),
    th2: Math.atan2(e.y - m.y, e.x - m.x),
  }
}

// 끝 점을 target에 가져가도록 윗부분/아랫부분 각도 계산
function solveIK(
  r: ReturnType<typeof chainRest>,
  target: P,
  curUp: number,
  sign: number,
) {
  const { a, L1, L2, th1, th2 } = r
  const dx = target.x - a.x
  const dy = target.y - a.y
  const dist = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(L1 - L2) + 1), L1 + L2 - 1)
  const beta = Math.atan2(dy, dx)
  const cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)
  const alpha = Math.acos(Math.min(1, Math.max(-1, cosA)))
  const c1 = beta + alpha
  const c2 = beta - alpha

  let s = sign
  if (s === 0) {
    const cur = th1 + toRad(curUp)
    const far = (x: number) => Math.abs(norm(deg(x - cur)))
    s = far(c1) < far(c2) ? -1 : 1
  }
  const phi1 = s < 0 ? c1 : c2
  const mx = a.x + L1 * Math.cos(phi1)
  const my = a.y + L1 * Math.sin(phi1)
  const tx = a.x + dist * Math.cos(beta)
  const ty = a.y + dist * Math.sin(beta)
  const phi2 = Math.atan2(ty - my, tx - mx)

  const up = norm(deg(phi1 - th1))
  const lo = norm(deg(phi2 - th2) - up)
  return { up, lo, sign: s }
}

type AngleSetter = React.Dispatch<React.SetStateAction<Record<string, number>>>

function GuideEditor({
  pts,
  W,
  H,
  angles,
  setAngles,
  links,
}: {
  pts: Pt[]
  W: number
  H: number
  angles: Record<string, number>
  setAngles: AngleSetter
  links: [number, number][]
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ key: string; part: 'mid' | 'end'; sign: number } | null>(null)
  const [active, setActive] = useState<string | null>(null)

  const posed = useMemo(() => posedChains(pts, W, H, angles), [pts, W, H, angles])

  useEffect(() => {
    const c = ref.current!
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')!
    ctx.drawImage(renderGuide(pts, W, H, angles, links), 0, 0)
    const rad = Math.max(10, W / 60)
    for (const ch of posed) {
      for (const part of ['mid', 'end'] as const) {
        const p = part === 'mid' ? ch.m : ch.e
        const isActive = active === ch.key + part
        ctx.beginPath()
        ctx.arc(p.x, p.y, isActive ? rad * 1.4 : rad, 0, Math.PI * 2)
        ctx.fillStyle = part === 'end' ? LIMB_COLORS[ch.key] : '#fff'
        ctx.fill()
        ctx.lineWidth = 3
        ctx.strokeStyle = isActive ? '#ffd23f' : LIMB_COLORS[ch.key]
        ctx.stroke()
      }
    }
  }, [pts, W, H, angles, posed, active, links])

  function toCanvas(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = ref.current!
    const rect = c.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) * c.width) / rect.width,
      y: ((e.clientY - rect.top) * c.height) / rect.height,
      ratio: c.width / rect.width,
    }
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y, ratio } = toCanvas(e)
    let best: { key: string; part: 'mid' | 'end' } | null = null
    let bestD = 24 * ratio
    for (const ch of posed) {
      for (const part of ['end', 'mid'] as const) {
        const p = part === 'mid' ? ch.m : ch.e
        const d = Math.hypot(p.x - x, p.y - y)
        if (d < bestD) {
          bestD = d
          best = { key: ch.key, part }
        }
      }
    }
    if (!best) return
    const chain = CHAINS.find((c) => c.key === best!.key)!
    const r = chainRest(pts, W, H, chain)
    const s = Math.sin(r.th2 - r.th1 + toRad(angles[chain.key + '_lo'] ?? 0))
    const sign = s > 0.05 ? 1 : s < -0.05 ? -1 : 0
    drag.current = { ...best, sign }
    setActive(best.key + best.part)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current
    if (!d) return
    const { x, y } = toCanvas(e)
    const target = {
      x: x - W / 2 - (angles[d.key + '_dx'] ?? 0),
      y: H / 2 - y - (angles[d.key + '_dy'] ?? 0),
    }
    const chain = CHAINS.find((c) => c.key === d.key)!
    const r = chainRest(pts, W, H, chain)

    if (d.part === 'end') {
      const res = solveIK(r, target, angles[d.key + '_up'] ?? 0, d.sign)
      d.sign = res.sign
      setAngles((prev) => ({
        ...prev,
        [d.key + '_up']: Math.round(res.up),
        [d.key + '_lo']: Math.round(res.lo),
      }))
    } else {
      const up = norm(deg(Math.atan2(target.y - r.a.y, target.x - r.a.x) - r.th1))
      setAngles((prev) => ({ ...prev, [d.key + '_up']: Math.round(up) }))
    }
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drag.current = null
    setActive(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <canvas
      ref={ref}
      className="guide-editor"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    />
  )
}

/* ───────────── Three.js 파츠 렌더링 ───────────── */

type LimbData = ReturnType<typeof buildRig>['limbs'][number]

function Limb({ data, upDeg, loDeg, dx = 0, dy = 0 }: { data: LimbData; upDeg: number; loDeg: number; dx?: number; dy?: number }) {
  const upTex = useMemo(() => mkTex(data.up.canvas), [data])
  const loTex = useMemo(() => mkTex(data.lo.canvas), [data])

  return (
    <group position={[data.pivotA.x + dx, data.pivotA.y + dy, 0.1]} rotation={[0, 0, toRad(upDeg)]}>
      <mesh position={[data.up.off.x, data.up.off.y, 0]}>
        <planeGeometry args={[data.up.bw, data.up.bh]} />
        <meshBasicMaterial map={upTex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <group position={[data.elbowRel.x, data.elbowRel.y, 0.05]} rotation={[0, 0, toRad(loDeg)]}>
        <mesh position={[data.lo.off.x, data.lo.off.y, 0]}>
          <planeGeometry args={[data.lo.bw, data.lo.bh]} />
          <meshBasicMaterial map={loTex} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

/* ───────────── 메시 변형 모드: 이미지 전체를 하나의 메시로 휘게 함 ───────────── */

function DeformMesh({
  skin,
  tex,
  angles,
  onStats,
}: {
  skin: Skin
  tex: THREE.Texture
  angles: Record<string, number>
  onStats: (s: DeformStats) => void
}) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(skin.rest), 3))
    g.setAttribute('uv', new THREE.BufferAttribute(skin.uv, 2))
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(skin.index), 1))
    return g
  }, [skin])
  useEffect(() => {
    const pos = geom.getAttribute('position') as THREE.BufferAttribute
    const idx = geom.getIndex()!
    const r = deformSkin(skin, angles, pos.array as Float32Array, idx.array as Uint32Array)
    idx.needsUpdate = true
    geom.setDrawRange(0, r.drawCount)
    onStats({ folds: r.folds, maxStretch: r.maxStretch, hidden: r.hidden })
    pos.needsUpdate = true
    geom.computeBoundingSphere()
  }, [geom, skin, angles, onStats])
  return (
    <mesh geometry={geom} frustumCulled={false}>
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

// 관절 핸들: 어깨/골반 = 팔다리 통째 이동, 팔꿈치/무릎 = 굽히기, 손목/발목 = IK
function JointHandles({
  pts,
  W,
  H,
  angles,
  setAngles,
}: {
  pts: Pt[]
  W: number
  H: number
  angles: Record<string, number>
  setAngles: AngleSetter
}) {
  const { camera, gl } = useThree()
  const anglesRef = useRef(angles)
  anglesRef.current = angles
  const posed = useMemo(() => posedChains(pts, W, H, angles), [pts, W, H, angles])
  const [active, setActive] = useState<string | null>(null)
  const rr = Math.max(10, W / 60)
  const w2 = (p: P) => ({ x: p.x - W / 2, y: H / 2 - p.y })

  const bones = useMemo(() => {
    const arr: number[] = []
    for (const ch of posed) {
      const a = w2(ch.a)
      const m = w2(ch.m)
      const e = w2(ch.e)
      arr.push(a.x, a.y, 0, m.x, m.y, 0, m.x, m.y, 0, e.x, e.y, 0)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posed])

  function toWorld(cx: number, cy: number) {
    const r = gl.domElement.getBoundingClientRect()
    const zoom = (camera as THREE.OrthographicCamera).zoom
    return { x: (cx - r.left - r.width / 2) / zoom, y: -(cy - r.top - r.height / 2) / zoom }
  }

  function begin(ch: Chain, part: 0 | 1 | 2, hx: number, hy: number, e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    const p0 = toWorld(e.nativeEvent.clientX, e.nativeEvent.clientY)
    const off = { x: hx - p0.x, y: hy - p0.y } // 잡은 위치와 점 중심의 차이 (튀지 않게)
    const r = chainRest(pts, W, H, ch)
    const s0 = Math.sin(r.th2 - r.th1 + toRad(anglesRef.current[ch.key + '_lo'] ?? 0))
    let sign = s0 > 0.05 ? 1 : s0 < -0.05 ? -1 : 0
    const id = ch.key + part
    setActive(id)
    const r1 = (v: number) => Math.round(v * 10) / 10

    const move = (ev: PointerEvent) => {
      const q = toWorld(ev.clientX, ev.clientY)
      const t = { x: q.x + off.x, y: q.y + off.y }
      if (part === 0) {
        setAngles((prev) => ({ ...prev, [ch.key + '_dx']: r1(t.x - r.a.x), [ch.key + '_dy']: r1(t.y - r.a.y) }))
        return
      }
      const dx = anglesRef.current[ch.key + '_dx'] ?? 0
      const dy = anglesRef.current[ch.key + '_dy'] ?? 0
      const rel = { x: t.x - dx, y: t.y - dy } // 어깨 이동분을 뺀 기준 좌표
      if (part === 2) {
        const res = solveIK(r, rel, anglesRef.current[ch.key + '_up'] ?? 0, sign)
        sign = res.sign
        setAngles((prev) => ({ ...prev, [ch.key + '_up']: r1(res.up), [ch.key + '_lo']: r1(res.lo) }))
      } else {
        const up = norm(deg(Math.atan2(rel.y - r.a.y, rel.x - r.a.x) - r.th1))
        setAngles((prev) => ({ ...prev, [ch.key + '_up']: r1(up) }))
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setActive(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <>
      <primitive object={bones} position={[0, 0, 0.8]} />
      {posed.map((ch) => {
        const def = CHAINS.find((c) => c.key === ch.key)!
        return ([0, 1, 2] as const).map((part) => {
          const pw = w2(part === 0 ? ch.a : part === 1 ? ch.m : ch.e)
          const id = ch.key + part
          const on = active === id
          return (
            <mesh
              key={id}
              position={[pw.x, pw.y, 0.95]}
              onPointerDown={(e) => begin(def, part, pw.x, pw.y, e)}
              onPointerOver={() => (gl.domElement.style.cursor = 'pointer')}
              onPointerOut={() => (gl.domElement.style.cursor = '')}
            >
              <circleGeometry args={[on ? rr * 1.4 : rr, 24]} />
              <meshBasicMaterial color={part === 2 ? LIMB_COLORS[ch.key] : part === 0 ? '#ffd23f' : '#ffffff'} toneMapped={false} />
            </mesh>
          )
        })
      })}
    </>
  )
}

function FitCamera({ w, h }: { w: number; h: number }) {
  const { camera, size } = useThree()
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera
    cam.zoom = Math.min(size.width / w, size.height / h)
    cam.updateProjectionMatrix()
  }, [camera, size, w, h])
  return null
}

/* ───────────── 이미지 영역(올가미) 선택 ───────────── */

function PartSelectOverlay({
  glEl,
  W,
  H,
  onDone,
}: {
  glEl: React.RefObject<HTMLCanvasElement | null>
  W: number
  H: number
  onDone: (poly: P[]) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const path = useRef<P[]>([])
  const down = useRef(false)

  // 화면 좌표 → 이미지 좌표 (FitCamera와 같은 배율 계산)
  function toImg(e: React.PointerEvent<HTMLCanvasElement>): P | null {
    if (!glEl.current) return null
    const r = glEl.current.getBoundingClientRect()
    const zoom = Math.min(r.width / W, r.height / H)
    return {
      x: (e.clientX - r.left - r.width / 2) / zoom + W / 2,
      y: (e.clientY - r.top - r.height / 2) / zoom + H / 2,
    }
  }

  function redraw() {
    const c = ref.current
    if (!c || !glEl.current) return
    const r = glEl.current.getBoundingClientRect()
    if (c.width !== Math.round(r.width) || c.height !== Math.round(r.height)) {
      c.width = Math.round(r.width) // 창 크기가 바뀌어도 오버레이 크기를 맞춤
      c.height = Math.round(r.height)
    }
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    const zoom = Math.min(r.width / W, r.height / H)
    const sx = (p: P) => (p.x - W / 2) * zoom + r.width / 2
    const sy = (p: P) => (p.y - H / 2) * zoom + r.height / 2
    const pts = path.current
    if (!pts.length) return
    ctx.beginPath()
    pts.forEach((p, i) => (i ? ctx.lineTo(sx(p), sy(p)) : ctx.moveTo(sx(p), sy(p))))
    ctx.closePath()
    ctx.fillStyle = 'rgba(255, 210, 63, 0.25)'
    ctx.fill()
    ctx.setLineDash([6, 4])
    ctx.lineWidth = 2
    ctx.strokeStyle = '#ffd23f'
    ctx.stroke()
  }

  return (
    <canvas
      ref={ref}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={(e) => {
        const q = toImg(e)
        if (!q) return // 그림 화면이 아직 준비되지 않음
        down.current = true
        path.current = [q]
        e.currentTarget.setPointerCapture(e.pointerId)
        redraw()
      }}
      onPointerMove={(e) => {
        if (!down.current) return
        const q = toImg(e)
        if (q) path.current.push(q)
        redraw()
      }}
      onPointerUp={(e) => {
        if (!down.current) return
        down.current = false
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        const poly = path.current.map((p) => ({
          x: Math.min(Math.max(p.x, 0), W),
          y: Math.min(Math.max(p.y, 0), H),
        }))
        path.current = []
        redraw()
        onDone(poly)
      }}
    />
  )
}

/* ───────────── 메인 화면 ───────────── */

export default function RigView({ img, width, height, pts, links, onPtsLoad, onLinksLoad }: Props) {
  const [armHW, setArmHW] = useState(30)
  const [legHW, setLegHW] = useState(40)
  const [angles, setAngles] = useState<Record<string, number>>({})
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [selAsset, setSelAsset] = useState<number | null>(null)
  const glEl = useRef<HTMLCanvasElement | null>(null)
  const [selectMode, setSelectMode] = useState(false) // 이미지 영역(파츠) 선택 모드
  const [meshMode, setMeshMode] = useState(false) // 메시 변형 모드 (이미지가 관절을 따라 휨)
  const [stats, setStats] = useState<DeformStats>({ folds: 0, maxStretch: 1, hidden: 0 })
  const [partMsg, setPartMsg] = useState('')

   // Gemini API 연동 State 및 함수
  const [apiKey, setApiKey] = useState<string>(getApiKey())
  const [promptText, setPromptText] = useState<string>('')
  const [aiStatus, setAiStatus] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState<boolean>(false)

  const handleKeyChange = (val: string) => {
    setApiKey(val)
    setStoredApiKey(val)
  }

  async function runGeminiInpaint() {
    const currentKey = apiKey || getApiKey()
    if (!currentKey) {
      alert('API Key가 없어요! 아래 입력창이나 .env 파일에 키를 넣어주세요.')
      return
    }

    setIsGenerating(true)
    setAiStatus('🤖 Gemini가 캐릭터 포즈를 다시 그리는 중...')

    try {
      const origCanvas = document.createElement('canvas')
      origCanvas.width = width
      origCanvas.height = height
      const octx = origCanvas.getContext('2d')!
      octx.drawImage(img, 0, 0, width, height)

      const guideCanvas = renderGuide(pts, width, height, angles, links)

      const resultText = await generateInpaintWithGemini(
        currentKey,
        origCanvas,
        guideCanvas,
        promptText
      )

      console.log('Gemini 응답:', resultText)
      setAiStatus('✅ 생성 요청 완료! (결과는 Console 확인)')
    } catch (err: any) {
      console.error(err)
      setAiStatus(`❌ 오류 발생: ${err.message || '요청 실패'}`)
    } finally {
      setIsGenerating(false)
    }
  }


  const posed = useMemo(
    () => posedChains(pts, width, height, angles),
    [pts, width, height, angles],
  )

  // 오려낸 파츠의 원본 영역 (소품을 움직일 때마다 리그가 다시 만들어지지 않도록 문자열 키 사용)
  const polyKey = JSON.stringify(assets.filter((a) => a.poly).map((a) => a.poly))
  const rig = useMemo(
    () => buildRig(img, width, height, pts, armHW, legHW, JSON.parse(polyKey) as P[][]),
    [img, width, height, pts, armHW, legHW, polyKey],
  )
  const baseTex = useMemo(() => mkTex(rig.base), [rig])

  // 메시 변형용: 원본 이미지(오려낸 파츠 영역은 제외)를 텍스처로 유지하고 자동 가중치 계산
  const skin = useMemo(() => {
    if (!meshMode) return null
    const get = (id: number) => pts.find((p) => p.id === id)!
    const w2 = (p: P) => ({ x: p.x - width / 2, y: height / 2 - p.y })
    return buildSkin(
      CHAINS.map((ch) => ({
        key: ch.key,
        a: w2(get(ch.ids[0])),
        m: w2(get(ch.ids[1])),
        e: w2(get(ch.ids[2])),
        hw: ch.kind === 'arm' ? armHW : legHW,
        ext: ch.kind === 'arm' ? HAND_EXTEND : FOOT_EXTEND,
      })),
      width,
      height,
    )
  }, [meshMode, pts, width, height, armHW, legHW])
  const meshTex = useMemo(() => (meshMode ? mkTex(rig.src) : null), [meshMode, rig])

  const guideUrl = useMemo(
    () => renderGuide(pts, width, height, angles, links).toDataURL('image/png'),
    [pts, width, height, angles, links],
  )

  const setAngle = (k: string, v: number) => setAngles((prev) => ({ ...prev, [k]: v }))

  function updateAsset(id: number, p: Partial<AssetItem>) {
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, ...p } : a)))
  }

  // 오려낸 영역으로 파츠(=움직일 수 있는 소품) 만들기
  function makePart(poly: P[], canvas: HTMLCanvasElement, cx: number, cy: number, name: string): AssetItem {
    return {
      id: Date.now() + Math.floor(Math.random() * 1000),
      name,
      orig: canvas,
      anchor: 'free',
      scale: 1,
      offX: Math.round(cx - width / 2),
      offY: Math.round(height / 2 - cy),
      rot: 0,
      flip: false,
      front: true,
      bgTol: 0,
      poly,
    }
  }

  function addPartFromPoly(poly: P[]) {
    const area = Math.abs(
      poly.reduce((s, q, i) => {
        const n = poly[(i + 1) % poly.length]
        return s + (q.x * n.y - n.x * q.y)
      }, 0) / 2,
    )
    if (poly.length < 3 || area < 100) {
      setPartMsg('영역이 너무 작아요. 파츠 둘레를 따라 크게 그려주세요.')
      return
    }
    const c = cutPart(rig.src, width, height, poly) // 이미 오려낸 파츠가 있으면 그 자리는 제외된 이미지
    const item = makePart(poly, c.canvas, c.cx, c.cy, `파츠 ${assets.filter((a) => a.poly).length + 1}`)
    setAssets((prev) => [...prev, item])
    setSelAsset(item.id)
    setSelectMode(false)
    setPartMsg('✅ 파츠 생성됨 — 본체를 끌어 이동 / 초록 점 회전 / 노란 점 크기. 삭제하면 원래 자리로 복원돼요.')
  }

  function saveScreen() {
    const c = glEl.current
    if (!c) return
    downloadUrl('skela-composite.png', c.toDataURL('image/png'))
  }

  function savePose() {
    const data = {
      version: 2,
      canvas: { w: width, h: height },
      points: pts.map((p) => ({
        id: p.id,
        name: p.name,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
      })),
      links,
      parts: assets
        .filter((a) => a.poly)
        .map((a) => ({
          name: a.name,
          poly: a.poly,
          scale: a.scale,
          offX: a.offX,
          offY: a.offY,
          rot: a.rot,
          flip: a.flip,
          front: a.front,
        })),
      armHW,
      legHW,
      angles,
      savedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    downloadUrl('pose.json', url)
    URL.revokeObjectURL(url)
  }

  async function loadPose(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let d: any
    try {
      d = JSON.parse(await file.text())
    } catch (err) {
      console.error('JSON 파싱 실패', err)
      alert(`JSON 파일이 아니에요: ${file.name}\n(pose.json 파일을 골랐는지 확인해주세요)`)
      input.value = ''
      return
    }

    try {
      if (!Array.isArray(d.points) || !d.canvas) {
        alert('스켈라 포즈 파일 형식이 아니에요.')
      } else if (d.canvas.w !== width || d.canvas.h !== height) {
        alert(
          `이미지 크기가 달라요.\n저장: ${d.canvas.w}×${d.canvas.h}\n현재: ${width}×${height}\n같은 이미지를 올린 뒤 불러와 주세요.`,
        )
      } else if (![0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].every((id) => d.points.some((q: Pt) => q.id === id))) {
        alert('기본 관절(13개)이 빠진 포즈 파일이에요.')
      } else {
        const ids = new Set<number>(d.points.map((q: Pt) => q.id))
        onPtsLoad(d.points)
        onLinksLoad(
          Array.isArray(d.links)
            ? d.links.filter((l: [number, number]) => ids.has(l[0]) && ids.has(l[1]))
            : [],
        )
        // 저장된 파츠 복원: 앞에서 오려낸 영역을 지운 이미지에서 차례로 다시 오림
        const saved: { name: string; poly: P[]; scale: number; offX: number; offY: number; rot: number; flip: boolean; front: boolean }[] =
          Array.isArray(d.parts) ? d.parts : []
        const restored: AssetItem[] = []
        saved.forEach((sp, i) => {
          const srcC = eraseParts(img, width, height, saved.slice(0, i).map((q) => q.poly)).canvas
          const c = cutPart(srcC, width, height, sp.poly)
          restored.push({
            ...makePart(sp.poly, c.canvas, c.cx, c.cy, sp.name),
            id: Date.now() + i,
            scale: sp.scale,
            offX: sp.offX,
            offY: sp.offY,
            rot: sp.rot,
            flip: sp.flip,
            front: sp.front,
          })
        })
        setAssets((prev) => [...prev.filter((a) => !a.poly), ...restored])
        setSelAsset(null)
        setAngles(d.angles ?? {})
        setArmHW(d.armHW ?? 30)
        setLegHW(d.legHW ?? 40)
      }
    } catch (err) {
      console.error('포즈 적용 실패', err)
      alert('포즈를 적용하다 오류가 났어요. F12 → Console을 확인해주세요.')
    }
    input.value = ''
  }

  return (
    <div className="rig-wrap">
      <div className="rig-canvas-box">
        <div className="rig-canvas">
          <Canvas
            orthographic
            gl={{ preserveDrawingBuffer: true }}
            onPointerMissed={() => setSelAsset(null)}
            onCreated={({ gl }) => {
              glEl.current = gl.domElement
            }}
            camera={{ position: [0, 0, 10], zoom: 1, near: 0.1, far: 100 }}
          >
            <color attach="background" args={[rig.bg]} />
            <FitCamera w={width} h={height} />

            {meshMode && skin && meshTex ? (
              <>
                <DeformMesh skin={skin} tex={meshTex} angles={angles} onStats={setStats} />
                <JointHandles pts={pts} W={width} H={height} angles={angles} setAngles={setAngles} />
              </>
            ) : (
              <mesh>
                <planeGeometry args={[width, height]} />
                <meshBasicMaterial map={baseTex} transparent depthWrite={false} toneMapped={false} />
              </mesh>
            )}

            {!meshMode && rig.limbs.map((l) => (
              <Limb
                key={l.key}
                data={l}
                upDeg={angles[l.key + '_up'] ?? 0}
                loDeg={angles[l.key + '_lo'] ?? 0}
                dx={angles[l.key + '_dx'] ?? 0}
                dy={angles[l.key + '_dy'] ?? 0}
              />
            ))}

            <AssetLayer
              assets={assets}
              pts={pts}
              posed={posed}
              angles={angles}
              W={width}
              H={height}
              selectedId={selAsset}
              onSelect={setSelAsset}
              onChange={updateAsset}
            />
          </Canvas>
          {selectMode && (
            <PartSelectOverlay
              glEl={glEl}
              W={width}
              H={height}
              onDone={addPartFromPoly}
            />
          )}
        </div>
      </div>

      <div className="rig-panel">
        <div className="panel-title">메시 변형 (실험) — 그림 위 관절점을 직접 드래그</div>
        <button className={meshMode ? 'btn' : 'btn ghost'} onClick={() => setMeshMode(!meshMode)}>
          {meshMode ? '메시 변형 모드 켜짐 (끄기)' : '메시 변형 모드 켜기'}
        </button>
        {meshMode && (
          <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>
            노란 점=어깨/골반(통째 이동) · 흰 점=팔꿈치/무릎(굽히기) · 색 점=손목/발목(IK). 영향 범위는 아래 팔/다리 폭 슬라이더.
            <br />
            뒤집힌 삼각형 {stats.folds}개 · 최대 늘어남 ×{stats.maxStretch.toFixed(2)} · 숨긴 삼각형 {stats.hidden}개
          </div>
        )}
        <div className="panel-title">자세 잡기 (손목·발목·팔꿈치·무릎 점을 끌어보세요)</div>
        <GuideEditor
          pts={pts}
          W={width}
          H={height}
          angles={angles}
          setAngles={setAngles}
          links={links}
        />


        {/* ── Gemini API 연동 섹션 ── */}
        <div className="panel-title">✨ Gemini AI 0원 포즈 재생성</div>
        <div className="limb-group">
          <label>
            Gemini API Key {import.meta.env.VITE_GEMINI_API_KEY ? '(env 연동됨)' : ''}
            <input
              type="password"
              placeholder="AIzaSy..."
              value={apiKey}
              onChange={(e) => handleKeyChange(e.target.value)}
              style={{
                background: '#14151a',
                color: '#fff',
                border: '1px solid #2a2c35',
                padding: '6px',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            />
          </label>
          <label>
            추가 프롬프트 (선택)
            <input
              type="text"
              placeholder="예: 자연스러운 역동적인 포즈로 바꿔줘"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              style={{
                background: '#14151a',
                color: '#fff',
                border: '1px solid #2a2c35',
                padding: '6px',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            />
          </label>
          <button
            className="btn"
            onClick={runGeminiInpaint}
            disabled={isGenerating}
            style={{ marginTop: '4px' }}
          >
            {isGenerating ? '생성 중...' : '🚀 Gemini AI 포즈 합성 실행'}
          </button>
          {aiStatus && (
            <span style={{ fontSize: '11px', color: aiStatus.startsWith('❌') ? '#ff6b6b' : '#3ddc84', marginTop: '4px' }}>
              {aiStatus}
            </span>
          )}
        </div>
        <div className="panel-title">저장 / 내보내기</div>
        <button className="btn" onClick={() => downloadUrl('pose-guide.png', guideUrl)}>
          가이드 이미지 저장 (PNG)
        </button>
        <button className="btn ghost" onClick={savePose}>
          포즈 저장 (JSON)
        </button>
        <label className="btn ghost" style={{ textAlign: 'center', cursor: 'pointer' }}>
          포즈 불러오기
          <input type="file" accept="application/json,.json" onChange={loadPose} hidden />
        </label>
        <button className="btn ghost" onClick={() => setAngles({})}>
          모든 각도 0으로
        </button>
        <button className="btn ghost" onClick={saveScreen}>
          합성 화면 저장 (PNG)
        </button>

        <div className="panel-title">이미지 파츠 직접 조작</div>
        <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>
          버튼을 누른 뒤 왼쪽 그림에서 파츠 둘레를 따라 드래그(올가미)하세요. 놓으면 그 영역이 파츠가 됩니다.
        </div>
        <button className={selectMode ? 'btn' : 'btn ghost'} onClick={() => setSelectMode(!selectMode)}>
          {selectMode ? '선택 중… (취소하려면 다시 클릭)' : '✂ 이미지 영역 선택'}
        </button>
        {partMsg && <span style={{ fontSize: 11, color: '#3ddc84' }}>{partMsg}</span>}

        <AssetPanel
          assets={assets}
          setAssets={setAssets}
          selectedId={selAsset}
          setSelectedId={setSelAsset}
        />

        <div className="panel-title">파츠 폭 (각도 0일 때 윤곽이 안 보이게)</div>
        <label>
          팔 폭 ({armHW * 2}px)
          <input
            type="range"
            min={10}
            max={100}
            value={armHW}
            onChange={(e) => setArmHW(Number(e.target.value))}
          />
        </label>
        <label>
          다리 폭 ({legHW * 2}px)
          <input
            type="range"
            min={10}
            max={120}
            value={legHW}
            onChange={(e) => setLegHW(Number(e.target.value))}
          />
        </label>

        <div className="panel-title">관절 각도 (+ 반시계 방향)</div>
        {CHAINS.map((ch) => (
          <div key={ch.key} className="limb-group">
            <strong>{ch.label}</strong>
            <label>
              {ch.upLabel} ({angles[ch.key + '_up'] ?? 0}°)
              <input
                type="range"
                min={-180}
                max={180}
                value={angles[ch.key + '_up'] ?? 0}
                onChange={(e) => setAngle(ch.key + '_up', Number(e.target.value))}
              />
            </label>
            <label>
              {ch.loLabel} ({angles[ch.key + '_lo'] ?? 0}°)
              <input
                type="range"
                min={-180}
                max={180}
                value={angles[ch.key + '_lo'] ?? 0}
                onChange={(e) => setAngle(ch.key + '_lo', Number(e.target.value))}
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}
