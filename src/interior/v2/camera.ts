// 가상 카메라 (촬영용 시점 북마크): 데이터, 프리셋, 맞춤 계산, 검증. three.js 없음.
// 좌표: 평면도 x·y (cm) + h = 그 층 바닥에서의 높이 (cm).
// 3D 계산은 three.js와 같은 오른손 좌표 (X=x, Y=h, Z=y)로 한다. 편집 카메라와는 절대 공유하지 않는다.
export type Preset = 'interior' | 'iso' | 'illust' | 'top' | 'fps'
export type Projection = 'perspective' | 'orthographic'
export type Aspect = '16:9' | '3:2' | '4:3' | '1:1' | '9:16'
export type OutFormat = 'png' | 'jpg' | 'line' | 'colorline'
export type SizeName = 'HD' | 'FHD' | 'QHD' | '4K'
export type P3 = { x: number; y: number; h: number }
export type VCamera = {
  id: string; name: string; preset: Preset; projection: Projection; floorId: string
  pos: P3; target: P3; fovDeg: number; orthoSpan: number; aspect: Aspect
  cutaway: 'auto' | 'none'
  output: { format: OutFormat; transparent: boolean; size: SizeName }
}
export type Rect = { x0: number; y0: number; x1: number; y1: number }

export const ASPECTS: Aspect[] = ['16:9', '3:2', '4:3', '1:1', '9:16']
export const aspectRatio = (a: Aspect) => { const [w, h] = a.split(':').map(Number); return w / h }

type PresetDef = { label: string; projection: Projection; fov: number; yaw: number; pitch: number; output: VCamera['output']; cutaway: VCamera['cutaway'] }
// yaw: 위에서 볼 때 카메라가 있는 방향 (평면도 +x에서 +y 쪽으로 시계 방향, 도). pitch: 내려다보는 각도.
export const PRESETS: Record<Preset, PresetDef> = {
  interior: { label: '인테리어', projection: 'perspective', fov: 60, yaw: 90, pitch: 12, output: { format: 'png', transparent: false, size: 'FHD' }, cutaway: 'auto' },
  iso: { label: '아이소메트릭', projection: 'orthographic', fov: 50, yaw: 45, pitch: 35.264, output: { format: 'png', transparent: false, size: 'FHD' }, cutaway: 'auto' },
  illust: { label: '일러스트 2:1', projection: 'orthographic', fov: 50, yaw: 45, pitch: 26.565, output: { format: 'colorline', transparent: true, size: 'FHD' }, cutaway: 'auto' },
  top: { label: '탑다운', projection: 'orthographic', fov: 50, yaw: 90, pitch: 90, output: { format: 'png', transparent: false, size: 'FHD' }, cutaway: 'none' },
  fps: { label: '1인칭', projection: 'perspective', fov: 70, yaw: 90, pitch: 0, output: { format: 'jpg', transparent: false, size: 'FHD' }, cutaway: 'none' },
}
export const PRESET_ORDER: Preset[] = ['interior', 'iso', 'illust', 'top', 'fps']

const rad = (d: number) => (d * Math.PI) / 180
type V = [number, number, number]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V): V => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
export const toThree = (p: P3, elev = 0): V => [p.x, p.h + elev, p.y]

// 카메라 기준 축 (three 좌표): 앞, 오른쪽, 위. 바로 위에서 볼 때는 화면 위 = 평면도 위(-y)
export function cameraBasis(cam: Pick<VCamera, 'pos' | 'target'>) {
  const f = norm(sub(toThree(cam.target), toThree(cam.pos)))
  const worldUp: V = Math.abs(f[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0]
  const right = norm(cross(f, worldUp))
  const up = cross(right, f)
  return { forward: f, right, up, worldUp }
}

const dirFrom = (yaw: number, pitch: number): V => [Math.cos(rad(pitch)) * Math.cos(rad(yaw)), Math.sin(rad(pitch)), Math.cos(rad(pitch)) * Math.sin(rad(yaw))]

// 방 범위에 맞춘 카메라 만들기. height = 벽 높이(맞춤 상자의 윗면), start = 1인칭 시작점
export function makeCamera(preset: Preset, id: string, name: string, floorId: string, room: Rect, aspect: Aspect = '16:9', height = 250, start?: { x: number; y: number; lookX: number; lookY: number }): VCamera {
  const d = PRESETS[preset]
  const cx = (room.x0 + room.x1) / 2, cy = (room.y0 + room.y1) / 2
  const w = room.x1 - room.x0, dd = room.y1 - room.y0
  let pos: P3, target: P3
  if (preset === 'interior') {
    pos = { x: room.x0 + w * 0.12, y: room.y1 - dd * 0.12, h: 150 }
    target = { x: cx + w * 0.1, y: cy - dd * 0.1, h: 110 }
  } else if (preset === 'fps') {
    const s = start ?? { x: cx, y: room.y1 - 80, lookX: cx, lookY: cy }
    pos = { x: s.x, y: s.y, h: 160 }
    target = { x: s.lookX, y: s.lookY, h: 160 }
  } else {
    target = { x: cx, y: cy, h: height / 2 }
    const dir = dirFrom(d.yaw, d.pitch)
    const far = 5000
    pos = { x: cx + dir[0] * far, y: cy + dir[2] * far, h: height / 2 + dir[1] * far }
  }
  const cam: VCamera = { id, name, preset, projection: d.projection, floorId, pos, target, fovDeg: d.fov, orthoSpan: 500, aspect, cutaway: d.cutaway, output: { ...d.output } }
  if (cam.projection === 'orthographic') cam.orthoSpan = fitOrthoSpan(cam, room, height)
  return cam
}

// 직교 카메라: 방 상자(바닥~벽 높이)의 8개 모서리가 화면(비율 포함) 안에 들어가는 세로 길이 + 여백 8%
export function fitOrthoSpan(cam: Pick<VCamera, 'pos' | 'target' | 'aspect'>, room: Rect, height = 250): number {
  const { right, up } = cameraBasis(cam)
  const t = toThree(cam.target)
  let maxR = 0, maxU = 0
  for (const x of [room.x0, room.x1]) for (const y of [room.y0, room.y1]) for (const h of [0, height]) {
    const v = sub([x, h, y], t)
    maxR = Math.max(maxR, Math.abs(dot(v, right)))
    maxU = Math.max(maxU, Math.abs(dot(v, up)))
  }
  const ar = aspectRatio(cam.aspect)
  return Math.max(50, Math.max(maxU * 2, (maxR * 2) / ar) * 1.08)
}

// 점이 카메라 화면 안(-1~1)에 들어오는지: 직교 카메라 맞춤 검사용
export function orthoProject(cam: VCamera, p: P3): { u: number; v: number } {
  const { right, up } = cameraBasis(cam)
  const v = sub(toThree(p), toThree(cam.target))
  const half = cam.orthoSpan / 2
  return { u: dot(v, right) / (half * aspectRatio(cam.aspect)), v: dot(v, up) / half }
}

// 저장·불러오기 때 고쳐 쓰는 규칙. 고칠 수 없으면 null (그 카메라만 버린다)
export function sanitizeCamera(raw: unknown, floorIds: string[], usedNames: Set<string>): VCamera | null {
  const c = raw as Partial<VCamera>
  const isP3 = (p: unknown): p is P3 => !!p && ['x', 'y', 'h'].every((k) => Number.isFinite((p as Record<string, number>)[k]))
  if (!c || typeof c.id !== 'string' || !isP3(c.pos) || !isP3(c.target)) return null
  const preset: Preset = c.preset && c.preset in PRESETS ? c.preset : 'interior'
  const target = { ...c.target }
  if (Math.hypot(c.pos.x - target.x, c.pos.y - target.y, c.pos.h - target.h) < 1) target.y -= 100 // 같은 점이면 앞쪽 1m를 보게
  let name = typeof c.name === 'string' ? c.name.trim().slice(0, 30) : ''
  let n = 1
  if (!name || usedNames.has(name)) { do name = `카메라 ${n++}`; while (usedNames.has(name)) }
  usedNames.add(name)
  const d = PRESETS[preset]
  const fmt: OutFormat[] = ['png', 'jpg', 'line', 'colorline'], sizes: SizeName[] = ['HD', 'FHD', 'QHD', '4K']
  return {
    id: c.id, name, preset,
    projection: c.projection === 'orthographic' || c.projection === 'perspective' ? c.projection : d.projection,
    floorId: c.floorId && floorIds.includes(c.floorId) ? c.floorId : floorIds[0],
    pos: { ...c.pos }, target,
    fovDeg: Math.min(100, Math.max(20, Number.isFinite(c.fovDeg) ? (c.fovDeg as number) : d.fov)),
    orthoSpan: Math.max(50, Number.isFinite(c.orthoSpan) ? (c.orthoSpan as number) : 500),
    aspect: c.aspect && ASPECTS.includes(c.aspect) ? c.aspect : '16:9',
    cutaway: c.cutaway === 'none' ? 'none' : 'auto',
    output: {
      format: c.output && fmt.includes(c.output.format) ? c.output.format : d.output.format,
      transparent: !!c.output?.transparent && c.output.format !== 'jpg',
      size: c.output && sizes.includes(c.output.size) ? c.output.size : 'FHD',
    },
  }
}
export const MAX_CAMERAS = 50
