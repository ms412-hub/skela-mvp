import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'

type PtLike = { id: number; x: number; y: number }
type Src = HTMLImageElement | HTMLCanvasElement

export type AssetItem = {
  id: number
  name: string
  orig: Src
  anchor: string
  scale: number
  offX: number
  offY: number
  rot: number
  flip: boolean
  front: boolean
  bgTol: number // 흰 배경 제거 강도 (0이면 사용 안 함)
}

// 소품을 붙일 수 있는 위치
export const ANCHORS = [
  { key: 'handR', label: '오른손', chain: 'armR' },
  { key: 'handL', label: '왼손', chain: 'armL' },
  { key: 'footR', label: '오른발', chain: 'legR' },
  { key: 'footL', label: '왼발', chain: 'legL' },
  { key: 'head', label: '머리', chain: '' },
  { key: 'chest', label: '가슴 (어깨 중앙)', chain: '' },
  { key: 'waist', label: '허리 (골반 중앙)', chain: '' },
] as const

const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI
const normDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
function rotv(x: number, y: number, d: number) {
  const c = Math.cos(toRad(d))
  const s = Math.sin(toRad(d))
  return { x: x * c - y * s, y: x * s + y * c }
}

function srcSize(s: Src) {
  const w = s instanceof HTMLImageElement ? s.naturalWidth || s.width : s.width
  const h = s instanceof HTMLImageElement ? s.naturalHeight || s.height : s.height
  return { w, h }
}

// 가장자리와 이어진 밝은 무채색(흰색, 회색, 체크무늬) 배경만 투명하게
function removeWhite(img: Src, tol: number): HTMLCanvasElement {
  const { w, h } = srcSize(img)
  const k = Math.min(1, 1024 / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k))
  c.height = Math.max(1, Math.round(h * k))
  const W = c.width
  const H = c.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H)
  const d = data.data

  const minV = 255 - tol * 2 // 이보다 밝고
  const isBg = (i: number) => {
    if (d[i + 3] < 10) return true
    const mx = Math.max(d[i], d[i + 1], d[i + 2])
    const mn = Math.min(d[i], d[i + 1], d[i + 2])
    return mx - mn <= 24 && mn >= minV // 색이 거의 없는(무채색) 픽셀
  }

  const seen = new Uint8Array(W * H)
  const stack: number[] = []
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const idx = y * W + x
    if (seen[idx] || !isBg(idx * 4)) return
    seen[idx] = 1
    stack.push(idx)
  }
  for (let x = 0; x < W; x++) {
    push(x, 0)
    push(x, H - 1)
  }
  for (let y = 0; y < H; y++) {
    push(0, y)
    push(W - 1, y)
  }
  while (stack.length) {
    const idx = stack.pop()!
    const x = idx % W
    const y = (idx - x) / W
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
  for (let idx = 0; idx < seen.length; idx++) {
    if (seen[idx]) d[idx * 4 + 3] = 0
  }
  ctx.putImageData(data, 0, 0)
  return c
}

/* ───────────── Three.js 안에서 소품 그리기 ───────────── */

type Posed = { key: string; e: { x: number; y: number } }

function anchorInfo(
  anchor: string,
  pts: PtLike[],
  posed: Posed[],
  angles: Record<string, number>,
): { x: number; y: number; rot: number } | null {
  const get = (id: number) => pts.find((p) => p.id === id)
  const def = ANCHORS.find((a) => a.key === anchor)
  if (!def) return null

  if (def.chain) {
    const ch = posed.find((p) => p.key === def.chain)
    if (!ch) return null
    const rot = (angles[def.chain + '_up'] ?? 0) + (angles[def.chain + '_lo'] ?? 0)
    return { x: ch.e.x, y: ch.e.y, rot }
  }
  if (anchor === 'head') {
    const n = get(0)
    return n ? { x: n.x, y: n.y, rot: 0 } : null
  }
  const ids: [number, number] = anchor === 'chest' ? [11, 12] : [23, 24]
  const a = get(ids[0])
  const b = get(ids[1])
  if (!a || !b) return null
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, rot: 0 }
}

type Info = { x: number; y: number; rot: number }
type DragMode = 'move' | 'rotate' | 'scale'

function AssetMesh({
  asset,
  info,
  W,
  H,
  selected,
  onSelect,
  onChange,
}: {
  asset: AssetItem
  info: Info
  W: number
  H: number
  selected: boolean
  onSelect: (id: number) => void
  onChange: (id: number, p: Partial<AssetItem>) => void
}) {
  const { camera, gl } = useThree()

  const src = useMemo(
    () => (asset.bgTol > 0 ? removeWhite(asset.orig, asset.bgTol) : asset.orig),
    [asset.orig, asset.bgTol],
  )
  const tex = useMemo(() => {
    const t = new THREE.Texture(src)
    t.colorSpace = THREE.SRGBColorSpace
    t.needsUpdate = true
    return t
  }, [src])
  const { w, h } = srcSize(src)
  const z = asset.front ? 0.5 : 0.02

  const hw = (w * asset.scale) / 2
  const hh = (h * asset.scale) / 2
  const rr = Math.max(10, W / 55) // 손잡이 점 크기
  const stem = rr * 3

  // 선택됐을 때 보이는 테두리와 회전 막대
  const frame = useMemo(() => {
    const pairs: [number, number][] = [
      [-hw, -hh], [hw, -hh],
      [hw, -hh], [hw, hh],
      [hw, hh], [-hw, hh],
      [-hw, hh], [-hw, -hh],
      [0, hh], [0, hh + stem],
    ]
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(pairs.flatMap(([x, y]) => [x, y, 0]), 3),
    )
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffd23f }))
  }, [hw, hh, stem])

  // 화면 좌표 → Three 세계 좌표 (카메라는 원점, 직교)
  function toWorld(cx: number, cy: number) {
    const r = gl.domElement.getBoundingClientRect()
    const zoom = (camera as THREE.OrthographicCamera).zoom
    return { x: (cx - r.left - r.width / 2) / zoom, y: -(cy - r.top - r.height / 2) / zoom }
  }

  const anchorX = info.x - W / 2
  const anchorY = H / 2 - info.y

  function begin(mode: DragMode, e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    onSelect(asset.id)

    const p0 = toWorld(e.nativeEvent.clientX, e.nativeEvent.clientY)
    const o = rotv(asset.offX, asset.offY, info.rot)
    const cx = anchorX + o.x // 소품 중심의 세계 좌표
    const cy = anchorY + o.y
    const dist0 = Math.hypot(p0.x - cx, p0.y - cy) || 1
    const offX0 = asset.offX
    const offY0 = asset.offY
    const scale0 = asset.scale

    const move = (ev: PointerEvent) => {
      const q = toWorld(ev.clientX, ev.clientY)
      if (mode === 'move') {
        const local = rotv(q.x - p0.x, q.y - p0.y, -info.rot)
        onChange(asset.id, {
          offX: Math.round(offX0 + local.x),
          offY: Math.round(offY0 + local.y),
        })
      } else if (mode === 'scale') {
        const ratio = Math.hypot(q.x - cx, q.y - cy) / dist0
        onChange(asset.id, { scale: Math.min(5, Math.max(0.03, scale0 * ratio)) })
      } else {
        const ang = toDeg(Math.atan2(q.y - cy, q.x - cx))
        onChange(asset.id, { rot: Math.round(normDeg(ang - 90 - info.rot)) })
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const setCursor = (c: string) => {
    gl.domElement.style.cursor = c
  }

  return (
    <group position={[anchorX, anchorY, z]} rotation={[0, 0, toRad(info.rot)]}>
      <group position={[asset.offX, asset.offY, 0]} rotation={[0, 0, toRad(asset.rot)]}>
        <mesh
          scale={[asset.scale * (asset.flip ? -1 : 1), asset.scale, 1]}
          onPointerDown={(e) => begin('move', e)}
          onPointerOver={() => setCursor('move')}
          onPointerOut={() => setCursor('')}
        >
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial
            map={tex}
            transparent
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>

        {selected && (
          <group position={[0, 0, 0.9 - z]}>
            <primitive object={frame} />

            {/* 크기 조절 점 (오른쪽 아래) */}
            <mesh
              position={[hw, -hh, 0]}
              onPointerDown={(e) => begin('scale', e)}
              onPointerOver={() => setCursor('nwse-resize')}
              onPointerOut={() => setCursor('')}
            >
              <circleGeometry args={[rr, 24]} />
              <meshBasicMaterial color="#ffd23f" toneMapped={false} />
            </mesh>

            {/* 회전 점 (위쪽 막대 끝) */}
            <mesh
              position={[0, hh + stem, 0]}
              onPointerDown={(e) => begin('rotate', e)}
              onPointerOver={() => setCursor('grab')}
              onPointerOut={() => setCursor('')}
            >
              <circleGeometry args={[rr, 24]} />
              <meshBasicMaterial color="#3ddc84" toneMapped={false} />
            </mesh>
          </group>
        )}
      </group>
    </group>
  )
}

export function AssetLayer({
  assets,
  pts,
  posed,
  angles,
  W,
  H,
  selectedId,
  onSelect,
  onChange,
}: {
  assets: AssetItem[]
  pts: PtLike[]
  posed: Posed[]
  angles: Record<string, number>
  W: number
  H: number
  selectedId: number | null
  onSelect: (id: number) => void
  onChange: (id: number, p: Partial<AssetItem>) => void
}) {
  return (
    <>
      {assets.map((a) => {
        const info = anchorInfo(a.anchor, pts, posed, angles)
        if (!info) return null
        return (
          <AssetMesh
            key={a.id}
            asset={a}
            info={info}
            W={W}
            H={H}
            selected={a.id === selectedId}
            onSelect={onSelect}
            onChange={onChange}
          />
        )
      })}
    </>
  )
}

/* ───────────── 오른쪽 패널의 소품 조절 UI ───────────── */

export function AssetPanel({
  assets,
  setAssets,
  selectedId,
  setSelectedId,
}: {
  assets: AssetItem[]
  setAssets: React.Dispatch<React.SetStateAction<AssetItem[]>>
  selectedId: number | null
  setSelectedId: (id: number | null) => void
}) {
  const sel = assets.find((a) => a.id === selectedId) ?? null

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const max = Math.max(img.naturalWidth, img.naturalHeight)
      const item: AssetItem = {
        id: Date.now(),
        name: file.name,
        orig: img,
        anchor: 'handR',
        scale: Math.min(1, 160 / max), // 처음엔 적당한 크기로
        offX: 0,
        offY: 0,
        rot: 0,
        flip: false,
        front: true,
        bgTol: 0,
      }
      setAssets((prev) => [...prev, item])
      setSelectedId(item.id)
    }
    img.onerror = () => alert('이미지를 읽지 못했어요. PNG 파일인지 확인해주세요.')
    img.src = url
    input.value = ''
  }

  function patch(p: Partial<AssetItem>) {
    if (!sel) return
    setAssets((prev) => prev.map((a) => (a.id === sel.id ? { ...a, ...p } : a)))
  }

  function remove() {
    if (!sel) return
    setAssets((prev) => prev.filter((a) => a.id !== sel.id))
    setSelectedId(null)
  }

  return (
    <>
      <div className="panel-title">소품 / 에셋 (투명 PNG)</div>
      <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>
        왼쪽 그림에서 소품을 클릭해 선택한 뒤, 본체를 끌면 이동 · 노란 점은 크기 · 초록 점은 회전입니다.
      </div>
      <label className="btn" style={{ textAlign: 'center', cursor: 'pointer' }}>
        + 소품 이미지 추가
        <input type="file" accept="image/*" onChange={onFile} hidden />
      </label>

      {assets.length > 0 && (
        <label>
          편집할 소품
          <select
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">선택 안 함</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {sel && (
        <div className="limb-group">
          <label>
            붙일 위치
            <select value={sel.anchor} onChange={(e) => patch({ anchor: e.target.value })}>
              {ANCHORS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            크기 ({sel.scale.toFixed(2)}배)
            <input type="range" min={0.03} max={5} step={0.01} value={sel.scale}
              onChange={(e) => patch({ scale: Number(e.target.value) })} />
          </label>
          <label>
            좌우 이동 ({sel.offX}px)
            <input type="range" min={-700} max={700} value={sel.offX}
              onChange={(e) => patch({ offX: Number(e.target.value) })} />
          </label>
          <label>
            상하 이동 ({sel.offY}px, +는 위)
            <input type="range" min={-700} max={700} value={sel.offY}
              onChange={(e) => patch({ offY: Number(e.target.value) })} />
          </label>
          <label>
            회전 ({sel.rot}°)
            <input type="range" min={-180} max={180} value={sel.rot}
              onChange={(e) => patch({ rot: Number(e.target.value) })} />
          </label>
          <label>
            배경 지우기 (흰색·체크무늬) ({sel.bgTol === 0 ? '끔' : sel.bgTol})
            <input type="range" min={0} max={80} value={sel.bgTol}
              onChange={(e) => patch({ bgTol: Number(e.target.value) })} />
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={sel.flip} onChange={(e) => patch({ flip: e.target.checked })} />
            좌우 뒤집기
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={sel.front} onChange={(e) => patch({ front: e.target.checked })} />
            팔다리 앞에 표시 (끄면 뒤로 감)
          </label>
          <button className="btn ghost" onClick={remove}>
            이 소품 삭제
          </button>
        </div>
      )}
    </>
  )
}
