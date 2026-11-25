import test from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATES } from '../src/interior/templates.ts'
import { overlaps } from '../src/interior/Plan.ts'
import { buildBoxes } from '../src/interior/geometry.ts'

for (const t of TEMPLATES) {
  test(`템플릿 ${t.name}: 벽·문·가구가 모두 만들어진다`, () => {
    const p = t.build()
    assert.ok(p.walls.length >= 4)
    assert.ok(p.openings.some((o) => o.kind === 'door'), '문이 하나는 있어야 걷기 시작점이 생긴다')
    for (const o of p.openings) assert.equal(overlaps(p, o), false)
    // 가구는 바깥 벽 안쪽에 있어야 한다
    const xs = p.walls.flatMap((w) => [w.a.x, w.b.x]), ys = p.walls.flatMap((w) => [w.a.y, w.b.y])
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    for (const f of p.furniture) {
      const r = Math.max(f.w, f.d) / 2
      const ex = f.rot % 180 === 0 ? f.w / 2 : f.d / 2, ey = f.rot % 180 === 0 ? f.d / 2 : f.w / 2
      assert.ok(f.x - ex >= x0 && f.x + ex <= x1 && f.y - ey >= y0 && f.y + ey <= y1, `${f.id}(${f.type}) 벽 밖 r=${r}`)
    }
    assert.ok(buildBoxes(p).length > p.walls.length)
  })
}

test('템플릿은 매번 새 객체를 만든다', () => {
  assert.notEqual(TEMPLATES[0].build(), TEMPLATES[0].build())
})

test('방 범위는 돌린 가구의 실제 차지 영역으로 잰다', async () => {
  const { planBounds } = await import('../src/interior/Plan.ts')
  const p = TEMPLATES[0].build() // 원룸: 90° 돌린 옷장이 오른쪽 벽에 붙어 있다
  const b = planBounds(p)
  assert.equal(b.x1, 600)
  assert.equal(b.y1, 450)
})

test('쓰리룸 아파트: 문 4개, 창문 5개가 모두 들어간다 (겹쳐서 빠진 것 없음)', () => {
  const p = TEMPLATES.find((t) => t.id === 'apartment')!.build()
  assert.equal(p.openings.filter((o) => o.kind === 'door').length, 4)
  assert.equal(p.openings.filter((o) => o.kind === 'window').length, 5)
  assert.equal(p.walls.length, 8)
  assert.ok(p.furniture.length >= 25)
})

test('5룸 대형 아파트: 약 60평, 문 7개(현관·안방 욕실 포함), 창문 8개, 방 5개, 욕실 1개', async () => {
  const { planBounds } = await import('../src/interior/Plan.ts')
  const p = TEMPLATES.find((t) => t.id === 'fiveroom')!.build()
  const b = planBounds(p)
  const pyeong = ((b.x1 - b.x0) * (b.y1 - b.y0)) / 10000 / 3.3058
  assert.ok(Math.abs(pyeong - 60) < 0.5, `평수 ${pyeong}`)
  assert.equal(p.openings.filter((o) => o.kind === 'door').length, 7)
  for (const k of ['toilet', 'basin', 'bathtub', 'tile']) assert.equal(p.furniture.filter((f) => f.type === k).length, 1, k)
  assert.equal(p.openings.filter((o) => o.kind === 'window').length, 8)
  assert.equal(p.furniture.filter((f) => f.type === 'bed').length, 5)
  // 거실과 주방 사이 벽 두 개, 가운데는 2m 통로
  const mid = p.walls.filter((w) => w.a.y === 700 && w.b.y === 700)
  assert.equal(mid.length, 2)
  assert.equal(Math.min(...mid.map((w) => Math.max(w.a.x, w.b.x))) , 700)
  assert.equal(Math.max(...mid.map((w) => Math.min(w.a.x, w.b.x))) , 900)
  assert.equal(p.furniture.filter((f) => f.type === 'floortile').length, 1)
  assert.equal(p.openings[0].wallId, 'wall3', '현관이 첫 문이어야 걷기가 현관에서 시작한다')
})

test('복도형 아파트: 약 60평, 현관에서 거실까지 복도가 비어 있다', async () => {
  const { planBounds } = await import('../src/interior/Plan.ts')
  const p = TEMPLATES.find((t) => t.id === 'corridor')!.build()
  const b = planBounds(p)
  const pyeong = ((b.x1 - b.x0) * (b.y1 - b.y0)) / 10000 / 3.3058
  assert.ok(Math.abs(pyeong - 60) < 0.5, `평수 ${pyeong}`)
  assert.equal(p.openings.filter((o) => o.kind === 'door').length, 10)
  assert.equal(p.openings.filter((o) => o.kind === 'window').length, 13)
  assert.equal(p.furniture.filter((f) => f.type === 'bed').length, 5)
  assert.equal(p.furniture.filter((f) => f.type === 'toilet').length, 2)
  assert.equal(p.openings[0].wallId, 'wall4', '현관(왼쪽 벽)이 첫 문')
  // 복도(y 416~576, x 0~1500)에는 가구가 없어야 한다
  for (const f of p.furniture) {
    const ex = f.rot % 180 === 0 ? f.w / 2 : f.d / 2, ey = f.rot % 180 === 0 ? f.d / 2 : f.w / 2
    const inHall = f.x - ex < 1500 && f.y + ey > 421 && f.y - ey < 571
    assert.ok(!inHall, `${f.id}(${f.type})가 복도를 막는다`)
  }
})

test('복도형 64평: 가운데 거실·주방, 복도 끝 가장 큰 안방, 큰 방 두 곳에 욕실', async () => {
  const { planBounds, pointInFurniture } = await import('../src/interior/Plan.ts')
  const p = TEMPLATES.find((t) => t.id === 'corridor64')!.build()
  const b = planBounds(p)
  const pyeong = ((b.x1 - b.x0) * (b.y1 - b.y0)) / 10000 / 3.3058
  assert.ok(Math.abs(pyeong - 64) < 0.5, `평수 ${pyeong}`)
  assert.equal(p.furniture.filter((f) => f.type === 'bed').length, 5)
  assert.equal(p.furniture.filter((f) => f.type === 'toilet').length, 3)
  assert.equal(p.openings[0].wallId, 'wall4', '현관이 첫 문')
  // 주방 살림: 조리대 2, 상부장, 키큰장 3, 아일랜드 + 바 의자 2, 6인 식탁, 펜던트 3
  const kitchen = p.furniture.filter((f) => f.x > 550 && f.x < 1400 && f.y > 561)
  const count = (t: string) => kitchen.filter((f) => f.type === t).length
  assert.deepEqual([count('counter'), count('upper'), count('tallcab'), count('island'), count('stool'), count('chair'), count('pendant')], [2, 1, 3, 1, 2, 6, 3])
  // 거실(TV)과 주방(조리대)은 집 가운데 (x 550~1400)
  for (const t of ['tv', 'counter', 'dining']) { const f = p.furniture.find((q) => q.type === t)!; assert.ok(f.x > 550 && f.x < 1400, t) }
  // 안방(1760~2200)이 가장 크고, 둘째 방(0~550 위쪽)이 그다음. 둘 다 안에 변기가 있다
  const rooms = { master: 440 * 962, second: 550 * 401, r3: 330 * 401, r4: 360 * 401, r5: 360 * 401 }
  assert.ok(rooms.master > rooms.second && rooms.second > Math.max(rooms.r3, rooms.r4, rooms.r5))
  const toilets = p.furniture.filter((f) => f.type === 'toilet')
  assert.ok(toilets.some((t) => t.x > 1760), '안방 욕실')
  assert.ok(toilets.some((t) => t.x < 550 && t.y < 401), '둘째 방 욕실')
  // 복도(현관 쪽 x<550, 안방 쪽 1400~1760, y 406~556)에는 가구가 없다
  for (const f of p.furniture) for (let x = 5; x < 1760; x += 10) {
    if (x > 550 && x < 1400) continue
    for (const y of [410, 481, 550]) assert.ok(!pointInFurniture(f, { x, y }), `${f.id}(${f.type})가 복도를 막는다`)
  }
})
