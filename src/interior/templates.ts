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

function put(plan: Plan, type: string, x: number, y: number, rot = 0): Plan {
  const t = furnitureType(type)
  if (!t) return plan
  const p = addFurniture(plan, type, x, y, t)
  const id = p.furniture[p.furniture.length - 1].id
  return rot ? updateFurniture(p, id, { rot }) : p
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
    id: 'fiveroom', name: '5룸 대형 아파트', desc: '16 × 12.4 m · 방 5, 거실, 주방 · 약 60평',
    build: () => {
      let p = { ...emptyPlan(), name: '5룸 대형 아파트 (60평)', floorColor: '#a7835f' }
      p = rect(p, 0, 0, 1600, 1240) // 198.4 m² ≈ 60평. wall1 위, wall2 오른쪽, wall3 아래, wall4 왼쪽
      p = addWall(p, { x: 500, y: 0 }, { x: 500, y: 1240 }) // wall5: 왼쪽 방들 | 거실·주방
      p = addWall(p, { x: 0, y: 620 }, { x: 500, y: 620 }) // wall6: 방1(안방) | 방2
      p = addWall(p, { x: 1100, y: 0 }, { x: 1100, y: 1240 }) // wall7: 거실·주방 | 오른쪽 방들
      p = addWall(p, { x: 1100, y: 420 }, { x: 1600, y: 420 }) // wall8: 방3 | 방4
      p = addWall(p, { x: 1100, y: 830 }, { x: 1600, y: 830 }) // wall9: 방4 | 방5
      // 문 (현관을 먼저 넣어야 걷기가 현관에서 시작한다)
      p = addOpening(p, 'wall3', 0.5, 'door') // 현관 (x=800)
      p = addOpening(p, 'wall5', 540 / 1240, 'door') // 방1
      p = addOpening(p, 'wall5', 700 / 1240, 'door') // 방2
      p = addOpening(p, 'wall7', 330 / 1240, 'door') // 방3
      p = addOpening(p, 'wall7', 520 / 1240, 'door') // 방4
      p = addOpening(p, 'wall7', 930 / 1240, 'door') // 방5
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
      p = put(p, 'desk', 110, 580)
      p = put(p, 'chair', 110, 525)
      p = put(p, 'rug', 250, 380)
      p = put(p, 'bookshelf', 20, 400, 270)
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
