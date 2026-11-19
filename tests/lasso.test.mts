// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { lassoPlan, ANCHOR_TO_PART } from '../src/character/lasso.ts'
import type { LassoPart } from '../src/character/lasso.ts'

const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
const lp = (anchor: string, front = true, name = 'p'): LassoPart => ({ name, poly: sq, anchor, front })
const all = new Set(['body', 'head', 'rightArm', 'rightForearm', 'rightHand', 'leftArm', 'leftForearm', 'leftHand', 'rightLeg', 'rightShin', 'rightFoot', 'leftLeg', 'leftShin', 'leftFoot'])

test('리그의 붙일 위치가 에디터 파츠 부모로 바뀐다', () => {
  const plan = lassoPlan([lp('armR_up'), lp('legL_lo'), lp('handR'), lp('head'), lp('chest'), lp('free')], all)
  assert.deepEqual(plan.map((p) => p.parent), ['rightArm', 'leftShin', 'rightHand', 'head', 'body', null])
  assert.deepEqual(plan.map((p) => p.id), ['lasso1', 'lasso2', 'lasso3', 'lasso4', 'lasso5', 'lasso6'])
})

test('리그의 모든 앵커가 표에 있다', () => {
  for (const k of ['handR', 'handL', 'footR', 'footL', 'armR_up', 'armR_lo', 'armL_up', 'armL_lo', 'legR_up', 'legR_lo', 'legL_up', 'legL_lo', 'head', 'chest', 'waist', 'free']) assert.ok(k in ANCHOR_TO_PART, k)
})

test('붙일 뼈가 없으면 Body, Body도 없으면 최상위. 모르는 앵커도 Body', () => {
  assert.equal(lassoPlan([lp('armR_up')], new Set(['body']))[0].parent, 'body')
  assert.equal(lassoPlan([lp('armR_up')], new Set())[0].parent, null)
  assert.equal(lassoPlan([lp('???')], all)[0].parent, 'body')
})

test('앞/뒤 순서와 이름', () => {
  const [a, b] = lassoPlan([lp('free', true, '소매'), lp('free', false, '')], all)
  assert.equal(a.z, 8)
  assert.equal(b.z, -1)
  assert.equal(a.name, '소매')
  assert.equal(b.name, 'Part2')
})
