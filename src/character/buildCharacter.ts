// 기존 관절(자동 추정·수정 결과)과 이미지로 캐릭터 파츠를 구성한다.
//
// 파츠 구성 (Unity의 Transform 계층과 같은 부모·자식):
//   Body ─┬─ Head
//         ├─ LeftArm ── LeftForearm ── LeftHand        (pivot: 어깨 → 팔꿈치 → 손목)
//         ├─ RightArm ── RightForearm ── RightHand
//         ├─ LeftLeg ── LeftShin ── LeftFoot           (pivot: 골반 → 무릎 → 발목)
//         ├─ RightLeg ── RightShin ── RightFoot
//         └─ (리그에서 올가미로 오린 파츠: 붙인 뼈의 자식)
//
// 좌표: 모든 파츠의 로컬 좌표는 원본 이미지 픽셀 좌표다 (Unity가 스프라이트의 뼈를 스프라이트 좌표로 두는 것과 같다).
//   그래서 원래 자세 = 모든 파츠가 position = pivot, 회전 0, 크기 1. 경계를 고쳐 파츠 이미지가 바뀌어도 Transform은 그대로다.
//
// 두 단계로 나뉜다.
//   analyze: 픽셀마다 주인 파츠를 정한다 (owner). 경계 수정 브러시는 이 owner만 바꾼다.
//   renderPart / renderBody: owner로 파츠 이미지를 만든다. 경계를 고치면 바뀐 파츠만 다시 만든다.
import { foregroundMask, withTips } from '../meshSkin.ts'
import { fillMasked } from '../holeFill.ts'
import type { Character, EditorState, PartDef, PartState } from './CharacterModel.ts'
import type { Vec2 } from './Transform.ts'
import { lassoPlan } from './lasso.ts'
import type { LassoPart } from './lasso.ts'
import { rootSnapshot } from './ownership.ts'

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

// 파츠 이미지를 만드는 데 필요한 모든 것. owner는 경계 수정 브러시가 바꾼다.
export type Analysis = {
  W: number
  H: number
  rgba: Uint8ClampedArray
  fg: Uint8Array | null // 없으면(배경이 복잡함) 전부 전경
  inTorso: Uint8Array // 파츠가 떠난 자리 중 몸 색으로 채울 곳
  hasTorso: boolean
  owner: Uint8Array // 픽셀 → 파츠 번호 (codes의 위치)
  codes: string[] // 파츠 번호 → 파츠 id. 0번은 항상 body
  names: string[]
  disks: ({ x: number; y: number; r: number } | null)[] // 관절 원 (굽혀도 관절에 틈이 덜 보이게 한 번 더 가져가는 부분)
}

export function analyze(img: CanvasImageSource, W: number, H: number, ptsIn: Pt[], lasso: LassoPart[] = []) {
  const src = document.createElement('canvas')
  src.width = W
  src.height = H
  const sx = src.getContext('2d', { willReadFrequently: true })!
  sx.drawImage(img, 0, 0, W, H)
  const rgba = sx.getImageData(0, 0, W, H).data
  const fg = foregroundMask(rgba, W, H)?.data ?? null

  const pts = withTips(ptsIn, { w: W, h: H })
  const P = (id: number) => pts.find((p) => p.id === id)
  const k = H / 1024 // 앱의 기본 반폭(팔 30, 다리 40)은 높이 1024 기준
  const radius = { arm: 30 * k, hand: 36 * k, leg: 40 * k, foot: 60 * k }

  const segs = SEGS.filter((s) => P(s.a) && P(s.b)).map((s) => {
    const a = P(s.a)!, b0 = P(s.b)!
    const r = radius[s.kind]
    const ext = s.kind === 'hand' || s.kind === 'foot' ? 0.35 * r : 0 // 손·발은 끝점 너머까지 조금 더
    const L = Math.hypot(b0.x - a.x, b0.y - a.y) || 1
    const b = { x: b0.x + ((b0.x - a.x) / L) * ext, y: b0.y + ((b0.y - a.y) / L) * ext }
    return { ...s, A: { x: a.x, y: a.y }, B: b, r }
  })
  const nose = P(0), l = P(11), r = P(12)
  const shMid = l && r ? { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 } : null
  const shW = l && r ? Math.hypot(l.x - r.x, l.y - r.y) : W * 0.2
  const neck = nose && shMid ? { x: shMid.x + (nose.x - shMid.x) * 0.3, y: shMid.y + (nose.y - shMid.y) * 0.3 } : null
  const headHalf = shW * 0.55
  const hipMid = P(23) && P(24) ? { x: (P(23)!.x + P(24)!.x) / 2, y: (P(23)!.y + P(24)!.y) / 2 } : null
  const torsoR = shW * 0.35
  const torsoKeep = torsoR + shW * 0.2

  // 파츠 번호 배정
  const codes: string[] = ['body'], names: string[] = ['Body'], disks: Analysis['disks'] = [null]
  const headCode = neck ? codes.push('head') - 1 : -1
  if (neck) { names.push('Head'); disks.push(null) }
  const segCode = segs.map((s) => { codes.push(s.id); names.push(s.name); disks.push(s.disk ? { x: s.A.x, y: s.A.y, r: s.r * 0.9 } : null); return codes.length - 1 })
  const plans = lassoPlan(lasso, new Set(['body', ...(neck ? ['head'] : []), ...segs.map((s) => s.id)]))
  const lassoCode = plans.map((pl) => { codes.push(pl.id); names.push(pl.name); disks.push(null); return codes.length - 1 })

  // 올가미 영역: 리그에서 지울 때와 같은 두께(채우기 + 4px 테두리)로 픽셀화
  const lassoMasks = lasso.map((ls) => {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const x = c.getContext('2d', { willReadFrequently: true })!
    x.fillStyle = '#000'
    x.strokeStyle = '#000'
    x.lineWidth = 4
    x.beginPath()
    ls.poly.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)))
    x.closePath()
    x.fill()
    x.stroke()
    const a = x.getImageData(0, 0, W, H).data
    const m = new Uint8Array(W * H)
    for (let i = 0; i < m.length; i++) m[i] = a[i * 4 + 3] > 0 ? 1 : 0
    return m
  })

  const owner = new Uint8Array(W * H)
  const inTorso = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (shMid && hipMid && distSeg(x, y, shMid, hipMid) <= torsoKeep) inTorso[i] = 1
      if (fg && !fg[i]) continue
      // 올가미 파츠가 가장 우선 (먼저 만든 파츠가 이김: 리그에서도 앞 파츠를 지운 그림에서 다음 파츠를 오린다)
      let lo = -1
      for (let j = 0; j < lassoMasks.length; j++) if (lassoMasks[j][i]) { lo = j; break }
      if (lo >= 0) { owner[i] = lassoCode[lo]; continue }
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
      if (best >= 0) owner[i] = segCode[best]
      else if (neck && nose && y < neck.y && Math.abs(x - nose.x) <= headHalf) owner[i] = headCode
    }
  }

  const an: Analysis = { W, H, rgba, fg, inTorso, hasTorso: !!shMid, owner, codes, names, disks }

  // 처음 Transform: 원래 자세 = position과 pivot이 같은 원본 이미지 좌표 (회전 0, 크기 1)
  const parts: Record<string, PartState> = {}
  const base = (pivot: Vec2, o: Partial<PartState>): PartState => ({ position: { ...pivot }, rotation: 0, scale: { x: 1, y: 1 }, pivot: { ...pivot }, parent: null, z: 0, visible: true, ...o })
  parts.body = base(hipMid ?? { x: W / 2, y: H / 2 }, { z: 0 })
  if (neck) parts.head = base(neck, { parent: 'body', z: 4 })
  for (const s of segs) parts[s.id] = base(s.A, { parent: parts[s.parent] ? s.parent : 'body', z: s.z })
  // 올가미 파츠: 오려낸 원래 자리에서 시작. pivot은 파츠 가운데(피벗 도구로 옮길 수 있음)
  plans.forEach((pl, j) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1
    for (let i = 0; i < W * H; i++) if (owner[i] === lassoCode[j]) { const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    const c = x1 < 0 ? { x: W / 2, y: H / 2 } : { x: (x0 + x1 + 1) / 2, y: (y0 + y1 + 1) / 2 }
    parts[pl.id] = base(c, { parent: pl.parent, z: pl.z })
  })
  const order = [...PART_ORDER.filter((id) => parts[id]), ...plans.map((p) => p.id)]
  return { an, parts, order }
}

// 파츠 하나의 이미지: 주인이 이 파츠인 픽셀 + (아래팔·손·정강이·발) 관절 원 안의 팔다리 픽셀
export function renderPart(an: Analysis, code: number): PartDef {
  const { W, H, rgba, fg, owner } = an
  const disk = an.disks[code]
  const include = (i: number, x: number, y: number) =>
    owner[i] === code || (!!disk && (!fg || fg[i] === 1) && owner[i] !== 0 && Math.hypot(x - disk.x, y - disk.y) <= disk.r)
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  // 관절 원 밖은 주인 픽셀만 보면 되므로, 원의 범위와 주인 픽셀 범위로 상자를 잡는다
  for (let i = 0; i < W * H; i++) if (owner[i] === code) { const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (disk) { x0 = Math.min(x0, Math.max(0, Math.floor(disk.x - disk.r))); y0 = Math.min(y0, Math.max(0, Math.floor(disk.y - disk.r))); x1 = Math.max(x1, Math.min(W - 1, Math.ceil(disk.x + disk.r))); y1 = Math.max(y1, Math.min(H - 1, Math.ceil(disk.y + disk.r))) }
  if (x1 < x0 || y1 < y0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0 } // 빈 파츠도 계층은 유지 (1×1 투명)
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  const img = new ImageData(w, h)
  const alpha = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = x + x0, gy = y + y0, gi = gy * W + gx
    if (!include(gi, gx, gy)) continue
    const o = (y * w + x) * 4
    img.data[o] = rgba[gi * 4]; img.data[o + 1] = rgba[gi * 4 + 1]; img.data[o + 2] = rgba[gi * 4 + 2]; img.data[o + 3] = 255
    alpha[y * w + x] = 255
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.putImageData(img, 0, 0)
  return { id: an.codes[code], name: an.names[code], w, h, image: c, alpha, origin: { x: x0, y: y0 } }
}

// 몸통: 다른 파츠가 가져간 자리를 기존 holeFill로 메운다. 배경은 투명.
// 파츠가 떠난 자리는 몸통 영역 안쪽만 채운 색을 쓰고, 바깥(예: 옆으로 뻗은 팔이 있던 곳)은 투명.
export function renderBody(an: Analysis): PartDef {
  const { W, H, rgba, fg, owner, inTorso } = an
  const body = new Uint8ClampedArray(rgba)
  const hole = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) if (owner[i] !== 0) hole[i] = 1
  fillMasked(body, hole, W, H)
  const alpha = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const a = (!fg || fg[i]) && (!hole[i] || inTorso[i] || !an.hasTorso) ? 255 : 0
    body[i * 4 + 3] = a
    alpha[i] = a
  }
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  c.getContext('2d')!.putImageData(new ImageData(body, W, H), 0, 0)
  return { id: 'body', name: 'Body', w: W, h: H, image: c, alpha, origin: { x: 0, y: 0 } }
}

export function renderDefs(an: Analysis, codes?: Iterable<number>): Record<string, PartDef> {
  const out: Record<string, PartDef> = {}
  const list = codes ? [...new Set(codes)] : an.codes.map((_, i) => i)
  for (const c of list) {
    if (c < 0 || c >= an.codes.length) continue
    out[an.codes[c]] = c === 0 ? renderBody(an) : renderPart(an, c)
  }
  // 관절 원은 다른 팔다리 픽셀을 가져오므로, 팔다리의 경계가 바뀌면 그 자식(관절 원을 가진 파츠)도 다시 만든다
  if (codes) for (let c = 1; c < an.codes.length; c++) if (an.disks[c] && !out[an.codes[c]]) out[an.codes[c]] = renderPart(an, c)
  return out
}

export function buildCharacter(
  img: CanvasImageSource, W: number, H: number, ptsIn: Pt[],
  opts: { name?: string; lasso?: LassoPart[] } = {},
): { char: Character; state: EditorState; an: Analysis } {
  const { an, parts, order } = analyze(img, W, H, ptsIn, opts.lasso ?? [])
  const defs = renderDefs(an)
  return { char: { name: opts.name ?? 'Character', w: W, h: H, defs, order }, state: { parts, keys: [], duration: 3, owner: rootSnapshot() }, an }
}
