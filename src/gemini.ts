// src/gemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai'

// 1. .env 환경변수 키를 최우선으로 가져오고, 없으면 사용자가 입력한 localStorage 키 사용
export function getApiKey(): string {
  const envKey = import.meta.env.VITE_GEMINI_API_KEY
  if (envKey && envKey !== 'AIzaSy...본인의 Gemini API 키 입력...') {
    return envKey
  }
  return localStorage.getItem('skela_gemini_api_key') || ''
}

export function setStoredApiKey(key: string) {
  localStorage.setItem('skela_gemini_api_key', key.trim())
}

// Canvas 이미지를 Base64 데이터 구조로 변환
function canvasToGenerativePart(canvas: HTMLCanvasElement) {
  const dataUrl = canvas.toDataURL('image/png')
  return {
    inlineData: {
      data: dataUrl.split(',')[1],
      mimeType: 'image/png',
    },
  }
}

// 2. Gemini API 0원 무료 호출 함수
export async function generateInpaintWithGemini(
  apiKey: string,
  originalCanvas: HTMLCanvasElement,
  guideCanvas: HTMLCanvasElement,
  promptText: string
): Promise<string> {
  if (!apiKey) {
    throw new Error('Gemini API Key가 필요합니다. .env 파일이나 입력창에 키를 넣어주세요.')
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  // 비전 무료 쿼터 지원 모델
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  const origPart = canvasToGenerativePart(originalCanvas)
  const guidePart = canvasToGenerativePart(guideCanvas)

  const prompt = `
    You are an expert anime character editor.
    Image 1 is the original character artwork.
    Image 2 is the skeletal pose guide.
    Task: Redraw the original character in Image 1 so that its body pose matches Image 2 exactly.
    Keep the character's face, outfit details, and identity completely intact.
    Additional instruction: ${promptText || 'Natural character pose editing'}
  `

  const result = await model.generateContent([prompt, origPart, guidePart])
  const response = await result.response
  return response.text()
}