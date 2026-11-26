// 내보내기 계산: 출력 크기, 타일 나누기, 파일 이름, 투명 이미지 자르기 범위, OBJ 재질 파일. 화면 API 없음.
import { aspectRatio, type Aspect, type SizeName } from './camera.ts'

export const SIZE_LONG: Record<SizeName, number> = { HD: 1280, FHD: 1920, QHD: 2560, '4K': 3840 }
export const MAX_LONG = 4096
export const TILE_MAX = 2048

// 긴 변 기준 크기. 짝수로 맞춘다
export function outputSize(size: SizeName | number, aspect: Aspect): { w: number; h: number } {
  const long = Math.min(MAX_LONG, Math.max(64, typeof size === 'number' ? size : SIZE_LONG[size]))
  const r = aspectRatio(aspect)
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return r >= 1 ? { w: even(long), h: even(long / r) } : { w: even(long * r), h: even(long) }
}

export type Tile = { x: number; y: number; w: number; h: number }
// 큰 이미지를 max 이하 조각으로. 조각들은 겹치지 않고 전체를 정확히 덮는다
export function tiles(w: number, h: number, max = TILE_MAX): Tile[] {
  const nx = Math.ceil(w / max), ny = Math.ceil(h / max)
  const out: Tile[] = []
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = Math.round((i * w) / nx), y = Math.round((j * h) / ny)
    out.push({ x, y, w: Math.round(((i + 1) * w) / nx) - x, h: Math.round(((j + 1) * h) / ny) - y })
  }
  return out
}

// 파일 이름: 금지 문자는 _, 공백은 -, 최대 80자
export function fileName(parts: string[], ext: string): string {
  const base = parts.filter(Boolean).join('_').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '-').replace(/_+/g, '_').slice(0, 80)
  return `${base || 'skela'}.${ext}`
}

// 투명 이미지(RGBA)에서 불투명 픽셀이 있는 범위 + 여백. 아무것도 없으면 null
export function alphaBounds(data: Uint8ClampedArray | number[], w: number, h: number, pad = 8, threshold = 8) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) return null
  const X0 = Math.max(0, x0 - pad), Y0 = Math.max(0, y0 - pad), X1 = Math.min(w - 1, x1 + pad), Y1 = Math.min(h - 1, y1 + pad)
  return { x: X0, y: Y0, w: X1 - X0 + 1, h: Y1 - Y0 + 1 }
}

// OBJ 이름은 영문·숫자·_ 만 (한글이 깨지는 툴이 있다)
export const asciiName = (s: string) => s.normalize('NFKD').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'item'

// OBJ와 짝이 되는 .mtl (색 = Kd, 투명도 = d)
export function mtlText(materials: { name: string; color: string; opacity?: number }[]): string {
  const seen = new Set<string>()
  const lines = ['# Skela Room']
  for (const m of materials) {
    if (seen.has(m.name)) continue
    seen.add(m.name)
    const c = m.color.replace('#', '')
    const rgb = [0, 2, 4].map((i) => (parseInt(c.slice(i, i + 2), 16) / 255).toFixed(4))
    lines.push('', `newmtl ${m.name}`, `Kd ${rgb.join(' ')}`, `Ka 0 0 0`, `d ${(m.opacity ?? 1).toFixed(3)}`, 'illum 1')
  }
  return lines.join('\n') + '\n'
}

// 3D 파일 좌표: 평면도 (x, y, 높이) cm → (x/100, 높이/100, y/100) m. 오른손, Y가 위, 1 = 1m
export const CM_TO_M = 0.01
export const toAssetMeters = (x: number, y: number, h: number): [number, number, number] => [x / 100, h / 100, y / 100]
