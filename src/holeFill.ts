// 파츠를 떼어낸 자리(구멍)를 주변 색으로 메운다. 화면 API 없이 픽셀 배열만 다뤄서 단독으로 테스트할 수 있다.
//
// 방식: 구멍 가장자리에서 안쪽으로 한 겹씩 채운다. 한 겹의 색은 이미 색이 정해진 이웃 8칸의 평균이다.
// 그 뒤 구멍 안쪽만 몇 번 부드럽게 섞어 줄무늬를 줄인다.
// rgba: RGBA 픽셀(w*h*4). mask: 구멍이면 1. 구멍이 아닌 픽셀은 바꾸지 않는다.
// 반환값: 채운 픽셀 수. 구멍이 없거나 전체가 구멍이면(참고할 색이 없음) 0을 돌려주고 아무것도 바꾸지 않는다.
export function fillMasked(rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, smooth = 6): number {
  const n = w * h
  const known = new Uint8Array(n)
  let holes = 0
  for (let i = 0; i < n; i++) {
    if (mask[i]) holes++
    else known[i] = 1
  }
  if (holes === 0 || holes === n) return 0

  const neighbors = (i: number, fn: (j: number) => void) => {
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

  // 첫 겹: 색이 정해진 이웃이 하나라도 있는 구멍 픽셀
  const queued = new Uint8Array(n)
  let cur: number[] = []
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    let adj = false
    neighbors(i, (j) => { if (known[j]) adj = true })
    if (adj) { queued[i] = 1; cur.push(i) }
  }

  while (cur.length) {
    const cols = new Uint8ClampedArray(cur.length * 3)
    cur.forEach((i, k) => {
      let r = 0, g = 0, b = 0, c = 0
      neighbors(i, (j) => { if (known[j]) { r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; c++ } })
      cols[k * 3] = r / c
      cols[k * 3 + 1] = g / c
      cols[k * 3 + 2] = b / c
    })
    const next: number[] = []
    cur.forEach((i, k) => {
      rgba[i * 4] = cols[k * 3]
      rgba[i * 4 + 1] = cols[k * 3 + 1]
      rgba[i * 4 + 2] = cols[k * 3 + 2]
      rgba[i * 4 + 3] = 255
      known[i] = 1
    })
    cur.forEach((i) => neighbors(i, (j) => { if (!known[j] && !queued[j]) { queued[j] = 1; next.push(j) } }))
    cur = next
  }

  // 구멍 안쪽만 3×3 평균으로 몇 번 섞는다 (바깥 픽셀은 읽기만 하고 바꾸지 않는다)
  const idx: number[] = []
  for (let i = 0; i < n; i++) if (mask[i]) idx.push(i)
  const tmp = new Uint8ClampedArray(idx.length * 3)
  for (let it = 0; it < smooth; it++) {
    idx.forEach((i, k) => {
      let r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], c = 1
      neighbors(i, (j) => { r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; c++ })
      tmp[k * 3] = r / c
      tmp[k * 3 + 1] = g / c
      tmp[k * 3 + 2] = b / c
    })
    idx.forEach((i, k) => { rgba[i * 4] = tmp[k * 3]; rgba[i * 4 + 1] = tmp[k * 3 + 1]; rgba[i * 4 + 2] = tmp[k * 3 + 2] })
  }
  return holes
}
