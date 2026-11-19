// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { capturePose, setKey, removeKey, sampleAt, applyPose, keyAt } from '../src/animation/Timeline.ts'
import type { EditorState } from '../src/character/CharacterModel.ts'

const st = (rot: number): EditorState => ({
  duration: 3, keys: [],
  parts: { rightArm: { position: { x: 60, y: 80 }, rotation: rot, scale: { x: 1, y: 1 }, pivot: { x: 10, y: 0 }, parent: null, z: 0, visible: true } },
})

test('0초 0° → 1초 45° → 2초 0°: 중간 시간은 보간된다', () => {
  let keys = setKey([], 0, capturePose(st(0)))
  keys = setKey(keys, 2, capturePose(st(0)))
  keys = setKey(keys, 1, capturePose(st(45)))
  assert.deepEqual(keys.map((k) => k.t), [0, 1, 2], '시간 순서대로 정렬')
  assert.equal(sampleAt(keys, 0.5)!.rightArm.rotation, 22.5)
  assert.equal(sampleAt(keys, 1)!.rightArm.rotation, 45)
  assert.equal(sampleAt(keys, 1.5)!.rightArm.rotation, 22.5)
  assert.equal(sampleAt(keys, 5)!.rightArm.rotation, 0, '마지막 키 이후는 마지막 포즈')
  assert.equal(sampleAt(keys, -1)!.rightArm.rotation, 0)
})

test('회전은 짧은 쪽으로 보간한다 (350° → 10°는 0°를 지난다)', () => {
  const keys = setKey(setKey([], 0, capturePose(st(350))), 1, capturePose(st(10)))
  const r = sampleAt(keys, 0.5)!.rightArm.rotation
  assert.ok(Math.abs(((r % 360) + 360) % 360) < 1e-9 || Math.abs(r - 360) < 1e-9, `${r}`)
})

test('같은 시간의 키는 바뀌고, 삭제할 수 있다', () => {
  let keys = setKey([], 1, capturePose(st(10)))
  keys = setKey(keys, 1, capturePose(st(20)))
  assert.equal(keys.length, 1)
  assert.equal(keyAt(keys, 1)!.pose.rightArm.rotation, 20)
  keys = removeKey(keys, 1)
  assert.equal(keys.length, 0)
  assert.equal(sampleAt(keys, 0), null)
})

test('applyPose: 위치·회전·크기만 바꾸고 pivot·부모는 그대로 둔다', () => {
  const s = applyPose(st(0), { rightArm: { x: 1, y: 2, rotation: 30, sx: 2, sy: 3 } })
  assert.deepEqual(s.parts.rightArm.position, { x: 1, y: 2 })
  assert.equal(s.parts.rightArm.rotation, 30)
  assert.deepEqual(s.parts.rightArm.pivot, { x: 10, y: 0 })
  assert.equal(applyPose(st(0), { nothing: { x: 0, y: 0, rotation: 0, sx: 1, sy: 1 } }).parts.rightArm.rotation, 0)
})
