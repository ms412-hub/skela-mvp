// 수정 전(2차 작업 시점) meshSkin.ts 사본. 수정 전후 비교 전용. 앱 번들에는 포함되지 않음.
// 2D 메시 변형 (Linear Blend Skinning) — 순수 계산 모듈 (React/Three 의존 없음)
// 좌표계: Three 세계 좌표 (원점 = 이미지 중앙, y가 위쪽)
// 회전 규약은 RigView의 rot()과 같음: 각도(도) 양수 = 반시계

export type V2 = { x: number; y: number }

export type RestChain = {
  key: string
  a: V2 // 윗관절(어깨/골반)
  m: V2 // 중간관절(팔꿈치/무릎)
  e: V2 // 끝관절(손목/발목)
  hw: number // 영향 반폭 (이 안은 100% 뼈를 따라감)
  ext: number // 끝관절 너머 손/발까지 포함하는 길이
}

export type Skin = {
  nx: number
  ny: number
  rest: Float32Array // xyz
  uv: Float32Array
  index: Uint32Array
  chain: Int16Array // 정점이 속한 팔다리 번호 (-1이면 고정)
  f: Float32Array // 팔다리 영향도 0~1 (나머지는 고정 부분과 섞임)
  wUp: Float32Array // 윗뼈 가중치 (아래뼈는 1-wUp)
  chains: RestChain[]
}

const rad = (d: number) => (d * Math.PI) / 180

function distSeg(p: V2, a: V2, b: V2) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy || 1
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

const smooth = (t: number) => t * t * (3 - 2 * t)

// 이미지 W×H 위에 격자 메시를 만들고 정점마다 자동 가중치를 계산
export function buildSkin(chains: RestChain[], W: number, H: number, cell = 12): Skin {
  const nx = Math.max(2, Math.ceil(W / cell))
  const ny = Math.max(2, Math.ceil(H / cell))
  const n = (nx + 1) * (ny + 1)
  const rest = new Float32Array(n * 3)
  const uv = new Float32Array(n * 2)
  const chain = new Int16Array(n).fill(-1)
  const f = new Float32Array(n)
  const wUp = new Float32Array(n).fill(1)

  // 끝관절 너머까지 늘린 아랫뼈 끝점
  const tips = chains.map((c) => {
    const dx = c.e.x - c.m.x
    const dy = c.e.y - c.m.y
    const l = Math.hypot(dx, dy) || 1
    return { x: c.e.x + (dx / l) * c.ext, y: c.e.y + (dy / l) * c.ext }
  })

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

      // 가장 가까운 팔다리 하나에만 속하게 함 (옆 다리/반대쪽 팔을 끌고 가지 않도록)
      let best = -1
      let bestD = Infinity
      let bestUp = 0
      let bestLo = 0
      chains.forEach((c, ci) => {
        const dUp = distSeg({ x, y }, c.a, c.m)
        const dLo = distSeg({ x, y }, c.m, tips[ci])
        const d = Math.min(dUp, dLo)
        if (d < bestD) {
          bestD = d
          best = ci
          bestUp = dUp
          bestLo = dLo
        }
      })
      if (best < 0) continue
      const c = chains[best]
      const fall = Math.max(c.hw * 1.5, 40) // 가장자리에서 서서히 약해지는 구간 (넓을수록 늘어남이 분산됨)
      const t = (bestD - c.hw) / fall
      const fv = t <= 0 ? 1 : t >= 1 ? 0 : 1 - smooth(t)
      if (fv <= 0) continue
      chain[k] = best
      f[k] = fv
      const blend = Math.max(4, c.hw * 0.5) // 관절 주변에서 윗/아랫뼈가 섞이는 폭
      wUp[k] = 1 / (1 + Math.exp((bestUp - bestLo) / blend))
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
  return { nx, ny, rest, uv, index, chain, f, wUp, chains }
}

export type DeformStats = { folds: number; maxStretch: number; hidden: number }

// 한 변이 원래 길이의 이 배율보다 늘어난 삼각형은 번짐(smear)이 되므로 그리지 않음
export const CUT_STRETCH = 4

// angles: RigView와 같은 {key_up, key_lo, key_dx, key_dy}. out에 변형된 xyz를 씀.
export function deformSkin(
  skin: Skin,
  angles: Record<string, number>,
  out: Float32Array,
  outIndex?: Uint32Array,
): DeformStats & { drawCount: number } {
  const { rest, chain, f, wUp, chains, nx, ny } = skin

  const T = chains.map((c) => {
    const up = angles[c.key + '_up'] ?? 0
    const lo = angles[c.key + '_lo'] ?? 0
    const dx = angles[c.key + '_dx'] ?? 0
    const dy = angles[c.key + '_dy'] ?? 0
    const cu = Math.cos(rad(up))
    const su = Math.sin(rad(up))
    const cl = Math.cos(rad(up + lo))
    const sl = Math.sin(rad(up + lo))
    const Ap = { x: c.a.x + dx, y: c.a.y + dy }
    const vx = c.m.x - c.a.x
    const vy = c.m.y - c.a.y
    const Mp = { x: Ap.x + vx * cu - vy * su, y: Ap.y + vx * su + vy * cu }
    return { c, cu, su, cl, sl, Ap, Mp }
  })

  for (let k = 0; k < rest.length / 3; k++) {
    const x = rest[k * 3]
    const y = rest[k * 3 + 1]
    out[k * 3 + 2] = 0
    const ci = chain[k]
    if (ci < 0) {
      out[k * 3] = x
      out[k * 3 + 1] = y
      continue
    }
    const t = T[ci]
    // 윗뼈: 윗관절 기준 회전 + 이동
    const ux = x - t.c.a.x
    const uy = y - t.c.a.y
    const px = t.Ap.x + ux * t.cu - uy * t.su
    const py = t.Ap.y + ux * t.su + uy * t.cu
    // 아랫뼈: 중간관절 기준 회전 + 이동
    const lx = x - t.c.m.x
    const ly = y - t.c.m.y
    const qx = t.Mp.x + lx * t.cl - ly * t.sl
    const qy = t.Mp.y + lx * t.sl + ly * t.cl
    const w = wUp[k]
    const bx = w * px + (1 - w) * qx
    const by = w * py + (1 - w) * qy
    out[k * 3] = x + f[k] * (bx - x)
    out[k * 3 + 1] = y + f[k] * (by - y)
  }

  // 품질 지표 + 과하게 늘어난 삼각형 제외
  let folds = 0
  let hidden = 0
  let drawCount = 0
  const W1 = nx + 1
  const area = (a: number, b: number, c: number, p: Float32Array) =>
    (p[b * 3] - p[a * 3]) * (p[c * 3 + 1] - p[a * 3 + 1]) - (p[c * 3] - p[a * 3]) * (p[b * 3 + 1] - p[a * 3 + 1])
  const ratio = (a: number, b: number) => {
    const r = Math.hypot(rest[b * 3] - rest[a * 3], rest[b * 3 + 1] - rest[a * 3 + 1]) || 1
    return Math.hypot(out[b * 3] - out[a * 3], out[b * 3 + 1] - out[a * 3 + 1]) / r
  }
  let maxStretch = 1
  const tri = (a: number, b: number, c: number) => {
    if (outIndex && chain[a] < 0 && chain[b] < 0 && chain[c] < 0) {
      outIndex[drawCount++] = a
      outIndex[drawCount++] = b
      outIndex[drawCount++] = c
      return
    }
    const st = Math.max(ratio(a, b), ratio(b, c), ratio(c, a))
    if (st > CUT_STRETCH) {
      hidden++
      return
    }
    if (st > maxStretch) maxStretch = st
    if (area(a, b, c, out) * area(a, b, c, rest) <= 0) folds++
    if (outIndex) {
      outIndex[drawCount++] = a
      outIndex[drawCount++] = b
      outIndex[drawCount++] = c
    }
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
  return { folds, maxStretch, hidden, drawCount }
}
