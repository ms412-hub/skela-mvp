// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHistory, shallowEqualRecord } from '../src/undoManager.ts'

test('되돌리기와 다시 실행이 순서대로 동작한다 (파츠 분리 → 팔 회전 → 다리 이동 → Undo)', () => {
  const h = createHistory('원본')
  h.commit('파츠 분리')
  h.commit('팔 회전')
  h.commit('다리 이동')
  assert.equal(h.undo(), '팔 회전') // 다리 이동 취소
  assert.equal(h.undo(), '파츠 분리')
  assert.equal(h.redo(), '팔 회전')
  assert.equal(h.present(), '팔 회전')
})

test('더 되돌릴 것이 없으면 null이고 상태는 그대로다', () => {
  const h = createHistory(1)
  assert.equal(h.undo(), null)
  assert.equal(h.redo(), null)
  assert.equal(h.present(), 1)
  assert.equal(h.canUndo(), false)
  assert.equal(h.canRedo(), false)
})

test('되돌린 뒤 새 작업을 하면 다시 실행 단계는 사라진다', () => {
  const h = createHistory('a')
  h.commit('b')
  h.commit('c')
  h.undo()
  assert.equal(h.canRedo(), true)
  h.commit('d')
  assert.equal(h.canRedo(), false)
  assert.equal(h.undo(), 'b')
})

test('같은 상태는 새 단계를 만들지 않는다', () => {
  const h = createHistory({ x: 1 }, { equals: (a, b) => a.x === b.x })
  assert.equal(h.commit({ x: 1 }), false)
  assert.equal(h.undoCount(), 0)
  assert.equal(h.commit({ x: 2 }), true)
  assert.equal(h.undoCount(), 1)
})

test('단계 수 한도를 넘으면 가장 오래된 단계부터 버린다', () => {
  const h = createHistory(0, { limit: 3 })
  for (let i = 1; i <= 10; i++) h.commit(i)
  assert.equal(h.undoCount(), 3)
  assert.equal(h.undo(), 9)
  assert.equal(h.undo(), 8)
  assert.equal(h.undo(), 7)
  assert.equal(h.undo(), null)
})

test('이미지를 복사하지 않고 같은 참조를 공유한다', () => {
  const big = { pixels: new Uint8Array(1000) } // 파츠 이미지를 흉내
  const h = createHistory({ parts: [big], angle: 0 })
  h.commit({ parts: [big], angle: 10 })
  h.commit({ parts: [big], angle: 20 })
  const back = h.undo()!
  assert.equal(back.parts[0], big) // 복사본이 아니라 같은 객체
})

test('reset은 이력을 비운다', () => {
  const h = createHistory(1)
  h.commit(2)
  h.reset(9)
  assert.equal(h.present(), 9)
  assert.equal(h.canUndo(), false)
})

test('shallowEqualRecord는 값이 같으면 같은 상태로 본다', () => {
  assert.equal(shallowEqualRecord({ a: 1, b: 2 }, { b: 2, a: 1 }), true)
  assert.equal(shallowEqualRecord({ a: 1 }, { a: 2 }), false)
  assert.equal(shallowEqualRecord({}, {}), true)
  assert.equal(shallowEqualRecord({ a: 1 }, {}), false)
})
