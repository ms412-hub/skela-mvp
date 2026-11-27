// v2 상자 목록: 기존 벽·문·바닥 계산(geometry.ts)은 그대로 쓰고, 가구만 v2 목록(계단 포함)으로 만든다.
// 숨김(visible:false)·내보내기 제외(exportable:false) 가구를 걸러낼 수 있다. 화면 API 없음.
import type { Furniture, Plan } from '../Plan.ts'
import { FIGHT_STEP, floorBox, openingBoxes, wallBoxes, type SceneBox } from '../geometry.ts'
import { furnitureTypeV2 } from './catalog2.ts'

export type ItemFlags = { visible?: boolean; exportable?: boolean; locked?: boolean }
export type FurnitureV2 = Furniture & ItemFlags
export const isVisible = (f: FurnitureV2) => f.visible !== false
export const isExportable = (f: FurnitureV2) => f.exportable !== false && f.visible !== false

export type BoxFilter = {
  forExport?: boolean // 숨김·제외 가구를 뺀다
  onlyFurniture?: string // 이 가구만 (스프라이트, 가구 하나 내보내기)
  hideWalls?: Set<string> // 잘라낼 벽 id
  noFloor?: boolean
  rawSize?: boolean // 떨림 방지 확대를 하지 않은 원래 크기 (가구 원점 계산용)
}

export function furnitureBoxesV2(f: FurnitureV2, rawSize = false): SceneBox[] {
  const t = furnitureTypeV2(f.type)
  if (!t) return []
  const sx = f.w / t.w, sz = f.d / t.d, sh = f.h / t.h
  const r = (f.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  return t.boxes.map((b, i) => {
    const lx = b.x * sx, lz = b.z * sz
    const g = rawSize ? 0 : i * FIGHT_STEP
    return { kind: 'furniture', id: `${f.id}:${i}`, cx: f.x + c * lx - s * lz, cz: f.y + s * lx + c * lz, cy: (b.y + b.h / 2) * sh, w: b.w * sx + 2 * g, h: b.h * sh + 2 * g, d: b.d * sz + 2 * g, rotDeg: f.rot, color: b.color ?? f.color }
  })
}

// 내려가는 계단 자리만큼 바닥을 뚫는다: 바닥 상자를 구멍 둘레의 띠 상자들로 나눈다 (계단은 0·90·180·270도 기준)
export function floorWithHoles(floor: SceneBox, holes: Furniture[]): SceneBox[] {
  let pieces = [floor]
  for (const f of holes) {
    const side = Math.round(f.rot / 90) % 2 !== 0
    const hw = (side ? f.d : f.w) / 2, hd = (side ? f.w : f.d) / 2
    const hx0 = f.x - hw, hx1 = f.x + hw, hz0 = f.y - hd, hz1 = f.y + hd
    const next: SceneBox[] = []
    for (const b of pieces) {
      const x0 = b.cx - b.w / 2, x1 = b.cx + b.w / 2, z0 = b.cz - b.d / 2, z1 = b.cz + b.d / 2
      if (hx1 <= x0 || hx0 >= x1 || hz1 <= z0 || hz0 >= z1) { next.push(b); continue }
      const cx0 = Math.max(x0, hx0), cx1 = Math.min(x1, hx1)
      const rects = [[x0, z0, x1, Math.max(z0, hz0)], [x0, Math.min(z1, hz1), x1, z1], [x0, Math.max(z0, hz0), cx0, Math.min(z1, hz1)], [cx1, Math.max(z0, hz0), x1, Math.min(z1, hz1)]]
      for (const [a, c, e, g] of rects) if (e - a > 0.5 && g - c > 0.5) next.push({ ...b, cx: (a + e) / 2, cz: (c + g) / 2, w: e - a, d: g - c })
    }
    pieces = next
  }
  return pieces.map((b, i) => ({ ...b, id: i ? `floor:${i}` : 'floor' }))
}

export function buildBoxesV2(plan: Plan, filter: BoxFilter = {}): SceneBox[] {
  const out: SceneBox[] = []
  const furn = (plan.furniture as FurnitureV2[]).filter((f) => (filter.onlyFurniture ? f.id === filter.onlyFurniture : filter.forExport ? isExportable(f) : isVisible(f)))
  if (filter.onlyFurniture) return furn.flatMap((f) => furnitureBoxesV2(f, filter.rawSize))
  if (!filter.noFloor) out.push(...floorWithHoles(floorBox(plan), furn.filter((f) => f.type === 'stairsdown')))
  for (const w of plan.walls) if (!filter.hideWalls?.has(w.id)) out.push(...wallBoxes(plan, w))
  for (const b of openingBoxes(plan)) {
    const op = plan.openings.find((o) => o.id === b.id.split(':')[0])
    if (op && !filter.hideWalls?.has(op.wallId)) out.push(b)
  }
  for (const f of furn) out.push(...furnitureBoxesV2(f, filter.rawSize))
  return out
}

// 카메라 쪽 벽 잘라내기: 눈(평면도 좌표)이 벽의 "방 바깥 쪽"에 30cm 넘게 있으면 숨긴다.
// 방 안쪽 판단은 방 전체 가운데 기준 (편집 화면의 반투명 규칙과 같다).
export const CUT_MARGIN = 30
export function cutawayWalls(plan: Plan, eye: { x: number; y: number }): Set<string> {
  const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x]), ys = plan.walls.flatMap((w) => [w.a.y, w.b.y])
  if (!xs.length) return new Set()
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const hidden = new Set<string>()
  for (const w of plan.walls) {
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
    if (len < 1) continue
    const nx = -(w.b.y - w.a.y) / len, ny = (w.b.x - w.a.x) / len
    const mx = (w.a.x + w.b.x) / 2, my = (w.a.y + w.b.y) / 2
    const inside = Math.sign((cx - mx) * nx + (cy - my) * ny) || 1
    const d = ((eye.x - mx) * nx + (eye.y - my) * ny) * inside
    if (d < -CUT_MARGIN) hidden.add(w.id)
  }
  return hidden
}
