// v2 프로젝트: 여러 층(floors) + 가상 카메라. 각 층은 기존 Plan을 수정 없이 통째로 담는다. 화면 API 없음.
// 편집은 항상 고른 층 하나만. 적층 보기는 층 순서 × floorGap(260cm) 높이로 쌓기만 한다(바닥을 뚫지 않음).
import type { Plan } from '../Plan.ts'
import { emptyPlan, fromPlanFile, nextId, toPlanFile } from '../Plan.ts'
import { MAX_CAMERAS, sanitizeCamera, type VCamera } from './camera.ts'

export type Floor = { id: string; name: string; plan: Plan }
export type Project = { name: string; floorGap: number; currentFloorId: string; floors: Floor[]; cameras: VCamera[] }
export type ProjectFile = { format: 'skela-room-project'; version: 2; project: Project }
export const FLOOR_GAP = 260

export function newProject(plan: Plan, name = plan.name): Project {
  return { name, floorGap: FLOOR_GAP, currentFloorId: 'floor1', floors: [{ id: 'floor1', name: '1F', plan }], cameras: [] }
}

export const currentFloor = (p: Project): Floor => p.floors.find((f) => f.id === p.currentFloorId) ?? p.floors[0]
export const floorIndex = (p: Project, id: string) => Math.max(0, p.floors.findIndex((f) => f.id === id))
export const floorElevation = (p: Project, id: string) => floorIndex(p, id) * p.floorGap

export function setFloorPlan(p: Project, id: string, plan: Plan): Project {
  return { ...p, floors: p.floors.map((f) => (f.id === id ? { ...f, plan } : f)) }
}
export function selectFloor(p: Project, id: string): Project {
  return p.floors.some((f) => f.id === id) && p.currentFloorId !== id ? { ...p, currentFloorId: id } : p
}
const autoName = (p: Project) => { let n = p.floors.length + 1; while (p.floors.some((f) => f.name === `${n}F`)) n++; return `${n}F` }

// 새 층: 지금 층의 벽·문·창문만 복사한 빈 층 (가구 없음). 맨 위에 쌓는다.
export function addFloor(p: Project): Project {
  const src = currentFloor(p).plan
  const id = nextId('floor', p.floors.map((f) => f.id))
  const name = autoName(p)
  const plan: Plan = { ...emptyPlan(), name, walls: src.walls, openings: src.openings, floorColor: src.floorColor, wallColor: src.wallColor }
  return { ...p, floors: [...p.floors, { id, name, plan }], currentFloorId: id }
}
export function duplicateFloor(p: Project, srcId: string): Project {
  const src = p.floors.find((f) => f.id === srcId)
  if (!src) return p
  const id = nextId('floor', p.floors.map((f) => f.id))
  const name = autoName(p)
  const i = floorIndex(p, srcId)
  const floors = [...p.floors.slice(0, i + 1), { id, name, plan: { ...src.plan, name } }, ...p.floors.slice(i + 1)]
  return { ...p, floors, currentFloorId: id }
}
// 최소 1개 층은 남긴다. 그 층을 보던 카메라는 첫 층으로 옮긴다(카메라는 지우지 않음).
export function removeFloor(p: Project, id: string): Project {
  if (p.floors.length <= 1 || !p.floors.some((f) => f.id === id)) return p
  const floors = p.floors.filter((f) => f.id !== id)
  const i = floorIndex(p, id)
  const current = p.currentFloorId === id ? floors[Math.max(0, i - 1)].id : p.currentFloorId
  return { ...p, floors, currentFloorId: current, cameras: p.cameras.map((c) => (c.floorId === id ? { ...c, floorId: floors[0].id } : c)) }
}
export function moveFloor(p: Project, id: string, dir: -1 | 1): Project {
  const i = p.floors.findIndex((f) => f.id === id), j = i + dir
  if (i < 0 || j < 0 || j >= p.floors.length) return p
  const floors = [...p.floors]
  ;[floors[i], floors[j]] = [floors[j], floors[i]]
  return { ...p, floors }
}
export function renameFloor(p: Project, id: string, name: string): Project {
  const n = name.trim().slice(0, 12)
  if (!n || p.floors.some((f) => f.id !== id && f.name === n)) return p
  return { ...p, floors: p.floors.map((f) => (f.id === id ? { ...f, name: n } : f)) }
}

export function upsertCamera(p: Project, cam: VCamera): Project {
  const has = p.cameras.some((c) => c.id === cam.id)
  if (!has && p.cameras.length >= MAX_CAMERAS) return p
  return { ...p, cameras: has ? p.cameras.map((c) => (c.id === cam.id ? cam : c)) : [...p.cameras, cam] }
}
export const removeCamera = (p: Project, id: string): Project => ({ ...p, cameras: p.cameras.filter((c) => c.id !== id) })

/* ───── 저장·불러오기 (v1 자동 변환 포함) ───── */
export const toProjectFile = (p: Project): ProjectFile => ({ format: 'skela-room-project', version: 2, project: p })

// v1 평면도 파일(skela-interior-plan)이면 1F 하나짜리 프로젝트로 감싼다. 원본 객체는 바꾸지 않는다.
export function fromAnyFile(json: unknown): { project: Project; migrated: boolean } {
  const f = json as { format?: string; version?: number; project?: Project }
  if (f && f.format === 'skela-interior-plan') return { project: newProject(fromPlanFile(json)), migrated: true }
  if (!f || f.format !== 'skela-room-project' || !f.project || typeof f.project !== 'object') throw new Error('Skela Room 파일이 아니에요.')
  if (f.version !== 2) throw new Error('지원하지 않는 버전의 프로젝트 파일이에요.')
  const raw = f.project
  const floors: Floor[] = []
  for (const fl of Array.isArray(raw.floors) ? raw.floors : []) {
    if (!fl || typeof fl.id !== 'string') continue
    try { floors.push({ id: fl.id, name: typeof fl.name === 'string' && fl.name.trim() ? fl.name.trim().slice(0, 12) : `${floors.length + 1}F`, plan: fromPlanFile(toPlanFile(fl.plan)) }) } catch { /* 망가진 층은 건너뛴다 */ }
  }
  if (!floors.length) throw new Error('층이 하나도 없는 파일이에요.')
  const ids = floors.map((x) => x.id)
  const names = new Set<string>()
  const cameras = (Array.isArray(raw.cameras) ? raw.cameras : []).map((c) => sanitizeCamera(c, ids, names)).filter((c): c is VCamera => !!c).slice(0, MAX_CAMERAS)
  return {
    project: {
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : floors[0].plan.name,
      floorGap: Number.isFinite(raw.floorGap) && raw.floorGap > 0 ? raw.floorGap : FLOOR_GAP,
      currentFloorId: ids.includes(raw.currentFloorId) ? raw.currentFloorId : ids[0],
      floors, cameras,
    },
    migrated: false,
  }
}
