import { getApiKey, setStoredApiKey, generateInpaintWithGemini } from './gemini'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { AssetLayer, AssetPanel } from './Assets'
import type { AssetItem } from './Assets'

type Pt = { id: number; name: string; x: number; y: number }
type P = { x: number; y: number }
type Props = {
  img: HTMLImageElement
  width: number
  height: number
  pts: Pt[]
  onPtsLoad: (pts: Pt[]) => void
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
function cutPart(img: HTMLImageElement, W: number, H: number, poly: P[]) {
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

function buildRig(
  img: HTMLImageElement,
  W: number,
  H: number,
  pts: Pt[],
  armHW: number,
  legHW: number,
) {
  const get = (id: number) => pts.find((p) => p.id === id)!
  // 이미지 좌표(y 아래로) → Three 좌표(y 위로, 중앙이 원점)
  const w2 = (p: P) => ({ x: p.x - W / 2, y: H / 2 - p.y })

  const base = document.createElement('canvas')
  base.width = W
  base.height = H
  const bctx = base.getContext('2d')!
  bctx.drawImage(img, 0, 0, W, H)
  const [r, g, b] = bctx.getImageData(2, 2, 1, 1).data
  const bg = `rgb(${r},${g},${b})`

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
    const up = cutPart(img, W, H, upPoly)
    const lo = cutPart(img, W, H, loPoly)
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

  return { base, bg, limbs }
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
    const vm = rot({ x: m.x - a.x, y: m.y - a.y }, up)
    const m2 = { x: a.x + vm.x, y: a.y + vm.y }
    const ve = rot({ x: e.x - m.x, y: e.y - m.y }, up + lo)
    const e2 = { x: m2.x + ve.x, y: m2.y + ve.y }
    return { key: ch.key, a: toI(a), m: toI(m2), e: toI(e2) }
  })
}

// AI에게 줄 뼈대 가이드 이미지
function renderGuide(pts: Pt[], W: number, H: number, angles: Record<string, number>) {
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
}: {
  pts: Pt[]
  W: number
  H: number
  angles: Record<string, number>
  setAngles: AngleSetter
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
    ctx.drawImage(renderGuide(pts, W, H, angles), 0, 0)
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
  }, [pts, W, H, angles, posed, active])

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
    const target = { x: x - W / 2, y: H / 2 - y }
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

function Limb({ data, upDeg, loDeg }: { data: LimbData; upDeg: number; loDeg: number }) {
  const upTex = useMemo(() => mkTex(data.up.canvas), [data])
  const loTex = useMemo(() => mkTex(data.lo.canvas), [data])

  return (
    <group position={[data.pivotA.x, data.pivotA.y, 0.1]} rotation={[0, 0, toRad(upDeg)]}>
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

function FitCamera({ w, h }: { w: number; h: number }) {
  const { camera, size } = useThree()
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera
    cam.zoom = Math.min(size.width / w, size.height / h)
    cam.updateProjectionMatrix()
  }, [camera, size, w, h])
  return null
}

/* ───────────── 메인 화면 ───────────── */

export default function RigView({ img, width, height, pts, onPtsLoad }: Props) {
  const [armHW, setArmHW] = useState(30)
  const [legHW, setLegHW] = useState(40)
  const [angles, setAngles] = useState<Record<string, number>>({})
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [selAsset, setSelAsset] = useState<number | null>(null)
  const glEl = useRef<HTMLCanvasElement | null>(null)

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

      const guideCanvas = renderGuide(pts, width, height, angles)

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

  const rig = useMemo(
    () => buildRig(img, width, height, pts, armHW, legHW),
    [img, width, height, pts, armHW, legHW],
  )
  const baseTex = useMemo(() => mkTex(rig.base), [rig])

  const guideUrl = useMemo(
    () => renderGuide(pts, width, height, angles).toDataURL('image/png'),
    [pts, width, height, angles],
  )

  const setAngle = (k: string, v: number) => setAngles((prev) => ({ ...prev, [k]: v }))

  function updateAsset(id: number, p: Partial<AssetItem>) {
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, ...p } : a)))
  }

  function saveScreen() {
    const c = glEl.current
    if (!c) return
    downloadUrl('skela-composite.png', c.toDataURL('image/png'))
  }

  function savePose() {
    const data = {
      version: 1,
      canvas: { w: width, h: height },
      points: pts.map((p) => ({
        id: p.id,
        name: p.name,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
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
      } else {
        onPtsLoad(d.points)
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

            <mesh>
              <planeGeometry args={[width, height]} />
              <meshBasicMaterial map={baseTex} transparent depthWrite={false} toneMapped={false} />
            </mesh>

            {rig.limbs.map((l) => (
              <Limb
                key={l.key}
                data={l}
                upDeg={angles[l.key + '_up'] ?? 0}
                loDeg={angles[l.key + '_lo'] ?? 0}
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
        </div>
      </div>

      <div className="rig-panel">
        <div className="panel-title">자세 잡기 (손목·발목·팔꿈치·무릎 점을 끌어보세요)</div>
        <GuideEditor
          pts={pts}
          W={width}
          H={height}
          angles={angles}
          setAngles={setAngles}
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
