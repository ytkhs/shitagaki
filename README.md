# shitagaki

下書き専用の小さなテキストエディタです。開いてすぐ書けて、書いた内容は自動で保存されます。

チャットやメールに貼る前の文章を一時的に置いておく場所として使う想定です。ファイルを開く・保存するという操作はありません。

## 機能

- 入力が止まって 0.5 秒後に自動保存し、次に起動すると前回の本文が戻る
- 行番号なし、折り返しあり
- コピーすると書式のないプレーンテキストだけがクリップボードに入る
- ウィンドウの大きさと位置を覚えておき、次の起動で同じ状態で開く
- 最後のウィンドウを閉じるとアプリも終了する。保存待ちの入力も終了時に書き出す
- 二重には起動しない。2 回目に起動すると、開いているウィンドウが前に出る

下のバーに次のものが並びます。

| 場所 | 内容 |
|---|---|
| 左 | 文字数（改行は数えない。絵文字や結合文字は 1 字） |
| 右 | 最終保存時刻、最前面表示のオン・オフ、ダーク・ライトの切り替え |

ボタンには今の状態が出ます。押しても入力位置は本文に残るので、そのまま書き続けられます。

### ショートカット

Windows では ⌘ を Ctrl に読み替えてください。⌃⌥S は他のアプリがすでに使っていると効きません。

| キー | 動作 |
|---|---|
| ⌃⌥S | どのアプリを使っていても shitagaki を前に出す（Windows は Ctrl+Alt+S） |
| ⌘⇧C | 本文をすべてコピー |
| ⌘+ / ⌘- | 文字を大きく / 小さく（10〜28px） |
| ⌘0 | 文字の大きさを元に戻す（14px） |
| ⌘Z / ⌘⇧Z | 元に戻す / やり直す |

### 保存されるもの

本文などは次のフォルダに置かれます。中身はただのテキストと JSON です。

- Mac: `~/Library/Application Support/com.ytkhs.shitagaki/`
- Windows: `%APPDATA%\com.ytkhs.shitagaki\`

| ファイル | 内容 |
|---|---|
| `draft.txt` | 本文 |
| `theme.txt` | ダーク・ライトの選択 |
| `.window-state.json` | ウィンドウの大きさと位置 |

文字の大きさと最前面表示の設定は、アプリ内の webview の保存領域に入ります。

## ダウンロード

[Releases](https://github.com/ytkhs/shitagaki/releases) から取れます。

- Windows: `shitagaki_<version>_x64-setup.exe`
- Mac（Apple Silicon）: `shitagaki_<version>_aarch64.dmg`

署名していないので、初回起動時に止められます。

- Windows: SmartScreen の警告で「詳細情報」→「実行」
- Mac: `/Applications` にコピーしたあと、ターミナルで `xattr -cr /Applications/shitagaki.app` を実行

## 構成

- [Tauri v2](https://v2.tauri.app/)（Rust）: ウィンドウと本文・テーマの読み書き
  - [window-state](https://v2.tauri.app/plugin/window-state/): ウィンドウの大きさと位置の保存
  - [clipboard-manager](https://v2.tauri.app/plugin/clipboard/): 全文コピー
  - [single-instance](https://v2.tauri.app/plugin/single-instance/): 二重起動の防止
  - [global-shortcut](https://v2.tauri.app/plugin/global-shortcut/): ⌃⌥S での呼び出し
- [CodeMirror 6](https://codemirror.net/): エディタ部分
- Vite + TypeScript

| パス | 内容 |
|---|---|
| `index.html` | エディタと下のバーの枠 |
| `src/main.ts` | エディタの初期化、自動保存、下のバー、ショートカット |
| `src/style.css` | 見た目（ダーク・ライトの配色） |
| `src-tauri/src/lib.rs` | ウィンドウの作成、`load_draft` / `save_draft` / `get_theme` / `save_theme` コマンド |
| `src-tauri/tauri.conf.json` | バンドルの設定（ウィンドウは `lib.rs` で作る） |
| `src-tauri/capabilities/default.json` | フロントから呼べる権限 |
| `assets/icon.swift` | アプリアイコンを描くスクリプト |

## 開発

Node.js 22 以上と Rust（cargo）が必要です。

```
npm install
npm run tauri dev
```

## ビルドとインストール

```
npm run tauri build
```

`src-tauri/target/release/bundle/macos/shitagaki.app` ができるので、`/Applications` にコピーします。

```
cp -R src-tauri/target/release/bundle/macos/shitagaki.app \
  /Applications/
```

署名と公証はしていません。自分の Mac でビルドしたものはそのまま起動できますが、`.dmg` を他の Mac に持っていくと Gatekeeper に止められます。

## リリース

`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` のバージョンを上げてコミットし、同じ番号のタグを push します。GitHub Actions が Windows と Mac 向けにビルドし、下書きのリリースを作ります。

```
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

## アイコンの作り直し

```
swift assets/icon.swift /tmp/app-icon.png
npx tauri icon /tmp/app-icon.png
rm -rf src-tauri/icons/android src-tauri/icons/ios
```

## ライセンス

MIT
