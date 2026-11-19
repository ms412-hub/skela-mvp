// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { fillMasked } from '../src/holeFill.ts'

const make = (w: number, h: number, f: (x: number, y: number) => [number, number, number]) => {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); d.set([r, g, b, 255], (y * w + x) * 4) }
  return d
}
const maskRect = (w: number, h: number, x0: number, y0: number, x1: number, y1: number) => {
  const m = new Uint8Array(w * h)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1
  return m
}

test('구멍이 아닌 픽셀은 바뀌지 않는다', () => {
  const w = 20, h = 20
  const d = make(w, h, (x) => (x < 10 ? [200, 0, 0] : [0, 0, 200]))
  const before = d.slice()
  const m = maskRect(w, h, 7, 7, 13, 13)
  fillMasked(d, m, w, h)
  for (let i = 0; i < w * h; i++) if (!m[i]) assert.deepEqual([...d.slice(i * 4, i * 4 + 4)], [...before.slice(i * 4, i * 4 + 4)])
})

test('구멍은 주변 색 범위 안의 색으로 채워지고 불투명해진다', () => {
  const w = 20, h = 20
  const d = make(w, h, (x) => (x < 10 ? [200, 0, 0] : [0, 0, 200]))
  const m = maskRect(w, h, 7, 7, 13, 13)
  for (let i = 0; i < w * h; i++) if (m[i]) d.set([255, 255, 255, 0], i * 4) // 흰색·투명으로 비워 둔다
  const n = fillMasked(d, m, w, h)
  assert.equal(n, 36)
  for (let i = 0; i < w * h; i++) if (m[i]) {
    assert.equal(d[i * 4 + 3], 255)
    assert.ok(d[i * 4] <= 200 && d[i * 4 + 2] <= 200, '주변에 없던 색(흰색)이 남으면 안 된다')
    assert.ok(d[i * 4 + 1] === 0)
  }
  // 왼쪽 가장자리는 빨강 쪽, 오른쪽 가장자리는 파랑 쪽
  const px = (x: number, y: number) => [...d.slice((y * w + x) * 4, (y * w + x) * 4 + 3)]
  assert.ok(px(7, 10)[0] > px(12, 10)[0])
  assert.ok(px(12, 10)[2] > px(7, 10)[2])
})

test('가장자리에 닿은 구멍도 채운다', () => {
  const w = 12, h = 12
  const d = make(w, h, () => [10, 120, 10])
  const m = maskRect(w, h, 0, 0, 5, 5)
  d.set([255, 255, 255, 0], 0)
  assert.equal(fillMasked(d, m, w, h), 25)
  assert.deepEqual([...d.slice(0, 4)], [10, 120, 10, 255])
})

test('구멍이 없거나 전부 구멍이면 아무것도 바꾸지 않는다', () => {
  const w = 6, h = 6
  const d = make(w, h, () => [1, 2, 3])
  const before = d.slice()
  assert.equal(fillMasked(d, new Uint8Array(w * h), w, h), 0)
  assert.equal(fillMasked(d, new Uint8Array(w * h).fill(1), w, h), 0)
  assert.deepEqual([...d], [...before])
})
