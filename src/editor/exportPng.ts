// 현재 포즈를 PNG 한 장으로 그린다 (Scene 화면과 같은 순서·같은 변환)
import type { Character, EditorState } from '../character/CharacterModel'
import { drawOrder, worldMatrices } from '../character/CharacterModel'

// transparent: 배경을 투명하게. 아니면 흰 배경. scale: 원본 이미지 크기의 몇 배로 그릴지 (기본 1)
export function renderPose(char: Character, state: EditorState, opts: { transparent?: boolean; scale?: number } = {}): HTMLCanvasElement {
  const k = opts.scale ?? 1
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(char.w * k))
  c.height = Math.max(1, Math.round(char.h * k))
  const ctx = c.getContext('2d')!
  if (!opts.transparent) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  const W = worldMatrices(state)
  for (const id of drawOrder(char, state)) {
    const d = char.defs[id], p = state.parts[id]
    if (!d?.image || !p.visible) continue
    const m = W[id]
    ctx.setTransform(k * m[0], k * m[1], k * m[2], k * m[3], k * m[4], k * m[5])
    ctx.drawImage(d.image, d.origin.x, d.origin.y)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return c
}
