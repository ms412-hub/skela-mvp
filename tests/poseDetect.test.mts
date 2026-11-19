// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { unpad, meanVisibility, pickBest, detectWithPadding, PAD_STEPS } from '../src/poseDetect.ts'
import type { MakeCanvas, Landmark } from '../src/poseDetect.ts'

test('unpad: 여백을 붙인 캔버스의 0~1 좌표를 원래 그림 픽셀로 되돌린다', () => {
  // 100×200 그림에 여백 10% → 캔버스 120×240, 원래 그림은 (10, 20)부터
  const [p] = unpad([{ x: 0.5, y: 0.5, visibility: 0.9 }], 0.1, 100, 200)
  assert.equal(p.x, 50)
  assert.equal(p.y, 100)
  assert.equal(p.v, 0.9)
  const [q] = unpad([{ x: 10 / 120, y: 20 / 240 }], 0.1, 100, 200)
  assert.ok(Math.abs(q.x) < 1e-9 && Math.abs(q.y) < 1e-9, '원래 그림의 왼쪽 위 모서리')
  const [r] = unpad([{ x: 0.25, y: 0.75 }], 0, 100, 200)
  assert.deepEqual([r.x, r.y], [25, 150])
})

test('meanVisibility: 기본 관절 13개의 신뢰도 평균 (없는 관절은 0)', () => {
  const pts = Array.from({ length: 33 }, () => ({ v: 1 }))
  assert.equal(meanVisibility(pts), 1)
  pts[0].v = 0
  assert.ok(Math.abs(meanVisibility(pts) - 12 / 13) < 1e-9)
  assert.equal(meanVisibility([]), 0)
})

test('pickBest: 신뢰도가 가장 높은 것, 같으면 여백이 작은 것', () => {
  assert.equal(pickBest([{ pad: 0, score: 0.6 }, { pad: 0.2, score: 0.86 }, { pad: 0.35, score: 0.79 }])?.pad, 0.2)
  assert.equal(pickBest([{ pad: 0.35, score: 0.9 }, { pad: 0.1, score: 0.9 }])?.pad, 0.1)
  assert.equal(pickBest([]), null)
})

// 가짜 캔버스: 크기만 기억한다
const fakeMake: MakeCanvas = (w, h) => ({ canvas: { width: w, height: h } as unknown as CanvasImageSource, ctx: { fillStyle: '', fillRect() {}, drawImage() {} } })
const lms = (x: number, y: number, v: number): Landmark[] => Array.from({ length: 33 }, () => ({ x, y, visibility: v }))
const src = { width: 100, height: 200 } as unknown as HTMLCanvasElement

test('detectWithPadding: 모든 여백을 시도하고 신뢰도가 가장 높은 결과를 원래 좌표로 돌려준다', () => {
  const seen: number[] = []
  const lm = {
    detect: (c: any) => {
      seen.push(c.width)
      // 여백 20%(캔버스 폭 140)에서만 신뢰도가 높다고 가정. 그 캔버스의 정중앙 = 원래 그림 정중앙
      return { landmarks: [lms(0.5, 0.5, c.width === 140 ? 0.95 : 0.6)] }
    },
  }
  const r = detectWithPadding(lm, src, { makeCanvas: fakeMake })!
  assert.deepEqual(seen, [100, 120, 140, 170], '여백 0/10/20/35%를 모두 시도')
  assert.equal(r.pad, 0.2)
  assert.ok(Math.abs(r.points[11].x - 50) < 1e-9 && Math.abs(r.points[11].y - 100) < 1e-9)
  assert.deepEqual(PAD_STEPS, [0, 0.1, 0.2, 0.35])
})

test('detectWithPadding: 여백 없이는 못 찾고 여백을 붙이면 찾는 그림도 찾는다', () => {
  const lm = { detect: (c: any) => ({ landmarks: c.width === 100 ? [] : [lms(0.5, 0.5, 0.8)] }) }
  const r = detectWithPadding(lm, src, { makeCanvas: fakeMake })
  assert.ok(r)
  assert.ok(r!.pad > 0)
})

test('detectWithPadding: 어느 여백에서도 못 찾으면 null', () => {
  const lm = { detect: () => ({ landmarks: [] }) }
  assert.equal(detectWithPadding(lm, src, { makeCanvas: fakeMake }), null)
})
