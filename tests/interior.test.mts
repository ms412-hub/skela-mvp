// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyPlan, addWall, removeWall, addOpening, updateOpening, removeOpening, updateWall, addFurniture, updateFurniture, removeFurniture,
  nearestWall, nearestOnSegment, pointInFurniture, planBounds, snapTo, nextId, toPlanFile, fromPlanFile, wallLength, MIN_WALL,
} from '../src/interior/Plan.ts'
import type { Plan } from '../src/interior/Plan.ts'
import { buildBoxes, wallBoxes } from '../src/interior/geometry.ts'
import { CATALOG, furnitureType } from '../src/interior/catalog.ts'
import { createHistory } from '../src/undoManager.ts'

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)
// 4×3m 방 (벽 4개)
const room = (): Plan => {
  let p = emptyPlan()
  p = addWall(p, { x: 0, y: 0 }, { x: 400, y: 0 })
  p = addWall(p, { x: 400, y: 0 }, { x: 400, y: 300 })
  p = addWall(p, { x: 400, y: 300 }, { x: 0, y: 300 })
  p = addWall(p, { x: 0, y: 300 }, { x: 0, y: 0 })
  return p
}

test('벽: 짧은 벽은 만들지 않고, id가 겹치지 않으며, 지우면 문·창문도 함께 지워진다', () => {
  const p0 = emptyPlan()
  assert.equal(addWall(p0, { x: 0, y: 0 }, { x: MIN_WALL - 1, y: 0 }), p0, '너무 짧은 벽은 그대로')
  let p = room()
  assert.deepEqual(p.walls.map((w) => w.id), ['wall1', 'wall2', 'wall3', 'wall4'])
  p = addOpening(p, 'wall1', 0.5, 'door')
  assert.equal(p.openings.length, 1)
  const q = removeWall(p, 'wall1')
  assert.equal(q.walls.length, 3)
  assert.equal(q.openings.length, 0)
  assert.equal(removeWall(p, 'nope'), p)
  assert.equal(nextId('wall', ['wall2', 'wall7', 'x']), 'wall8')
})

test('문·창문: 벽 안에 맞추고, 겹치면 거절하고, 이동·삭제할 수 있다', () => {
  let p = room()
  p = addOpening(p, 'wall1', 0.01, 'door') // 모서리 쪽 → 벽 안으로 밀려 들어옴
  const d = p.openings[0]
  assert.ok(d.t * 400 - d.width / 2 >= -1e-9, '문이 벽 시작 밖으로 나가지 않음')
  const same = addOpening(p, 'wall1', d.t, 'window')
  assert.equal(same, p, '겹치는 창문은 거절')
  p = addOpening(p, 'wall1', 0.8, 'window')
  assert.equal(p.openings.length, 2)
  const moved = updateOpening(p, 'window1', { t: 0.5 })
  assert.notEqual(moved, p)
  assert.equal(updateOpening(p, 'window1', { t: d.t }), p, '문과 겹치게 옮기면 거절')
  assert.equal(removeOpening(p, 'door1').openings.length, 1)
  // 벽을 짧게 하면 문이 벽 안으로 다시 맞춰진다
  const short = updateWall(p, 'wall1', { b: { x: 120, y: 0 } })
  for (const o of short.openings.filter((x) => x.wallId === 'wall1')) assert.ok(o.t * 120 + o.width / 2 <= 120 + 1e-9)
})

test('3D 상자: 문이 있는 벽은 위·옆 상자로 나뉘고, 창문은 아래도 막는다', () => {
  let p = emptyPlan()
  p = addWall(p, { x: 0, y: 0 }, { x: 400, y: 0 })
  const plain = wallBoxes(p, p.walls[0])
  assert.equal(plain.length, 1)
  close(plain[0].w, 400 + 10, 1e-9) // 두께의 절반씩 양끝을 늘림
  close(plain[0].h, 250)
  p = addOpening(p, 'wall1', 0.5, 'door')
  const withDoor = wallBoxes(p, p.walls[0])
  // 문 왼쪽, 문 위, 문 오른쪽 = 3개 (문 아래는 바닥이라 없음)
  assert.equal(withDoor.length, 3)
  const above = withDoor.find((b) => b.id.endsWith('above'))!
  close(above.cy, (205 + 250) / 2); close(above.h, 45); close(above.w, 90)
  p = addOpening(p, 'wall1', 0.15, 'window')
  const withBoth = wallBoxes(p, p.walls[0])
  assert.ok(withBoth.some((b) => b.id.endsWith('below')), '창문 아래도 막힘')
  // 모든 상자가 벽 선 위에 있다
  for (const b of withBoth) { close(b.cz, 0); close(b.d, 10) }
})

test('3D 상자: 벽 방향이 다르면 회전 각이 맞고, 상자가 벽 선 위에 놓인다', () => {
  let p = emptyPlan()
  p = addWall(p, { x: 100, y: 100 }, { x: 100, y: 300 }) // 아래로 향하는 벽
  const [b] = wallBoxes(p, p.walls[0])
  close(b.rotDeg, 90)
  close(b.cx, 100); close(b.cz, 200)
  close(b.w, 210)
})

test('가구: 회전하면 상자들이 가구 가운데를 기준으로 같이 돈다', () => {
  let p = emptyPlan()
  const t = furnitureType('bed')!
  p = addFurniture(p, 'bed', 300, 200, t)
  const at0 = buildBoxes(p).filter((b) => b.kind === 'furniture')
  assert.equal(at0.length, t.boxes.length)
  // 가구 가운데에서 상자 가운데들의 평균 위치(무게중심)는 회전해도 가구 가운데와 거리가 같다
  const p90 = updateFurniture(p, 'furn1', { rot: 90 })
  const at90 = buildBoxes(p90).filter((b) => b.kind === 'furniture')
  const d = (b: { cx: number; cz: number }) => Math.hypot(b.cx - 300, b.cz - 200)
  for (let i = 0; i < at0.length; i++) close(d(at0[i]), d(at90[i]), 1e-6)
  // 머리판(침대 -z쪽)은 0°에서 위쪽(y 작음), 90°에서 오른쪽... 시계 방향 90°면 -z가 +x쪽으로
  const head0 = at0[at0.length - 1], head90 = at90[at90.length - 1]
  assert.ok(head0.cz < 200)
  assert.ok(head90.cx > 300)
  assert.ok(at90.every((b) => b.rotDeg === 90))
})

test('가구: id는 furn1, furn2 순서로 붙고 종류 이름으로 덮이지 않는다', () => {
  let p = emptyPlan()
  p = addFurniture(p, 'bed', 0, 0, furnitureType('bed')!)
  p = addFurniture(p, 'sofa', 100, 0, furnitureType('sofa')!)
  assert.deepEqual(p.furniture.map((f) => f.id), ['furn1', 'furn2'])
  assert.deepEqual(Object.keys(p.furniture[0]).sort(), ['color', 'd', 'h', 'id', 'rot', 'type', 'w', 'x', 'y'])
})

test('가구: 크기를 바꾸면 상자가 같은 비율로 커지고, 모르는 가구는 건너뛴다', () => {
  let p = emptyPlan()
  const t = furnitureType('dining')!
  p = addFurniture(p, 'dining', 0, 0, t)
  const base = buildBoxes(p).filter((b) => b.kind === 'furniture')
  const big = buildBoxes(updateFurniture(p, 'furn1', { w: t.w * 2, h: t.h * 2 })).filter((b) => b.kind === 'furniture')
  close(big[0].w, base[0].w * 2); close(big[0].h, base[0].h * 2); close(big[0].d, base[0].d)
  close(big[0].cy, base[0].cy * 2)
  const alien = { ...p, furniture: [...p.furniture, { id: 'furn9', type: 'ufo', x: 0, y: 0, rot: 0, w: 10, d: 10, h: 10, color: '#ffffff' }] }
  assert.equal(buildBoxes(alien).filter((b) => b.kind === 'furniture').length, base.length)
})

test('바닥: 벽·가구를 모두 덮고, 아무것도 없으면 기본 크기', () => {
  const f = buildBoxes(room()).find((b) => b.kind === 'floor')!
  close(f.w, 400); close(f.d, 300); close(f.cx, 200); close(f.cz, 150)
  const e = buildBoxes(emptyPlan()).find((b) => b.kind === 'floor')!
  assert.ok(e.w >= 100 && e.d >= 100)
  assert.deepEqual(planBounds(emptyPlan()), { x0: 0, y0: 0, x1: 600, y1: 500 })
})

test('선택 보조: 가까운 벽 찾기, 회전한 가구 안 판정, 격자 맞춤', () => {
  const p = room()
  const hit = nearestWall(p, { x: 200, y: 8 }, 30)!
  assert.equal(hit.wall.id, 'wall1'); close(hit.t, 0.5); close(hit.dist, 8)
  assert.equal(nearestWall(p, { x: 200, y: 150 }, 30), null, '방 한가운데는 벽에서 멀다')
  const f = { id: 'f', type: 'bed', x: 100, y: 100, rot: 90, w: 160, d: 40, h: 50, color: '#fff' }
  assert.ok(pointInFurniture(f, { x: 100, y: 170 }), '90° 돌아서 위아래로 긴 모양')
  assert.ok(!pointInFurniture(f, { x: 170, y: 100 }))
  assert.equal(snapTo(34, 10), 30); assert.equal(snapTo(35, 10), 40); assert.equal(snapTo(34, 0), 34)
  close(nearestOnSegment({ x: -50, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }).t, 0)
})

test('저장/불러오기: 같은 평면도로 돌아오고, 깨진 값은 걸러내거나 거절한다', () => {
  let p = room()
  p = addOpening(p, 'wall1', 0.5, 'door')
  p = addFurniture(p, 'sofa', 200, 150, furnitureType('sofa')!)
  const json = JSON.parse(JSON.stringify(toPlanFile(p)))
  const back = fromPlanFile(json)
  assert.deepEqual(back, p)
  assert.throws(() => fromPlanFile({ a: 1 }), /평면도 파일이 아니/)
  assert.throws(() => fromPlanFile({ ...json, version: 9 }), /버전/)
  const dirty = { ...json, plan: { ...json.plan, walls: [...json.plan.walls, { id: 'bad', a: 1 }], openings: [...json.plan.openings, { id: 'o', wallId: 'ghost', t: 0.5, width: 90, sill: 0, height: 200, kind: 'door' }], furniture: [...json.plan.furniture, { id: 'x', type: 'bed', x: 'a' }] } }
  const cleaned = fromPlanFile(dirty)
  assert.equal(cleaned.walls.length, 4); assert.equal(cleaned.openings.length, 1); assert.equal(cleaned.furniture.length, 1)
  assert.equal(fromPlanFile({ format: 'skela-interior-plan', version: 1, plan: { walls: [], floorColor: 'red' } }).floorColor, '#b58b5a', '잘못된 색은 기본값')
})

test('되돌리기: 벽 → 문 → 가구를 쌓고 순서대로 되돌릴 수 있다 (바뀌지 않은 부분은 객체 공유)', () => {
  const h = createHistory(emptyPlan())
  const p1 = addWall(h.present(), { x: 0, y: 0 }, { x: 300, y: 0 }); h.commit(p1)
  const p2 = addOpening(p1, 'wall1', 0.5, 'door'); h.commit(p2)
  const p3 = addFurniture(p2, 'chair', 100, 100, furnitureType('chair')!); h.commit(p3)
  assert.equal(p3.walls, p2.walls, '가구만 추가했으니 벽 배열은 같은 객체')
  assert.equal(h.undo(), p2); assert.equal(h.undo(), p1); assert.equal(h.redo(), p2)
  assert.equal(wallLength(h.present().walls[0]), 300)
})

test('가구 목록: 모든 가구가 상자를 가지고, 기본 크기가 합리적이다', () => {
  assert.ok(CATALOG.length >= 8)
  for (const t of CATALOG) {
    assert.ok(t.boxes.length > 0, t.id)
    assert.ok(t.w > 0 && t.d > 0 && t.h > 0, t.id)
    for (const b of t.boxes) assert.ok(b.w > 0 && b.d > 0 && b.h > 0 && b.y >= 0, `${t.id} 상자 값`)
    const top = Math.max(...t.boxes.map((b) => b.y + b.h))
    assert.ok(top <= t.h + 1, `${t.id}: 상자가 가구 높이를 넘지 않음 (${top} <= ${t.h})`)
  }
  assert.equal(new Set(CATALOG.map((t) => t.id)).size, CATALOG.length, 'id 중복 없음')
  assert.equal(removeFurniture(emptyPlan(), 'x').furniture.length, 0)
})
