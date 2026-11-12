import { useEffect, useRef, useState } from 'react'
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import RigView from './RigView'

const MP_VERSION = '1.2.0'
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

// 뼈대에 쓸 13개 관절 (id는 MediaPipe 번호)
const JOINTS = [
  { id: 0, name: '코' },
  { id: 11, name: '왼쪽 어깨' },
  { id: 12, name: '오른쪽 어깨' },
  { id: 13, name: '왼쪽 팔꿈치' },
  { id: 14, name: '오른쪽 팔꿈치' },
  { id: 15, name: '왼쪽 손목' },
  { id: 16, name: '오른쪽 손목' },
  { id: 23, name: '왼쪽 골반' },
  { id: 24, name: '오른쪽 골반' },
  { id: 25, name: '왼쪽 무릎' },
  { id: 26, name: '오른쪽 무릎' },
  { id: 27, name: '왼쪽 발목' },
  { id: 28, name: '오른쪽 발목' },
]

// 연결선 (관절 id 쌍)
const LINES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
]

type Pt = { id: number; name: string; x: number; y: number }

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const originalRef = useRef<Pt[] | null>(null) // 되돌리기용 원래 추정값
  const dragIdRef = useRef<number | null>(null)

  const [hasImage, setHasImage] = useState(false)
  const [status, setStatus] = useState('')
  const [pts, setPts] = useState<Pt[] | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [mode, setMode] = useState<'edit' | 'rig'>('edit')

  function drawBase() {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(imgRef.current!, 0, 0, canvas.width, canvas.height)
    return ctx
  }

  // 점이나 선택 상태가 바뀔 때마다 다시 그림
  useEffect(() => {
    if (!imgRef.current) return
    const ctx = drawBase()
    if (!pts) return

    const byId = new Map(pts.map((p) => [p.id, p]))

    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(109, 74, 255, 0.9)'
    for (const [a, b] of LINES) {
      const pa = byId.get(a)!
      const pb = byId.get(b)!
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(pb.x, pb.y)
      ctx.stroke()
    }

    for (const p of pts) {
      const isSel = p.id === selected
      ctx.beginPath()
      ctx.arc(p.x, p.y, isSel ? 9 : 6, 0, Math.PI * 2)
      ctx.fillStyle = isSel ? '#ffd23f' : '#3ddc84'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#000'
      ctx.stroke()
    }
  }, [pts, selected])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current!
      const maxSize = 1024
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      imgRef.current = img
      drawBase()
      setHasImage(true)
      setPts(null)
      setSelected(null)
      setMode('edit')
      originalRef.current = null
      setStatus('')
    }
    img.src = url
  }

  async function getLandmarker() {
    if (landmarkerRef.current) return landmarkerRef.current
    setStatus('모델 불러오는 중... (처음 한 번만 걸려요)')
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
    landmarkerRef.current = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'IMAGE',
      numPoses: 1,
    })
    return landmarkerRef.current
  }

  async function detect() {
    if (!imgRef.current) return
    try {
      const landmarker = await getLandmarker()
      setStatus('관절 찾는 중...')
      const canvas = canvasRef.current!
      drawBase()
      const result = landmarker.detect(canvas)

      if (result.landmarks.length === 0) {
        setStatus('❌ 사람 몸을 찾지 못했어요. 전신 정면 그림으로 시도해보세요.')
        setPts(null)
        return
      }

      const lm = result.landmarks[0]
      const found: Pt[] = JOINTS.map((j) => ({
        ...j,
        x: lm[j.id].x * canvas.width,
        y: lm[j.id].y * canvas.height,
      }))
      originalRef.current = found.map((p) => ({ ...p }))
      setPts(found)
      setSelected(null)
      setStatus('✅ 점을 드래그해서 몸에 맞게 고쳐보세요')
    } catch (err) {
      console.error(err)
      setStatus('⚠️ 오류가 났어요. F12 → Console을 확인해주세요.')
    }
  }

  // 화면 좌표 → 캔버스 좌표
  function toCanvas(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
      ratio: canvas.width / rect.width,
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pts) return
    const { x, y, ratio } = toCanvas(e)
    const radius = 20 * ratio
    let best: Pt | null = null
    let bestDist = radius
    for (const p of pts) {
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < bestDist) {
        best = p
        bestDist = d
      }
    }
    if (best) {
      dragIdRef.current = best.id
      setSelected(best.id)
      setStatus(`선택: ${best.name}`)
      e.currentTarget.setPointerCapture(e.pointerId)
    } else {
      setSelected(null)
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const id = dragIdRef.current
    if (id === null || !pts) return
    const { x, y } = toCanvas(e)
    const canvas = canvasRef.current!
    const cx = Math.min(Math.max(x, 0), canvas.width)
    const cy = Math.min(Math.max(y, 0), canvas.height)
    setPts(pts.map((p) => (p.id === id ? { ...p, x: cx, y: cy } : p)))
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    dragIdRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  function resetPoints() {
    if (!originalRef.current) return
    setPts(originalRef.current.map((p) => ({ ...p })))
    setSelected(null)
    setStatus('원래 추정값으로 되돌렸어요')
  }

  function clearPoints() {
    setPts(null)
    setSelected(null)
    setMode('edit')
    originalRef.current = null
    setStatus('')
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>스켈라 Skela</strong>
        <span>MVP</span>
      </header>

      <main className="stage">
        <div className="canvas-wrap" style={{ display: mode === 'edit' ? 'block' : 'none' }}>
          {!hasImage && <p className="hint">캐릭터 이미지를 올려주세요</p>}
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        </div>

        {mode === 'rig' && pts && imgRef.current && canvasRef.current && (
          <RigView
            img={imgRef.current}
            width={canvasRef.current.width}
            height={canvasRef.current.height}
            pts={pts}
            onPtsLoad={setPts}
          />
        )}
      </main>

      <footer className="bottombar">
        <label className="btn">
          이미지 선택
          <input type="file" accept="image/*" onChange={handleFile} hidden />
        </label>
        <button className="btn" onClick={detect} disabled={!hasImage}>
          관절 추정
        </button>
        <button className="btn ghost" onClick={resetPoints} disabled={!pts}>
          원래 추정값으로
        </button>
        <button className="btn ghost" onClick={clearPoints} disabled={!pts}>
          점 지우기
        </button>
        <button
          className="btn"
          onClick={() => setMode(mode === 'edit' ? 'rig' : 'edit')}
          disabled={!pts}
        >
          {mode === 'edit' ? '리그 보기 →' : '← 점 편집으로'}
        </button>
        <span className="status">{status}</span>
      </footer>
    </div>
  )
}
