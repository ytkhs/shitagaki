import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const SAVE_DELAY_MS = 500;
const APP_NAME = "shitagaki";

// CodeMirror の既定テーマは明るい背景前提でカーソルが黒いので、ダーク用に上書きする
const darkTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#1e1f22", color: "#d8d8d8" },
    ".cm-content": { caretColor: "#e6e6e6" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#e6e6e6" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      { backgroundColor: "#3a4a6b" },
  },
  { dark: true },
);

type Draft = { text: string; saved_at: number | null };

const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function showSavedAt(savedAt: number | null) {
  const title = savedAt === null ? APP_NAME : `${APP_NAME} — ${timeFormat.format(savedAt)} 保存`;
  getCurrentWindow().setTitle(title).catch(console.error);
}

const draft = await invoke<Draft>("load_draft");
showSavedAt(draft.saved_at);

let saveTimer: number | undefined;
function scheduleSave(view: EditorView) {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    invoke<number>("save_draft", { text: view.state.doc.toString() })
      .then(showSavedAt)
      .catch(console.error);
  }, SAVE_DELAY_MS);
}

const view = new EditorView({
  parent: document.getElementById("editor")!,
  state: EditorState.create({
    doc: draft.text,
    extensions: [
      darkTheme,
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) scheduleSave(u.view);
      }),
    ],
  }),
});
view.focus();
