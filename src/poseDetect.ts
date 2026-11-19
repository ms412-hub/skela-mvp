// 관절 자동 추정 보강: 그림 주변에 흰 여백을 붙여 여러 번 추정하고, 신뢰도가 가장 높은 결과를 고른다.
//
// 이유 (캐릭터 10종으로 측정, 사람이 맞춘 관절과 비교):
// - 캐릭터 그림은 보통 위아래가 꽉 차게 잘려 있다. MediaPipe는 사람이 그림 가장자리에 붙어 있으면
//   아예 못 찾거나(10종 중 5종 실패) 발목을 정강이 중간에서 끝낸다.
// - 여백 0 / 10 / 20 / 35%로 추정해 신뢰도(visibility 평균)가 가장 높은 것을 고르면 성공 5→7종,
//   와이드팬츠 오차 11.1%→3.8% (키 대비). 신뢰도로 고른 결과는 실제 최선과 거의 같았다.
// - 여백 0도 후보에 들어 있으므로, 예전에 찾던 그림을 못 찾게 되는 일은 없다.
//
// 화면 API(캔버스)는 makeCanvas로 주입받아, 계산 부분은 단독으로 테스트할 수 있다.

export const PAD_STEPS = [0, 0.1, 0.2, 0.35]
// 신뢰도를 평가할 기본 관절 (MediaPipe 번호)
export const SCORE_IDS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]

export type Landmark = { x: number; y: number; visibility?: number }
export type PoseResult = { landmarks: Landmark[][] }
export type Landmarker = { detect: (c: CanvasImageSource) => PoseResult }
export type Ctx2D = { fillStyle: unknown; fillRect: (x: number, y: number, w: number, h: number) => void; drawImage: (...a: never[]) => void }
export type MakeCanvas = (w: number, h: number) => { canvas: CanvasImageSource; ctx: Ctx2D }

// 여백을 붙인 캔버스 기준의 0~1 좌표를 원래 그림의 픽셀 좌표로 되돌린다
export function unpad(lms: Landmark[], pad: number, W: number, H: number) {
  const px = Math.round(pad * W), py = Math.round(pad * H)
  const cw = W + 2 * px, ch = H + 2 * py
  return lms.map((l) => ({ x: l.x * cw - px, y: l.y * ch - py, v: l.visibility ?? 0 }))
}

export function meanVisibility(pts: { v: number }[], ids = SCORE_IDS) {
  const vs = ids.map((i) => pts[i]?.v ?? 0)
  return vs.reduce((a, b) => a + b, 0) / vs.length
}

// 신뢰도가 가장 높은 후보. 같으면 여백이 작은 쪽 (원래 그림에 가까운 결과)
export function pickBest<T extends { pad: number; score: number }>(cands: T[]): T | null {
  let best: T | null = null
  for (const c of cands) if (!best || c.score > best.score + 1e-9 || (Math.abs(c.score - best.score) <= 1e-9 && c.pad < best.pad)) best = c
  return best
}

const domCanvas: MakeCanvas = (w, h) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { canvas: c, ctx: c.getContext('2d') as unknown as Ctx2D }
}

// 반환: 원래 그림 픽셀 좌표의 관절(MediaPipe 번호 순서), 고른 여백, 신뢰도. 모든 여백에서 못 찾으면 null
export function detectWithPadding(
  landmarker: Landmarker,
  src: CanvasImageSource & { width: number; height: number },
  opts: { pads?: number[]; makeCanvas?: MakeCanvas } = {},
) {
  const W = src.width, H = src.height
  const make = opts.makeCanvas ?? domCanvas
  const cands: { pad: number; score: number; points: { x: number; y: number; v: number }[] }[] = []
  for (const pad of opts.pads ?? PAD_STEPS) {
    let input: CanvasImageSource = src
    if (pad > 0) {
      const px = Math.round(pad * W), py = Math.round(pad * H)
      const { canvas, ctx } = make(W + 2 * px, H + 2 * py)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W + 2 * px, H + 2 * py)
      ;(ctx.drawImage as (s: CanvasImageSource, x: number, y: number) => void)(src, px, py)
      input = canvas
    }
    const r = landmarker.detect(input)
    if (!r.landmarks.length) continue
    const points = unpad(r.landmarks[0], pad, W, H)
    cands.push({ pad, score: meanVisibility(points), points })
  }
  return pickBest(cands)
}
