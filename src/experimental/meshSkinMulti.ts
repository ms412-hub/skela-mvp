// 실험: 다중 뼈 자동 가중치 + LBS (정점당 최대 4뼈)
//
// 알고리즘 아이디어 출처: Rigby2D `src/core/meshgeom.js`의 autoWeights
// (https://github.com/jaisurya-dev-art/rigby2d, MIT OR Apache-2.0) — "뼈까지 거리의 역수 거듭제곱을
// 정규화하고 상위 4개만 남긴다". 이 파일은 그 아이디어를 Skela의 격자 메시·좌표계에 맞게 새로 작성한
// 것이며 원본 코드를 복사하지 않았다. 몸통/머리/골반을 "정지 뼈"로 두어 팔다리와 경쟁시키는 부분은 Skela 고유 설계.
//
// 좌표계·회전 규약은 meshSkin.ts와 동일 (Three 세계 좌표, y 위, 각도 양수 = 반시계)

import type { RestChain, V2, DeformStats } from '../meshSkin'
import { STRETCH_LIMIT } from '../meshSkin'

export type StaticBone = { a: V2; b: V2 }

export type SkinMulti = {
  nx: number
  ny: number
  rest: Float32Array
  uv: Float32Array
  index: Uint32Array
  bone: Int16Array // 정점당 4개 (-1 = 없음). 뼈 번호: 0..2n-1 = 팔다리(윗/아랫), 그 뒤 = 정지 뼈/루트
  weight: Float32Array // 정점당 4개
  chains: RestChain[]
  movingBones: number // 움직이는 뼈 수 (= 2 × 팔다리 수). 이 이후의 번호는 모두 정지
}

const rad = (d: number) => (d * Math.PI) / 180

function distSeg(p: V2, a: V2, b: V2) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy || 1
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

export type MultiOpts = {
  cell?: number
  power?: number // 거리 역수 지수 (클수록 가장 가까운 뼈가 지배)
  rootDist?: number // 어떤 뼈에서도 이 거리(뼈 반폭 단위)보다 멀면 고정 배경으로 간주
}

export function buildSkinMulti(
  chains: RestChain[],
  statics: StaticBone[],
  W: number,
  H: number,
  opts: MultiOpts = {},
): SkinMulti {
  const cell = opts.cell ?? 12
  const power = opts.power ?? 4
  const rootDist = opts.rootDist ?? 1.6
  const nx = Math.max(2, Math.ceil(W / cell))
  const ny = Math.max(2, Math.ceil(H / cell))
  const n = (nx + 1) * (ny + 1)
  const rest = new Float32Array(n * 3)
  const uv = new Float32Array(n * 2)
  const bone = new Int16Array(n * 4).fill(-1)
  const weight = new Float32Array(n * 4)

  const tips = chains.map((c) => {
    const dx = c.e.x - c.m.x
    const dy = c.e.y - c.m.y
    const l = Math.hypot(dx, dy) || 1
    return { x: c.e.x + (dx / l) * c.ext, y: c.e.y + (dy / l) * c.ext }
  })
  // 뼈 목록: [윗뼈0, 아랫뼈0, 윗뼈1, ...] + 정지 뼈 + 루트
  type Seg = { a: V2; b: V2; hw: number }
  const segs: Seg[] = []
  chains.forEach((c, i) => {
    segs.push({ a: c.a, b: c.m, hw: c.hw }, { a: c.m, b: tips[i], hw: c.hw })
  })
  const hwAvg = chains.reduce((s, c) => s + c.hw, 0) / Math.max(1, chains.length)
  for (const s of statics) segs.push({ a: s.a, b: s.b, hw: hwAvg })
  const rootIdx = segs.length

  const eps = 0.1
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i
      const u = i / nx
      const v = j / ny
      const x = -W / 2 + u * W
      const y = H / 2 - v * H
      rest[k * 3] = x
      rest[k * 3 + 1] = y
      uv[k * 2] = u
      uv[k * 2 + 1] = 1 - v

      // 거리를 뼈 반폭 단위로 정규화 → 팔(가늘다)·다리(굵다)가 같은 기준으로 경쟁
      const raw: { b: number; w: number }[] = segs.map((s, bi) => ({
        b: bi,
        w: 1 / Math.pow(distSeg({ x, y }, s.a, s.b) / s.hw + eps, power),
      }))
      raw.push({ b: rootIdx, w: 1 / Math.pow(rootDist + eps, power) })
      raw.sort((p, q) => q.w - p.w)
      const top = raw.slice(0, 4)
      const total = top.reduce((s, r) => s + r.w, 0)
      top.forEach((r, t) => {
        bone[k * 4 + t] = r.b
        weight[k * 4 + t] = r.w / total
      })
    }
  }

  const index = new Uint32Array(nx * ny * 6)
  let q = 0
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i
      const b = a + 1
      const c = a + (nx + 1)
      const d = c + 1
      index.set([a, c, b, b, c, d], q)
      q += 6
    }
  }
  return { nx, ny, rest, uv, index, bone, weight, chains, movingBones: chains.length * 2 }
}

export function deformSkinMulti(
  skin: SkinMulti,
  angles: Record<string, number>,
  out: Float32Array,
  outIndex?: Uint32Array,
): DeformStats & { drawCount: number } {
  const { rest, bone, weight, chains, nx, ny, movingBones } = skin

  // 움직이는 뼈마다 (피벗, 이동 후 피벗, cos, sin)
  const T: { px: number; py: number; qx: number; qy: number; c: number; s: number }[] = []
  for (const c of chains) {
    const up = angles[c.key + '_up'] ?? 0
    const lo = angles[c.key + '_lo'] ?? 0
    const dx = angles[c.key + '_dx'] ?? 0
    const dy = angles[c.key + '_dy'] ?? 0
    const cu = Math.cos(rad(up))
    const su = Math.sin(rad(up))
    const Ap = { x: c.a.x + dx, y: c.a.y + dy }
    const vx = c.m.x - c.a.x
    const vy = c.m.y - c.a.y
    const Mp = { x: Ap.x + vx * cu - vy * su, y: Ap.y + vx * su + vy * cu }
    T.push({ px: c.a.x, py: c.a.y, qx: Ap.x, qy: Ap.y, c: cu, s: su })
    T.push({ px: c.m.x, py: c.m.y, qx: Mp.x, qy: Mp.y, c: Math.cos(rad(up + lo)), s: Math.sin(rad(up + lo)) })
  }

  const n = rest.length / 3
  const moved = new Uint8Array(n)
  for (let k = 0; k < n; k++) {
    const x = rest[k * 3]
    const y = rest[k * 3 + 1]
    let ox = 0
    let oy = 0
    for (let t = 0; t < 4; t++) {
      const b = bone[k * 4 + t]
      if (b < 0) break
      const w = weight[k * 4 + t]
      if (b < movingBones) {
        const m = T[b]
        const lx = x - m.px
        const ly = y - m.py
        ox += w * (m.qx + lx * m.c - ly * m.s)
        oy += w * (m.qy + lx * m.s + ly * m.c)
      } else {
        ox += w * x
        oy += w * y
      }
    }
    out[k * 3] = ox
    out[k * 3 + 1] = oy
    out[k * 3 + 2] = 0
    if (Math.abs(ox - x) + Math.abs(oy - y) > 0.01) moved[k] = 1
  }

  let folds = 0
  let overLimit = 0
  let drawCount = 0
  let maxStretch = 1
  const W1 = nx + 1
  const area = (a: number, b: number, c: number, p: Float32Array) =>
    (p[b * 3] - p[a * 3]) * (p[c * 3 + 1] - p[a * 3 + 1]) - (p[c * 3] - p[a * 3]) * (p[b * 3 + 1] - p[a * 3 + 1])
  const ratio = (a: number, b: number) => {
    const r = Math.hypot(rest[b * 3] - rest[a * 3], rest[b * 3 + 1] - rest[a * 3 + 1]) || 1
    return Math.hypot(out[b * 3] - out[a * 3], out[b * 3 + 1] - out[a * 3 + 1]) / r
  }
  const tri = (a: number, b: number, c: number) => {
    if (outIndex) {
      outIndex[drawCount++] = a
      outIndex[drawCount++] = b
      outIndex[drawCount++] = c
    }
    if (!(moved[a] || moved[b] || moved[c])) return
    const st = Math.max(ratio(a, b), ratio(b, c), ratio(c, a))
    if (st > maxStretch) maxStretch = st
    if (st > STRETCH_LIMIT) overLimit++
    if (area(a, b, c, out) * area(a, b, c, rest) <= 0) folds++
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * W1 + i
      const b = a + 1
      const c = a + W1
      const d = c + 1
      tri(a, c, b)
      tri(b, c, d)
    }
  }
  return { folds, maxStretch, overLimit, drawCount }
}
