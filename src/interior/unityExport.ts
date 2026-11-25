// 평면도 → 유니티용 장면 JSON (화면 API 없음, 단독 테스트 가능)
//
// 유니티 쪽(unity/SkelaRoom/SkelaRoom.cs)은 계산을 다시 하지 않고 이 상자 목록을 그대로 큐브로 만든다.
// 그래서 웹에서 보이는 방과 유니티의 방이 항상 똑같다.
// 좌표는 평면도 그대로(cm, x 오른쪽, y 아래쪽). 유니티 변환(미터, y→-z)은 C# 쪽에서 한 곳에서만 한다.
import { furnitureType } from './catalog.ts'
import { buildBoxes, openingBoxes, type SceneBox } from './geometry.ts'
import type { Plan, Vec } from './Plan.ts'
import { planBounds, wallLength } from './Plan.ts'

export type UnityGroup = { id: string; kind: 'floor' | 'wall' | 'opening' | 'furniture'; name: string; x: number; y: number; rot: number }
export type UnityBox = SceneBox & { group: string; opacity: number }
export type UnityScene = {
  format: 'skela-unity-scene'
  version: 1
  name: string
  // 걷기 시작 위치와 처음 바라볼 곳 (평면도 좌표)
  spawn: { x: number; y: number; lookX: number; lookY: number }
  ceiling: { height: number; color: string }
  groups: UnityGroup[]
  boxes: UnityBox[]
}

// 걷기 시작 위치: 첫 문 안쪽 70cm, 문이 없으면 방 가운데. 방 가운데를 바라본다.
export function walkStart(plan: Plan): { x: number; y: number; lookX: number; lookY: number } {
  const b = planBounds(plan)
  const center: Vec = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }
  const door = plan.openings.find((o) => o.kind === 'door')
  const w = door && plan.walls.find((q) => q.id === door.wallId)
  if (door && w) {
    const len = wallLength(w)
    if (len > 0) {
      const p = { x: w.a.x + (w.b.x - w.a.x) * door.t, y: w.a.y + (w.b.y - w.a.y) * door.t }
      const nx = -(w.b.y - w.a.y) / len, ny = (w.b.x - w.a.x) / len
      const side = Math.sign((center.x - p.x) * nx + (center.y - p.y) * ny) || 1
      return { x: p.x + nx * side * 70, y: p.y + ny * side * 70, lookX: center.x, lookY: center.y }
    }
  }
  return { x: center.x, y: center.y + 1, lookX: center.x, lookY: center.y - 100 }
}

const r1 = (v: number) => Math.round(v * 10) / 10

export function toUnityScene(plan: Plan): UnityScene {
  const groups: UnityGroup[] = []
  const b = planBounds(plan)
  groups.push({ id: 'floor', kind: 'floor', name: '바닥', x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, rot: 0 })
  plan.walls.forEach((w, i) => {
    groups.push({ id: w.id, kind: 'wall', name: `벽 ${i + 1}`, x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2, rot: (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI })
  })
  for (const o of plan.openings) {
    const w = plan.walls.find((q) => q.id === o.wallId)
    if (!w) continue
    const n = plan.openings.filter((q) => q.kind === o.kind).indexOf(o) + 1
    groups.push({ id: o.id, kind: 'opening', name: `${o.kind === 'door' ? '문' : '창문'} ${n}`, x: w.a.x + (w.b.x - w.a.x) * o.t, y: w.a.y + (w.b.y - w.a.y) * o.t, rot: (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI })
  }
  for (const f of plan.furniture) {
    if (!furnitureType(f.type)) continue
    groups.push({ id: f.id, kind: 'furniture', name: `${furnitureType(f.type)?.name ?? f.type} (${f.id})`, x: f.x, y: f.y, rot: f.rot })
  }
  // 상자 id의 첫 부분이 묶음 id다: "wall1:s0" → wall1, "furn3:2" → furn3, "door1:leaf" → door1, 창문 위아래 벽은 벽 묶음
  const boxes: UnityBox[] = [...buildBoxes(plan), ...openingBoxes(plan)].map((x) => ({
    ...x, cx: r1(x.cx), cy: r1(x.cy), cz: r1(x.cz), w: r1(x.w), h: r1(x.h), d: r1(x.d), rotDeg: r1(x.rotDeg),
    group: x.id.split(':')[0], opacity: x.opacity ?? 1,
  }))
  for (const g of groups) { g.x = r1(g.x); g.y = r1(g.y); g.rot = r1(g.rot) }
  const height = plan.walls.length ? Math.max(...plan.walls.map((w) => w.height)) : 250
  const s = walkStart(plan)
  return {
    format: 'skela-unity-scene', version: 1, name: plan.name,
    spawn: { x: r1(s.x), y: r1(s.y), lookX: r1(s.lookX), lookY: r1(s.lookY) },
    ceiling: { height, color: '#f4f4f2' },
    groups, boxes,
  }
}
