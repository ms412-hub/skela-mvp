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
