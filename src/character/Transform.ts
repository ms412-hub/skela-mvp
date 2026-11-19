// 2D Transform 계산 (화면 API 없음, 단독 테스트 가능)
//
// 좌표계: 원본 이미지 픽셀과 같다. 오른쪽이 +x, 아래가 +y. 회전은 화면에서 시계 방향이 + (도 단위).
// 행렬은 canvas setTransform과 같은 순서 [a, b, c, d, e, f]:  x' = a·x + c·y + e,  y' = b·x + d·y + f

export type Vec2 = { x: number; y: number }
export type Mat = [number, number, number, number, number, number]

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

// m · n  (n을 먼저 적용하고 그 다음 m)
export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

export const apply = (m: Mat, p: Vec2): Vec2 => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })
// 방향(이동 없이 회전·크기만) 적용
export const applyLinear = (m: Mat, v: Vec2): Vec2 => ({ x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y })

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y]
export const scaling = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0]
export function rotation(deg: number): Mat {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r), s = Math.sin(r)
  return [c, s, -s, c, 0, 0]
}

// Unity의 Transform에 해당. pivot은 파츠 이미지 안의 픽셀 좌표(관절 위치), position은 그 pivot이 부모 좌표계에서 놓이는 곳.
export type Transform = { position: Vec2; rotation: number; scale: Vec2; pivot: Vec2 }

// 로컬 행렬 = T(position) · R(rotation) · S(scale) · T(-pivot)
// → 파츠는 항상 pivot(관절)을 중심으로 회전·확대된다.
export function localMatrix(t: Transform): Mat {
  return multiply(multiply(multiply(translate(t.position.x, t.position.y), rotation(t.rotation)), scaling(t.scale.x, t.scale.y)), translate(-t.pivot.x, -t.pivot.y))
}

// 기울어짐(skew)이 없는 행렬을 위치·회전·크기로 나눈다
export function decompose(m: Mat): { position: Vec2; rotation: number; scale: Vec2 } {
  const sx = Math.hypot(m[0], m[1])
  const rot = (Math.atan2(m[1], m[0]) * 180) / Math.PI
  const det = m[0] * m[3] - m[1] * m[2]
  return { position: { x: m[4], y: m[5] }, rotation: rot, scale: { x: sx, y: sx ? det / sx : 0 } }
}

// 각도를 -180~180으로
export const normDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
