// Skela 메시 변형 체험 페이지의 로직. 계산은 앱과 같은 src/meshSkin.ts를 그대로 사용한다(복사하지 않음).
import * as THREE from 'three'
import {
  buildSkin, deformSkin, makeBody, makeLimits, projectPose, partColors,
  limbRest, solveIK, flipBendAngles, footAngleFor, posedTipPos,
} from '../../src/meshSkin'
import type { RestChain } from '../../src/meshSkin'
import { buildSkin as buildLegacy, deformSkin as deformLegacy } from './legacy/meshSkinLegacy'

type P = { x: number; y: number }
type Data = Record<string, { w: number; h: number; img: string; points: { id: number; x: number; y: number }[] }>
const DATA: Data = JSON.parse(document.getElementById('skela-data')!.textContent!)

const CHAINS = [
  { key: 'armR', ids: [12, 14, 16], tipId: 20, kind: 'arm', color: '#e63946', label: '오른팔' },
  { key: 'armL', ids: [11, 13, 15], tipId: 19, kind: 'arm', color: '#1d6fe0', label: '왼팔' },
  { key: 'legR', ids: [24, 26, 28], tipId: 32, kind: 'leg', color: '#2a9d3f', label: '오른다리' },
  { key: 'legL', ids: [23, 25, 27], tipId: 31, kind: 'leg', color: '#f08a00', label: '왼다리' },
] as const
const ARM_HW = 30
const LEG_HW = 40
const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
const toRad = (d: number) => (d * Math.PI) / 180
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

type Angles = Record<string, number>
type Backend = {
  rest: Float32Array
  uv: Float32Array
  index: Uint32Array
  deform: (a: Angles, o: Float32Array, i: Uint32Array) => { folds: number; maxStretch: number; over: number; drawCount: number }
  project?: (prev: Angles, cand: Angles, pin?: string) => Angles
  colors?: Float32Array
}

let who = 'girl'
let algo: 'fixed' | 'legacy' = 'fixed'
let angles: Angles = {}
let showParts = false
let W = 0
let H = 0
let rest: Record<number, P> = {}
let backend: Backend
let geom: THREE.BufferGeometry
let tex: THREE.Texture
let mesh: THREE.Mesh
let paint: THREE.Mesh

const stage = $('stage')
const gl = $('gl') as HTMLCanvasElement
const ov = $('ov') as HTMLCanvasElement
const octx = ov.getContext('2d')!
const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, alpha: false, preserveDrawingBuffer: true })
const scene = new THREE.Scene()
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
cam.position.z = 5

const w2 = (p: P): P => ({ x: p.x - W / 2, y: H / 2 - p.y })
const restOf = (ch: (typeof CHAINS)[number]) => limbRest(w2(rest[ch.ids[0]]), w2(rest[ch.ids[1]]), w2(rest[ch.ids[2]]))
const tip0 = (ch: (typeof CHAINS)[number]) => w2(rest[ch.tipId])

// 현재 자세의 관절 위치(세계 좌표). 어깨 이동, 위/아래 각도 반영
function posed(ch: (typeof CHAINS)[number]) {
  const a0 = w2(rest[ch.ids[0]])
  const m0 = w2(rest[ch.ids[1]])
  const e0 = w2(rest[ch.ids[2]])
  const up = angles[ch.key + '_up'] ?? 0
  const lo = angles[ch.key + '_lo'] ?? 0
  const ft = angles[ch.key + '_ft'] ?? 0
  const a = { x: a0.x + (angles[ch.key + '_dx'] ?? 0), y: a0.y + (angles[ch.key + '_dy'] ?? 0) }
  const rot = (v: P, d: number): P => ({
    x: v.x * Math.cos(toRad(d)) - v.y * Math.sin(toRad(d)),
    y: v.x * Math.sin(toRad(d)) + v.y * Math.cos(toRad(d)),
  })
  const vm = rot({ x: m0.x - a0.x, y: m0.y - a0.y }, up)
  const m = { x: a.x + vm.x, y: a.y + vm.y }
  const ve = rot({ x: e0.x - m0.x, y: e0.y - m0.y }, up + lo)
  const e = { x: m.x + ve.x, y: m.y + ve.y }
  return { a, m, e, tip: posedTipPos(e0, tip0(ch), e, up + lo + ft) }
}

/* ───── 메시 구성 ───── */
function chainsRest(): RestChain[] {
  return CHAINS.map((c) => ({
    key: c.key,
    a: w2(rest[c.ids[0]]),
    m: w2(rest[c.ids[1]]),
    e: w2(rest[c.ids[2]]),
    hw: c.kind === 'arm' ? ARM_HW : LEG_HW,
    ext: c.kind === 'arm' ? 45 : 40,
    tip: w2(rest[c.tipId]),
    hwEnd: c.kind === 'arm' ? ARM_HW * 1.2 : LEG_HW * 1.5,
  }))
}
function makeBackend(): Backend {
  const chains = chainsRest()
  if (algo === 'legacy') {
    // 수정 전: 머리·몸통 보호 없음, 손/발 뼈 없음, 4배 넘게 늘어난 삼각형은 숨김
    const sk = buildLegacy(chains, W, H)
    return {
      rest: sk.rest, uv: sk.uv, index: sk.index,
      deform: (a, o, i) => { const r = deformLegacy(sk, a, o, i); return { folds: r.folds, maxStretch: r.maxStretch, over: r.hidden, drawCount: r.drawCount } },
    }
  }
  const body = makeBody((id) => w2(rest[id]))
  const sk = buildSkin(chains, W, H, 12, body)
  const lim = makeLimits((id) => w2(rest[id]))
  return {
    project: (prev, cand, pin) => projectPose(sk, chains, lim, prev, cand, pin),
    rest: sk.rest, uv: sk.uv, index: sk.index,
    colors: partColors(sk),
    deform: (a, o, i) => { const r = deformSkin(sk, a, o, i); return { folds: r.folds, maxStretch: r.maxStretch, over: r.overLimit, drawCount: r.drawCount } },
  }
}
function rebuild() {
  backend = makeBackend()
  geom?.dispose()
  geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(backend.rest), 3))
  geom.setAttribute('uv', new THREE.BufferAttribute(backend.uv, 2))
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(backend.index), 1))
  if (backend.colors) geom.setAttribute('color', new THREE.BufferAttribute(backend.colors, 4))
  mesh.geometry = geom
  paint.geometry = geom
  paint.visible = showParts && !!backend.colors
  update()
}
function loadCharacter(name: string) {
  who = name
  const d = DATA[name]
  W = d.w
  H = d.h
  rest = {}
  for (const p of d.points) rest[p.id] = { x: p.x, y: p.y }
  angles = {}
  const img = new Image()
  img.onload = () => {
    tex?.dispose()
    tex = new THREE.Texture(img)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    ;(mesh.material as THREE.MeshBasicMaterial).map = tex
    ;(mesh.material as THREE.MeshBasicMaterial).needsUpdate = true
    cam.left = -W / 2
    cam.right = W / 2
    cam.top = H / 2
    cam.bottom = -H / 2
    cam.updateProjectionMatrix()
    resize()
    rebuild()
  }
  img.src = d.img
}

/* ───── 그리기 ───── */
const fmt = (n: number, d = 0) => n.toFixed(d)
function update() {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const idx = geom.getIndex()!
  const t0 = performance.now()
  const r = backend.deform(angles, pos.array as Float32Array, idx.array as Uint32Array)
  const ms = performance.now() - t0
  idx.needsUpdate = true
  pos.needsUpdate = true
  geom.setDrawRange(0, r.drawCount)
  geom.computeBoundingSphere()
  renderer.render(scene, cam)
  drawOverlay()
  $('s-folds').textContent = String(r.folds)
  $('s-stretch').textContent = '×' + fmt(r.maxStretch, 2)
  $('s-hidden').textContent = String(r.over)
  $('l-hidden').textContent = algo === 'legacy' ? '숨긴 삼각형' : '한도(팔 ×7 / 다리 ×5) 넘게 늘어난 삼각형'
  $('s-ms').textContent = fmt(ms, 1) + ' ms'
}
function drawOverlay() {
  const k = ov.width / W
  octx.clearRect(0, 0, ov.width, ov.height)
  if (capturing) return
  const X = (p: P) => (p.x + W / 2) * k
  const Y = (p: P) => (H / 2 - p.y) * k
  const R = Math.max(7, 11 * (ov.width / 700))
  octx.lineWidth = Math.max(1.5, R / 5)
  for (const ch of CHAINS) {
    const s = posed(ch)
    octx.strokeStyle = 'rgba(255,255,255,.92)'
    octx.shadowColor = 'rgba(0,0,0,.55)'
    octx.shadowBlur = 3
    octx.beginPath()
    octx.moveTo(X(s.a), Y(s.a))
    octx.lineTo(X(s.m), Y(s.m))
    octx.lineTo(X(s.e), Y(s.e))
    octx.lineTo(X(s.tip), Y(s.tip))
    octx.stroke()
    octx.shadowBlur = 0
    ;([[s.a, '#ffd23f'], [s.m, '#ffffff'], [s.e, ch.color], [s.tip, '#c77dff']] as [P, string][]).forEach(([p, c], i) => {
      const on = active && active.key === ch.key && active.part === i
      octx.beginPath()
      octx.arc(X(p), Y(p), (on ? 1.35 : 1) * (i === 3 ? R * 0.75 : R), 0, Math.PI * 2)
      octx.fillStyle = c
      octx.fill()
      octx.strokeStyle = 'rgba(0,0,0,.65)'
      octx.stroke()
    })
  }
}
function resize() {
  if (!W) return
  const cssW = stage.clientWidth
  const cssH = Math.round((cssW * H) / W)
  stage.style.height = cssH + 'px'
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  renderer.setPixelRatio(dpr)
  renderer.setSize(cssW, cssH, false)
  ov.width = Math.round(cssW * dpr)
  ov.height = Math.round(cssH * dpr)
  gl.style.width = ov.style.width = cssW + 'px'
  gl.style.height = ov.style.height = cssH + 'px'
  if (geom) update()
}

/* ───── 직접 드래그 ───── */
let capturing = false
let active: { key: string; part: 0 | 1 | 2 | 3; sign: number; flipFirst: boolean; offX: number; offY: number } | null = null
const r1 = (v: number) => Math.round(v * 10) / 10
function toWorld(e: PointerEvent): P {
  const r = ov.getBoundingClientRect()
  return { x: ((e.clientX - r.left) / r.width) * W - W / 2, y: H / 2 - ((e.clientY - r.top) / r.height) * H }
}
ov.addEventListener('pointerdown', (e) => {
  const q = toWorld(e)
  const reach = Math.max(18, W / 26)
  let best: { key: string; part: 0 | 1 | 2 | 3; d: number; p: P } | null = null
  for (const ch of CHAINS) {
    const s = posed(ch)
    ;([[3, s.tip], [2, s.e], [1, s.m], [0, s.a]] as [0 | 1 | 2 | 3, P][]).forEach(([part, p]) => {
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d < reach && (!best || d < best.d)) best = { key: ch.key, part, d, p }
    })
  }
  if (!best) return
  const b = best as { key: string; part: 0 | 1 | 2 | 3; d: number; p: P }
  const ch = CHAINS.find((c) => c.key === b.key)!
  const r = restOf(ch)
  const s0 = Math.sin(r.th2 - r.th1 + toRad(angles[b.key + '_lo'] ?? 0))
  let sign = s0 > 0.05 ? 1 : s0 < -0.05 ? -1 : angles[b.key + '_bs'] || 0
  const shift = e.shiftKey && b.part === 2 // Shift: 굽힘 방향 반대(ㄴ ↔ ㄱ)
  if (shift && sign !== 0) sign = -sign
  active = { key: b.key, part: b.part, sign, flipFirst: shift && sign === 0, offX: b.p.x - q.x, offY: b.p.y - q.y }
  ov.setPointerCapture(e.pointerId)
  update()
})
ov.addEventListener('pointermove', (e) => {
  if (!active) return
  const q = toWorld(e)
  const t = { x: q.x + active.offX, y: q.y + active.offY }
  const ch = CHAINS.find((c) => c.key === active!.key)!
  const r = restOf(ch)
  const cand = { ...angles }
  if (active.part === 0) {
    cand[ch.key + '_dx'] = r1(t.x - r.a.x)
    cand[ch.key + '_dy'] = r1(t.y - r.a.y)
  } else if (active.part === 3) {
    const E = posed(ch).e
    cand[ch.key + '_ft'] = r1(footAngleFor(w2(rest[ch.ids[2]]), tip0(ch), E, t, angles[ch.key + '_up'] ?? 0, angles[ch.key + '_lo'] ?? 0))
  } else {
    const rel = { x: t.x - (angles[ch.key + '_dx'] ?? 0), y: t.y - (angles[ch.key + '_dy'] ?? 0) }
    if (active.part === 2) {
      let res = solveIK(r, rel, angles[ch.key + '_up'] ?? 0, active.sign)
      if (active.flipFirst) res = solveIK(r, rel, angles[ch.key + '_up'] ?? 0, -res.sign)
      active.sign = res.sign
      cand[ch.key + '_up'] = r1(res.up)
      cand[ch.key + '_lo'] = r1(res.lo)
      cand[ch.key + '_bs'] = res.sign
    } else {
      cand[ch.key + '_up'] = r1(norm(((Math.atan2(rel.y - r.a.y, rel.x - r.a.x) - r.th1) * 180) / Math.PI))
    }
  }
  angles = backend.project ? backend.project(angles, cand, ch.key) : cand
  update()
})
const endDrag = () => {
  active = null
  update()
}
ov.addEventListener('pointerup', endDrag)
ov.addEventListener('pointercancel', endDrag)

/* ───── 버튼 ───── */
function flip(key: string) {
  const ch = CHAINS.find((c) => c.key === key)!
  const s = posed(ch)
  const rel = { x: s.e.x - (angles[key + '_dx'] ?? 0), y: s.e.y - (angles[key + '_dy'] ?? 0) }
  const cand = flipBendAngles(restOf(ch), rel, angles, key)
  angles = backend.project ? backend.project(angles, cand, key) : cand
  update()
}
function ikTo(key: string, target: P) {
  const ch = CHAINS.find((c) => c.key === key)!
  const res = solveIK(restOf(ch), target, 0, 0)
  angles[key + '_up'] = r1(res.up)
  angles[key + '_lo'] = r1(res.lo)
}
function preset(name: string) {
  angles = {}
  const e = w2(rest[14])
  const wr = w2(rest[16])
  const an = w2(rest[28])
  const L = Math.hypot(wr.x - e.x, wr.y - e.y)
  if (name === 'arm') ikTo('armR', { x: e.x, y: e.y + L })
  if (name === 'leg') ikTo('legR', { x: an.x - 130, y: an.y + 150 })
  if (name === 'extreme') ikTo('armR', { x: W * 0.12, y: H / 2 - H * 0.2 })
  if (name === 'cross') ikTo('legR', { x: an.x + 140, y: an.y + 40 })
  if (name === 'hand') { ikTo('armR', { x: e.x, y: e.y + L }); angles['armR_ft'] = 50 }
  if (name === 'foot') { ikTo('legR', { x: an.x - 20, y: an.y + 60 }); angles['legR_ft'] = -40 }
  if (backend.project) angles = backend.project({}, angles)
  update()
}
function seg(group: string, value: string, on: (v: string) => void) {
  const root = $(group)
  root.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.v === value))
    b.addEventListener('click', () => {
      root.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)))
      on(b.dataset.v!)
    })
  })
}
seg('who', who, (v) => loadCharacter(v))
seg('algo', algo, (v) => {
  algo = v as 'fixed' | 'legacy'
  rebuild()
})
$('reset').addEventListener('click', () => {
  angles = {}
  update()
})
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => preset(b.dataset.preset!)))
document.querySelectorAll<HTMLButtonElement>('[data-flip]').forEach((b) => b.addEventListener('click', () => flip(b.dataset.flip!)))
$<HTMLInputElement>('parts').addEventListener('change', (e) => {
  showParts = (e.target as HTMLInputElement).checked
  paint.visible = showParts && !!backend.colors
  $('legend-parts').hidden = !showParts
  update()
})

/* 테스트용 훅 (자동 검증에서만 사용) */
;(window as unknown as Record<string, unknown>).__skela = {
  set: (a: Angles) => { angles = backend.project ? backend.project({}, a) : a; update() },
  raw: (a: Angles) => { angles = a; update() },
  get: () => ({ ...angles }),
  algo: (v: string) => { algo = v as 'fixed' | 'legacy'; rebuild() },
  who: (v: string) => loadCharacter(v),
  flip: (k: string) => flip(k),
  parts: (on: boolean) => { showParts = on; paint.visible = on && !!backend.colors; update() },
  capture: (on: boolean) => { capturing = on; update() },
}

/* ───── 시작 ───── */
mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }))
mesh.frustumCulled = false
paint = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }))
paint.frustumCulled = false
paint.visible = false
paint.position.z = 0.02
scene.add(mesh, paint)
renderer.setClearColor(0xffffff, 1)
new ResizeObserver(resize).observe(stage)
loadCharacter(who)
