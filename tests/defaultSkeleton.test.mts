import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultSkeleton } from '../src/defaultSkeleton.ts'

test('17 joints with expected ids, all inside the image', () => {
  const pts = defaultSkeleton(400, 800)
  assert.deepEqual(pts.map((p) => p.id).sort((a, b) => a - b), [0, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28, 31, 32])
  for (const p of pts) {
    assert.ok(p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 800, `${p.id} inside`)
    assert.equal(p.source, 'auto')
  }
})
test('MediaPipe-left joints are on image right of their right counterparts', () => {
  const m = new Map(defaultSkeleton(400, 800).map((p) => [p.id, p]))
  for (const [l, r] of [[11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28]]) assert.ok(m.get(l)!.x > m.get(r)!.x)
})
test('top-to-bottom order and clamping on a very narrow image', () => {
  const m = new Map(defaultSkeleton(60, 800).map((p) => [p.id, p]))
  assert.ok(m.get(0)!.y < m.get(11)!.y && m.get(11)!.y < m.get(23)!.y && m.get(23)!.y < m.get(25)!.y && m.get(25)!.y < m.get(27)!.y)
  for (const p of m.values()) assert.ok(p.x >= 4 && p.x <= 56)
})
