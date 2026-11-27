// Skela Room v2 시제품: 기존 편집기(studio/main.ts, 수정하지 않음)를 바탕으로
// 1단계(층 탭, Plan v2, 계단)와 2단계(가상 카메라, 이미지·스프라이트·GLB·OBJ 내보내기)를 붙인 별도 화면.
// 계산은 모두 v2/*.ts 순수 함수에 있고 이 파일은 화면만 맡는다. 단위는 cm, 3D 파일을 쓸 때만 m로 바꾼다.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { createHistory } from '../../undoManager.ts'
import type { Opening, Plan, Vec, Wall } from '../Plan.ts'
import * as P from '../Plan.ts'
import type { SceneBox } from '../geometry.ts'
import { walkStart } from '../unityExport.ts'
import { TEMPLATES, findTemplate } from '../templates.ts'
import { CATALOG_V2, CATEGORY_NAME, furnitureTypeV2, type Category } from './catalog2.ts'
import { buildBoxesV2, cutawayWalls, furnitureBoxesV2, isVisible, type FurnitureV2 } from './scene2.ts'
import { ASPECTS, PRESETS, PRESET_ORDER, aspectRatio, cameraBasis, fitOrthoSpan, makeCamera, toThree, type Aspect, type OutFormat, type Preset, type SizeName, type VCamera } from './camera.ts'
import * as PR from './project.ts'
import { sampleProject } from './sample.ts'
import { alphaBounds, asciiName, fileName, mtlText, outputSize, tiles, TILE_MAX } from './exportJob.ts'
import { makeZip, type ZipEntry } from './zip.ts'
import '../studio/studio.css'
import './v2.css'

type Sel = { kind: 'furniture' | 'wall' | 'opening' | 'camera'; id: string } | null
type Tool = 'select' | 'wall' | 'door' | 'window'
type View = 'plan' | '3d' | 'walk' | 'cam'

// 예시 집을 바꾸면 r 번호를 올려 새 예시로 열리게 한다. 예전 칸(OLD_STORE_KEYS)의 작업은 지우지 않고 '예전 작업 불러오기'로 연다
const STORE_KEY = 'skela-room-v2-project-r8'
const OLD_STORE_KEYS = ['skela-room-v2-project-r7', 'skela-room-v2-project-r6', 'skela-room-v2-project-r5', 'skela-room-v2-project-r4', 'skela-room-v2-project-r3', 'skela-room-v2-project-r2', 'skela-room-v2-project'] // 최근 것부터
const GRID = 10, MOVE_SNAP = 5, EYE = 160
const coarse = matchMedia('(pointer: coarse)').matches
// 카메라 기능(가상 카메라·미리보기·직접 조종·찰칵)을 잠시 꺼 둔다. 코드와 저장된 카메라 데이터는 그대로 두고 화면에서만 뺀다. true로 바꾸면 다시 켜진다
const CAMERA_ENABLED = true
// 카메라 안에서 직접 조종(끌기·W A S D·확대)과 찰칵 버튼은 사용자 요청으로 뺀다. 카메라 목록·아이콘·미리보기·카메라로 보기 틀은 남긴다
const PILOT_ENABLED = false
const SHUTTER_ENABLED = false

/* ───── 상태 ───── */
function loadSaved(): PR.Project | null {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? PR.fromAnyFile(JSON.parse(raw)).project : null } catch { return null }
}
let project: PR.Project = loadSaved() ?? sampleProject()
let plan: Plan = PR.currentFloor(project).plan
const hist = createHistory<PR.Project>(project)
let sel: Sel = null
let tool: Tool = 'select'
let view: View = '3d'
let stack = false // 전체 층 쌓아 보기 (보기 전용)
let gizmoMode: 'translate' | 'rotate' = 'translate'
let gizmoOn = !coarse
let wallStart: Vec | null = null
let camView: string | null = null // 'cam' 보기에서 보는 가상 카메라 id

const syncPlan = () => { plan = PR.currentFloor(project).plan }
const camById = (id: string) => project.cameras.find((c) => c.id === id)
const floorName = (id: string) => project.floors.find((f) => f.id === id)?.name ?? '?'
function commitProject(next: PR.Project) {
  if (!hist.commit(next)) return
  project = next
  syncPlan()
  if (sel && !findSel(sel)) sel = null
  changed()
}
const commit = (next: Plan) => commitProject(PR.setFloorPlan(project, project.currentFloorId, next))
function changed() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(PR.toProjectFile(project))) } catch { /* 저장 불가면 넘어간다 */ }
  // 카메라로 보는 중이면 속성 변경·되돌리기를 조종 중인 사본에도 반영
  if (view === 'cam' && camView && !pilotDirty) { const c = camById(camView); if (c) pilot = cloneCam(c) }
  rebuild()
  renderPanels()
}
function undo() { const p = hist.undo(); if (p) { project = p; syncPlan(); if (sel && !findSel(sel)) sel = null; changed() } }
function redo() { const p = hist.redo(); if (p) { project = p; syncPlan(); if (sel && !findSel(sel)) sel = null; changed() } }
function findSel(s: NonNullable<Sel>) {
  if (s.kind === 'furniture') return plan.furniture.find((f) => f.id === s.id) as FurnitureV2 | undefined
  if (s.kind === 'wall') return plan.walls.find((w) => w.id === s.id)
  if (s.kind === 'opening') return plan.openings.find((o) => o.id === s.id)
  return camById(s.id)
}
function select(s: Sel) { sel = s; applyHighlight(); attachGizmo(); updateCamHelpers(); renderPanels() }
// 층 바꾸기는 되돌리기 기록에 넣지 않는다 (보기 전환)
function switchFloor(id: string) {
  project = PR.selectFloor(project, id)
  syncPlan(); sel = null; endWall()
  changed()
  fit()
}

/* ───── 화면 뼈대 ───── */
const root = document.getElementById('room-app') as HTMLElement
root.innerHTML = `
<div class="rs">
  <header class="rs-top">
    <div class="rs-brand">Skela Room <span class="rs-badge">v2 시제품</span> <small>${CAMERA_ENABLED ? "층 · 카메라 · 내보내기" : "층 · 내보내기"}</small></div>
    <div class="rs-seg" role="group" aria-label="보기">
      <button data-view="plan">평면</button><button data-view="3d">3D</button><button data-view="walk">걷기</button>
    </div>
    <div class="rs-group">
      <button class="rs-btn" id="rs-undo" title="되돌리기 (Ctrl+Z)">↶ 되돌리기</button>
      <button class="rs-btn" id="rs-redo" title="다시 하기 (Ctrl+Y)">↷</button>
    </div>
    <div class="rs-spacer"></div>
    <div class="rs-group">
      <select id="rs-template" aria-label="이 층을 템플릿으로 바꾸기">
        <option value="">이 층을 템플릿으로</option>
        ${TEMPLATES.map((t) => `<option value="${t.id}">${t.name} · ${t.desc}</option>`).join('')}
      </select>
      <button class="rs-btn" id="rs-file">저장 · 불러오기</button>
      <button class="rs-btn primary" id="rs-export">내보내기</button>
    </div>
  </header>
  <aside class="rs-left">
    <section class="rs-sec"><h2>층</h2><ul class="rs-tree rs-floorlist" id="rs-floorlist"></ul></section>
    ${CAMERA_ENABLED ? '<section class="rs-sec"><h2>카메라</h2><div class="rs-cams"><div class="rs-presets" id="rs-presets"></div><ul class="rs-tree" id="rs-camlist"></ul></div></section>' : ''}
    <section class="rs-sec"><h2>가구 넣기</h2><div class="rs-cat" id="rs-cat"></div></section>
    <section class="rs-sec"><h2>방 구성</h2><ul class="rs-tree" id="rs-tree"></ul></section>
  </aside>
  <main class="rs-view" id="rs-view">
    <div class="rs-floors" id="rs-floors" role="group" aria-label="층"></div>
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
    <div class="rs-shutter" id="rs-shutter">
      <button class="zoom" data-zoom="-1" aria-label="넓게 (축소)" title="넓게">−</button>
      <button class="shot" id="rs-shot" aria-label="찰칵, 지금 화면 찍기" title="지금 화면 찍기 (Space)"><span></span></button>
      <button class="zoom" data-zoom="1" aria-label="가깝게 (확대)" title="가깝게">+</button>
    </div>
    <div class="rs-flash" id="rs-flash" hidden></div>
    <div class="rs-shotchip" id="rs-shotchip" hidden><img alt="방금 찍은 사진" id="rs-shotimg" /><span id="rs-shotname"></span><button class="rs-btn primary" id="rs-shotsave">다시 저장</button></div>
    <div class="rs-preview" id="rs-preview" hidden><span id="rs-preview-name"></span></div>
    <div class="rs-frame" id="rs-frame" hidden><span id="rs-frame-name"></span></div>
    <div class="rs-measure" id="rs-measure" hidden></div>
    <div class="rs-hint" id="rs-hint"></div>
  </main>
  <aside class="rs-right" id="rs-right"></aside>
</div>`
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const viewEl = $('rs-view'), hintEl = $('rs-hint'), measureEl = $('rs-measure'), padEl = $('rs-pad')
const previewEl = $('rs-preview'), frameEl = $('rs-frame')

let toastTimer = 0
function toast(msg: string) {
  viewEl.querySelector('.rs-toast')?.remove()
  const t = document.createElement('div')
  t.className = 'rs-toast'; t.textContent = msg
  viewEl.appendChild(t)
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => t.remove(), 2800)
}

/* ───── three.js 편집 장면 ───── */
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

function addLights(s: THREE.Scene) {
  s.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.7)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0005
  s.add(sun, sun.target)
  return sun
}
function aimSun(sun: THREE.DirectionalLight, b: { x0: number; y0: number; x1: number; y1: number }, top = 0) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.y0 + b.y1) / 2
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0, 300)
  sun.position.set(cx - size * 0.4, top + size * 1.2, cz - size * 0.7)
  sun.target.position.set(cx, 0, cz)
  const sc = sun.shadow.camera
  sc.left = sc.bottom = -size * 0.8; sc.right = sc.top = size * 0.8
  sc.near = 10; sc.far = size * 4 + top
  sc.updateProjectionMatrix()
}
const sun = addLights(scene)

const persp = new THREE.PerspectiveCamera(50, 1, 10, 30000)
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000)
let camera: THREE.Camera = persp
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
const gizmoHelper = gizmo.getHelper()
scene.add(gizmoHelper)
gizmo.addEventListener('dragging-changed', (e) => {
  const dragging = (e as unknown as { value: boolean }).value
  activeOrbit().enabled = !dragging
  if (!dragging) commitGizmo()
})

const world = new THREE.Group()
scene.add(world)
const helpers = new THREE.Group() // 카메라 아이콘: 편집 화면에만, 내보내기에는 없다
scene.add(helpers)
const furnGroups = new Map<string, THREE.Group>()
type Ref = { kind: 'furniture' | 'wall' | 'opening' | 'floor'; id: string }
type WallFade = { mesh: THREE.Mesh; wallId: string; px: number; pz: number; nx: number; nz: number; inside: number; faded: boolean }
let wallFades: WallFade[] = []
let wallSolids: { cx: number; cz: number; hw: number; hd: number; c: number; s: number }[] = []

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh || (o as THREE.LineSegments).isLineSegments) { m.geometry.dispose(); const mat = m.material; (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose()) }
  })
  g.clear()
}

// 상자 목록 → 메시. 가구는 가구 묶음(회전 기준)으로 넣는다. elev: 층 높이. interactive: 편집 대상 층인지
function addBoxes(target: THREE.Group, p: Plan, boxes: SceneBox[], elev: number, interactive: boolean, matFor?: (b: SceneBox) => THREE.Material) {
  const b = P.planBounds(p)
  const cx = (b.x0 + b.x1) / 2, cz = (b.y0 + b.y1) / 2
  const groups = new Map<string, THREE.Group>()
  const meshes: THREE.Mesh[] = []
  for (const box of boxes) {
    const glass = (box.opacity ?? 1) < 1
    const mat = matFor ? matFor(box) : new THREE.MeshStandardMaterial({ color: box.color, roughness: box.kind === 'floor' ? 0.85 : glass ? 0.1 : 0.7, metalness: glass ? 0.1 : 0, transparent: glass || box.kind === 'wall', opacity: box.opacity ?? 1 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.w, box.h, box.d), mat)
    mesh.castShadow = box.kind !== 'floor' && !glass
    mesh.receiveShadow = true
    meshes.push(mesh)
    if (box.kind === 'furniture') {
      const fid = box.id.split(':')[0]
      const f = p.furniture.find((q) => q.id === fid)
      if (!f) continue
      let g = groups.get(fid)
      if (!g) {
        g = new THREE.Group()
        g.name = fid
        g.position.set(f.x, elev, f.y)
        g.rotation.y = -THREE.MathUtils.degToRad(f.rot)
        g.userData.ref = { kind: 'furniture', id: fid } satisfies Ref
        groups.set(fid, g)
        target.add(g)
        if (interactive) furnGroups.set(fid, g)
      }
      const r = THREE.MathUtils.degToRad(f.rot), c = Math.cos(r), s = Math.sin(r)
      const dx = box.cx - f.x, dz = box.cz - f.y
      mesh.position.set(c * dx + s * dz, box.cy, -s * dx + c * dz)
      mesh.userData.ref = { kind: 'furniture', id: fid } satisfies Ref
      g.add(mesh)
      continue
    }
    mesh.position.set(box.cx, box.cy + elev, box.cz)
    mesh.rotation.y = -THREE.MathUtils.degToRad(box.rotDeg)
    if (box.kind === 'floor') mesh.userData.ref = { kind: 'floor', id: 'floor' } satisfies Ref
    else if (box.kind === 'door' || box.kind === 'glass') mesh.userData.ref = { kind: 'opening', id: box.id.split(':')[0] } satisfies Ref
    else {
      const parts = box.id.split(':')
      mesh.userData.ref = (parts.length > 2 ? { kind: 'opening', id: parts[1] } : { kind: 'wall', id: parts[0] }) satisfies Ref
      mesh.userData.wallId = parts[0]
      if (interactive) {
        const a = THREE.MathUtils.degToRad(box.rotDeg)
        const nx = -Math.sin(a), nz = Math.cos(a)
        wallFades.push({ mesh, wallId: parts[0], px: box.cx, pz: box.cz, nx, nz, inside: Math.sign((cx - box.cx) * nx + (cz - box.cz) * nz) || 1, faded: false })
        if (box.cy - box.h / 2 < 100) wallSolids.push({ cx: box.cx, cz: box.cz, hw: box.w / 2, hd: box.d / 2, c: Math.cos(a), s: Math.sin(a) })
      }
    }
    target.add(mesh)
  }
  return meshes
}

function rebuild() {
  if (gizmo.object) gizmo.detach()
  disposeGroup(world)
  furnGroups.clear()
  wallFades = []
  wallSolids = []
  if (stack) {
    project.floors.forEach((f) => addBoxes(world, f.plan, buildBoxesV2(f.plan), PR.floorElevation(project, f.id), false))
    const all = project.floors.map((f) => P.planBounds(f.plan))
    aimSun(sun, { x0: Math.min(...all.map((b) => b.x0)), y0: Math.min(...all.map((b) => b.y0)), x1: Math.max(...all.map((b) => b.x1)), y1: Math.max(...all.map((b) => b.y1)) }, project.floors.length * project.floorGap)
  } else {
    addBoxes(world, plan, buildBoxesV2(plan), 0, true)
    aimSun(sun, P.planBounds(plan))
  }
  const b = P.planBounds(plan)
  grid.position.set((b.x0 + b.x1) / 2, -2.5, (b.y0 + b.y1) / 2)
  applyHighlight()
  attachGizmo()
  updateCamHelpers()
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

const isLocked = (id: string) => (plan.furniture.find((f) => f.id === id) as FurnitureV2 | undefined)?.locked === true
function attachGizmo() {
  const g = sel?.kind === 'furniture' && !isLocked(sel.id) ? furnGroups.get(sel.id) : undefined
  if (!g || !gizmoOn || view === 'walk' || view === 'cam' || stack) { if (gizmo.object) gizmo.detach(); return }
  gizmo.camera = camera
  gizmo.setMode(gizmoMode)
  gizmo.showX = gizmo.showZ = gizmoMode === 'translate'
  gizmo.showY = gizmoMode === 'rotate'
  gizmo.attach(g)
}
const normDeg = (d: number) => ((d % 360) + 360) % 360
function commitGizmo() {
  if (sel?.kind !== 'furniture') return
  const g = furnGroups.get(sel.id)
  if (!g) return
  commit(P.updateFurniture(plan, sel.id, { x: Math.round(g.position.x), y: Math.round(g.position.z), rot: normDeg(Math.round(-THREE.MathUtils.radToDeg(g.rotation.y))) }))
}

/* ───── 가상 카메라 → three 카메라 ───── */
// 화면 비율(ar)이 카메라 비율과 다르면, 카메라 비율의 틀이 화면 안에 다 들어가도록 시야를 넓힌다(scale ≥ 1)
function threeCam(c: VCamera, elev: number, ar: number, scale = 1): THREE.PerspectiveCamera | THREE.OrthographicCamera {
  const [px, py, pz] = toThree(c.pos, elev), [tx, ty, tz] = toThree(c.target, elev)
  const up = cameraBasis(c).worldUp
  let cam: THREE.PerspectiveCamera | THREE.OrthographicCamera
  if (c.projection === 'perspective') {
    const fov = (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(c.fovDeg) / 2) * scale) * 180) / Math.PI
    cam = new THREE.PerspectiveCamera(fov, ar, 10, 30000)
  } else {
    const h = (c.orthoSpan * scale) / 2
    cam = new THREE.OrthographicCamera(-h * ar, h * ar, h, -h, 1, 30000)
  }
  cam.up.set(up[0], up[1], up[2])
  cam.position.set(px, py, pz)
  cam.lookAt(tx, ty, tz)
  cam.updateProjectionMatrix()
  return cam
}
// 화면 안에 카메라 비율 틀이 놓이는 자리 (CSS px)
function frameRect(c: VCamera, W: number, H: number) {
  const ar = aspectRatio(c.aspect)
  const fw = W / H > ar ? H * ar : W, fh = W / H > ar ? H : W / ar
  return { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh, scale: H / fh }
}

// 카메라를 끄는 중이면 아직 저장하지 않은 임시 카메라(camDraft)로 그린다
let camDraft: VCamera | null = null
function updateCamHelpers() {
  disposeGroup(helpers)
  if (!CAMERA_ENABLED) return
  if (stack || view === 'cam' || view === 'walk') return // 걷기에서는 아이콘이 눈앞을 가리므로 숨긴다
  const accent = new THREE.Color(cssVar('--accent'))
  for (const c0 of project.cameras) {
    const c = camDraft && camDraft.id === c0.id ? camDraft : c0
    if (c.floorId !== project.currentFloorId) continue
    const on = sel?.kind === 'camera' && sel.id === c.id
    // 직교 카메라는 아주 멀리 있으니 방 가까이(6m)에 아이콘만 그린다
    const near = { ...c }
    const dx = c.pos.x - c.target.x, dy = c.pos.y - c.target.y, dh = c.pos.h - c.target.h, L = Math.hypot(dx, dy, dh)
    if (L > 600) near.pos = { x: c.target.x + (dx / L) * 600, y: c.target.y + (dy / L) * 600, h: c.target.h + (dh / L) * 600 }
    const col = on ? accent : new THREE.Color(0x666666)
    if (c.projection === 'perspective') {
      const cam = threeCam(near, 0, aspectRatio(c.aspect))
      cam.far = 120; cam.updateProjectionMatrix()
      const h = new THREE.CameraHelper(cam)
      h.setColors(col, col, new THREE.Color(0x999999), col, new THREE.Color(0x999999))
      helpers.add(h)
    } else {
      // 직교 카메라는 시야 틀이 집보다 커서, 방향 화살표만 그린다
      const from = new THREE.Vector3(...toThree(near.pos)), to = new THREE.Vector3(...toThree(c.target))
      const dir = to.clone().sub(from).normalize()
      helpers.add(new THREE.ArrowHelper(dir, from, Math.min(from.distanceTo(to), 220), col.getHex(), 40, 26))
    }
    // 카메라 몸통: 눌러서 고르고, 끌어서 자리를 옮긴다
    const body = new THREE.Mesh(new THREE.BoxGeometry(34, 24, 24), new THREE.MeshBasicMaterial({ color: on ? accent : 0x555555 }))
    body.position.set(...toThree(near.pos))
    body.lookAt(...toThree(c.target))
    body.userData.camPick = { id: c.id, part: 'body' }
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 12, 16), new THREE.MeshBasicMaterial({ color: on ? accent : 0x333333 }))
    lens.rotation.x = Math.PI / 2; lens.position.z = 16
    lens.userData.camPick = { id: c.id, part: 'body' }
    body.add(lens)
    helpers.add(body)
    // 보는 점: 끌어서 카메라가 바라보는 곳을 바꾼다
    const ball = new THREE.Mesh(new THREE.SphereGeometry(on ? 12 : 9, 16, 10), new THREE.MeshBasicMaterial({ color: on ? accent : 0x777777 }))
    ball.position.set(...toThree(c.target))
    ball.userData.camPick = { id: c.id, part: 'target' }
    helpers.add(ball)
  }
}

/* ───── 편집 카메라와 보기 ───── */
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

function viewBounds() {
  if (!stack) return P.planBounds(plan)
  const all = project.floors.map((f) => P.planBounds(f.plan))
  return { x0: Math.min(...all.map((b) => b.x0)), y0: Math.min(...all.map((b) => b.y0)), x1: Math.max(...all.map((b) => b.x1)), y1: Math.max(...all.map((b) => b.y1)) }
}
function fit() {
  const b = viewBounds()
  const cx = (b.x0 + b.x1) / 2, cz = (b.y0 + b.y1) / 2
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0, 300)
  const w = viewEl.clientWidth || 800, h = viewEl.clientHeight || 600
  if (view === 'plan') {
    const halfH = Math.max((b.y1 - b.y0) * 0.6, ((b.x1 - b.x0) * 0.6) / (w / h), 200)
    ortho.top = halfH; ortho.bottom = -halfH; ortho.left = -halfH * (w / h); ortho.right = halfH * (w / h)
    ortho.zoom = 1
    ortho.position.set(cx, 2000, cz); ortho.up.set(0, 0, -1); ortho.lookAt(cx, 0, cz); ortho.updateProjectionMatrix()
    orbitPlan.target.set(cx, 0, cz); orbitPlan.update()
  } else if (view === '3d') {
    const lift = stack ? project.floors.length * project.floorGap * 0.5 : 0
    persp.position.set(cx + size * 0.15, size * 0.95 + lift, cz + size * 1.05)
    orbit3d.target.set(cx, 60 + lift * 0.6, cz)
    orbit3d.update()
  }
}

let yaw = 0, pitch = 0
function setView(v: View) {
  if (v === view) return
  if (v !== 'cam') { commitPilot(); camView = null; pilot = null }
  view = v
  orbit3d.enabled = v === '3d'
  orbitPlan.enabled = v === 'plan'
  camera = v === 'plan' ? ortho : persp
  grid.visible = v !== 'walk' && v !== 'cam'
  sun.castShadow = v !== 'plan'
  padEl.hidden = v !== 'walk' && !(v === 'cam' && PILOT_ENABLED)
  frameEl.hidden = v !== 'cam'
  if (v === 'walk') {
    if (stack) { stack = false; rebuild() }
    if (tool !== 'select') setTool('select')
    const start = walkStart(plan)
    persp.position.set(start.x, EYE, start.y)
    yaw = Math.atan2(-(start.lookX - start.x), -(start.lookY - start.y))
    pitch = -0.08
    applyLook()
    for (const f of wallFades) { (f.mesh.material as THREE.MeshStandardMaterial).opacity = 1; f.mesh.visible = true }
  } else if (v !== 'cam') fit()
  attachGizmo()
  updateCamHelpers()
  renderPanels()
}
function applyLook() { persp.rotation.set(pitch, yaw, 0, 'YXZ') }
function blocked(x: number, z: number): boolean {
  for (const w of wallSolids) {
    const dx = x - w.cx, dz = z - w.cz
    const lx = w.c * dx + w.s * dz, lz = -w.s * dx + w.c * dz
    if (Math.abs(lx) < w.hw + 22 && Math.abs(lz) < w.hd + 22) return true
  }
  return false
}

// 가상 카메라로 보기: 편집 카메라는 그대로 두고, 화면만 그 카메라 시점 + 비율 틀로 그린다
function lookThrough(id: string) {
  const c = camById(id)
  if (!c) return
  if (c.floorId !== project.currentFloorId) { project = PR.selectFloor(project, c.floorId); syncPlan(); rebuild() }
  if (stack) { stack = false; rebuild() }
  commitPilot()
  camView = id
  pilot = cloneCam(c)
  setView('cam')
  view = 'cam'
  padEl.hidden = !PILOT_ENABLED
  frameEl.hidden = false
  ;($('rs-frame-name') as HTMLElement).textContent = `${c.name} · ${PRESETS[c.preset].label} · ${c.aspect}`
  renderPanels()
}

/* ───── 카메라 안에서 직접 조종 (카메라로 보기 상태) ───── */
// 조종 중인 카메라는 임시 사본(pilot)에서 바꾸고, 손을 뗄 때 한 번만 저장한다 (되돌리기 한 단계)
let pilot: VCamera | null = null
let pilotDirty = false
let pilotTimer = 0
const cloneCam = (c: VCamera): VCamera => ({ ...c, pos: { ...c.pos }, target: { ...c.target }, output: { ...c.output } })
function commitPilot() {
  clearTimeout(pilotTimer)
  if (!pilot || !pilotDirty) return
  pilotDirty = false
  commitProject(PR.upsertCamera(project, cloneCam(pilot)))
}
const commitPilotSoon = () => { clearTimeout(pilotTimer); pilotTimer = window.setTimeout(commitPilot, 450) }
// 보는 방향: 원근은 카메라 자리에서 보는 점 방향, 직교는 보는 점에서 카메라 방향
function angles(c: VCamera) {
  const persp3 = c.projection === 'perspective'
  const [ax, ay, ah] = persp3 ? [c.target.x - c.pos.x, c.target.y - c.pos.y, c.target.h - c.pos.h] : [c.pos.x - c.target.x, c.pos.y - c.target.y, c.pos.h - c.target.h]
  return { yaw: Math.atan2(ay, ax), pitch: Math.atan2(ah, Math.hypot(ax, ay)), dist: Math.hypot(ax, ay, ah) || 1 }
}
function setAngles(c: VCamera, yawA: number, pitchA: number) {
  const { dist } = angles(c)
  const dx = Math.cos(pitchA) * Math.cos(yawA) * dist, dy = Math.cos(pitchA) * Math.sin(yawA) * dist, dh = Math.sin(pitchA) * dist
  if (c.projection === 'perspective') c.target = { x: c.pos.x + dx, y: c.pos.y + dy, h: c.pos.h + dh }
  else c.pos = { x: c.target.x + dx, y: c.target.y + dy, h: c.target.h + dh }
}
// 끌기: 오른쪽으로 끌면 오른쪽을 보고, 위로 끌면 위를 본다. 직교 카메라는 보는 점을 중심으로 돈다
function pilotLook(dx: number, dy: number) {
  if (!pilot) return
  const a = angles(pilot)
  if (pilot.projection === 'perspective') setAngles(pilot, a.yaw + dx * 0.004, Math.max(-1.4, Math.min(1.4, a.pitch - dy * 0.004)))
  else setAngles(pilot, a.yaw - dx * 0.004, Math.max(0.09, Math.min(1.5706, a.pitch + dy * 0.004)))
  pilotDirty = true
}
// 확대·축소: 원근은 화각, 직교는 보이는 세로 길이
function pilotZoom(dir: number) {
  if (!pilot) return
  const k = dir > 0 ? 0.9 : 1 / 0.9
  if (pilot.projection === 'perspective') pilot.fovDeg = Math.round(Math.min(100, Math.max(20, pilot.fovDeg * k)))
  else pilot.orthoSpan = Math.round(Math.max(50, pilot.orthoSpan * k))
  pilotDirty = true
}
// 이동: W·S 앞뒤, A·D 옆, Q·E 높이. 카메라와 보는 점을 같이 옮긴다
function pilotStep(dt: number) {
  if (!pilot) return
  let f = 0, s = 0, u = 0
  if (keys.has('w') || keys.has('arrowup') || padHeld.has('f')) f += 1
  if (keys.has('s') || keys.has('arrowdown') || padHeld.has('b')) f -= 1
  if (keys.has('d') || keys.has('arrowright') || padHeld.has('r')) s += 1
  if (keys.has('a') || keys.has('arrowleft') || padHeld.has('l')) s -= 1
  if (keys.has('e')) u += 1
  if (keys.has('q')) u -= 1
  if (!f && !s && !u) return
  const fast = keys.has('shift') ? 2 : 1
  const speed = (pilot.projection === 'perspective' ? 150 : pilot.orthoSpan * 0.6) * dt * fast
  const yawA = Math.atan2(pilot.target.y - pilot.pos.y, pilot.target.x - pilot.pos.x)
  const fx = Math.cos(yawA), fy = Math.sin(yawA) // 앞(평면도)
  const rx = -fy, ry = fx // 오른쪽 (y가 아래인 평면도에서 앞을 시계 방향 90°)
  const mx = (fx * f + rx * s) * speed, my = (fy * f + ry * s) * speed, mh = u * speed
  pilot.pos = { x: pilot.pos.x + mx, y: pilot.pos.y + my, h: pilot.pos.h + mh }
  pilot.target = { x: pilot.target.x + mx, y: pilot.target.y + my, h: pilot.target.h + mh }
  pilotDirty = true
  commitPilotSoon()
}

/* ───── 찰칵: 지금 보이는 장면을 바로 이미지로 ───── */
let lastShot: { blob: Blob; name: string; url: string } | null = null
let chipTimer = 0
async function shoot() {
  if (!CAMERA_ENABLED || !SHUTTER_ENABLED) return
  if (stack) { toast('쌓아 보기에서는 찍을 수 없어요. 층을 골라주세요.'); return }
  let cam: VCamera
  if (view === 'cam' && pilot) cam = cloneCam(pilot)
  else {
    const preset: Preset = view === 'plan' ? 'top' : view === 'walk' ? 'fps' : 'interior'
    cam = makeCamera(preset, 'shot', '지금 화면', project.currentFloorId, P.planBounds(plan), '16:9')
    grabCurrentView(cam)
    cam.cutaway = view === 'walk' ? 'none' : 'auto'
    cam.output = { format: 'png', transparent: false, size: 'FHD' }
  }
  const flash = $('rs-flash')
  flash.hidden = false
  setTimeout(() => { flash.hidden = true }, 260)
  const btn = $('rs-shot') as HTMLButtonElement
  btn.disabled = true
  try {
    const { w, h } = outputSize(cam.output.size, cam.aspect)
    const fmt = cam.output.format
    const cv = await renderImage(cam, { format: fmt, transparent: fmt !== 'jpg' && cam.output.transparent }, w, h)
    const blob = await toBlob(cv, fmt === 'jpg' ? 'image/jpeg' : 'image/png')
    const d = new Date(), pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    const name = fileName([project.name, floorName(cam.floorId), cam.name, stamp], fmt === 'jpg' ? 'jpg' : 'png')
    if (lastShot) URL.revokeObjectURL(lastShot.url)
    lastShot = { blob, name, url: URL.createObjectURL(blob) }
    ;($('rs-shotimg') as HTMLImageElement).src = lastShot.url
    $('rs-shotname').textContent = `${w}×${h}`
    const chip = $('rs-shotchip')
    chip.hidden = false
    clearTimeout(chipTimer)
    chipTimer = window.setTimeout(() => { chip.hidden = true }, 9000)
    await saveFile(blob, name)
  } catch (e) {
    toast((e as Error).message || '찍지 못했어요.')
  } finally {
    btn.disabled = false
  }
}

/* ───── 입력 ───── */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
function setRay(e: PointerEvent | MouseEvent) {
  const r = renderer.domElement.getBoundingClientRect()
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  ray.setFromCamera(ndc, camera)
}
function pick(e: PointerEvent): Ref | null {
  setRay(e)
  for (const h of ray.intersectObjects(world.children, true)) {
    const ref = h.object.userData.ref as Ref | undefined
    if (!ref || !h.object.visible) continue
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

let down: { x: number; y: number } | null = null
let drag: { id: string; ox: number; oy: number; moved: boolean } | null = null
let look: { x: number; y: number } | null = null
let camDrag: { id: string; part: 'body' | 'target'; start: VCamera; moved: boolean } | null = null
function pointAtHeight(e: PointerEvent, h: number): Vec | null {
  setRay(e)
  const v = new THREE.Vector3()
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), v) ? { x: v.x, y: v.z } : null
}
// 끈 위치로 카메라 계산: 원근 카메라 몸통은 그 자리로, 직교 카메라 몸통은 보는 점을 중심으로 돈다. 보는 점을 끌면 직교 카메라는 통째로 옮겨진다
function draggedCamera(c: VCamera, part: 'body' | 'target', g: Vec): VCamera {
  const q = { x: P.snapTo(g.x, MOVE_SNAP), y: P.snapTo(g.y, MOVE_SNAP) }
  const n: VCamera = { ...c, pos: { ...c.pos }, target: { ...c.target } }
  if (part === 'target') {
    const dx = q.x - c.target.x, dy = q.y - c.target.y
    n.target.x = q.x; n.target.y = q.y
    if (c.projection === 'orthographic') { n.pos.x += dx; n.pos.y += dy }
  } else if (c.projection === 'perspective') {
    n.pos.x = q.x; n.pos.y = q.y
  } else {
    const lh = Math.hypot(c.pos.x - c.target.x, c.pos.y - c.target.y) || 1
    const ux = q.x - c.target.x, uy = q.y - c.target.y, ul = Math.hypot(ux, uy) || 1
    n.pos.x = c.target.x + (ux / ul) * lh; n.pos.y = c.target.y + (uy / ul) * lh
  }
  if (Math.hypot(n.pos.x - n.target.x, n.pos.y - n.target.y, n.pos.h - n.target.h) < 20) return c // 너무 가까우면 그대로
  return n
}
const editable = () => !stack && view !== 'cam'

viewEl.addEventListener('pointerdown', (e) => {
  if (e.target !== renderer.domElement) return
  down = { x: e.clientX, y: e.clientY }
  if (view === 'walk' || (view === 'cam' && PILOT_ENABLED)) { look = { x: e.clientX, y: e.clientY }; renderer.domElement.setPointerCapture(e.pointerId); return }
  if (!editable() || tool !== 'select' || e.button !== 0 || gizmo.axis !== null || gizmo.dragging) return
  setRay(e)
  const ch = ray.intersectObjects(helpers.children, true).find((h) => h.object.userData.camPick)
  if (ch) {
    const { id, part } = ch.object.userData.camPick as { id: string; part: 'body' | 'target' }
    const c = camById(id)
    if (!c) return
    if (!(sel?.kind === 'camera' && sel.id === id)) select({ kind: 'camera', id })
    camDrag = { id, part, start: c, moved: false }
    activeOrbit().enabled = false
    renderer.domElement.setPointerCapture(e.pointerId)
    return
  }
  const ref = pick(e)
  if (ref?.kind === 'furniture') {
    const f = plan.furniture.find((q) => q.id === ref.id)
    const g = groundPoint(e)
    if (!f || !g) return
    if (sel?.kind !== 'furniture' || sel.id !== f.id) select(ref as NonNullable<Sel>)
    if (isLocked(f.id)) { toast('잠긴 가구예요. 오른쪽 속성에서 잠금을 풀면 옮길 수 있어요.'); return }
    drag = { id: f.id, ox: f.x - g.x, oy: f.y - g.y, moved: false }
    activeOrbit().enabled = false
    renderer.domElement.setPointerCapture(e.pointerId)
  }
}, { capture: true })

viewEl.addEventListener('pointermove', (e) => {
  if (view === 'cam') {
    if (PILOT_ENABLED && look) { pilotLook(e.clientX - look.x, e.clientY - look.y); look = { x: e.clientX, y: e.clientY } }
    return
  }
  if (view === 'walk') {
    if (look) {
      yaw -= (e.clientX - look.x) * 0.005
      pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - look.y) * 0.005))
      look = { x: e.clientX, y: e.clientY }
      applyLook()
    }
    return
  }
  if (camDrag) {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3) camDrag.moved = true
    if (!camDrag.moved) return
    const c = camDrag.start
    const L = Math.hypot(c.pos.x - c.target.x, c.pos.y - c.target.y, c.pos.h - c.target.h)
    const h = camDrag.part === 'target' ? c.target.h : c.projection === 'orthographic' && L > 600 ? c.target.h + ((c.pos.h - c.target.h) / L) * 600 : c.pos.h
    const g = pointAtHeight(e, h)
    if (!g) return
    camDraft = draggedCamera(c, camDrag.part, g)
    updateCamHelpers()
    return
  }
  if (drag) {
    const g = groundPoint(e), grp = furnGroups.get(drag.id)
    if (!g || !grp) return
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3) drag.moved = true
    if (!drag.moved) return
    grp.position.x = P.snapTo(g.x + drag.ox, MOVE_SNAP)
    grp.position.z = P.snapTo(g.y + drag.oy, MOVE_SNAP)
    return
  }
  if (tool === 'wall' && editable()) { const g = groundPoint(e); showWallPreview(g && wallSnap(g), e) }
})

viewEl.addEventListener('pointerup', (e) => {
  const wasClick = !!down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6
  down = null; look = null
  if (view === 'cam') { commitPilot(); return }
  if (camDrag) {
    const d = camDrag
    camDrag = null
    activeOrbit().enabled = view !== 'walk'
    const draft = camDraft
    camDraft = null
    if (d.moved && draft) {
      // 직교 카메라를 돌렸으면 바뀐 방향에서 집이 꽉 차게 찍는 범위를 다시 맞춘다
      const fl = project.floors.find((f) => f.id === draft.floorId)
      const fixed = draft.projection === 'orthographic' && d.part === 'body' && fl ? { ...draft, orthoSpan: fitOrthoSpan(draft, P.planBounds(fl.plan)) } : draft
      commitProject(PR.upsertCamera(project, fixed))
      toast(d.part === 'body' ? '카메라 자리를 옮겼어요.' : '카메라가 보는 곳을 바꿨어요.')
    }
    else updateCamHelpers()
    return
  }
  if (drag) {
    const d = drag
    drag = null
    activeOrbit().enabled = view !== 'walk'
    const grp = furnGroups.get(d.id)
    if (d.moved && grp) commit(P.updateFurniture(plan, d.id, { x: Math.round(grp.position.x), y: Math.round(grp.position.z) }))
    return
  }
  if (!wasClick || e.target !== renderer.domElement || !editable() || view === 'walk' || gizmo.dragging) return
  onClick(e)
})

function onClick(e: PointerEvent) {
  if (tool === 'wall') {
    const g = groundPoint(e)
    if (!g) return
    const p = wallSnap(g)
    if (!wallStart) { wallStart = p; showWallPreview(p, e); renderHint(); return }
    if (P.dist(wallStart, p) < P.MIN_WALL) { endWall(); return }
    const next = P.addWall(plan, wallStart, p)
    commit(next)
    const closed = plan.walls.some((w) => w !== next.walls[next.walls.length - 1] && (P.dist(w.a, p) < 1 || P.dist(w.b, p) < 1))
    wallStart = closed ? null : p
    if (closed) { toast('벽이 이어졌어요.'); showWallPreview(null) }
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
  if (view === 'walk') { hintEl.textContent = '화면을 끌어 둘러보고, W A S D 키나 화살표 버튼으로 걸어요.'; return }
  if (view === 'cam' && !PILOT_ENABLED) { hintEl.textContent = '카메라 시점이에요. 밝은 틀 안이 내보내기에 찍혀요. 위의 3D를 누르면 편집으로 돌아가요.'; return }
  if (view === 'cam') { hintEl.textContent = coarse ? '끌어서 둘러보고 화살표로 움직여요. −/+ 로 확대, 동그란 버튼으로 찰칵.' : '끌어서 둘러보고 W A S D로 이동, Q·E 높이, 휠로 확대. Space나 동그란 버튼으로 찰칵.'; return }
  if (stack) { hintEl.textContent = '모든 층을 쌓아서 보는 중이에요(보기 전용). 층 탭을 누르면 그 층 편집으로 돌아가요.'; return }
  const hints: Record<Tool, string> = {
    select: view === 'plan' ? '가구를 눌러 고르고 끌어서 옮겨요. 빈 곳을 끌면 화면이 움직여요.' : '가구를 끌어 옮기고, 빈 곳을 끌면 화면이 돌아가요.',
    wall: wallStart ? '다음 점을 눌러 벽을 만들어요. Esc로 끝내요.' : '바닥을 눌러 벽 시작점을 찍어요.',
    door: '문을 넣을 벽을 눌러요.',
    window: '창문을 넣을 벽을 눌러요.',
  }
  hintEl.textContent = hints[tool]
}

/* ───── 걷기 ───── */
const keys = new Set<string>(), padHeld = new Set<string>()
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
  const speed = 150 * dt, fx = -Math.sin(yaw), fz = -Math.cos(yaw)
  const dx = (fx * f - fz * s) * speed, dz = (fz * f + fx * s) * speed
  const p = persp.position
  if (!blocked(p.x + dx, p.z)) p.x += dx
  if (!blocked(p.x, p.z + dz)) p.z += dz
}

/* ───── 패널 ───── */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
const fname = (f: FurnitureV2) => furnitureTypeV2(f.type)?.name ?? f.type
const wallNo = (id: string) => plan.walls.findIndex((w) => w.id === id) + 1

{
  const cats: Category[] = ['furniture', 'appliance', 'lighting', 'decor', 'architecture']
  $('rs-cat').innerHTML = cats.map((c) => `<h3>${CATEGORY_NAME[c]}</h3>` + CATALOG_V2.filter((t) => t.category === c).map((t) => `<button data-add="${t.id}" title="${t.name} 넣기"><b>${t.name}</b><span>${t.w}×${t.d}</span></button>`).join('')).join('')
  if (CAMERA_ENABLED) $('rs-presets').innerHTML = PRESET_ORDER.map((p) => `<button data-newcam="${p}">+ ${PRESETS[p].label}</button>`).join('') + `<button data-newcam="current">+ 현재 시점</button>`
}

function renderFloors() {
  const tabs = project.floors.map((f) => `<button data-floor="${f.id}" aria-pressed="${!stack && f.id === project.currentFloorId}">${esc(f.name)}</button>`).join('')
  $('rs-floors').innerHTML = tabs + `<span class="sep"></span><button data-act="addfloor" title="층 추가">+</button><button data-act="stack" aria-pressed="${stack}" title="모든 층 쌓아 보기">쌓아 보기</button>`
  const n = project.floors.length
  $('rs-floorlist').innerHTML = [...project.floors].reverse().map((f) => {
    const i = project.floors.indexOf(f)
    return `<li><button data-floor="${f.id}" aria-current="${f.id === project.currentFloorId}" title="바닥 높이 ${PR.floorElevation(project, f.id)}cm">${esc(f.name)}<span>가구 ${f.plan.furniture.length}</span></button>` +
      `<button class="mini" data-floorup="${f.id}" ${i === n - 1 ? 'disabled' : ''} title="위로">↑</button><button class="mini" data-floordown="${f.id}" ${i === 0 ? 'disabled' : ''} title="아래로">↓</button>` +
      `<button class="mini" data-floordup="${f.id}" title="복제">⧉</button><button class="mini" data-floordel="${f.id}" ${n <= 1 ? 'disabled' : ''} title="삭제">✕</button></li>`
  }).join('')
}
function renderCams() {
  if (!CAMERA_ENABLED) return
  const cur = (id: string) => String(sel?.kind === 'camera' && sel.id === id)
  $('rs-camlist').innerHTML = project.cameras.length
    ? project.cameras.map((c) => `<li><button data-pick="camera:${c.id}" aria-current="${cur(c.id)}">${esc(c.name)}<span class="tag">${floorName(c.floorId)} · ${PRESETS[c.preset].label}</span></button></li>`).join('')
    : '<li class="rs-note">위 버튼으로 촬영용 카메라를 만들어요.</li>'
}
function renderTree() {
  const cur = (k: string, id: string) => (sel?.kind === k && sel.id === id ? 'true' : 'false')
  const furn = (plan.furniture as FurnitureV2[]).map((f) => `<li><button data-pick="furniture:${f.id}" aria-current="${cur('furniture', f.id)}" class="${isVisible(f) ? '' : 'dim'}">${esc(fname(f))}${f.locked ? ' 🔒' : ''}<span>${isVisible(f) ? `${f.w}×${f.d}` : '숨김'}</span></button></li>`).join('')
  const walls = plan.walls.map((w, i) => `<li><button data-pick="wall:${w.id}" aria-current="${cur('wall', w.id)}">벽 ${i + 1}<span>${Math.round(P.wallLength(w))} cm</span></button></li>`).join('')
  const ops = plan.openings.map((o) => `<li><button data-pick="opening:${o.id}" aria-current="${cur('opening', o.id)}">${o.kind === 'door' ? '문' : '창문'} · 벽 ${wallNo(o.wallId)}<span>${o.width} cm</span></button></li>`).join('')
  $('rs-tree').innerHTML = `<li class="grp">가구 ${plan.furniture.length}</li>${furn || '<li class="rs-note">가구 넣기에서 골라 넣어요.</li>'}<li class="grp">벽 ${plan.walls.length}</li>${walls}<li class="grp">문 · 창문 ${plan.openings.length}</li>${ops}`
}

const num = (id: string, label: string, v: number, attrs = '') => `<div class="rs-field"><label for="${id}">${label}</label><input type="number" id="${id}" value="${Math.round(v)}" ${attrs} /></div>`
const opt = (v: string, label: string, cur: string) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`
const check = (id: string, label: string, on: boolean, dis = false) => `<label class="rs-check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}/> ${label}</label>`
const FORMAT_NAME: Record<OutFormat, string> = { png: 'PNG (컬러)', jpg: 'JPG (컬러)', line: '선화', colorline: '컬러 + 선화' }

function renderInspector() {
  const el = $('rs-right')
  const cur = sel && findSel(sel)
  if (sel?.kind === 'camera' && cur) {
    const c = cur as VCamera
    el.innerHTML = `<section class="rs-sec">
      <h2>카메라</h2><p class="rs-title">${esc(c.name)}</p><p class="rs-sub">${PRESETS[c.preset].label} · ${floorName(c.floorId)} · 단위 cm</p>
      <div class="rs-fields">
        <div class="rs-field wide"><label for="c-name">이름</label><input type="text" id="c-name" value="${esc(c.name)}" /></div>
        <div class="rs-field"><label for="c-proj">투영</label><select id="c-proj">${opt('perspective', '원근', c.projection)}${opt('orthographic', '직교', c.projection)}</select></div>
        ${c.projection === 'perspective' ? num('c-fov', '화각 (°)', c.fovDeg, 'min="20" max="100" step="5"') : num('c-span', '보이는 세로 (cm)', c.orthoSpan, 'min="50" step="50"')}
        <div class="rs-field"><label for="c-aspect">비율</label><select id="c-aspect">${ASPECTS.map((a) => opt(a, a, c.aspect)).join('')}</select></div>
        <div class="rs-field"><label for="c-cut">앞쪽 벽</label><select id="c-cut">${opt('auto', '자동 숨김', c.cutaway)}${opt('none', '그대로', c.cutaway)}</select></div>
        ${num('c-x', '카메라 X', c.pos.x, 'step="10"')}${num('c-y', '카메라 Y', c.pos.y, 'step="10"')}
        ${num('c-h', '카메라 높이', c.pos.h, 'step="10"')}${num('c-th', '보는 점 높이', c.target.h, 'step="10"')}
        ${num('c-tx', '보는 점 X', c.target.x, 'step="10"')}${num('c-ty', '보는 점 Y', c.target.y, 'step="10"')}
      </div>
      <p class="rs-note">3D·평면 화면에서 <b>카메라 몸통</b>을 끌면 자리가, <b>작은 공</b>을 끌면 보는 곳이 바뀌어요.</p>
      <div class="rs-row">
        <button class="rs-btn primary" data-act="camlook">카메라로 보기</button>
        <button class="rs-btn" data-act="camgrab" ${view === 'cam' ? 'disabled title="3D·평면·걷기 보기에서 쓸 수 있어요"' : ''}>현재 시점으로 덮어쓰기</button>
        <button class="rs-btn" data-act="camfit">방에 다시 맞추기</button>
      </div>
    </section>
    <section class="rs-sec">
      <h2>이 카메라로 내보내기</h2>
      <div class="rs-fields">
        <div class="rs-field"><label for="c-fmt">형식</label><select id="c-fmt">${(Object.keys(FORMAT_NAME) as OutFormat[]).map((f) => opt(f, FORMAT_NAME[f], c.output.format)).join('')}</select></div>
        <div class="rs-field"><label for="c-size">크기</label><select id="c-size">${(['HD', 'FHD', 'QHD', '4K'] as SizeName[]).map((s) => opt(s, s, c.output.size)).join('')}</select></div>
        <div class="rs-field wide">${check('c-trans', '투명 배경', c.output.transparent, c.output.format === 'jpg')}</div>
      </div>
      <div class="rs-row"><button class="rs-btn primary" data-act="camexport">이미지 만들기</button><button class="rs-btn danger" data-act="del">카메라 삭제</button></div>
    </section>`
  } else if (sel?.kind === 'furniture' && cur) {
    const f = cur as FurnitureV2
    const t = furnitureTypeV2(f.type)
    el.innerHTML = `<section class="rs-sec">
      <h2>속성</h2><p class="rs-title">${esc(fname(f))}</p><p class="rs-sub">${t ? CATEGORY_NAME[t.category] : ''} · 기본 무료 팩 · 단위 cm</p>
      <div class="rs-fields">
        ${num('f-w', '가로', f.w, 'min="5" step="5"')}${num('f-d', '깊이', f.d, 'min="5" step="5"')}
        ${num('f-h', '높이', f.h, 'min="1" step="5"')}${num('f-rot', '회전 (°)', f.rot, 'step="15"')}
        ${num('f-x', '위치 X', f.x, 'step="5"')}${num('f-y', '위치 Y', f.y, 'step="5"')}
        <div class="rs-field wide"><label for="f-color">색</label><input type="color" id="f-color" value="${f.color}" /></div>
      </div>
      <div>${check('f-visible', '보이기', isVisible(f))}${check('f-locked', '잠금 (옮기기·삭제 막기)', !!f.locked)}${check('f-exportable', '내보내기에 포함', f.exportable !== false)}</div>
      <div class="rs-row">
        <button class="rs-btn" data-act="rot90" ${f.locked ? 'disabled' : ''}>90° 돌리기</button>
        <button class="rs-btn" data-act="dup">복제</button>
        <button class="rs-btn" data-act="sprite">스프라이트</button>
        <button class="rs-btn danger" data-act="del" ${f.locked ? 'disabled' : ''}>삭제</button>
      </div></section>`
  } else if (sel?.kind === 'wall' && cur) {
    const w = cur as Wall
    el.innerHTML = `<section class="rs-sec">
      <h2>속성</h2><p class="rs-title">벽 ${wallNo(w.id)}</p><p class="rs-sub">${floorName(project.currentFloorId)} · 단위 cm</p>
      <div class="rs-fields">${num('w-len', '길이', P.wallLength(w), 'min="20" step="10"')}${num('w-h', '높이', w.height, 'min="50" step="10"')}${num('w-t', '두께', w.thickness, 'min="2" step="1"')}</div>
      <div class="rs-row"><button class="rs-btn" data-act="adddoor">문 넣기</button><button class="rs-btn" data-act="addwin">창문 넣기</button><button class="rs-btn danger" data-act="del">삭제</button></div></section>`
  } else if (sel?.kind === 'opening' && cur) {
    const o = cur as Opening
    el.innerHTML = `<section class="rs-sec">
      <h2>속성</h2><p class="rs-title">${o.kind === 'door' ? '문' : '창문'}</p><p class="rs-sub">벽 ${wallNo(o.wallId)} · 단위 cm</p>
      <div class="rs-fields">${num('o-w', '폭', o.width, 'min="30" step="10"')}${num('o-h', '높이', o.height, 'min="30" step="5"')}${o.kind === 'window' ? num('o-sill', '바닥에서', o.sill, 'min="0" step="5"') : ''}
        <div class="rs-field wide"><label for="o-t">벽 위 위치</label><input type="range" id="o-t" min="0" max="1" step="0.01" value="${o.t}" /></div></div>
      <div class="rs-row"><button class="rs-btn danger" data-act="del">삭제</button></div></section>`
  } else {
    const b = P.planBounds(plan)
    const m2 = ((b.x1 - b.x0) * (b.y1 - b.y0)) / 10000
    const fl = PR.currentFloor(project)
    el.innerHTML = `<section class="rs-sec">
      <h2>프로젝트</h2>
      <div class="rs-fields">
        <div class="rs-field wide"><label for="pj-name">프로젝트 이름</label><input type="text" id="pj-name" value="${esc(project.name)}" /></div>
        <div class="rs-field"><label for="fl-name">이 층 이름</label><input type="text" id="fl-name" value="${esc(fl.name)}" /></div>
        ${num('pj-gap', '층 간격 (cm)', project.floorGap, 'min="200" step="10"')}
        <div class="rs-field"><label for="p-floor">바닥색</label><input type="color" id="p-floor" value="${plan.floorColor}" /></div>
        <div class="rs-field"><label for="p-wall">벽색</label><input type="color" id="p-wall" value="${plan.wallColor}" /></div>
      </div>
      <div class="rs-stat"><span>이 층 바깥 크기</span><b>${((b.x1 - b.x0) / 100).toFixed(1)} × ${((b.y1 - b.y0) / 100).toFixed(1)} m</b></div>
      <div class="rs-stat"><span>이 층 넓이 (대략)</span><b>${m2.toFixed(1)} m² · ${(m2 / 3.3058).toFixed(1)}평</b></div>
      <div class="rs-stat"><span>${CAMERA_ENABLED ? '층 · 카메라' : '층'}</span><b>${project.floors.length}개${CAMERA_ENABLED ? ` · ${project.cameras.length}개` : ''}</b></div>
    </section>
    <section class="rs-sec">
      <h2>v2 시제품에서 해볼 것</h2>
      <p class="rs-note">1. 화면 위 <b>1F · 2F</b> 탭으로 층을 바꾸고, <b>쌓아 보기</b>로 전체를 봐요.<br />${CAMERA_ENABLED ? '2. 왼쪽 <b>카메라</b>를 고르면 오른쪽 아래에 미리보기가 떠요. <b>카메라로 보기</b>로 찍힐 화면을 확인해요.<br />3' : '2'}. 위 <b>내보내기</b>에서 이미지(지금 3D 화면)·스프라이트·GLB/OBJ를 만들어요.</p>
      <p class="rs-note">내보낸 파일은 저장 버튼으로 받아요(확인 창이 떠요). 3D 파일과 스프라이트 묶음은 ZIP으로 저장돼요.</p>
    </section>`
  }
}

function renderPanels() {
  renderFloors()
  renderCams()
  renderTree()
  renderInspector()
  ;($('rs-undo') as HTMLButtonElement).disabled = !hist.canUndo()
  ;($('rs-redo') as HTMLButtonElement).disabled = !hist.canRedo()
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)))
  viewEl.querySelectorAll<HTMLButtonElement>('[data-gizmo]').forEach((b) => b.setAttribute('aria-pressed', String(gizmoOn && b.dataset.gizmo === gizmoMode)))
  ;($('rs-tools') as HTMLElement).hidden = !editable() || view === 'walk'
  $('rs-floors').hidden = view === 'cam' // 카메라로 보는 동안은 층 탭을 숨겨 버튼과 겹치지 않게
  const sh = $('rs-shutter')
  sh.dataset.mode = view
  sh.hidden = stack || !CAMERA_ENABLED || !SHUTTER_ENABLED
  renderHint()
}

/* ───── 동작 ───── */
function addFurniture(type: string) {
  const t = furnitureTypeV2(type)
  if (!t || stack) return
  const b = P.planBounds(plan), n = plan.furniture.length
  const x = P.snapTo((b.x0 + b.x1) / 2 + ((n % 3) - 1) * 30, MOVE_SNAP), y = P.snapTo((b.y0 + b.y1) / 2 + (n % 2 ? 30 : -30), MOVE_SNAP)
  const next = P.addFurniture(plan, type, x, y, t)
  setTool('select')
  commit(next)
  select({ kind: 'furniture', id: next.furniture[next.furniture.length - 1].id })
  toast(`${t.name}을(를) 넣었어요.`)
}

function newCamera(kind: Preset | 'current') {
  const id = P.nextId('cam', project.cameras.map((c) => c.id))
  const n = project.cameras.length + 1
  const room = P.planBounds(plan)
  let cam: VCamera
  if (kind === 'current') {
    const preset: Preset = view === 'plan' ? 'top' : view === 'walk' ? 'fps' : 'interior'
    cam = makeCamera(preset, id, `카메라 ${n}`, project.currentFloorId, room, '16:9')
    grabCurrentView(cam)
  } else {
    cam = makeCamera(kind, id, `${PRESETS[kind].label} ${n}`, project.currentFloorId, room, '16:9', 250, walkStart(plan))
  }
  const next = PR.upsertCamera(project, cam)
  if (next === project) { toast('카메라는 50개까지 만들 수 있어요.'); return }
  commitProject(next)
  select({ kind: 'camera', id })
}
// 카메라를 고르면 그 카메라가 있는 층으로 간다 (다른 층에 있으면 아이콘·미리보기가 안 보이므로)
function goToCameraFloor(id: string) {
  const c = camById(id)
  if (!c) return
  if (view === 'cam') setView('3d')
  if (stack || c.floorId !== project.currentFloorId) {
    stack = false
    project = PR.selectFloor(project, c.floorId)
    syncPlan(); endWall()
    rebuild(); fit()
    toast(`${floorName(c.floorId)}로 이동했어요.`)
  }
}
// 지금 편집 화면의 시점을 카메라에 복사. 3D·걷기는 원근, 평면은 바로 위에서 보는 직교 카메라가 된다
function grabCurrentView(c: VCamera) {
  if (view === 'plan') {
    const t = orbitPlan.target
    c.projection = 'orthographic'
    c.target = { x: Math.round(t.x), y: Math.round(t.z), h: 0 }
    c.pos = { x: c.target.x, y: c.target.y, h: 5000 }
    c.orthoSpan = Math.max(50, Math.round((ortho.top - ortho.bottom) / ortho.zoom))
    return
  }
  if (view === 'walk') {
    const p = persp.position, f = persp.getWorldDirection(new THREE.Vector3())
    c.projection = 'perspective'
    c.pos = { x: Math.round(p.x), y: Math.round(p.z), h: Math.round(p.y) }
    c.target = { x: Math.round(p.x + f.x * 300), y: Math.round(p.z + f.z * 300), h: Math.round(p.y + f.y * 300) }
    c.fovDeg = Math.round(persp.fov)
    return
  }
  if (view === 'cam' && camView) {
    const v = camById(camView)
    if (v) { c.projection = v.projection; c.pos = { ...v.pos }; c.target = { ...v.target }; c.fovDeg = v.fovDeg; c.orthoSpan = v.orthoSpan; c.aspect = v.aspect }
    return
  }
  const t = orbit3d.target, p = persp.position
  c.pos = { x: Math.round(p.x), y: Math.round(p.z), h: Math.round(p.y) }
  c.target = { x: Math.round(t.x), y: Math.round(t.z), h: Math.round(t.y) }
  if (c.projection === 'perspective') c.fovDeg = Math.round(persp.fov)
  else c.orthoSpan = Math.round(2 * p.distanceTo(t) * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2))
}

function act(a: string) {
  if (a === 'addfloor') { commitProject(PR.addFloor(project)); select(null); fit(); toast('새 층을 만들었어요. 아래층 벽·문·창문을 복사했어요.'); return }
  if (a === 'stack') { stack = !stack; if (stack && view !== '3d') setView('3d'); select(null); rebuild(); fit(); renderPanels(); return }
  if (!sel) return
  const s = sel
  if (s.kind === 'camera') {
    const c = camById(s.id)
    if (!c) return
    if (a === 'del') { sel = null; commitProject(PR.removeCamera(project, c.id)); return }
    if (a === 'camlook') { lookThrough(c.id); return }
    if (a === 'camgrab') { const nc = { ...c, pos: { ...c.pos }, target: { ...c.target }, floorId: project.currentFloorId }; grabCurrentView(nc); commitProject(PR.upsertCamera(project, nc)); toast('지금 화면 시점을 카메라에 담았어요.'); return }
    if (a === 'camfit') {
      const fl = project.floors.find((f) => f.id === c.floorId)
      const room = P.planBounds(fl ? fl.plan : plan)
      const fresh = makeCamera(c.preset, c.id, c.name, c.floorId, room, c.aspect, 250, walkStart(fl ? fl.plan : plan))
      commitProject(PR.upsertCamera(project, { ...fresh, projection: c.projection, output: c.output, cutaway: c.cutaway }))
      return
    }
    if (a === 'camexport') { openExport('image', c.id); return }
    return
  }
  if (a === 'del') {
    if (s.kind === 'furniture' && isLocked(s.id)) return
    const next = s.kind === 'furniture' ? P.removeFurniture(plan, s.id) : s.kind === 'wall' ? P.removeWall(plan, s.id) : P.removeOpening(plan, s.id)
    sel = null
    commit(next)
    return
  }
  if (s.kind === 'furniture') {
    const f = findSel(s) as FurnitureV2
    if (a === 'rot90' && !f.locked) commit(P.updateFurniture(plan, f.id, { rot: normDeg(f.rot + 90) }))
    if (a === 'dup') {
      const next = P.addFurniture(plan, f.type, f.x + 30, f.y + 30, f)
      const id = next.furniture[next.furniture.length - 1].id
      commit(P.updateFurniture(next, id, { rot: f.rot }))
      select({ kind: 'furniture', id })
    }
    if (a === 'sprite') openExport('sprite')
  }
  if (s.kind === 'wall' && (a === 'adddoor' || a === 'addwin')) {
    const next = P.addOpening(plan, s.id, 0.5, a === 'adddoor' ? 'door' : 'window')
    if (next === plan) { toast('벽 가운데에 이미 문이나 창문이 있어요.'); return }
    commit(next)
    select({ kind: 'opening', id: next.openings[next.openings.length - 1].id })
  }
}

function onField(id: string, raw: string, checked: boolean) {
  const v = Number(raw)
  if (id === 'pj-name') return commitProject({ ...project, name: raw.trim() || project.name })
  if (id === 'fl-name') { const n = PR.renameFloor(project, project.currentFloorId, raw); if (n === project) { toast('비었거나 다른 층과 같은 이름이에요.'); renderPanels() } else commitProject(n); return }
  if (id === 'pj-gap') return Number.isFinite(v) && commitProject({ ...project, floorGap: Math.max(200, v) })
  if (id === 'p-floor') return commit({ ...plan, floorColor: raw })
  if (id === 'p-wall') return commit({ ...plan, wallColor: raw })
  const s = sel
  if (!s) return
  if (s.kind === 'camera') {
    const c = camById(s.id)
    if (!c) return
    const nc: VCamera = { ...c, pos: { ...c.pos }, target: { ...c.target }, output: { ...c.output } }
    if (id === 'c-name') { const name = raw.trim().slice(0, 30); if (!name || project.cameras.some((q) => q.id !== c.id && q.name === name)) { toast('비었거나 다른 카메라와 같은 이름이에요.'); renderPanels(); return } nc.name = name }
    if (id === 'c-proj') {
      nc.projection = raw as VCamera['projection']
      if (nc.projection === 'orthographic') nc.orthoSpan = fitOrthoSpan(nc, P.planBounds(plan))
    }
    if (id === 'c-fov' && Number.isFinite(v)) nc.fovDeg = Math.min(100, Math.max(20, v))
    if (id === 'c-span' && Number.isFinite(v)) nc.orthoSpan = Math.max(50, v)
    if (id === 'c-aspect') nc.aspect = raw as Aspect
    if (id === 'c-cut') nc.cutaway = raw === 'none' ? 'none' : 'auto'
    if (id === 'c-x' && Number.isFinite(v)) nc.pos.x = v
    if (id === 'c-y' && Number.isFinite(v)) nc.pos.y = v
    if (id === 'c-tx' && Number.isFinite(v)) nc.target.x = v
    if (id === 'c-ty' && Number.isFinite(v)) nc.target.y = v
    if (id === 'c-h' && Number.isFinite(v)) nc.pos.h = v
    if (id === 'c-th' && Number.isFinite(v)) nc.target.h = v
    if (id === 'c-fmt') { nc.output.format = raw as OutFormat; if (raw === 'jpg') nc.output.transparent = false }
    if (id === 'c-size') nc.output.size = raw as SizeName
    if (id === 'c-trans') nc.output.transparent = checked && nc.output.format !== 'jpg'
    commitProject(PR.upsertCamera(project, nc))
    if (view === 'cam' && camView === c.id) ($('rs-frame-name') as HTMLElement).textContent = `${nc.name} · ${PRESETS[nc.preset].label} · ${nc.aspect}`
    return
  }
  if (s.kind === 'furniture') {
    const f = findSel(s) as FurnitureV2
    if (id === 'f-color') return commit(P.updateFurniture(plan, s.id, { color: raw }))
    if (id === 'f-visible') return commit(P.updateFurniture(plan, s.id, { visible: checked } as Partial<FurnitureV2>))
    if (id === 'f-locked') return commit(P.updateFurniture(plan, s.id, { locked: checked } as Partial<FurnitureV2>))
    if (id === 'f-exportable') return commit(P.updateFurniture(plan, s.id, { exportable: checked } as Partial<FurnitureV2>))
    if (f.locked && /^f-(x|y|rot)$/.test(id)) { toast('잠긴 가구예요.'); renderPanels(); return }
    if (!Number.isFinite(v)) return renderPanels()
    const map: Record<string, Partial<FurnitureV2>> = { 'f-w': { w: Math.max(5, v) }, 'f-d': { d: Math.max(5, v) }, 'f-h': { h: Math.max(1, v) }, 'f-rot': { rot: normDeg(v) }, 'f-x': { x: v }, 'f-y': { y: v } }
    if (map[id]) commit(P.updateFurniture(plan, s.id, map[id]))
  } else if (s.kind === 'wall') {
    if (!Number.isFinite(v)) return renderPanels()
    const w = findSel(s) as Wall
    if (id === 'w-len') { const len = Math.max(P.MIN_WALL, v), cur = P.wallLength(w); commit(P.updateWall(plan, w.id, { b: { x: Math.round(w.a.x + ((w.b.x - w.a.x) / cur) * len), y: Math.round(w.a.y + ((w.b.y - w.a.y) / cur) * len) } })) }
    if (id === 'w-h') commit(P.updateWall(plan, w.id, { height: Math.max(50, v) }))
    if (id === 'w-t') commit(P.updateWall(plan, w.id, { thickness: Math.max(2, v) }))
  } else if (s.kind === 'opening') {
    if (!Number.isFinite(v)) return renderPanels()
    const map: Record<string, Partial<Opening>> = { 'o-w': { width: Math.max(30, v) }, 'o-h': { height: Math.max(30, v) }, 'o-sill': { sill: Math.max(0, v) }, 'o-t': { t: v } }
    if (!map[id]) return
    const next = P.updateOpening(plan, s.id, map[id])
    if (next === plan) { toast('다른 문·창문과 겹쳐서 바꿀 수 없어요.'); renderPanels(); return }
    commit(next)
  }
}

root.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('button')
  if (!t) return
  const d = t.dataset
  if (d.view) { if (stack && d.view !== '3d') { stack = false; rebuild() } setView(d.view as View) }
  else if (d.tool) setTool(d.tool as Tool)
  else if (d.gizmo) { const m = d.gizmo as 'translate' | 'rotate'; gizmoOn = !(gizmoOn && gizmoMode === m); gizmoMode = m; attachGizmo(); renderPanels() }
  else if (d.add) addFurniture(d.add)
  else if (d.newcam) newCamera(d.newcam as Preset | 'current')
  else if (d.floor) { const wasStack = stack; stack = false; if (view === 'cam') setView('3d'); if (d.floor !== project.currentFloorId || wasStack) switchFloor(d.floor) }
  else if (d.floorup) commitProject(PR.moveFloor(project, d.floorup, 1))
  else if (d.floordown) commitProject(PR.moveFloor(project, d.floordown, -1))
  else if (d.floordup) { commitProject(PR.duplicateFloor(project, d.floordup)); select(null) }
  else if (d.floordel) {
    if (project.floors.length <= 1) return
    const f = project.floors.find((x) => x.id === d.floordel)
    if (!t.dataset.confirm) { t.dataset.confirm = '1'; t.textContent = '?'; toast(`${f?.name ?? ''}을(를) 지우려면 ✕를 한 번 더 누르세요. 되돌리기로 되살릴 수 있어요.`); setTimeout(() => { if (t.isConnected) { delete t.dataset.confirm; t.textContent = '✕' } }, 3000); return }
    sel = null
    commitProject(PR.removeFloor(project, d.floordel))
  }
  else if (d.pick) {
    const [kind, id] = d.pick.split(':')
    if (kind === 'camera') goToCameraFloor(id)
    setTool('select')
    select({ kind: kind as NonNullable<Sel>['kind'], id })
  }
  else if (d.act) act(d.act)
  else if (t.id === 'rs-undo') undo()
  else if (t.id === 'rs-redo') redo()
  else if (t.id === 'rs-fit') fit()
  else if (t.id === 'rs-file') openFile()
  else if (t.id === 'rs-export') openExport('image')
  else if (t.id === 'rs-shot') shoot()
  else if (t.id === 'rs-shotsave') { if (lastShot) saveFile(lastShot.blob, lastShot.name) }
  else if (d.zoom) { pilotZoom(Number(d.zoom)); commitPilotSoon() }
})
$('rs-right').addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (t.id) onField(t.id, t.value, t.checked) })
$('rs-template').addEventListener('change', (e) => {
  const s = e.target as HTMLSelectElement
  const t = findTemplate(s.value)
  s.value = ''
  if (!t || stack) return
  sel = null
  setTool('select')
  commit({ ...t.build(), name: PR.currentFloor(project).name })
  fit()
  toast(`이 층을 ${t.name}(으)로 바꿨어요. 되돌리기로 돌아갈 수 있어요.`)
})

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('.rs-modal')) return
  const k = e.key.toLowerCase()
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return }
  if (view === 'walk') {
    if (k === ' ' && SHUTTER_ENABLED) { e.preventDefault(); shoot(); return }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); e.preventDefault() }
    if (k === 'escape') setView('3d')
    return
  }
  if (view === 'cam') {
    if (k === 'escape') { setView('3d'); return }
    if (!PILOT_ENABLED) return
    if (k === ' ') { e.preventDefault(); shoot(); return }
    if (['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); e.preventDefault() }
    if (k === '+' || k === '=') { pilotZoom(1); commitPilotSoon() }
    if (k === '-') { pilotZoom(-1); commitPilotSoon() }
    return
  }
  if (k === ' ' && view !== 'plan' && SHUTTER_ENABLED) { e.preventDefault(); shoot(); return }
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
window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); if (view === 'cam') commitPilotSoon() })
viewEl.addEventListener('wheel', (e) => {
  if (view !== 'cam' || !PILOT_ENABLED) return
  e.preventDefault()
  pilotZoom(e.deltaY < 0 ? 1 : -1)
  commitPilotSoon()
}, { passive: false })
window.addEventListener('blur', () => { keys.clear(); padHeld.clear() })

/* ───── 모달 공통 ───── */
function modal(html: string): { el: HTMLElement; close: () => void } {
  const m = document.createElement('div')
  m.className = 'rs-modal'
  m.innerHTML = `<div class="rs-dialog" role="dialog" aria-modal="true">${html}</div>`
  document.body.appendChild(m)
  const close = () => { m.querySelectorAll<HTMLImageElement>('img[data-blob]').forEach((i) => URL.revokeObjectURL(i.src)); m.remove() }
  m.addEventListener('click', (e) => { if (e.target === m) close() })
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
  return { el: m, close }
}

/* ───── 저장 · 불러오기 (v1 파일은 자동 변환, 원본은 그대로) ───── */
function openFile() {
  const { el, close } = modal(`<h3>저장 · 불러오기</h3>
    <p class="rs-note">작업은 이 브라우저에 자동 저장돼요(기존 Skela Room과 따로). 예전 Skela Room에서 복사한 평면도도 붙여넣으면 1F로 바꿔서 열어요.</p>
    <textarea id="rs-json" spellcheck="false">${esc(JSON.stringify(PR.toProjectFile(project)))}</textarea>
    <div class="rs-row"><button class="rs-btn primary" id="rs-copy">복사</button><button class="rs-btn" id="rs-apply">붙여넣은 내용 불러오기</button><button class="rs-btn" id="rs-sample">예시 프로젝트로</button>${OLD_STORE_KEYS.some((k) => { try { return !!localStorage.getItem(k) } catch { return false } }) ? '<button class="rs-btn" id="rs-old">예전 작업 불러오기</button>' : ''}<span class="rs-spacer"></span><button class="rs-btn" id="rs-close">닫기</button></div>
    <p class="rs-err" id="rs-err" hidden></p>`)
  const ta = el.querySelector('#rs-json') as HTMLTextAreaElement
  const err = el.querySelector('#rs-err') as HTMLElement
  el.querySelector('#rs-close')?.addEventListener('click', close)
  el.querySelector('#rs-copy')?.addEventListener('click', () => navigator.clipboard.writeText(ta.value).then(() => toast('복사했어요.'), () => { ta.focus(); ta.select(); toast('선택해 두었어요. Ctrl+C로 복사하세요.') }))
  el.querySelector('#rs-old')?.addEventListener('click', () => {
    for (const k of OLD_STORE_KEYS) {
      try {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        const { project: p } = PR.fromAnyFile(JSON.parse(raw))
        sel = null; stack = false
        commitProject(p); fit(); close()
        toast('예전 작업을 불러왔어요. 되돌리기로 예시 집으로 돌아갈 수 있어요.')
        return
      } catch { /* 다음 칸 */ }
    }
    toast('불러올 예전 작업이 없어요.')
  })
  el.querySelector('#rs-sample')?.addEventListener('click', () => { sel = null; stack = false; commitProject(sampleProject()); fit(); close(); toast('예시 프로젝트를 열었어요. 되돌리기로 돌아갈 수 있어요.') })
  el.querySelector('#rs-apply')?.addEventListener('click', () => {
    try {
      const { project: p, migrated } = PR.fromAnyFile(JSON.parse(ta.value))
      sel = null; stack = false
      commitProject(p); fit(); close()
      toast(migrated ? `옛 형식(v1)을 1F로 바꿔서 열었어요. 붙여넣은 원본은 바뀌지 않아요.` : `'${p.name}'을(를) 불러왔어요.`)
    } catch (ex) {
      err.hidden = false
      err.textContent = ex instanceof SyntaxError ? 'JSON 형식이 아니에요.' : (ex as Error).message
    }
  })
}

/* ───── 내보내기: 편집 장면을 건드리지 않고 전용 장면을 새로 만든다 ───── */
let expRenderer: THREE.WebGLRenderer | null = null
function exportRenderer() {
  if (!expRenderer) {
    expRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    expRenderer.setPixelRatio(1)
    expRenderer.shadowMap.enabled = true
    expRenderer.shadowMap.type = THREE.PCFSoftShadowMap
  }
  return expRenderer
}
type ImgOpts = { format: OutFormat; transparent: boolean; onlyFurniture?: string }
const LINE_COLOR = 0x1d2120
const BG = { png: '#eef0ec', jpg: '#eef0ec', line: '#ffffff', colorline: '#f6f4ef' } as const

// 내보내기 전용 장면: 도우미·격자 없음, 숨김·제외 가구 없음, 카메라 쪽 벽 잘라내기
function buildExportScene(c: VCamera, o: ImgOpts) {
  const fl = project.floors.find((f) => f.id === c.floorId) ?? PR.currentFloor(project)
  const s = new THREE.Scene()
  s.background = o.transparent ? null : new THREE.Color(BG[o.format])
  const lit = addLights(s)
  aimSun(lit, P.planBounds(fl.plan))
  lit.castShadow = o.format !== 'line'
  const hide = c.cutaway === 'auto' ? cutawayWalls(fl.plan, { x: c.pos.x, y: c.pos.y }) : new Set<string>()
  const boxes = buildBoxesV2(fl.plan, o.onlyFurniture ? { onlyFurniture: o.onlyFurniture } : { forExport: true, hideWalls: hide })
  const lines = o.format === 'line' || o.format === 'colorline'
  const mats = new Map<string, THREE.Material>()
  const matFor = (b: SceneBox): THREE.Material => {
    const glass = (b.opacity ?? 1) < 1
    const key = `${o.format === 'line' ? 'white' : b.color}|${glass}`
    let m = mats.get(key)
    if (!m) {
      m = o.format === 'line'
        ? new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: glass, opacity: glass ? 0.25 : 1 })
        : new THREE.MeshStandardMaterial({ color: b.color, roughness: glass ? 0.1 : 0.75, transparent: glass, opacity: b.opacity ?? 1, flatShading: o.format === 'colorline' })
      if (lines) { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1 }
      mats.set(key, m)
    }
    return m
  }
  const g = new THREE.Group()
  const meshes = addBoxes(g, fl.plan, boxes, 0, false, matFor)
  s.add(g)
  const lineMats: LineMaterial[] = []
  if (lines) {
    s.updateMatrixWorld(true)
    const lm = new LineMaterial({ color: LINE_COLOR, linewidth: 1.5 })
    lineMats.push(lm)
    const pos: number[] = []
    const v = new THREE.Vector3()
    for (const m of meshes) {
      const eg = new THREE.EdgesGeometry(m.geometry, 30)
      const a = eg.attributes.position
      for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld); pos.push(v.x, v.y, v.z) }
      eg.dispose()
    }
    const geo = new LineSegmentsGeometry()
    geo.setPositions(pos)
    s.add(new LineSegments2(geo, lm))
  }
  return { scene: s, lineMats, floor: fl }
}

// 큰 이미지는 2048px 이하 조각으로 그려서 이어 붙인다. 선 굵기는 긴 변 1920 기준 1.5px에 비례
async function renderImage(c: VCamera, o: ImgOpts, w: number, h: number, onProgress?: (r: number) => void): Promise<HTMLCanvasElement> {
  const r = exportRenderer()
  const { scene: s, lineMats } = buildExportScene(c, o)
  const cam = threeCam(c, 0, w / h)
  const out = document.createElement('canvas')
  out.width = w; out.height = h
  const ctx = out.getContext('2d') as CanvasRenderingContext2D
  const maxTex = Math.min(TILE_MAX, r.capabilities.maxTextureSize || TILE_MAX)
  const ts = tiles(w, h, maxTex)
  const lw = Math.max(1, 1.5 * (Math.max(w, h) / 1920))
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]
    r.setSize(t.w, t.h, false)
    r.setClearColor(0x000000, 0)
    for (const lm of lineMats) { lm.linewidth = lw; lm.resolution.set(t.w, t.h) }
    cam.setViewOffset(w, h, t.x, t.y, t.w, t.h)
    cam.updateProjectionMatrix()
    r.render(s, cam)
    ctx.drawImage(r.domElement, t.x, t.y)
    onProgress?.((i + 1) / ts.length)
    await new Promise((res) => setTimeout(res, 0))
  }
  disposeGroup(s)
  if (o.format === 'jpg') { // JPG는 투명이 없으니 배경을 깔아 준다
    const flat = document.createElement('canvas'); flat.width = w; flat.height = h
    const fc = flat.getContext('2d') as CanvasRenderingContext2D
    fc.fillStyle = BG.jpg; fc.fillRect(0, 0, w, h); fc.drawImage(out, 0, 0)
    return flat
  }
  return out
}
const toBlob = (cv: HTMLCanvasElement, type: string) => new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('이미지를 만들지 못했어요.'))), type, 0.92))
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
// 파일 저장: claude.ai에서는 downloads 기능(저장 확인 창), 일반 웹사이트에서는 브라우저 다운로드
type DownloadsApi = { save: (r: { filename: string; data: Blob }) => Promise<{ status: string }> }
let downloadsApi: DownloadsApi | null = null
const claudeRt = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude
claudeRt?.use?.('downloads').then((d) => { downloadsApi = (d as DownloadsApi) ?? null }).catch(() => { downloadsApi = null })
async function saveFile(blob: Blob, name: string) {
  if (downloadsApi) {
    try {
      const r = await downloadsApi.save({ filename: name, data: blob })
      toast(r.status === 'delivered' ? '파일을 보냈어요.' : `${name}을(를) 저장했어요.`)
    } catch (e) {
      const code = (e as { code?: string }).code
      toast(code === 'declined' ? '저장을 취소했어요.' : code === 'rate_limited' ? '저장 창이 이미 열려 있어요. 잠시 뒤 다시 눌러주세요.' : code === 'host_unavailable' ? '이 앱에서는 저장할 수 없어요. 브라우저나 컴퓨터에서 열어주세요.' : '여기서는 저장할 수 없어요.')
    }
    return
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
function dlLink(blob: Blob, name: string, label?: string) {
  const b = document.createElement('button')
  b.type = 'button'; b.className = 'rs-btn primary'
  b.textContent = label ?? `저장 · ${name} (${kb(blob.size)})`
  b.title = name
  b.addEventListener('click', () => saveFile(blob, name))
  return b
}
async function zipBlob(files: { name: string; blob: Blob | string }[]): Promise<Blob> {
  const enc = new TextEncoder()
  const entries: ZipEntry[] = []
  for (const f of files) entries.push({ name: f.name, data: typeof f.blob === 'string' ? enc.encode(f.blob) : new Uint8Array(await f.blob.arrayBuffer()) })
  return new Blob([makeZip(entries)], { type: 'application/zip' })
}
const ASSET_README = 'Skela Room 3D export\nunits: 1 = 1 m, Y up, right-handed\nfront of furniture: +Z\nsingle item: origin at bottom center\n'

// 가구 하나 스프라이트: 그 가구만, 일러스트 2:1 카메라로 맞춘 뒤 투명 여백을 잘라낸다
async function renderSprite(fid: string, format: OutFormat): Promise<HTMLCanvasElement | null> {
  const f = plan.furniture.find((q) => q.id === fid)
  if (!f) return null
  const ex = Math.max(f.w, f.d) / 2 + 10
  const room = { x0: f.x - ex, x1: f.x + ex, y0: f.y - ex, y1: f.y + ex }
  const cam = makeCamera('illust', 'sprite', 'sprite', project.currentFloorId, room, '1:1', f.h + 5)
  cam.cutaway = 'none'
  const S = 512
  const cv = await renderImage(cam, { format, transparent: true, onlyFurniture: fid }, S, S)
  const data = (cv.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, S, S).data
  const bb = alphaBounds(data, S, S, 8)
  if (!bb) return null
  const out = document.createElement('canvas'); out.width = bb.w; out.height = bb.h
  ;(out.getContext('2d') as CanvasRenderingContext2D).drawImage(cv, bb.x, bb.y, bb.w, bb.h, 0, 0, bb.w, bb.h)
  return out
}

// 3D 에셋: m 단위, Y가 위. scope: 프로젝트 전체 / 이 층 / 고른 가구(바닥 가운데 원점, 회전 0)
function buildAsset(scope: 'project' | 'floor' | 'item', ascii: boolean): { root: THREE.Group; count: number; size: THREE.Vector3 } | null {
  const rootG = new THREE.Group()
  rootG.name = ascii ? asciiName(project.name) || 'skela' : project.name
  const mats = new Map<string, THREE.MeshStandardMaterial>()
  const matFor = (b: SceneBox) => {
    const op = b.opacity ?? 1
    const key = `${b.color}|${op}`
    let m = mats.get(key)
    if (!m) { m = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.75, transparent: op < 1, opacity: op }); m.name = `m_${b.color.replace('#', '')}${op < 1 ? '_glass' : ''}`; mats.set(key, m) }
    return m
  }
  let count = 0
  const addMesh = (parent: THREE.Object3D, b: SceneBox, dx = 0, dy = 0, dz = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w / 100, b.h / 100, b.d / 100), matFor(b))
    mesh.position.set((b.cx + dx) / 100, (b.cy + dy) / 100, (b.cz + dz) / 100)
    mesh.rotation.y = -THREE.MathUtils.degToRad(b.rotDeg)
    mesh.name = ascii ? asciiName(b.id.replace(/:/g, '_')) : b.id
    parent.add(mesh)
    count++
  }
  if (scope === 'item') {
    if (sel?.kind !== 'furniture') return null
    const f = plan.furniture.find((q) => q.id === sel!.id) as FurnitureV2 | undefined
    if (!f) return null
    const at0 = { ...f, x: 0, y: 0, rot: 0 }
    const raw = furnitureBoxesV2(at0, true)
    const minY = Math.min(...raw.map((b) => b.cy - b.h / 2)) // 원래 크기 기준 바닥
    const g = new THREE.Group()
    g.name = ascii ? asciiName(`${f.id}_${f.type}`) : `${fname(f)} (${f.id})`
    for (const b of furnitureBoxesV2(at0)) addMesh(g, b, 0, -minY, 0)
    rootG.add(g)
  } else {
    const floors = scope === 'project' ? project.floors : [PR.currentFloor(project)]
    for (const fl of floors) {
      const elev = scope === 'project' ? PR.floorElevation(project, fl.id) : 0
      const fg = new THREE.Group(); fg.name = ascii ? asciiName(fl.id) : fl.name
      const parts: Record<string, THREE.Group> = {}
      const part = (k: string, label: string) => (parts[k] ??= Object.assign(new THREE.Group(), { name: ascii ? k : label }))
      for (const b of buildBoxesV2(fl.plan, { forExport: true })) {
        if (b.kind === 'furniture') {
          const fid = b.id.split(':')[0]
          const f = fl.plan.furniture.find((q) => q.id === fid) as FurnitureV2
          const pg = part('furniture', '가구')
          let ig = pg.getObjectByName(ascii ? asciiName(`${fid}_${f.type}`) : `${fname(f)} (${fid})`) as THREE.Group | undefined
          if (!ig) { ig = new THREE.Group(); ig.name = ascii ? asciiName(`${fid}_${f.type}`) : `${fname(f)} (${fid})`; pg.add(ig) }
          addMesh(ig, b, 0, elev, 0)
        } else addMesh(part(b.kind === 'wall' ? 'walls' : b.kind === 'floor' ? 'floor' : 'openings', b.kind === 'wall' ? '벽' : b.kind === 'floor' ? '바닥' : '문·창문'), b, 0, elev, 0)
      }
      Object.values(parts).forEach((p) => fg.add(p))
      rootG.add(fg)
    }
  }
  const size = new THREE.Box3().setFromObject(rootG).getSize(new THREE.Vector3())
  return { root: rootG, count, size }
}

function openExport(tab: 'image' | 'sprite' | '3d', camId?: string) {
  const firstCam = CAMERA_ENABLED ? camId ?? (sel?.kind === 'camera' ? sel.id : project.cameras[0]?.id) : undefined
  const { el, close } = modal(`<h3>내보내기</h3>
    <div class="rs-tabs" role="tablist">
      <button role="tab" data-tab="image">이미지</button><button role="tab" data-tab="sprite">가구 스프라이트</button><button role="tab" data-tab="3d">3D 파일</button>
    </div>
    <div class="rs-exp" id="x-body"></div>
    <div class="rs-progress" id="x-prog" hidden><i></i></div>
    <div class="rs-result" id="x-out"></div>
    <p class="rs-note">저장 버튼을 누르면 저장 확인 창이 떠요. 3D 파일은 ZIP으로 묶어서 저장해요.</p>
    <div class="rs-row"><span class="rs-spacer"></span><button class="rs-btn" id="x-close">닫기</button></div>`)
  el.querySelector('#x-close')?.addEventListener('click', close)
  const body = el.querySelector('#x-body') as HTMLElement
  const out = el.querySelector('#x-out') as HTMLElement
  const prog = el.querySelector('#x-prog') as HTMLElement
  const bar = prog.querySelector('i') as HTMLElement
  const setProg = (r: number | null) => { prog.hidden = r === null; bar.style.width = `${Math.round((r ?? 0) * 100)}%` }
  let busy = false
  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    busy = true; out.innerHTML = ''; setProg(0)
    try { await fn() } catch (e) { out.innerHTML = `<p class="rs-err">${esc((e as Error).message || '내보내기에 실패했어요.')}</p>` }
    busy = false; setProg(null)
  }
  const show = (t: 'image' | 'sprite' | '3d') => {
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)))
    out.innerHTML = ''
    if (t === 'image') {
      const c = camById(firstCam ?? '')
      body.innerHTML = `<div class="rs-fields">
        <div class="rs-field"><label for="x-cam">카메라</label><select id="x-cam">${CAMERA_ENABLED ? project.cameras.map((q) => opt(q.id, `${q.name} (${floorName(q.floorId)})`, firstCam ?? '')).join('') : ''}${opt('__view', '지금 3D 화면 시점', CAMERA_ENABLED && project.cameras.length ? '' : '__view')}</select></div>
        <div class="rs-field"><label for="x-fmt">형식</label><select id="x-fmt">${(Object.keys(FORMAT_NAME) as OutFormat[]).map((f) => opt(f, FORMAT_NAME[f], c?.output.format ?? 'png')).join('')}</select></div>
        <div class="rs-field"><label for="x-size">크기</label><select id="x-size">${(['HD', 'FHD', 'QHD', '4K'] as SizeName[]).map((s) => opt(s, s, c?.output.size ?? 'FHD')).join('')}</select></div>
        <div class="rs-field">${check('x-trans', '투명 배경', !!c?.output.transparent)}</div>
      </div><div class="rs-row"><button class="rs-btn primary" id="x-go">이미지 만들기</button></div>`
      const syncFromCam = () => {
        const q = camById((body.querySelector('#x-cam') as HTMLSelectElement).value)
        if (!q) return
        ;(body.querySelector('#x-fmt') as HTMLSelectElement).value = q.output.format
        ;(body.querySelector('#x-size') as HTMLSelectElement).value = q.output.size
        ;(body.querySelector('#x-trans') as HTMLInputElement).checked = q.output.transparent
      }
      body.querySelector('#x-cam')?.addEventListener('change', syncFromCam)
      body.querySelector('#x-fmt')?.addEventListener('change', () => { const j = (body.querySelector('#x-fmt') as HTMLSelectElement).value === 'jpg'; const tr = body.querySelector('#x-trans') as HTMLInputElement; tr.disabled = j; if (j) tr.checked = false })
      body.querySelector('#x-go')?.addEventListener('click', () => run(async () => {
        const cid = (body.querySelector('#x-cam') as HTMLSelectElement).value
        let cam = camById(cid)
        if (!cam) { cam = makeCamera('interior', 'view', '지금 화면', project.currentFloorId, P.planBounds(plan), '16:9'); grabCurrentView(cam) }
        const format = (body.querySelector('#x-fmt') as HTMLSelectElement).value as OutFormat
        const transparent = format !== 'jpg' && (body.querySelector('#x-trans') as HTMLInputElement).checked
        const size = (body.querySelector('#x-size') as HTMLSelectElement).value as SizeName
        const { w, h } = outputSize(size, cam.aspect)
        const cv = await renderImage(cam, { format, transparent }, w, h, setProg)
        const blob = await toBlob(cv, format === 'jpg' ? 'image/jpeg' : 'image/png')
        const name = fileName([project.name, floorName(cam.floorId), cam.name, `${w}x${h}`], format === 'jpg' ? 'jpg' : 'png')
        const img = document.createElement('img'); img.src = URL.createObjectURL(blob); img.dataset.blob = '1'; img.alt = name
        const dl = document.createElement('div'); dl.className = 'rs-dl'; dl.append(dlLink(blob, name))
        const info = document.createElement('p'); info.className = 'rs-note'; info.textContent = `${w}×${h}px · ${FORMAT_NAME[format]}${transparent ? ' · 투명' : ''} · ${PRESETS[cam.preset].label}`
        out.replaceChildren(img, info, dl)
      }))
    } else if (t === 'sprite') {
      const one = sel?.kind === 'furniture'
      body.innerHTML = `<div class="rs-fields">
        <div class="rs-field"><label for="x-scope">대상</label><select id="x-scope">${one ? opt('one', '고른 가구', 'one') : ''}${opt('floor', `${floorName(project.currentFloorId)} 모든 가구`, one ? 'one' : 'floor')}</select></div>
        <div class="rs-field"><label for="x-sfmt">모양</label><select id="x-sfmt">${opt('colorline', '컬러 + 선화', 'colorline')}${opt('png', '컬러', '')}${opt('line', '선화', '')}</select></div>
      </div><p class="rs-note">게임 에셋에 많이 쓰는 2:1 각도로, 가구마다 투명 배경 PNG를 만들고 빈 곳을 잘라내요.</p>
      <div class="rs-row"><button class="rs-btn primary" id="x-go">스프라이트 만들기</button></div>`
      body.querySelector('#x-go')?.addEventListener('click', () => run(async () => {
        const scope = (body.querySelector('#x-scope') as HTMLSelectElement).value
        const format = (body.querySelector('#x-sfmt') as HTMLSelectElement).value as OutFormat
        const list = (scope === 'one' && sel?.kind === 'furniture' ? plan.furniture.filter((f) => f.id === sel!.id) : (plan.furniture as FurnitureV2[]).filter((f) => f.exportable !== false && f.visible !== false))
        const gal = document.createElement('div'); gal.className = 'rs-gallery'
        out.replaceChildren(gal)
        const made: { name: string; blob: Blob }[] = []
        for (let i = 0; i < list.length; i++) {
          const f = list[i] as FurnitureV2
          const cv = await renderSprite(f.id, format)
          setProg((i + 1) / list.length)
          if (!cv) continue
          const blob = await toBlob(cv, 'image/png')
          const name = fileName([project.name, fname(f), f.id], 'png')
          made.push({ name, blob })
          const fig = document.createElement('figure')
          const img = document.createElement('img'); img.src = URL.createObjectURL(blob); img.dataset.blob = '1'; img.alt = name
          const cap = document.createElement('figcaption'); cap.textContent = `${fname(f)} · ${cv.width}×${cv.height}`
          fig.append(img, cap, dlLink(blob, name, '저장'))
          gal.append(fig)
        }
        if (!gal.children.length) { out.innerHTML = '<p class="rs-note">내보낼 가구가 없어요.</p>'; return }
        if (made.length > 1) {
          const z = await zipBlob(made)
          const row = document.createElement('div'); row.className = 'rs-dl'
          row.append(dlLink(z, fileName([project.name, floorName(project.currentFloorId), 'sprites'], 'zip'), `스프라이트 ${made.length}장 ZIP으로 저장 (${kb(z.size)})`))
          out.prepend(row)
        }
      }))
    } else {
      const one = sel?.kind === 'furniture'
      body.innerHTML = `<div class="rs-fields">
        <div class="rs-field"><label for="x-3fmt">형식</label><select id="x-3fmt">${opt('glb', 'GLB (Blender·Godot·웹)', 'glb')}${opt('obj', 'OBJ + MTL', '')}</select></div>
        <div class="rs-field"><label for="x-3scope">범위</label><select id="x-3scope">${opt('project', '프로젝트 전체 (층을 쌓아서)', one ? '' : 'project')}${opt('floor', `${floorName(project.currentFloorId)}만 (바닥 높이 0)`, '')}${one ? opt('item', '고른 가구 (바닥 가운데 원점)', 'item') : ''}</select></div>
      </div><p class="rs-note">1 = 1m, Y가 위, 오른손 좌표계. 가구 앞면은 +Z예요. 내보내기 제외·숨김 가구는 빠져요.</p>
      <div class="rs-row"><button class="rs-btn primary" id="x-go">3D 파일 만들기</button></div>`
      body.querySelector('#x-go')?.addEventListener('click', () => run(async () => {
        const fmt = (body.querySelector('#x-3fmt') as HTMLSelectElement).value
        const scope = (body.querySelector('#x-3scope') as HTMLSelectElement).value as 'project' | 'floor' | 'item'
        const asset = buildAsset(scope, fmt === 'obj')
        if (!asset) throw new Error('먼저 가구를 하나 골라주세요.')
        const base = fileName([project.name, scope === 'project' ? '전체' : scope === 'floor' ? floorName(project.currentFloorId) : 'item'], 'x').replace(/\.x$/, '')
        const dl = document.createElement('div'); dl.className = 'rs-dl'
        if (fmt === 'glb') {
          const buf = await new GLTFExporter().parseAsync(asset.root, { binary: true }) as ArrayBuffer
          const z = await zipBlob([{ name: `${base}.glb`, blob: new Blob([buf]) }, { name: 'README.txt', blob: ASSET_README }])
          dl.append(dlLink(z, `${base}_glb.zip`, `저장 · ${base}.glb (ZIP, ${kb(z.size)})`))
        } else {
          const objBase = `skela_${scope}_${asciiName(base) || 'room'}`.replace(/_+$/, '')
          const mtlName = `${objBase}.mtl`
          const mats: { name: string; color: string; opacity?: number }[] = []
          asset.root.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.name) mats.push({ name: m.name, color: `#${m.color.getHexString()}`, opacity: m.opacity }) })
          const objText = `# Skela Room · 1 unit = 1 m · Y up\nmtllib ${mtlName}\n` + new OBJExporter().parse(asset.root)
          const z = await zipBlob([{ name: `${objBase}.obj`, blob: objText }, { name: mtlName, blob: mtlText(mats) }, { name: 'README.txt', blob: ASSET_README }])
          dl.append(dlLink(z, `${objBase}_obj.zip`, `저장 · ${objBase}.obj + .mtl (ZIP, ${kb(z.size)})`))
        }
        setProg(1)
        const info = document.createElement('p'); info.className = 'rs-note'
        info.textContent = `상자 ${asset.count}개 · 크기 ${asset.size.x.toFixed(2)} × ${asset.size.y.toFixed(2)} × ${asset.size.z.toFixed(2)} m (가로 × 높이 × 세로)`
        out.replaceChildren(info, dl)
        disposeGroup(asset.root)
      }))
    }
  }
  el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab as 'image' | 'sprite' | '3d')))
  show(tab)
}

/* ───── 그리기 반복: 편집 화면 + (카메라 고르면) 미리보기 창 / (카메라로 보기) 틀 ───── */
const clock = new THREE.Clock()
const tmp = new THREE.Vector3()
function setCutawayFor(c: VCamera | null) {
  const hide = c && c.cutaway === 'auto' ? cutawayWalls(plan, { x: c.pos.x, y: c.pos.y }) : null
  for (const f of wallFades) {
    f.mesh.visible = !hide || !hide.has(f.wallId)
    ;(f.mesh.material as THREE.MeshStandardMaterial).opacity = 1
  }
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05)
  const W = viewEl.clientWidth, H = viewEl.clientHeight
  renderer.setScissorTest(false)
  renderer.setViewport(0, 0, W, H)
  if (view === 'cam' && camView) {
    previewEl.hidden = true
    if (PILOT_ENABLED) pilotStep(dt)
    const c = pilot ?? camById(camView)
    if (c) {
      setCutawayFor(c)
      const fr = frameRect(c, W, H)
      Object.assign(frameEl.style, { left: `${fr.x}px`, top: `${fr.y}px`, width: `${fr.w}px`, height: `${fr.h}px` })
      const gv = gizmoHelper.visible
      helpers.visible = false; gizmoHelper.visible = false
      renderer.render(scene, threeCam(c, 0, W / H, fr.scale))
      helpers.visible = true; gizmoHelper.visible = gv
    }
  } else {
    if (view === 'walk') walkStep(dt)
    else if (view === '3d') {
      orbit3d.update()
      camera.getWorldPosition(tmp)
      for (const f of wallFades) {
        const dist = ((tmp.x - f.px) * f.nx + (tmp.z - f.pz) * f.nz) * f.inside
        if (dist < -30) f.faded = true
        else if (dist > 30) f.faded = false
        f.mesh.visible = true
        ;(f.mesh.material as THREE.MeshStandardMaterial).opacity = f.faded ? 0.18 : 1
      }
    } else {
      orbitPlan.update()
      for (const f of wallFades) { f.mesh.visible = true; (f.mesh.material as THREE.MeshStandardMaterial).opacity = 1 }
    }
    renderer.render(scene, camera)
    // 미리보기 창: 고른 카메라 시점 (초당 최대 10번)
    const pc = CAMERA_ENABLED && sel?.kind === 'camera' && !stack ? camById(sel.id) : undefined
    previewEl.hidden = !pc || pc.floorId !== project.currentFloorId
    if (pc && !previewEl.hidden) {
      const ar = aspectRatio(pc.aspect)
      const pw = Math.min(W * 0.42, 280), ph = pw / ar
      const ph2 = Math.min(ph, H * 0.4), pw2 = ph2 * ar
      const px = view === 'walk' ? 12 : W - 12 - pw2 // 걷기에서는 이동 버튼과 겹치지 않게 왼쪽
      Object.assign(previewEl.style, { width: `${pw2}px`, height: `${ph2}px`, left: `${px}px`, right: 'auto' })
      ;($('rs-preview-name') as HTMLElement).textContent = `미리보기 · ${pc.name}`
      {
        const x = px, y = 52 // CSS 기준 아래 → WebGL은 아래에서 위
        const fades = wallFades.map((f) => [f.mesh.visible, (f.mesh.material as THREE.MeshStandardMaterial).opacity] as const)
        setCutawayFor(pc)
        const gv = gizmoHelper.visible, grv = grid.visible
        helpers.visible = false; gizmoHelper.visible = false; grid.visible = false
        renderer.setScissorTest(true)
        renderer.setScissor(x, y, pw2, ph2)
        renderer.setViewport(x, y, pw2, ph2)
        renderer.render(scene, threeCam(pc, 0, ar))
        renderer.setScissorTest(false)
        helpers.visible = true; gizmoHelper.visible = gv; grid.visible = grv
        wallFades.forEach((f, i) => { f.mesh.visible = fades[i][0]; (f.mesh.material as THREE.MeshStandardMaterial).opacity = fades[i][1] })
      }
    }
  }
  requestAnimationFrame(frame)
}

rebuild()
resize()
setTool('select')
fit()
renderPanels()
requestAnimationFrame(frame)
// 테스트용: 카메라 아이콘(몸통·공)의 화면 좌표
function camScreen(id: string) {
  const r = renderer.domElement.getBoundingClientRect()
  const out: Record<string, { x: number; y: number }> = {}
  helpers.children.forEach((o) => {
    const pk = o.userData.camPick as { id: string; part: string } | undefined
    if (!pk || pk.id !== id) return
    const v = o.getWorldPosition(new THREE.Vector3()).project(camera)
    out[pk.part] = { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
  })
  return out
}
;(window as unknown as { __room: unknown }).__room = { get project() { return project }, get plan() { return plan }, get sel() { return sel }, get view() { return view }, openExport, select, lookThrough, camScreen }
