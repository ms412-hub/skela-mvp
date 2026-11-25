// 유니티 메뉴 "Skela → 방 불러오기" 창: 웹에서 복사한 방을 붙여넣고 버튼 하나로 만든다.
using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Skela
{
    public class SkelaRoomWindow : EditorWindow
    {
        const string MatDir = "Assets/SkelaRoom/Generated";
        string json = "";
        Vector2 scroll;
        string msg;
        MessageType msgType = MessageType.Info;

        [MenuItem("Skela/방 불러오기")]
        static void Open()
        {
            var w = GetWindow<SkelaRoomWindow>("Skela Room");
            w.minSize = new Vector2(340, 360);
        }

        void OnGUI()
        {
            EditorGUILayout.HelpBox(
                "1. 웹 Skela Room에서 '유니티로 보내기' → '복사'\n" +
                "2. 아래 '클립보드에서 붙여넣기'\n" +
                "3. '방 만들기'\n" +
                "4. 위의 ▶ Play → 1 둘러보기 · 2 걷기 · 3 위에서 보기", MessageType.Info);

            if (GUILayout.Button("클립보드에서 붙여넣기", GUILayout.Height(28)))
            {
                json = EditorGUIUtility.systemCopyBuffer ?? "";
                msg = null;
                GUI.FocusControl(null);
            }
            EditorGUILayout.LabelField(string.IsNullOrEmpty(json) ? "붙여넣은 내용 (비어 있음)" : $"붙여넣은 내용 ({json.Length:N0}자)", EditorStyles.miniLabel);
            scroll = EditorGUILayout.BeginScrollView(scroll, GUILayout.ExpandHeight(true));
            json = EditorGUILayout.TextArea(json, GUILayout.ExpandHeight(true));
            EditorGUILayout.EndScrollView();

            using (new EditorGUI.DisabledScope(string.IsNullOrWhiteSpace(json) || EditorApplication.isPlaying))
            {
                if (GUILayout.Button(EditorApplication.isPlaying ? "Play를 멈춘 뒤에 만들 수 있어요" : "방 만들기", GUILayout.Height(34))) Build();
            }
            if (!string.IsNullOrEmpty(msg)) EditorGUILayout.HelpBox(msg, msgType);
        }

        void Build()
        {
            try
            {
                var f = SkelaRoomBuilder.Parse(json);
                // 전에 만든 방은 지운다 (Ctrl+Z로 되살릴 수 있다)
                foreach (var old in FindObjectsByType<SkelaRoom>(FindObjectsSortMode.None))
                    Undo.DestroyObjectImmediate(old.gameObject);

                var root = SkelaRoomBuilder.Build(f, Persist);
                Undo.RegisterCreatedObjectUndo(root, "Skela 방 만들기");
                var room = root.GetComponent<SkelaRoom>();
                SetupCamera(room);

                Selection.activeGameObject = root;
                SceneView.lastActiveSceneView?.FrameSelected();
                EditorSceneManager.MarkSceneDirty(root.scene);
                AssetDatabase.SaveAssets();
                msg = $"'{f.name}' 방을 만들었어요 (상자 {f.boxes.Length}개).\n위의 ▶ Play를 눌러 둘러보세요. 장면을 저장하려면 Ctrl+S.";
                msgType = MessageType.Info;
            }
            catch (Exception e)
            {
                msg = e.Message;
                msgType = MessageType.Error;
            }
        }

        // 머티리얼을 에셋으로 저장해야 장면을 저장·다시 열어도 색이 남는다. 같은 색은 다시 쓴다.
        static Material Persist(string key, Material m)
        {
            if (!AssetDatabase.IsValidFolder("Assets/SkelaRoom")) AssetDatabase.CreateFolder("Assets", "SkelaRoom");
            if (!AssetDatabase.IsValidFolder(MatDir)) AssetDatabase.CreateFolder("Assets/SkelaRoom", "Generated");
            string path = $"{MatDir}/Skela_{key}.mat";
            var existing = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (existing != null && existing.shader == m.shader) { DestroyImmediate(m); return existing; }
            if (existing != null) AssetDatabase.DeleteAsset(path);
            AssetDatabase.CreateAsset(m, path);
            return m;
        }

        // Main Camera에 보기 스크립트를 붙이고, Play 전에도 Game 화면에 방이 보이게 놓는다
        static void SetupCamera(SkelaRoom room)
        {
            var cam = Camera.main;
            if (cam == null)
            {
                var go = new GameObject("Main Camera") { tag = "MainCamera" };
                cam = go.AddComponent<Camera>();
                go.AddComponent<AudioListener>();
                Undo.RegisterCreatedObjectUndo(go, "Skela 카메라");
            }
            var viewer = cam.GetComponent<SkelaRoomViewer>();
            if (viewer == null) viewer = Undo.AddComponent<SkelaRoomViewer>(cam.gameObject);
            Undo.RecordObject(cam.transform, "Skela 카메라 위치");
            cam.nearClipPlane = 0.05f;
            viewer.PlaceForPreview(room);
        }
    }
}
