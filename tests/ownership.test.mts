// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { rootSnapshot, nextSnapshot, moveOwner, pathBetween, paintDisc, paintLine, strokeDiff, encodeOwner, decodeOwner } from '../src/character/ownership.ts'

const W = 20, H = 10
const fresh = () => new Uint8Array(W * H) // 전부 몸통(0)

test('브러시: 원 안의 전경 픽셀만 대상 파츠로 바뀌고, 배경은 칠하지 않는다', () => {
  const owner = fresh()
  const fg = new Uint8Array(W * H).fill(1)
  fg[5 * W + 5] = 0 // 배경 한 칸
  const orig = new Map<number, number>()
  paintDisc(owner, fg, W, H, 5.5, 5.5, 2, 3, orig)
  assert.equal(owner[5 * W + 6], 3)
  assert.equal(owner[5 * W + 5], 0, '배경은 그대로')
  assert.equal(owner[0], 0, '원 밖은 그대로')
  assert.ok(orig.size > 5)
})

test('strokeDiff: 실제로 바뀐 픽셀만, 칠했다 되돌린 곳은 빠진다', () => {
  const owner = fresh()
  const orig = new Map<number, number>()
  paintLine(owner, null, W, H, 2, 2, 12, 2, 1.5, 4, orig)
  const n = [...owner].filter((v) => v === 4).length
  // 같은 획에서 일부를 다시 몸통(0)으로
  paintDisc(owner, null, W, H, 2.5, 2.5, 1.5, 0, orig)
  const d = strokeDiff(owner, orig)!
  assert.equal(d.idx.length, [...owner].filter((v) => v === 4).length)
  assert.ok(d.idx.length < n)
  assert.ok([...d.from].every((v) => v === 0) && [...d.to].every((v) => v === 4))
  assert.equal(strokeDiff(owner, new Map()), null)
})

test('스냅샷: 되돌리기·다시 실행·갈라진 이력 사이를 정확히 오간다', () => {
  const owner = fresh()
  const s0 = rootSnapshot()
  const stroke = (cx: number, target: number, prev: ReturnType<typeof rootSnapshot>) => {
    const orig = new Map<number, number>()
    paintDisc(owner, null, W, H, cx, 5, 2, target, orig)
    return nextSnapshot(prev, strokeDiff(owner, orig)!)
  }
  const s1 = stroke(4, 2, s0)
  const a1 = owner.slice()
  const s2 = stroke(6, 3, s1) // 첫 획과 겹친다
  const a2 = owner.slice()
  moveOwner(owner, s2, s0)
  assert.deepEqual([...owner], [...fresh()], '처음으로')
  moveOwner(owner, s0, s2)
  assert.deepEqual([...owner], [...a2], '다시 끝으로')
  moveOwner(owner, s2, s1)
  assert.deepEqual([...owner], [...a1])
  // s1에서 갈라진 새 획
  const s3 = stroke(15, 5, s1)
  const a3 = owner.slice()
  const touched = moveOwner(owner, s3, s2)
  assert.deepEqual([...owner], [...a2], '갈라진 가지 사이 이동')
  assert.ok(touched.has(5) && touched.has(3))
  moveOwner(owner, s2, s3)
  assert.deepEqual([...owner], [...a3])
  assert.deepEqual(pathBetween(s3, s3), { back: [], fwd: [] })
})

test('저장용 압축은 원래대로 풀리고, 크기가 다르거나 깨진 값은 거절한다', () => {
  const owner = fresh()
  owner.fill(7, 30, 55)
  owner[199] = 2
  const rle = encodeOwner(owner)
  assert.ok(rle.length < 20)
  assert.deepEqual([...decodeOwner(rle, W * H)!], [...owner])
  assert.equal(decodeOwner(rle, W * H + 1), null)
  assert.equal(decodeOwner([300, 200], 200), null)
})
