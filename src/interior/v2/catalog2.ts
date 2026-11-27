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

export const CATALOG_V2: FurnitureTypeV2[] = [...CATALOG, STAIRS].map((t) => ({ ...t, category: CATEGORY[t.id] ?? 'furniture', pack: 'core_free' as const }))
export const MAX_TYPES = 100
export const furnitureTypeV2 = (id: string) => CATALOG_V2.find((t) => t.id === id)
