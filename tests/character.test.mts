// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, decompose, invert, localMatrix, multiply, rotation, translate, scaling } from '../src/character/Transform.ts'
import {
  worldMatrices, pivotWorld, moveByWorld, setPivotKeepPlace, reparent, hitTest, drawOrder, updatePart,
  toPoseFile, applyPoseFile, isDescendant,
} from '../src/character/CharacterModel.ts'
import type { Character, EditorState, PartState } from '../src/character/CharacterModel.ts'
import { createHistory } from '../src/undoManager.ts'

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)
const closeP = (p: { x: number; y: number }, q: { x: number; y: number }, eps = 1e-6) => { close(p.x, q.x, eps); close(p.y, q.y, eps) }

const part = (o: Partial<PartState>): PartState => ({ position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, pivot: { x: 0, y: 0 }, parent: null, z: 0, visible: true, ...o })
// 로컬 좌표 = 원본 이미지 좌표. 원래 자세는 position = pivot.
// 몸(골반 (100,200)) → 오른팔(어깨 (60,80), 이미지 (50,80)부터 20×110) → 오른손(손목 (60,180), 이미지 (55,180)부터 10×20)
const makeState = (): EditorState => ({
  duration: 3, keys: [],
  parts: {
    body: part({ position: { x: 100, y: 200 }, pivot: { x: 100, y: 200 } }),
    rightArm: part({ parent: 'body', position: { x: 60, y: 80 }, pivot: { x: 60, y: 80 }, z: 2 }),
    rightHand: part({ parent: 'rightArm', position: { x: 60, y: 180 }, pivot: { x: 60, y: 180 }, z: 3 }),
  },
})
const char: Character = {
  name: 't', w: 200, h: 400, order: ['body', 'rightArm', 'rightHand'],
  defs: {
    body: { id: 'body', name: 'Body', w: 200, h: 400, image: null, alpha: null, origin: { x: 0, y: 0 } },
    rightArm: { id: 'rightArm', name: 'Right Arm', w: 20, h: 110, image: null, alpha: new Uint8Array(20 * 110).fill(255), origin: { x: 50, y: 80 } },
    rightHand: { id: 'rightHand', name: 'Right Hand', w: 10, h: 20, image: null, alpha: new Uint8Array(10 * 20).fill(255), origin: { x: 55, y: 180 } },
  },
}

test('Transform: 역행렬·분해가 맞다', () => {
  const m = multiply(multiply(translate(30, -5), rotation(37)), scaling(2, 0.5))
  const p = { x: 3, y: 7 }
  closeP(apply(invert(m), apply(m, p)), p)
  const d = decompose(m)
  close(d.rotation, 37); close(d.scale.x, 2); close(d.scale.y, 0.5); closeP(d.position, { x: 30, y: -5 })
})

test('Pivot: 팔은 어깨(pivot)를 중심으로 회전한다 (가운데가 아니라)', () => {
  const s = updatePart(makeState(), 'rightArm', { rotation: 90 })
  const W = worldMatrices(s)
  closeP(pivotWorld(s, 'rightArm', W), { x: 60, y: 80 }) // 어깨는 그대로
  // 팔 아래 끝(원래 (60,180))은 어깨를 중심으로 시계 방향 90° → (60-100, 80) = (-40, 80)
  closeP(apply(W.rightArm, { x: 60, y: 180 }), { x: -40, y: 80 })
})

test('부모/자식: 팔을 돌리면 손도 같이 돌고, 손목은 팔 끝에 붙어 있다', () => {
  const s0 = makeState()
  closeP(pivotWorld(s0, 'rightHand'), { x: 60, y: 180 })
  const s = updatePart(s0, 'rightArm', { rotation: 90 })
  closeP(pivotWorld(s, 'rightHand'), { x: -40, y: 80 })
  close(decompose(worldMatrices(s).rightHand).rotation, 90) // 손도 90° 돈다
  // 몸을 옮기면 팔·손이 모두 따라온다
  const s2 = moveByWorld(s0, 'body', { x: 7, y: -3 })
  closeP(pivotWorld(s2, 'rightHand'), { x: 67, y: 177 })
})

test('moveByWorld: 부모가 회전해 있어도 화면에서 민 만큼 정확히 움직인다', () => {
  const s = updatePart(makeState(), 'rightArm', { rotation: 90 })
  const before = pivotWorld(s, 'rightHand')
  const after = pivotWorld(moveByWorld(s, 'rightHand', { x: 10, y: 0 }), 'rightHand')
  closeP(after, { x: before.x + 10, y: before.y })
})

test('Pivot 옮기기: 그림은 제자리에 있고, 이후 회전은 새 pivot 중심이다', () => {
  const s0 = updatePart(makeState(), 'rightArm', { rotation: 30, scale: { x: 1.5, y: 0.8 } })
  const W0 = worldMatrices(s0)
  const s1 = setPivotKeepPlace(s0, 'rightArm', { x: 60, y: 130 })
  const W1 = worldMatrices(s1)
  for (const q of [{ x: 50, y: 80 }, { x: 70, y: 190 }]) closeP(apply(W1.rightArm, q), apply(W0.rightArm, q), 1e-6)
  closeP(pivotWorld(s1, 'rightHand', W1), pivotWorld(s0, 'rightHand', W0)) // 자식도 제자리
  const pv = pivotWorld(s1, 'rightArm', W1)
  closeP(pivotWorld(updatePart(s1, 'rightArm', { rotation: 80 }), 'rightArm'), pv) // 새 pivot은 회전해도 고정
})

test('부모 바꾸기: 월드 위치·회전은 유지되고, 자기 자식 밑으로는 못 간다', () => {
  const s0 = updatePart(makeState(), 'rightArm', { rotation: 45 })
  const W0 = worldMatrices(s0)
  const s1 = reparent(s0, 'rightHand', 'body')
  assert.equal(s1.parts.rightHand.parent, 'body')
  const W1 = worldMatrices(s1)
  for (const q of [{ x: 55, y: 180 }, { x: 65, y: 200 }]) closeP(apply(W1.rightHand, q), apply(W0.rightHand, q), 1e-6)
  // 이제 팔을 돌려도 손은 따라오지 않는다
  closeP(pivotWorld(updatePart(s1, 'rightArm', { rotation: 0 }), 'rightHand'), pivotWorld(s1, 'rightHand'))
  assert.equal(reparent(s0, 'body', 'rightHand'), s0, '순환 금지')
  assert.equal(reparent(s0, 'rightArm', 'rightArm'), s0)
  assert.ok(isDescendant(s0, 'rightHand', 'body'))
})

test('원래 자세에서는 모든 파츠가 단위행렬(원본 이미지 그대로)이다', () => {
  const W = worldMatrices(makeState())
  for (const id of ['body', 'rightArm', 'rightHand']) closeP(apply(W[id], { x: 17, y: 33 }), { x: 17, y: 33 })
})

test('클릭 판정: 위에 그려진 파츠가 먼저, 회전한 파츠도 정확히 잡힌다, 빈 곳은 통과', () => {
  const s = makeState()
  assert.equal(hitTest(char, s, { x: 60, y: 100 }), 'rightArm')
  assert.equal(hitTest(char, s, { x: 60, y: 185 }), 'rightHand', '손이 팔보다 위(z)')
  assert.equal(hitTest(char, s, { x: 150, y: 300 }), 'body')
  const r = updatePart(s, 'rightArm', { rotation: 90 })
  assert.equal(hitTest(char, r, { x: 10, y: 80 }), 'rightArm', '돌아간 팔 위치')
  assert.equal(hitTest(char, r, { x: 60, y: 120 }), 'body', '팔이 떠난 자리는 몸')
  const holes = { ...char, defs: { ...char.defs, rightArm: { ...char.defs.rightArm, alpha: new Uint8Array(20 * 110) } } }
  assert.equal(hitTest(holes, s, { x: 60, y: 100 }), 'body', '투명한 곳은 통과')
  assert.deepEqual(drawOrder(char, s), ['body', 'rightArm', 'rightHand'])
})

test('포즈 JSON: 저장하고 다시 불러오면 같은 포즈가 된다', () => {
  const s = updatePart(updatePart(makeState(), 'rightArm', { rotation: 35, position: { x: 61, y: 79 } }), 'rightHand', { scale: { x: 1.2, y: 1.2 } })
  const file = JSON.parse(JSON.stringify(toPoseFile(char, s)))
  assert.equal(file.parts.rightArm.rotation, 35)
  assert.equal(file.version, 2)
  assert.throws(() => applyPoseFile(makeState(), { ...file, version: 1 }), /이전 형식/)
  const back = applyPoseFile(makeState(), file)
  assert.equal(back.applied, 3)
  for (const id of ['body', 'rightArm', 'rightHand']) closeP(pivotWorld(back.state, id), pivotWorld(s, id), 1e-3)
  assert.throws(() => applyPoseFile(makeState(), { hello: 1 }), /포즈 파일이 아니/)
  const partial = applyPoseFile(makeState(), { ...file, parts: { rightArm: file.parts.rightArm, unknown: file.parts.body } })
  assert.equal(partial.applied, 1)
  assert.deepEqual(partial.skipped, ['unknown'])
})

test('되돌리기: 팔 회전 → 다리(몸) 이동 → 머리(손) 이동 → Undo/Redo, 바뀌지 않은 파츠는 객체를 공유한다', () => {
  const s0 = makeState()
  const h = createHistory(s0)
  const s1 = updatePart(s0, 'rightArm', { rotation: 20 })
  h.commit(s1)
  const s2 = moveByWorld(s1, 'body', { x: 5, y: 0 })
  h.commit(s2)
  const s3 = moveByWorld(s2, 'rightHand', { x: 0, y: 4 })
  h.commit(s3)
  assert.equal(s3.parts.body, s2.parts.body, '바뀌지 않은 파츠는 같은 객체 (복사 없음)')
  assert.equal(h.undo(), s2)
  assert.equal(h.undo(), s1)
  assert.equal(h.redo(), s2)
  assert.equal(h.present().parts.rightArm.rotation, 20)
})
