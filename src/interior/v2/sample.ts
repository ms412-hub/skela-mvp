// v2 예시 프로젝트: 복도형 64평 4층 집. 벽 구조는 1층과 같고 층마다 쓰임새·색이 다르다. 화면 API 없음(테스트 대상).
//
// 방 위치 (복도형 64평 벽 그대로, 단위 cm):
//   둘째 방 0~550 × 0~401 (욕실 330~550 × 200~401) · 방3 0~330 × 561~962 · 공용 욕실 330~550 × 561~962
//   가운데 위 550~1400 × 0~401 (복도와 트임) · 가운데 아래 550~1400 × 561~962 (위쪽 850~1100 트임)
//   방4 1400~1760 × 0~401 · 방5 1400~1760 × 561~962 · 안방 1760~2200 × 0~962 (욕실 1960~2200 × 702~962)
//   복도 y 401~561 (현관 쪽 x 0~550, 안방 쪽 1400~1760, 가운데는 트인 통로) — 가구를 두지 않는다
import type { Plan } from '../Plan.ts'
import * as P from '../Plan.ts'
import { findTemplate } from '../templates.ts'
import { furnitureTypeV2 } from './catalog2.ts'
import { makeCamera } from './camera.ts'
import * as PR from './project.ts'

type Item = [type: string, x: number, y: number, rot?: number, size?: { w?: number; d?: number; h?: number }, color?: string]

function furnish(base: Plan, name: string, floorColor: string, wallColor: string, items: Item[]): Plan {
  let p: Plan = { ...base, name, floorColor, wallColor, furniture: [] }
  for (const [type, x, y, rot = 0, size, color] of items) {
    const t = furnitureTypeV2(type)
    if (!t) continue
    p = P.addFurniture(p, type, x, y, t)
    const id = p.furniture[p.furniture.length - 1].id
    p = P.updateFurniture(p, id, { rot, ...size, ...(color ? { color } : {}) })
  }
  return p
}

// 욕실 세 곳은 모든 층이 같다 (벽이 같으므로)
const BATHS: Item[] = [
  ['tile', 440, 300, 0, { w: 210, d: 191 }], ['toilet', 511, 250, 90], ['basin', 420, 228], ['bathtub', 440, 358],
  ['tile', 440, 761, 0, { w: 210, d: 391 }], ['toilet', 511, 680, 90], ['basin', 358, 640, 270], ['bathtub', 440, 918],
  ['tile', 2080, 832, 0, { w: 230, d: 250 }], ['bathtub', 2105, 920], ['toilet', 2161, 760, 90], ['basin', 2040, 730],
]
// 계단: 거실 왼쪽 벽을 따라, 복도 쪽(아래)에서 올라가기 시작해 위쪽으로 오른다. 창문을 가리지 않는다
const STAIRS: Item = ['stairs', 605, 140, 0]

// 2F 가족 층: 아이방 2, 가족 라운지, 놀이방·식당, 서재, 드레스룸, 부부 침실
const FAMILY: Item[] = [
  STAIRS, ...BATHS,
  // 아이방 1 (둘째 방)
  ['bed', 110, 110, 0, { w: 100, d: 200 }, '#e9a6a1'], ['desk', 400, 35, 180], ['chair', 400, 92, 180], ['rug', 230, 300, 0, { w: 120, d: 90 }, '#f2c14e'], ['plant', 290, 40],
  // 아이방 2 (방3)
  ['bed', 65, 855, 180, { w: 100, d: 200 }, '#7fb3d5'], ['desk', 295, 700, 270], ['chair', 240, 700, 270], ['bookshelf', 220, 940, 180],
  // 가족 라운지 (가운데 위): TV는 오른쪽 벽, 소파는 옆으로 앉아 본다 + 왼쪽 창가 독서 구석
  ['tv', 1375, 200, 90], ['rug', 1235, 200, 90, {}, '#5d7a8c'], ['table', 1235, 200, 90, { w: 70, d: 50 }], ['sofa', 1100, 200, 270, {}, '#c9875a'],
  ['chair', 660, 300, 270, {}, '#a0522d'], ['table', 720, 300, 0, { w: 50, d: 50, h: 55 }], ['plant', 640, 360],
  ['plant', 1300, 360],
  // 놀이방 + 아이 공부 코너 (가운데 아래, 식탁 없음)
  ['rug', 720, 800, 0, {}, '#d9a441'], ['table', 720, 800, 0, { w: 60, d: 60, h: 40 }], ['bookshelf', 620, 940, 180], ['bookshelf', 710, 940, 180],
  ['desk', 1100, 925, 0, { w: 110 }, '#f4e3c3'], ['desk', 1230, 925, 0, { w: 110 }, '#f4e3c3'],
  ['chair', 1100, 870, 0, {}, '#e9a6a1'], ['chair', 1230, 870, 0, {}, '#7fb3d5'], ['bookshelf', 1380, 700, 90], ['plant', 1340, 920],
  ['rug', 1150, 720, 0, { w: 140, d: 90 }, '#a7c4a0'],
  // 서재 (방4)
  ['desk', 1580, 35, 180], ['chair', 1580, 92, 180], ['bookshelf', 1420, 300, 270], ['bookshelf', 1740, 300, 90],
  // 드레스룸 (방5): 복도 쪽 문을 막고 안방에서만 들어간다(워크인 클로젯). 막힌 옛 문 자리 벽에 옷장
  ['wardrobe', 1433, 640, 270], ['wardrobe', 1433, 760, 270], ['wardrobe', 1727, 640, 90], ['wardrobe', 1580, 594], ['rug', 1580, 840, 0, { w: 120, d: 80 }, '#b9a7c9'],
  // 부부 침실 (안방)
  ['bed', 1980, 120, 0, {}, '#6c5b4f'], ['wardrobe', 1793, 150, 270], ['wardrobe', 1793, 270, 270], ['desk', 2165, 450, 270], ['chair', 2110, 450, 270],
  ['rug', 1980, 330, 0, {}, '#a8b5a0'], ['plant', 2170, 650],
]

// 3F 작업·취미 층: 오픈 오피스, 회의실, 작업실, 음악실, 게임방, 수납실, 큰 서재
const WORK: Item[] = [
  STAIRS, ...BATHS,
  // 작업실 (둘째 방)
  ['desk', 165, 40, 180, { w: 200, d: 70 }, '#f2efe8'], ['chair', 165, 105, 180, {}, '#e9b44c'], ['bookshelf', 20, 300, 270], ['table', 165, 300, 0, { w: 120, d: 60, h: 90 }, '#8a8f94'],
  // 음악실 (방3)
  ['sofa', 50, 760, 270, { w: 160 }, '#3f5f7a'], ['rug', 190, 760, 0, { w: 140, d: 160 }, '#c35d4a'], ['table', 190, 760, 0, { w: 60, d: 60 }], ['bookshelf', 260, 940, 180],
  // 오픈 오피스 (가운데 위): 책상 4개가 마주 보는 섬
  ['desk', 880, 150, 0, {}, '#f2efe8'], ['desk', 1080, 150, 0, {}, '#f2efe8'], ['desk', 880, 210, 180, {}, '#f2efe8'], ['desk', 1080, 210, 180, {}, '#f2efe8'],
  ['chair', 880, 95, 0, {}, '#e07a5f'], ['chair', 1080, 95, 0, {}, '#e07a5f'], ['chair', 880, 265, 180, {}, '#e07a5f'], ['chair', 1080, 265, 180, {}, '#e07a5f'],
  ['bookshelf', 1380, 150, 90], ['bookshelf', 1380, 250, 90], ['bookshelf', 1380, 350, 90], ['plant', 1300, 40], ['plant', 620, 340],
  // 메이커 작업대 + 휴게 라운지 (가운데 아래, 식탁 없음)
  ['table', 1010, 770, 0, { w: 180, d: 90, h: 92 }, '#3d8c8c'],
  ['stool', 960, 700, 0, {}, '#e07a5f'], ['stool', 1060, 700, 0, {}, '#e07a5f'], ['stool', 960, 840, 0, {}, '#e07a5f'], ['stool', 1060, 840, 0, {}, '#e07a5f'],
  ['tv', 1375, 790, 90], ['bookshelf', 1250, 940, 180], ['bookshelf', 1160, 940, 180],
  ['sofa', 620, 780, 270, { w: 180 }, '#e9b44c'], ['rug', 730, 780, 0, { w: 110, d: 150 }, '#f2efe8'], ['table', 730, 780, 0, { w: 50, d: 70, h: 40 }], ['plant', 600, 920],
  // 게임방 (방4)
  ['tv', 1735, 200, 90], ['sofa', 1460, 200, 270, {}, '#7a4a8c'], ['rug', 1600, 200, 0, { w: 140, d: 200 }, '#2f3b4a'], ['plant', 1440, 360],
  // 수납실 (방5)
  ['bookshelf', 1460, 940, 180], ['bookshelf', 1560, 940, 180], ['bookshelf', 1660, 940, 180], ['wardrobe', 1433, 680, 270],
  // 큰 서재 (안방)
  ['bookshelf', 2180, 100, 90], ['bookshelf', 2180, 180, 90], ['bookshelf', 2180, 420, 90], ['bookshelf', 2180, 500, 90],
  ['desk', 1980, 35, 180, { w: 160 }], ['chair', 1980, 92, 180], ['rug', 1960, 420, 0, { w: 180, d: 160 }, '#9aa58c'],
  ['chair', 1880, 420, 270, { w: 60, d: 60 }, '#6b4f3a'], ['chair', 2040, 420, 90, { w: 60, d: 60 }, '#6b4f3a'], ['table', 1960, 420, 0, { w: 50, d: 50, h: 50 }],
  ['plant', 1800, 650],
]

// 4F 휴식·게스트 층: 홈시어터, 바·카페, 게스트룸 2, 요가실, 세탁실, 스위트룸
const LEISURE: Item[] = [
  STAIRS, ...BATHS,
  // 게스트룸 1 (둘째 방)
  ['bed', 165, 118, 0, {}, '#5f7a8c'], ['wardrobe', 440, 33], ['plant', 290, 40],
  // 게스트룸 2 (방3): 싱글 침대 두 개
  ['bed', 65, 855, 180, { w: 100, d: 200 }, '#c9b38f'], ['bed', 195, 855, 180, { w: 100, d: 200 }, '#c9b38f'], ['plant', 295, 600],
  // 홈시어터 (가운데 위): 복도 쪽에 세운 큰 화면을 보고, 영화관처럼 앞뒤 두 줄 (창 쪽이 뒷줄)
  ['tv', 1000, 378, 180, { w: 240 }], ['rug', 1000, 300, 0, { w: 260, d: 80 }, '#3c4a5c'],
  ['sofa', 1000, 210, 0, {}, '#9c3d3d'], ['sofa', 1000, 100, 0, { h: 100 }, '#9c3d3d'],
  ['table', 1000, 30, 0, { w: 160, d: 40, h: 75 }, '#5a4636'], ['plant', 1360, 40], ['plant', 1360, 340], ['plant', 760, 40],
  // 바·카페 (가운데 아래)
  ['island', 975, 760], ['stool', 920, 695], ['stool', 975, 695], ['stool', 1030, 695],
  ['pendant', 915, 760], ['pendant', 975, 760], ['pendant', 1035, 760],
  ['counter', 1240, 927, 180], ['upper', 1240, 940, 180], ['fridge', 600, 920, 180],
  // 창가 대화 코너 (식탁 없음)
  ['rug', 700, 760, 0, { w: 180, d: 120 }, '#e3cfa8'], ['chair', 645, 760, 270, { w: 60, d: 60 }, '#4f6d8f'], ['chair', 755, 760, 90, { w: 60, d: 60 }, '#4f6d8f'],
  ['table', 700, 760, 0, { w: 45, d: 45, h: 50 }], ['plant', 600, 600], ['plant', 790, 640],
  // 요가·명상실 (방4)
  ['rug', 1580, 200, 0, { w: 240, d: 180 }, '#7c9a6d'], ['plant', 1430, 40], ['plant', 1730, 40], ['plant', 1430, 350], ['plant', 1730, 350],
  // 세탁실 (방5)
  ['floortile', 1580, 761, 0, { w: 350, d: 391 }, '#cfd6d8'], ['counter', 1725, 760, 90], ['basin', 1428, 760, 270], ['bookshelf', 1500, 940, 180],
  // 스위트룸 (안방)
  ['bed', 1868, 200, 270, {}, '#ece4d6'], ['sofa', 2150, 450, 90, {}, '#4f6d8f'], ['rug', 2040, 450, 0, { w: 160, d: 120 }, '#d9c7a7'],
  ['wardrobe', 1860, 660], ['plant', 2170, 640], ['plant', 2110, 650], ['plant', 2030, 655], ['plant', 1990, 600],
]

// 2층만: 드레스룸(방5)의 복도 쪽 문(wall8)을 없애고, 안방과 사이 벽(wall13)에 문을 낸다 (안방 입구 y=481보다 안쪽 y=820)
export const DRESSROOM_DOOR_Y = 820
function walkInCloset(p: Plan): Plan {
  let q = p
  for (const o of q.openings.filter((o) => o.wallId === 'wall8')) q = P.removeOpening(q, o.id)
  const w = q.walls.find((x) => x.id === 'wall13')
  return w ? P.addOpening(q, 'wall13', (DRESSROOM_DOOR_Y - w.a.y) / (w.b.y - w.a.y), 'door') : q
}

export const SAMPLE_FLOORS: { name: string; theme: string; floorColor: string; wallColor: string; items: Item[]; edit?: (p: Plan) => Plan }[] = [
  { name: '2F', theme: '가족 층', floorColor: '#b8916a', wallColor: '#efe9df', items: FAMILY, edit: walkInCloset },
  { name: '3F', theme: '작업·취미 층', floorColor: '#cb9a68', wallColor: '#fbf6ee', items: WORK },
  { name: '4F', theme: '휴식·게스트 층', floorColor: '#c7b08c', wallColor: '#f3efe6', items: LEISURE },
]

export function sampleProject(): PR.Project {
  let p1 = findTemplate('corridor64')!.build()
  // 1층에도 같은 자리에 계단. 계단 자리에 있던 기본 가구(책장)는 뺀다
  p1 = { ...p1, furniture: p1.furniture.filter((f) => !(f.x > 540 && f.x < 670 && f.y < 290)) }
  p1 = P.addFurniture(p1, 'stairs', STAIRS[1], STAIRS[2], furnitureTypeV2('stairs')!)
  let pr = PR.newProject({ ...p1, name: '1F' }, '복도형 64평 (4층)')
  for (const f of SAMPLE_FLOORS) {
    pr = PR.addFloor(PR.selectFloor(pr, pr.floors[pr.floors.length - 1].id))
    const fl = pr.floors[pr.floors.length - 1]
    pr = PR.setFloorPlan(pr, fl.id, furnish(f.edit ? f.edit(p1) : p1, f.name, f.floorColor, f.wallColor, f.items))
    pr = PR.renameFloor(pr, fl.id, f.name)
  }
  const room = P.planBounds(p1)
  const living = makeCamera('interior', 'cam1', '거실 인테리어', 'floor1', room, '3:2')
  living.pos = { x: 1290, y: 520, h: 150 }
  living.target = { x: 880, y: 140, h: 105 }
  pr = PR.upsertCamera(pr, living)
  pr = PR.upsertCamera(pr, makeCamera('iso', 'cam2', '1층 아이소', 'floor1', room, '16:9'))
  pr = PR.upsertCamera(pr, makeCamera('illust', 'cam3', '2층 게임 일러스트', pr.floors[1].id, room, '16:9'))
  return { ...pr, currentFloorId: 'floor1' }
}
