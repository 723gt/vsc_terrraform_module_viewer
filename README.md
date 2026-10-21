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
- `.tf` の保存・追加・削除で自動更新（設定 `terraformModuleViewer.autoRefresh`）
- VS Code のテーマ色に追従（ダーク / ライト）

## 使い方

- `.tf` ファイルを開いてエディタ右上のプレビューアイコンをクリック
- エクスプローラーでフォルダ / `.tf` を右クリック →「Terraform: モジュールビューアを開く」
- コマンドパレット →「Terraform: モジュールビューアを開く」

## 開発

依存パッケージもビルド手順もありません（プレーン JavaScript）。

- **デバッグ実行**: このフォルダを VS Code で開いて F5（`sample/s3-bucket` が開いた状態で起動します）
- **パーサのテスト**: `node test/run.js`
- **.vsix の作成**: `powershell -ExecutionPolicy Bypass -File scripts/build-vsix.ps1`
- **インストール**: `code --install-extension terraform-module-viewer-0.1.0.vsix`

## 制約

- HCL は独自の軽量パーサで構造だけを読み取ります（式は評価せず原文のまま表示）
- `*.tf.json` には未対応
- サブディレクトリは対象外（モジュール = 1 ディレクトリ）
