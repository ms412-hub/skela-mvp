// 캐릭터 에디터: Unity의 Scene 편집 방식을 참고한 파츠 포즈 편집기
//   메뉴 / Hierarchy(왼쪽) / Scene(가운데) / Inspector(오른쪽) / Timeline(아래)
// 기존 관절(pts)과 이미지로 파츠를 구성하고, 이후에는 이미지가 아니라 파츠의 Transform만 바꾼다.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { buildCharacter } from '../character/buildCharacter'
import type { EditorState, PartState } from '../character/CharacterModel'
import { applyPoseFile, childrenOf, isDescendant, reparent, setPivotKeepPlace, toPoseFile, updatePart, worldMatrices, pivotWorld } from '../character/CharacterModel'
import { applyPose, capturePose, keyAt, removeKey, sampleAt, setKey } from '../animation/Timeline'
import { createHistory } from '../undoManager'
import SceneView from './SceneView'
import type { SceneApi, Tool } from './SceneView'
import './editor.css'

type Pt = { id: number; name: string; x: number; y: number }
type Props = { img: CanvasImageSource; width: number; height: number; pts: Pt[]; onExit: () => void }

export default function CharacterEditor({ img, width, height, pts, onExit }: Props) {
  // 파츠 구성은 처음 한 번만 (이미지를 오리는 일은 여기서 끝)
  const built = useMemo(() => buildCharacter(img, width, height, pts), [img, width, height, pts])
  const char = built.char
  const [state, setState] = useState<EditorState>(built.state)
  const [preview, setPreview] = useState<EditorState | null>(null) // 타임라인 재생·탐색 중 보이는 포즈
  const [selection, setSelection] = useState<string[]>([])
  const [tool, setTool] = useState<Tool>('move')
  const [showJoints, setShowJoints] = useState(true)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const [msg, setMsg] = useState('파츠를 클릭하거나 왼쪽 Hierarchy에서 선택하세요.')
  const [dialog, setDialog] = useState<null | 'save' | 'load'>(null)
  const [loadText, setLoadText] = useState('')
  const sceneApi = useRef<SceneApi | null>(null)

  // 되돌리기: 상태 객체의 참조만 쌓는다. 바뀐 파츠만 새 객체라 "변경 전후"만큼만 메모리를 쓴다.
  const hist = useRef(createHistory<EditorState>(built.state, { limit: 200 }))
  const [, bump] = useState(0)
  useEffect(() => { hist.current.reset(built.state); setState(built.state); setPreview(null); setSelection([]) }, [built])

  const shown = preview ?? state
  const live = (s: EditorState) => setState(s)
  const commit = (s: EditorState, note?: string) => {
    setState(s)
    if (hist.current.commit(s)) bump((n) => n + 1)
    if (note) setMsg(note)
  }
  // 편집을 시작하면 미리보기(타임라인 포즈)를 지금 상태로 확정한다
  const beginEdit = () => {
    if (playing) setPlaying(false)
    if (preview) { setState(preview); setPreview(null); return preview }
    return state
  }
  const undo = () => {
    if (state !== hist.current.present()) hist.current.commit(state)
    const s = hist.current.undo()
    if (s) { setState(s); setPreview(null); setMsg('되돌렸어요.'); bump((n) => n + 1) }
  }
  const redo = () => {
    const s = hist.current.redo()
    if (s) { setState(s); setPreview(null); setMsg('다시 실행했어요.'); bump((n) => n + 1) }
  }

  // 타임라인 재생
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    let t = time
    const tick = (now: number) => {
      t += (now - last) / 1000
      last = now
      if (t > state.duration) {
        if (loop) t = t % state.duration
        else { t = state.duration; setPlaying(false) }
      }
      setTime(t)
      const pose = sampleAt(state.keys, t)
      if (pose) setPreview(applyPose(state, pose))
      if (t < state.duration || loop) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])
  const play = () => {
    if (state.keys.length < 2) { setMsg('키가 2개 이상 있어야 재생할 수 있어요. 시간을 옮기고 "키 저장"을 눌러 보세요.'); return }
    setPlaying(!playing)
  }
  const seek = (t: number) => {
    setPlaying(false)
    const tt = Math.max(0, Math.min(state.duration, Math.round(t * 20) / 20)) // 0.05초 단위
    setTime(tt)
    const pose = sampleAt(state.keys, tt)
    setPreview(pose ? applyPose(state, pose) : null)
  }
  const saveKey = () => {
    const base = beginEdit()
    commit({ ...base, keys: setKey(base.keys, time, capturePose(base)) }, `${time.toFixed(2)}초에 키를 저장했어요.`)
  }
  const deleteKey = () => {
    if (!keyAt(state.keys, time)) { setMsg('지금 시간에는 키가 없어요.'); return }
    commit({ ...state, keys: removeKey(state.keys, time) }, `${time.toFixed(2)}초의 키를 지웠어요.`)
  }

  // 키보드: W 이동, E 회전, R 크기, P 피벗, F 선택으로 이동, Home 전체 보기, Ctrl+Z / Ctrl+Y
  const acts = useRef({ undo, redo })
  acts.current = { undo, redo }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      const k = e.key.toLowerCase()
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); acts.current.undo() }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); acts.current.redo() }
        return
      }
      if (k === 'w') setTool('move')
      else if (k === 'e') setTool('rotate')
      else if (k === 'r') setTool('scale')
      else if (k === 'p') setTool('pivot')
      else if (k === 'f') sceneApi.current?.frameSelection()
      else if (e.key === 'Home') sceneApi.current?.frameAll()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const primary = selection[selection.length - 1]
  const sel: PartState | undefined = primary ? shown.parts[primary] : undefined

  // Inspector 값 변경: 입력하는 동안 바로 반영(live), 칸을 떠나거나 Enter면 되돌리기 한 단계(commit)
  const editPart = (patch: Partial<PartState>) => {
    if (!primary) return
    const base = beginEdit()
    live(updatePart(base, primary, patch))
  }
  const commitNow = () => { if (state !== hist.current.present()) commit(state) }

  // 저장/불러오기
  const poseJson = useMemo(() => JSON.stringify(toPoseFile(char, state), null, 2), [char, state])
  const downloadJson = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([poseJson], { type: 'application/json' }))
    a.download = 'skela-character-pose.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const copyJson = async () => {
    try { await navigator.clipboard.writeText(poseJson); setMsg('JSON을 복사했어요.') } catch { setMsg('복사가 막혀 있어요. 아래 글상자에서 직접 선택해 복사하세요.') }
  }
  const applyLoad = (text: string) => {
    try {
      const r = applyPoseFile(state, JSON.parse(text))
      commit(r.state, `포즈를 불러왔어요 (파츠 ${r.applied}개${r.skipped.length ? `, 없는 파츠 ${r.skipped.length}개는 건너뜀` : ''}).`)
      setPreview(null)
      setDialog(null)
    } catch (e) {
      setMsg('❌ ' + (e instanceof Error ? e.message : '불러오지 못했어요.'))
    }
  }

  const W = useMemo(() => worldMatrices(shown), [shown])
  const toolBtn = (t: Tool, label: string, key: string) => (
    <button className={tool === t ? 'ce-btn on' : 'ce-btn'} onClick={() => setTool(t)} title={`${label} (${key})`}>{label}</button>
  )

  return (
    <div className="ce-root">
      {/* 메뉴 */}
      <div className="ce-menu">
        <button className="ce-btn" onClick={onExit}>← 점 편집으로</button>
        <span className="ce-sep" />
        <button className="ce-btn" onClick={() => setDialog('save')}>저장</button>
        <button className="ce-btn" onClick={() => { setLoadText(''); setDialog('load') }}>불러오기</button>
        <button className={playing ? 'ce-btn on' : 'ce-btn'} onClick={play}>{playing ? '⏸ 정지' : '▶ 실행'}</button>
        <button className="ce-btn" onClick={undo} disabled={!hist.current.canUndo() && state === hist.current.present()} title="되돌리기 (Ctrl+Z)">↶ 되돌리기</button>
        <button className="ce-btn" onClick={redo} disabled={!hist.current.canRedo()} title="다시 실행 (Ctrl+Y)">↷ 다시 실행</button>
        <span className="ce-sep" />
        {toolBtn('move', '이동', 'W')}
        {toolBtn('rotate', '회전', 'E')}
        {toolBtn('scale', '크기', 'R')}
        {toolBtn('pivot', '피벗', 'P')}
        <span className="ce-sep" />
        <button className="ce-btn" onClick={() => sceneApi.current?.frameAll()} title="전체 보기 (Home)">전체 보기</button>
        <button className="ce-btn" onClick={() => sceneApi.current?.frameSelection()} disabled={!selection.length} title="선택으로 이동 (F)">선택으로 이동</button>
        <label className="ce-check"><input type="checkbox" checked={showJoints} onChange={(e) => setShowJoints(e.target.checked)} /> 관절 표시</label>
        <span className="ce-msg">{msg}</span>
      </div>

      {/* Hierarchy */}
      <div className="ce-panel ce-hier">
        <div className="ce-title">Hierarchy</div>
        <div className="ce-tree" role="tree">
          <div className="ce-row ce-rootrow">{char.name}</div>
          {renderTree(null, 1)}
        </div>
        <div className="ce-hint">Shift/Ctrl+클릭: 여러 개 선택</div>
      </div>

      {/* Scene */}
      <div className="ce-scene">
        <SceneView
          char={char}
          state={shown}
          selection={selection}
          tool={tool}
          showJoints={showJoints}
          onSelect={setSelection}
          beginEdit={beginEdit}
          onLive={live}
          onCommit={(s) => commit(s)}
          apiRef={sceneApi}
        />
        <div className="ce-scene-help">휠: 확대/축소 · 빈 곳 드래그(또는 가운데/오른쪽 버튼): 화면 이동 · W/E/R/P: 이동/회전/크기/피벗 · Ctrl+회전: 15° 단위</div>
      </div>

      {/* Inspector */}
      <div className="ce-panel ce-insp">
        <div className="ce-title">Inspector</div>
        {!sel || !primary ? (
          <div className="ce-empty">선택한 파츠가 없어요.</div>
        ) : (
          <div className="ce-fields" key={primary}>
            <div className="ce-name">{char.defs[primary]?.name ?? primary}{selection.length > 1 ? ` (외 ${selection.length - 1}개 선택)` : ''}</div>
            <label className="ce-check"><input type="checkbox" checked={sel.visible} onChange={(e) => { editPart({ visible: e.target.checked }); setTimeout(commitNow) }} /> 보이기</label>
            <Group label="Position (부모 기준)">
              <Num label="X" value={sel.position.x} onChange={(v) => editPart({ position: { ...sel.position, x: v } })} onCommit={commitNow} />
              <Num label="Y" value={sel.position.y} onChange={(v) => editPart({ position: { ...sel.position, y: v } })} onCommit={commitNow} />
            </Group>
            <Group label="Rotation (°, 시계 방향 +)">
              <Num label="Z" value={sel.rotation} onChange={(v) => editPart({ rotation: v })} onCommit={commitNow} />
            </Group>
            <Group label="Scale">
              <Num label="X" value={sel.scale.x} step={0.05} onChange={(v) => editPart({ scale: { ...sel.scale, x: v } })} onCommit={commitNow} />
              <Num label="Y" value={sel.scale.y} step={0.05} onChange={(v) => editPart({ scale: { ...sel.scale, y: v } })} onCommit={commitNow} />
            </Group>
            <Group label="Pivot (관절, 파츠 이미지 좌표)">
              <Num label="X" value={sel.pivot.x} onChange={(v) => { const b = beginEdit(); live(setPivotKeepPlace(b, primary, { x: v, y: b.parts[primary].pivot.y })) }} onCommit={commitNow} />
              <Num label="Y" value={sel.pivot.y} onChange={(v) => { const b = beginEdit(); live(setPivotKeepPlace(b, primary, { x: b.parts[primary].pivot.x, y: v })) }} onCommit={commitNow} />
            </Group>
            <Group label="Parent">
              <select
                value={sel.parent ?? ''}
                onChange={(e) => {
                  const b = beginEdit()
                  const next = reparent(b, primary, e.target.value || null)
                  if (next === b) setMsg('자기 자신이나 자기 자식은 부모가 될 수 없어요.')
                  else commit(next, '부모를 바꿨어요 (화면 위치는 그대로).')
                }}
              >
                <option value="">(없음)</option>
                {char.order.filter((id) => id !== primary && !isDescendant(shown, id, primary)).map((id) => <option key={id} value={id}>{char.defs[id]?.name ?? id}</option>)}
              </select>
            </Group>
            <Group label="Order in Layer (클수록 앞)">
              <Num label="" value={sel.z} step={1} onChange={(v) => editPart({ z: Math.round(v) })} onCommit={commitNow} />
            </Group>
            <div className="ce-world">월드 관절 위치: {fmt(pivotWorld(shown, primary, W).x)}, {fmt(pivotWorld(shown, primary, W).y)}</div>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="ce-panel ce-time">
        <div className="ce-time-bar">
          <span className="ce-title">Timeline</span>
          <button className="ce-btn" onClick={() => seek(0)}>|◀</button>
          <button className={playing ? 'ce-btn on' : 'ce-btn'} onClick={play}>{playing ? '⏸' : '▶'}</button>
          <button className="ce-btn" onClick={saveKey}>● 키 저장</button>
          <button className="ce-btn" onClick={deleteKey} disabled={!keyAt(state.keys, time)}>✕ 키 삭제</button>
          <label className="ce-check"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> 반복</label>
          <label className="ce-check">길이
            <input className="ce-dur" type="number" min={0.5} max={60} step={0.5} value={state.duration}
              onChange={(e) => { const v = Number(e.target.value); if (v >= 0.5) commit({ ...state, duration: v }) }} />초
          </label>
          <span className="ce-time-now">{time.toFixed(2)}s · 키 {state.keys.length}개</span>
        </div>
        <Ruler duration={state.duration} time={time} keys={state.keys.map((k) => k.t)} onSeek={seek} />
      </div>

      {dialog && (
        <div className="ce-modal" role="dialog" aria-label={dialog === 'save' ? '포즈 저장' : '포즈 불러오기'}>
          <div className="ce-modal-box">
            <div className="ce-title">{dialog === 'save' ? '포즈 저장 (JSON)' : '포즈 불러오기'}</div>
            {dialog === 'save' ? (
              <>
                <textarea readOnly value={poseJson} onFocus={(e) => e.currentTarget.select()} />
                <div className="ce-row-btns">
                  <button className="ce-btn on" onClick={downloadJson}>파일로 저장</button>
                  <button className="ce-btn" onClick={copyJson}>복사</button>
                  <button className="ce-btn" onClick={() => setDialog(null)}>닫기</button>
                </div>
              </>
            ) : (
              <>
                <input type="file" accept="application/json,.json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) applyLoad(await f.text()) }} />
                <textarea placeholder="또는 저장한 JSON을 여기에 붙여넣으세요" value={loadText} onChange={(e) => setLoadText(e.target.value)} />
                <div className="ce-row-btns">
                  <button className="ce-btn on" onClick={() => applyLoad(loadText)} disabled={!loadText.trim()}>적용</button>
                  <button className="ce-btn" onClick={() => setDialog(null)}>닫기</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )

  function renderTree(parent: string | null, depth: number): ReactNode {
    const kids = childrenOf(shown, parent).sort((a, b) => char.order.indexOf(a) - char.order.indexOf(b))
    return kids.map((id) => (
      <div key={id}>
        <div
          className={'ce-row' + (selection.includes(id) ? (id === primary ? ' sel' : ' sel2') : '')}
          style={{ paddingLeft: depth * 14 }}
          role="treeitem"
          aria-selected={selection.includes(id)}
          onClick={(e) => {
            const multi = e.shiftKey || e.ctrlKey || e.metaKey
            setSelection(multi ? (selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]) : [id])
          }}
          onDoubleClick={() => { setSelection([id]); setTimeout(() => sceneApi.current?.frameSelection()) }}
        >
          <span className="ce-caret">{childrenOf(shown, id).length ? '▾' : '·'}</span>
          {char.defs[id]?.name ?? id}
          {!shown.parts[id].visible && <span className="ce-hidden"> (숨김)</span>}
        </div>
        {renderTree(id, depth + 1)}
      </div>
    ))
  }
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toString()

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ce-group">
      <div className="ce-glabel">{label}</div>
      <div className="ce-gbody">{children}</div>
    </div>
  )
}

// 숫자 입력: 입력 중에도 바로 반영. 칸을 떠나거나 Enter를 누르면 되돌리기 한 단계로 기록.
function Num({ label, value, onChange, onCommit, step = 1 }: { label: string; value: number; onChange: (v: number) => void; onCommit: () => void; step?: number }) {
  const [text, setText] = useState(fmt(value))
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(fmt(value)) }, [value])
  return (
    <label className="ce-num">
      {label && <span>{label}</span>}
      <input
        type="number"
        step={step}
        value={text}
        onFocus={() => { focused.current = true }}
        onChange={(e) => { setText(e.target.value); const v = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(v)) onChange(v) }}
        onBlur={() => { focused.current = false; setText(fmt(value)); onCommit() }}
        onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() } }}
      />
    </label>
  )
}

function Ruler({ duration, time, keys, onSeek }: { duration: number; time: number; keys: number[]; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return ((clientX - r.left) / r.width) * duration
  }
  const ticks: number[] = []
  for (let t = 0; t <= duration + 1e-6; t += 0.5) ticks.push(Math.round(t * 10) / 10)
  return (
    <div
      ref={ref}
      className="ce-ruler"
      data-testid="ruler"
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); onSeek(at(e.clientX)) }}
      onPointerMove={(e) => { if (e.buttons) onSeek(at(e.clientX)) }}
    >
      {ticks.map((t) => (
        <div key={t} className={Number.isInteger(t) ? 'ce-tick big' : 'ce-tick'} style={{ left: `${(t / duration) * 100}%` }}>
          {Number.isInteger(t) && <span>{t}s</span>}
        </div>
      ))}
      {keys.map((t) => <div key={t} className="ce-key" style={{ left: `${(t / duration) * 100}%` }} title={`${t.toFixed(2)}s`} />)}
      <div className="ce-head" style={{ left: `${(time / duration) * 100}%` }} />
    </div>
  )
}
