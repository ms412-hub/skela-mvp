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
