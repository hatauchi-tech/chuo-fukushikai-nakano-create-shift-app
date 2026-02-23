# CLAUDE.md - シフト管理自動化システム v3.0

## プロジェクト概要

介護施設（中央福祉会 中野）向けシフト作成・管理システム。
職員61名、資格者14名、勤務配慮あり10名、6グループ体制。
Google Apps Script (GAS) Web App + Python最適化 (OR-Tools) + Google Spreadsheet。

## アーキテクチャ

- **フロントエンド**: GAS Web App (SPA)、Tailwind CSS CDN、`google.script.run` で非同期通信
- **バックエンド**: GAS スタンドアローンスクリプト（06_Code.gs がAPIハブ）
- **シフト計算**: Python OR-Tools CP-SAT Solver（Google Colab、1セル実行）
- **データ**: Google Spreadsheet（マスタ + トランザクション）
- **連携**: CSV (Drive経由) + Webhook (HTTP POST)
- **カレンダー**: Google Calendar API（任意）

## ファイル構成

| ファイル | 行数目安 | 役割 |
|----------|---------|------|
| `01_Config.gs` | ~145 | スプレッドシート設定、定数定義、スクリプトプロパティ管理 |
| `02_DataService.gs` | ~700 | データアクセス層（全シートのCRUD操作） |
| `03_AuthService.gs` | ~120 | 認証・セッション管理（UserProperties） |
| `04_ShiftService.gs` | ~430 | ルールチェック（施設横断の資格者チェック含む） |
| `05_CalendarService.gs` | ~335 | Google Calendar連携 |
| `06_Code.gs` | ~1540 | doGet/doPost、カスタムメニュー、全APIエンドポイント |
| `07_index.html` | ~3000 | Web UI (SPA)、マニュアルページ含む |
| `08_CSVService.gs` | ~615 | CSV入出力、Webhook処理 |
| `shift_optimizer.py` | ~1420 | Python最適化（統合版v3.0: 診断+緩和+部分出力） |
| `appsscript.json` | | GASマニフェスト |
| `.clasp.json` | | clasp設定（scriptId） |

## シート構成

| シート名 | 定数 | 用途 |
|----------|------|------|
| `M_職員` | `SHEET_NAMES.STAFF` | 職員マスタ（職員ID/氏名/グループ/資格/配慮等） |
| `M_シフト` | `SHEET_NAMES.SHIFT_MASTER` | シフト種別マスタ（シフトキー管理） |
| `M_設定` | `SHEET_NAMES.SETTINGS` | 設定値（公休日数、ロック状態、シフト名等） |
| `M_イベント` | `SHEET_NAMES.EVENT` | イベント・予定 |
| `T_シフト休み希望` | `SHEET_NAMES.HOLIDAY_REQUEST` | 休み希望データ |
| `T_確定シフト` | `SHEET_NAMES.CONFIRMED_SHIFT` | 確定シフト |
| `T_勤務指定` | `SHEET_NAMES.SHIFT_ASSIGNMENT` | 事前シフト固定 |
| `シフト作業用` | `SHEET_NAMES.WORK_SHEET` | ルールチェック用 |

## 主要API一覧（06_Code.gs）

| API | 用途 |
|-----|------|
| `apiLogin` | ログイン認証 |
| `apiGetShiftDataFiltered(year, month, filters)` | フィルター付きシフト取得（メイン） |
| `apiGetShiftFilterOptions()` | フィルター選択肢取得 |
| `apiConfirmShifts(year, month, staffIds)` | シフト確定（カレンダーなし） |
| `apiConfirmShiftsAndRegisterCalendar(year, month, staffIds)` | シフト確定+カレンダー登録 |
| `apiRunDiagnostics(year, month)` | ルール診断（施設横断チェック） |
| `apiSaveShiftAssignment` | 勤務指定保存 |
| `apiExportAllCsv` | 3種CSV一括出力 |

## フロントエンド設計（07_index.html）

### ビュー構成
- loginView / holidayRequestView / staffMasterView / shiftMasterView
- shiftManagementView / shiftEditView / shiftAssignmentView / **manualView**

### シフト修正画面のフィルター
- **クライアントサイドフィルタリング**: データを1回取得し、フィルター操作はサーバー通信なし
- チェックボックスで即時反映: グループ/ユニット/雇用形態/喀痰吸引/勤務配慮
- 編集内容はフィルター切替時も保持
- 喀痰吸引資格者の行は黄色背景 `#FFFDE7`

### 確定ボタン
- 「確定」: シフトデータのみ保存
- 「Googleカレンダー登録して確定」: カレンダー登録も実行

## シフト制約アーキテクチャ

### 必須制約（ハード）
1. 公休数の遵守（暦日数 - 公休数 = 勤務日数）
2. 連勤制限（5日まで）
3. 夜勤明けルール（夜勤→休→休）
4. 勤務間インターバル（遅出→翌日早出禁止）
5. 勤務配慮者は夜勤免除
6. 第1休み希望は必須
7. 事前勤務指定の固定

### ソフト制約（ペナルティ付き）
- 最低人数（早出2/日勤1/遅出1/夜勤1）: penalty 50
- 第2希望以降の休み: penalty 100〜10（優先順位順）
- 喀痰吸引資格者の日中配置: penalty 100
- 喀痰吸引資格者の夜勤配置: penalty 80

### 施設横断チェック（グループ独立最適化後）
- 全グループ合算で毎日1名以上の資格者が勤務しているか（法的要件）
- 夜勤にも施設全体で1名以上の資格者がいるか

### 夜勤の休日カウント
- 夜勤は日またぎ: シフト表上2日分（当日「夜勤」+翌日「休み」）
- 公休カウント: 夜勤明けの翌日の休みのみが実質公休1日
- 勤務日数計算: 暦日数 - 公休数（固定上限なし）

## 認証・セッション管理

- ログイン: `apiLogin()` → `authenticateUser()` → `setSession()` (UserProperties)
- セッション: `PropertiesService.getUserProperties()` に JSON 保存
- 管理者判定: `isAdminRole(role)` → `role === '管理者'`
- セッション構造: `{ loginId, staffId, name, group, role, isAdmin }`

## コーディング規約

- GAS V8ランタイム使用
- API関数は `api` プレフィクス（例: `apiLogin`, `apiGetShiftDataFiltered`）
- エラーハンドリング: `{ success: boolean, message: string, data?: any }` 形式
- XSS対策: `escapeHtml()` / `textContent` 使用
- 日本語カラム名をそのままオブジェクトキーとして使用
- Python: 職員IDベース（氏名ベースではない）、シフトキー管理（不変キー + 可変表示名）

## デプロイ

- `clasp push` → GASエディタで「デプロイを管理」→ バージョン更新
- Webアプリ: `executeAs: "USER_ACCESSING"`, `access: "DOMAIN"`

## 既知の問題

- パスワードは平文保存（M_職員シート）
- ログインID/パスワードの型比較: `String()` で明示的変換が必要
