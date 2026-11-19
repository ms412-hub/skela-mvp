// 실행: node --experimental-strip-types --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { extractImage, requestGeminiImage, FILL_PROMPT } from '../src/ai/geminiFill.ts'
import { markHole, compositeHole, createAiFill } from '../src/ai/aiFill.ts'
import type { ImageCodec } from '../src/ai/aiFill.ts'
import { fillHoleAsync } from '../src/inpainting.ts'

const B64 = 'A'.repeat(200) // 길이만 맞춘 가짜 base64
const solid = (w: number, h: number, c: [number, number, number]) => {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) d.set([...c, 255], i * 4)
  return d
}
const rect = (w: number, h: number, x0: number, y0: number, x1: number, y1: number) => {
  const m = new Uint8Array(w * h)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1
  return m
}
const px = (d: Uint8ClampedArray, i: number) => [...d.slice(i * 4, i * 4 + 3)]
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

test('markHole: 구멍만 마젠타로 칠하고 원본은 바꾸지 않는다', () => {
  const w = 10, h = 10
  const d = solid(w, h, [10, 20, 30])
  const m = rect(w, h, 3, 3, 6, 6)
  const out = markHole(d, m)
  assert.deepEqual(px(out, 4 * w + 4), [255, 0, 255])
  assert.deepEqual(px(out, 0), [10, 20, 30])
  assert.deepEqual(px(d, 4 * w + 4), [10, 20, 30], '원본 유지')
})

test('extractImage: 응답 모양이 달라도 이미지 데이터를 찾는다', () => {
  assert.equal(extractImage({ output_image: { data: B64 } })?.data, B64)
  assert.equal(extractImage({ candidates: [{ content: { parts: [{ text: 'x' }, { inlineData: { mimeType: 'image/png', data: B64 } }] } }] })?.mime, 'image/png')
  assert.equal(extractImage({ steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/jpeg', data: B64 }] }] })?.mime, 'image/jpeg')
  assert.equal(extractImage({ a: { mimeType: 'image/png', data: 'short' } }), null, '너무 짧은 데이터는 이미지가 아니다')
  assert.equal(extractImage({ text: 'hello' }), null)
  assert.equal(extractImage(null), null)
})

test('compositeHole: 구멍 안쪽만 복사하고 바깥은 그대로 둔다 (결과 크기가 달라도 맞춰 준다)', () => {
  const w = 20, h = 20
  const d = solid(w, h, [100, 100, 100])
  const m = rect(w, h, 5, 5, 15, 15)
  const res = solid(40, 40, [0, 200, 0]) // 2배 큰 결과
  assert.equal(compositeHole(d, m, w, h, res, 40, 40), true)
  assert.deepEqual(px(d, 10 * w + 10), [0, 200, 0])
  assert.deepEqual(px(d, 0), [100, 100, 100])
  assert.equal(d[(10 * w + 10) * 4 + 3], 255)
})

test('compositeHole: 비율이 다르거나 구멍이 마젠타 그대로면 거절하고 아무것도 바꾸지 않는다', () => {
  const w = 20, h = 20
  const m = rect(w, h, 5, 5, 15, 15)
  const a = solid(w, h, [100, 100, 100]), before = a.slice()
  assert.equal(compositeHole(a, m, w, h, solid(40, 20, [0, 200, 0]), 40, 20), false, '비율 불일치')
  assert.equal(compositeHole(a, m, w, h, solid(20, 20, [255, 0, 255]), 20, 20), false, '마젠타 그대로')
  assert.deepEqual([...a], [...before])
})

test('requestGeminiImage: interactions를 먼저 쓰고, Api-Revision 헤더는 보내지 않는다', async () => {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = []
  const f = (async (url: string, init: any) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    return reply({ output_image: { data: B64, mime_type: 'image/png' } })
  }) as unknown as typeof fetch
  const img = await requestGeminiImage({ apiKey: 'KEY', model: 'm1', fetchFn: f }, 'PNGDATA')
  assert.equal(img.data, B64)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.endsWith('/v1beta/interactions'))
  assert.equal(calls[0].headers['x-goog-api-key'], 'KEY')
  assert.ok(!Object.keys(calls[0].headers).some((k) => k.toLowerCase() === 'api-revision'), 'CORS가 거절하는 헤더는 보내지 않는다')
  assert.equal(calls[0].body.model, 'm1')
  assert.equal(calls[0].body.input[0].text, FILL_PROMPT)
  assert.equal(calls[0].body.input[1].data, 'PNGDATA')
  assert.deepEqual(calls[0].body.response_format, { type: 'image' })
})

test('requestGeminiImage: interactions가 404면 generateContent로 한 번 더 시도한다', async () => {
  const urls: string[] = []
  const f = (async (url: string, init: any) => {
    urls.push(url)
    if (url.endsWith('/interactions')) return reply({ error: 'not found' }, 404)
    const body = JSON.parse(init.body)
    assert.deepEqual(body.generationConfig.responseModalities, ['IMAGE'])
    return reply({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: B64 } }] } }] })
  }) as unknown as typeof fetch
  const img = await requestGeminiImage({ apiKey: 'K', model: 'x y', fetchFn: f }, 'P')
  assert.equal(img.data, B64)
  assert.equal(urls.length, 2)
  assert.ok(urls[1].includes('/models/x%20y:generateContent'))
})

test('requestGeminiImage: 키·권한·한도 오류(401/403/429)는 다시 시도하지 않고 이해하기 쉬운 메시지로 알린다', async () => {
  for (const [status, word] of [[403, '유료'], [401, 'API Key'], [429, '한도']] as const) {
    let n = 0
    const f = (async () => { n++; return reply({ error: 'x' }, status) }) as unknown as typeof fetch
    await assert.rejects(requestGeminiImage({ apiKey: 'K', fetchFn: f }, 'P'), (e: Error) => e.message.includes(word))
    assert.equal(n, 1)
  }
  await assert.rejects(requestGeminiImage({ apiKey: '', fetchFn: (() => { throw new Error('호출되면 안 됨') }) as unknown as typeof fetch }, 'P'), /API Key/)
})

const codec = (green: [number, number, number], rw?: number, rh?: number): ImageCodec => ({
  encodePng: async () => 'ENC',
  decode: async () => ({ data: solid(rw ?? 30, rh ?? 30, green), w: rw ?? 30, h: rh ?? 30 }),
})

test('createAiFill: 성공하면 구멍만 AI 결과로 바뀐다', async () => {
  const w = 30, h = 30
  const d = solid(w, h, [100, 100, 100])
  const m = rect(w, h, 10, 10, 20, 20)
  const f = (async () => reply({ output_image: { data: B64 } })) as unknown as typeof fetch
  const ok = await createAiFill({ apiKey: 'K', fetchFn: f, codec: codec([0, 200, 0]) })(d, m, w, h)
  assert.equal(ok, true)
  assert.deepEqual(px(d, 15 * w + 15), [0, 200, 0])
  assert.deepEqual(px(d, 0), [100, 100, 100])
})

test('createAiFill: 실패하면 false, 이유를 알리고, 그림은 그대로다', async () => {
  const w = 30, h = 30
  const d = solid(w, h, [100, 100, 100]), before = d.slice()
  const m = rect(w, h, 10, 10, 20, 20)
  const msgs: string[] = []
  const f403 = (async () => reply({ error: 'denied' }, 403)) as unknown as typeof fetch
  assert.equal(await createAiFill({ apiKey: 'K', fetchFn: f403, codec: codec([0, 200, 0]), onError: (s) => msgs.push(s) })(d, m, w, h), false)
  const fOk = (async () => reply({ output_image: { data: B64 } })) as unknown as typeof fetch
  assert.equal(await createAiFill({ apiKey: 'K', fetchFn: fOk, codec: codec([0, 200, 0], 60, 30), onError: (s) => msgs.push(s) })(d, m, w, h), false, '비율이 다른 결과')
  assert.equal(msgs.length, 2)
  assert.ok(msgs[0].includes('유료'))
  assert.deepEqual([...d], [...before])
})

test('fillHoleAsync: ai가 성공하면 그 결과를, 실패하면 기존 방식(patch)으로 채우고 AI의 중간 결과는 남기지 않는다', async () => {
  const w = 40, h = 40
  const stripes = () => { const d = solid(w, h, [30, 30, 220]); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.floor(x / 3) % 2) d.set([220, 30, 30, 255], (y * w + x) * 4); return d }
  const m = rect(w, h, 10, 10, 30, 30)
  const okImg = stripes()
  const r1 = await fillHoleAsync(okImg, m, w, h, { strategy: 'ai', aiFillAsync: async (p) => { p.fill(77); return true } })
  assert.equal(r1.strategy, 'ai')
  assert.equal(okImg[(15 * w + 15) * 4], 77)

  const failImg = stripes()
  const r2 = await fillHoleAsync(failImg, m, w, h, { strategy: 'ai', aiFillAsync: async (p) => { p.fill(77); return false } })
  assert.equal(r2.strategy, 'patch')
  assert.notEqual(failImg[(15 * w + 15) * 4], 77, 'AI가 실패했으면 그 중간 결과가 남으면 안 된다')

  const noHook = stripes()
  assert.equal((await fillHoleAsync(noHook, m, w, h, { strategy: 'ai' })).strategy, 'patch')
  const thrown = stripes()
  assert.equal((await fillHoleAsync(thrown, m, w, h, { strategy: 'ai', aiFillAsync: async () => { throw new Error('boom') } })).strategy, 'patch')
})
