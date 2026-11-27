// Skela Room v2 시제품의 순수 계산 검사 (기존 144개와 별개로 추가)
import test from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATES } from '../src/interior/templates.ts'
import { planBounds, toPlanFile } from '../src/interior/Plan.ts'
import { inflate } from '../src/interior/geometry.ts'
import { CATALOG_V2, STAIRS, MAX_TYPES } from '../src/interior/v2/catalog2.ts'
import { buildBoxesV2, cutawayWalls } from '../src/interior/v2/scene2.ts'
import { makeCamera, orthoProject, sanitizeCamera, fitOrthoSpan, PRESET_ORDER, cameraBasis } from '../src/interior/v2/camera.ts'
import * as PR from '../src/interior/v2/project.ts'
import { outputSize, tiles, fileName, alphaBounds, mtlText, asciiName, toAssetMeters } from '../src/interior/v2/exportJob.ts'

const plan64 = () => TEMPLATES.find((t) => t.id === 'corridor64')!.build()

test('v2 목록: 기존 23종 + 계단 + 드레스룸 5종 + 세탁 2종, 모두 분류·팩이 있고 100종 이하', () => {
  assert.equal(CATALOG_V2.length, 31)
  assert.ok(CATALOG_V2.length <= MAX_TYPES)
  for (const t of CATALOG_V2) { assert.ok(t.category); assert.equal(t.pack, 'core_free') }
  assert.equal(CATALOG_V2.find((t) => t.id === 'stairs')!.category, 'architecture')
})

test('계단: 상자가 정의 크기 안에 있고, 그리는 크기에서 같은 평면에 겹치는 면이 없다', () => {
  for (const b of STAIRS.boxes) {
    assert.ok(Math.abs(b.x) + b.w / 2 <= STAIRS.w / 2 + 1e-9 && Math.abs(b.z) + b.d / 2 <= STAIRS.d / 2 + 1e-9 && b.y + b.h <= STAIRS.h + 1e-9)
  }
  const rs = STAIRS.boxes.map(inflate).map((b) => ({ lo: [b.x - b.w / 2, b.y, b.z - b.d / 2], hi: [b.x + b.w / 2, b.y + b.h, b.z + b.d / 2] }))
  const ov = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 1e-6
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) for (let ax = 0; ax < 3; ax++) {
    const [u, v] = [0, 1, 2].filter((k) => k !== ax)
    if (!(ov(rs[i].lo[u], rs[i].hi[u], rs[j].lo[u], rs[j].hi[u]) && ov(rs[i].lo[v], rs[i].hi[v], rs[j].lo[v], rs[j].hi[v]))) continue
    for (const s of ['lo', 'hi'] as const) assert.ok(Math.abs(rs[i][s][ax] - rs[j][s][ax]) >= 0.05, `계단 ${i}·${j} ${ax}축 ${s}`)
  }
})

test('v1 → v2 변환: 기존 평면도 파일은 1F 하나짜리 프로젝트가 되고 원본은 그대로', () => {
  const p = plan64()
  const file = toPlanFile(p)
  const before = JSON.stringify(file)
  const { project, migrated } = PR.fromAnyFile(file)
  assert.equal(migrated, true)
  assert.equal(project.floors.length, 1)
  assert.equal(project.floors[0].name, '1F')
  assert.equal(project.floors[0].plan.furniture.length, p.furniture.length)
  assert.deepEqual(project.cameras, [])
  assert.equal(project.floorGap, 260)
  assert.equal(JSON.stringify(file), before, '원본 파일 객체를 바꾸지 않는다')
})

test('층: 추가·복제·순서·이름·삭제(최소 1층 유지), 카메라는 첫 층으로 옮겨진다', () => {
  let p = PR.newProject(plan64())
  p = PR.addFloor(p)
  assert.equal(p.floors.length, 2)
  assert.equal(p.floors[1].name, '2F')
  assert.equal(p.floors[1].plan.furniture.length, 0, '새 층은 벽만 복사')
  assert.equal(p.floors[1].plan.walls.length, p.floors[0].plan.walls.length)
  assert.equal(p.currentFloorId, p.floors[1].id)
  assert.equal(PR.floorElevation(p, p.floors[1].id), 260)
  p = PR.duplicateFloor(p, 'floor1')
  assert.equal(p.floors.length, 3)
  assert.equal(p.floors[1].plan.furniture.length, p.floors[0].plan.furniture.length)
  p = PR.moveFloor(p, p.floors[2].id, -1)
  assert.equal(PR.renameFloor(p, 'floor1', p.floors[1].name), p, '같은 이름은 거부')
  p = PR.renameFloor(p, 'floor1', '지하')
  assert.equal(p.floors[0].name, '지하')
  const room = planBounds(p.floors[2].plan)
  p = PR.upsertCamera(p, makeCamera('iso', 'cam1', '아이소', p.floors[2].id, room))
  p = PR.removeFloor(p, p.floors[2].id)
  assert.equal(p.cameras[0].floorId, p.floors[0].id)
  p = PR.removeFloor(PR.removeFloor(p, p.floors[1].id), p.floors[0].id)
  assert.equal(p.floors.length, 1, '마지막 층은 지울 수 없다')
})

test('v2 파일 저장·불러오기 왕복과 망가진 카메라 보정', () => {
  let p = PR.newProject(plan64())
  p = PR.addFloor(p)
  const room = planBounds(p.floors[0].plan)
  p = PR.upsertCamera(p, makeCamera('interior', 'cam1', '', 'floor1', room))
  const back = PR.fromAnyFile(JSON.parse(JSON.stringify(PR.toProjectFile(p)))).project
  assert.equal(back.floors.length, 2)
  assert.equal(back.cameras.length, 1)
  assert.equal(back.cameras[0].name, '카메라 1', '빈 이름 보정')
  const bad = sanitizeCamera({ id: 'c', pos: { x: 0, y: 0, h: 100 }, target: { x: 0, y: 0, h: 100 }, fovDeg: 500, floorId: 'nope', output: { format: 'jpg', transparent: true, size: 'XL' } }, ['floor1'], new Set())!
  assert.equal(bad.fovDeg, 100)
  assert.equal(bad.floorId, 'floor1')
  assert.notDeepEqual(bad.pos, bad.target)
  assert.equal(bad.output.transparent, false, 'JPG는 투명 불가')
  assert.equal(bad.output.size, 'FHD')
  assert.throws(() => PR.fromAnyFile({ format: 'skela-room-project', version: 2, project: { floors: [] } }))
})

test('카메라 맞춤: 직교 프리셋은 방의 8개 모서리가 화면 안에, 각도가 정확하다', () => {
  const room = planBounds(plan64())
  for (const preset of PRESET_ORDER) {
    for (const aspect of ['16:9', '1:1', '9:16'] as const) {
      const c = makeCamera(preset, 'c', 'c', 'floor1', room, aspect)
      if (c.projection !== 'orthographic') continue
      for (const x of [room.x0, room.x1]) for (const y of [room.y0, room.y1]) for (const h of [0, 250]) {
        const q = orthoProject(c, { x, y, h })
        assert.ok(Math.abs(q.u) <= 1 && Math.abs(q.v) <= 1, `${preset} ${aspect} 모서리가 화면 밖`)
      }
      assert.ok(c.orthoSpan <= fitOrthoSpan(c, room) + 1e-6)
    }
  }
  const iso = makeCamera('iso', 'c', 'c', 'floor1', room)
  const f = cameraBasis(iso).forward
  assert.ok(Math.abs((Math.asin(-f[1]) * 180) / Math.PI - 35.264) < 0.01, '정등각 35.26°')
  const ill = makeCamera('illust', 'c', 'c', 'floor1', room)
  assert.ok(Math.abs((Math.asin(-cameraBasis(ill).forward[1]) * 180) / Math.PI - 26.565) < 0.01, '2:1 26.57°')
  const top = cameraBasis(makeCamera('top', 'c', 'c', 'floor1', room))
  assert.deepEqual(top.up.map((v) => Math.round(v)), [0, 0, -1], '탑다운: 화면 위 = 평면도 위')
})

test('벽 잘라내기: 남동쪽 카메라는 아래·오른쪽 바깥벽만 숨기고, 30cm 여유 안에서는 숨기지 않는다', () => {
  const p = TEMPLATES.find((t) => t.id === 'empty')!.build() // 5×4m, wall1 위, wall2 오른쪽, wall3 아래, wall4 왼쪽
  assert.deepEqual([...cutawayWalls(p, { x: 900, y: 900 })].sort(), ['wall2', 'wall3'])
  assert.deepEqual([...cutawayWalls(p, { x: 250, y: 200 })], [], '방 안에서는 숨기지 않는다')
  assert.deepEqual([...cutawayWalls(p, { x: 250, y: 420 })], [], '벽에서 20cm 바깥은 여유 구간')
})

test('상자 목록: 숨김·내보내기 제외 가구와 잘라낸 벽(그 벽의 문·창문 포함)이 빠진다', () => {
  const p = plan64()
  const f0 = p.furniture[0], f1 = p.furniture[1]
  const q = { ...p, furniture: p.furniture.map((f) => (f.id === f0.id ? { ...f, visible: false } : f.id === f1.id ? { ...f, exportable: false } : f)) }
  const view = buildBoxesV2(q)
  const exp = buildBoxesV2(q, { forExport: true })
  assert.ok(!view.some((b) => b.id.startsWith(f0.id + ':')))
  assert.ok(view.some((b) => b.id.startsWith(f1.id + ':')), '편집 화면에는 보인다')
  assert.ok(!exp.some((b) => b.id.startsWith(f1.id + ':')), '내보내기에서는 빠진다')
  const cut = buildBoxesV2(p, { hideWalls: new Set(['wall4']) })
  assert.ok(!cut.some((b) => b.kind === 'wall' && b.id.startsWith('wall4:')))
  assert.ok(!cut.some((b) => b.kind === 'door' && b.id.startsWith(p.openings.find((o) => o.wallId === 'wall4')!.id)), '현관 문짝도 같이 빠진다')
  const one = buildBoxesV2(p, { onlyFurniture: f0.id, rawSize: true })
  assert.ok(one.length > 0 && one.every((b) => b.id.startsWith(f0.id + ':')))
})

test('출력 크기·타일·파일 이름', () => {
  assert.deepEqual(outputSize('4K', '16:9'), { w: 3840, h: 2160 })
  assert.deepEqual(outputSize('FHD', '9:16'), { w: 1080, h: 1920 })
  assert.deepEqual(outputSize(9999, '1:1'), { w: 4096, h: 4096 })
  const ts = tiles(3840, 2160, 2048)
  assert.equal(ts.length, 4)
  assert.equal(ts.reduce((s, t) => s + t.w * t.h, 0), 3840 * 2160, '타일 넓이 합 = 전체')
  assert.ok(ts.every((t) => t.w <= 2048 && t.h <= 2048))
  assert.equal(fileName(['복도형 아파트 (64평)', '1F', 'a/b:c'], 'png'), '복도형-아파트-(64평)_1F_a_b_c.png')
})

test('투명 이미지 자르기 범위', () => {
  const w = 10, h = 8, data = new Array(w * h * 4).fill(0)
  assert.equal(alphaBounds(data, w, h), null)
  data[(3 * w + 4) * 4 + 3] = 255
  data[(5 * w + 6) * 4 + 3] = 255
  assert.deepEqual(alphaBounds(data, w, h, 1), { x: 3, y: 2, w: 5, h: 5 })
  assert.deepEqual(alphaBounds(data, w, h, 100), { x: 0, y: 0, w: 10, h: 8 }, '여백은 이미지 밖으로 안 나간다')
})

test('OBJ 재질과 이름, 3D 좌표 변환', () => {
  const t = mtlText([{ name: 'm_ffffff', color: '#ffffff' }, { name: 'm_ffffff', color: '#ffffff' }, { name: 'glass', color: '#000000', opacity: 0.35 }])
  assert.equal((t.match(/newmtl/g) || []).length, 2)
  assert.ok(t.includes('Kd 1.0000 1.0000 1.0000') && t.includes('d 0.350'))
  assert.equal(asciiName('침대 (furn1)'), 'furn1')
  assert.deepEqual(toAssetMeters(2200, 962, 250), [22, 2.5, 9.62])
})

test('ZIP: CRC32 값이 표준과 같고, 묶은 파일을 그대로 다시 꺼낼 수 있다(한글 이름 포함)', async () => {
  const { crc32, makeZip, readZip } = await import('../src/interior/v2/zip.ts')
  const enc = new TextEncoder()
  assert.equal(crc32(enc.encode('hello')), 0x3610a686)
  assert.equal(crc32(enc.encode('')), 0)
  const files = [{ name: '복도형_1F.glb', data: new Uint8Array([103, 108, 84, 70, 1, 2, 3]) }, { name: 'README.txt', data: enc.encode('1 = 1m') }]
  const z = makeZip(files)
  assert.deepEqual([...z.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04])
  const back = readZip(z)
  assert.deepEqual(back.map((f) => f.name), ['복도형_1F.glb', 'README.txt'])
  assert.deepEqual([...back[0].data], [...files[0].data])
  assert.equal(new TextDecoder().decode(back[1].data), '1 = 1m')
})

test('예시 4층 집: 층마다 다르게 꾸며지고, 가구가 벽·복도·서로를 침범하지 않는다', async () => {
  const { sampleProject } = await import('../src/interior/v2/sample.ts')
  const pr = sampleProject()
  assert.deepEqual(pr.floors.map((f) => f.name), ['1F', '2F', '3F', '4F'])
  const flat = new Set(['rug', 'tile', 'floortile', 'pendant', 'upper'])
  const box = (f: { x: number; y: number; w: number; d: number; rot: number }, shrink = 0) => {
    const turned = f.rot % 180 !== 0
    const ex = (turned ? f.d : f.w) / 2 - shrink, ey = (turned ? f.w : f.d) / 2 - shrink
    return { x0: f.x - ex, x1: f.x + ex, y0: f.y - ey, y1: f.y + ey }
  }
  const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
  const signatures = new Set<string>()
  for (const fl of pr.floors) {
    const items = fl.plan.furniture
    assert.ok(items.length >= 30, `${fl.name}: 가구 ${items.length}개`)
    signatures.add(items.map((f) => `${f.type}@${f.x},${f.y}`).sort().join('|'))
    for (const f of items) {
      const b = box(f)
      assert.ok(b.x0 >= 0 && b.x1 <= 2200 && b.y0 >= 0 && b.y1 <= 962, `${fl.name} ${f.type}(${f.x},${f.y}) 집 밖`)
      if (f.type === 'stairs') continue
      assert.ok(!hit(box(f, 1), { x0: 0, x1: 1760, y0: 404, y1: 558 }), `${fl.name} ${f.type}(${f.x},${f.y})가 복도를 막는다`)
      // 벽(두께 10)을 뚫지 않는다
      for (const w of fl.plan.walls) {
        const wb = { x0: Math.min(w.a.x, w.b.x) - 5, x1: Math.max(w.a.x, w.b.x) + 5, y0: Math.min(w.a.y, w.b.y) - 5, y1: Math.max(w.a.y, w.b.y) + 5 }
        assert.ok(!hit(box(f, 1), wb), `${fl.name} ${f.type}(${f.x},${f.y})가 ${w.id}를 뚫는다`)
      }
    }
    const solid = items.filter((f) => !flat.has(f.type))
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], c = solid[j]
      if ((a.type === 'table' || c.type === 'table') && (a.type === 'rug' || c.type === 'rug')) continue
      assert.ok(!hit(box(a, 2), box(c, 2)), `${fl.name}: ${a.type}(${a.x},${a.y}) ↔ ${c.type}(${c.x},${c.y}) 겹침`)
    }
  }
  assert.equal(signatures.size, 4, '네 층의 배치가 모두 다르다')
  // 2층 드레스룸: 복도 쪽 문은 없고, 안방과 사이 벽에 문이 있다. 다른 층은 그대로
  const doorsOn = (i: number, wall: string) => pr.floors[i].plan.openings.filter((o) => o.wallId === wall && o.kind === 'door')
  assert.equal(doorsOn(1, 'wall8').length, 0, '2층 드레스룸 복도 문 없음')
  assert.equal(doorsOn(1, 'wall13').length, 2, '2층 안방 벽: 입구 + 드레스룸 문')
  for (const i of [0, 2, 3]) { assert.equal(doorsOn(i, 'wall8').length, 1); assert.equal(doorsOn(i, 'wall13').length, 1) }
  // 싱크대(주방 조리대)는 층마다 한 곳까지 (4층 세탁실은 세탁기·건조기)
  for (const fl of pr.floors) assert.ok(fl.plan.furniture.filter((f) => f.type === 'counter').length <= 2 && new Set(fl.plan.furniture.filter((f) => f.type === 'counter').map((f) => f.y > 561 && f.x < 1400 ? 'kitchen' : 'other')).size <= 1, `${fl.name} 싱크대가 여러 곳`)
  assert.ok(pr.floors[3].plan.furniture.some((f) => f.type === 'washer') && pr.floors[3].plan.furniture.some((f) => f.type === 'dryer'), '4층 세탁실에 세탁기·건조기')
  // 식탁은 1층에만
  assert.ok(pr.floors[0].plan.furniture.some((f) => f.type === 'dining'), '1층에는 식탁이 있다')
  for (const fl of pr.floors.slice(1)) assert.ok(!fl.plan.furniture.some((f) => f.type === 'dining'), `${fl.name}에는 식탁이 없다`)
  assert.notEqual(pr.floors[1].plan.floorColor, pr.floors[2].plan.floorColor)
})

test('드레스룸 5종·세탁 2종: 정의 크기 안에 있고, 그리는 크기에서 같은 평면에 겹치는 면이 없다', async () => {
  const { DRESSING: D, LAUNDRY } = await import('../src/interior/v2/catalog2.ts')
  assert.equal(D.length, 5)
  const DRESSING = [...D, ...LAUNDRY]
  const ov = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 1e-6
  for (const t of DRESSING) {
    for (const b of t.boxes) assert.ok(Math.abs(b.x) + b.w / 2 <= t.w / 2 + 1e-9 && Math.abs(b.z) + b.d / 2 <= t.d / 2 + 1e-9 && b.y >= 0 && b.y + b.h <= t.h + 1e-9, `${t.name} 상자가 크기 밖`)
    const rs = t.boxes.map(inflate).map((b) => ({ lo: [b.x - b.w / 2, b.y, b.z - b.d / 2], hi: [b.x + b.w / 2, b.y + b.h, b.z + b.d / 2] }))
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) for (let ax = 0; ax < 3; ax++) {
      const [u, v] = [0, 1, 2].filter((k) => k !== ax)
      if (!(ov(rs[i].lo[u], rs[i].hi[u], rs[j].lo[u], rs[j].hi[u]) && ov(rs[i].lo[v], rs[i].hi[v], rs[j].lo[v], rs[j].hi[v]))) continue
      for (const s of ['lo', 'hi'] as const) assert.ok(Math.abs(rs[i][s][ax] - rs[j][s][ax]) >= 0.05, `${t.name} ${i}·${j} ${ax}축 ${s} 면 겹침`)
    }
  }
})
