// 떨림(Z-파이팅) 방지: 한 가구 안의 두 상자가 같은 평면에 같은 방향의 면을 겹쳐 가지면
// 화면이 어느 쪽을 그릴지 매 프레임 바뀌며 지글거린다. 그런 면이 없어야 한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CATALOG, type BoxSpec } from '../src/interior/catalog.ts'
import { inflate } from '../src/interior/geometry.ts'

const EPS = 0.05 // 이보다 가까운 두 면은 같은 평면으로 본다 (화면 깊이 정밀도 기준)
type R = { lo: number[]; hi: number[] } // 축 0=x, 1=y, 2=z
const range = (b: BoxSpec): R => ({ lo: [b.x - b.w / 2, b.y, b.z - b.d / 2], hi: [b.x + b.w / 2, b.y + b.h, b.z + b.d / 2] })
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 1e-6

export function coplanarFaces(boxes: BoxSpec[]): string[] {
  const out: string[] = []
  const rs = boxes.map(range)
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    for (let ax = 0; ax < 3; ax++) {
      const [u, v] = [0, 1, 2].filter((k) => k !== ax)
      const share = overlap(rs[i].lo[u], rs[i].hi[u], rs[j].lo[u], rs[j].hi[u]) && overlap(rs[i].lo[v], rs[i].hi[v], rs[j].lo[v], rs[j].hi[v])
      if (!share) continue
      for (const side of ['lo', 'hi'] as const) {
        if (Math.abs(rs[i][side][ax] - rs[j][side][ax]) < EPS) out.push(`상자 ${i}·${j} ${'xyz'[ax]}축 ${side === 'lo' ? '-' : '+'}면`)
      }
    }
  }
  return out
}

for (const t of CATALOG) {
  test(`떨림 없음: ${t.name}`, () => {
    // 그리는 크기(inflate 뒤)로 검사한다. 원래 정의에는 겹침이 있어도 된다
    assert.deepEqual(coplanarFaces(t.boxes.map(inflate)), [])
  })
}

test('떨림 없음: 템플릿의 벽 모서리에서 만나는 벽들은 윗면 높이가 다르다', async () => {
  const { TEMPLATES } = await import('../src/interior/templates.ts')
  const { wallBoxes } = await import('../src/interior/geometry.ts')
  for (const t of TEMPLATES) {
    const p = t.build()
    const tops = p.walls.map((w) => Math.max(...wallBoxes(p, w).map((b) => b.cy + b.h / 2)))
    for (let i = 0; i < p.walls.length; i++) for (let j = i + 1; j < p.walls.length; j++) {
      const a = p.walls[i], b = p.walls[j]
      const meet = [a.a, a.b].some((q) => [b.a, b.b].some((r) => Math.hypot(q.x - r.x, q.y - r.y) < 1)) ||
        [a.a, a.b].some((q) => { const dx = b.b.x - b.a.x, dy = b.b.y - b.a.y, l2 = dx * dx + dy * dy; const u = ((q.x - b.a.x) * dx + (q.y - b.a.y) * dy) / l2; return u > 0 && u < 1 && Math.hypot(b.a.x + u * dx - q.x, b.a.y + u * dy - q.y) < 1 })
      if (meet) assert.ok(Math.abs(tops[i] - tops[j]) >= 0.05, `${t.name}: ${a.id}·${b.id} 윗면 높이가 같다`)
    }
  }
})
