// 파츠 경계(픽셀 주인) 편집: 브러시로 칠한 픽셀을 다른 파츠로 옮기고, 바뀐 픽셀만 기록한다 (화면 API 없음, 단독 테스트 가능)
//
// owner[i] = 원본 이미지 픽셀 i의 주인 파츠 번호 (0 = 몸통). 배경 픽셀(fg가 0)은 칠하지 않는다.
// 되돌리기: 그림 전체를 복사하지 않고 한 번 칠할 때 바뀐 픽셀의 (위치, 이전 주인, 새 주인)만 Diff로 남긴다.
// 스냅샷은 Diff를 잇는 연결 목록이라, 되돌리기 이력의 어떤 상태로든 두 스냅샷 사이의 Diff만 적용해 이동한다.

export type Diff = { idx: Uint32Array; from: Uint8Array; to: Uint8Array }
export type OwnerSnapshot = { id: number; prev: OwnerSnapshot | null; diff: Diff | null; depth: number }

let seq = 0
export const rootSnapshot = (): OwnerSnapshot => ({ id: ++seq, prev: null, diff: null, depth: 0 })
export const nextSnapshot = (prev: OwnerSnapshot, diff: Diff): OwnerSnapshot => ({ id: ++seq, prev, diff, depth: prev.depth + 1 })

export function applyDiff(owner: Uint8Array, d: Diff, forward: boolean) {
  const v = forward ? d.to : d.from
  for (let k = 0; k < d.idx.length; k++) owner[d.idx[k]] = v[k]
}

// a에서 b로 가려면: a에서 공통 조상까지 되돌리고(back, 순서대로 역적용), 공통 조상에서 b까지 적용(fwd, 순서대로)
export function pathBetween(a: OwnerSnapshot, b: OwnerSnapshot): { back: Diff[]; fwd: Diff[] } {
  const back: Diff[] = [], fwdRev: Diff[] = []
  let x: OwnerSnapshot = a, y: OwnerSnapshot = b
  while (x !== y) {
    if (x.depth >= y.depth) { back.push(x.diff!); x = x.prev! }
    else { fwdRev.push(y.diff!); y = y.prev! }
  }
  return { back, fwd: fwdRev.reverse() }
}

// owner를 스냅샷 a의 상태에서 b의 상태로 바꾼다. 반환: 주인이 바뀐 파츠 번호들
export function moveOwner(owner: Uint8Array, a: OwnerSnapshot, b: OwnerSnapshot): Set<number> {
  const { back, fwd } = pathBetween(a, b)
  const touched = new Set<number>()
  for (const d of back) { applyDiff(owner, d, false); d.from.forEach((c) => touched.add(c)); d.to.forEach((c) => touched.add(c)) }
  for (const d of fwd) { applyDiff(owner, d, true); d.from.forEach((c) => touched.add(c)); d.to.forEach((c) => touched.add(c)) }
  return touched
}

// 원 하나를 칠한다. orig에는 이번 획에서 처음 바뀐 픽셀의 원래 주인을 모은다 (획이 끝나면 strokeDiff로 Diff를 만든다)
export function paintDisc(owner: Uint8Array, fg: Uint8Array | null, W: number, H: number, cx: number, cy: number, r: number, target: number, orig: Map<number, number>) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r))
  const r2 = r * r
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy
    if (dx * dx + dy * dy > r2) continue
    const i = y * W + x
    if (fg && !fg[i]) continue
    if (owner[i] === target) continue
    if (!orig.has(i)) orig.set(i, owner[i])
    owner[i] = target
  }
}

// 두 점 사이를 촘촘한 원으로 이어 칠한다 (빠르게 끌어도 끊기지 않게)
export function paintLine(owner: Uint8Array, fg: Uint8Array | null, W: number, H: number, ax: number, ay: number, bx: number, by: number, r: number, target: number, orig: Map<number, number>) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(1, r * 0.4)))
  for (let k = 0; k <= n; k++) paintDisc(owner, fg, W, H, ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, r, target, orig)
}

// 이번 획에서 실제로 바뀐 픽셀만 Diff로 (칠했다가 다시 원래 주인으로 칠한 곳은 빠진다). 바뀐 것이 없으면 null
export function strokeDiff(owner: Uint8Array, orig: Map<number, number>): Diff | null {
  const keys = [...orig.keys()].filter((i) => owner[i] !== orig.get(i)).sort((a, b) => a - b)
  if (!keys.length) return null
  return { idx: Uint32Array.from(keys), from: Uint8Array.from(keys.map((i) => orig.get(i)!)), to: Uint8Array.from(keys.map((i) => owner[i])) }
}

// 저장용 압축: [값, 개수, 값, 개수, …]
export function encodeOwner(owner: Uint8Array): number[] {
  const out: number[] = []
  let i = 0
  while (i < owner.length) {
    const v = owner[i]
    let n = 1
    while (i + n < owner.length && owner[i + n] === v) n++
    out.push(v, n)
    i += n
  }
  return out
}

export function decodeOwner(rle: number[], n: number): Uint8Array | null {
  const out = new Uint8Array(n)
  let i = 0
  for (let k = 0; k + 1 < rle.length; k += 2) {
    const v = rle[k], c = rle[k + 1]
    if (!Number.isInteger(v) || !Number.isInteger(c) || v < 0 || v > 255 || c < 0 || i + c > n) return null
    out.fill(v, i, i + c)
    i += c
  }
  return i === n ? out : null
}
