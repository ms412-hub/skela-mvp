// 두 손가락 확대/이동 계산 (화면 API 없음, 단독 테스트 가능)
//
// 시작할 때 두 손가락 가운데 아래에 있던 "월드 위치"가, 손가락을 움직인 뒤에도 두 손가락 가운데 아래에 있도록 카메라를 계산한다.
// 손가락 사이가 벌어진 비율만큼 확대한다. 손가락 가운데가 움직인 만큼 화면이 따라 이동한다.
import type { Vec2 } from '../character/Transform'

export type Cam = { x: number; y: number; zoom: number } // 화면 중앙에 오는 월드 좌표와 배율
export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 8

const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)

export function pinchCamera(
  start: { cam: Cam; a: Vec2; b: Vec2 },
  now: { a: Vec2; b: Vec2 },
  size: { w: number; h: number },
): Cam {
  const m0 = mid(start.a, start.b)
  const m1 = mid(now.a, now.b)
  const d0 = Math.max(1, dist(start.a, start.b)) // 두 손가락이 거의 겹쳐 있어도 0으로 나누지 않게
  const d1 = Math.max(1, dist(now.a, now.b))
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, start.cam.zoom * (d1 / d0)))
  // 시작 시 가운데 아래의 월드 위치
  const wx = (m0.x - size.w / 2) / start.cam.zoom + start.cam.x
  const wy = (m0.y - size.h / 2) / start.cam.zoom + start.cam.y
  return { zoom, x: wx - (m1.x - size.w / 2) / zoom, y: wy - (m1.y - size.h / 2) / zoom }
}
