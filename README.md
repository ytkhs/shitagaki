# shitagaki

下書き専用の小さなテキストエディタです。開いてすぐ書けて、書いた内容は自動で保存されます。

チャットやメールに貼る前の文章を一時的に置いておく場所として使う想定です。ファイルを開く・保存するという操作はありません。

## 機能

- 入力が止まって 0.5 秒後に自動保存し、次に起動すると前回の本文が戻る
- タイトルバーに最終保存時刻を表示する
- 行番号なし、折り返しあり
- コピーすると書式のないプレーンテキストだけがクリップボードに入る
- ダークテーマ

本文は次のファイルに保存されます。中身はただのテキストです。

```
~/Library/Application Support/com.ytkhs.shitagaki/draft.txt
```

## ダウンロード

[Releases](https://github.com/ytkhs/shitagaki/releases) から取れます。

- Windows: `shitagaki_<version>_x64-setup.exe`
- Mac（Apple Silicon）: `shitagaki_<version>_aarch64.dmg`

署名していないので、初回起動時に止められます。

- Windows: SmartScreen の警告で「詳細情報」→「実行」
- Mac: `/Applications` にコピーしたあと、ターミナルで `xattr -cr /Applications/shitagaki.app` を実行

## 構成

- [Tauri v2](https://v2.tauri.app/)（Rust）: ウィンドウと本文の読み書き
- [CodeMirror 6](https://codemirror.net/): エディタ部分
- Vite + TypeScript

| パス | 内容 |
|---|---|
| `src/main.ts` | エディタの初期化、自動保存、タイトルの更新 |
| `src/style.css` | 見た目 |
| `src-tauri/src/lib.rs` | `load_draft` / `save_draft` コマンド |
| `src-tauri/tauri.conf.json` | ウィンドウとバンドルの設定 |
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
git tag v0.1.0
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
