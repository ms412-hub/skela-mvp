// 구멍 복원 분배기: 구멍의 크기와 주변 복잡도에 따라 방법을 고른다. 기존 holeFill.ts는 그대로 쓰고 바꾸지 않는다.
//
//   작은 구멍 / 주변이 단색에 가까움 → 'diffuse'  기존 holeFill (가장자리 색을 안쪽으로 번지게 함, 빠름)
//   큰 구멍                         → 'patch'    예시 기반 복원 (주변의 질감 조각을 복사해 줄무늬·무늬를 이어 줌)
//   크고 주변이 복잡함              → 'ai'       외부 AI 복원 (aiFill 훅이 있을 때만. 없으면 'patch'로 처리)
//
// 화면 API 없이 픽셀 배열만 다뤄서 단독으로 테스트할 수 있다.
import { fillMasked } from './holeFill.ts'

export type FillStrategy = 'diffuse' | 'patch' | 'ai'
export type HoleStats = {
  area: number // 구멍 픽셀 수
  depth: number // 가장자리에서 가장 깊은 곳까지의 겹 수 (구멍의 두께, 대략 안쪽 반지름)
  boundaryVariance: number // 구멍 바로 바깥 픽셀들의 밝기 표준편차 (0이면 단색)
}
export type FillOptions = {
  strategy?: FillStrategy // 지정하면 자동 선택을 건너뜀
  smallDepth?: number // 이 두께 이하면 작은 구멍 (기본 8)
  flatVariance?: number // 주변 밝기 편차가 이 값 미만이면 단색으로 보고 diffuse (기본 6)
  complexVariance?: number // 이 값 이상이면 복잡한 주변 (기본 60)
  aiMinArea?: number // 복잡 판정을 적용할 최소 면적 (기본 4000)
  patchRadius?: number // 예시 조각 반지름 (기본 4 → 9×9)
  // AI 복원 훅. 전체를 성공적으로 채웠을 때만 true를 돌려주고, 실패하면 rgba를 바꾸지 않아야 한다.
  aiFill?: (rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number) => boolean
}

const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]

function forNeighbors8(i: number, w: number, h: number, fn: (j: number) => void) {
  const x = i % w
  const y = (i - x) / w
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy
    if (yy < 0 || yy >= h) continue
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx
      if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue
      fn(yy * w + xx)
    }
  }
}

// 구멍의 크기·두께·주변 복잡도를 잰다
export function analyzeHole(rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number): HoleStats {
  const n = w * h
  let area = 0
  for (let i = 0; i < n; i++) if (mask[i]) area++
  if (area === 0 || area === n) return { area, depth: 0, boundaryVariance: 0 }

  // 두께: 가장자리에서 안쪽으로 한 겹씩 세어 나간다
  const seen = new Uint8Array(n)
  let cur: number[] = []
  const ring: number[] = [] // 구멍 바로 바깥의 알려진 픽셀
  const inRing = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    let adj = false
    forNeighbors8(i, w, h, (j) => {
      if (!mask[j]) {
        adj = true
        if (!inRing[j]) { inRing[j] = 1; ring.push(j) }
      }
    })
    if (adj) { seen[i] = 1; cur.push(i) }
  }
  let depth = 0
  while (cur.length) {
    depth++
    const next: number[] = []
    for (const i of cur) forNeighbors8(i, w, h, (j) => { if (mask[j] && !seen[j]) { seen[j] = 1; next.push(j) } })
    cur = next
  }

  let sum = 0
  let sq = 0
  for (const j of ring) { const l = lum(rgba, j); sum += l; sq += l * l }
  const m = sum / ring.length
  const boundaryVariance = Math.sqrt(Math.max(0, sq / ring.length - m * m))
  return { area, depth, boundaryVariance }
}

export function chooseStrategy(s: HoleStats, o: FillOptions = {}): FillStrategy {
  if (s.area === 0 || s.depth <= (o.smallDepth ?? 8)) return 'diffuse'
  if (s.boundaryVariance < (o.flatVariance ?? 6)) return 'diffuse' // 큰 구멍이어도 주변이 단색이면 기존 방식과 결과가 같다
  if (s.boundaryVariance >= (o.complexVariance ?? 60) && s.area >= (o.aiMinArea ?? 4000)) return 'ai'
  return 'patch'
}

// 분배기. 반환: 실제로 쓴 방법과 채운 픽셀 수 (채울 구멍이 없거나 전부 구멍이면 filled 0)
export function fillHole(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  w: number,
  h: number,
  o: FillOptions = {},
): { strategy: FillStrategy; filled: number } {
  const stats = analyzeHole(rgba, mask, w, h)
  if (stats.area === 0 || stats.area === w * h) return { strategy: 'diffuse', filled: 0 }
  let s: FillStrategy = o.strategy ?? chooseStrategy(stats, o)
  if (s === 'ai') {
    if (o.aiFill && o.aiFill(rgba, mask, w, h)) return { strategy: 'ai', filled: stats.area }
    s = 'patch' // AI를 못 쓰거나 실패하면 브라우저 안에서 되는 방법으로
  }
  if (s === 'patch') {
    const n = fillPatch(rgba, mask, w, h, o.patchRadius ?? 4)
    if (n > 0) return { strategy: 'patch', filled: n }
    // 쓸 만한 조각이 하나도 없으면 아래 diffuse로
  }
  return { strategy: 'diffuse', filled: fillMasked(rgba, mask, w, h) }
}

// 비동기 분배기: 외부 AI(네트워크)를 쓸 수 있는 버전. 기존 fillHole은 그대로 두고, 'ai'로 정해졌을 때만 aiFillAsync를 기다린다.
// aiFillAsync가 실패(false/예외)해도 rgba는 바뀌지 않고, 브라우저 안에서 되는 방법(patch)으로 이어서 채운다.
export async function fillHoleAsync(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  w: number,
  h: number,
  o: Omit<FillOptions, 'aiFill'> & { aiFillAsync?: (rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number) => Promise<boolean> } = {},
): Promise<{ strategy: FillStrategy; filled: number }> {
  const stats = analyzeHole(rgba, mask, w, h)
  if (stats.area === 0 || stats.area === w * h) return { strategy: 'diffuse', filled: 0 }
  const s: FillStrategy = o.strategy ?? chooseStrategy(stats, o)
  if (s === 'ai' && o.aiFillAsync) {
    const work = rgba.slice() // 실패해도 원본이 망가지지 않게 복사본에서 시도
    let ok = false
    try { ok = await o.aiFillAsync(work, mask, w, h) } catch { ok = false }
    if (ok) {
      rgba.set(work)
      return { strategy: 'ai', filled: stats.area }
    }
  }
  const { aiFillAsync: _unused, ...rest } = o
  void _unused
  return fillHole(rgba, mask, w, h, { ...rest, strategy: s === 'ai' ? 'patch' : s })
}

// 예시 기반 복원 (Criminisi 방식을 줄인 것): 채울 가장자리 중 "알려진 비율이 높고 무늬가 이어지는" 곳부터,
// 주변에서 가장 닮은 조각을 찾아 모자란 픽셀만 복사한다. 반환: 채운 픽셀 수 (조각이 없으면 0, 아무것도 바꾸지 않음)
export function fillPatch(rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, r = 4): number {
  const n = w * h
  let holes = 0
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    holes++
    const x = i % w, y = (i - x) / w
    if (x < bx0) bx0 = x
    if (x > bx1) bx1 = x
    if (y < by0) by0 = y
    if (y > by1) by1 = y
  }
  if (holes === 0 || holes === n) return 0

  // 알려진 곳만 가진 조각을 빨리 가려내기 위한 누적합 (mask의 합이 0이면 조각 전체가 원래 알려진 픽셀)
  const W1 = w + 1
  const S = new Int32Array(W1 * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x]
      S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + row
    }
  }
  const rectSum = (x0: number, y0: number, x1: number, y1: number) =>
    S[(y1 + 1) * W1 + x1 + 1] - S[y0 * W1 + x1 + 1] - S[(y1 + 1) * W1 + x0] + S[y0 * W1 + x0]

  const collect = (x0: number, y0: number, x1: number, y1: number, maxCand: number) => {
    const area = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1))
    const stride = Math.max(1, Math.ceil(Math.sqrt(area / maxCand)))
    const out: number[] = []
    for (let y = Math.max(r, y0); y <= Math.min(h - 1 - r, y1); y += stride) {
      for (let x = Math.max(r, x0); x <= Math.min(w - 1 - r, x1); x += stride) {
        if (rectSum(x - r, y - r, x + r, y + r) === 0) out.push(y * w + x)
      }
    }
    return out
  }
  const margin = Math.max(32, Math.round(0.5 * Math.max(bx1 - bx0, by1 - by0)) + 16)
  let cands = collect(bx0 - margin, by0 - margin, bx1 + margin, by1 + margin, 6000)
  if (!cands.length) cands = collect(0, 0, w - 1, h - 1, 6000)
  if (!cands.length) return 0

  const known = new Uint8Array(n)
  const conf = new Float32Array(n)
  for (let i = 0; i < n; i++) if (!mask[i]) { known[i] = 1; conf[i] = 1 }
  const L = new Float32Array(n)
  for (let i = 0; i < n; i++) L[i] = lum(rgba, i)

  const inFront = new Uint8Array(n)
  let front: number[] = []
  const pushFront = (i: number) => {
    if (known[i] || inFront[i]) return
    let adj = false
    forNeighbors8(i, w, h, (j) => { if (known[j]) adj = true })
    if (adj) { inFront[i] = 1; front.push(i) }
  }
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (mask[y * w + x]) pushFront(y * w + x)

  const patchArea = (2 * r + 1) * (2 * r + 1)
  let filled = 0
  while (front.length) {
    front = front.filter((i) => !known[i])
    for (const i of front) inFront[i] = 1
    if (!front.length) break

    // 우선순위 = 신뢰도(알려진 비율) × 데이터항(채울 방향과 등명선이 얼마나 직각인지)
    let best = -1
    let bestP = -1
    for (const p of front) {
      const px = p % w, py = (p - px) / w
      let c = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = py + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -r; dx <= r; dx++) {
          const xx = px + dx
          if (xx < 0 || xx >= w) continue
          c += conf[yy * w + xx]
        }
      }
      c /= patchArea
      // 안쪽 방향(구멍 쪽) = 알려진 이웃의 반대쪽
      let nx = 0, ny = 0, gx = 0, gy = 0, gm = -1
      forNeighbors8(p, w, h, (q) => {
        if (!known[q]) return
        const qx = q % w, qy = (q - qx) / w
        nx -= qx - px
        ny -= qy - py
        const lx = qx > 0 && known[q - 1] ? L[q - 1] : null
        const rx = qx < w - 1 && known[q + 1] ? L[q + 1] : null
        const uy = qy > 0 && known[q - w] ? L[q - w] : null
        const dy2 = qy < h - 1 && known[q + w] ? L[q + w] : null
        const ggx = lx !== null && rx !== null ? (rx - lx) / 2 : 0
        const ggy = uy !== null && dy2 !== null ? (dy2 - uy) / 2 : 0
        const m = ggx * ggx + ggy * ggy
        if (m > gm) { gm = m; gx = ggx; gy = ggy }
      })
      const nl = Math.hypot(nx, ny) || 1
      const iso = Math.abs((-gy * nx + gx * ny) / nl) / 255
      const pr = c * (iso + 0.001)
      if (pr > bestP) { bestP = pr; best = p }
    }

    const px = best % w, py = (best - px) / w
    const tc = (() => {
      let s = 0
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = px + dx, yy = py + dy
        if (xx >= 0 && xx < w && yy >= 0 && yy < h) s += conf[yy * w + xx]
      }
      return s / patchArea
    })()

    // 닮은 조각 찾기: 이미 알려진 픽셀끼리의 색 차이 제곱합이 가장 작은 곳
    const offs: { o: number; d: number }[] = []
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = px + dx, yy = py + dy
      if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue
      const t = yy * w + xx
      if (known[t]) offs.push({ o: dy * w + dx, d: t })
    }
    let bestC = cands[0]
    let bestS = Infinity
    for (const c of cands) {
      let s = 0
      for (let k = 0; k < offs.length; k++) {
        const t = offs[k].d, u = c + offs[k].o
        const dr = rgba[t * 4] - rgba[u * 4], dg = rgba[t * 4 + 1] - rgba[u * 4 + 1], db = rgba[t * 4 + 2] - rgba[u * 4 + 2]
        s += dr * dr + dg * dg + db * db
        if (s >= bestS) break
      }
      if (s < bestS) { bestS = s; bestC = c }
    }

    // 모자란 픽셀만 복사
    const newly: number[] = []
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = px + dx, yy = py + dy
      if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue
      const t = yy * w + xx
      if (known[t]) continue
      const u = bestC + dy * w + dx
      rgba[t * 4] = rgba[u * 4]
      rgba[t * 4 + 1] = rgba[u * 4 + 1]
      rgba[t * 4 + 2] = rgba[u * 4 + 2]
      rgba[t * 4 + 3] = 255
      L[t] = lum(rgba, t)
      known[t] = 1
      conf[t] = tc
      newly.push(t)
      filled++
    }
    for (const t of newly) forNeighbors8(t, w, h, (j) => pushFront(j))
  }
  return filled
}
