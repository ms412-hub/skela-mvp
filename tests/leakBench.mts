// "딸려옴" 측정 도구: 한 팔다리만 움직였을 때, 움직이면 안 되는 부위(반대쪽 발·정강이, 머리)가 몇 px 움직이는지 잰다.
// 앱(RigView)과 같은 설정으로 메시를 만들고, 앱처럼 자세 제한(projectPose)을 거친 각도로 변형한다.
// 실행(표 출력): node --experimental-strip-types tests/leakBench.mts
import { readFileSync } from 'node:fs'
import { buildSkin, deformSkin, makeBody, makeLimits, projectPose } from '../src/meshSkin.ts'
import type { RestChain, ForegroundMask } from '../src/meshSkin.ts'

type P = { x: number; y: number }
const CHAINS = [
  { key: 'armR', ids: [12, 14, 16], tip: 20, kind: 'arm' },
  { key: 'armL', ids: [11, 13, 15], tip: 19, kind: 'arm' },
  { key: 'legR', ids: [24, 26, 28], tip: 32, kind: 'leg' },
  { key: 'legL', ids: [23, 25, 27], tip: 31, kind: 'leg' },
] as const
// 앱과 같은 값 (RigView: armHW 30, legHW 40, HAND_EXTEND 45, FOOT_EXTEND 40, hwEnd 팔 ×1.2 / 다리 ×1.5)
const HW = { arm: 30, leg: 40 }
const EXT = { arm: 45, leg: 40 }
const HW_END = { arm: 36, leg: 60 }

export type Char = { name: string; w: number; h: number; pts: Map<number, P>; mask: ForegroundMask }

export function loadChars(): Char[] {
  const j = JSON.parse(readFileSync(new URL('./fixtures/leak-chars.json', import.meta.url), 'utf8'))
  return Object.entries(j.chars).map(([name, c]: [string, any]) => {
    const data = new Uint8Array(c.w * c.h)
    let i = 0, v = 0
    for (const n of c.mask as number[]) { if (v) data.fill(1, i, i + n); i += n; v ^= 1 }
    return { name, w: c.w, h: c.h, pts: new Map(c.points.map((p: any) => [p.id, { x: p.x, y: p.y }])), mask: { data, w: c.w, h: c.h } }
  })
}

const distSeg = (p: P, a: P, b: P) => {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

export function setup(c: Char) {
  const w2 = (p: P) => ({ x: p.x - c.w / 2, y: c.h / 2 - p.y })
  const get = (id: number) => w2(c.pts.get(id)!)
  const chains: RestChain[] = CHAINS.map((ch) => ({
    key: ch.key, a: get(ch.ids[0]), m: get(ch.ids[1]), e: get(ch.ids[2]),
    hw: HW[ch.kind], ext: EXT[ch.kind], tip: get(ch.tip), hwEnd: HW_END[ch.kind],
  }))
  const sk = buildSkin(chains, c.w, c.h, 12, makeBody(get), c.mask)
  const lim = makeLimits(get)
  return { sk, chains, lim, get }
}

// 부위 판정은 원래 자세 기준. 전경(캐릭터) 위의 정점만 센다 (배경은 움직여도 보이지 않음)
export function regions(c: Char, sk: ReturnType<typeof setup>['sk'], chains: RestChain[]) {
  const n = sk.rest.length / 3
  const fg = (x: number, y: number) => {
    const ix = Math.round(x + c.w / 2), iy = Math.round(c.h / 2 - y)
    return ix >= 0 && iy >= 0 && ix < c.w && iy < c.h && c.mask.data[iy * c.w + ix] === 1
  }
  const shY = Math.min(c.pts.get(11)!.y, c.pts.get(12)!.y)
  const arms = chains.filter((ch) => ch.key.startsWith('arm'))
  const legs = chains.filter((ch) => ch.key.startsWith('leg'))
  const hipY = Math.max(c.pts.get(23)!.y, c.pts.get(24)!.y)
  const out: Record<string, number[]> = { head: [], body: [] }
  for (const ch of legs) { out[ch.key + ':foot'] = []; out[ch.key + ':shin'] = [] }
  for (let k = 0; k < n; k++) {
    const p = { x: sk.rest[k * 3], y: sk.rest[k * 3 + 1] }
    if (!fg(p.x, p.y)) continue
    // 머리·머리카락: 어깨선 위에서, 팔 띠(팔 뼈에서 반폭+15px)를 뺀 곳
    const nearArm = arms.some((ch) => Math.min(distSeg(p, ch.a, ch.m), distSeg(p, ch.m, ch.e), distSeg(p, ch.e, ch.tip!)) <= ch.hw + 15)
    if (c.h / 2 - p.y < shY && !nearArm) out.head.push(k)
    // 몸통·옆머리·옷: 어깨선과 골반 사이에서 팔 띠(반폭+25px)를 뺀 곳. 팔을 들 때 끌려가면 안 되는 부분
    const farArm = arms.every((ch) => Math.min(distSeg(p, ch.a, ch.m), distSeg(p, ch.m, ch.e), distSeg(p, ch.e, ch.tip!)) > ch.hw + 25)
    const iy = c.h / 2 - p.y
    if (iy >= shY && iy <= hipY && farArm) out.body.push(k)
    // 다리: 더 가까운 다리 하나에만 속한다 (붙은 두 발에서 움직이는 발을 "반대쪽 발"로 잘못 세지 않게)
    const dLeg = legs.map((ch) => ({ ch, foot: distSeg(p, ch.e, ch.tip!), shin: distSeg(p, ch.m, ch.e) }))
    const own = dLeg.reduce((a, b) => (Math.min(a.foot, a.shin) <= Math.min(b.foot, b.shin) ? a : b))
    const other = dLeg.find((d) => d !== own)!
    const margin = 8 // 경계 바로 위의 점은 어느 쪽인지 애매하므로 세지 않는다
    if (Math.min(other.foot, other.shin) - Math.min(own.foot, own.shin) < margin) continue
    if (own.foot <= (own.ch.hwEnd ?? own.ch.hw)) out[own.ch.key + ':foot'].push(k)
    else if (own.shin <= own.ch.hw) out[own.ch.key + ':shin'].push(k)
  }
  return out
}

function disp(sk: ReturnType<typeof setup>['sk'], pos: Float32Array, idx: number[]) {
  if (!idx.length) return { p95: NaN, max: NaN }
  const d = idx.map((k) => Math.hypot(pos[k * 3] - sk.rest[k * 3], pos[k * 3 + 1] - sk.rest[k * 3 + 1])).sort((a, b) => a - b)
  return { p95: d[Math.min(d.length - 1, Math.floor(d.length * 0.95))], max: d[d.length - 1] }
}

export type Case = { name: string; mover: string; watch: string[]; pick: (s: ReturnType<typeof setup>, c: Char) => Record<string, number> }

// 같은 크기의 회전 두 방향 중 원하는 쪽(손발이 위로 / 다른 다리 쪽으로 / 바깥으로)을 고른다
function choose(s: ReturnType<typeof setup>, key: string, deg: number, score: (tip: P, rest: P) => number) {
  const ch = s.chains.find((c) => c.key === key)!
  let best: Record<string, number> = {}, bs = -Infinity
  for (const sgn of [1, -1]) {
    const a = projectPose(s.sk, s.chains, s.lim, {}, { [key + '_up']: sgn * deg })
    const th = ((a[key + '_up'] ?? 0) * Math.PI) / 180
    const v = { x: ch.tip!.x - ch.a.x, y: ch.tip!.y - ch.a.y }
    const tip = { x: ch.a.x + v.x * Math.cos(th) - v.y * Math.sin(th), y: ch.a.y + v.x * Math.sin(th) + v.y * Math.cos(th) }
    const sc = score(tip, ch.tip!)
    if (sc > bs) { bs = sc; best = a }
  }
  return best
}
const center = (s: ReturnType<typeof setup>) => (s.get(23).x + s.get(24).x) / 2

export const CASES: Case[] = [
  ...(['legR', 'legL'] as const).flatMap((leg) => {
    const other = leg === 'legR' ? 'legL' : 'legR'
    return [
      { name: `${leg} 안쪽으로 30°`, mover: leg, watch: [other + ':foot', other + ':shin'], pick: (s: any) => choose(s, leg, 30, (t, r) => Math.abs(r.x - center(s)) - Math.abs(t.x - center(s))) },
      { name: `${leg} 바깥으로 30°`, mover: leg, watch: [other + ':foot', other + ':shin'], pick: (s: any) => choose(s, leg, 30, (t, r) => Math.abs(t.x - center(s)) - Math.abs(r.x - center(s))) },
    ]
  }),
  ...(['armR', 'armL'] as const).map((arm) => ({
    name: `${arm} 들기 120°`, mover: arm, watch: ['head', 'body'], pick: (s: any) => choose(s, arm, 120, (t) => t.y),
  })),
]

export function runAll(chars = loadChars()) {
  const rows: { char: string; case: string; region: string; p95: number; max: number; moved: number }[] = []
  for (const c of chars) {
    const s = setup(c)
    const reg = regions(c, s.sk, s.chains)
    const pos = new Float32Array(s.sk.rest.length)
    const idx = new Uint32Array(s.sk.index.length)
    for (const cs of CASES) {
      const ang = cs.pick(s, c)
      deformSkin(s.sk, ang, pos, idx)
      const ch = s.chains.find((x) => x.key === cs.mover)!
      const moved = Math.abs(ang[cs.mover + '_up'] ?? 0) // 실제로 적용된 각도 (자세 제한 후)
      for (const r of cs.watch) {
        const d = disp(s.sk, pos, reg[r])
        rows.push({ char: c.name, case: cs.name, region: r, p95: d.p95, max: d.max, moved })
      }
      void ch
    }
  }
  return rows
}

// 실행: node --experimental-strip-types tests/leakBench.mts           → 표 + 기준선과 비교
//       node --experimental-strip-types tests/leakBench.mts --save    → 지금 값을 기준선으로 저장
if (import.meta.url === `file://${process.argv[1]}`) {
  const { existsSync, writeFileSync } = await import('node:fs')
  const baseUrl = new URL('./fixtures/leak-baseline.json', import.meta.url)
  const rows = runAll()
  const key = (r: { char: string; case: string; region: string }) => `${r.char}|${r.case}|${r.region}`
  const base: Record<string, number> = existsSync(baseUrl) ? JSON.parse(readFileSync(baseUrl, 'utf8')) : {}
  const f = (v: number) => (Number.isNaN(v) ? '  -  ' : v.toFixed(1).padStart(5))
  console.log('캐릭터'.padEnd(20) + '동작'.padEnd(18) + '지켜볼 부위'.padEnd(14) + '95%   (기준선)  최대')
  for (const r of rows) {
    const b = base[key(r)]
    const cmp = b === undefined || Number.isNaN(b) ? '        ' : `(${b.toFixed(1).padStart(5)})`
    console.log(r.char.padEnd(22) + r.case.padEnd(20) + r.region.padEnd(16) + f(r.p95) + ' ' + cmp + ' ' + f(r.max))
  }
  const by = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter((r) => pred(r) && !Number.isNaN(r.p95))
  const groups: [string, (r: (typeof rows)[number]) => boolean][] = [
    ['반대쪽 다리', (r) => r.region.includes(':')], ['머리', (r) => r.region === 'head'], ['몸통·옆머리', (r) => r.region === 'body'],
  ]
  console.log('\n요약 (95% 값의 평균 / 가장 나쁜 값)')
  for (const [name, pred] of groups) {
    const g = by(pred)
    const avg = g.reduce((a, r) => a + r.p95, 0) / g.length
    const bg = g.filter((r) => base[key(r)] !== undefined && !Number.isNaN(base[key(r)]))
    const bavg = bg.length ? bg.reduce((a, r) => a + base[key(r)], 0) / bg.length : NaN
    console.log(`  ${name.padEnd(8)} ${avg.toFixed(1).padStart(5)}px / ${Math.max(...g.map((r) => r.p95)).toFixed(1).padStart(5)}px` + (Number.isNaN(bavg) ? '' : `   (기준선 평균 ${bavg.toFixed(1)}px)`))
  }
  if (process.argv.includes('--save')) {
    writeFileSync(baseUrl, JSON.stringify(Object.fromEntries(rows.map((r) => [key(r), Math.round(r.p95 * 10) / 10])), null, 1))
    console.log('\n기준선을 저장했어요:', baseUrl.pathname)
  }
}
