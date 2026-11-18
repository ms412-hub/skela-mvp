// 관절 자동 추정 결과와 사람이 손본 결과를 합치는 규칙 (React 의존 없음, 단독으로 테스트 가능)
//
// 관절마다 출처(source)를 가진다.
//   'auto'   자동 추정이 정한 위치. 다시 추정하면 새 값으로 갱신된다.
//   'manual' 사람이 옮긴 위치. 다시 추정해도 유지된다.
// 추가 관절(id >= CUSTOM_MIN)은 항상 사람이 만든 것이라 다시 추정해도 그대로 유지된다.

export const CUSTOM_MIN = 100 // 추가 관절 id는 100부터 (기본 관절은 MediaPipe 번호)

export type JointSource = 'auto' | 'manual'
export type JointPt = { id: number; name: string; x: number; y: number; source?: JointSource }

export type MergeResult<T extends JointPt> = {
  pts: T[]
  keptManual: number // 사람이 옮겨서 유지한 기본 관절 수
  refreshed: number // 새 추정값으로 갱신된 기본 관절 수
  custom: number // 유지된 추가 관절 수
}

const isCustom = (p: JointPt) => p.id >= CUSTOM_MIN

// 파일이나 외부에서 온 source 값을 안전하게 정리한다 (알 수 없는 값은 없는 것으로 본다)
export function cleanSource(v: unknown): JointSource | undefined {
  return v === 'manual' || v === 'auto' ? v : undefined
}

// 새 추정(detected)을 기존 관절(prev)과 합친다.
// discardManual이 true면 사람이 옮긴 기본 관절도 새 추정값으로 덮어쓴다(추가 관절은 그대로).
export function mergeDetected<T extends JointPt>(
  prev: T[] | null,
  detected: T[],
  opts: { discardManual?: boolean } = {},
): MergeResult<T> {
  const prevById = new Map((prev ?? []).map((p) => [p.id, p]))
  let keptManual = 0
  let refreshed = 0
  const base: T[] = detected.map((d) => {
    const old = prevById.get(d.id)
    if (old && old.source === 'manual' && !opts.discardManual) {
      keptManual++
      return { ...old, source: 'manual' as const } // 위치·이름은 사람이 정한 대로
    }
    refreshed++
    return { ...d, source: 'auto' as const }
  })
  // 새 추정에 없는 기존 기본 관절은 지우지 않고 유지한다(예: 이전 파일에만 있던 점)
  const detectedIds = new Set(detected.map((d) => d.id))
  const leftovers = (prev ?? []).filter((p) => !isCustom(p) && !detectedIds.has(p.id))
  const custom = (prev ?? []).filter(isCustom).map((p) => ({ ...p, source: 'manual' as const }))
  return { pts: [...base, ...leftovers, ...custom], keptManual, refreshed, custom: custom.length }
}

// 기본 관절 하나를 (x, y)로 옮기고 사람이 옮긴 것으로 표시한다. 추가 관절은 표시 없이 위치만 바뀐다.
export function moveJoint<T extends JointPt>(pts: T[], id: number, x: number, y: number): T[] {
  return pts.map((p) => {
    if (p.id !== id) return p
    if (isCustom(p)) return { ...p, x, y }
    const moved = Math.abs(p.x - x) > 1e-6 || Math.abs(p.y - y) > 1e-6
    return { ...p, x, y, source: moved ? ('manual' as const) : p.source }
  })
}

// "원래 추정값으로": 기본 관절을 처음 자동 추정값(original)으로 되돌리고 출처를 auto로 돌린다. 추가 관절은 유지.
export function resetToAuto<T extends JointPt>(original: T[], current: T[]): T[] {
  return [
    ...original.map((p) => ({ ...p, source: 'auto' as const })),
    ...current.filter(isCustom),
  ]
}

export const countManual = (pts: JointPt[] | null) => (pts ?? []).filter((p) => !isCustom(p) && p.source === 'manual').length
