// 실행: npm test  (node --experimental-strip-types --test "tests/*.test.mts")
import test from 'node:test'
import assert from 'node:assert/strict'
import { foregroundMask } from '../src/meshSkin.ts'

const mk = (W: number, H: number, f: (x: number, y: number) => number[]) => {
  const a = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = f(x, y)
      const i = (y * W + x) * 4
      a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = c[3] ?? 255
    }
  return a
}
const disc = (x: number, y: number, r = 25) => Math.hypot(x - 50, y - 50) < r

test('흰 배경 + 어두운 원: 원이 전경', () => {
  const m = foregroundMask(mk(100, 100, (x, y) => (disc(x, y) ? [30, 30, 40] : [255, 255, 255])), 100, 100)
  assert.ok(m)
  const fg = m!.data.reduce((a, v) => a + v, 0)
  assert.ok(Math.abs(fg - Math.PI * 625) < 80, `전경 ${fg}px`)
})

test('윤곽선에 둘러싸인 안쪽 흰색은 전경으로 남는다', () => {
  const m = foregroundMask(mk(100, 100, (x, y) => { const d = Math.hypot(x - 50, y - 50); return d < 25 && d > 20 ? [30, 30, 40] : [255, 255, 255] }), 100, 100)
  assert.ok(m)
  assert.equal(m!.data[50 * 100 + 50], 1)
})

test('투명 배경(알파 0)은 배경', () => {
  const m = foregroundMask(mk(100, 100, (x, y) => (disc(x, y) ? [200, 50, 50, 255] : [0, 0, 0, 0])), 100, 100)
  assert.ok(m)
  assert.equal(m!.data[0], 0)
  assert.equal(m!.data[50 * 100 + 50], 1)
})

test('단색 회색·파랑 배경은 null(윤곽 인식 끔)', () => {
  for (const c of [[128, 128, 128], [30, 60, 160]]) assert.equal(foregroundMask(mk(100, 100, () => c), 100, 100), null)
})

test('위쪽만 흰색인 그라데이션 배경은 null (전경 70%대로 오인하지 않음)', () => {
  // 위 30%는 흰색, 아래는 파란색으로 변하는 배경 + 가운데 원
  const m = foregroundMask(mk(100, 100, (x, y) => (disc(x, y, 15) ? [30, 30, 40] : y < 30 ? [255, 255, 255] : [150, 180, 220])), 100, 100)
  assert.equal(m, null)
})

test('캐릭터가 화면의 약 20%인 일반적인 경우는 켜진다', () => {
  const m = foregroundMask(mk(100, 100, (x, y) => (Math.abs(x - 50) < 12 && y > 10 && y < 90 ? [30, 30, 40] : [255, 255, 255])), 100, 100)
  assert.ok(m)
})
