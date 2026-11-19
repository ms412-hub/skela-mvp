// 리그 화면에서 올가미로 오려낸 파츠를 에디터 오브젝트로 가져오는 규칙 (화면 API 없음, 단독 테스트 가능)
//
// 리그의 "붙일 위치"(앵커)를 에디터 파츠의 부모로 바꾼다. 붙인 뼈가 움직이면 함께 움직인다.
//   오른 윗팔 → RightArm, 오른 아래팔 → RightForearm, 오른손 → RightHand, 허벅지 → Leg, 종아리 → Shin, 발 → Foot
//   머리 → Head, 가슴·허리 → Body, 고정 → 최상위(부모 없음)
// 리그에서 옮긴 위치·회전은 가져오지 않는다. 오려낸 원래 자리에서 시작한다.

export type LassoPart = { name: string; poly: { x: number; y: number }[]; anchor: string; front: boolean }

export const ANCHOR_TO_PART: Record<string, string | null> = {
  handR: 'rightHand', handL: 'leftHand', footR: 'rightFoot', footL: 'leftFoot',
  armR_up: 'rightArm', armR_lo: 'rightForearm', armL_up: 'leftArm', armL_lo: 'leftForearm',
  legR_up: 'rightLeg', legR_lo: 'rightShin', legL_up: 'leftLeg', legL_lo: 'leftShin',
  head: 'head', chest: 'body', waist: 'body',
  free: null,
}

export type LassoPlan = { id: string; name: string; parent: string | null; z: number; index: number }

// id는 순서대로 lasso1, lasso2 … (포즈 JSON을 다시 불러올 때 같은 파츠를 찾을 수 있게)
// 붙일 뼈가 없으면(관절이 빠져 파츠를 못 만든 경우 등) Body에, Body도 없으면 최상위에 둔다.
// 앞(front)이면 팔보다 위(z 8), 뒤면 몸통보다 아래(z -1)
export function lassoPlan(list: LassoPart[], existing: Set<string>): LassoPlan[] {
  return list.map((l, index) => {
    const want = l.anchor in ANCHOR_TO_PART ? ANCHOR_TO_PART[l.anchor] : 'body'
    const parent = want === null ? null : existing.has(want) ? want : existing.has('body') ? 'body' : null
    return { id: `lasso${index + 1}`, name: l.name || `Part${index + 1}`, parent, z: l.front ? 8 : -1, index }
  })
}
