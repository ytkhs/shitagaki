import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, redo } from "@codemirror/commands";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

const SAVE_DELAY_MS = 500;
const NOTICE_MS = 1500;
const FONT_SIZE_DEFAULT = 14;
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 28;

const appWindow = getCurrentWebviewWindow();

const BG = { dark: "#1e1f22", light: "#fbfbf9" } as const;

// CodeMirror の既定テーマは色が固定なので、CSS 変数ではなくモードごとに明示して差し替える
const darkTheme = EditorView.theme(
  {
    "&": { backgroundColor: BG.dark, color: "#d8d8d8" },
    ".cm-content": { caretColor: "#e6e6e6" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#e6e6e6" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      { backgroundColor: "#3a4a6b" },
  },
  { dark: true },
);

const lightTheme = EditorView.theme(
  {
    "&": { backgroundColor: BG.light, color: "#2a2a2a" },
    ".cm-content": { caretColor: "#1a1a1a" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#1a1a1a" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      { backgroundColor: "#cfdcf5" },
  },
  { dark: false },
);

// 表示設定は失っても困らないので localStorage に置き、読めない環境では既定値で動かす
function loadSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても今の表示は変わっているので、次回既定値に戻るだけで済ませる
  }
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const charCount = el<HTMLSpanElement>("char-count");
const notice = el<HTMLSpanElement>("notice");
const savedAtLabel = el<HTMLSpanElement>("saved-at");
const pinToggle = el<HTMLButtonElement>("pin-toggle");
const themeToggle = el<HTMLButtonElement>("theme-toggle");

let noticeTimer: number | undefined;
function showNotice(text: string) {
  clearTimeout(noticeTimer);
  notice.textContent = text;
  noticeTimer = window.setTimeout(() => (notice.textContent = ""), NOTICE_MS);
}

// --- テーマ ---
type Mode = "dark" | "light";
const themeSlot = new Compartment();
const LEGACY_THEME_KEY = "shitagaki.theme";

function applyMode(m: Mode): Promise<unknown> {
  document.documentElement.dataset.theme = m;
  // ボタンには押した後ではなく今のモードを出す。「ライト」と出ているのにダーク表示だと逆に読めてしまう
  themeToggle.textContent = m === "dark" ? "☾ ダーク" : "☀ ライト";
  themeToggle.title = m === "dark" ? "ライトモードにする" : "ダークモードにする";
  // タイトルバーも本文と同じ明暗に揃える。下地の色は描画が間に合わない瞬間に見える色なので、これも揃える
  return Promise.all([appWindow.setTheme(m), appWindow.setBackgroundColor(BG[m])]).catch(console.error);
}

// --- 文字サイズ ---
const FONT_SIZE_KEY = "shitagaki.fontSize";
let fontSize = Number(loadSetting(FONT_SIZE_KEY)) || FONT_SIZE_DEFAULT;

function applyFontSize(size: number) {
  fontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size));
  document.documentElement.style.setProperty("--editor-font-size", `${fontSize}px`);
}

// --- 最前面 ---
const PIN_KEY = "shitagaki.alwaysOnTop";
let pinned = loadSetting(PIN_KEY) === "1";

function applyPinned(on: boolean) {
  pinToggle.classList.toggle("active", on);
  pinToggle.setAttribute("aria-pressed", String(on));
  pinToggle.textContent = on ? "最前面 オン" : "最前面 オフ";
  pinToggle.title = on ? "最前面表示をやめる" : "常に最前面に表示する";
  appWindow.setAlwaysOnTop(on).catch(console.error);
}

// --- 保存 ---
type Draft = { text: string; saved_at: number | null };

const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function showSavedAt(savedAt: number | null) {
  savedAtLabel.textContent = savedAt === null ? "" : `${timeFormat.format(savedAt)} 保存`;
}

// 本文は変更のたびに Rust 側へ渡しておき、ファイルへの書き込みだけ入力が止まるまで待つ。
// こうしておけば待っている間に終了しても、Rust 側が終了時に書き出せる
let saveTimer: number | undefined;
function scheduleSave(text: string) {
  invoke("stage_draft", { text }).catch(console.error);
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    invoke<number | null>("save_draft")
      .then((savedAt) => savedAt !== null && showSavedAt(savedAt))
      .catch((e) => {
        console.error(e);
        showNotice("保存に失敗しました");
      });
  }, SAVE_DELAY_MS);
}

// --- 文字数 ---
// 絵文字や結合文字を 1 字と数えるため、UTF-16 の長さではなく書記素で数える。改行は字数に含めない
const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const numberFormat = new Intl.NumberFormat("ja-JP");

function countChars(text: string): number {
  let n = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (segment !== "\n" && segment !== "\r\n") n++;
  }
  return n;
}

let totalCharsText = "0";

function updateCharCount(state: EditorState, docChanged: boolean) {
  if (docChanged) {
    totalCharsText = numberFormat.format(countChars(state.doc.toString()));
  }
  const selected = state.selection.ranges
    .filter((r) => !r.empty)
    .reduce((sum, r) => sum + countChars(state.sliceDoc(r.from, r.to)), 0);
  charCount.textContent = selected > 0 ? `${numberFormat.format(selected)} / ${totalCharsText} 字` : `${totalCharsText} 字`;
}

// --- エディタ ---
function copyAll(view: EditorView): boolean {
  writeText(view.state.doc.toString())
    .then(() => showNotice("全文をコピーしました"))
    .catch((e) => {
      console.error(e);
      showNotice("コピーに失敗しました");
    });
  return true;
}

// 起動時の読み込みで例外が起きても非表示のまま残らないよう、最後に必ずウィンドウを表示する
try {
  // テーマは起動時に Rust 側がウィンドウを作る前に読むので、localStorage ではなくアプリのデータフォルダに置く
  let mode: Mode = "dark";
  try {
    mode = await invoke<Mode>("get_theme");
  } catch (e) {
    console.error(e);
  }
  // 以前の版は localStorage に保存していたので、残っていれば一度だけ引き継ぐ
  const legacyMode = loadSetting(LEGACY_THEME_KEY);
  if (legacyMode === "light" || legacyMode === "dark") {
    mode = legacyMode;
    await invoke("save_theme", { theme: mode }).catch(console.error);
    try {
      localStorage.removeItem(LEGACY_THEME_KEY);
    } catch {
      // 消せなくても毎回同じ値で上書きするだけなので害はない
    }
  }

  applyFontSize(fontSize);
  applyPinned(pinned);
  await applyMode(mode);

  let draft: Draft = { text: "", saved_at: null };
  let loadFailed = false;
  try {
    draft = await invoke<Draft>("load_draft");
  } catch (e) {
    console.error(e);
    loadFailed = true;
  }
  showSavedAt(draft.saved_at);

  const view = new EditorView({
    parent: el("editor"),
    state: EditorState.create({
      doc: draft.text,
      extensions: [
        themeSlot.of(mode === "dark" ? darkTheme : lightTheme),
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        // @codemirror/commands の historyKeymap は Windows の Ctrl+Shift+Z を割り当てないので明示する
        keymap.of([{ key: "Mod-Shift-z", run: redo, preventDefault: true }, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) scheduleSave(u.state.doc.toString());
          if (u.docChanged || u.selectionSet) updateCharCount(u.state, u.docChanged);
        }),
      ],
    }),
  });

  updateCharCount(view.state, true);

  // ⌘+ は JIS 配列だと Shift 付きの ⌘; になるなど配列で key が揺れるので、CodeMirror の keymap ではなく key の文字で判定する。
  // 全文コピーもボタン等にフォーカスがあるときを含め常に効くよう document 側で拾う
  const isMac = navigator.platform.startsWith("Mac");
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.isComposing) return;
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.altKey) return;
      if (e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        e.stopPropagation();
        copyAll(view);
        return;
      }
      let next: number;
      if (e.key === "+" || e.key === "=" || e.key === ";") next = fontSize + 1;
      else if (e.key === "-") next = fontSize - 1;
      else if (e.key === "0") next = FONT_SIZE_DEFAULT;
      else return;
      e.preventDefault();
      e.stopPropagation();
      applyFontSize(next);
      storeSetting(FONT_SIZE_KEY, String(fontSize));
      view.requestMeasure();
      showNotice(`文字サイズ ${fontSize}px`);
    },
    true,
  );

  // 他アプリから ⌃⌥S 等で戻ったときや、余白クリック後でもすぐ書けるようフォーカスを戻す
  window.addEventListener("focus", () => view.focus());

  // ボタンにフォーカスが移ると入力を続けられないので、押してもカーソルは本文に残す
  for (const button of [pinToggle, themeToggle]) {
    button.addEventListener("mousedown", (e) => e.preventDefault());
  }

  themeToggle.addEventListener("click", () => {
    mode = mode === "dark" ? "light" : "dark";
    applyMode(mode);
    invoke("save_theme", { theme: mode }).catch(console.error);
    view.dispatch({ effects: themeSlot.reconfigure(mode === "dark" ? darkTheme : lightTheme) });
    view.focus();
  });

  pinToggle.addEventListener("click", () => {
    pinned = !pinned;
    applyPinned(pinned);
    storeSetting(PIN_KEY, pinned ? "1" : "0");
    view.focus();
  });

  if (loadFailed) {
    showNotice("下書きの読み込みに失敗しました");
  }
  view.focus();
} finally {
  appWindow.show().catch(console.error);
}
