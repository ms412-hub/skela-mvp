// 타임라인: 시간별 포즈(키프레임)를 저장하고, 사이를 보간한다 (화면 API 없음, 단독 테스트 가능)
import type { EditorState } from '../character/CharacterModel.ts'

export type PartPose = { x: number; y: number; rotation: number; sx: number; sy: number }
export type Keyframe = { t: number; pose: Record<string, PartPose> }

const EPS = 1e-3

export function capturePose(state: EditorState): Record<string, PartPose> {
  const out: Record<string, PartPose> = {}
  for (const [id, p] of Object.entries(state.parts)) out[id] = { x: p.position.x, y: p.position.y, rotation: p.rotation, sx: p.scale.x, sy: p.scale.y }
  return out
}

// 같은 시간에 키가 있으면 바꾸고, 없으면 시간 순서대로 넣는다
export function setKey(keys: Keyframe[], t: number, pose: Record<string, PartPose>): Keyframe[] {
  const rest = keys.filter((k) => Math.abs(k.t - t) > EPS)
  return [...rest, { t, pose }].sort((a, b) => a.t - b.t)
}

export function removeKey(keys: Keyframe[], t: number): Keyframe[] {
  return keys.filter((k) => Math.abs(k.t - t) > EPS)
}

export const keyAt = (keys: Keyframe[], t: number) => keys.find((k) => Math.abs(k.t - t) <= EPS) ?? null

const lerp = (a: number, b: number, u: number) => a + (b - a) * u
// 회전은 짧은 쪽으로 (350° → 10°는 +20°)
const lerpDeg = (a: number, b: number, u: number) => a + ((((b - a + 180) % 360) + 360) % 360 - 180) * u

// t 시점의 포즈. 첫 키 이전은 첫 키, 마지막 키 이후는 마지막 키. 키가 없으면 null
export function sampleAt(keys: Keyframe[], t: number): Record<string, PartPose> | null {
  if (!keys.length) return null
  if (t <= keys[0].t) return keys[0].pose
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.pose
  let i = 0
  while (i < keys.length - 1 && keys[i + 1].t < t) i++
  const a = keys[i], b = keys[i + 1]
  const u = (t - a.t) / (b.t - a.t || 1)
  const out: Record<string, PartPose> = {}
  for (const id of Object.keys(a.pose)) {
    const p = a.pose[id], q = b.pose[id] ?? p
    out[id] = { x: lerp(p.x, q.x, u), y: lerp(p.y, q.y, u), rotation: lerpDeg(p.rotation, q.rotation, u), sx: lerp(p.sx, q.sx, u), sy: lerp(p.sy, q.sy, u) }
  }
  return out
}

// 포즈를 상태에 적용 (pivot·부모·z는 그대로)
export function applyPose(state: EditorState, pose: Record<string, PartPose>): EditorState {
  const parts = { ...state.parts }
  for (const [id, q] of Object.entries(pose)) {
    const p = parts[id]
    if (!p) continue
    parts[id] = { ...p, position: { x: q.x, y: q.y }, rotation: q.rotation, scale: { x: q.sx, y: q.sy } }
  }
  return { ...state, parts }
}
