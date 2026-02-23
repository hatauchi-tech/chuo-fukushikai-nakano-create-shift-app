# CLAUDE.md - シフト管理自動化システム

## プロジェクト概要

介護施設向けシフト作成・管理システム。Google Apps Script (GAS) + Python最適化 + Google Spreadsheet。

## アーキテクチャ

- **フロントエンド**: GAS Web App (SPA)、Tailwind CSS CDN、`google.script.run` で非同期通信
- **バックエンド**: GAS スタンドアローンスクリプト
- **シフト計算**: Python (OR-Tools CP-SAT Solver, Google Colab)
- **データ**: Google Spreadsheet (マスタ + トランザクション)
- **連携**: CSV (Drive経由) + Webhook (HTTP POST)
- **カレンダー**: Google Calendar API

## ファイル構成

| ファイル | 役割 |
|----------|------|
| `01_Config.gs` | スプレッドシート設定、定数定義、スクリプトプロパティ管理 |
| `02_DataService.gs` | データアクセス層（全シートのCRUD操作） |
| `03_AuthService.gs` | 認証・セッション管理（UserProperties） |
| `04_ShiftService.gs` | 6種ルールチェック |
| `05_CalendarService.gs` | Google Calendar連携 |
| `06_Code.gs` | doGet/doPost、カスタムメニュー、全APIエンドポイント |
| `07_index.html` | Web UI (SPA) |
| `08_CSVService.gs` | CSV入出力、Webhook処理 |
| `shift_optimizer.py` | Python最適化（基本版） |
| `shift_optimizer_diagnostic.py` | Python最適化（診断機能付き） |
| `appsscript.json` | GASマニフェスト |
| `.clasp.json` | clasp設定（scriptId） |

## シート構成

| シート名 | 定数 | 用途 |
|----------|------|------|
| `M_職員` | `SHEET_NAMES.STAFF` | 職員マスタ（ログインID/パスワード含む） |
| `M_シフト` | `SHEET_NAMES.SHIFT_MASTER` | シフト種別マスタ |
| `M_設定` | `SHEET_NAMES.SETTINGS` | 設定値（公休日数、ロック状態等） |
| `M_イベント` | `SHEET_NAMES.EVENT` | イベント・予定 |
| `T_シフト休み希望` | `SHEET_NAMES.HOLIDAY_REQUEST` | 休み希望データ |
| `T_確定シフト` | `SHEET_NAMES.CONFIRMED_SHIFT` | 確定シフト |
| `T_勤務指定` | `SHEET_NAMES.SHIFT_ASSIGNMENT` | 事前シフト固定 |
| `シフト作業用` | `SHEET_NAMES.WORK_SHEET` | ルールチェック用 |

## 認証・セッション管理

- ログイン: `apiLogin()` → `authenticateUser()` → `setSession()` (UserProperties)
- セッション: `PropertiesService.getUserProperties()` に JSON 保存
- 管理者判定: `isAdminRole(role)` → `role === '管理者'`
- セッション構造: `{ loginId, staffId, name, group, role, isAdmin }`

## デプロイ

- `appsscript.json`: `executeAs: "USER_ACCESSING"`, `access: "DOMAIN"`
- clasp: `.clasp.json` にscriptId設定済み
- デプロイ手順: `clasp push` → GASエディタで「新しいデプロイ」or バージョン更新
- 注意: `clasp push` はコードをGASに反映するが、Webアプリの公開バージョンは別途更新が必要

## コーディング規約

- GAS V8ランタイム使用
- `var` と `const/let` が混在（古いコードは`var`、新しいコードは`const/let`）
- API関数は `api` プレフィクス（例: `apiLogin`, `apiSaveShiftAssignment`）
- データ層関数はプレフィクスなし（例: `getAllStaff`, `saveShiftAssignment`）
- エラーハンドリング: `{ success: boolean, message: string, data?: any }` 形式
- フロントエンドはDOM操作（XSS対策: textContent使用）
- 日本語カラム名をそのままオブジェクトキーとして使用

## 既知の問題

- パスワードは平文保存（M_職員シート）
- `clasp` コマンドが環境にインストールされていない場合あり
- ログインID/パスワードの型比較: `String()` で明示的変換が必要（数値型対策）
- `appsscript.json` の `executeAs` と実際のデプロイ設定が異なる可能性あり

## 開発・デプロイフロー

1. ローカルでコード編集
2. `clasp push` でGASに反映（または手動コピー）
3. GASエディタで「デプロイを管理」→「編集」でバージョン更新
4. 動作確認

## テスト方法

- GASエディタから関数を直接実行（単体テスト代替）
- Webアプリで手動テスト
- `console.log` でデバッグ（Apps Scriptダッシュボードで確認）
