// "딸려옴" 측정 도구 자체가 맞게 동작하는지 확인한다 (측정값의 개선 목표는 이후 단계에서 추가)
// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { deformSkin } from '../src/meshSkin.ts'
import { loadChars, setup, regions, runAll, CASES } from './leakBench.mts'

const chars = loadChars()
const girl = chars.find((c) => c.name === 'girl')!

test('측정 자료: 캐릭터 10종이 관절 17개와 윤곽 마스크를 가진다', () => {
  assert.equal(chars.length, 10)
  for (const c of chars) {
    assert.equal(c.pts.size, 17, c.name)
    assert.equal(c.mask.data.length, c.w * c.h)
    assert.ok(c.mask.data.some((v) => v === 1), c.name + ' 윤곽이 비어 있으면 안 됨')
  }
})

test('부위 판정: 정면 캐릭터에서 머리·몸통·양발·양정강이 영역이 모두 잡히고, 한 점이 두 다리에 동시에 속하지 않는다', () => {
  const s = setup(girl)
  const r = regions(girl, s.sk, s.chains)
  for (const k of ['head', 'body', 'legL:foot', 'legR:foot', 'legL:shin', 'legR:shin']) assert.ok(r[k].length > 5, `${k}: ${r[k].length}`)
  const left = new Set([...r['legL:foot'], ...r['legL:shin']])
  assert.ok(![...r['legR:foot'], ...r['legR:shin']].some((k) => left.has(k)))
})

test('아무것도 움직이지 않으면 모든 부위의 이동량은 0이다 (측정 잡음 없음)', () => {
  const s = setup(girl)
  const r = regions(girl, s.sk, s.chains)
  const pos = new Float32Array(s.sk.rest.length), idx = new Uint32Array(s.sk.index.length)
  deformSkin(s.sk, {}, pos, idx)
  for (const ks of Object.values(r)) for (const k of ks) assert.ok(Math.hypot(pos[k * 3] - s.sk.rest[k * 3], pos[k * 3 + 1] - s.sk.rest[k * 3 + 1]) < 1e-3)
})

test('동작은 실제로 적용된다: 움직인 다리의 발은 크게 움직인다', () => {
  const s = setup(girl)
  const r = regions(girl, s.sk, s.chains)
  const cs = CASES.find((c) => c.name === 'legR 바깥으로 30°')!
  const a = cs.pick(s, girl)
  assert.ok(Math.abs(a.legR_up ?? 0) > 5, '자세 제한 후에도 다리가 움직여야 한다')
  const pos = new Float32Array(s.sk.rest.length), idx = new Uint32Array(s.sk.index.length)
  deformSkin(s.sk, a, pos, idx)
  const own = r['legR:foot'].map((k) => Math.hypot(pos[k * 3] - s.sk.rest[k * 3], pos[k * 3 + 1] - s.sk.rest[k * 3 + 1]))
  assert.ok(Math.min(...own) > 20, `움직인 발의 최소 이동량 ${Math.min(...own).toFixed(1)}px`)
})

test('전체 측정이 모든 캐릭터·동작에 대해 값을 낸다', () => {
  const rows = runAll(chars)
  assert.equal(rows.length, chars.length * (4 * 2 + 2 * 2)) // 다리 동작 4개×2부위 + 팔 동작 2개×2부위
  assert.ok(rows.every((r) => Number.isNaN(r.p95) || r.p95 >= 0))
})
