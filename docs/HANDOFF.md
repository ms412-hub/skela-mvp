# Skela 프로젝트 인수인계 문서

이 문서는 다른 AI(예: Gemini)가 지금까지의 작업을 이해하고 이어서 작업할 수 있게 정리한 것이다.
저장소: `ms412-hub/skela-mvp` · 작업 브랜치: `claude/hopeful-turing-2zzgeb` (main보다 커밋 25개 앞, 아직 main에 합치지 않음)

---

## 0. 한눈에 보기

| 덩어리 | 무엇 | 상태 |
|---|---|---|
| 1. Skela 캐릭터 도구 | 그림 한 장 → 관절 추정 → 파츠 분리 → 포즈 변경 (2D, 웹) | 대부분 완료. 포즈 변경 품질 한계로 방향 전환 |
| 2. **Skela Room** | 유니티처럼 쓰는 웹 3D 인테리어 편집기 | **현재 메인**. 동작함 |
| 3. 유니티 연결 | 웹에서 만든 방을 유니티로 옮겨 보기 | 스크립트 작성 완료. **실제 유니티에서 컴파일 검증 안 됨** |

자동 테스트 144개 모두 통과 (`npm test`).

---

## 1. 프로젝트 배경과 규칙

### 사용자
- 학생. **무료·오픈소스만 사용**한다 (유료 API·유료 에셋 제안 금지. 원래 목표 문서에도 "무료·오픈소스 기술만 사용"이라고 되어 있음).
- 집 PC, 대학교 PC(공용 컴퓨터), 모바일을 오가며 작업. 정보 공유는 GitHub.
- 역할 분담: 사용자는 **테스터**, AI는 **엔지니어**. 바뀐 것을 사용자가 직접 확인할 수 있게 매번 웹 페이지(아티팩트)로 올려 왔다.
- 설명은 **짧고 단계별로, 쉬운 한국어**로 해야 한다.

### 방향 변경 과정
1. 처음 목표: 그림 캐릭터를 관절로 움직이는 2D 도구 (Skela MVP).
2. 그림을 안정적으로 포즈 바꾸는 것이 어렵다고 판단 → 여러 안(A~D) 중 **C안: 2D 평면도 → 3D 인테리어**를 선택.
3. 사용자 요구: "유니티를 그대로 쓰기보다 **유니티처럼 쓸 수 있는 우리만의 프로그램**을 만드는 것이 최종 목적. 유니티로 먼저 만들어 보고 그걸 우리식으로 만드는 법을 얻는다."
4. 결정: **웹 Skela Room이 메인**, 유니티는 "고급 보기"(같은 데이터를 받아서 보여주는 역할).

### 환경
- 사용자 PC: Windows, Unity 6.6 프로젝트 `skella` (`C:\Users\...\UnityProject\skella`), Unity CLI 설치됨, Claude Code 설치됨, Unity 플러그인 설치됨.
- 보안 규칙: API 키·로그인 코드를 채팅에 붙여넣지 않기, 공용 PC에서 로그아웃, 토큰을 공용 폴더에 두지 않기.

---

## 2. 기술 스택

| 분야 | 사용 기술 | 라이선스/비용 |
|---|---|---|
| 웹 | React 19 + Vite 8 + TypeScript 7 | 무료 |
| 3D | three.js 0.186.1 (OrbitControls, TransformControls) | MIT |
| 관절 추정 | MediaPipe tasks-vision 1.2.0 | Apache-2.0 |
| 테스트 | Node 내장 테스트 (`node --experimental-strip-types --test "tests/*.test.mts"`) | 무료 |
| 배포 | GitHub Pages (main 브랜치 push 시 `.github/workflows/deploy.yml`) | 무료 |
| 유니티 | Unity 6.6 Personal, C# | 무료 |

- TypeScript 설정에 `allowImportingTsExtensions`가 켜져 있다. 테스트(node)가 읽는 파일끼리는 **import 경로에 `.ts`를 붙여야** 한다 (예: `import { x } from './Plan.ts'`).
- 화면 없는 계산 코드(순수 함수)와 화면 코드를 나눠서, 계산 코드는 모두 단독 테스트한다.

---

## 3. 덩어리 1: Skela 캐릭터 도구 (2D)

웹 앱 `index.html` → `src/main.tsx` → `src/App.tsx`. 모드 3개: `edit`(파츠 편집), `rig`(관절), `editor`(캐릭터 에디터).

### 주요 기능
| 기능 | 파일 | 설명 |
|---|---|---|
| 관절 추정 | `src/poseDetect.ts` | MediaPipe. 그림 주변 여백(0/10/20/35%)을 바꿔 가며 여러 번 시도해 평균 신뢰도가 가장 높은 결과 선택. 10명 중 6명 → 8명 성공으로 개선 |
| 리깅 화면 | `src/RigView.tsx` (1571줄) | 관절 보기·수정, 파츠 지우기, 구멍 채우기, 되돌리기 |
| 구멍 채우기 | `src/holeFill.ts`, `src/inpainting.ts` | 파츠를 떼어낸 자리의 흰 구멍을 주변 색으로 채움. 구멍 크기에 따라 방식 선택(번짐 채우기 / 패치 복사) |
| AI 구멍 채우기 | `src/ai/*` | Gemini 이미지 모델 연결 훅. **유료라서 사용자 조건과 맞지 않음** (버튼은 선택 사항으로 남아 있음, 정리 필요) |
| 되돌리기 | `src/undoManager.ts` | `createHistory()`. 상태 객체의 "참조"만 쌓는다(이미지 복사 없음) |

### 캐릭터 에디터 (유니티 스타일)
| 파일 | 역할 |
|---|---|
| `src/character/Transform.ts` | 2D 행렬 (`[a,b,c,d,e,f]`, canvas setTransform과 같은 형식, y 아래, 시계 방향 +) |
| `src/character/CharacterModel.ts` | 파츠 트리, 부모-자식, 피벗, 포즈 저장 형식 `skela-character-pose` v2 |
| `src/character/buildCharacter.ts` | 이미지 + 관절 → 파츠 14개 생성. 각 픽셀의 주인 파츠를 팔다리 캡슐 거리로 결정 |
| `src/character/ownership.ts` | 파츠 경계를 브러시로 고친 기록(픽셀 차이, RLE 압축) |
| `src/character/lasso.ts` | 올가미로 지정한 영역을 파츠로 가져오기 |
| `src/animation/Timeline.ts` | 키프레임, 보간(각도는 가까운 쪽으로) |
| `src/editor/CharacterEditor.tsx` | 화면: 메뉴 / Hierarchy / Scene / Inspector / Timeline. 단축키 W/E/R/P/B/F, Ctrl+Z/Y |
| `src/editor/SceneView.tsx` | 캔버스 장면, 기즈모(이동/회전/크기/피벗), 터치 두 손가락 확대 |
| `src/editor/exportPng.ts` | 현재 포즈를 PNG로 |

### 남은 문제
- 팔을 들면 몸통·옆머리가 딸려오는 "번짐" 문제. 측정값: 평균 60.7px (`tests/leakBench.*`). 일부만 해결.

---

## 4. 덩어리 2: Skela Room (웹 3D 인테리어 편집기) — 메인

진입: `room.html` → `src/interior/studio/main.ts`. Vite 빌드 시 `index.html`과 `room.html` 두 페이지가 같이 나온다 (`vite.config.ts`의 `rollupOptions.input`).
React를 쓰지 않고 순수 TypeScript + three.js로 만들었다.

### 4-1. 설계 원칙
- **계산(순수 함수)과 화면을 분리**: `Plan.ts`, `catalog.ts`, `geometry.ts`, `templates.ts`, `unityExport.ts`는 화면 없이 계산만 하고 모두 테스트된다. `studio/main.ts`는 화면만 담당.
- **불변 상태**: 평면도(Plan)는 바뀔 때마다 새 객체. 되돌리기는 객체 참조만 쌓는다.
- **모든 가구는 상자(큐브) 조합**: 3D 모델 파일이 없어서 무료이고 라이선스 걱정이 없다. 웹과 유니티가 같은 정의를 쓴다.

### 4-2. 좌표와 단위 (중요)
- 단위: **cm**.
- 평면도 좌표: **x 오른쪽 +, y 아래쪽 +** (화면과 같음). 회전은 **위에서 봐서 시계 방향 +** (도 단위).
- three.js 변환: 평면도 (x, y) → three (x, 높이, z=y), `mesh.rotation.y = -각도(라디안)`.
- 유니티 변환: (x, y, 높이) cm → (x/100, 높이/100, **-y/100**) m, 회전 Y는 **그대로**. (`SkelaRoom.cs`의 `ToUnity` 한 곳에서만 변환)
- 가구의 "앞면"은 로컬 **+z** (옷장 손잡이, 의자 앉는 쪽). 벽에 붙일 때 뒷면(-z)이 벽을 보게 돌린다.

### 4-3. 파일별 상세

**`src/interior/Plan.ts` (171줄): 평면도 데이터와 편집 규칙**
```ts
type Vec = { x: number; y: number }
type Wall = { id: string; a: Vec; b: Vec; thickness: number; height: number }
type Opening = { id: string; wallId: string; t: number /*벽 위 위치 0~1*/; width: number; kind: 'door'|'window'; sill: number; height: number }
type Furniture = { id: string; type: string; x: number; y: number; rot: number; w: number; d: number; h: number; color: string }
type Plan = { name: string; walls: Wall[]; openings: Opening[]; furniture: Furniture[]; floorColor: string; wallColor: string }
```
- 기본값: 벽 두께 10, 높이 250, 최소 벽 길이 20, 문 90×205, 창문 120×120(바닥에서 90).
- 함수: `addWall`, `removeWall`(딸린 문·창문도 삭제), `addOpening`(겹치면 추가 안 함), `fitOpening`(벽 밖으로 안 나가게), `overlaps`, `updateOpening`, `updateWall`, `addFurniture`, `updateFurniture`, `removeFurniture`, `nearestWall`, `pointInFurniture`(회전 고려), `planBounds`(**회전한 가구는 회전 후 크기로** 계산), `snapTo`, `snapVec`, `nextId`.
- 저장 형식: `{ format: 'skela-interior-plan', version: 1, plan }`. `fromPlanFile`은 이상한 값을 걸러내고, 형식이 틀리면 이유를 담아 throw.

**`src/interior/catalog.ts` (130줄): 가구 23종**
- `BoxSpec = { x, z, y, w, d, h, color? }`: 가구 가운데 기준 위치(x 좌우, z 앞뒤), 바닥에서 높이 y, 크기. 색이 없으면 가구 대표색.
- 가구 크기를 바꾸면 상자들이 같은 비율로 늘어난다.
- 목록: 침대, 소파, 식탁, 의자, 책상, 옷장, 책장, 탁자, 주방 조리대, 냉장고, TV장, 변기, 세면대, 욕조, 욕실 타일, 상부장(바닥에서 150cm 위에 거는 장), 아일랜드, 바 의자, 키큰장(오븐), 펜던트 조명(천장에 매달림, 빛은 안 냄), 화분, 바닥 타일, 러그.

**`src/interior/geometry.ts` (104줄): 평면도 → 3D 상자 목록**
```ts
type SceneBox = { kind: 'wall'|'floor'|'furniture'|'door'|'glass'; id: string; cx: number; cy: number; cz: number; w: number; h: number; d: number; rotDeg: number; color: string; opacity?: number }
```
- `wallBoxes`: 벽을 문·창문 자리만 비우고 여러 상자로 나눈다 (문 위, 창문 아래·위). 벽 끝은 두께 절반만큼 늘려 모서리 틈을 없앤다.
- `furnitureBoxes`: 가구 회전 적용 (`cx = x + cos·lx − sin·lz`, `cz = y + sin·lx + cos·lz`).
- `openingBoxes`: 문짝(나무색)과 창문 유리(반투명 0.35).
- `floorBox`: 방 범위 전체 바닥 (윗면 높이 0).
- **떨림(Z-파이팅) 방지** (`FIGHT_STEP = 0.1cm`):
  - 한 가구 안에서 i번째 상자를 사방 i×1mm 키운다 (`inflate`). 같은 평면에 겹치던 면(예: 오븐 문과 장 앞면)이 살짝 앞으로 나온다.
  - 벽 끝은 두께 절반보다 1mm 덜 늘리고, 벽마다 높이를 1mm씩 다르게 해서 모서리의 윗면이 겹치지 않게 한다.

**`src/interior/templates.ts` (428줄): 방 템플릿 7개**

| id | 이름 | 크기 | 내용 |
|---|---|---|---|
| `empty` | 빈 방 | 5×4 m, 6평 | 문 하나 |
| `studio` | 원룸 | 6×4.5 m, 8.2평 | 침대, 책상, 옷장 |
| `tworoom` | 투룸 | 8×6 m, 14.5평 | 침실·거실 |
| `apartment` | 쓰리룸 아파트 | 12×9 m, 32.7평 | 방 3, 거실, 주방 |
| `fiveroom` | 5룸 대형 아파트 | 16×12.4 m, 60평 | 방 5, 안방 욕실, 벽으로 나뉜 거실·주방(가운데 2m 통로), 주방 타일 |
| `corridor` | 복도형 아파트 | 20×9.92 m, 60평 | 현관→거실 1.6m 복도, 방 5, 욕실 2 |
| `corridor64` | **복도형 64평 (최신)** | 22×9.62 m, 64평 | 아래 참고 |

복도형 64평 구조 (복도 y 401~561):
```
┌──────────┬──────────────────┬───────┬───────────┐
│ 둘째 방   │                  │ 방4   │           │
│   [욕실] │      거실         ├─문────┤           │
├──문──────┘   (복도와 트임)    │       문  안방     │
현관 →  복도 ─────────────────────────→  (가장 큼) │
├─문──┬─문─┐──벽──  통로  ──벽─┤─문────┤           │
│ 방3 │욕실│      주방         │ 방5   │    [욕실] │
└─────┴────┴──────────────────┴───────┴───────────┘
```
- 가장 큰 안방(4.4×9.6m)은 복도 끝, 안방 욕실 포함. 두 번째로 큰 방(5.5×4.0m)도 욕실 포함. 공용 욕실은 현관 옆.
- 주방: 냉장고, 키큰장 3, 조리대 2칸(개수대는 창 밑), 상부장, 아일랜드 + 바 의자 2, 6인 식탁, 펜던트 조명 3, 화분 2, 타일 바닥.
- 문 9, 창문 11, 가구 58.
- 템플릿을 만들 때 쓰는 도우미: `rect`(사각형 방 벽 4개, id는 위→오른쪽→아래→왼쪽 순 wall1~4), `put(plan, type, x, y, rot, size?)`.
- **현관 문을 가장 먼저 넣어야** 걷기 모드가 현관에서 시작한다 (`walkStart`가 첫 번째 문을 쓴다).

**`src/interior/unityExport.ts` (75줄): 유니티로 보낼 데이터**
```ts
type UnityScene = {
  format: 'skela-unity-scene'; version: 1; name: string
  spawn: { x, y, lookX, lookY }        // 걷기 시작점(첫 문 안쪽 70cm)과 바라볼 곳(방 가운데)
  ceiling: { height, color }
  groups: { id, kind: 'floor'|'wall'|'opening'|'furniture', name, x, y, rot }[]  // 유니티 Hierarchy 묶음
  boxes: (SceneBox & { group: string; opacity: number })[]   // 상자 id의 첫 부분이 묶음 id
}
```
- `walkStart(plan)`: 걷기 시작 위치. 웹과 유니티가 같이 쓴다.

**`src/interior/studio/main.ts` (956줄) + `studio.css` (137줄): 화면**

| 영역 | 유니티에서는 | 기능 |
|---|---|---|
| 위 메뉴 | | 보기 전환(평면/3D/걷기), 되돌리기·다시하기, 템플릿 고르기, 저장·불러오기, **유니티로 보내기** |
| 왼쪽 위 "가구 넣기" | Prefab | 가구 23종 버튼 → 방 가운데에 넣고 선택 |
| 왼쪽 아래 "방 구성" | Hierarchy | 가구·벽·문창문 목록, 눌러서 선택 |
| 가운데 화면 | Scene | 도구: 선택·이동(V), 벽 그리기(L), 문(O), 창문(N), 화살표 이동(W)/회전(E) |
| 오른쪽 "속성" | Inspector | 가구: 가로·깊이·높이·회전·위치·색, 90° 돌리기(R), 복제, 기본 크기, 삭제(Del). 벽: 길이·높이·두께, 문/창문 넣기. 문창문: 폭·높이·위치. 아무것도 안 골랐을 때: 방 이름, 바닥색·벽색, **넓이(m²와 평)** |

- 보기: 3D(OrbitControls, 카메라 쪽 벽은 반투명), 평면(위에서 본 직교 카메라, 그림자 끔), 걷기(눈높이 160cm, W A S D + 화면 화살표 버튼, 벽 충돌 반경 22cm).
- 가구 끌기: 바닥 평면과 광선 교차, 5cm 격자 스냅. 끌기 중에는 카메라 조작을 막는다(캡처 단계 pointerdown).
- 벽 그리기: 10cm 격자, 기존 벽 끝점 25cm 안이면 붙고, 거의 수평·수직이면 곧게 맞춤. 길이를 cm로 커서 옆에 표시.
- 자동 저장: localStorage. 페이지가 `window.__SKELA_START = '템플릿 id'`를 주면 그 템플릿으로 시작하고 저장 키도 따로 쓴다(64평 전용 페이지가 이 방식).
- 폰: 900px 이하에서 화면 아래로 패널이 쌓이고, 도구는 가로 한 줄. 화살표 기즈모는 손가락 기기에서 기본으로 끔.
- 떨림 방지(화면 쪽): 카메라 near 10cm, 바닥 격자를 바닥 아래(y −2.5)로, 벽 반투명 전환에 30cm 여유.

### 4-4. 아티팩트(바로 열어 보는 웹 페이지)
- Skela Room (모든 템플릿): https://claude.ai/artifact/39z7vKUzgbwkUJRFjexiky
- Skela Room 64평 (64평이 바로 열림): https://claude.ai/artifact/WqWPETnTk8VzBMzw3Fa8U3
- Skela MVP (캐릭터 도구): https://claude.ai/artifact/9FS2dwvp52BCZ9WgNhinxP
- 아티팩트는 Vite로 빌드한 JS/CSS를 HTML 한 파일에 넣어서 올린 것이다(빌드 스크립트는 저장소 밖 임시 폴더에 있었음).

---

## 5. 덩어리 3: 유니티 연결

### 흐름
```
웹 Skela Room ──[유니티로 보내기 → 복사]──▶ 유니티 메뉴 "Skela → 방 불러오기" → 붙여넣기 → 방 만들기
                                          또는 "Skela → 샘플: 64평 복도형 아파트" (클릭 한 번)
```
계산은 웹이 끝내고 유니티는 받은 상자를 그대로 큐브로 놓기만 한다. 그래서 두 화면의 방이 같다.

### 파일 (`unity/SkelaRoom/` → 유니티 `Assets/SkelaRoom/`에 복사)
| 파일 | 줄 | 역할 |
|---|---|---|
| `SkelaRoom.cs` | 196 | JSON 클래스(`SceneFile`, `Group`, `Box`…), `SkelaRoom` 컴포넌트(방 가운데·크기·걷기 시작점·천장), `SkelaRoomBuilder.Parse/Build`. 바닥/벽/문·창문/가구로 나눈 Hierarchy, 색별 머티리얼 공유, 문짝·유리는 충돌 제거, 천장(걷기 때만 켬), 햇빛(없을 때만), 천장 조명을 4.5m 격자로 여러 개. URP와 Built-in 둘 다 지원(반투명 설정 포함) |
| `SkelaRoomViewer.cs` | 217 | Main Camera에 붙는 Play 카메라. 1 둘러보기(끌기 회전, Shift+끌기 이동, 휠 확대), 2 걷기(CharacterController, W A S D, Shift 달리기, 마우스 둘러보기, Q/E 돌기), 3 위에서 보기, F 처음 화면, C 천장, H 도움말. **새 Input System과 예전 Input Manager 둘 다 지원** (`SkelaInput`) |
| `Editor/SkelaRoomWindow.cs` | 116 | 메뉴 "Skela/방 불러오기" 창: 클립보드 붙여넣기, 방 만들기(이전 방 삭제, Undo 등록), 머티리얼을 `Assets/SkelaRoom/Generated`에 에셋으로 저장, 카메라 설정. `BuildRoom(json)`을 공개해 샘플 메뉴도 사용 |
| `Editor/SkelaSamples.cs` | 41 + JSON | 메뉴 "샘플: 64평 복도형 / 60평 복도형 / 60평 5룸". JSON이 파일 안에 들어 있음 |
| `unity/samples/*.json` | | 같은 샘플 JSON 원본 |
| `unity/README.md` | | 넣는 법, 쓰는 법, 키 |

### 주의
- **이 C# 코드는 실제 유니티에서 컴파일·실행해 보지 않았다** (작업 환경에 유니티가 없었음). 사용자 PC에서 첫 확인이 필요하다.
- 유니티 작업은 사용자 PC의 Claude Code + Unity CLI(`unity` 명령)로 하는 것이 원칙이었다.

---

## 6. 테스트 (`tests/`, 총 144개 통과)

| 파일 | 검사 내용 |
|---|---|
| `interior.test.mts` | 벽·문·창문 규칙, 겹침, 상자 분할, 회전, 저장 형식 |
| `templates.test.mts` | 모든 템플릿: 가구가 바깥 벽 안에 있는지, 문 겹침 없음. 60평·64평은 평수(±0.5평), 문·창문 개수, 복도를 막는 가구 없음, 64평은 거실·주방이 가운데인지·안방이 가장 크고 둘째 방이 그다음인지·두 방 안에 변기가 있는지·주방 가구 개수 |
| `unityExport.test.mts` | 모든 상자가 있는 묶음에 속함, 문짝·유리 포함, JSON 왕복, 걷기 시작점 |
| `zfight.test.mts` | **떨림 검사**: 모든 가구에서 같은 평면에 겹치는 면이 없는지, 템플릿의 만나는 벽들 윗면 높이가 다른지 |
| 그 외 | 캐릭터 도구: holeFill, inpainting, undoManager, aiFill, poseDetect, character, timeline, lasso, ownership, pinch, leakBench 등 |

실행: `npm test` · 타입 검사: `npx tsc -p tsconfig.app.json --noEmit`

---

## 7. 지금까지 사용자 요청과 반영 기록 (Skela Room)
1. 웹 3D 인테리어 편집기 첫 버전 (평면/3D/걷기, 가구 끌기, 벽·문·창문, 되돌리기, 템플릿)
2. "그냥 유니티를 쓰면 안 돼?" → 유니티 빌드에는 편집 화면(Inspector 등)이 없어서 결국 다시 만들어야 함을 설명. 웹을 메인, 유니티를 고급 보기로.
3. 유니티로 보내기 + 유니티 스크립트
4. 쓰리룸(32.7평) → 60평 5룸 → 화장실 추가 → 거실 가운데 화장실 삭제 → 거실·주방 구분(벽 + 타일)
5. 복도형 60평 → **복도형 64평**(가운데 거실·주방, 복도 끝 가장 큰 방, 큰 방 두 곳에 욕실)
6. 부엌이 밋밋함 → 주방 가구 6종 추가
7. 떨림(Z-파이팅) 수정 + 자동 검사

---

## 8. 알려진 문제와 다음 할 일
1. **유니티 스크립트 실제 컴파일·실행 확인** (사용자 PC). 오류·분홍 화면(셰이더)·어두움 여부.
2. 작업 브랜치를 **main에 합쳐 GitHub Pages에 배포** (아직 안 함).
3. 가구끼리 겹쳐도 막지 않음. 걷기 모드에서 가구를 통과함(벽만 충돌).
4. 벽 길이를 바꾸면 이어진 벽은 따라오지 않음.
5. 펜던트 조명은 모양만 있고 빛은 없음.
6. 캐릭터 도구: 유료 AI 구멍 채우기 버튼 정리, "몸이 딸려오는" 번짐 문제.
7. 새 가구를 만들 때는 `zfight.test.mts`가 통과하는지 꼭 확인 (같은 평면에 겹치는 면이 있으면 화면이 떨린다).

## 9. 이어서 작업할 때 지킬 것
- 무료·오픈소스만. 유료는 제안하지 않거나 분명히 "유료"라고 표시.
- 기존 기능을 함부로 다시 쓰지 말 것. 바꾸기 전에 어떤 파일을 왜 바꾸는지 설명.
- 계산 코드는 순수 함수로 두고 테스트를 같이 추가.
- 바뀐 것을 사용자가 바로 확인할 수 있게 웹 페이지로 보여줄 것.
- 설명은 짧고 단계별로, 쉬운 한국어로.
