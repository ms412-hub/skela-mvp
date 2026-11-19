// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeHole, chooseStrategy, fillHole, fillPatch } from '../src/inpainting.ts'

const make = (w: number, h: number, f: (x: number, y: number) => [number, number, number]) => {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); d.set([r, g, b, 255], (y * w + x) * 4) }
  return d
}
const rect = (w: number, h: number, x0: number, y0: number, x1: number, y1: number) => {
  const m = new Uint8Array(w * h)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1
  return m
}
const stripes = (x: number): [number, number, number] => (Math.floor(x / 3) % 2 ? [220, 30, 30] : [30, 30, 220])
// 구멍 안쪽 픽셀들이 정답(원본)과 얼마나 다른지 (평균 절대 오차)
const mae = (a: Uint8ClampedArray, truth: Uint8ClampedArray, m: Uint8Array) => {
  let s = 0, c = 0
  for (let i = 0; i < m.length; i++) if (m[i]) { for (let k = 0; k < 3; k++) s += Math.abs(a[i * 4 + k] - truth[i * 4 + k]); c += 3 }
  return s / c
}

test('analyzeHole: 작은 구멍은 얇고 큰 구멍은 두껍다', () => {
  const w = 60, h = 60
  const d = make(w, h, () => [100, 100, 100])
  const small = analyzeHole(d, rect(w, h, 20, 20, 23, 23), w, h)
  const big = analyzeHole(d, rect(w, h, 10, 10, 50, 50), w, h)
  assert.equal(small.area, 9)
  assert.ok(small.depth <= 2)
  assert.equal(big.area, 1600)
  assert.ok(big.depth >= 18)
  assert.ok(big.boundaryVariance < 1, '단색 배경이라 편차가 거의 없다')
})

test('chooseStrategy: 작으면 diffuse, 큰 단색은 diffuse, 큰 무늬는 patch, 크고 복잡하면 ai', () => {
  assert.equal(chooseStrategy({ area: 9, depth: 2, boundaryVariance: 80 }), 'diffuse')
  assert.equal(chooseStrategy({ area: 5000, depth: 30, boundaryVariance: 2 }), 'diffuse')
  assert.equal(chooseStrategy({ area: 5000, depth: 30, boundaryVariance: 30 }), 'patch')
  assert.equal(chooseStrategy({ area: 5000, depth: 30, boundaryVariance: 90 }), 'ai')
  assert.equal(chooseStrategy({ area: 1000, depth: 30, boundaryVariance: 90 }), 'patch', '면적이 작으면 복잡해도 AI까지는 가지 않는다')
  assert.equal(chooseStrategy({ area: 5000, depth: 30, boundaryVariance: 90 }, { aiMinArea: 9999 }), 'patch')
})

test('큰 구멍의 줄무늬를 이어 준다: 예시 기반이 기존 번짐 방식보다 정답에 훨씬 가깝다', () => {
  const w = 80, h = 80
  const truth = make(w, h, (x) => stripes(x))
  const m = rect(w, h, 25, 20, 55, 60) // 30×40 구멍
  const a = truth.slice(), b = truth.slice()
  for (let i = 0; i < w * h; i++) if (m[i]) { a.set([255, 255, 255, 0], i * 4); b.set([255, 255, 255, 0], i * 4) }
  const diffuse = fillHole(a, m, w, h, { strategy: 'diffuse' })
  const patch = fillHole(b, m, w, h, { strategy: 'patch' })
  assert.equal(diffuse.strategy, 'diffuse')
  assert.equal(patch.strategy, 'patch')
  assert.equal(patch.filled, 1200)
  const eDiffuse = mae(a, truth, m), ePatch = mae(b, truth, m)
  assert.ok(ePatch < eDiffuse / 2, `patch ${ePatch.toFixed(1)} 은 diffuse ${eDiffuse.toFixed(1)} 의 절반보다 작아야 한다`)
})

test('구멍이 아닌 픽셀은 바뀌지 않고, 구멍은 모두 불투명하게 채워진다', () => {
  const w = 60, h = 60
  const d = make(w, h, (x, y) => [(x * 4) % 256, (y * 4) % 256, 90])
  const before = d.slice()
  const m = rect(w, h, 18, 18, 42, 42)
  for (let i = 0; i < w * h; i++) if (m[i]) d.set([0, 0, 0, 0], i * 4)
  const res = fillHole(d, m, w, h, { strategy: 'patch' })
  assert.equal(res.filled, 24 * 24)
  for (let i = 0; i < w * h; i++) {
    if (m[i]) assert.equal(d[i * 4 + 3], 255)
    else assert.deepEqual([...d.slice(i * 4, i * 4 + 4)], [...before.slice(i * 4, i * 4 + 4)])
  }
})

test('같은 입력이면 항상 같은 결과가 나온다 (무작위 없음)', () => {
  const w = 50, h = 50
  const mk = () => { const d = make(w, h, (x, y) => [(x * 7) % 200, (y * 5) % 200, 60]); return d }
  const m = rect(w, h, 15, 15, 35, 35)
  const a = mk(), b = mk()
  fillPatch(a, m, w, h)
  fillPatch(b, m, w, h)
  assert.deepEqual([...a], [...b])
})

test('가장자리에 닿은 구멍도 채운다', () => {
  const w = 60, h = 60
  const d = make(w, h, (x) => stripes(x))
  const m = rect(w, h, 0, 0, 20, 20)
  for (let i = 0; i < w * h; i++) if (m[i]) d.set([0, 0, 0, 0], i * 4)
  assert.equal(fillHole(d, m, w, h, { strategy: 'patch' }).filled, 400)
  for (let i = 0; i < w * h; i++) if (m[i]) assert.equal(d[i * 4 + 3], 255)
})

test('ai 전략: 훅이 성공하면 그 결과를 쓰고, 훅이 없거나 실패하면 patch로 처리한다', () => {
  const w = 70, h = 70
  const base = () => make(w, h, (x) => stripes(x))
  const m = rect(w, h, 10, 10, 60, 60)
  let called = 0
  const ok = base()
  const r1 = fillHole(ok, m, w, h, { strategy: 'ai', aiFill: (px) => { called++; px.fill(7); return true } })
  assert.equal(r1.strategy, 'ai')
  assert.equal(called, 1)
  const r2 = fillHole(base(), m, w, h, { strategy: 'ai' })
  assert.equal(r2.strategy, 'patch', '훅이 없으면 브라우저 안에서 되는 방법으로')
  const r3 = fillHole(base(), m, w, h, { strategy: 'ai', aiFill: () => false })
  assert.equal(r3.strategy, 'patch', '훅이 실패해도 마찬가지')
})

test('구멍이 없거나 전부 구멍이면 아무것도 하지 않는다', () => {
  const w = 10, h = 10
  const d = make(w, h, () => [1, 2, 3])
  const before = d.slice()
  assert.equal(fillHole(d, new Uint8Array(w * h), w, h).filled, 0)
  assert.equal(fillHole(d, new Uint8Array(w * h).fill(1), w, h).filled, 0)
  assert.deepEqual([...d], [...before])
})
