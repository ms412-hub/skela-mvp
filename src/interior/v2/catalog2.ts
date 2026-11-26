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

// 계단: 위치 표시용 (층을 뚫지 않는다). 디딤판 13단, 단 높이 20cm, 깊이 20cm. 앞(+z)에서 올라가 뒤(-z)가 가장 높다.
const STEPS = 13
const stairBoxes: BoxSpec[] = Array.from({ length: STEPS }, (_, i): BoxSpec => ({ x: 0, z: 130 - 10 - i * 20, y: 0, w: 100, d: 20, h: 20 * (i + 1) }))
export const STAIRS: FurnitureType = { id: 'stairs', name: '계단', w: 100, d: 260, h: 260, color: '#b9a58a', boxes: stairBoxes }

export const CATALOG_V2: FurnitureTypeV2[] = [...CATALOG, STAIRS].map((t) => ({ ...t, category: CATEGORY[t.id] ?? 'furniture', pack: 'core_free' as const }))
export const MAX_TYPES = 100
export const furnitureTypeV2 = (id: string) => CATALOG_V2.find((t) => t.id === id)
