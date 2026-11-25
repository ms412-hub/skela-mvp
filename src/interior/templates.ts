// 방 템플릿: 처음 여는 사람이 빈 화면 대신 바로 꾸밀 수 있는 방 (화면 API 없음, 단독 테스트 가능)
import { furnitureType } from './catalog.ts'
import type { Plan } from './Plan.ts'
import { addFurniture, addOpening, addWall, emptyPlan, updateFurniture } from './Plan.ts'

export type RoomTemplate = { id: string; name: string; desc: string; build: () => Plan }

// 네 모서리를 시계 방향으로 이어 직사각형 방을 만든다. 벽 id는 위→오른쪽→아래→왼쪽 순서
function rect(plan: Plan, x0: number, y0: number, x1: number, y1: number): Plan {
  let p = plan
  p = addWall(p, { x: x0, y: y0 }, { x: x1, y: y0 })
  p = addWall(p, { x: x1, y: y0 }, { x: x1, y: y1 })
  p = addWall(p, { x: x1, y: y1 }, { x: x0, y: y1 })
  p = addWall(p, { x: x0, y: y1 }, { x: x0, y: y0 })
  return p
}

// size를 주면 가로·깊이를 바꾼다 (욕실 타일을 방 크기에 맞출 때)
function put(plan: Plan, type: string, x: number, y: number, rot = 0, size?: { w: number; d: number }): Plan {
  const t = furnitureType(type)
  if (!t) return plan
  const p = addFurniture(plan, type, x, y, t)
  const id = p.furniture[p.furniture.length - 1].id
  return rot || size ? updateFurniture(p, id, { rot, ...size }) : p
}

export const TEMPLATES: RoomTemplate[] = [
  {
    id: 'studio', name: '원룸', desc: '6 × 4.5 m · 침대, 책상, 옷장',
    build: () => {
      let p = { ...emptyPlan(), name: '원룸' }
      p = rect(p, 0, 0, 600, 450)
      p = addOpening(p, 'wall1', 0.5, 'window')
      p = addOpening(p, 'wall3', 0.85, 'door')
      p = put(p, 'bed', 110, 120)
      p = put(p, 'desk', 470, 37, 180)
      p = put(p, 'chair', 470, 95, 180)
      p = put(p, 'wardrobe', 567, 300, 90)
      p = put(p, 'rug', 330, 290)
      p = put(p, 'table', 330, 290)
      return p
    },
  },
  {
    id: 'tworoom', name: '투룸', desc: '8 × 6 m · 침실과 거실',
    build: () => {
      let p = { ...emptyPlan(), name: '투룸' }
      p = rect(p, 0, 0, 800, 600)
      p = addWall(p, { x: 420, y: 0 }, { x: 420, y: 600 }) // wall5: 가운데 칸막이
      p = addOpening(p, 'wall1', 0.25, 'window')
      p = addOpening(p, 'wall1', 0.76, 'window')
      p = addOpening(p, 'wall3', 0.15, 'door') // 현관
      p = addOpening(p, 'wall5', 0.8, 'door') // 침실 문
      p = put(p, 'bed', 110, 120)
      p = put(p, 'wardrobe', 387, 250, 90)
      p = put(p, 'desk', 250, 560)
      p = put(p, 'chair', 250, 505)
      p = put(p, 'sofa', 610, 60)
      p = put(p, 'rug', 610, 200)
      p = put(p, 'table', 610, 195)
      p = put(p, 'bookshelf', 780, 330, 90)
      p = put(p, 'dining', 590, 420)
      p = put(p, 'chair', 560, 478, 180)
      p = put(p, 'chair', 620, 478, 180)
      return p
    },
  },
  {
    id: 'apartment', name: '쓰리룸 아파트', desc: '12 × 9 m · 방 3, 거실, 주방',
    build: () => {
      let p = { ...emptyPlan(), name: '쓰리룸 아파트', floorColor: '#a9845e' }
      p = rect(p, 0, 0, 1200, 900) // wall1 위, wall2 오른쪽, wall3 아래, wall4 왼쪽
      p = addWall(p, { x: 450, y: 0 }, { x: 450, y: 900 }) // wall5: 방 쪽과 거실 쪽 칸막이
      p = addWall(p, { x: 0, y: 450 }, { x: 450, y: 450 }) // wall6: 안방 | 작은방 1
      p = addWall(p, { x: 900, y: 560 }, { x: 900, y: 900 }) // wall7: 주방 | 작은방 2
      p = addWall(p, { x: 900, y: 560 }, { x: 1200, y: 560 }) // wall8: 거실 | 작은방 2
      // 창문
      p = addOpening(p, 'wall1', 0.1875, 'window') // 안방
      p = addOpening(p, 'wall1', 0.567, 'window') // 거실
      p = addOpening(p, 'wall1', 0.833, 'window') // 거실
      p = addOpening(p, 'wall2', 0.811, 'window') // 작은방 2
      p = addOpening(p, 'wall4', 0.25, 'window') // 작은방 1
      // 문
      p = addOpening(p, 'wall3', 0.5, 'door') // 현관 (x=600)
      p = addOpening(p, 'wall5', 0.42, 'door') // 안방
      p = addOpening(p, 'wall5', 0.58, 'door') // 작은방 1
      p = addOpening(p, 'wall7', 0.3, 'door') // 작은방 2
      // 안방 (0~450, 0~450)
      p = put(p, 'bed', 225, 120)
      p = put(p, 'wardrobe', 417, 150, 90)
      p = put(p, 'wardrobe', 417, 270, 90)
      p = put(p, 'desk', 110, 410)
      p = put(p, 'chair', 110, 355)
      p = put(p, 'rug', 225, 300)
      // 작은방 1 (0~450, 450~900)
      p = put(p, 'bed', 110, 570)
      p = put(p, 'desk', 330, 860)
      p = put(p, 'chair', 330, 805)
      p = put(p, 'bookshelf', 430, 780, 90)
      // 거실 (450~1200, 0~560)
      p = put(p, 'tv', 830, 25)
      p = put(p, 'rug', 830, 250)
      p = put(p, 'table', 830, 260)
      p = put(p, 'sofa', 830, 420, 180)
      p = put(p, 'bookshelf', 470, 150, 270)
      // 주방·식당 (450~900, 560~900)
      p = put(p, 'counter', 780, 865, 180)
      p = put(p, 'fridge', 505, 857, 180)
      p = put(p, 'dining', 680, 680)
      p = put(p, 'chair', 650, 615)
      p = put(p, 'chair', 710, 615)
      p = put(p, 'chair', 650, 745, 180)
      p = put(p, 'chair', 710, 745, 180)
      // 작은방 2 (900~1200, 560~900)
      p = put(p, 'desk', 1050, 860)
      p = put(p, 'chair', 1050, 805)
      p = put(p, 'bookshelf', 1180, 620, 90)
      return p
    },
  },
  {
    id: 'fiveroom', name: '5룸 대형 아파트', desc: '16 × 12.4 m · 방 5, 안방 욕실, 거실과 나뉜 주방 · 약 60평',
    build: () => {
      let p = { ...emptyPlan(), name: '5룸 대형 아파트 (60평)', floorColor: '#a7835f' }
      p = rect(p, 0, 0, 1600, 1240) // 198.4 m² ≈ 60평. wall1 위, wall2 오른쪽, wall3 아래, wall4 왼쪽
      p = addWall(p, { x: 500, y: 0 }, { x: 500, y: 1240 }) // wall5: 왼쪽 방들 | 거실·주방
      p = addWall(p, { x: 0, y: 620 }, { x: 500, y: 620 }) // wall6: 방1(안방) | 방2
      p = addWall(p, { x: 1100, y: 0 }, { x: 1100, y: 1240 }) // wall7: 거실·주방 | 오른쪽 방들
      p = addWall(p, { x: 1100, y: 420 }, { x: 1600, y: 420 }) // wall8: 방3 | 방4
      p = addWall(p, { x: 1100, y: 830 }, { x: 1600, y: 830 }) // wall9: 방4 | 방5
      p = addWall(p, { x: 220, y: 400 }, { x: 220, y: 620 }) // wall10: 안방 욕실 오른쪽
      p = addWall(p, { x: 0, y: 400 }, { x: 220, y: 400 }) // wall11: 안방 욕실 위
      // 거실 | 주방: 벽으로 나누고 가운데 2m(x 700~900)는 트인 통로로 둔다
      p = addWall(p, { x: 500, y: 700 }, { x: 700, y: 700 }) // wall12
      p = addWall(p, { x: 900, y: 700 }, { x: 1100, y: 700 }) // wall13
      // 문 (현관을 먼저 넣어야 걷기가 현관에서 시작한다)
      p = addOpening(p, 'wall3', 0.5, 'door') // 현관 (x=800)
      p = addOpening(p, 'wall5', 540 / 1240, 'door') // 방1
      p = addOpening(p, 'wall5', 780 / 1240, 'door') // 방2 (주방 쪽으로 나온다)
      p = addOpening(p, 'wall7', 330 / 1240, 'door') // 방3
      p = addOpening(p, 'wall7', 520 / 1240, 'door') // 방4
      p = addOpening(p, 'wall7', 930 / 1240, 'door') // 방5
      p = addOpening(p, 'wall10', 0.5, 'door') // 안방 욕실
      // 창문
      p = addOpening(p, 'wall1', 250 / 1600, 'window') // 방1
      p = addOpening(p, 'wall1', 600 / 1600, 'window') // 거실
      p = addOpening(p, 'wall1', 1000 / 1600, 'window') // 거실
      p = addOpening(p, 'wall1', 1350 / 1600, 'window') // 방3
      p = addOpening(p, 'wall2', 625 / 1240, 'window') // 방4
      p = addOpening(p, 'wall2', 1035 / 1240, 'window') // 방5
      p = addOpening(p, 'wall4', 0.25, 'window') // 방2 (y=930)
      p = addOpening(p, 'wall3', 1350 / 1600, 'window') // 방2 (x=250)
      // 방1 안방 (0~500, 0~620)
      p = put(p, 'bed', 250, 120)
      p = put(p, 'wardrobe', 467, 150, 90)
      p = put(p, 'wardrobe', 467, 270, 90)
      p = put(p, 'desk', 340, 580)
      p = put(p, 'chair', 340, 525)
      p = put(p, 'rug', 250, 330)
      p = put(p, 'bookshelf', 20, 300, 270)
      // 안방 욕실 (0~220, 400~620)
      p = put(p, 'tile', 110, 510, 0, { w: 210, d: 210 })
      p = put(p, 'toilet', 38, 460, 270)
      p = put(p, 'basin', 150, 428)
      p = put(p, 'bathtub', 110, 578)
      // 방2 (0~500, 620~1240)
      p = put(p, 'bed', 110, 745)
      p = put(p, 'wardrobe', 330, 655)
      p = put(p, 'desk', 330, 1200)
      p = put(p, 'chair', 330, 1145)
      // 거실 (500~1100, 0~700)
      p = put(p, 'tv', 800, 25)
      p = put(p, 'rug', 800, 280)
      p = put(p, 'table', 800, 290)
      p = put(p, 'sofa', 800, 480, 180)
      p = put(p, 'bookshelf', 520, 150, 270)
      p = put(p, 'bookshelf', 1080, 150, 90)
      // 주방·식당 (500~1100, 700~1240)
      p = put(p, 'floortile', 800, 970, 0, { w: 590, d: 530 }) // 주방 바닥은 타일로 거실과 구분
      p = put(p, 'counter', 970, 1205, 180)
      p = put(p, 'fridge', 555, 1197, 180)
      p = put(p, 'dining', 800, 900)
      p = put(p, 'chair', 770, 835)
      p = put(p, 'chair', 830, 835)
      p = put(p, 'chair', 770, 965, 180)
      p = put(p, 'chair', 830, 965, 180)
      // 방3 (1100~1600, 0~420)
      p = put(p, 'bed', 1350, 120)
      p = put(p, 'desk', 1500, 385)
      p = put(p, 'chair', 1500, 330)
      // 방4 (1100~1600, 420~830)
      p = put(p, 'bed', 1480, 545)
      p = put(p, 'wardrobe', 1133, 700, 270)
      p = put(p, 'desk', 1300, 790)
      p = put(p, 'chair', 1300, 735)
      // 방5 (1100~1600, 830~1240)
      p = put(p, 'bed', 1480, 955)
      p = put(p, 'desk', 1250, 1200)
      p = put(p, 'chair', 1250, 1145)
      p = put(p, 'bookshelf', 1120, 1100, 270)
      return p
    },
  },
  {
    id: 'corridor', name: '복도형 아파트', desc: '20 × 9.92 m · 가운데 복도, 방 5, 욕실 2 · 약 60평',
    build: () => {
      let p = { ...emptyPlan(), name: '복도형 아파트 (60평)', floorColor: '#a7835f' }
      p = rect(p, 0, 0, 2000, 992) // 198.4 m² ≈ 60평. wall1 위, wall2 오른쪽, wall3 아래, wall4 왼쪽
      // 복도: 현관(왼쪽)에서 거실(오른쪽)까지 폭 1.6m (y 416~576)
      p = addWall(p, { x: 0, y: 416 }, { x: 1500, y: 416 }) // wall5: 복도 위쪽 벽
      p = addWall(p, { x: 0, y: 576 }, { x: 1500, y: 576 }) // wall6: 복도 아래쪽 벽
      p = addWall(p, { x: 1500, y: 0 }, { x: 1500, y: 416 }) // wall7: 방3 | 거실
      p = addWall(p, { x: 1500, y: 576 }, { x: 1500, y: 992 }) // wall8: 주방 | 거실
      p = addWall(p, { x: 480, y: 0 }, { x: 480, y: 416 }) // wall9: 방1 | 방2
      p = addWall(p, { x: 900, y: 0 }, { x: 900, y: 416 }) // wall10: 방2 | 공용 욕실
      p = addWall(p, { x: 1120, y: 0 }, { x: 1120, y: 416 }) // wall11: 공용 욕실 | 방3
      p = addWall(p, { x: 480, y: 576 }, { x: 480, y: 992 }) // wall12: 방4 | 안방
      p = addWall(p, { x: 1000, y: 576 }, { x: 1000, y: 992 }) // wall13: 안방 | 주방
      p = addWall(p, { x: 780, y: 776 }, { x: 780, y: 992 }) // wall14: 안방 욕실 왼쪽
      p = addWall(p, { x: 780, y: 776 }, { x: 1000, y: 776 }) // wall15: 안방 욕실 위
      // 문 (현관을 먼저 넣어야 걷기가 현관에서 복도를 보며 시작한다)
      p = addOpening(p, 'wall4', 0.5, 'door') // 현관 (복도 시작)
      p = addOpening(p, 'wall5', 380 / 1500, 'door') // 방1
      p = addOpening(p, 'wall5', 800 / 1500, 'door') // 방2
      p = addOpening(p, 'wall5', 1010 / 1500, 'door') // 공용 욕실
      p = addOpening(p, 'wall5', 1300 / 1500, 'door') // 방3
      p = addOpening(p, 'wall6', 380 / 1500, 'door') // 방4
      p = addOpening(p, 'wall6', 600 / 1500, 'door') // 안방
      p = addOpening(p, 'wall6', 1100 / 1500, 'door') // 주방 (복도 쪽)
      p = addOpening(p, 'wall8', 0.5, 'door') // 주방 → 거실
      p = addOpening(p, 'wall14', 0.5, 'door') // 안방 욕실
      // 창문
      p = addOpening(p, 'wall1', 240 / 2000, 'window') // 방1
      p = addOpening(p, 'wall1', 690 / 2000, 'window') // 방2
      p = addOpening(p, 'wall1', 1010 / 2000, 'window') // 공용 욕실
      p = addOpening(p, 'wall1', 1310 / 2000, 'window') // 방3
      p = addOpening(p, 'wall1', 1650 / 2000, 'window') // 거실
      p = addOpening(p, 'wall1', 1850 / 2000, 'window') // 거실
      p = addOpening(p, 'wall2', 0.5, 'window') // 거실
      p = addOpening(p, 'wall3', (2000 - 240) / 2000, 'window') // 방4
      p = addOpening(p, 'wall3', (2000 - 630) / 2000, 'window') // 안방
      p = addOpening(p, 'wall3', (2000 - 1250) / 2000, 'window') // 주방
      p = addOpening(p, 'wall3', (2000 - 1750) / 2000, 'window') // 거실
      p = addOpening(p, 'wall4', 792 / 992, 'window') // 방1 (y=200)
      p = addOpening(p, 'wall4', 192 / 992, 'window') // 방4 (y=800)
      // 방1 (0~480, 0~416)
      p = put(p, 'bed', 130, 118)
      p = put(p, 'wardrobe', 447, 150, 90)
      p = put(p, 'desk', 120, 381)
      p = put(p, 'chair', 120, 326)
      // 방2 (480~900, 0~416)
      p = put(p, 'bed', 600, 118)
      p = put(p, 'desk', 800, 35, 180)
      p = put(p, 'chair', 800, 92, 180)
      p = put(p, 'bookshelf', 880, 300, 90)
      // 공용 욕실 (900~1120, 0~416)
      p = put(p, 'tile', 1010, 208, 0, { w: 210, d: 406 })
      p = put(p, 'bathtub', 1010, 45)
      p = put(p, 'toilet', 1081, 150, 90)
      p = put(p, 'basin', 928, 250, 270)
      // 방3 (1120~1500, 0~416)
      p = put(p, 'bed', 1220, 118)
      p = put(p, 'desk', 1420, 35, 180)
      p = put(p, 'chair', 1420, 92, 180)
      // 방4 (0~480, 576~992)
      p = put(p, 'bed', 130, 884, 180)
      p = put(p, 'wardrobe', 33, 660, 270)
      p = put(p, 'desk', 445, 800, 270)
      p = put(p, 'chair', 388, 800, 270)
      // 안방 (480~1000, 576~992) + 안방 욕실 (780~1000, 776~992)
      p = put(p, 'bed', 592, 860, 270)
      p = put(p, 'wardrobe', 860, 609)
      p = put(p, 'tile', 890, 884, 0, { w: 210, d: 206 })
      p = put(p, 'toilet', 961, 830, 90)
      p = put(p, 'basin', 830, 964, 180)
      // 주방 (1000~1500, 576~992)
      p = put(p, 'floortile', 1250, 784, 0, { w: 490, d: 406 })
      p = put(p, 'counter', 1250, 957, 180)
      p = put(p, 'fridge', 1450, 619)
      p = put(p, 'dining', 1200, 770)
      p = put(p, 'chair', 1170, 705)
      p = put(p, 'chair', 1230, 705)
      p = put(p, 'chair', 1170, 835, 180)
      p = put(p, 'chair', 1230, 835, 180)
      // 거실 (1500~2000, 0~992): 복도 끝에서 바로 이어진다
      p = put(p, 'tv', 1975, 300, 90)
      p = put(p, 'rug', 1810, 300, 90)
      p = put(p, 'table', 1810, 300, 90)
      p = put(p, 'sofa', 1640, 300, 270)
      p = put(p, 'bookshelf', 1980, 800, 90)
      p = put(p, 'rug', 1760, 800)
      p = put(p, 'table', 1760, 800)
      return p
    },
  },
  {
    id: 'empty', name: '빈 방', desc: '5 × 4 m · 문 하나',
    build: () => {
      let p = { ...emptyPlan(), name: '빈 방' }
      p = rect(p, 0, 0, 500, 400)
      p = addOpening(p, 'wall3', 0.8, 'door')
      return p
    },
  },
]

export const findTemplate = (id: string) => TEMPLATES.find((t) => t.id === id)
