# Terraform Module Viewer

Terraform モジュール（1 ディレクトリ内の `*.tf` ファイル群）を解析し、構成を一覧表示する VS Code 拡張です。

## 機能

- **サマリー**: variables / outputs / resources / data / modules / locals / providers の件数
- **Terraform 設定**: `required_version`、`required_providers`、backend
- **Variables**: type・default・description、required / optional、sensitive、validation、**未使用の変数**の検出
- **Outputs**: value・description・sensitive
- **Resources / Data Sources**: type ごとにグループ化。count / for_each / depends_on / lifecycle をバッジ表示。展開すると属性と入れ子ブロック（dynamic など）をツリー表示
- **Modules**: source / version / 入力値。ローカルモジュール（`./modules/...`）はクリックでそのモジュールのビューアを開く
- **Locals**: 値と未使用の検出
- **その他**: moved / import / check などのブロック
- 名前や `ファイル:行` をクリックすると定義位置へジャンプ
- フィルタ（スペース区切りで AND 検索）
- **使用例をコピー**: このモジュールを呼び出す `module` ブロックの雛形（必須変数・任意変数付き）をクリップボードへ
- **ファイル単体表示**: 1 つの `.tf` ファイルに定義されたブロックだけを表示。あわせて次の 2 つを一覧にする
  - このファイルが参照している `var.` / `local.` / `module.` / `data.` / リソースと、その定義場所（他ファイル・同じファイル・定義なし）
  - このファイルの定義を参照している他のファイル
- `.tf` の保存・追加・削除で自動更新（設定 `terraformModuleViewer.autoRefresh`）
- VS Code のテーマ色に追従（ダーク / ライト）

## インストール

この拡張は `.vsix` ファイルで配布しています（Marketplace には未公開）。

### 1. `.vsix` を入手する

次のどちらかで入手します。

- **GitHub Releases からダウンロード**: [Releases](https://github.com/723gt/vsc_terrraform_module_viewer/releases) から最新の `terraform-module-viewer-<version>.vsix` をダウンロード
- **自分でビルド**: Node.js 20 以上を用意し、リポジトリのルートで次を実行

  ```bash
  npm install
  npm run package
  ```

  ルートに `terraform-module-viewer-<version>.vsix` ができます。

### 2. VS Code にインストールする

次のどちらかでインストールします。

- **画面から**: 拡張機能ビュー（`Ctrl+Shift+X` / `Cmd+Shift+X`）右上の「…」→「VSIX からのインストール…」→ ダウンロードした `.vsix` を選択
- **コマンドから**:

  ```bash
  code --install-extension terraform-module-viewer-0.2.0.vsix
  ```

インストール後、必要に応じて VS Code を再読み込みしてください。

### 更新・アンインストール

- **更新**: `.vsix` は自動更新されません。新しい `.vsix` を入手して、同じ手順でインストールし直してください（上書きされます）
- **アンインストール**: 拡張機能ビューで「Terraform Module Viewer」を右クリック →「アンインストール」、またはコマンド `code --uninstall-extension local.terraform-module-viewer`

## 使い方

- `.tf` ファイルを開いてエディタ右上のプレビューアイコンをクリック
- エクスプローラーでフォルダ / `.tf` を右クリック →「Terraform: モジュールビューアを開く」
- コマンドパレット →「Terraform: モジュールビューアを開く」

ファイル単体で開くには、次のどれかを使います。

- `.tf` ファイルを開いてエディタ右上のファイルアイコンをクリック
- エディタ内・エディタのタブ・エクスプローラーの `.tf` を右クリック →「Terraform: このファイルだけをビューアで開く」
- フォルダ全体のビューアの「ファイル」欄で「単体で表示」をクリック

ファイル単体のビューアからは「フォルダ全体を表示」でフォルダ全体のビューアに戻れます。

## 開発

拡張機能本体はプレーン JavaScript で、実行時の依存パッケージはありません。開発には Node.js 20 以上を使います。

- **準備**: `npm install`
- **デバッグ実行**: このフォルダを VS Code で開いて F5（`sample/s3-bucket` が開いた状態で起動します）
- **パーサのテスト**: `npm test`
- **.vsix の作成**: `npm run package`（[@vscode/vsce](https://github.com/microsoft/vscode-vsce) を使用）
- **インストール**: `code --install-extension terraform-module-viewer-0.2.0.vsix`
- **リリース**: `main` へのマージ・push のたびに GitHub Actions（`.github/workflows/release.yml`）が `.vsix` をビルドし、`package.json` の `version` をタグ名（例: `v0.2.0`）にした GitHub Release に添付します。新しいリリースを出すときは `version` を上げてからマージします。`version` を変えずにマージした場合は、同じ Release の `.vsix` が最新のビルドで置き換わります

## 制約

- HCL は独自の軽量パーサで構造だけを読み取ります（式は評価せず原文のまま表示）
- `*.tf.json` には未対応
- サブディレクトリは対象外（モジュール = 1 ディレクトリ）

## ライセンス

[MIT](LICENSE)
