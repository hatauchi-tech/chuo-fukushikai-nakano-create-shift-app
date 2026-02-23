# 5件改修計画

**Date:** 2026-02-23

## 修正一覧

| # | 問題 | 根本原因 | 修正ファイル | 難度 |
|---|------|----------|-------------|------|
| 1 | 勤務指定一覧に名前が表示されない | `getShiftAssignmentsByMonth` の日付列indexが旧スキーマのまま (3→4) | `02_DataService.gs` | 簡単 |
| 2 | 3種CSV出力でDrive権限エラー | `appsscript.json` にDriveスコープ未定義 | `appsscript.json` | 簡単 |
| 3 | シフト最適化ボタン消失 | コード整理で削除済み。HTML/JS/GAS APIの復元が必要 | `07_index.html`, `06_Code.gs` | 中 |
| 4 | CSV取込でDrive権限エラー | #2と同じ原因 | (#2で解決) | - |
| 5 | シフト修正画面UI変更 | ワイヤーフレームに基づくUI刷新 | `07_index.html`, `06_Code.gs` | 大 |

---

## Task 1: 勤務指定一覧の表示修正

**原因:** `02_DataService.gs:820` で `data[i][3]`（グループ列）を日付として参照。スキーマ変更で「職員ID」列が追加され、日付は index 4 に移動したがコード未更新。

**修正:** `getShiftAssignmentsByMonth()` の `dateVal` 取得を header-based lookup に変更し、index固定をやめる。

---

## Task 2: Drive権限スコープ追加

**原因:** `appsscript.json` の `oauthScopes` に `https://www.googleapis.com/auth/drive` が欠落。

**修正:** スコープを追加。

---

## Task 3: シフト最適化ボタン復元

**原因:** コミット 2c75e8d で `colabLinkContainer`, `loadColabUrl()`, `apiGetColabUrl()` が削除された。

**修正:**
1. `06_Code.gs` に `apiGetColabUrl()` 関数を追加
2. `07_index.html` ステップ2にボタンHTML復元
3. `07_index.html` に `loadColabUrl()` JS関数を復元
4. `initShiftManagementView()` から `loadColabUrl()` 呼び出し追加

---

## Task 5: シフト修正画面UI変更

**ワイヤーフレーム構成:**
1. 操作パネル: 対象月 / グループ / [表示] [戻る] [確定してカレンダー登録]
2. シフトテーブル: 氏名×日付マトリクス（各セルにselect）
3. 集計(日別): シフト種別×日付マトリクス（各シフトの日別人数）← 新規追加
4. 集計(職員別): 氏名 | 勤務日数 | シフト別内訳 | 休み
5. 診断レポート (Google Colabから取得)

**修正:**
- `apiGetShiftDataByGroup` に日別集計データを追加
- `renderShiftEditTable` のテーブル下に日別集計テーブルを追加描画
- 統計テーブルのレイアウトを職員別集計に変更
- 操作ボタンのレイアウト変更
