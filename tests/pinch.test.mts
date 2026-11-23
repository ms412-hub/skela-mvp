// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { pinchCamera, ZOOM_MAX, ZOOM_MIN } from '../src/editor/pinch.ts'

const size = { w: 400, h: 300 }
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)
// 화면 → 월드, 월드 → 화면 (SceneView와 같은 식)
const toWorld = (c: { x: number; y: number; zoom: number }, p: { x: number; y: number }) => ({ x: (p.x - size.w / 2) / c.zoom + c.x, y: (p.y - size.h / 2) / c.zoom + c.y })

test('손가락을 움직이지 않으면 카메라는 그대로다', () => {
  const cam = { x: 300, y: 500, zoom: 0.6 }
  const r = pinchCamera({ cam, a: { x: 100, y: 100 }, b: { x: 200, y: 100 } }, { a: { x: 100, y: 100 }, b: { x: 200, y: 100 } }, size)
  close(r.x, cam.x); close(r.y, cam.y); close(r.zoom, cam.zoom)
})

test('벌리면 확대되고, 손가락 가운데 아래의 월드 위치는 그대로 가운데 아래에 있다', () => {
  const cam = { x: 300, y: 500, zoom: 0.5 }
  const a0 = { x: 150, y: 120 }, b0 = { x: 250, y: 120 } // 가운데 (200, 120), 거리 100
  const a1 = { x: 100, y: 120 }, b1 = { x: 300, y: 120 } // 거리 200 → 2배
  const r = pinchCamera({ cam, a: a0, b: b0 }, { a: a1, b: b1 }, size)
  close(r.zoom, 1.0)
  const before = toWorld(cam, { x: 200, y: 120 })
  const after = toWorld(r, { x: 200, y: 120 })
  close(after.x, before.x); close(after.y, before.y)
})

test('모으면 축소된다', () => {
  const cam = { x: 0, y: 0, zoom: 1 }
  const r = pinchCamera({ cam, a: { x: 100, y: 100 }, b: { x: 300, y: 100 } }, { a: { x: 150, y: 100 }, b: { x: 250, y: 100 } }, size)
  close(r.zoom, 0.5)
})

test('두 손가락을 같이 옮기면(거리 그대로) 화면이 따라 이동한다', () => {
  const cam = { x: 300, y: 500, zoom: 0.5 }
  const start = { cam, a: { x: 150, y: 100 }, b: { x: 250, y: 100 } }
  const r = pinchCamera(start, { a: { x: 190, y: 130 }, b: { x: 290, y: 130 } }, size)
  close(r.zoom, 0.5)
  // 손가락 가운데 (200,100) 아래에 있던 월드 점이 (240,130) 아래로 따라갔다
  const w0 = toWorld(cam, { x: 200, y: 100 })
  const w1 = toWorld(r, { x: 240, y: 130 })
  close(w1.x, w0.x); close(w1.y, w0.y)
})

test('배율은 한도 안으로 제한되고, 겹친 손가락(거리 0)에서도 깨지지 않는다', () => {
  const cam = { x: 0, y: 0, zoom: 1 }
  assert.equal(pinchCamera({ cam, a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, { a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } }, size).zoom, ZOOM_MAX)
  assert.equal(pinchCamera({ cam, a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } }, { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, size).zoom, ZOOM_MIN)
  const r = pinchCamera({ cam, a: { x: 50, y: 50 }, b: { x: 50, y: 50 } }, { a: { x: 60, y: 60 }, b: { x: 60, y: 60 } }, size)
  assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.zoom))
})
