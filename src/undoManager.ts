// 되돌리기/다시 실행 이력 관리자 (화면 API 없음, 단독 테스트 가능)
//
// 메모리 방침: 이미지를 복사하지 않는다. React 상태는 바뀔 때마다 새 객체가 만들어지고 이전 객체는 그대로 남으므로,
// 이력에는 그 객체의 "참조"만 쌓는다. 같은 파츠 이미지(캔버스)는 모든 단계가 하나를 공유한다.
// 단계 수가 limit을 넘으면 가장 오래된 단계부터 버린다.

export type HistoryOptions<T> = {
  limit?: number // 되돌릴 수 있는 최대 단계 수 (기본 100)
  equals?: (a: T, b: T) => boolean // 같은 상태면 새 단계를 만들지 않는다 (기본: 참조 비교)
}

export type History<T> = {
  present: () => T
  commit: (next: T) => boolean // 새 단계로 기록. 현재와 같으면 false
  undo: () => T | null // 한 단계 전으로. 더 없으면 null
  redo: () => T | null
  canUndo: () => boolean
  canRedo: () => boolean
  undoCount: () => number
  redoCount: () => number
  reset: (state: T) => void // 이력을 모두 지우고 새로 시작 (이미지를 바꿀 때)
}

export function createHistory<T>(initial: T, opts: HistoryOptions<T> = {}): History<T> {
  const limit = Math.max(1, opts.limit ?? 100)
  const equals = opts.equals ?? ((a: T, b: T) => a === b)
  let past: T[] = []
  let now = initial
  let future: T[] = []
  return {
    present: () => now,
    commit(next) {
      if (equals(now, next)) return false
      past.push(now)
      if (past.length > limit) past = past.slice(past.length - limit)
      now = next
      future = [] // 새 작업을 하면 다시 실행할 수 있던 단계는 사라진다
      return true
    },
    undo() {
      if (!past.length) return null
      future.push(now)
      now = past.pop() as T
      return now
    },
    redo() {
      if (!future.length) return null
      past.push(now)
      now = future.pop() as T
      return now
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undoCount: () => past.length,
    redoCount: () => future.length,
    reset(state) {
      past = []
      future = []
      now = state
    },
  }
}

// 숫자 값만 가진 단순 객체(예: 관절 각도) 비교. 한 프레임마다 새 객체가 만들어져도 값이 같으면 같은 상태로 본다.
export function shallowEqualRecord(a: Record<string, number>, b: Record<string, number>): boolean {
  if (a === b) return true
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => a[k] === b[k])
}
