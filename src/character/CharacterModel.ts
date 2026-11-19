// 캐릭터 모델: 파츠(오브젝트)들의 Transform과 부모·자식 관계 (화면 API 없음, 단독 테스트 가능)
//
// - 이미지는 바꾸지 않는다. 파츠마다 한 번 오려 둔 이미지를 Transform으로 움직일 뿐이다.
// - 상태(EditorState)는 불변 객체다. 바뀐 파츠만 새 객체가 되고 나머지는 그대로 공유하므로,
//   되돌리기 이력(undoManager)에 상태를 쌓아도 "바뀐 파츠의 전후"만큼만 메모리를 쓴다.
// - 모든 파츠의 로컬 좌표는 원본 이미지 픽셀 좌표다. 파츠 이미지는 로컬 좌표의 origin 위치에 그린다.
//   그래서 원래 자세는 position = pivot (회전 0, 크기 1)이고, 자식의 position도 원본 이미지 좌표로 읽힌다.
//   경계를 고쳐 파츠 이미지(origin·크기)가 바뀌어도 Transform은 그대로다.
//   부모의 pivot을 옮겨도(그림이 제자리에 있게 position을 보정하므로) 자식은 움직이지 않는다.
import { IDENTITY, apply, applyLinear, decompose, invert, localMatrix, multiply, translate } from './Transform.ts'
import type { Mat, Transform, Vec2 } from './Transform.ts'
import type { Keyframe } from '../animation/Timeline.ts'
import type { OwnerSnapshot } from './ownership.ts'

// 바뀌지 않는 정보 (이미지와 클릭 판정용 알파)
export type PartDef = {
  id: string
  name: string
  w: number
  h: number
  image: CanvasImageSource | null
  alpha: Uint8Array | null // w*h, 0이면 빈 곳 (클릭 판정)
  origin: Vec2 // 이 파츠 이미지의 왼쪽 위 (로컬 = 원본 이미지 좌표)
}
export type Character = { name: string; w: number; h: number; defs: Record<string, PartDef>; order: string[] }

// 편집하는 정보
export type PartState = Transform & { parent: string | null; z: number; visible: boolean }
// owner: 파츠 경계(픽셀 주인)의 스냅샷. 되돌리기 이력에 함께 들어가 경계 수정도 되돌릴 수 있다 (없으면 경계 수정 기능을 쓰지 않음)
export type EditorState = { parts: Record<string, PartState>; keys: Keyframe[]; duration: number; owner?: OwnerSnapshot }

export function worldMatrices(state: EditorState): Record<string, Mat> {
  const out: Record<string, Mat> = {}
  const visiting = new Set<string>()
  const get = (id: string): Mat => {
    if (out[id]) return out[id]
    const p = state.parts[id]
    if (!p || visiting.has(id)) return IDENTITY // 순환은 막혀 있지만 안전장치
    visiting.add(id)
    const parentM = p.parent && state.parts[p.parent] ? get(p.parent) : IDENTITY
    visiting.delete(id)
    return (out[id] = multiply(parentM, localMatrix(p)))
  }
  for (const id of Object.keys(state.parts)) get(id)
  return out
}

export const childrenOf = (state: EditorState, id: string | null) => Object.keys(state.parts).filter((k) => state.parts[k].parent === id)

export function isDescendant(state: EditorState, id: string, ancestor: string): boolean {
  let p = state.parts[id]?.parent ?? null
  const seen = new Set<string>()
  while (p && !seen.has(p)) {
    if (p === ancestor) return true
    seen.add(p)
    p = state.parts[p]?.parent ?? null
  }
  return false
}

// 바뀐 파츠만 새 객체로 (나머지는 공유)
export function updatePart(state: EditorState, id: string, patch: Partial<PartState>): EditorState {
  const p = state.parts[id]
  if (!p) return state
  return { ...state, parts: { ...state.parts, [id]: { ...p, ...patch } } }
}

// pivot의 월드 위치 (관절 표시·기즈모 위치)
export function pivotWorld(state: EditorState, id: string, W = worldMatrices(state)): Vec2 {
  return apply(W[id], state.parts[id].pivot)
}

// 부모 좌표계의 행렬 (부모가 없으면 단위행렬)
export function parentMatrix(state: EditorState, id: string, W = worldMatrices(state)): Mat {
  const par = state.parts[id]?.parent
  return par && W[par] ? W[par] : IDENTITY
}

// 월드에서의 이동량(dx, dy)을 부모 좌표계 이동량으로 바꿔 position에 더한다
export function moveByWorld(state: EditorState, id: string, d: Vec2, W = worldMatrices(state)): EditorState {
  const inv = invert(parentMatrix(state, id, W))
  const dl = applyLinear(inv, d)
  const p = state.parts[id]
  return updatePart(state, id, { position: { x: p.position.x + dl.x, y: p.position.y + dl.y } })
}

// pivot을 옮기되 그림은 제자리에 있게 position을 보정한다 (Unity에서 Pivot 위치를 바꾸는 것과 같은 결과)
// T(p')·R·S·T(-q') = T(p)·R·S·T(-q)  →  p' = p + R·S·(q' − q)
export function setPivotKeepPlace(state: EditorState, id: string, pivot: Vec2): EditorState {
  const p = state.parts[id]
  const rs = localMatrix({ ...p, position: { x: 0, y: 0 }, pivot: { x: 0, y: 0 } })
  const d = applyLinear(rs, { x: pivot.x - p.pivot.x, y: pivot.y - p.pivot.y })
  return updatePart(state, id, { pivot, position: { x: p.position.x + d.x, y: p.position.y + d.y } })
}

// 부모를 바꾸되 월드에서의 위치·회전·크기는 유지한다 (Unity의 worldPositionStays = true)
export function reparent(state: EditorState, id: string, newParent: string | null): EditorState {
  const p = state.parts[id]
  if (!p || p.parent === newParent) return state
  if (newParent && (newParent === id || isDescendant(state, newParent, id))) return state // 자기 자식 밑으로는 못 간다
  const W = worldMatrices(state)
  const newParentM = newParent ? W[newParent] : IDENTITY
  // L' = inv(newParent)·World,  L'·T(pivot) = T(p')·R·S
  const L = multiply(multiply(invert(newParentM), W[id]), translate(p.pivot.x, p.pivot.y))
  const d = decompose(L)
  return updatePart(state, id, { parent: newParent, position: d.position, rotation: d.rotation, scale: d.scale })
}

// 그리는 순서: z가 작은 것부터, 같으면 Hierarchy 순서
export function drawOrder(char: Character, state: EditorState): string[] {
  const idx = new Map(char.order.map((id, i) => [id, i]))
  return Object.keys(state.parts).sort((a, b) => state.parts[a].z - state.parts[b].z || (idx.get(a) ?? 0) - (idx.get(b) ?? 0))
}

// 월드 좌표의 점을 누른 파츠 (맨 위에 그려진 것부터, 이미지의 빈 곳은 통과)
export function hitTest(char: Character, state: EditorState, pt: Vec2, W = worldMatrices(state)): string | null {
  const order = drawOrder(char, state)
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]
    const def = char.defs[id], p = state.parts[id]
    if (!def || !p.visible) continue
    const l = apply(invert(W[id]), pt)
    const x = Math.floor(l.x - def.origin.x), y = Math.floor(l.y - def.origin.y)
    if (x < 0 || y < 0 || x >= def.w || y >= def.h) continue
    if (!def.alpha || def.alpha[y * def.w + x] > 20) return id
  }
  return null
}

// 파츠 이미지 사각형의 월드 꼭짓점 4개 (선택 표시)
export function worldCorners(char: Character, state: EditorState, id: string, W = worldMatrices(state)): Vec2[] {
  const d = char.defs[id]
  const o = d.origin
  return [{ x: o.x, y: o.y }, { x: o.x + d.w, y: o.y }, { x: o.x + d.w, y: o.y + d.h }, { x: o.x, y: o.y + d.h }].map((q) => apply(W[id], q))
}

/* ───── 포즈 저장/불러오기 (JSON) ───── */

export type PoseFile = {
  format: 'skela-character-pose'
  version: 2 // 2: 로컬 좌표 = 원본 이미지 좌표 (1은 파츠 이미지 좌표라 호환되지 않음)
  character: string
  image: { w: number; h: number }
  parts: Record<string, { x: number; y: number; rotation: number; scaleX: number; scaleY: number; pivotX: number; pivotY: number; parent: string | null; z: number; visible: boolean }>
  timeline: { duration: number; keys: Keyframe[] }
  // 경계를 직접 고친 경우만: 파츠 id 목록과 픽셀 주인(압축). 같은 그림·같은 크기일 때만 적용된다
  ownership?: { ids: string[]; w: number; h: number; rle: number[] }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000

export function toPoseFile(char: Character, state: EditorState): PoseFile {
  const parts: PoseFile['parts'] = {}
  for (const id of char.order) {
    const p = state.parts[id]
    if (!p) continue
    parts[id] = { x: r3(p.position.x), y: r3(p.position.y), rotation: r3(p.rotation), scaleX: r3(p.scale.x), scaleY: r3(p.scale.y), pivotX: r3(p.pivot.x), pivotY: r3(p.pivot.y), parent: p.parent, z: p.z, visible: p.visible }
  }
  return { format: 'skela-character-pose', version: 2, character: char.name, image: { w: char.w, h: char.h }, parts, timeline: { duration: state.duration, keys: state.keys } }
}

// 같은 id의 파츠에만 적용한다. 반환: 새 상태와 적용한 파츠 수 (형식이 틀리면 throw)
export function applyPoseFile(state: EditorState, json: unknown): { state: EditorState; applied: number; skipped: string[] } {
  const f = json as PoseFile
  if (!f || f.format !== 'skela-character-pose' || typeof f.parts !== 'object') throw new Error('스켈라 캐릭터 포즈 파일이 아니에요.')
  if ((f as { version?: number }).version !== 2) throw new Error('이전 형식(v1)의 포즈 파일이에요. 좌표 기준이 바뀌어 불러올 수 없어요. 에디터에서 다시 저장해 주세요.')
  const parts = { ...state.parts }
  let applied = 0
  const skipped: string[] = []
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  for (const [id, q] of Object.entries(f.parts)) {
    const p = parts[id]
    if (!p) { skipped.push(id); continue }
    const parent = q.parent === null || (typeof q.parent === 'string' && parts[q.parent]) ? q.parent : p.parent
    parts[id] = {
      ...p,
      position: { x: num(q.x, p.position.x), y: num(q.y, p.position.y) },
      rotation: num(q.rotation, p.rotation),
      scale: { x: num(q.scaleX, p.scale.x), y: num(q.scaleY, p.scale.y) },
      pivot: { x: num(q.pivotX, p.pivot.x), y: num(q.pivotY, p.pivot.y) },
      parent,
      z: num(q.z, p.z),
      visible: typeof q.visible === 'boolean' ? q.visible : p.visible,
    }
    applied++
  }
  let next: EditorState = { ...state, parts }
  // 불러온 부모 관계에 순환이 생기면 원래 부모로 되돌린다
  for (const id of Object.keys(parts)) if (parts[id].parent && isDescendant(next, parts[id].parent!, id)) next = updatePart(next, id, { parent: state.parts[id].parent })
  const keys = Array.isArray(f.timeline?.keys) ? f.timeline.keys.filter((k) => typeof k?.t === 'number' && k.pose && typeof k.pose === 'object') : state.keys
  const duration = num(f.timeline?.duration, state.duration)
  return { state: { ...next, keys, duration: Math.max(0.1, duration) }, applied, skipped }
}
