// 기존 관절(자동 추정·수정 결과)과 이미지로 캐릭터 파츠를 구성한다.
//
// 파츠 구성 (Unity의 Transform 계층과 같은 부모·자식):
//   Body ─┬─ Head
//         ├─ LeftArm ── LeftForearm ── LeftHand        (pivot: 어깨 → 팔꿈치 → 손목)
//         ├─ RightArm ── RightForearm ── RightHand
//         ├─ LeftLeg ── LeftShin ── LeftFoot           (pivot: 골반 → 무릎 → 발목)
//         └─ RightLeg ── RightShin ── RightFoot
//
// - 각 픽셀은 가장 가까운 뼈 하나에만 속한다 (두 파츠에 같은 그림이 겹치지 않게).
//   단, 아래팔·손·정강이·발은 자기 관절 주변 원을 한 번 더 가져가서, 굽혀도 관절에 틈이 덜 보인다.
// - 배경(foregroundMask로 판정)은 투명하게 만든다. 흰 배경 사각형이 같이 움직이지 않게.
// - 파츠를 떼어낸 몸통의 빈 자리는 기존 holeFill(주변 색 채우기)로 메운다.
// 이미지는 여기서 한 번만 오리고, 이후 편집은 Transform만 바꾼다.
import { foregroundMask, withTips } from '../meshSkin.ts'
import { fillMasked } from '../holeFill.ts'
import type { Character, EditorState, PartDef, PartState } from './CharacterModel.ts'
import type { Vec2 } from './Transform.ts'
import { lassoPlan } from './lasso.ts'
import type { LassoPart } from './lasso.ts'

type Pt = { id: number; name: string; x: number; y: number }
type Seg = { id: string; name: string; parent: string; a: number; b: number; kind: 'arm' | 'hand' | 'leg' | 'foot'; z: number; disk: boolean }

const SEGS: Seg[] = [
  { id: 'leftArm', name: 'LeftArm', parent: 'body', a: 11, b: 13, kind: 'arm', z: 5, disk: false },
  { id: 'leftForearm', name: 'LeftForearm', parent: 'leftArm', a: 13, b: 15, kind: 'arm', z: 6, disk: true },
  { id: 'leftHand', name: 'LeftHand', parent: 'leftForearm', a: 15, b: 19, kind: 'hand', z: 7, disk: true },
  { id: 'rightArm', name: 'RightArm', parent: 'body', a: 12, b: 14, kind: 'arm', z: 5, disk: false },
  { id: 'rightForearm', name: 'RightForearm', parent: 'rightArm', a: 14, b: 16, kind: 'arm', z: 6, disk: true },
  { id: 'rightHand', name: 'RightHand', parent: 'rightForearm', a: 16, b: 20, kind: 'hand', z: 7, disk: true },
  { id: 'leftLeg', name: 'LeftLeg', parent: 'body', a: 23, b: 25, kind: 'leg', z: 1, disk: false },
  { id: 'leftShin', name: 'LeftShin', parent: 'leftLeg', a: 25, b: 27, kind: 'leg', z: 2, disk: true },
  { id: 'leftFoot', name: 'LeftFoot', parent: 'leftShin', a: 27, b: 31, kind: 'foot', z: 3, disk: true },
  { id: 'rightLeg', name: 'RightLeg', parent: 'body', a: 24, b: 26, kind: 'leg', z: 1, disk: false },
  { id: 'rightShin', name: 'RightShin', parent: 'rightLeg', a: 26, b: 28, kind: 'leg', z: 2, disk: true },
  { id: 'rightFoot', name: 'RightFoot', parent: 'rightShin', a: 28, b: 32, kind: 'foot', z: 3, disk: true },
]
// Hierarchy에 보이는 순서
export const PART_ORDER = ['body', 'head', 'leftArm', 'leftForearm', 'leftHand', 'rightArm', 'rightForearm', 'rightHand', 'leftLeg', 'leftShin', 'leftFoot', 'rightLeg', 'rightShin', 'rightFoot']

const distSeg = (px: number, py: number, a: Vec2, b: Vec2) => {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - a.x - t * dx, py - a.y - t * dy)
}

export function buildCharacter(
  img: CanvasImageSource, W: number, H: number, ptsIn: Pt[],
  opts: { name?: string; lasso?: LassoPart[] } = {},
): { char: Character; state: EditorState } {
  const name = opts.name ?? 'Character'
  const lasso = opts.lasso ?? []
  const src = document.createElement('canvas')
  src.width = W
  src.height = H
  const sx = src.getContext('2d', { willReadFrequently: true })!
  sx.drawImage(img, 0, 0, W, H)
  const rgba = sx.getImageData(0, 0, W, H).data
  const fg = foregroundMask(rgba, W, H)?.data ?? null // 없으면(배경이 복잡함) 전부 전경으로 본다

  const pts = withTips(ptsIn, { w: W, h: H })
  const P = (id: number) => pts.find((p) => p.id === id)
  const k = H / 1024 // 앱의 기본 반폭(팔 30, 다리 40)은 높이 1024 기준
  const radius = { arm: 30 * k, hand: 36 * k, leg: 40 * k, foot: 60 * k }

  const segs = SEGS.filter((s) => P(s.a) && P(s.b)).map((s) => {
    const a = P(s.a)!, b0 = P(s.b)!
    const r = radius[s.kind]
    // 손·발은 끝점 너머까지 조금 더 (손가락·신발 끝)
    const ext = s.kind === 'hand' || s.kind === 'foot' ? 0.35 * r : 0
    const L = Math.hypot(b0.x - a.x, b0.y - a.y) || 1
    const b = { x: b0.x + ((b0.x - a.x) / L) * ext, y: b0.y + ((b0.y - a.y) / L) * ext }
    return { ...s, A: { x: a.x, y: a.y }, B: b, r }
  })
  const nose = P(0), l = P(11), r = P(12)
  const shMid = l && r ? { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 } : null
  const shW = l && r ? Math.hypot(l.x - r.x, l.y - r.y) : W * 0.2
  const neck = nose && shMid ? { x: shMid.x + (nose.x - shMid.x) * 0.3, y: shMid.y + (nose.y - shMid.y) * 0.3 } : null
  const headHalf = shW * 0.55
  // 몸통 중심선(어깨 중앙 → 골반 중앙)과 몸통 반폭. 몸통 안쪽은 몸통에 남긴다
  const hipMid = P(23) && P(24) ? { x: (P(23)!.x + P(24)!.x) / 2, y: (P(23)!.y + P(24)!.y) / 2 } : null
  const torsoR = shW * 0.35

  // 올가미 영역: 리그에서 지울 때와 같은 두께(채우기 + 4px 테두리)로 픽셀화
  const lassoMasks = lasso.map((l) => {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const x = c.getContext('2d', { willReadFrequently: true })!
    x.fillStyle = '#000'
    x.strokeStyle = '#000'
    x.lineWidth = 4
    x.beginPath()
    l.poly.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)))
    x.closePath()
    x.fill()
    x.stroke()
    const a = x.getImageData(0, 0, W, H).data
    const m = new Uint8Array(W * H)
    for (let i = 0; i < m.length; i++) m[i] = a[i * 4 + 3] > 0 ? 1 : 0
    return m
  })
  const lassoBase = 2 + segs.length

  // 픽셀마다 주인 파츠 번호 (0 = body, 1 = head, 2.. = segs, lassoBase.. = 올가미 파츠)
  const owner = new Uint8Array(W * H)
  // 몸통 영역 안쪽인지 (파츠가 떠난 자리 중 여기만 몸 색으로 채우고, 바깥은 배경(투명)으로 둔다)
  const inTorso = new Uint8Array(W * H)
  const torsoKeep = torsoR + shW * 0.2
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (shMid && hipMid && distSeg(x, y, shMid, hipMid) <= torsoKeep) inTorso[i] = 1
      if (fg && !fg[i]) continue
      // 올가미 파츠가 가장 우선 (먼저 만든 파츠가 이김: 리그에서도 앞 파츠를 지운 그림에서 다음 파츠를 오린다)
      let lo = -1
      for (let j = 0; j < lassoMasks.length; j++) if (lassoMasks[j][i]) { lo = j; break }
      if (lo >= 0) { owner[i] = lassoBase + lo; continue }
      // 가장 가까운 팔다리 뼈. 반폭 안쪽이면 무조건 그 팔다리, 반폭의 2.2배까지는 몸통 중심선보다 가까울 때만
      // (부푼 소매·넓은 바지처럼 뼈에서 먼 옷자락도 팔다리와 함께 움직이게)
      let best = -1, bd = Infinity
      for (let s = 0; s < segs.length; s++) {
        const d = distSeg(x, y, segs[s].A, segs[s].B)
        if (d / segs[s].r < bd) { bd = d / segs[s].r; best = s }
      }
      if (best >= 0 && bd > 1) {
        const dLimb = bd * segs[best].r
        const dTorso = shMid && hipMid ? Math.max(0, distSeg(x, y, shMid, hipMid) - torsoR) : Infinity
        if (bd > 2.2 || dLimb >= dTorso) best = -1
      }
      if (best >= 0) owner[i] = best + 2
      else if (neck && nose && y < neck.y && Math.abs(x - nose.x) <= headHalf) owner[i] = 1
    }
  }

  const defs: Record<string, PartDef> = {}
  const origins: Record<string, Vec2> = {}
  const makeImage = (id: string, nm: string, include: (i: number, x: number, y: number) => boolean) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (include(y * W + x, x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0 } // 빈 파츠도 계층은 유지 (1×1 투명)
    const w = x1 - x0 + 1, h = y1 - y0 + 1
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const id2 = new ImageData(w, h)
    const alpha = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = x + x0, gy = y + y0, gi = gy * W + gx
      if (!include(gi, gx, gy)) continue
      const o = (y * w + x) * 4
      id2.data[o] = rgba[gi * 4]; id2.data[o + 1] = rgba[gi * 4 + 1]; id2.data[o + 2] = rgba[gi * 4 + 2]; id2.data[o + 3] = 255
      alpha[y * w + x] = 255
    }
    c.getContext('2d')!.putImageData(id2, 0, 0)
    defs[id] = { id, name: nm, w, h, image: c, alpha, origin: { x: x0, y: y0 } }
    origins[id] = { x: x0, y: y0 }
  }

  if (neck) makeImage('head', 'Head', (i) => owner[i] === 1)
  segs.forEach((s, si) => {
    const rd = s.r * 0.9
    makeImage(s.id, s.name, (i, x, y) => owner[i] === si + 2 || (s.disk && (!fg || fg[i] === 1) && owner[i] !== 0 && Math.hypot(x - s.A.x, y - s.A.y) <= rd))
  })

  // 몸통: 다른 파츠가 가져간 자리를 기존 holeFill로 메운다. 배경은 투명.
  const body = new Uint8ClampedArray(rgba)
  const hole = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) if (owner[i] !== 0) hole[i] = 1
  fillMasked(body, hole, W, H)
  // 배경은 투명. 파츠가 떠난 자리는 몸통 영역(또는 머리 아래 목 부분) 안쪽만 채운 색을 쓰고, 바깥은 투명
  for (let i = 0; i < W * H; i++) body[i * 4 + 3] = (!fg || fg[i]) && (!hole[i] || inTorso[i] || !shMid) ? 255 : 0
  const bc = document.createElement('canvas')
  bc.width = W
  bc.height = H
  bc.getContext('2d')!.putImageData(new ImageData(body, W, H), 0, 0)
  const bodyAlpha = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) bodyAlpha[i] = body[i * 4 + 3]
  defs.body = { id: 'body', name: 'Body', w: W, h: H, image: bc, alpha: bodyAlpha, origin: { x: 0, y: 0 } }
  origins.body = { x: 0, y: 0 }

  // 처음 Transform: 원래 그림과 똑같이 보이게. 자식의 position = 관절 위치를 부모 이미지 좌표로.
  const hip = P(23) && P(24) ? { x: (P(23)!.x + P(24)!.x) / 2, y: (P(23)!.y + P(24)!.y) / 2 } : { x: W / 2, y: H / 2 }
  const parts: Record<string, PartState> = {}
  const base = (o: Partial<PartState>): PartState => ({ position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, pivot: { x: 0, y: 0 }, parent: null, z: 0, visible: true, ...o })
  parts.body = base({ position: { ...hip }, pivot: { ...hip }, z: 0 })
  if (neck && defs.head) parts.head = base({ parent: 'body', position: { ...neck }, pivot: { x: neck.x - origins.head.x, y: neck.y - origins.head.y }, z: 4 })
  for (const s of segs) {
    if (!defs[s.id]) continue
    const po = origins[s.parent] ?? { x: 0, y: 0 }
    const parent = parts[s.parent] ? s.parent : 'body'
    const pOrigin = parts[s.parent] ? po : { x: 0, y: 0 }
    parts[s.id] = base({ parent, position: { x: s.A.x - pOrigin.x, y: s.A.y - pOrigin.y }, pivot: { x: s.A.x - origins[s.id].x, y: s.A.y - origins[s.id].y }, z: s.z })
  }
  // 올가미 파츠: 오려낸 원래 자리에서 시작. pivot은 파츠 가운데(피벗 도구로 옮길 수 있음)
  const plans = lassoPlan(lasso, new Set(Object.keys(parts)))
  for (const pl of plans) {
    makeImage(pl.id, pl.name, (i) => owner[i] === lassoBase + pl.index)
    const d = defs[pl.id]
    const pivot = { x: d.w / 2, y: d.h / 2 }
    const world = { x: origins[pl.id].x + pivot.x, y: origins[pl.id].y + pivot.y }
    const po = pl.parent ? origins[pl.parent] ?? { x: 0, y: 0 } : { x: 0, y: 0 }
    parts[pl.id] = base({ parent: pl.parent, position: { x: world.x - po.x, y: world.y - po.y }, pivot, z: pl.z })
  }
  const order = [...PART_ORDER.filter((id) => parts[id]), ...plans.map((p) => p.id)]
  return { char: { name, w: W, h: H, defs, order }, state: { parts, keys: [], duration: 3 } }
}
