// Skela 메시 변형 체험 페이지의 로직. 앱의 src/meshSkin.ts, src/experimental/meshSkinMulti.ts를 그대로 사용한다.
import * as THREE from 'three'
import { buildSkin, deformSkin } from '../../src/meshSkin'
import type { DeformStats, RestChain } from '../../src/meshSkin'
import { buildSkinMulti, deformSkinMulti } from '../../src/experimental/meshSkinMulti'

type P = { x: number; y: number }
type Data = Record<string, { w: number; h: number; img: string; points: { id: number; x: number; y: number }[] }>
const DATA: Data = JSON.parse(document.getElementById('skela-data')!.textContent!)

const CHAINS = [
  { key: 'armR', ids: [12, 14, 16], kind: 'arm', color: '#e63946' },
  { key: 'armL', ids: [11, 13, 15], kind: 'arm', color: '#1d6fe0' },
  { key: 'legR', ids: [24, 26, 28], kind: 'leg', color: '#2a9d3f' },
  { key: 'legL', ids: [23, 25, 27], kind: 'leg', color: '#f08a00' },
] as const
const ARM_HW = 30
const LEG_HW = 40
const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
const toRad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

type Angles = Record<string, number>
type Backend = {
  rest: Float32Array
  uv: Float32Array
  index: Uint32Array
  deform: (a: Angles, o: Float32Array, i: Uint32Array) => DeformStats & { drawCount: number }
}

let who = 'girl'
let algo: 'basic' | 'multi' = 'basic'
let angles: Angles = {}
let showMesh = false
let W = 0
let H = 0
let rest: Record<number, P> = {}
let backend: Backend
let geom: THREE.BufferGeometry
let tex: THREE.Texture
let mesh: THREE.Mesh
let wire: THREE.Mesh

const stage = $('stage')
const gl = $('gl') as HTMLCanvasElement
const ov = $('ov') as HTMLCanvasElement
const octx = ov.getContext('2d')!
const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, alpha: false, preserveDrawingBuffer: true })
const scene = new THREE.Scene()
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
cam.position.z = 5

/* ───── 수학 (RigView의 chainRest / solveIK / posedChains와 같은 규약) ───── */
const w2 = (p: P): P => ({ x: p.x - W / 2, y: H / 2 - p.y })
function chainRest(ids: readonly number[]) {
  const a = w2(rest[ids[0]])
  const m = w2(rest[ids[1]])
  const e = w2(rest[ids[2]])
  return {
    a,
    L1: Math.hypot(m.x - a.x, m.y - a.y),
    L2: Math.hypot(e.x - m.x, e.y - m.y),
    th1: Math.atan2(m.y - a.y, m.x - a.x),
    th2: Math.atan2(e.y - m.y, e.x - m.x),
  }
}
function solveIK(r: ReturnType<typeof chainRest>, target: P, curUp: number, sign: number) {
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
  const phi2 = Math.atan2(a.y + dist * Math.sin(beta) - my, a.x + dist * Math.cos(beta) - mx)
  const up = norm(deg(phi1 - th1))
  return { up, lo: norm(deg(phi2 - th2) - up), sign: s }
}
// 현재 자세의 관절 위치(세계 좌표)
function posed(ch: (typeof CHAINS)[number]) {
  const a0 = w2(rest[ch.ids[0]])
  const m0 = w2(rest[ch.ids[1]])
  const e0 = w2(rest[ch.ids[2]])
  const up = angles[ch.key + '_up'] ?? 0
  const lo = angles[ch.key + '_lo'] ?? 0
  const a = { x: a0.x + (angles[ch.key + '_dx'] ?? 0), y: a0.y + (angles[ch.key + '_dy'] ?? 0) }
  const rot = (v: P, d: number): P => ({
    x: v.x * Math.cos(toRad(d)) - v.y * Math.sin(toRad(d)),
    y: v.x * Math.sin(toRad(d)) + v.y * Math.cos(toRad(d)),
  })
  const vm = rot({ x: m0.x - a0.x, y: m0.y - a0.y }, up)
  const m = { x: a.x + vm.x, y: a.y + vm.y }
  const ve = rot({ x: e0.x - m0.x, y: e0.y - m0.y }, up + lo)
  return { a, m, e: { x: m.x + ve.x, y: m.y + ve.y } }
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
  }))
}
function makeBackend(): Backend {
  const chains = chainsRest()
  if (algo === 'multi') {
    const lerp = (a: P, b: P, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    const sh = lerp(w2(rest[11]), w2(rest[12]), 0.5)
    const hp = lerp(w2(rest[23]), w2(rest[24]), 0.5)
    const nose = w2(rest[0])
    const sk = buildSkinMulti(
      chains,
      [
        { a: lerp(sh, hp, 0.15), b: lerp(sh, hp, 0.85) },
        { a: lerp(sh, nose, 0.3), b: lerp(sh, nose, 1.4) },
        { a: lerp(w2(rest[23]), w2(rest[24]), 0.3), b: lerp(w2(rest[23]), w2(rest[24]), 0.7) },
      ],
      W,
      H,
    )
    return { rest: sk.rest, uv: sk.uv, index: sk.index, deform: (a, o, i) => deformSkinMulti(sk, a, o, i) }
  }
  const sk = buildSkin(chains, W, H)
  return { rest: sk.rest, uv: sk.uv, index: sk.index, deform: (a, o, i) => deformSkin(sk, a, o, i) }
}
function rebuild() {
  backend = makeBackend()
  geom?.dispose()
  geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(backend.rest), 3))
  geom.setAttribute('uv', new THREE.BufferAttribute(backend.uv, 2))
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(backend.index), 1))
  mesh.geometry = geom
  wire.geometry = geom
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
  $('s-hidden').textContent = String(r.hidden)
  $('s-ms').textContent = fmt(ms, 1) + ' ms'
}
function drawOverlay() {
  const k = ov.width / W
  octx.clearRect(0, 0, ov.width, ov.height)
  const X = (p: P) => (p.x + W / 2) * k
  const Y = (p: P) => (H / 2 - p.y) * k
  const R = Math.max(7, 11 * (ov.width / 700))
  octx.lineWidth = Math.max(1.5, R / 5)
  for (const ch of CHAINS) {
    const { a, m, e } = posed(ch)
    octx.strokeStyle = 'rgba(255,255,255,.92)'
    octx.shadowColor = 'rgba(0,0,0,.55)'
    octx.shadowBlur = 3
    octx.beginPath()
    octx.moveTo(X(a), Y(a))
    octx.lineTo(X(m), Y(m))
    octx.lineTo(X(e), Y(e))
    octx.stroke()
    octx.shadowBlur = 0
    ;([[a, '#ffd23f'], [m, '#ffffff'], [e, ch.color]] as [P, string][]).forEach(([p, c], i) => {
      const on = active && active.key === ch.key && active.part === i
      octx.beginPath()
      octx.arc(X(p), Y(p), on ? R * 1.35 : R, 0, Math.PI * 2)
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
let active: { key: string; part: 0 | 1 | 2; sign: number; offX: number; offY: number } | null = null
const r1 = (v: number) => Math.round(v * 10) / 10
function toWorld(e: PointerEvent): P {
  const r = ov.getBoundingClientRect()
  return { x: ((e.clientX - r.left) / r.width) * W - W / 2, y: H / 2 - ((e.clientY - r.top) / r.height) * H }
}
ov.addEventListener('pointerdown', (e) => {
  const q = toWorld(e)
  const reach = Math.max(18, W / 26)
  let best: { key: string; part: 0 | 1 | 2; d: number; p: P } | null = null
  for (const ch of CHAINS) {
    const s = posed(ch)
    ;([[2, s.e], [1, s.m], [0, s.a]] as [0 | 1 | 2, P][]).forEach(([part, p]) => {
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d < reach && (!best || d < best.d)) best = { key: ch.key, part, d, p }
    })
  }
  if (!best) return
  const b = best as { key: string; part: 0 | 1 | 2; d: number; p: P }
  const ch = CHAINS.find((c) => c.key === b.key)!
  const r = chainRest(ch.ids)
  const s0 = Math.sin(r.th2 - r.th1 + toRad(angles[b.key + '_lo'] ?? 0))
  active = { key: b.key, part: b.part, sign: s0 > 0.05 ? 1 : s0 < -0.05 ? -1 : 0, offX: b.p.x - q.x, offY: b.p.y - q.y }
  ov.setPointerCapture(e.pointerId)
  update()
})
ov.addEventListener('pointermove', (e) => {
  if (!active) {
    ov.style.cursor = 'default'
    return
  }
  const q = toWorld(e)
  const t = { x: q.x + active.offX, y: q.y + active.offY }
  const ch = CHAINS.find((c) => c.key === active!.key)!
  const r = chainRest(ch.ids)
  if (active.part === 0) {
    angles[ch.key + '_dx'] = r1(t.x - r.a.x)
    angles[ch.key + '_dy'] = r1(t.y - r.a.y)
  } else {
    const rel = { x: t.x - (angles[ch.key + '_dx'] ?? 0), y: t.y - (angles[ch.key + '_dy'] ?? 0) }
    if (active.part === 2) {
      const res = solveIK(r, rel, angles[ch.key + '_up'] ?? 0, active.sign)
      active.sign = res.sign
      angles[ch.key + '_up'] = r1(res.up)
      angles[ch.key + '_lo'] = r1(res.lo)
    } else {
      angles[ch.key + '_up'] = r1(norm(deg(Math.atan2(rel.y - r.a.y, rel.x - r.a.x) - r.th1)))
    }
  }
  update()
})
const endDrag = () => {
  active = null
  update()
}
ov.addEventListener('pointerup', endDrag)
ov.addEventListener('pointercancel', endDrag)

/* ───── 버튼 ───── */
function ikTo(key: string, target: P) {
  const ch = CHAINS.find((c) => c.key === key)!
  const r = chainRest(ch.ids)
  const res = solveIK(r, target, 0, 0)
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
  algo = v as 'basic' | 'multi'
  rebuild()
})
$('reset').addEventListener('click', () => {
  angles = {}
  update()
})
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => preset(b.dataset.preset!)))
$<HTMLInputElement>('wire').addEventListener('change', (e) => {
  showMesh = (e.target as HTMLInputElement).checked
  wire.visible = showMesh
  update()
})

/* ───── 시작 ───── */
mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }))
mesh.frustumCulled = false
wire = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x6d4aff, wireframe: true, transparent: true, opacity: 0.35, toneMapped: false }))
wire.frustumCulled = false
wire.visible = false
wire.position.z = 0.1
scene.add(mesh, wire)
renderer.setClearColor(0xffffff, 1)
new ResizeObserver(resize).observe(stage)
loadCharacter(who)
