// Skela Room 보기 카메라: Play를 누르면 방을 둘러보고(1), 걸어보고(2), 위에서 본다(3).
// 새 Input System과 예전 Input Manager 둘 다에서 동작한다.
using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace Skela
{
    [RequireComponent(typeof(Camera))]
    public class SkelaRoomViewer : MonoBehaviour
    {
        public enum Mode { Orbit, Walk, Top }
        public Mode mode = Mode.Orbit;
        [Tooltip("마우스로 돌리는 속도")] public float lookSpeed = 2.5f;
        [Tooltip("걷는 속도 (m/초). Shift를 누르면 두 배")] public float walkSpeed = 1.6f;
        [Tooltip("눈높이 (m)")] public float eyeHeight = 1.6f;
        public bool showHelp = true;

        SkelaRoom room;
        Camera cam;
        CharacterController cc;
        Vector3 target;
        float dist = 8f, yaw = 20f, pitch = 45f, topYaw;
        float wYaw, wPitch, vy;

        void Start()
        {
            cam = GetComponent<Camera>();
            room = FindFirstObjectByType<SkelaRoom>();
            if (room == null) return;
            cam.nearClipPlane = 0.05f;
            SetMode(Mode.Orbit);
            ResetView();
        }

        public void ResetView()
        {
            if (room == null) return;
            target = room.center + Vector3.up * 0.6f;
            dist = room.size * 1.35f;
            yaw = 20f; pitch = 45f; topYaw = 0f;
        }

        // 에디터에서 Play 전에도 Game 화면에 방이 보이게 할 때 쓴다
        public void PlaceForPreview(SkelaRoom r)
        {
            room = r;
            ResetView();
            ApplyOrbit(pitch, yaw);
        }

        void SetMode(Mode m)
        {
            mode = m;
            if (cc == null)
            {
                cc = GetComponent<CharacterController>();
                if (cc == null) cc = gameObject.AddComponent<CharacterController>();
                cc.height = 1.7f; cc.radius = 0.25f; cc.center = new Vector3(0, -0.75f, 0);
                cc.stepOffset = 0.25f; cc.slopeLimit = 50f;
            }
            cc.enabled = false;
            if (m == Mode.Walk)
            {
                transform.position = room.spawnPos + Vector3.up * eyeHeight;
                var dir = room.spawnLook - room.spawnPos;
                wYaw = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
                wPitch = 5f;
                vy = 0f;
                cc.enabled = true;
            }
            if (room.ceiling != null) room.ceiling.SetActive(m == Mode.Walk);
        }

        void Update()
        {
            if (room == null) return;
            if (SkelaInput.Down(SkelaInput.K.One)) SetMode(Mode.Orbit);
            if (SkelaInput.Down(SkelaInput.K.Two)) SetMode(Mode.Walk);
            if (SkelaInput.Down(SkelaInput.K.Three)) SetMode(Mode.Top);
            if (SkelaInput.Down(SkelaInput.K.F)) { ResetView(); if (mode == Mode.Walk) SetMode(Mode.Walk); }
            if (SkelaInput.Down(SkelaInput.K.H)) showHelp = !showHelp;
            if (SkelaInput.Down(SkelaInput.K.C) && room.ceiling != null) room.ceiling.SetActive(!room.ceiling.activeSelf);

            var d = SkelaInput.MouseDelta();
            bool shift = SkelaInput.Held(SkelaInput.K.Shift);
            float dt = Time.deltaTime;

            if (mode == Mode.Walk)
            {
                if (SkelaInput.Button(0) || SkelaInput.Button(1))
                {
                    wYaw += d.x * lookSpeed;
                    wPitch = Mathf.Clamp(wPitch - d.y * lookSpeed, -80f, 80f);
                }
                if (SkelaInput.Held(SkelaInput.K.Q)) wYaw -= 90f * dt;
                if (SkelaInput.Held(SkelaInput.K.E)) wYaw += 90f * dt;
                transform.rotation = Quaternion.Euler(wPitch, wYaw, 0);
                var move = new Vector3(Axis(SkelaInput.K.D, SkelaInput.K.A), 0, Axis(SkelaInput.K.W, SkelaInput.K.S));
                move = Quaternion.Euler(0, wYaw, 0) * Vector3.ClampMagnitude(move, 1f) * walkSpeed * (shift ? 2f : 1f);
                vy = cc.isGrounded ? -1f : vy - 9.8f * dt;
                cc.Move((move + Vector3.up * vy) * dt);
                return;
            }

            // 둘러보기 / 위에서 보기
            bool pan = SkelaInput.Button(2) || (SkelaInput.Button(0) && shift) || (mode == Mode.Top && (SkelaInput.Button(0) || SkelaInput.Button(1)));
            if (pan)
            {
                float k = dist * 0.004f * lookSpeed;
                var right = transform.right; right.y = 0; right.Normalize();
                var fwd = Vector3.Cross(right, Vector3.up);
                target -= (right * d.x - fwd * d.y) * k;
            }
            else if (SkelaInput.Button(0) || SkelaInput.Button(1))
            {
                yaw += d.x * lookSpeed;
                pitch = Mathf.Clamp(pitch - d.y * lookSpeed, 5f, 89f);
            }
            // WASD로 보는 곳을 옮긴다
            var mv = new Vector3(Axis(SkelaInput.K.D, SkelaInput.K.A), 0, Axis(SkelaInput.K.W, SkelaInput.K.S));
            if (mv != Vector3.zero)
            {
                float ry = mode == Mode.Top ? topYaw : yaw;
                target += Quaternion.Euler(0, ry, 0) * mv * dist * 0.6f * dt;
            }
            dist = Mathf.Clamp(dist * (1f - SkelaInput.Scroll() * 0.1f), 0.5f, room.size * 4f);
            if (mode == Mode.Top) ApplyOrbit(89.9f, topYaw); else ApplyOrbit(pitch, yaw);
        }

        void ApplyOrbit(float p, float y)
        {
            var rot = Quaternion.Euler(p, y, 0);
            transform.position = target + rot * new Vector3(0, 0, -dist);
            transform.rotation = rot;
        }

        static float Axis(SkelaInput.K plus, SkelaInput.K minus) => (SkelaInput.Held(plus) ? 1f : 0f) - (SkelaInput.Held(minus) ? 1f : 0f);

        void OnGUI()
        {
            if (room == null)
            {
                GUI.Box(new Rect(10, 10, 360, 50), "방이 없어요.\n메뉴 Skela → 방 불러오기에서 방을 먼저 만들어주세요.");
                return;
            }
            if (!showHelp) { GUI.Label(new Rect(12, 8, 200, 22), "H: 도움말"); return; }
            string now = mode == Mode.Orbit ? "둘러보기" : mode == Mode.Walk ? "걷기" : "위에서 보기";
            string body = mode == Mode.Walk
                ? "W A S D: 걷기 (Shift: 빠르게)\n마우스 끌기: 둘러보기 · Q/E: 돌기\nC: 천장 켜기/끄기 · F: 처음 위치로"
                : "마우스 끌기: " + (mode == Mode.Top ? "옮기기" : "돌리기 (Shift+끌기: 옮기기)") + "\n휠: 확대/축소 · W A S D: 옮기기\nF: 처음 화면";
            GUI.Box(new Rect(10, 10, 300, 118), "");
            GUI.Label(new Rect(20, 16, 280, 22), $"{room.roomName} · 지금: {now}");
            GUI.Label(new Rect(20, 38, 280, 22), "1 둘러보기 · 2 걷기 · 3 위에서 보기");
            GUI.Label(new Rect(20, 60, 280, 66), body + "\nH: 도움말 숨기기");
        }
    }

    // 새 Input System / 예전 Input Manager 어느 쪽이든 같은 함수로 읽는다
    public static class SkelaInput
    {
        public enum K { W, A, S, D, Q, E, Shift, One, Two, Three, F, C, H }

#if ENABLE_INPUT_SYSTEM
        static Key Map(K k)
        {
            switch (k)
            {
                case K.W: return Key.W; case K.A: return Key.A; case K.S: return Key.S; case K.D: return Key.D;
                case K.Q: return Key.Q; case K.E: return Key.E; case K.Shift: return Key.LeftShift;
                case K.One: return Key.Digit1; case K.Two: return Key.Digit2; case K.Three: return Key.Digit3;
                case K.F: return Key.F; case K.C: return Key.C; default: return Key.H;
            }
        }
        public static bool Held(K k)
        {
            var kb = Keyboard.current;
            if (kb == null) return false;
            if (k == K.Shift) return kb.leftShiftKey.isPressed || kb.rightShiftKey.isPressed;
            return kb[Map(k)].isPressed;
        }
        public static bool Down(K k) { var kb = Keyboard.current; return kb != null && kb[Map(k)].wasPressedThisFrame; }
        public static Vector2 MouseDelta() { var m = Mouse.current; return m == null ? Vector2.zero : m.delta.ReadValue() * 0.1f; }
        public static float Scroll()
        {
            var m = Mouse.current;
            if (m == null) return 0f;
            float y = m.scroll.ReadValue().y;
            if (Mathf.Abs(y) > 10f) y /= 120f; // 휠 한 칸이 120으로 오는 환경
            return Mathf.Clamp(y, -3f, 3f);
        }
        public static bool Button(int i)
        {
            var m = Mouse.current;
            if (m == null) return false;
            return i == 0 ? m.leftButton.isPressed : i == 1 ? m.rightButton.isPressed : m.middleButton.isPressed;
        }
#else
        static KeyCode Map(K k)
        {
            switch (k)
            {
                case K.W: return KeyCode.W; case K.A: return KeyCode.A; case K.S: return KeyCode.S; case K.D: return KeyCode.D;
                case K.Q: return KeyCode.Q; case K.E: return KeyCode.E; case K.Shift: return KeyCode.LeftShift;
                case K.One: return KeyCode.Alpha1; case K.Two: return KeyCode.Alpha2; case K.Three: return KeyCode.Alpha3;
                case K.F: return KeyCode.F; case K.C: return KeyCode.C; default: return KeyCode.H;
            }
        }
        public static bool Held(K k) => k == K.Shift ? (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift)) : Input.GetKey(Map(k));
        public static bool Down(K k) => Input.GetKeyDown(Map(k));
        public static Vector2 MouseDelta() => new Vector2(Input.GetAxis("Mouse X"), Input.GetAxis("Mouse Y"));
        public static float Scroll() => Mathf.Clamp(Input.mouseScrollDelta.y, -3f, 3f);
        public static bool Button(int i) => Input.GetMouseButton(i);
#endif
    }
}
