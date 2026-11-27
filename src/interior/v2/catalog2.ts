// v2 가구 목록: 기존 23종(catalog.ts, 수정하지 않음) + 계단 1종, 모든 종류에 분류(category)와 팩(pack) 꼬리표
// 분류와 팩은 "종류"에 붙는 정보라 배치된 가구에는 저장하지 않는다 (목록과 값이 어긋나지 않게).
import { CATALOG, type BoxSpec, type FurnitureType } from '../catalog.ts'

export type Category = 'furniture' | 'appliance' | 'lighting' | 'decor' | 'architecture'
export type Pack = 'core_free'
export type FurnitureTypeV2 = FurnitureType & { category: Category; pack: Pack }

export const CATEGORY_NAME: Record<Category, string> = { furniture: '가구', appliance: '가전', lighting: '조명', decor: '장식', architecture: '건축' }

const CATEGORY: Record<string, Category> = {
  bed: 'furniture', sofa: 'furniture', dining: 'furniture', chair: 'furniture', desk: 'furniture', wardrobe: 'furniture',
  bookshelf: 'furniture', table: 'furniture', counter: 'furniture', upper: 'furniture', island: 'furniture', stool: 'furniture',
  toilet: 'furniture', basin: 'furniture', bathtub: 'furniture',
  fridge: 'appliance', tv: 'appliance', tallcab: 'appliance',
  pendant: 'lighting',
  rug: 'decor', plant: 'decor',
  tile: 'architecture', floortile: 'architecture', stairs: 'architecture',
  washer: 'appliance', dryer: 'appliance', rack: 'furniture', vanity: 'furniture', dresser: 'furniture', ottoman: 'furniture', mirror: 'decor',
}

// 계단: 위치 표시용 (층을 뚫지 않는다). 13단, 벽 높이 250cm에 맞춘다. 앞(+z)에서 올라가 뒤(-z)가 가장 높다.
//  - 흰 챌판(단 덩어리) + 앞으로 살짝 튀어나온 나무 디딤판 → 실제 계단처럼 두 가지 색
//  - 오른쪽(+x)에 계단 모양을 따라 오르는 흰 난간벽 (높이 = 디딤판 + 85cm, 벽 높이 넘지 않음)
const STEPS = 13
const RISE = 250 / STEPS, RUN = 20
const stairBoxes: BoxSpec[] = []
for (let i = 0; i < STEPS; i++) {
  const z = 130 - RUN / 2 - i * RUN, top = RISE * (i + 1)
  stairBoxes.push({ x: -3, z, y: 0, w: 94, d: RUN, h: top - 3, color: '#efe9df' }) // 챌판(단 몸통)
  stairBoxes.push({ x: -3, z: z + 1.5, y: top - 3, w: 94, d: RUN + 3, h: 3 }) // 디딤판 (앞으로 1.5cm)
  stairBoxes.push({ x: 47, z, y: 0, w: 6, d: RUN, h: Math.min(250, top + 85), color: '#f6f2ea' }) // 난간벽
}
export const STAIRS: FurnitureType = { id: 'stairs', name: '계단', w: 100, d: 266, h: 250, color: '#a9784e', boxes: stairBoxes }

// 드레스룸 가구 (v2 전용)
const CLOTHES = ['#2f3e5c', '#d8c3a5', '#f4f1ea', '#1f1f1f', '#7a2e3a', '#5f7a8c', '#c9a14a']
export const DRESSING: FurnitureType[] = [
  // 옷 행거: 양쪽 기둥 + 위 봉 + 걸린 옷 7벌 (옆에서 보면 얇은 판)
  { id: 'rack', name: '옷 행거', w: 120, d: 50, h: 170, color: '#3a3a3a', boxes: [
    { x: -58, z: 0, y: 0, w: 4, d: 50, h: 3 }, { x: 58, z: 0, y: 0, w: 4, d: 50, h: 3 },
    { x: -58, z: 0, y: 3, w: 4, d: 4, h: 167 }, { x: 58, z: 0, y: 3, w: 4, d: 4, h: 167 },
    { x: 0, z: 0, y: 164, w: 112, d: 3, h: 3 },
    ...CLOTHES.map((color, i): BoxSpec => ({ x: -45 + i * 15, z: 0, y: 70, w: 6, d: 44, h: 92, color })),
  ] },
  { id: 'mirror', name: '전신 거울', w: 60, d: 8, h: 180, color: '#c8a46e', boxes: [
    { x: 0, z: 0, y: 0, w: 60, d: 8, h: 180 },
    { x: 0, z: 3, y: 6, w: 52, d: 2, h: 168, color: '#cfe0e8' },
  ] },
  { id: 'vanity', name: '화장대', w: 90, d: 45, h: 150, color: '#f2ece2', boxes: [
    { x: 0, z: 0, y: 0, w: 90, d: 45, h: 75 },
    { x: 0, z: 21, y: 50, w: 80, d: 2, h: 1, color: '#bdb3a2' },
    { x: 0, z: -18, y: 75, w: 64, d: 6, h: 72, color: '#c8a46e' },
    { x: 0, z: -15, y: 79, w: 56, d: 1, h: 64, color: '#cfe0e8' },
  ] },
  { id: 'dresser', name: '아일랜드 서랍장', w: 120, d: 60, h: 90, color: '#efe7da', boxes: [
    { x: 0, z: 0, y: 0, w: 120, d: 60, h: 86 },
    { x: 0, z: 0, y: 86, w: 120, d: 60, h: 4, color: '#8a6a4a' },
    { x: 0, z: 29, y: 30, w: 110, d: 2, h: 1, color: '#bdb3a2' }, { x: 0, z: 29, y: 58, w: 110, d: 2, h: 1, color: '#bdb3a2' },
    { x: 0, z: -29, y: 30, w: 110, d: 2, h: 1, color: '#bdb3a2' }, { x: 0, z: -29, y: 58, w: 110, d: 2, h: 1, color: '#bdb3a2' },
  ] },
  { id: 'ottoman', name: '벤치 스툴', w: 80, d: 40, h: 45, color: '#b9a7c9', boxes: [
    { x: -36, z: -16, y: 0, w: 4, d: 4, h: 10, color: '#8a6a4a' }, { x: 36, z: -16, y: 0, w: 4, d: 4, h: 10, color: '#8a6a4a' },
    { x: -36, z: 16, y: 0, w: 4, d: 4, h: 10, color: '#8a6a4a' }, { x: 36, z: 16, y: 0, w: 4, d: 4, h: 10, color: '#8a6a4a' },
    { x: 0, z: 0, y: 10, w: 80, d: 40, h: 35 },
  ] },
]

// 세탁실 가전 (v2 전용): 앞면 +z에 동그란 유리문(네모로 단순화)과 위쪽 조작판
const laundry = (id: string, name: string, body: string, glass: string): FurnitureType => ({ id, name, w: 60, d: 60, h: 85, color: body, boxes: [
  { x: 0, z: 0, y: 0, w: 60, d: 60, h: 85 },
  { x: 0, z: 29, y: 26, w: 38, d: 2, h: 38, color: '#9aa3a8' },
  { x: 0, z: 29, y: 29, w: 30, d: 2, h: 32, color: glass },
  { x: 0, z: 28, y: 72, w: 54, d: 4, h: 9, color: '#d6dbde' },
] })
export const LAUNDRY: FurnitureType[] = [laundry('washer', '세탁기', '#f4f5f6', '#3c4a55'), laundry('dryer', '건조기', '#eceef0', '#55606a')]

export const CATALOG_V2: FurnitureTypeV2[] = [...CATALOG, STAIRS, ...DRESSING, ...LAUNDRY].map((t) => ({ ...t, category: CATEGORY[t.id] ?? 'furniture', pack: 'core_free' as const }))
export const MAX_TYPES = 100
export const furnitureTypeV2 = (id: string) => CATALOG_V2.find((t) => t.id === id)
