// Skela 메시 변형 체험 페이지의 로직. 계산은 앱과 같은 src/meshSkin.ts를 그대로 사용한다(복사하지 않음).
import * as THREE from 'three'
import {
  buildSkin, deformSkin, makeBody, makeLimits, projectPose, partColors,
  limbRest, solveIK, flipBendAngles, footAngleFor, posedTipPos, foregroundMask,
} from '../../src/meshSkin'
import type { RestChain, ForegroundMask } from '../../src/meshSkin'
import { defaultSkeleton } from '../../src/defaultSkeleton'
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
let editMode = false // 골격 맞추기: 기준 자세의 관절 점을 직접 옮기는 모드
let editId: number | null = null
let outlineAware = true // 윤곽 인식(가장자리 번짐 줄이기) 켜기/끄기
let fgMask: ForegroundMask | null = null
let W = 0
let H = 0
let rest: Record<number, P> = {}
let backend: Backend
let geom: THREE.BufferGeometry
let tex: THREE.Texture
let mesh: THREE.Mesh
let paint: THREE.Mesh

/* ───── 파츠: 영역을 오려 뼈에 붙이기 ───── */
type Part = { id: number; name: string; poly: P[]; canvas: HTMLCanvasElement; cx: number; cy: number; anchor: string; mesh: THREE.Mesh }
let parts: Part[] = []
let baseImg: HTMLImageElement | null = null
let texCanvas: HTMLCanvasElement | null = null
let selectMode = false
let lasso: P[] = []
let partSeq = 0

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
  const sk = buildSkin(chains, W, H, 12, body, outlineAware ? fgMask : null)
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
  // 수정 전(비교용)은 원래 그대로 양면 그리기, 수정 후는 접혀 뒤집힌 삼각형(뒷면)을 그리지 않음
  const mat = mesh.material as THREE.MeshBasicMaterial
  mat.side = algo === 'legacy' ? THREE.DoubleSide : THREE.FrontSide
  mat.needsUpdate = true
  paint.geometry = geom
  paint.visible = showParts && !!backend.colors
  update()
}
function loadCharacter(name: string) {
  setSelect(false)
  who = name
  const d = DATA[name]
  W = d.w
  H = d.h
  rest = {}
  for (const p of d.points) rest[p.id] = { x: p.x, y: p.y }
  angles = {}
  const img = new Image()
  img.onload = () => {
    // 윤곽 인식용 전경 마스크: 이미지를 W×H로 그려서 가장자리에서 이어진 배경을 구분
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const cx = cv.getContext('2d')!
    cx.drawImage(img, 0, 0, W, H)
    fgMask = foregroundMask(cx.getImageData(0, 0, W, H).data, W, H)
    baseImg = img
    clearParts()
    refreshTex()
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
  parts.forEach(placePart)
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
  if (selectMode) { drawLasso(); return }
  if (editMode) { drawEdit(); return }
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
function drawEdit() {
  const k = ov.width / W
  const R = Math.max(7, 11 * (ov.width / 700))
  octx.lineWidth = Math.max(1.5, R / 5)
  const line = (ids: number[]) => {
    octx.beginPath()
    ids.forEach((id, i) => { const p = rest[id]; if (!p) return; i ? octx.lineTo(p.x * k, p.y * k) : octx.moveTo(p.x * k, p.y * k) })
    octx.strokeStyle = 'rgba(255,255,255,.92)'
    octx.shadowColor = 'rgba(0,0,0,.55)'
    octx.shadowBlur = 3
    octx.stroke()
    octx.shadowBlur = 0
  }
  ;[[12, 14, 16, 20], [11, 13, 15, 19], [24, 26, 28, 32], [23, 25, 27, 31], [11, 12], [23, 24]].forEach(line)
  for (const id of Object.keys(rest).map(Number)) {
    const p = rest[id]
    octx.beginPath()
    octx.arc(p.x * k, p.y * k, (editId === id ? 1.35 : 1) * R, 0, Math.PI * 2)
    octx.fillStyle = id === 0 ? '#ffffff' : [19, 20, 31, 32].includes(id) ? '#c77dff' : [11, 12].includes(id) ? '#ffd23f' : id % 2 ? '#1d6fe0' : '#e63946'
    octx.fill()
    octx.strokeStyle = 'rgba(0,0,0,.65)'
    octx.stroke()
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
const toImg = (e: PointerEvent): P => {
  const q = toWorld(e)
  return { x: Math.min(W - 2, Math.max(2, q.x + W / 2)), y: Math.min(H - 2, Math.max(2, H / 2 - q.y)) }
}
ov.addEventListener('pointerdown', (e) => {
  if (selectMode) {
    lasso = [toImg(e)]
    ov.setPointerCapture(e.pointerId)
    drawOverlay()
    return
  }
  if (editMode) {
    const q = toImg(e)
    let best: number | null = null
    let bd = Math.max(18, W / 26)
    for (const id of Object.keys(rest).map(Number)) {
      const d = Math.hypot(rest[id].x - q.x, rest[id].y - q.y)
      if (d < bd) { bd = d; best = id }
    }
    if (best === null) return
    editId = best
    ov.setPointerCapture(e.pointerId)
    drawOverlay()
    return
  }
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
  if (selectMode) {
    if (lasso.length) { lasso.push(toImg(e)); drawOverlay() }
    return
  }
  if (editMode) {
    if (editId === null) return
    const q = toImg(e)
    rest[editId] = { x: r1(q.x), y: r1(q.y) }
    drawOverlay()
    return
  }
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
  if (selectMode) {
    const poly = lasso
    lasso = []
    if (poly.length > 2) addPart(poly)
    drawOverlay()
    return
  }
  if (editMode) {
    if (editId !== null) { editId = null; angles = {}; rebuild() } // 점을 놓으면 메시를 새 골격으로 다시 만든다
    return
  }
  active = null
  update()
}
ov.addEventListener('pointerup', endDrag)
ov.addEventListener('pointercancel', endDrag)

function polyArea(poly: P[]) {
  return Math.abs(poly.reduce((a, q, i) => { const n = poly[(i + 1) % poly.length]; return a + (q.x * n.y - n.x * q.y) }, 0) / 2)
}
function tracePoly(c: CanvasRenderingContext2D, poly: P[], ox = 0, oy = 0) {
  c.beginPath()
  poly.forEach((q, i) => (i ? c.lineTo(q.x - ox, q.y - oy) : c.moveTo(q.x - ox, q.y - oy)))
  c.closePath()
}
// 메시 텍스처: 원본에서 파츠로 오려낸 자리를 투명하게 비운다 (배경색으로 채우면 그 덩어리가 팔다리와 함께 끌려간다)
function refreshTex() {
  if (!baseImg) return
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d')!
  x.drawImage(baseImg, 0, 0, W, H)
  x.globalCompositeOperation = 'destination-out'
  x.lineWidth = 3
  for (const p of parts) { tracePoly(x, p.poly); x.fill(); x.stroke() }
  texCanvas = c
  tex?.dispose()
  tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = mesh.material as THREE.MeshBasicMaterial
  mat.map = tex
  mat.needsUpdate = true
}
function clearParts() {
  for (const p of parts) { scene.remove(p.mesh); p.mesh.geometry.dispose(); ;((p.mesh.material as THREE.MeshBasicMaterial).map as THREE.Texture).dispose() }
  parts = []
  renderPartsUI()
}
// 붙일 수 있는 뼈: 팔은 윗팔/아래팔/손, 다리는 허벅지/종아리/발
const SEG_NAME: Record<string, Record<string, string>> = {
  arm: { up: '윗팔', lo: '아래팔', end: '손' },
  leg: { up: '허벅지', lo: '종아리', end: '발' },
}
function anchorOptions() {
  const o = [{ v: 'fixed', label: '고정 (몸통)' }]
  for (const ch of CHAINS) for (const sg of ['up', 'lo', 'end']) o.push({ v: ch.key + ':' + sg, label: ch.label + ' ' + SEG_NAME[ch.kind][sg] })
  return o
}
function segPts(ch: (typeof CHAINS)[number], sg: string) {
  const r = [w2(rest[ch.ids[0]]), w2(rest[ch.ids[1]]), w2(rest[ch.ids[2]]), tip0(ch)]
  const s = posed(ch)
  const q = [s.a, s.m, s.e, s.tip]
  const [i, j] = sg === 'up' ? [0, 1] : sg === 'lo' ? [1, 2] : [2, 3]
  return { r0: r[i], r1: r[j], q0: q[i], q1: q[j] }
}
const distSeg = (p: P, a: P, b: P) => {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
// 가장 가까운 뼈에 자동으로 붙인다. 어느 뼈와도 멀면 고정
function autoAnchor(c: P) {
  let best = 'fixed'
  let bd = Math.max(70, W * 0.1)
  for (const ch of CHAINS) for (const sg of ['up', 'lo', 'end']) {
    const g = segPts(ch, sg)
    const d = distSeg(c, g.r0, g.r1)
    if (d < bd) { bd = d; best = ch.key + ':' + sg }
  }
  return best
}
// 파츠를 붙은 뼈의 움직임(회전+이동)대로 통째로 옮긴다
function placePart(pt: Part) {
  const c = w2({ x: pt.cx, y: pt.cy })
  if (pt.anchor === 'fixed') { pt.mesh.position.set(c.x, c.y, 0.01); pt.mesh.rotation.z = 0; return }
  const [key, sg] = pt.anchor.split(':')
  const g = segPts(CHAINS.find((x) => x.key === key)!, sg)
  const th = Math.atan2(g.q1.y - g.q0.y, g.q1.x - g.q0.x) - Math.atan2(g.r1.y - g.r0.y, g.r1.x - g.r0.x)
  const dx = c.x - g.r0.x, dy = c.y - g.r0.y
  pt.mesh.position.set(g.q0.x + dx * Math.cos(th) - dy * Math.sin(th), g.q0.y + dx * Math.sin(th) + dy * Math.cos(th), 0.01)
  pt.mesh.rotation.z = th
}
function addPart(poly: P[]) {
  if (!texCanvas) return
  if (polyArea(poly) < 100) { $('part-msg').textContent = '영역이 너무 작아요. 파츠 둘레를 따라 크게 그려주세요.'; return }
  const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y)
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)))
  const x1 = Math.min(W, Math.ceil(Math.max(...xs))), y1 = Math.min(H, Math.ceil(Math.max(...ys)))
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0)
  const cv = document.createElement('canvas')
  cv.width = bw
  cv.height = bh
  const cx2 = cv.getContext('2d')!
  tracePoly(cx2, poly, x0, y0)
  cx2.clip()
  cx2.drawImage(texCanvas, -x0, -y0, W, H) // 이미 오려낸 파츠가 있으면 그 자리는 제외된 이미지에서 오림
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }))
  m.frustumCulled = false
  scene.add(m)
  const cx = x0 + bw / 2, cy = y0 + bh / 2
  const anchor = autoAnchor(w2({ x: cx, y: cy }))
  parts.push({ id: ++partSeq, name: '파츠 ' + partSeq, poly, canvas: cv, cx, cy, anchor, mesh: m })
  refreshTex()
  renderPartsUI()
  $('part-msg').textContent = '✅ 파츠를 만들었어요. 가까운 뼈에 자동으로 붙였습니다. 아래에서 바꿀 수 있어요.'
  setSelect(false)
  update()
}
function renderPartsUI() {
  const box = document.getElementById('parts-list')
  if (!box) return
  box.textContent = ''
  for (const p of parts) {
    const row = document.createElement('div')
    row.className = 'part-row'
    const nm = document.createElement('span')
    nm.textContent = p.name
    const sel = document.createElement('select')
    sel.setAttribute('aria-label', p.name + ' 붙일 뼈')
    for (const o of anchorOptions()) { const op = document.createElement('option'); op.value = o.v; op.textContent = o.label; sel.appendChild(op) }
    sel.value = p.anchor
    sel.addEventListener('change', () => { p.anchor = sel.value; update() })
    const del = document.createElement('button')
    del.className = 'btn'
    del.textContent = '삭제'
    del.addEventListener('click', () => {
      scene.remove(p.mesh)
      p.mesh.geometry.dispose()
      parts = parts.filter((q) => q !== p)
      refreshTex()
      renderPartsUI()
      update()
    })
    row.append(nm, sel, del)
    box.appendChild(row)
  }
}
function setSelect(on: boolean) {
  selectMode = on
  lasso = []
  if (on) {
    if (editMode) setEdit(false)
    angles = {} // 올가미는 원래 자세의 그림 위에서만 맞다
    $('part-msg').textContent = '그림 위에서 파츠 둘레를 따라 드래그하세요. 손을 떼면 그 영역이 파츠가 됩니다.'
    update()
  }
  const b = document.getElementById('sel-btn')
  if (b) {
    b.textContent = on ? '선택 중… (취소하려면 다시 클릭)' : '✂ 이미지 영역 선택'
    b.classList.toggle('primary', !on)
  }
  ov.style.cursor = on ? 'crosshair' : 'grab'
  if (W) drawOverlay()
}
function drawLasso() {
  if (lasso.length < 2) return
  const k = ov.width / W
  octx.beginPath()
  lasso.forEach((q, i) => (i ? octx.lineTo(q.x * k, q.y * k) : octx.moveTo(q.x * k, q.y * k)))
  octx.closePath()
  octx.fillStyle = 'rgba(91,61,245,.18)'
  octx.fill()
  octx.lineWidth = Math.max(2, ov.width / 300)
  octx.setLineDash([8, 6])
  octx.strokeStyle = '#5b3df5'
  octx.stroke()
  octx.setLineDash([])
}
document.getElementById('sel-btn')?.addEventListener('click', () => setSelect(!selectMode))

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
function setEdit(on: boolean) {
  if (on && selectMode) setSelect(false)
  editMode = on
  editId = null
  $<HTMLInputElement>('edit').checked = on
  document.body.classList.toggle('editing', on)
  angles = {}
  if (on) drawOverlay()
  else rebuild()
}
$<HTMLInputElement>('edit').addEventListener('change', (e) => setEdit((e.target as HTMLInputElement).checked))
$('reset-skel').addEventListener('click', () => {
  const d = DATA[who]
  d.points = defaultSkeleton(d.w, d.h).map((j) => ({ id: j.id, x: j.x, y: j.y }))
  rest = {}
  for (const p of d.points) rest[p.id] = { x: p.x, y: p.y }
  angles = {}
  rebuild()
})
// 내 이미지 올리기: 가장 긴 변을 900px 이하로 줄이고, 앱의 기본 골격 위치로 시작한 뒤 점을 직접 옮겨 맞춘다
$<HTMLInputElement>('upload').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const url = URL.createObjectURL(f)
  const im = new Image()
  im.onload = () => {
    const sc = Math.min(1, 900 / Math.max(im.naturalWidth, im.naturalHeight))
    const w = Math.round(im.naturalWidth * sc)
    const h = Math.round(im.naturalHeight * sc)
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    cv.getContext('2d')!.drawImage(im, 0, 0, w, h)
    URL.revokeObjectURL(url)
    DATA.custom = { w, h, img: cv.toDataURL('image/png'), points: defaultSkeleton(w, h).map((j) => ({ id: j.id, x: j.x, y: j.y })) }
    document.querySelectorAll<HTMLButtonElement>('#who button').forEach((b) => b.setAttribute('aria-pressed', 'false'))
    loadCharacter('custom')
    setEdit(true)
  }
  im.src = url
})
$('reset').addEventListener('click', () => {
  angles = {}
  update()
})
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => preset(b.dataset.preset!)))
document.querySelectorAll<HTMLButtonElement>('[data-flip]').forEach((b) => b.addEventListener('click', () => flip(b.dataset.flip!)))
$<HTMLInputElement>('outline').addEventListener('change', (e) => {
  outlineAware = (e.target as HTMLInputElement).checked
  rebuild()
})
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
  outline: (on: boolean) => { outlineAware = on; rebuild() },
  parts: (on: boolean) => { showParts = on; paint.visible = on && !!backend.colors; update() },
  capture: (on: boolean) => { capturing = on; update() },
}

/* ───── 시작 ───── */
mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ side: THREE.FrontSide, toneMapped: false, transparent: true, depthWrite: false })) // 접혀 뒤집힌 삼각형(뒷면)은 그리지 않음
mesh.frustumCulled = false
paint = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.FrontSide, toneMapped: false }))
paint.frustumCulled = false
paint.visible = false
paint.position.z = 0.02
scene.add(mesh, paint)
renderer.setClearColor(0xffffff, 1)
new ResizeObserver(resize).observe(stage)
loadCharacter(who)
