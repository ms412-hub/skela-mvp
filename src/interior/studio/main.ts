// Skela Room: 유니티 같은 편집 흐름을 일반인용으로 단순하게 만든 웹 인테리어 편집기
//
// 유니티 개념 → 여기서 쓰는 것
//   Scene 뷰         → three.js + OrbitControls (3D), 직교 카메라 (평면)
//   이동/회전 기즈모  → TransformControls (W/E), 가구를 직접 끌기
//   Hierarchy        → 왼쪽 "방 구성"
//   Inspector        → 오른쪽 "속성"
//   Prefab           → 가구 목록 (catalog.ts, 상자 조합)
//   Undo             → undoManager (평면도 객체 참조만 쌓음)
//   Play 모드        → 걷기 보기
//   씬 저장          → 평면도 JSON (toPlanFile/fromPlanFile)
// 계산 규칙은 모두 Plan.ts / geometry.ts에 있고 이 파일은 화면만 맡는다.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { createHistory } from '../../undoManager.ts'
import type { Furniture, Opening, Plan, Vec, Wall } from '../Plan.ts'
import * as P from '../Plan.ts'
import { CATALOG, furnitureType } from '../catalog.ts'
import { buildBoxes } from '../geometry.ts'
import { TEMPLATES, findTemplate } from '../templates.ts'
import './studio.css'

type Sel = { kind: 'furniture' | 'wall' | 'opening'; id: string } | null
type Tool = 'select' | 'wall' | 'door' | 'window'
type View = 'plan' | '3d' | 'walk'

const STORE_KEY = 'skela-room-plan'
const GRID = 10 // 벽 그리기 격자 (cm)
const MOVE_SNAP = 5 // 가구 이동 격자 (cm)
const EYE = 160 // 걷기 눈높이 (cm)
const coarse = matchMedia('(pointer: coarse)').matches

/* ───── 상태 ───── */
function loadSaved(): Plan | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? P.fromPlanFile(JSON.parse(raw)) : null
  } catch { return null }
}
let plan: Plan = loadSaved() ?? TEMPLATES[0].build()
const hist = createHistory<Plan>(plan)
let sel: Sel = null
let tool: Tool = 'select'
let view: View = '3d'
let gizmoMode: 'translate' | 'rotate' = 'translate'
let gizmoOn = !coarse
let wallStart: Vec | null = null // 벽 그리기 중인 시작점

function commit(next: Plan) {
  if (!hist.commit(next)) return
  plan = next
  if (sel && !findSel(sel)) sel = null
  changed()
}
function changed() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(P.toPlanFile(plan))) } catch { /* 저장소를 못 쓰면 그냥 넘어간다 */ }
  rebuild()
  renderPanels()
}
function undo() { const p = hist.undo(); if (p) { plan = p; if (sel && !findSel(sel)) sel = null; changed() } }
function redo() { const p = hist.redo(); if (p) { plan = p; if (sel && !findSel(sel)) sel = null; changed() } }
function findSel(s: NonNullable<Sel>): Furniture | Wall | Opening | undefined {
  if (s.kind === 'furniture') return plan.furniture.find((f) => f.id === s.id)
  if (s.kind === 'wall') return plan.walls.find((w) => w.id === s.id)
  return plan.openings.find((o) => o.id === s.id)
}
function select(s: Sel) { sel = s; applyHighlight(); attachGizmo(); renderPanels() }

/* ───── 화면 뼈대 ───── */
const root = document.getElementById('room-app') as HTMLElement
root.innerHTML = `
<div class="rs">
  <header class="rs-top">
    <div class="rs-brand">Skela Room <small>방을 그리고 3D로 꾸며보세요</small></div>
    <div class="rs-seg" role="group" aria-label="보기">
      <button data-view="plan">평면</button><button data-view="3d">3D</button><button data-view="walk">걷기</button>
    </div>
    <div class="rs-group">
      <button class="rs-btn" id="rs-undo" title="되돌리기 (Ctrl+Z)">↶ 되돌리기</button>
      <button class="rs-btn" id="rs-redo" title="다시 하기 (Ctrl+Y)">↷</button>
    </div>
    <div class="rs-spacer"></div>
    <div class="rs-group">
      <label for="rs-template" class="rs-note">새로 시작</label>
      <select id="rs-template">
        <option value="">템플릿 고르기</option>
        ${TEMPLATES.map((t) => `<option value="${t.id}">${t.name} · ${t.desc}</option>`).join('')}
      </select>
      <button class="rs-btn" id="rs-file">저장 · 불러오기</button>
    </div>
  </header>
  <aside class="rs-left">
    <section class="rs-sec"><h2>가구 넣기</h2><div class="rs-cat" id="rs-cat"></div></section>
    <section class="rs-sec"><h2>방 구성</h2><ul class="rs-tree" id="rs-tree"></ul></section>
  </aside>
  <main class="rs-view" id="rs-view">
    <div class="rs-tools" id="rs-tools">
      <button data-tool="select">선택 · 이동 <kbd>V</kbd></button>
      <button data-tool="wall">벽 그리기 <kbd>L</kbd></button>
      <button data-tool="door">문 넣기 <kbd>O</kbd></button>
      <button data-tool="window">창문 넣기 <kbd>N</kbd></button>
      <hr />
      <button data-gizmo="translate">화살표: 이동 <kbd>W</kbd></button>
      <button data-gizmo="rotate">화살표: 회전 <kbd>E</kbd></button>
    </div>
    <div class="rs-corner"><button class="rs-btn" id="rs-fit" title="방 전체 보기 (F)">전체 보기</button></div>
    <div class="rs-pad" id="rs-pad" hidden>
      <button class="up" data-move="f" aria-label="앞으로">▲</button>
      <button class="lt" data-move="l" aria-label="왼쪽">◀</button>
      <button class="dn" data-move="b" aria-label="뒤로">▼</button>
      <button class="rt" data-move="r" aria-label="오른쪽">▶</button>
    </div>
    <div class="rs-measure" id="rs-measure" hidden></div>
    <div class="rs-hint" id="rs-hint"></div>
  </main>
  <aside class="rs-right" id="rs-right"></aside>
</div>`
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const viewEl = $('rs-view')
const hintEl = $('rs-hint')
const measureEl = $('rs-measure')
const padEl = $('rs-pad')

let toastTimer = 0
function toast(msg: string) {
  viewEl.querySelector('.rs-toast')?.remove()
  const t = document.createElement('div')
  t.className = 'rs-toast'
  t.textContent = msg
  viewEl.appendChild(t)
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => t.remove(), 2600)
}

/* ───── three.js 장면 ───── */
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
viewEl.prepend(renderer.domElement)
const scene = new THREE.Scene()
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888888'
function applyTheme() { scene.background = new THREE.Color(cssVar('--viewport')) }
applyTheme()
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.6))
const sun = new THREE.DirectionalLight(0xffffff, 1.7)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.bias = -0.0005
scene.add(sun, sun.target)

const persp = new THREE.PerspectiveCamera(50, 1, 5, 30000)
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000)
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = persp

const orbit3d = new OrbitControls(persp, renderer.domElement)
orbit3d.enableDamping = true
orbit3d.maxPolarAngle = Math.PI * 0.49
orbit3d.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
const orbitPlan = new OrbitControls(ortho, renderer.domElement)
orbitPlan.enableRotate = false
orbitPlan.screenSpacePanning = true
orbitPlan.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
orbitPlan.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }
orbitPlan.enabled = false

const gizmo = new TransformControls(persp, renderer.domElement)
gizmo.setTranslationSnap(MOVE_SNAP)
gizmo.setRotationSnap(THREE.MathUtils.degToRad(15))
gizmo.setSize(0.8)
scene.add(gizmo.getHelper())
gizmo.addEventListener('dragging-changed', (e) => {
  const dragging = (e as unknown as { value: boolean }).value
  activeOrbit().enabled = !dragging
  if (!dragging) commitGizmo()
})

const world = new THREE.Group()
scene.add(world)
const furnGroups = new Map<string, THREE.Group>()
type Ref = { kind: 'furniture' | 'wall' | 'opening' | 'floor'; id: string }
type WallFade = { mesh: THREE.Mesh; px: number; pz: number; nx: number; nz: number; inside: number }
let wallFades: WallFade[] = []
let wallSolids: { cx: number; cz: number; hw: number; hd: number; c: number; s: number }[] = []

function disposeWorld() {
  world.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose() }
  })
  world.clear()
  furnGroups.clear()
}

function rebuild() {
  if (gizmo.object) gizmo.detach()
  disposeWorld()
  wallFades = []
  wallSolids = []
  const b = P.planBounds(plan)
  const cx = (b.x0 + b.x1) / 2, cz = (b.y0 + b.y1) / 2
  for (const box of buildBoxes(plan)) {
    const mat = new THREE.MeshStandardMaterial({ color: box.color, roughness: box.kind === 'floor' ? 0.85 : 0.7 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.w, box.h, box.d), mat)
    mesh.castShadow = box.kind !== 'floor'
    mesh.receiveShadow = true
    if (box.kind === 'furniture') {
      const fid = box.id.split(':')[0]
      const f = plan.furniture.find((q) => q.id === fid)
      if (!f) continue
      let g = furnGroups.get(fid)
      if (!g) {
        g = new THREE.Group()
        g.position.set(f.x, 0, f.y)
        g.rotation.y = -THREE.MathUtils.degToRad(f.rot)
        g.userData.ref = { kind: 'furniture', id: fid } satisfies Ref
        furnGroups.set(fid, g)
        world.add(g)
      }
      // 상자 위치는 평면도 좌표로 계산돼 있으니 가구 기준(회전 전)으로 되돌린다
      const r = THREE.MathUtils.degToRad(f.rot), c = Math.cos(r), s = Math.sin(r)
      const dx = box.cx - f.x, dz = box.cz - f.y
      mesh.position.set(c * dx + s * dz, box.cy, -s * dx + c * dz)
      mesh.userData.ref = { kind: 'furniture', id: fid } satisfies Ref
      g.add(mesh)
      continue
    }
    mesh.position.set(box.cx, box.cy, box.cz)
    mesh.rotation.y = -THREE.MathUtils.degToRad(box.rotDeg)
    if (box.kind === 'floor') {
      mesh.userData.ref = { kind: 'floor', id: 'floor' } satisfies Ref
    } else {
      const parts = box.id.split(':')
      const isOp = parts.length > 2
      mesh.userData.ref = (isOp ? { kind: 'opening', id: parts[1] } : { kind: 'wall', id: parts[0] }) satisfies Ref
      mat.transparent = true
      const a = THREE.MathUtils.degToRad(box.rotDeg)
      const nx = -Math.sin(a), nz = Math.cos(a)
      wallFades.push({ mesh, px: box.cx, pz: box.cz, nx, nz, inside: Math.sign((cx - box.cx) * nx + (cz - box.cz) * nz) || 1 })
      if (box.cy - box.h / 2 < 100) wallSolids.push({ cx: box.cx, cz: box.cz, hw: box.w / 2, hd: box.d / 2, c: Math.cos(a), s: Math.sin(a) })
    }
    world.add(mesh)
  }
  // 문짝과 창문 유리 (보기용, 계산 규칙에는 없음)
  for (const o of plan.openings) {
    const w = plan.walls.find((q) => q.id === o.wallId)
    if (!w) continue
    const len = P.wallLength(w)
    const ux = (w.b.x - w.a.x) / len, uy = (w.b.y - w.a.y) / len
    const px = w.a.x + ux * o.t * len, pz = w.a.y + uy * o.t * len
    const door = o.kind === 'door'
    const mat = door
      ? new THREE.MeshStandardMaterial({ color: '#9b7a55', roughness: 0.6 })
      : new THREE.MeshStandardMaterial({ color: '#9cc6dd', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.35 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.width - 4, o.height - 2, door ? 4 : 1.5), mat)
    mesh.position.set(px, o.sill + o.height / 2, pz)
    mesh.rotation.y = -Math.atan2(uy, ux)
    mesh.userData.ref = { kind: 'opening', id: o.id } satisfies Ref
    world.add(mesh)
  }
  // 그림자 범위를 방 크기에 맞춘다
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0, 300)
  sun.position.set(cx - size * 0.4, size * 1.2, cz - size * 0.7)
  sun.target.position.set(cx, 0, cz)
  const sc = sun.shadow.camera
  sc.left = sc.bottom = -size * 0.8
  sc.right = sc.top = size * 0.8
  sc.near = 10
  sc.far = size * 4
  sc.updateProjectionMatrix()
  grid.position.set(cx, 0.5, cz)
  applyHighlight()
  attachGizmo()
}

const grid = new THREE.GridHelper(4000, 80, 0x7a857f, 0x9aa39e)
;(grid.material as THREE.Material).transparent = true
;(grid.material as THREE.Material).opacity = 0.35
scene.add(grid)

function applyHighlight() {
  const accent = new THREE.Color(cssVar('--accent'))
  world.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const ref = m.userData.ref as Ref | undefined
    const on = !!sel && !!ref && ref.kind === sel.kind && ref.id === sel.id
    const mat = m.material as THREE.MeshStandardMaterial
    mat.emissive = on ? accent : new THREE.Color(0x000000)
    mat.emissiveIntensity = on ? 0.45 : 0
  })
}

function attachGizmo() {
  const g = sel?.kind === 'furniture' ? furnGroups.get(sel.id) : undefined
  if (!g || !gizmoOn || view === 'walk') { if (gizmo.object) gizmo.detach(); return }
  gizmo.camera = camera
  gizmo.setMode(gizmoMode)
  gizmo.showX = gizmo.showZ = gizmoMode === 'translate'
  gizmo.showY = gizmoMode === 'rotate'
  gizmo.attach(g)
}

function commitGizmo() {
  if (sel?.kind !== 'furniture') return
  const g = furnGroups.get(sel.id)
  if (!g) return
  const rot = normDeg(Math.round(-THREE.MathUtils.radToDeg(g.rotation.y)))
  commit(P.updateFurniture(plan, sel.id, { x: Math.round(g.position.x), y: Math.round(g.position.z), rot }))
}
const normDeg = (d: number) => ((d % 360) + 360) % 360

/* ───── 카메라와 보기 ───── */
const activeOrbit = () => (view === 'plan' ? orbitPlan : orbit3d)
function resize() {
  const w = viewEl.clientWidth, h = viewEl.clientHeight
  if (!w || !h) return
  renderer.setSize(w, h, false)
  persp.aspect = w / h
  persp.updateProjectionMatrix()
  const halfH = (ortho.top - ortho.bottom) / 2 || 400
  ortho.left = -halfH * (w / h); ortho.right = halfH * (w / h)
  ortho.updateProjectionMatrix()
}
new ResizeObserver(resize).observe(viewEl)

function fit() {
  const b = P.planBounds(plan)
  const cx = (b.x0 + b.x1) / 2, cz = (b.y0 + b.y1) / 2
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0, 300)
  const w = viewEl.clientWidth || 800, h = viewEl.clientHeight || 600
  if (view === 'plan') {
    const halfH = Math.max((b.y1 - b.y0) * 0.6, ((b.x1 - b.x0) * 0.6) / (w / h), 200)
    ortho.top = halfH; ortho.bottom = -halfH
    ortho.left = -halfH * (w / h); ortho.right = halfH * (w / h)
    ortho.zoom = 1
    ortho.position.set(cx, 2000, cz)
    ortho.up.set(0, 0, -1)
    ortho.lookAt(cx, 0, cz)
    ortho.updateProjectionMatrix()
    orbitPlan.target.set(cx, 0, cz)
    orbitPlan.update()
  } else if (view === '3d') {
    persp.position.set(cx + size * 0.15, size * 0.95, cz + size * 1.05)
    orbit3d.target.set(cx, 60, cz)
    orbit3d.update()
  }
}

let yaw = 0, pitch = 0
function setView(v: View) {
  if (v === view) return
  view = v
  orbit3d.enabled = v === '3d'
  orbitPlan.enabled = v === 'plan'
  camera = v === 'plan' ? ortho : persp
  grid.visible = v !== 'walk'
  sun.castShadow = v !== 'plan' // 위에서 볼 때 그림자는 도면을 헷갈리게 한다
  padEl.hidden = v !== 'walk'
  if (v === 'walk') {
    if (tool !== 'select') setTool('select')
    const b = P.planBounds(plan)
    const start = findWalkStart()
    persp.position.set(start.x, EYE, start.y)
    // 방 가운데를 바라보며 시작
    yaw = Math.atan2(-((b.x0 + b.x1) / 2 - start.x), -((b.y0 + b.y1) / 2 - start.y))
    pitch = -0.08
    applyLook()
    for (const f of wallFades) (f.mesh.material as THREE.MeshStandardMaterial).opacity = 1
  } else {
    fit()
  }
  attachGizmo()
  renderPanels()
}
function applyLook() { persp.rotation.set(pitch, yaw, 0, 'YXZ') }

// 걷기 시작 위치: 문 안쪽, 없으면 방 가운데
function findWalkStart(): Vec {
  const b = P.planBounds(plan)
  const center = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }
  const door = plan.openings.find((o) => o.kind === 'door')
  const w = door && plan.walls.find((q) => q.id === door.wallId)
  if (door && w) {
    const len = P.wallLength(w)
    const p = { x: w.a.x + (w.b.x - w.a.x) * door.t, y: w.a.y + (w.b.y - w.a.y) * door.t }
    const nx = -(w.b.y - w.a.y) / len, ny = (w.b.x - w.a.x) / len
    const side = Math.sign((center.x - p.x) * nx + (center.y - p.y) * ny) || 1
    return { x: p.x + nx * side * 70, y: p.y + ny * side * 70 }
  }
  return center
}

function blocked(x: number, z: number): boolean {
  const R = 22
  for (const w of wallSolids) {
    const dx = x - w.cx, dz = z - w.cz
    const lx = w.c * dx + w.s * dz, lz = -w.s * dx + w.c * dz
    if (Math.abs(lx) < w.hw + R && Math.abs(lz) < w.hd + R) return true
  }
  return false
}

/* ───── 입력: 고르기, 끌기, 그리기 ───── */
const ray = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
function setRay(e: PointerEvent | MouseEvent) {
  const r = renderer.domElement.getBoundingClientRect()
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  ray.setFromCamera(ndc, camera)
}
function pick(e: PointerEvent): Ref | null {
  setRay(e)
  const hits = ray.intersectObjects(world.children, true)
  for (const h of hits) {
    const ref = h.object.userData.ref as Ref | undefined
    if (!ref) continue
    // 3D 보기에서 반투명해진 앞쪽 벽은 건너뛰고 뒤를 고른다
    const mat = (h.object as THREE.Mesh).material as THREE.MeshStandardMaterial
    if (ref.kind !== 'furniture' && mat.transparent && mat.opacity < 0.5) continue
    return ref
  }
  return null
}
function groundPoint(e: PointerEvent | MouseEvent): Vec | null {
  setRay(e)
  const v = new THREE.Vector3()
  return ray.ray.intersectPlane(ground, v) ? { x: v.x, y: v.z } : null
}

// 벽 그리기 점: 기존 벽 끝점에 붙고, 거의 수평·수직이면 곧게 맞춘다
function wallSnap(p: Vec): Vec {
  for (const w of plan.walls) for (const q of [w.a, w.b]) if (P.dist(p, q) < 25) return { ...q }
  let s = P.snapVec(p, GRID)
  if (wallStart) {
    const dx = s.x - wallStart.x, dy = s.y - wallStart.y
    if (Math.abs(dy) < Math.abs(dx) * 0.14) s = { x: s.x, y: wallStart.y }
    else if (Math.abs(dx) < Math.abs(dy) * 0.14) s = { x: wallStart.x, y: s.y }
  }
  return s
}

const preview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x2c6b58, transparent: true, opacity: 0.45, depthWrite: false }))
preview.visible = false
scene.add(preview)
const dot = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 2, 20), new THREE.MeshBasicMaterial({ color: 0x2c6b58 }))
dot.visible = false
scene.add(dot)
function showWallPreview(p: Vec | null, e?: PointerEvent) {
  const col = new THREE.Color(cssVar('--accent'))
  ;(preview.material as THREE.MeshBasicMaterial).color = col
  ;(dot.material as THREE.MeshBasicMaterial).color = col
  if (!p) { preview.visible = dot.visible = false; measureEl.hidden = true; return }
  dot.visible = true
  dot.position.set(p.x, 1, p.y)
  if (!wallStart) { preview.visible = false; measureEl.hidden = true; return }
  const len = P.dist(wallStart, p)
  preview.visible = len > 1
  preview.scale.set(Math.max(len, 1), P.WALL_HEIGHT, P.WALL_THICKNESS)
  preview.position.set((wallStart.x + p.x) / 2, P.WALL_HEIGHT / 2, (wallStart.y + p.y) / 2)
  preview.rotation.y = -Math.atan2(p.y - wallStart.y, p.x - wallStart.x)
  if (e) {
    const r = viewEl.getBoundingClientRect()
    measureEl.hidden = false
    measureEl.style.left = `${e.clientX - r.left}px`
    measureEl.style.top = `${e.clientY - r.top}px`
    measureEl.textContent = `${Math.round(len)} cm`
  }
}

let down: { x: number; y: number; id: number } | null = null
let drag: { id: string; ox: number; oy: number; moved: boolean } | null = null
let look: { x: number; y: number } | null = null

// 캡처 단계에서 먼저 받아서, 가구를 잡으면 카메라 조작이 시작되지 않게 막는다
viewEl.addEventListener('pointerdown', (e) => {
  if (e.target !== renderer.domElement) return
  down = { x: e.clientX, y: e.clientY, id: e.pointerId }
  if (view === 'walk') { look = { x: e.clientX, y: e.clientY }; renderer.domElement.setPointerCapture(e.pointerId); return }
  if (tool !== 'select' || e.button !== 0 || gizmo.axis !== null || gizmo.dragging) return
  const ref = pick(e)
  if (ref?.kind === 'furniture') {
    const f = plan.furniture.find((q) => q.id === ref.id)
    const g = groundPoint(e)
    if (!f || !g) return
    if (sel?.kind !== 'furniture' || sel.id !== f.id) select(ref as NonNullable<Sel>)
    drag = { id: f.id, ox: f.x - g.x, oy: f.y - g.y, moved: false }
    activeOrbit().enabled = false
    renderer.domElement.setPointerCapture(e.pointerId)
  }
}, { capture: true })

viewEl.addEventListener('pointermove', (e) => {
  if (view === 'walk') {
    if (look) {
      yaw -= (e.clientX - look.x) * 0.005
      pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - look.y) * 0.005))
      look = { x: e.clientX, y: e.clientY }
      applyLook()
    }
    return
  }
  if (drag) {
    const g = groundPoint(e)
    const grp = furnGroups.get(drag.id)
    if (!g || !grp) return
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3) drag.moved = true
    if (!drag.moved) return
    grp.position.x = P.snapTo(g.x + drag.ox, MOVE_SNAP)
    grp.position.z = P.snapTo(g.y + drag.oy, MOVE_SNAP)
    return
  }
  if (tool === 'wall') showWallPreview(groundPoint(e) && wallSnap(groundPoint(e) as Vec), e)
})

viewEl.addEventListener('pointerup', (e) => {
  const wasClick = !!down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6
  down = null
  look = null
  if (drag) {
    const d = drag
    drag = null
    activeOrbit().enabled = view !== 'walk'
    const grp = furnGroups.get(d.id)
    if (d.moved && grp) commit(P.updateFurniture(plan, d.id, { x: Math.round(grp.position.x), y: Math.round(grp.position.z) }))
    return
  }
  if (!wasClick || e.target !== renderer.domElement || view === 'walk' || gizmo.dragging) return
  onClick(e)
})

function onClick(e: PointerEvent) {
  if (tool === 'wall') {
    const g = groundPoint(e)
    if (!g) return
    const p = wallSnap(g)
    if (!wallStart) { wallStart = p; showWallPreview(p, e); renderHint(); return }
    if (P.dist(wallStart, p) < P.MIN_WALL) { endWall(); return } // 같은 곳을 다시 누르면 끝
    const next = P.addWall(plan, wallStart, p)
    commit(next)
    const closed = plan.walls.some((w) => w !== next.walls[next.walls.length - 1] && (P.dist(w.a, p) < 1 || P.dist(w.b, p) < 1))
    wallStart = closed ? null : p
    if (closed) { toast('벽이 이어졌어요. 다른 곳을 눌러 새 벽을 시작할 수 있어요.'); showWallPreview(null) }
    renderHint()
    return
  }
  if (tool === 'door' || tool === 'window') {
    const g = groundPoint(e)
    if (!g) return
    const near = P.nearestWall(plan, g, 60)
    if (!near) { toast('벽 가까이를 눌러주세요.'); return }
    const next = P.addOpening(plan, near.wall.id, near.t, tool)
    if (next === plan) { toast('다른 문·창문과 겹쳐서 넣을 수 없어요.'); return }
    commit(next)
    select({ kind: 'opening', id: next.openings[next.openings.length - 1].id })
    return
  }
  const ref = pick(e)
  select(ref && ref.kind !== 'floor' ? (ref as NonNullable<Sel>) : null)
}

function endWall() { wallStart = null; showWallPreview(null); renderHint() }

function setTool(t: Tool) {
  tool = t
  if (t !== 'wall') endWall()
  if (t !== 'select') select(null)
  renderHint()
  viewEl.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)))
}

function renderHint() {
  const hints: Record<Tool, string> = {
    select: view === 'plan'
      ? '가구를 눌러 고르고 끌어서 옮겨요. 빈 곳을 끌면 화면이 움직여요.'
      : '가구를 끌어 옮기고, 빈 곳을 끌면 화면이 돌아가요. 오른쪽 버튼이나 두 손가락으로 이동해요.',
    wall: wallStart ? '다음 점을 눌러 벽을 만들어요. 같은 점을 다시 누르거나 Esc로 끝내요.' : '바닥을 눌러 벽 시작점을 찍어요. 평면 보기에서 그리면 더 쉬워요.',
    door: '문을 넣을 벽을 눌러요.',
    window: '창문을 넣을 벽을 눌러요.',
  }
  hintEl.textContent = view === 'walk' ? '화면을 끌어 둘러보고, W A S D 키나 화살표 버튼으로 걸어요.' : hints[tool]
}

/* ───── 걷기 ───── */
const keys = new Set<string>()
const padHeld = new Set<string>()
padEl.addEventListener('pointerdown', (e) => {
  const m = (e.target as HTMLElement).closest<HTMLElement>('[data-move]')?.dataset.move
  if (m) { padHeld.add(m); (e.target as HTMLElement).setPointerCapture(e.pointerId) }
})
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) padEl.addEventListener(ev, (e) => {
  const m = (e.target as HTMLElement).closest<HTMLElement>('[data-move]')?.dataset.move
  if (m) padHeld.delete(m)
})
function walkStep(dt: number) {
  let f = 0, s = 0
  if (keys.has('w') || keys.has('arrowup') || padHeld.has('f')) f += 1
  if (keys.has('s') || keys.has('arrowdown') || padHeld.has('b')) f -= 1
  if (keys.has('d') || padHeld.has('r')) s += 1
  if (keys.has('a') || padHeld.has('l')) s -= 1
  if (keys.has('arrowleft')) yaw += dt * 1.8
  if (keys.has('arrowright')) yaw -= dt * 1.8
  applyLook()
  if (!f && !s) return
  const speed = 150 * dt
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw)
  const dx = (fx * f - fz * s) * speed, dz = (fz * f + fx * s) * speed
  const p = persp.position
  if (!blocked(p.x + dx, p.z)) p.x += dx
  if (!blocked(p.x, p.z + dz)) p.z += dz
}

/* ───── 패널 ───── */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
const fname = (f: Furniture) => furnitureType(f.type)?.name ?? f.type
const wallNo = (id: string) => plan.walls.findIndex((w) => w.id === id) + 1

$('rs-cat').innerHTML = CATALOG.map((t) => `<button data-add="${t.id}" title="${t.name} 넣기"><b>${t.name}</b><span>${t.w}×${t.d}</span></button>`).join('')

function renderTree() {
  const cur = (k: string, id: string) => (sel?.kind === k && sel.id === id ? 'true' : 'false')
  const furn = plan.furniture.map((f) => `<li><button data-pick="furniture:${f.id}" aria-current="${cur('furniture', f.id)}">${esc(fname(f))}<span>${f.w}×${f.d}</span></button></li>`).join('')
  const walls = plan.walls.map((w, i) => `<li><button data-pick="wall:${w.id}" aria-current="${cur('wall', w.id)}">벽 ${i + 1}<span>${Math.round(P.wallLength(w))} cm</span></button></li>`).join('')
  const ops = plan.openings.map((o) => `<li><button data-pick="opening:${o.id}" aria-current="${cur('opening', o.id)}">${o.kind === 'door' ? '문' : '창문'} · 벽 ${wallNo(o.wallId)}<span>${o.width} cm</span></button></li>`).join('')
  $('rs-tree').innerHTML =
    `<li class="grp">가구 ${plan.furniture.length}</li>${furn || '<li class="rs-note">왼쪽 위 목록에서 가구를 넣어보세요.</li>'}` +
    `<li class="grp">벽 ${plan.walls.length}</li>${walls}` +
    `<li class="grp">문 · 창문 ${plan.openings.length}</li>${ops}`
}

const num = (id: string, label: string, v: number, attrs = '') => `<div class="rs-field"><label for="${id}">${label}</label><input type="number" id="${id}" value="${Math.round(v)}" ${attrs} /></div>`

function renderInspector() {
  const el = $('rs-right')
  const cur = sel && findSel(sel)
  if (sel?.kind === 'furniture' && cur) {
    const f = cur as Furniture
    el.innerHTML = `<section class="rs-sec">
      <h2>속성</h2><p class="rs-title">${esc(fname(f))}</p><p class="rs-sub">가구 · 단위 cm</p>
      <div class="rs-fields">
        ${num('f-w', '가로', f.w, 'min="5" step="5"')}${num('f-d', '깊이', f.d, 'min="5" step="5"')}
        ${num('f-h', '높이', f.h, 'min="1" step="5"')}${num('f-rot', '회전 (°)', f.rot, 'step="15"')}
        ${num('f-x', '위치 X', f.x, 'step="5"')}${num('f-y', '위치 Y', f.y, 'step="5"')}
        <div class="rs-field wide"><label for="f-color">색</label><input type="color" id="f-color" value="${f.color}" /></div>
      </div>
      <div class="rs-row">
        <button class="rs-btn" data-act="rot90">90° 돌리기 <span class="rs-keyhelp">(R)</span></button>
        <button class="rs-btn" data-act="dup">복제</button>
        <button class="rs-btn" data-act="resetsize">기본 크기</button>
        <button class="rs-btn danger" data-act="del">삭제</button>
      </div></section>`
  } else if (sel?.kind === 'wall' && cur) {
    const w = cur as Wall
    el.innerHTML = `<section class="rs-sec">
      <h2>속성</h2><p class="rs-title">벽 ${wallNo(w.id)}</p><p class="rs-sub">벽 · 단위 cm</p>
      <div class="rs-fields">
        ${num('w-len', '길이', P.wallLength(w), 'min="20" step="10"')}${num('w-h', '높이', w.height, 'min="50" step="10"')}
        ${num('w-t', '두께', w.thickness, 'min="2" step="1"')}
      </div>
      <div class="rs-row">
        <button class="rs-btn" data-act="adddoor">문 넣기</button>
        <button class="rs-btn" data-act="addwin">창문 넣기</button>
        <button class="rs-btn danger" data-act="del">삭제</button>
      </div>
      <p class="rs-note">길이를 바꾸면 벽 끝점이 움직여요. 이어진 벽은 따라오지 않아요.</p></section>`
  } else if (sel?.kind === 'opening' && cur) {
    const o = cur as Opening
    el.innerHTML = `<section class="rs-sec">
      <h2>속성</h2><p class="rs-title">${o.kind === 'door' ? '문' : '창문'}</p><p class="rs-sub">벽 ${wallNo(o.wallId)}에 있음 · 단위 cm</p>
      <div class="rs-fields">
        ${num('o-w', '폭', o.width, 'min="30" step="10"')}${num('o-h', '높이', o.height, 'min="30" step="5"')}
        ${o.kind === 'window' ? num('o-sill', '바닥에서', o.sill, 'min="0" step="5"') : ''}
        <div class="rs-field wide"><label for="o-t">벽 위 위치</label><input type="range" id="o-t" min="0" max="1" step="0.01" value="${o.t}" /></div>
      </div>
      <div class="rs-row"><button class="rs-btn danger" data-act="del">삭제</button></div>
      <p class="rs-note">다른 문·창문과 겹치는 값은 적용되지 않아요.</p></section>`
  } else {
    const b = P.planBounds(plan)
    const m2 = ((b.x1 - b.x0) * (b.y1 - b.y0)) / 10000
    el.innerHTML = `<section class="rs-sec">
      <h2>방</h2>
      <div class="rs-fields">
        <div class="rs-field wide"><label for="p-name">이름</label><input type="text" id="p-name" value="${esc(plan.name)}" /></div>
        <div class="rs-field"><label for="p-floor">바닥색</label><input type="color" id="p-floor" value="${plan.floorColor}" /></div>
        <div class="rs-field"><label for="p-wall">벽색</label><input type="color" id="p-wall" value="${plan.wallColor}" /></div>
      </div>
      <div class="rs-stat"><span>바깥 크기</span><b>${((b.x1 - b.x0) / 100).toFixed(1)} × ${((b.y1 - b.y0) / 100).toFixed(1)} m</b></div>
      <div class="rs-stat"><span>넓이 (대략)</span><b>${m2.toFixed(1)} m² · ${(m2 / 3.3058).toFixed(1)}평</b></div>
    </section>
    <section class="rs-sec">
      <h2>사용법</h2>
      <p class="rs-note">1. <b>가구 넣기</b>에서 가구를 눌러 넣어요.<br />2. 가구를 끌어 옮기고, 오른쪽에서 크기와 색을 바꿔요.<br />3. 위에서 <b>걷기</b>를 눌러 방 안을 걸어봐요.</p>
      <div class="rs-keys rs-keyhelp">
        <kbd>W</kbd><span>화살표로 이동</span><kbd>E</kbd><span>화살표로 회전</span>
        <kbd>R</kbd><span>고른 가구 90° 돌리기</span><kbd>Del</kbd><span>고른 것 삭제</span>
        <kbd>F</kbd><span>방 전체 보기</span><kbd>Ctrl+Z</kbd><span>되돌리기</span>
      </div>
    </section>`
  }
}

function renderPanels() {
  renderTree()
  renderInspector()
  ;($('rs-undo') as HTMLButtonElement).disabled = !hist.canUndo()
  ;($('rs-redo') as HTMLButtonElement).disabled = !hist.canRedo()
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)))
  viewEl.querySelectorAll<HTMLButtonElement>('[data-gizmo]').forEach((b) => {
    b.setAttribute('aria-pressed', String(gizmoOn && b.dataset.gizmo === gizmoMode))
    b.hidden = view === 'walk'
  })
  ;($('rs-tools') as HTMLElement).hidden = view === 'walk'
  renderHint()
}

/* ───── 동작 ───── */
function addFurniture(type: string) {
  const t = furnitureType(type)
  if (!t) return
  const b = P.planBounds(plan)
  const n = plan.furniture.length
  const x = P.snapTo((b.x0 + b.x1) / 2 + ((n % 3) - 1) * 30, MOVE_SNAP), y = P.snapTo((b.y0 + b.y1) / 2 + ((n % 2) ? 30 : -30), MOVE_SNAP)
  const next = P.addFurniture(plan, type, x, y, t)
  setTool('select')
  commit(next)
  select({ kind: 'furniture', id: next.furniture[next.furniture.length - 1].id })
  toast(`${t.name}을(를) 방 가운데에 넣었어요. 끌어서 옮겨보세요.`)
}

function act(a: string) {
  if (!sel) return
  const s = sel
  if (a === 'del') {
    const next = s.kind === 'furniture' ? P.removeFurniture(plan, s.id) : s.kind === 'wall' ? P.removeWall(plan, s.id) : P.removeOpening(plan, s.id)
    sel = null
    commit(next)
    return
  }
  if (s.kind === 'furniture') {
    const f = findSel(s) as Furniture
    if (a === 'rot90') commit(P.updateFurniture(plan, f.id, { rot: normDeg(f.rot + 90) }))
    if (a === 'dup') {
      const next = P.addFurniture(plan, f.type, f.x + 30, f.y + 30, f)
      const id = next.furniture[next.furniture.length - 1].id
      commit(P.updateFurniture(next, id, { rot: f.rot }))
      select({ kind: 'furniture', id })
    }
    if (a === 'resetsize') { const t = furnitureType(f.type); if (t) commit(P.updateFurniture(plan, f.id, { w: t.w, d: t.d, h: t.h })) }
  }
  if (s.kind === 'wall' && (a === 'adddoor' || a === 'addwin')) {
    const next = P.addOpening(plan, s.id, 0.5, a === 'adddoor' ? 'door' : 'window')
    if (next === plan) { toast('벽 가운데에 이미 문이나 창문이 있어요. 문 넣기 도구로 다른 곳을 눌러주세요.'); return }
    commit(next)
    select({ kind: 'opening', id: next.openings[next.openings.length - 1].id })
  }
}

function onField(id: string, raw: string) {
  const v = Number(raw)
  const s = sel
  if (id === 'p-name') return commit({ ...plan, name: raw.trim() || '내 방' })
  if (id === 'p-floor') return commit({ ...plan, floorColor: raw })
  if (id === 'p-wall') return commit({ ...plan, wallColor: raw })
  if (!s) return
  if (s.kind === 'furniture') {
    if (id === 'f-color') return commit(P.updateFurniture(plan, s.id, { color: raw }))
    if (!Number.isFinite(v)) return renderInspector()
    const map: Record<string, Partial<Furniture>> = {
      'f-w': { w: Math.max(5, v) }, 'f-d': { d: Math.max(5, v) }, 'f-h': { h: Math.max(1, v) },
      'f-rot': { rot: normDeg(v) }, 'f-x': { x: v }, 'f-y': { y: v },
    }
    if (map[id]) commit(P.updateFurniture(plan, s.id, map[id]))
  } else if (s.kind === 'wall') {
    if (!Number.isFinite(v)) return renderInspector()
    const w = findSel(s) as Wall
    if (id === 'w-len') {
      const len = Math.max(P.MIN_WALL, v), cur = P.wallLength(w)
      const b = { x: Math.round(w.a.x + ((w.b.x - w.a.x) / cur) * len), y: Math.round(w.a.y + ((w.b.y - w.a.y) / cur) * len) }
      commit(P.updateWall(plan, w.id, { b }))
    }
    if (id === 'w-h') commit(P.updateWall(plan, w.id, { height: Math.max(50, v) }))
    if (id === 'w-t') commit(P.updateWall(plan, w.id, { thickness: Math.max(2, v) }))
  } else {
    if (!Number.isFinite(v)) return renderInspector()
    const map: Record<string, Partial<Opening>> = { 'o-w': { width: Math.max(30, v) }, 'o-h': { height: Math.max(30, v) }, 'o-sill': { sill: Math.max(0, v) }, 'o-t': { t: v } }
    if (!map[id]) return
    const next = P.updateOpening(plan, s.id, map[id])
    if (next === plan) { toast('다른 문·창문과 겹쳐서 바꿀 수 없어요.'); renderInspector(); return }
    commit(next)
  }
}

root.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('button')
  if (!t) return
  if (t.dataset.view) setView(t.dataset.view as View)
  else if (t.dataset.tool) setTool(t.dataset.tool as Tool)
  else if (t.dataset.gizmo) {
    const m = t.dataset.gizmo as 'translate' | 'rotate'
    gizmoOn = !(gizmoOn && gizmoMode === m)
    gizmoMode = m
    attachGizmo(); renderPanels()
  } else if (t.dataset.add) addFurniture(t.dataset.add)
  else if (t.dataset.pick) { const [kind, id] = t.dataset.pick.split(':'); setTool('select'); select({ kind: kind as NonNullable<Sel>['kind'], id }) }
  else if (t.dataset.act) act(t.dataset.act)
  else if (t.id === 'rs-undo') undo()
  else if (t.id === 'rs-redo') redo()
  else if (t.id === 'rs-fit') fit()
  else if (t.id === 'rs-file') openFile()
})
$('rs-right').addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement
  if (t.id) onField(t.id, t.value)
})
$('rs-template').addEventListener('change', (e) => {
  const s = e.target as HTMLSelectElement
  const t = findTemplate(s.value)
  s.value = ''
  if (!t) return
  sel = null
  setTool('select')
  commit(t.build())
  fit()
  toast(`${t.name} 템플릿으로 바꿨어요. 되돌리기로 이전 방을 다시 볼 수 있어요.`)
})

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  const k = e.key.toLowerCase()
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return }
  if (view === 'walk') {
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); e.preventDefault() }
    if (k === 'escape') setView('3d')
    return
  }
  if (k === 'escape') { if (wallStart) endWall(); else if (tool !== 'select') setTool('select'); else select(null) }
  else if (k === 'delete' || k === 'backspace') { if (sel) { e.preventDefault(); act('del') } }
  else if (k === 'v') setTool('select')
  else if (k === 'l') setTool('wall')
  else if (k === 'o') setTool('door')
  else if (k === 'n') setTool('window')
  else if (k === 'w') { gizmoOn = true; gizmoMode = 'translate'; attachGizmo(); renderPanels() }
  else if (k === 'e') { gizmoOn = true; gizmoMode = 'rotate'; attachGizmo(); renderPanels() }
  else if (k === 'r') act('rot90')
  else if (k === 'f') fit()
})
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))
window.addEventListener('blur', () => { keys.clear(); padHeld.clear() })

/* ───── 저장 · 불러오기 ───── */
function openFile() {
  const m = document.createElement('div')
  m.className = 'rs-modal'
  m.innerHTML = `<div class="rs-dialog" role="dialog" aria-modal="true" aria-labelledby="rs-file-title">
    <h3 id="rs-file-title">저장 · 불러오기</h3>
    <p class="rs-note">작업은 이 브라우저에 자동으로 저장돼요. 다른 기기로 옮기려면 아래 내용을 복사해 두었다가 붙여넣으세요.</p>
    <textarea id="rs-json" spellcheck="false">${esc(JSON.stringify(P.toPlanFile(plan)))}</textarea>
    <div class="rs-row">
      <button class="rs-btn primary" id="rs-copy">복사</button>
      <button class="rs-btn" id="rs-apply">붙여넣은 내용 불러오기</button>
      <label class="rs-btn" for="rs-upload">파일 열기</label><input type="file" id="rs-upload" accept=".json,application/json" hidden />
      <span class="rs-spacer"></span>
      <button class="rs-btn" id="rs-close">닫기</button>
    </div>
    <p class="rs-err" id="rs-err" hidden></p>
  </div>`
  document.body.appendChild(m)
  const ta = m.querySelector('#rs-json') as HTMLTextAreaElement
  const err = m.querySelector('#rs-err') as HTMLElement
  const close = () => m.remove()
  const load = (text: string) => {
    try {
      const p = P.fromPlanFile(JSON.parse(text))
      sel = null
      commit(p)
      fit()
      close()
      toast(`'${p.name}'을(를) 불러왔어요.`)
    } catch (ex) {
      err.hidden = false
      err.textContent = ex instanceof SyntaxError ? 'JSON 형식이 아니에요. 복사한 내용을 그대로 붙여넣어 주세요.' : (ex as Error).message
    }
  }
  m.addEventListener('click', (e) => { if (e.target === m) close() })
  m.querySelector('#rs-close')?.addEventListener('click', close)
  m.querySelector('#rs-apply')?.addEventListener('click', () => load(ta.value))
  m.querySelector('#rs-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(ta.value).then(() => toast('복사했어요.'), () => { ta.focus(); ta.select(); toast('선택해 두었어요. Ctrl+C로 복사하세요.') })
  })
  m.querySelector('#rs-upload')?.addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (f) f.text().then(load)
  })
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
  ta.focus()
}

/* ───── 그리기 반복 ───── */
const clock = new THREE.Clock()
const tmp = new THREE.Vector3()
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05)
  if (view === 'walk') walkStep(dt)
  else if (view === '3d') {
    orbit3d.update()
    // 카메라 쪽 벽은 반투명하게: 방 안이 보이게
    camera.getWorldPosition(tmp)
    for (const f of wallFades) {
      const side = Math.sign((tmp.x - f.px) * f.nx + (tmp.z - f.pz) * f.nz)
      ;(f.mesh.material as THREE.MeshStandardMaterial).opacity = side !== f.inside ? 0.18 : 1
    }
  } else {
    orbitPlan.update()
    for (const f of wallFades) (f.mesh.material as THREE.MeshStandardMaterial).opacity = 1
  }
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

rebuild()
resize()
setTool('select')
fit()
renderPanels()
requestAnimationFrame(frame)
// 테스트에서 상태를 확인할 수 있게
;(window as unknown as { __room: unknown }).__room = { get plan() { return plan }, get sel() { return sel }, get view() { return view } }
