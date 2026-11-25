# Skela Room → 유니티

웹 Skela Room에서 만든 방을 유니티로 가져와 자세히 보는 스크립트예요. 무료이고 추가 패키지가 필요 없어요.

## 넣는 방법 (한 번만)

유니티 프로젝트(예: `skella`)의 `Assets` 폴더 안에 이 `SkelaRoom` 폴더를 통째로 복사해요.

```
Assets/
  SkelaRoom/
    SkelaRoom.cs          방 만들기 (JSON → 큐브)
    SkelaRoomViewer.cs    Play 화면 카메라 (둘러보기 / 걷기 / 위에서 보기)
    Editor/
      SkelaRoomWindow.cs  메뉴 "Skela → 방 불러오기" 창
      SkelaSamples.cs     메뉴 "Skela → 샘플: 60평 …" (붙여넣기 없이 바로 만들기)
```

유니티로 돌아가면 잠깐 컴파일한 뒤 위 메뉴에 **Skela**가 생겨요.

## 바로 해보기: 60평 샘플

**Skela → 샘플: 60평 복도형 아파트** (또는 5룸 아파트)를 누르면 붙여넣기 없이 바로 만들어져요. 그다음 ▶ Play.

## 쓰는 방법 (방을 바꿀 때마다)

1. 웹 Skela Room → **유니티로 보내기** → **복사**
2. 유니티 → **Skela → 방 불러오기**
3. **클립보드에서 붙여넣기** → **방 만들기**
4. 위의 ▶ **Play**

| 키 | 하는 일 |
|---|---|
| 1 | 둘러보기 (마우스 끌기: 돌리기, Shift+끌기: 옮기기, 휠: 확대) |
| 2 | 걷기 (W A S D, Shift: 빠르게, 마우스 끌기: 둘러보기, C: 천장) |
| 3 | 위에서 보기 |
| F | 처음 화면으로 |
| H | 도움말 숨기기 |

- 다시 만들면 이전 방은 지워져요(Ctrl+Z로 되살릴 수 있어요).
- 색 머티리얼은 `Assets/SkelaRoom/Generated`에 저장돼요.
- 만든 방은 Hierarchy에서 **바닥 / 벽 / 문·창문 / 가구**로 나뉘어 보여요. 가구는 묶음째 골라서 유니티에서 옮길 수 있어요.
- URP와 기본(Built-in) 렌더 파이프라인, 새 Input System과 예전 Input Manager 모두 지원해요.

## 좌표

웹 평면도(cm, y 아래쪽) → 유니티(m, z 앞쪽): `(x, y, 높이) → (x/100, 높이/100, -y/100)`.
상자 계산은 웹(`src/interior/geometry.ts`, `unityExport.ts`)이 하고 유니티는 놓기만 해서, 두 화면의 방이 항상 같아요.
