// Skela Room → 유니티: 웹에서 "유니티로 보내기"로 복사한 JSON을 큐브로 된 방으로 만든다.
//
// 좌표 변환은 이 파일의 ToUnity 한 곳에서만 한다.
//   웹 평면도: cm, x 오른쪽, y 아래쪽(화면 기준), 회전은 위에서 봐서 시계 방향 +
//   유니티:    m,  x 오른쪽, z 앞쪽(위에서 봤을 때 화면 위), y 위, 회전 Y + 도 위에서 봐서 시계 방향
//   → (x, y, 높이) cm  ==>  (x/100, 높이/100, -y/100) m, 회전은 그대로.
// 상자 계산(벽의 문·창문 구멍, 가구 상자 조합)은 웹(geometry.ts)이 이미 끝냈으니 여기서는 그대로 놓기만 한다.
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Skela
{
    [Serializable] public class SceneFile { public string format; public int version; public string name; public Spawn spawn; public Ceiling ceiling; public Group[] groups; public Box[] boxes; }
    [Serializable] public class Spawn { public float x, y, lookX, lookY; }
    [Serializable] public class Ceiling { public float height; public string color; }
    [Serializable] public class Group { public string id, kind, name; public float x, y, rot; }
    [Serializable] public class Box { public string kind, id, group, color; public float cx, cy, cz, w, h, d, rotDeg, opacity; }

    // 만들어진 방의 맨 위 오브젝트에 붙는다. 보기 카메라(SkelaRoomViewer)가 이 값을 읽는다.
    public class SkelaRoom : MonoBehaviour
    {
        public string roomName;
        public Vector3 center;      // 방 가운데 (바닥 높이)
        public float size = 6f;     // 방의 긴 변 (m)
        public Vector3 spawnPos;    // 걷기 시작 위치 (바닥 높이)
        public Vector3 spawnLook;   // 처음 바라볼 곳 (바닥 높이)
        public GameObject ceiling;  // 걷기 모드에서만 켜는 천장
    }

    public static class SkelaRoomBuilder
    {
        const float CM = 0.01f;

        public static Vector3 ToUnity(float x, float y, float height) => new Vector3(x * CM, height * CM, -y * CM);

        public static SceneFile Parse(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) throw new Exception("붙여넣은 내용이 없어요. 웹 Skela Room에서 '유니티로 보내기' → '복사'를 먼저 눌러주세요.");
            SceneFile f;
            try { f = JsonUtility.FromJson<SceneFile>(json.Trim()); }
            catch (Exception) { throw new Exception("JSON 형식이 아니에요. 웹에서 복사한 내용을 그대로 붙여넣어 주세요."); }
            if (f == null || f.format != "skela-unity-scene")
                throw new Exception("Skela Room의 '유니티로 보내기'에서 복사한 내용이 아니에요. ('저장 · 불러오기'의 내용과는 달라요.)");
            if (f.version != 1) throw new Exception("지원하지 않는 버전이에요. 이 스크립트를 최신으로 바꿔주세요.");
            if (f.boxes == null || f.boxes.Length == 0) throw new Exception("방에 아무것도 없어요.");
            if (f.groups == null) f.groups = new Group[0];
            return f;
        }

        // persist: 에디터에서 머티리얼을 에셋으로 저장할 때 쓴다 (없으면 메모리에만 만든다)
        public static GameObject Build(SceneFile f, Func<string, Material, Material> persist = null)
        {
            var root = new GameObject("Skela Room - " + f.name);
            var room = root.AddComponent<SkelaRoom>();
            room.roomName = f.name;

            // 1) 분류 폴더와 묶음 (Hierarchy에서 바닥/벽/문·창문/가구로 보인다)
            var cats = new Dictionary<string, Transform>();
            Transform Cat(string kind)
            {
                if (cats.TryGetValue(kind, out var t)) return t;
                string label = kind == "floor" ? "바닥" : kind == "wall" ? "벽" : kind == "opening" ? "문·창문" : kind == "furniture" ? "가구" : "기타";
                var go = new GameObject(label);
                go.transform.SetParent(root.transform, false);
                return cats[kind] = go.transform;
            }
            foreach (var k in new[] { "floor", "wall", "opening", "furniture" }) Cat(k);
            var groups = new Dictionary<string, Transform>();
            foreach (var g in f.groups)
            {
                var go = new GameObject(g.name);
                go.transform.SetParent(Cat(g.kind), false);
                go.transform.position = ToUnity(g.x, g.y, 0);
                go.transform.rotation = Quaternion.Euler(0, g.rot, 0);
                groups[g.id] = go.transform;
            }

            // 2) 상자 → 큐브
            var mats = new Dictionary<string, Material>();
            Bounds? floor = null;
            foreach (var b in f.boxes)
            {
                var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
                cube.name = b.id;
                cube.transform.position = ToUnity(b.cx, b.cz, b.cy);
                cube.transform.rotation = Quaternion.Euler(0, b.rotDeg, 0);
                cube.transform.localScale = new Vector3(b.w, b.h, b.d) * CM;
                cube.transform.SetParent(groups.TryGetValue(b.group, out var parent) ? parent : Cat("other"), true);
                float opacity = b.opacity <= 0 ? 1f : b.opacity;
                var r = cube.GetComponent<MeshRenderer>();
                r.sharedMaterial = GetMat(mats, b.color, opacity, persist);
                if (opacity < 0.99f) r.shadowCastingMode = ShadowCastingMode.Off;
                // 문짝과 유리는 걸어서 지나갈 수 있게 충돌을 뺀다
                if (b.kind == "door" || b.kind == "glass") Kill(cube.GetComponent<Collider>());
                if (b.kind == "floor") floor = new Bounds(cube.transform.position, cube.transform.localScale);
            }

            // 3) 방 정보 (카메라가 쓴다)
            var fb = floor ?? new Bounds(Vector3.zero, new Vector3(6, 0, 6));
            room.center = new Vector3(fb.center.x, 0, fb.center.z);
            room.size = Mathf.Max(fb.size.x, fb.size.z, 3f);
            room.spawnPos = ToUnity(f.spawn.x, f.spawn.y, 0);
            room.spawnLook = ToUnity(f.spawn.lookX, f.spawn.lookY, 0);

            // 4) 천장 (걷기 모드에서만 보인다)
            float ch = f.ceiling != null && f.ceiling.height > 0 ? f.ceiling.height : 250f;
            var ceil = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ceil.name = "천장";
            ceil.transform.SetParent(root.transform, false);
            ceil.transform.position = new Vector3(room.center.x, ch * CM + 0.01f, room.center.z);
            ceil.transform.localScale = new Vector3(fb.size.x, 0.02f, fb.size.z);
            ceil.GetComponent<MeshRenderer>().sharedMaterial = GetMat(mats, f.ceiling != null ? f.ceiling.color : "#f4f4f2", 1f, persist);
            ceil.GetComponent<MeshRenderer>().shadowCastingMode = ShadowCastingMode.Off;
            Kill(ceil.GetComponent<Collider>());
            ceil.SetActive(false);
            room.ceiling = ceil;

            // 5) 조명: 햇빛이 없으면 하나, 방 안 조명 하나
            bool hasSun = false;
            foreach (var l in UnityEngine.Object.FindObjectsByType<Light>(FindObjectsSortMode.None))
                if (l.type == LightType.Directional && l.enabled) hasSun = true;
            if (!hasSun)
            {
                var sun = new GameObject("햇빛").AddComponent<Light>();
                sun.transform.SetParent(root.transform, false);
                sun.type = LightType.Directional;
                sun.intensity = 1.1f;
                sun.shadows = LightShadows.Soft;
                sun.transform.rotation = Quaternion.Euler(55, -35, 0);
            }
            var lamp = new GameObject("천장 조명").AddComponent<Light>();
            lamp.transform.SetParent(root.transform, false);
            lamp.type = LightType.Point;
            lamp.range = room.size * 1.2f;
            lamp.intensity = 1.5f;
            lamp.color = new Color(1f, 0.95f, 0.86f);
            lamp.shadows = LightShadows.None;
            lamp.transform.position = new Vector3(room.center.x, ch * CM - 0.2f, room.center.z);

            return root;
        }

        static void Kill(UnityEngine.Object o)
        {
            if (o == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(o); else UnityEngine.Object.DestroyImmediate(o);
        }

        static Material GetMat(Dictionary<string, Material> cache, string hex, float opacity, Func<string, Material, Material> persist)
        {
            string key = (hex ?? "#c0c0c0").TrimStart('#').ToLowerInvariant() + (opacity < 0.99f ? "_a" + Mathf.RoundToInt(opacity * 100) : "");
            if (cache.TryGetValue(key, out var m)) return m;
            m = NewMat(hex, opacity);
            m.name = "Skela_" + key;
            if (persist != null) m = persist(key, m);
            return cache[key] = m;
        }

        // URP와 기본(Built-in) 렌더 파이프라인을 모두 지원한다
        public static Material NewMat(string hex, float opacity)
        {
            bool urp = GraphicsSettings.currentRenderPipeline != null;
            var sh = urp ? Shader.Find("Universal Render Pipeline/Lit") : Shader.Find("Standard");
            if (sh == null) sh = Shader.Find("Standard") ?? Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Diffuse");
            var m = new Material(sh);
            if (!ColorUtility.TryParseHtmlString(hex ?? "", out var c)) c = new Color(0.75f, 0.75f, 0.75f);
            c.a = opacity;
            m.color = c;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", opacity < 0.99f ? 0.9f : 0.25f);
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", opacity < 0.99f ? 0.9f : 0.25f);
            if (opacity < 0.99f)
            {
                m.SetOverrideTag("RenderType", "Transparent");
                m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                m.SetFloat("_ZWrite", 0);
                if (m.HasProperty("_Surface")) { m.SetFloat("_Surface", 1); m.SetFloat("_Blend", 0); m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT"); }
                if (m.HasProperty("_Mode")) { m.SetFloat("_Mode", 2); m.EnableKeyword("_ALPHABLEND_ON"); }
                m.renderQueue = (int)RenderQueue.Transparent;
            }
            return m;
        }
    }
}
