// 인테리어 평면도 데이터와 편집 규칙 (화면 API 없음, 단독 테스트 가능)
//
// 단위: cm. 평면도 좌표는 x 오른쪽 +, y 아래쪽 + (화면과 같음).
// 상태는 불변 객체다. 바뀐 부분만 새 객체가 되어 되돌리기 이력(undoManager)에 그대로 쌓을 수 있다.
export type Vec = { x: number; y: number }
export type Wall = { id: string; a: Vec; b: Vec; thickness: number; height: number }
export type OpeningKind = 'door' | 'window'
// t: 벽 위의 위치(0~1, a→b), width: 폭, sill: 바닥에서 아래 끝까지 높이, height: 열린 부분의 높이
export type Opening = { id: string; wallId: string; t: number; width: number; kind: OpeningKind; sill: number; height: number }
export type Furniture = { id: string; type: string; x: number; y: number; rot: number; w: number; d: number; h: number; color: string }
export type Plan = { name: string; walls: Wall[]; openings: Opening[]; furniture: Furniture[]; floorColor: string; wallColor: string }

export const WALL_THICKNESS = 10
export const WALL_HEIGHT = 250
export const MIN_WALL = 20 // 이보다 짧은 벽은 만들지 않는다
export const DOOR = { width: 90, sill: 0, height: 205 }
export const WINDOW = { width: 120, sill: 90, height: 120 }

export const emptyPlan = (): Plan => ({ name: '내 방', walls: [], openings: [], furniture: [], floorColor: '#b58b5a', wallColor: '#e9e6df' })

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)
export const wallLength = (w: Wall) => dist(w.a, w.b)
export const snapTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v)
export const snapVec = (p: Vec, step: number): Vec => ({ x: snapTo(p.x, step), y: snapTo(p.y, step) })

// "wall3", "door12" 같은 id에서 다음 번호를 만든다
export function nextId(prefix: string, ids: string[]): string {
  let max = 0
  for (const id of ids) if (id.startsWith(prefix)) { const n = Number(id.slice(prefix.length)); if (Number.isInteger(n) && n > max) max = n }
  return prefix + (max + 1)
}

// 선분 ab에 점 p에서 가장 가까운 지점: 거리와 위치(0~1)
export function nearestOnSegment(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x, dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return { t, dist: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) }
}

export function nearestWall(plan: Plan, p: Vec, maxDist: number): { wall: Wall; t: number; dist: number } | null {
  let best: { wall: Wall; t: number; dist: number } | null = null
  for (const w of plan.walls) {
    const r = nearestOnSegment(p, w.a, w.b)
    if (r.dist <= maxDist && (!best || r.dist < best.dist)) best = { wall: w, t: r.t, dist: r.dist }
  }
  return best
}

/* ───── 편집 ───── */
export function addWall(plan: Plan, a: Vec, b: Vec): Plan {
  if (dist(a, b) < MIN_WALL) return plan
  const id = nextId('wall', plan.walls.map((w) => w.id))
  return { ...plan, walls: [...plan.walls, { id, a, b, thickness: WALL_THICKNESS, height: WALL_HEIGHT }] }
}

export function removeWall(plan: Plan, id: string): Plan {
  if (!plan.walls.some((w) => w.id === id)) return plan
  return { ...plan, walls: plan.walls.filter((w) => w.id !== id), openings: plan.openings.filter((o) => o.wallId !== id) }
}

const interval = (o: Opening, len: number) => ({ s0: o.t * len - o.width / 2, s1: o.t * len + o.width / 2 })

// 벽 안에 들어가게 위치를 고른다 (폭이 벽보다 길면 벽 길이에 맞춘다)
export function fitOpening(wall: Wall, o: Opening): Opening {
  const len = wallLength(wall)
  const width = Math.min(o.width, len)
  const half = width / 2
  const t = len === 0 ? 0.5 : Math.min(Math.max(o.t * len, half), len - half) / len
  return { ...o, width, t }
}

export function overlaps(plan: Plan, o: Opening): boolean {
  const wall = plan.walls.find((w) => w.id === o.wallId)
  if (!wall) return false
  const len = wallLength(wall), me = interval(o, len)
  return plan.openings.some((q) => q.id !== o.id && q.wallId === o.wallId && (() => { const it = interval(q, len); return me.s0 < it.s1 && it.s0 < me.s1 })())
}

// 문·창문 추가. 겹치거나 벽이 없으면 그대로 돌려준다
export function addOpening(plan: Plan, wallId: string, t: number, kind: OpeningKind): Plan {
  const wall = plan.walls.find((w) => w.id === wallId)
  if (!wall) return plan
  const d = kind === 'door' ? DOOR : WINDOW
  const o = fitOpening(wall, { id: nextId(kind, plan.openings.map((x) => x.id)), wallId, t, kind, ...d })
  if (overlaps(plan, o)) return plan
  return { ...plan, openings: [...plan.openings, o] }
}

export function updateOpening(plan: Plan, id: string, patch: Partial<Opening>): Plan {
  const cur = plan.openings.find((o) => o.id === id)
  const wall = cur && plan.walls.find((w) => w.id === cur.wallId)
  if (!cur || !wall) return plan
  const next = fitOpening(wall, { ...cur, ...patch })
  if (overlaps(plan, next)) return plan
  return { ...plan, openings: plan.openings.map((o) => (o.id === id ? next : o)) }
}

export function removeOpening(plan: Plan, id: string): Plan {
  return plan.openings.some((o) => o.id === id) ? { ...plan, openings: plan.openings.filter((o) => o.id !== id) } : plan
}

export function updateWall(plan: Plan, id: string, patch: Partial<Wall>): Plan {
  if (!plan.walls.some((w) => w.id === id)) return plan
  const walls = plan.walls.map((w) => (w.id === id ? { ...w, ...patch } : w))
  // 벽이 짧아져 문·창문이 벽 밖으로 나가면 다시 맞춘다
  const openings = plan.openings.map((o) => { const w = walls.find((x) => x.id === o.wallId); return w && o.wallId === id ? fitOpening(w, o) : o })
  return { ...plan, walls, openings }
}

export function addFurniture(plan: Plan, type: string, x: number, y: number, size: { w: number; d: number; h: number; color: string }): Plan {
  const id = nextId('furn', plan.furniture.map((f) => f.id))
  // 종류 정보 전체를 펼치지 않고 필요한 값만 가져온다 (펼치면 id가 종류 이름으로 덮인다)
  return { ...plan, furniture: [...plan.furniture, { id, type, x, y, rot: 0, w: size.w, d: size.d, h: size.h, color: size.color }] }
}

export function updateFurniture(plan: Plan, id: string, patch: Partial<Furniture>): Plan {
  if (!plan.furniture.some((f) => f.id === id)) return plan
  return { ...plan, furniture: plan.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)) }
}

export function removeFurniture(plan: Plan, id: string): Plan {
  return plan.furniture.some((f) => f.id === id) ? { ...plan, furniture: plan.furniture.filter((f) => f.id !== id) } : plan
}

// 가구가 차지하는 직사각형 안에 점이 있는지 (회전 고려)
export function pointInFurniture(f: Furniture, p: Vec): boolean {
  const r = (-f.rot * Math.PI) / 180
  const dx = p.x - f.x, dy = p.y - f.y
  const lx = Math.cos(r) * dx - Math.sin(r) * dy
  const ly = Math.sin(r) * dx + Math.cos(r) * dy
  return Math.abs(lx) <= f.w / 2 && Math.abs(ly) <= f.d / 2
}

export function planBounds(plan: Plan): { x0: number; y0: number; x1: number; y1: number } {
  const pts: Vec[] = plan.walls.flatMap((w) => [w.a, w.b])
  // 돌린 가구는 돌린 뒤의 네 모서리로 잰다 (90° 돌린 옷장이 벽 밖으로 잡히지 않게)
  for (const f of plan.furniture) {
    const r = (f.rot * Math.PI) / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r))
    const ex = (f.w / 2) * c + (f.d / 2) * s, ey = (f.w / 2) * s + (f.d / 2) * c
    pts.push({ x: f.x - ex, y: f.y - ey }, { x: f.x + ex, y: f.y + ey })
  }
  if (!pts.length) return { x0: 0, y0: 0, x1: 600, y1: 500 }
  return { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) }
}

/* ───── 저장/불러오기 (JSON) ───── */
export type PlanFile = { format: 'skela-interior-plan'; version: 1; plan: Plan }

export const toPlanFile = (plan: Plan): PlanFile => ({ format: 'skela-interior-plan', version: 1, plan })

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isVec = (v: unknown): v is Vec => !!v && isNum((v as Vec).x) && isNum((v as Vec).y)

// 형식이 틀리면 이유를 담아 throw한다. 알 수 없는 값은 걸러서 안전한 평면도만 돌려준다.
export function fromPlanFile(json: unknown): Plan {
  const f = json as PlanFile
  if (!f || f.format !== 'skela-interior-plan' || !f.plan || typeof f.plan !== 'object') throw new Error('스켈라 인테리어 평면도 파일이 아니에요.')
  if (f.version !== 1) throw new Error('지원하지 않는 버전의 평면도 파일이에요.')
  const p = f.plan
  const walls: Wall[] = (Array.isArray(p.walls) ? p.walls : []).filter((w) => w && typeof w.id === 'string' && isVec(w.a) && isVec(w.b) && isNum(w.thickness) && isNum(w.height) && w.thickness > 0 && w.height > 0)
  const wallIds = new Set(walls.map((w) => w.id))
  const openings: Opening[] = (Array.isArray(p.openings) ? p.openings : []).filter((o) => o && typeof o.id === 'string' && wallIds.has(o.wallId) && isNum(o.t) && isNum(o.width) && isNum(o.sill) && isNum(o.height) && (o.kind === 'door' || o.kind === 'window') && o.width > 0 && o.height > 0)
  const furniture: Furniture[] = (Array.isArray(p.furniture) ? p.furniture : []).filter((q) => q && typeof q.id === 'string' && typeof q.type === 'string' && isNum(q.x) && isNum(q.y) && isNum(q.rot) && isNum(q.w) && isNum(q.d) && isNum(q.h) && q.w > 0 && q.d > 0 && q.h > 0)
  const col = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d)
  return {
    name: typeof p.name === 'string' ? p.name : '내 방',
    walls, openings, furniture: furniture.map((q) => ({ ...q, color: col(q.color, '#c0c0c0') })),
    floorColor: col(p.floorColor, '#b58b5a'), wallColor: col(p.wallColor, '#e9e6df'),
  }
}
