// Gemini 이미지 편집 호출 (fetch만 사용, SDK 없음). 화면 API 없이 fetch를 주입받아 단독으로 테스트할 수 있다.
//
// 주의 (2026-11-19 문서 기준)
// - 이미지 편집 모델은 가격표상 유료 전용이다. 호출마다 비용이 든다.
// - 편집은 마스크 없이 "글 지시 + 이미지"만 받는다. 그래서 구멍 자리를 눈에 띄는 색으로 칠해서 보낸다 (aiFill.ts).
// - 문서의 /interactions 호출은 Api-Revision 헤더를 쓰지만, 이 헤더를 붙이면 브라우저 사전 요청(CORS)이 403으로 거절된다.
//   그래서 헤더 없이 /interactions를 먼저 시도하고, 안 되면 기존 generateContent 경로로 한 번 더 시도한다.
// - 응답의 정확한 JSON 모양은 문서에 없어서, 이미지 데이터를 모양에 상관없이 찾아낸다 (extractImage).
// - 실제 키로는 아직 호출해 보지 못했다 (테스트는 가짜 fetch로 한다).

export const GEMINI_FILL_MODEL = 'gemini-3.1-flash-lite-image' // 가격표에서 가장 싼 이미지 모델. 모델 이름은 바뀔 수 있어 화면에서 고칠 수 있다
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export const FILL_PROMPT =
  'This is a character illustration. A region is painted solid magenta (255,0,255). ' +
  'Repaint ONLY that magenta region so it looks like the natural continuation of the surrounding clothing, skin and background ' +
  '(same colors, textures, folds and line style). Do NOT change anything outside the magenta region. ' +
  'Keep the exact same image size, framing and composition. Output only the edited image.'

export type GeminiFillConfig = {
  apiKey: string
  model?: string
  fetchFn?: typeof fetch
  signal?: AbortSignal
}

// 응답 JSON 어디에 있든 base64 이미지 데이터를 찾는다
export function extractImage(json: unknown): { data: string; mime: string } | null {
  const seen = new Set<unknown>()
  const walk = (v: unknown): { data: string; mime: string } | null => {
    if (!v || typeof v !== 'object' || seen.has(v)) return null
    seen.add(v)
    const o = v as Record<string, unknown>
    const mime = (o.mime_type ?? o.mimeType) as unknown
    const data = (o.data ?? o.bytesBase64Encoded) as unknown
    if (typeof data === 'string' && data.length > 100 && typeof mime === 'string' && mime.startsWith('image/')) return { data, mime }
    const oi = o.output_image as Record<string, unknown> | undefined
    if (oi && typeof oi.data === 'string' && oi.data.length > 100) return { data: oi.data, mime: typeof oi.mime_type === 'string' ? oi.mime_type : 'image/png' }
    for (const k of Object.keys(o)) {
      const r = walk(o[k])
      if (r) return r
    }
    return null
  }
  return walk(json)
}

async function call(f: typeof fetch, url: string, key: string, body: unknown, signal?: AbortSignal) {
  const res = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal,
  })
  const text = await res.text()
  let json: unknown = null
  try { json = JSON.parse(text) } catch { /* 본문이 JSON이 아님 */ }
  return { ok: res.ok, status: res.status, json, text }
}

// 구멍이 칠해진 PNG(base64)를 보내고, 편집된 이미지(base64)를 돌려받는다. 실패하면 이유를 담아 throw한다.
export async function requestGeminiImage(cfg: GeminiFillConfig, markedPngBase64: string): Promise<{ data: string; mime: string }> {
  if (!cfg.apiKey) throw new Error('Gemini API Key가 필요해요.')
  const f = cfg.fetchFn ?? fetch
  const model = cfg.model || GEMINI_FILL_MODEL
  const errors: string[] = []

  const a = await call(f, `${BASE}/interactions`, cfg.apiKey, {
    model,
    input: [{ type: 'text', text: FILL_PROMPT }, { type: 'image', mime_type: 'image/png', data: markedPngBase64 }],
    response_format: { type: 'image' },
  }, cfg.signal)
  if (a.ok) {
    const img = extractImage(a.json)
    if (img) return img
    errors.push('interactions: 응답에 이미지가 없어요')
  } else errors.push(`interactions ${a.status}`)
  if (a.status === 401 || a.status === 403 || a.status === 429) throw new Error(describe(a.status, a.text)) // 키·한도 문제는 다른 경로로 다시 해도 같다

  const b = await call(f, `${BASE}/models/${encodeURIComponent(model)}:generateContent`, cfg.apiKey, {
    contents: [{ parts: [{ text: FILL_PROMPT }, { inline_data: { mime_type: 'image/png', data: markedPngBase64 } }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  }, cfg.signal)
  if (b.ok) {
    const img = extractImage(b.json)
    if (img) return img
    errors.push('generateContent: 응답에 이미지가 없어요')
  } else errors.push(`generateContent ${b.status}`)
  throw new Error(`Gemini 이미지 편집 실패 (${errors.join(', ')}). ${b.ok ? '' : describe(b.status, b.text)}`.trim())
}

function describe(status: number, text: string) {
  if (status === 401 || status === 403) return `API Key가 올바르지 않거나 이 모델을 쓸 권한이 없어요 (${status}). 이미지 모델은 유료 결제가 필요할 수 있어요.`
  if (status === 429) return '요청 한도를 넘었어요 (429). 잠시 뒤에 다시 시도하세요.'
  return `${status} ${text.slice(0, 160)}`
}
