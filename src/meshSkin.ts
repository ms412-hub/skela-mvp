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
  ext: number // tip이 없을 때 끝관절 너머 손/발까지 포함하는 길이
  tip?: V2 // 손끝/발끝 기준점. 있으면 손/발을 별도 뼈(끝관절→tip)로 취급
  hwEnd?: number // 손/발 뼈의 반폭 (기본은 hw). 신발처럼 아랫다리보다 넓은 부분을 통째로 따라가게 함
}

// 움직이지 않아야 하는 머리·몸통. 이 영역의 정점은 팔다리 영향에서 제외(보호)한다.
export type BodyProtect = {
  head: V2 // 머리 중심
  headR: number
  neck: V2 // 몸통 중심선 위쪽 끝
  waist: V2 // 몸통 중심선 아래쪽 끝 (골반 높이)
  torsoR: number // 이 안은 100% 고정
  fade: number // 이 폭에 걸쳐 고정 → 팔다리 영향으로 서서히 넘어감
  // 골반: 좌우 엉덩이 사이를 잇는 굵은 선분(샅 쪽으로 약간 내림). 다리가 골반을 끌고 가지 않게 함
  pelvisA: V2
  pelvisB: V2
  pelvisR: number
  pelvisFade: number
  // 샅 중앙선: 골반 중심에서 허벅지 위쪽까지만 내려가는 가는 보호선. 좌우 다리의 경계(충돌)를 완만하게 만든다
  crotchA: V2
  crotchB: V2
  crotchR: number
  crotchFade: number
}

// 관절 좌표(세계 좌표)에서 보호 영역을 만든다. P(id)는 MediaPipe 관절 번호의 위치.
export function makeBody(P: (id: number) => V2): BodyProtect {
  const mid = (a: V2, b: V2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const sh = mid(P(11), P(12))
  const hp = mid(P(23), P(24))
  const nose = P(0)
  const Ws = Math.hypot(P(11).x - P(12).x, P(11).y - P(12).y) // 어깨폭
  const Hs = Ws / 2
  const hl = P(23)
  const hr = P(24)
  const Wh = Math.hypot(hl.x - hr.x, hl.y - hr.y) // 엉덩이 관절 사이 폭
  // 골반 기준점: 좌우 엉덩이 사이 20%~80% 구간을 샅 쪽(몸통 아래 방향)으로 살짝 내려 잡음
  const down = { x: (hp.x - sh.x), y: (hp.y - sh.y) }
  const dl = Math.hypot(down.x, down.y) || 1
  const sag = Wh * 0.12
  const at = (t: number): V2 => ({
    x: hl.x + (hr.x - hl.x) * t + (down.x / dl) * sag,
    y: hl.y + (hr.y - hl.y) * t + (down.y / dl) * sag,
  })
  const kn = mid(P(25), P(26))
  const cA = at(0.5)
  return {
    crotchA: cA,
    crotchB: { x: cA.x + (kn.x - cA.x) * 0.3, y: cA.y + (kn.y - cA.y) * 0.3 }, // 허벅지 위쪽 30%까지만. 그 아래는 다리가 자유롭게 움직여야 함
    crotchR: Wh * 0.10,
    crotchFade: Wh * 0.40, // 다리 중심(Wh/2)에 닿으면 보호가 0
    pelvisA: at(0.2),
    pelvisB: at(0.8),
    pelvisR: Wh * 0.30,
    pelvisFade: Wh * 0.30,
    head: nose,
    headR: Ws * 0.42,
    neck: { x: sh.x + (nose.x - sh.x) * 0.35, y: sh.y + (nose.y - sh.y) * 0.35 },
    waist: hp,
    torsoR: Hs * 0.45,
    fade: Hs * 0.55, // torsoR + fade = 어깨 관절 위치(Hs)에서 보호가 0이 됨
  }
}

export type Skin = {
  nx: number
  ny: number
  rest: Float32Array // xyz
  uv: Float32Array
  index: Uint32Array
  nc: number // 팔다리 수
  w: Float32Array // 정점×팔다리 영향도(0~1). 모든 팔다리 영향의 합이 1을 넘지 않고, 나머지는 고정(정지) 가중치
  wUp: Float32Array // 정점×팔다리별 윗뼈 가중치
  wEnd: Float32Array // 정점×팔다리별 손/발 뼈 가중치 (아랫뼈 가중치 = 1 - wUp - wEnd)
  active: Uint8Array // 어떤 팔다리의 영향이라도 받으면 1
  chains: RestChain[]
}

const rad = (d: number) => (d * Math.PI) / 180

function segT(p: V2, a: V2, b: V2) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy || 1
  return Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
}
function distSeg(p: V2, a: V2, b: V2) {
  const t = segT(p, a, b)
  return Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t))
}

const smooth = (t: number) => t * t * (3 - 2 * t)

// 이미지 W×H 위에 격자 메시를 만들고 정점마다 자동 가중치를 계산.
// 가중치는 팔다리마다 따로 연속적으로 계산해 그대로 섞는다(가장 가까운 팔다리 하나로 갈라 붙이지 않음).
// 그래서 두 팔다리의 경계에서 정점이 서로 반대로 움직여 찢어지는 불연속이 생기지 않는다.
export function buildSkin(chains: RestChain[], W: number, H: number, cell = 12, body?: BodyProtect): Skin {
  const nx = Math.max(2, Math.ceil(W / cell))
  const ny = Math.max(2, Math.ceil(H / cell))
  const n = (nx + 1) * (ny + 1)
  const nc = chains.length
  const rest = new Float32Array(n * 3)
  const uv = new Float32Array(n * 2)
  const w = new Float32Array(n * nc)
  const wUp = new Float32Array(n * nc).fill(1)
  const wEnd = new Float32Array(n * nc)
  const active = new Uint8Array(n)

  // 손/발끝: 명시된 tip이 있으면 그것, 없으면 아랫뼈 방향으로 ext만큼 연장
  const tips = chains.map((c) => {
    if (c.tip) return c.tip
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

      // 머리·몸통·골반·샅 보호: 보호 영역 안쪽일수록 팔다리 영향을 줄인다
      let protect = 0
      if (body) {
        const dt = distSeg({ x, y }, body.neck, body.waist)
        const pt = dt <= body.torsoR ? 1 : dt >= body.torsoR + body.fade ? 0 : 1 - smooth((dt - body.torsoR) / body.fade)
        const dh = Math.hypot(x - body.head.x, y - body.head.y)
        const hf = body.headR * 0.35
        const ph = dh <= body.headR ? 1 : dh >= body.headR + hf ? 0 : 1 - smooth((dh - body.headR) / hf)
        const dp = distSeg({ x, y }, body.pelvisA, body.pelvisB)
        const pp = dp <= body.pelvisR ? 1 : dp >= body.pelvisR + body.pelvisFade ? 0 : 1 - smooth((dp - body.pelvisR) / body.pelvisFade)
        const dc = distSeg({ x, y }, body.crotchA, body.crotchB)
        const pc = dc <= body.crotchR ? 1 : dc >= body.crotchR + body.crotchFade ? 0 : 1 - smooth((dc - body.crotchR) / body.crotchFade)
        protect = Math.max(pt, ph, pp, pc)
      }

      let sum = 0
      chains.forEach((c, ci) => {
        const hwE = c.hwEnd ?? c.hw
        const dUp = distSeg({ x, y }, c.a, c.m)
        const dLo = distSeg({ x, y }, c.m, c.e)
        const dEnd = distSeg({ x, y }, c.e, tips[ci])
        // 세 뼈 중 자기 반폭 기준으로 가장 가까운 뼈까지의 "여유"(0 이하면 뼈 폭 안쪽)
        const exUp = dUp - c.hw
        const exLo = dLo - c.hw
        const exEnd = dEnd - hwE
        const ex = Math.min(exUp, exLo, exEnd)
        const L1 = Math.hypot(c.m.x - c.a.x, c.m.y - c.a.y)
        const L2 = Math.hypot(c.e.x - c.m.x, c.e.y - c.m.y)
        const S = ex === exUp ? segT({ x, y }, c.a, c.m) * L1 : ex === exLo ? L1 + segT({ x, y }, c.m, c.e) * L2 : L1 + L2 + segT({ x, y }, c.e, tips[ci]) * Math.hypot(tips[ci].x - c.e.x, tips[ci].y - c.e.y)
        // 가장자리에서 서서히 약해지는 구간. 윗관절에서 멀수록(지렛대가 길수록) 이동량이 크므로 구간도 넓힌다.
        const fall = Math.max(c.hw * 1.5, 40, S * 0.45)
        const t = ex / fall
        const fv = t <= 0 ? 1 : t >= 1 ? 0 : 1 - smooth(t)
        const wc = fv * (1 - protect)
        w[k * nc + ci] = wc
        sum += wc
        // 윗뼈/아랫뼈/손발 뼈 가중치: 각 뼈까지 거리로 부드럽게 섞는다 (관절 근처에서만 섞임)
        const blend = Math.max(4, c.hw * 0.5)
        const m0 = Math.min(dUp, dLo, dEnd)
        const eU = Math.exp(-(dUp - m0) / blend)
        const eL = Math.exp(-(dLo - m0) / blend)
        const eE = Math.exp(-(dEnd - m0) / blend)
        const tot = eU + eL + eE
        wUp[k * nc + ci] = eU / tot
        wEnd[k * nc + ci] = eE / tot
      })
      if (sum > 1) for (let ci = 0; ci < nc; ci++) w[k * nc + ci] /= sum // 합이 1을 넘으면 비율만 유지
      if (sum > 1e-6) active[k] = 1
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
  return { nx, ny, rest, uv, index, nc, w, wUp, wEnd, active, chains }
}

export type DeformStats = { folds: number; maxStretch: number; overLimit: number }

// 격자 변이 원래 길이의 이 배율을 넘으면 "과도하게 늘어남"으로 센다. 삼각형을 숨기지는 않는다.
// 조작 중에는 이 한도를 넘는 자세로 가지 않도록 fitToLimit으로 입력을 제한한다.
export const STRETCH_LIMIT = 5

// angles: RigView와 같은 {key_up, key_lo, key_dx, key_dy}. out에 변형된 xyz를 씀.
export function deformSkin(
  skin: Skin,
  angles: Record<string, number>,
  out: Float32Array,
  outIndex?: Uint32Array,
): DeformStats & { drawCount: number } {
  const { rest, w, wUp, wEnd, nc, active, chains, nx, ny } = skin

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
    // 손/발 뼈: 끝관절을 피벗으로 (위+아래+손발 각도)만큼 회전. _ft가 0이면 아랫뼈와 완전히 같은 움직임
    const ft = angles[c.key + '_ft'] ?? 0
    const ce = Math.cos(rad(up + lo + ft))
    const se = Math.sin(rad(up + lo + ft))
    const ex = c.e.x - c.m.x
    const ey = c.e.y - c.m.y
    const Ep = { x: Mp.x + ex * cl - ey * sl, y: Mp.y + ex * sl + ey * cl }
    return { c, cu, su, cl, sl, ce, se, Ap, Mp, Ep }
  })

  // 정점 = (1 - Σ팔다리영향)·원래 위치 + Σ 팔다리영향·(윗뼈/아랫뼈 LBS 결과)
  for (let k = 0; k < rest.length / 3; k++) {
    const x = rest[k * 3]
    const y = rest[k * 3 + 1]
    out[k * 3 + 2] = 0
    if (!active[k]) {
      out[k * 3] = x
      out[k * 3 + 1] = y
      continue
    }
    let ox = 0
    let oy = 0
    let wsum = 0
    for (let ci = 0; ci < nc; ci++) {
      const wc = w[k * nc + ci]
      if (wc <= 0) continue
      const t = T[ci]
      const ux = x - t.c.a.x
      const uy = y - t.c.a.y
      const px = t.Ap.x + ux * t.cu - uy * t.su
      const py = t.Ap.y + ux * t.su + uy * t.cu
      const lx = x - t.c.m.x
      const ly = y - t.c.m.y
      const qx = t.Mp.x + lx * t.cl - ly * t.sl
      const qy = t.Mp.y + lx * t.sl + ly * t.cl
      const ex = x - t.c.e.x
      const ey = y - t.c.e.y
      const rx = t.Ep.x + ex * t.ce - ey * t.se
      const ry = t.Ep.y + ex * t.se + ey * t.ce
      const wu = wUp[k * nc + ci]
      const we = wEnd[k * nc + ci]
      const wl = 1 - wu - we
      ox += wc * (wu * px + wl * qx + we * rx)
      oy += wc * (wu * py + wl * qy + we * ry)
      wsum += wc
    }
    out[k * 3] = ox + (1 - wsum) * x
    out[k * 3 + 1] = oy + (1 - wsum) * y
  }

  // 품질 지표: 뒤집힌 삼각형, 가장 많이 늘어난 격자 변, 한도 초과 삼각형 수. 모든 삼각형을 그린다(숨김 없음).
  let folds = 0
  let overLimit = 0
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
    if (outIndex) {
      outIndex[drawCount++] = a
      outIndex[drawCount++] = b
      outIndex[drawCount++] = c
    }
    if (!active[a] && !active[b] && !active[c]) return // 세 정점 모두 고정이면 변하지 않음
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

type Angles = Record<string, number>
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

// prev(허용된 자세)에서 cand(원하는 자세)로 가되, check가 거부하는 지점 직전까지만 간다.
// 한도를 넘는 조작에서 핸들이 마지막 정상 자세에 멈추게 한다. 각도는 최단 경로로 보간한다.
export function fitToLimit(check: (a: Angles) => boolean, prev: Angles, cand: Angles): Angles {
  if (check(cand)) return cand
  const keys = new Set([...Object.keys(prev), ...Object.keys(cand)])
  const at = (t: number) => {
    const o: Angles = {}
    for (const k of keys) {
      const p = prev[k] ?? 0
      const c = cand[k] ?? 0
      o[k] = k.endsWith('_bs') ? c : k.endsWith('_up') || k.endsWith('_lo') || k.endsWith('_ft') ? wrap(p + wrap(c - p) * t) : p + (c - p) * t // _bs(굽힘 방향)는 보간하지 않음
    }
    return o
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2
    if (check(at(mid))) lo = mid
    else hi = mid
  }
  return at(lo)
}

/* ───────── 어깨·골반 이동 제한 (골격이 머리부터 이어진 구조라 크게 벌어지지 않게) ───────── */

export const FT_LIMIT = 70 // 손목/발목 각도 한계(도)

export type JointLimits = {
  shift: Record<string, number> // 팔다리 키 → 윗관절(어깨/골반) 최대 이동 반경
  pairs: { a: string; b: string; rest: number; min: number; max: number }[] // 좌우 관절 사이 거리 허용 범위
}

// P(id): 관절 위치(세계 좌표). 어깨는 어깨폭의 25%, 골반은 엉덩이 폭의 30%까지만 이동 가능.
export function makeLimits(P: (id: number) => V2): JointLimits {
  const d = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.y - b.y)
  const Ws = d(P(11), P(12))
  const Wh = d(P(23), P(24))
  return {
    shift: { armR: Ws * 0.25, armL: Ws * 0.25, legR: Wh * 0.3, legL: Wh * 0.3 },
    pairs: [
      { a: 'armR', b: 'armL', rest: Ws, min: 0.85, max: 1.15 },
      { a: 'legR', b: 'legL', rest: Wh, min: 0.8, max: 1.25 },
    ],
  }
}

// angles의 _dx/_dy(윗관절 이동)를 제한 안으로 되돌린다. 입력 객체는 바꾸지 않는다.
// pin: 지금 끌고 있는 팔다리 키. 좌우 간격 제약을 맞출 때 이 관절만 조정하고 반대쪽은 그대로 둔다.
export function constrainShift(chains: RestChain[], lim: JointLimits, angles: Angles, pin?: string): Angles {
  const o: Angles = { ...angles }
  const clampR = (key: string) => {
    const r = lim.shift[key] ?? Infinity
    const x = o[key + '_dx'] ?? 0
    const y = o[key + '_dy'] ?? 0
    const l = Math.hypot(x, y)
    if (l > r) {
      o[key + '_dx'] = (x / l) * r
      o[key + '_dy'] = (y / l) * r
    }
  }
  for (const c of chains) {
    clampR(c.key)
    const ft = o[c.key + '_ft']
    if (ft !== undefined) o[c.key + '_ft'] = Math.max(-FT_LIMIT, Math.min(FT_LIMIT, ft)) // 손/발목 꺾임 범위
  }
  for (const pr of lim.pairs) {
    const ca = chains.find((c) => c.key === pr.a)
    const cb = chains.find((c) => c.key === pr.b)
    if (!ca || !cb) continue
    const pa = { x: ca.a.x + (o[pr.a + '_dx'] ?? 0), y: ca.a.y + (o[pr.a + '_dy'] ?? 0) }
    const pb = { x: cb.a.x + (o[pr.b + '_dx'] ?? 0), y: cb.a.y + (o[pr.b + '_dy'] ?? 0) }
    const sep = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1e-6
    const want = Math.min(pr.rest * pr.max, Math.max(pr.rest * pr.min, sep))
    if (Math.abs(want - sep) > 1e-6) {
      const ux = (pa.x - pb.x) / sep
      const uy = (pa.y - pb.y) / sep
      const full = want - sep
      const ha = pin === pr.a ? full : pin === pr.b ? 0 : full / 2 // a 쪽이 맡을 보정량
      const hb = full - ha
      o[pr.a + '_dx'] = (o[pr.a + '_dx'] ?? 0) + ux * ha
      o[pr.a + '_dy'] = (o[pr.a + '_dy'] ?? 0) + uy * ha
      o[pr.b + '_dx'] = (o[pr.b + '_dx'] ?? 0) - ux * hb
      o[pr.b + '_dy'] = (o[pr.b + '_dy'] ?? 0) - uy * hb
      clampR(pr.a)
      clampR(pr.b)
    }
  }
  return o
}

/* ───────── 손끝/발끝 기준점 ───────── */

// MediaPipe 번호: 19/20 검지(손끝), 31/32 발끝. 오래된 포즈 파일처럼 없으면 아랫뼈 방향으로 연장해서 만든다.
export const TIP_IDS = [
  { id: 19, name: '왼쪽 손끝', wrist: 15, mid: 13, k: 0.4 },
  { id: 20, name: '오른쪽 손끝', wrist: 16, mid: 14, k: 0.4 },
  { id: 31, name: '왼쪽 발끝', wrist: 27, mid: 25, k: 0.9 },
  { id: 32, name: '오른쪽 발끝', wrist: 28, mid: 26, k: 0.9 },
] as const

export function withTips<T extends { id: number; name: string; x: number; y: number }>(pts: T[]): T[] {
  const get = (id: number) => pts.find((p) => p.id === id)
  const out = [...pts]
  for (const t of TIP_IDS) {
    if (get(t.id)) continue
    const e = get(t.wrist)
    const m = get(t.mid)
    if (!e || !m) continue
    out.push({ id: t.id, name: t.name, x: e.x + (e.x - m.x) * t.k, y: e.y + (e.y - m.y) * t.k } as T)
  }
  return out
}
