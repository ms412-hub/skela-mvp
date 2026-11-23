// 평면도 → 3D 상자 목록 (화면·three.js 없이 계산만, 단독 테스트 가능)
//
// 웹 3D 보기와 Unity 가져오기가 모두 이 목록을 그대로 쓴다. 3D 모델 파일 없이 상자(큐브)만으로 방을 만든다.
// 좌표: cx·cz는 평면도의 x·y(cm), cy는 바닥에서 상자 가운데까지의 높이(cm).
// w는 상자의 "가로"(벽이면 벽 길이 방향), d는 깊이(벽이면 두께), h는 높이. rotDeg는 평면도에서 상자를 돌린 각도(시계 방향 +).
import { CATALOG, furnitureType } from './catalog.ts'
import type { Plan, Wall } from './Plan.ts'
import { planBounds, wallLength } from './Plan.ts'

export type SceneBox = { kind: 'wall' | 'floor' | 'furniture'; id: string; cx: number; cy: number; cz: number; w: number; h: number; d: number; rotDeg: number; color: string }

const EPS = 0.01

// 벽 하나를 상자들로: 문·창문 자리는 비우고, 창문 아래와 문·창문 위는 막는다.
// 벽 양 끝은 두께의 절반만큼 늘려서 모서리에 틈이 생기지 않게 한다.
export function wallBoxes(plan: Plan, wall: Wall): SceneBox[] {
  const len = wallLength(wall)
  if (len < EPS) return []
  const ang = (Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x) * 180) / Math.PI
  const ux = (wall.b.x - wall.a.x) / len, uy = (wall.b.y - wall.a.y) / len
  const ext = wall.thickness / 2
  const out: SceneBox[] = []
  // s: 벽 시작점 a에서 벽을 따라 잰 거리(-ext ~ len+ext)
  const push = (s0: number, s1: number, y0: number, y1: number, tag: string) => {
    if (s1 - s0 < EPS || y1 - y0 < EPS) return
    const mid = (s0 + s1) / 2
    out.push({ kind: 'wall', id: `${wall.id}:${tag}`, cx: wall.a.x + ux * mid, cz: wall.a.y + uy * mid, cy: (y0 + y1) / 2, w: s1 - s0, h: y1 - y0, d: wall.thickness, rotDeg: ang, color: plan.wallColor })
  }
  const ops = plan.openings.filter((o) => o.wallId === wall.id).map((o) => ({ o, s0: o.t * len - o.width / 2, s1: o.t * len + o.width / 2 })).sort((p, q) => p.s0 - q.s0)
  let cursor = -ext
  let k = 0
  for (const { o, s0, s1 } of ops) {
    push(cursor, Math.max(cursor, s0), 0, wall.height, `s${k++}`)
    if (o.sill > EPS) push(s0, s1, 0, Math.min(o.sill, wall.height), `${o.id}:below`)
    push(s0, s1, Math.min(o.sill + o.height, wall.height), wall.height, `${o.id}:above`)
    cursor = Math.max(cursor, s1)
  }
  push(cursor, len + ext, 0, wall.height, `s${k}`)
  return out
}

export function furnitureBoxes(plan: Plan): SceneBox[] {
  const out: SceneBox[] = []
  for (const f of plan.furniture) {
    const t = furnitureType(f.type)
    if (!t) continue // 목록에 없는 가구(다른 버전 파일)는 건너뛴다
    const sx = f.w / t.w, sz = f.d / t.d, sh = f.h / t.h
    const r = (f.rot * Math.PI) / 180
    const c = Math.cos(r), s = Math.sin(r)
    t.boxes.forEach((b, i) => {
      const lx = b.x * sx, lz = b.z * sz
      out.push({ kind: 'furniture', id: `${f.id}:${i}`, cx: f.x + c * lx - s * lz, cz: f.y + s * lx + c * lz, cy: (b.y + b.h / 2) * sh, w: b.w * sx, h: b.h * sh, d: b.d * sz, rotDeg: f.rot, color: b.color ?? f.color })
    })
  }
  return out
}

export function floorBox(plan: Plan): SceneBox {
  const b = planBounds(plan)
  const w = Math.max(100, b.x1 - b.x0), d = Math.max(100, b.y1 - b.y0)
  return { kind: 'floor', id: 'floor', cx: (b.x0 + b.x1) / 2, cz: (b.y0 + b.y1) / 2, cy: -1, w, h: 2, d, rotDeg: 0, color: plan.floorColor }
}

export function buildBoxes(plan: Plan): SceneBox[] {
  return [floorBox(plan), ...plan.walls.flatMap((w) => wallBoxes(plan, w)), ...furnitureBoxes(plan)]
}

export { CATALOG }
