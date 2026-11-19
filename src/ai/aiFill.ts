// AI 구멍 복원 어댑터: inpainting.ts의 aiFill 훅에 끼우는 비동기 함수를 만든다.
//
//   구멍 자리를 마젠타로 칠한 이미지 → Gemini 이미지 편집 → 돌려받은 이미지에서 "구멍 안쪽 픽셀만" 가져온다.
//   모델이 구멍 밖을 조금 바꿔도, 마스크 밖은 항상 원본을 유지하므로 앱의 나머지 그림은 변하지 않는다.
//
// 이미지 입출력(PNG 인코딩/디코딩)은 codec으로 주입받는다 (브라우저용은 browserCodec.ts, 테스트는 가짜).
import { requestGeminiImage } from './geminiFill.ts'
import type { GeminiFillConfig } from './geminiFill.ts'

export type ImageCodec = {
  encodePng: (rgba: Uint8ClampedArray, w: number, h: number) => Promise<string> // base64(접두사 없음)
  decode: (base64: string, mime: string) => Promise<{ data: Uint8ClampedArray; w: number; h: number }>
}

// 구멍 자리를 마젠타로 칠한 복사본 (원본은 바꾸지 않는다)
export function markHole(rgba: Uint8ClampedArray, mask: Uint8Array): Uint8ClampedArray {
  const out = rgba.slice()
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.set([255, 0, 255, 255], i * 4)
  return out
}

function sample(src: Uint8ClampedArray, sw: number, sh: number, fx: number, fy: number, o: number[]) {
  const x = Math.min(sw - 1, Math.max(0, fx)), y = Math.min(sh - 1, Math.max(0, fy))
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1)
  const tx = x - x0, ty = y - y0
  for (let k = 0; k < 3; k++) {
    const a = src[(y0 * sw + x0) * 4 + k] * (1 - tx) + src[(y0 * sw + x1) * 4 + k] * tx
    const b = src[(y1 * sw + x0) * 4 + k] * (1 - tx) + src[(y1 * sw + x1) * 4 + k] * tx
    o[k] = a * (1 - ty) + b * ty
  }
}

// 결과 이미지(rw×rh)를 w×h로 맞춰, 구멍 안쪽 픽셀만 rgba에 복사한다.
// 거절(false, rgba 그대로): 가로세로 비율이 6% 넘게 다르거나, 구멍이 거의 그대로 마젠타인 경우(모델이 지시를 무시함)
export function compositeHole(
  rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number,
  result: Uint8ClampedArray, rw: number, rh: number,
): boolean {
  if (Math.abs(rw / rh - w / h) / (w / h) > 0.06) return false
  const px = new Uint8ClampedArray(mask.length * 3)
  const tmp = [0, 0, 0]
  let holes = 0, magenta = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    holes++
    const x = i % w, y = (i - x) / w
    sample(result, rw, rh, ((x + 0.5) / w) * rw - 0.5, ((y + 0.5) / h) * rh - 0.5, tmp)
    px[i * 3] = tmp[0]; px[i * 3 + 1] = tmp[1]; px[i * 3 + 2] = tmp[2]
    if (tmp[0] > 200 && tmp[1] < 70 && tmp[2] > 200) magenta++
  }
  if (holes === 0 || magenta / holes > 0.5) return false
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    rgba[i * 4] = px[i * 3]; rgba[i * 4 + 1] = px[i * 3 + 1]; rgba[i * 4 + 2] = px[i * 3 + 2]; rgba[i * 4 + 3] = 255
  }
  return true
}

// inpainting.ts의 aiFillAsync 훅. 성공하면 true, 실패하면 rgba를 바꾸지 않고 false (이유는 onError로 알린다)
export function createAiFill(cfg: GeminiFillConfig & { codec: ImageCodec; onError?: (msg: string) => void }) {
  return async (rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number): Promise<boolean> => {
    try {
      const png = await cfg.codec.encodePng(markHole(rgba, mask), w, h)
      const img = await requestGeminiImage(cfg, png)
      const dec = await cfg.codec.decode(img.data, img.mime)
      if (!compositeHole(rgba, mask, w, h, dec.data, dec.w, dec.h)) {
        cfg.onError?.('AI 결과를 쓸 수 없어요 (그림 비율이 다르거나 구멍을 채우지 않았어요). 기존 복원을 유지합니다.')
        return false
      }
      return true
    } catch (e) {
      cfg.onError?.(e instanceof Error ? e.message : String(e))
      return false
    }
  }
}
