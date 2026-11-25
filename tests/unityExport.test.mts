import test from 'node:test'
import assert from 'node:assert/strict'
import { toUnityScene, walkStart } from '../src/interior/unityExport.ts'
import { TEMPLATES } from '../src/interior/templates.ts'
import { emptyPlan } from '../src/interior/Plan.ts'

test('유니티 장면: 모든 상자는 있는 묶음에 속한다', () => {
  for (const t of TEMPLATES) {
    const s = toUnityScene(t.build())
    const ids = new Set(s.groups.map((g) => g.id))
    assert.equal(ids.size, s.groups.length, '묶음 id 중복')
    for (const b of s.boxes) assert.ok(ids.has(b.group), `${b.id} → ${b.group} 없음`)
    for (const b of s.boxes) assert.ok(b.w > 0 && b.h > 0 && b.d > 0 && b.opacity > 0 && b.opacity <= 1, b.id)
  }
})

test('유니티 장면: 문짝과 유리가 들어가고, 창문 위아래 벽은 벽 묶음이다', () => {
  const s = toUnityScene(TEMPLATES[0].build()) // 원룸: 창문 1, 문 1
  assert.equal(s.boxes.filter((b) => b.kind === 'door').length, 1)
  const glass = s.boxes.filter((b) => b.kind === 'glass')
  assert.equal(glass.length, 1)
  assert.ok(glass[0].opacity < 1)
  const below = s.boxes.find((b) => b.id.includes(':window') && b.id.endsWith(':below'))
  assert.ok(below)
  assert.equal(s.groups.find((g) => g.id === below.group)?.kind, 'wall')
})

test('유니티 장면: JSON으로 바꿔도 그대로이고 형식 표시가 있다', () => {
  const s = toUnityScene(TEMPLATES[1].build())
  const back = JSON.parse(JSON.stringify(s))
  assert.deepEqual(back, s)
  assert.equal(back.format, 'skela-unity-scene')
  assert.equal(back.version, 1)
  assert.equal(back.ceiling.height, 250)
})

test('걷기 시작점: 문 안쪽에서 방 가운데를 본다', () => {
  const p = TEMPLATES[2].build() // 빈 방 5×4m, 아래 벽(y=400)에 문
  const s = walkStart(p)
  assert.ok(s.y < 400 && s.y > 300, `문 안쪽이어야 함: ${s.y}`)
  assert.equal(s.lookX, 250)
  assert.equal(s.lookY, 200)
  // 벽이 없어도 멈추지 않는다
  assert.ok(Number.isFinite(walkStart(emptyPlan()).x))
  assert.ok(toUnityScene(emptyPlan()).boxes.length >= 1)
})
