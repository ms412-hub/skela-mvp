// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeDetected, moveJoint, resetToAuto, countManual, cleanSource, CUSTOM_MIN } from '../src/jointMerge.ts'
import type { JointPt } from '../src/jointMerge.ts'

const auto = (n = 0): JointPt[] => [
  { id: 0, name: '코', x: 100 + n, y: 50 + n },
  { id: 11, name: '왼쪽 어깨', x: 120 + n, y: 90 + n },
  { id: 12, name: '오른쪽 어깨', x: 80 + n, y: 90 + n },
  { id: 32, name: '오른쪽 발끝', x: 90 + n, y: 400 + n },
]
const withSource = (pts: JointPt[]) => pts.map((p) => ({ ...p, source: 'auto' as const }))

test('처음 추정: 전부 auto, 추가 관절 없음', () => {
  const r = mergeDetected(null, auto())
  assert.equal(r.pts.length, 4)
  assert.ok(r.pts.every((p) => p.source === 'auto'))
  assert.deepEqual([r.keptManual, r.refreshed, r.custom], [0, 4, 0])
})

test('다시 추정: 손본 관절은 유지, 나머지는 새 값으로 갱신', () => {
  const prev = withSource(auto())
  const moved = moveJoint(prev, 0, 150, 60) // 코를 사람이 옮김
  const r = mergeDetected(moved, auto(5)) // 새 추정은 모든 점이 +5
  const nose = r.pts.find((p) => p.id === 0)!
  assert.deepEqual([nose.x, nose.y, nose.source], [150, 60, 'manual'])
  const sh = r.pts.find((p) => p.id === 11)!
  assert.deepEqual([sh.x, sh.y, sh.source], [125, 95, 'auto']) // 자동은 갱신
  assert.deepEqual([r.keptManual, r.refreshed], [1, 3])
})

test('추가 관절은 위치·연결과 상관없이 유지된다', () => {
  const prev = [...withSource(auto()), { id: 100, name: '추가 관절 1', x: 10, y: 20 }, { id: 101, name: '추가 관절 2', x: 30, y: 40 }]
  const r = mergeDetected(prev, auto(7))
  assert.deepEqual(r.pts.filter((p) => p.id >= CUSTOM_MIN).map((p) => [p.id, p.x, p.y]), [[100, 10, 20], [101, 30, 40]])
  assert.equal(r.custom, 2)
})

test('discardManual: 손본 기본 관절은 덮어쓰고 추가 관절은 유지', () => {
  const prev = [...moveJoint(withSource(auto()), 12, 1, 2), { id: 100, name: '추가 관절 1', x: 10, y: 20 }]
  const r = mergeDetected(prev, auto(3), { discardManual: true })
  const sh = r.pts.find((p) => p.id === 12)!
  assert.deepEqual([sh.x, sh.y, sh.source], [83, 93, 'auto'])
  assert.equal(r.keptManual, 0)
  assert.ok(r.pts.some((p) => p.id === 100))
})

test('새 추정에 없는 기존 기본 관절은 지우지 않는다', () => {
  const prev = [...withSource(auto()), { id: 5, name: '옛 점', x: 1, y: 1, source: 'manual' as const }]
  const r = mergeDetected(prev, auto())
  assert.ok(r.pts.some((p) => p.id === 5))
})

test('여러 번 다시 추정해도 손본 위치가 변하지 않는다 (멱등)', () => {
  let cur: JointPt[] = moveJoint(withSource(auto()), 0, 150, 60)
  for (let i = 1; i <= 5; i++) cur = mergeDetected(cur, auto(i)).pts
  const nose = cur.find((p) => p.id === 0)!
  assert.deepEqual([nose.x, nose.y, nose.source], [150, 60, 'manual'])
  assert.equal(cur.length, 4) // 점이 늘어나지 않음
})

test('같은 자리로 놓으면 손본 것으로 표시하지 않는다', () => {
  const prev = withSource(auto())
  const same = moveJoint(prev, 0, 100, 50)
  assert.equal(same.find((p) => p.id === 0)!.source, 'auto')
  assert.equal(countManual(same), 0)
})

test('추가 관절을 옮겨도 source는 바뀌지 않고 세지 않는다', () => {
  const prev = [...withSource(auto()), { id: 100, name: '추가 관절 1', x: 10, y: 20 }]
  const r = moveJoint(prev, 100, 50, 60)
  assert.equal(r.find((p) => p.id === 100)!.source, undefined)
  assert.equal(countManual(r), 0)
})

test('원래 추정값으로: 기본 관절은 되돌리고 손본 표시 해제, 추가 관절 유지', () => {
  const original = withSource(auto())
  const cur = [...moveJoint(original, 0, 150, 60), { id: 100, name: '추가 관절 1', x: 10, y: 20 }]
  const r = resetToAuto(original, cur)
  assert.deepEqual([r.find((p) => p.id === 0)!.x, r.find((p) => p.id === 0)!.source], [100, 'auto'])
  assert.ok(r.some((p) => p.id === 100))
  assert.equal(countManual(r), 0)
})

test('입력 배열을 바꾸지 않는다 (불변)', () => {
  const prev = moveJoint(withSource(auto()), 0, 150, 60)
  const snapshot = JSON.stringify(prev)
  mergeDetected(prev, auto(2))
  mergeDetected(prev, auto(2), { discardManual: true })
  resetToAuto(withSource(auto()), prev)
  assert.equal(JSON.stringify(prev), snapshot)
})

test('cleanSource: 알 수 없는 값은 없는 것으로', () => {
  assert.equal(cleanSource('manual'), 'manual')
  assert.equal(cleanSource('auto'), 'auto')
  for (const v of [undefined, null, 1, 'x', {}, '__proto__']) assert.equal(cleanSource(v), undefined)
})
