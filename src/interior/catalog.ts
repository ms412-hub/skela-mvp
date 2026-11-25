// 가구 목록: 모든 가구를 "상자(큐브) 조합"으로 정의한다.
// 파일이 필요 없어서 무료이고 라이선스 걱정이 없다. 웹 3D 보기와 Unity가 같은 정의를 쓴다.
//
// 상자 하나: 가구 가운데를 기준으로 한 위치(x 좌우, z 앞뒤), 바닥에서 높이(y), 크기(w 폭, d 깊이, h 높이). 기본 크기 기준(cm).
// color가 없으면 가구의 대표 색을 쓴다. 가구 크기를 바꾸면 상자들이 같은 비율로 늘어난다.
export type BoxSpec = { x: number; z: number; y: number; w: number; d: number; h: number; color?: string }
export type FurnitureType = { id: string; name: string; w: number; d: number; h: number; color: string; boxes: BoxSpec[] }

const leg = (x: number, z: number, h: number, s = 5): BoxSpec => ({ x, z, y: 0, w: s, d: s, h })

export const CATALOG: FurnitureType[] = [
  { id: 'bed', name: '침대', w: 160, d: 205, h: 60, color: '#8a6f55', boxes: [
    { x: 0, z: 0, y: 10, w: 160, d: 205, h: 25 },
    { x: 0, z: 5, y: 35, w: 152, d: 192, h: 15, color: '#f0eee9' },
    { x: -38, z: -80, y: 50, w: 60, d: 28, h: 8, color: '#ffffff' },
    { x: 38, z: -80, y: 50, w: 60, d: 28, h: 8, color: '#ffffff' },
    { x: 0, z: -101, y: 0, w: 160, d: 6, h: 55 },
  ] },
  { id: 'sofa', name: '소파', w: 200, d: 90, h: 85, color: '#4f6d8f', boxes: [
    { x: 0, z: 0, y: 10, w: 200, d: 90, h: 30 },
    { x: 0, z: -34, y: 40, w: 200, d: 22, h: 45 },
    { x: -92, z: 0, y: 40, w: 16, d: 90, h: 25 },
    { x: 92, z: 0, y: 40, w: 16, d: 90, h: 25 },
    { x: 0, z: 8, y: 40, w: 168, d: 66, h: 12, color: '#6d8cae' },
    leg(-92, -38, 10, 8), leg(92, -38, 10, 8), leg(-92, 38, 10, 8), leg(92, 38, 10, 8),
  ] },
  { id: 'dining', name: '식탁', w: 140, d: 80, h: 75, color: '#a0794f', boxes: [
    { x: 0, z: 0, y: 70, w: 140, d: 80, h: 5 },
    leg(-64, -34, 70), leg(64, -34, 70), leg(-64, 34, 70), leg(64, 34, 70),
  ] },
  { id: 'chair', name: '의자', w: 45, d: 45, h: 90, color: '#8c6a43', boxes: [
    { x: 0, z: 0, y: 43, w: 45, d: 45, h: 4 },
    { x: 0, z: -20, y: 47, w: 45, d: 4, h: 43 },
    leg(-19, -19, 43, 4), leg(19, -19, 43, 4), leg(-19, 19, 43, 4), leg(19, 19, 43, 4),
  ] },
  { id: 'desk', name: '책상', w: 120, d: 60, h: 74, color: '#c7b08c', boxes: [
    { x: 0, z: 0, y: 70, w: 120, d: 60, h: 4 },
    { x: -52, z: 0, y: 0, w: 4, d: 56, h: 70 },
    { x: 52, z: 0, y: 0, w: 4, d: 56, h: 70 },
    { x: 0, z: 26, y: 20, w: 100, d: 3, h: 45 },
  ] },
  { id: 'wardrobe', name: '옷장', w: 120, d: 55, h: 200, color: '#ece4d6', boxes: [
    { x: 0, z: 0, y: 0, w: 120, d: 55, h: 200 },
    { x: -30, z: 28, y: 20, w: 1.5, d: 1, h: 160, color: '#bdb3a2' },
    { x: 30, z: 28, y: 20, w: 1.5, d: 1, h: 160, color: '#bdb3a2' },
  ] },
  { id: 'bookshelf', name: '책장', w: 80, d: 30, h: 180, color: '#9a7b57', boxes: [
    { x: -38, z: 0, y: 0, w: 4, d: 30, h: 180 },
    { x: 38, z: 0, y: 0, w: 4, d: 30, h: 180 },
    { x: 0, z: -13, y: 0, w: 80, d: 4, h: 180 },
    ...[0, 45, 90, 135, 176].map((y): BoxSpec => ({ x: 0, z: 0, y, w: 76, d: 30, h: 4 })),
  ] },
  { id: 'table', name: '탁자', w: 90, d: 50, h: 45, color: '#7d6244', boxes: [
    { x: 0, z: 0, y: 40, w: 90, d: 50, h: 5 },
    leg(-40, -20, 40), leg(40, -20, 40), leg(-40, 20, 40), leg(40, 20, 40),
  ] },
  // 앞면은 +z (옷장 손잡이, 의자 앉는 쪽과 같음). 벽에 붙일 때 뒷면(-z)이 벽을 보게 돌린다
  { id: 'counter', name: '주방 조리대', w: 240, d: 60, h: 90, color: '#d9d4ca', boxes: [
    { x: 0, z: 0, y: 0, w: 240, d: 60, h: 85 },
    { x: 0, z: 0, y: 85, w: 240, d: 60, h: 5, color: '#3d4043' },
    { x: -50, z: 4, y: 89.6, w: 56, d: 38, h: 0.4, color: '#a7b0b5' },
    { x: 60, z: 6, y: 89.6, w: 60, d: 45, h: 0.4, color: '#1f2224' },
  ] },
  { id: 'fridge', name: '냉장고', w: 90, d: 75, h: 180, color: '#dfe3e6', boxes: [
    { x: 0, z: -1.5, y: 0, w: 90, d: 72, h: 180 },
    { x: -2, z: 36, y: 70, w: 2, d: 3, h: 60, color: '#9aa1a6' },
    { x: 2, z: 36, y: 70, w: 2, d: 3, h: 60, color: '#9aa1a6' },
  ] },
  { id: 'tv', name: 'TV장', w: 180, d: 40, h: 127, color: '#6e5a45', boxes: [
    { x: 0, z: 0, y: 0, w: 180, d: 40, h: 45 },
    { x: 0, z: -8, y: 45, w: 30, d: 15, h: 2, color: '#2a2c2f' },
    { x: 0, z: -8, y: 47, w: 140, d: 5, h: 80, color: '#1d1f22' },
  ] },
  { id: 'rug', name: '러그', w: 200, d: 140, h: 2, color: '#a85a5a', boxes: [{ x: 0, z: 0, y: 0, w: 200, d: 140, h: 2 }] },
]

export const furnitureType = (id: string) => CATALOG.find((t) => t.id === id)
