# シフトシステム改修 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** シフト最適化ロジックの制約修正、シフト修正画面のUX改善、診断レポートの使いやすさ向上を行う

**Architecture:** Python最適化（shift_optimizer.py）の制約ロジック修正 + GASバックエンド（06_Code.gs, 08_CSVService.gs）のシフト名統一・API追加 + フロントエンド（07_index.html）のクライアント側集計・ボタン分離・診断レポート改善

**Tech Stack:** Python (OR-Tools CP-SAT), Google Apps Script, HTML/JS (SPA), Google Spreadsheet

**前提条件:** 職員数61名、喀痰吸引資格者14名、勤務配慮あり10名

---

## Task 1: Python - 公休数ハード制約への変更（夜勤明け考慮）

**目的:** 現在の「所定勤務日数 == N」制約を「公休数 == monthly_holidays」に変更。夜勤翌日の休みは夜勤明けであり公休にカウントしない。

**Files:**
- Modify: `shift_optimizer.py:636-650` (制約3)

**現状の問題:**
- 現在は `work_days_count == scheduled_work_days`（夜勤2日換算）で管理
- 夜勤→休→休 のパターンで、22日の「休み」は実際は夜勤明け（10:00まで勤務）
- 公休としてカウントすべきは23日のみ（休日数 = 1）

**新しいロジック:**
- 公休 = 「休み」かつ「前日が夜勤ではない」日
- 各職員の公休数 == monthly_holidays をハード制約とする

**Step 1: 制約3を書き換え**

`shift_optimizer.py` の制約3（lines 636-650）を以下に置換:

```python
# ============================================
# 制約3: 公休数（夜勤明けの休みは公休に含めない）
# 夜勤→翌日「休み」は夜勤明け（勤務扱い）、翌々日「休み」が公休
# ============================================
for s in range(num_staff):
    true_holidays = []
    for d in range(num_days):
        if d == 0:
            # 月初日: 前日の夜勤情報がないため、休みなら公休扱い
            true_holidays.append(shifts[(s, d, SHIFT_REST)])
        else:
            # 公休 = 休み AND 前日が夜勤ではない
            is_true_holiday = model.NewBoolVar(f'true_holiday_s{s}_d{d}')
            # is_true_holiday → rest[d]=1
            model.AddImplication(is_true_holiday, shifts[(s, d, SHIFT_REST)])
            # is_true_holiday → night[d-1]=0
            model.AddImplication(is_true_holiday, shifts[(s, d-1, SHIFT_NIGHT)].Not())
            # rest[d]=1 AND night[d-1]=0 → is_true_holiday
            model.AddBoolOr([
                shifts[(s, d, SHIFT_REST)].Not(),
                shifts[(s, d-1, SHIFT_NIGHT)],
                is_true_holiday
            ])
            true_holidays.append(is_true_holiday)

    if relaxed:
        model.Add(sum(true_holidays) >= monthly_holidays - 2)
        model.Add(sum(true_holidays) <= monthly_holidays + 2)
    else:
        model.Add(sum(true_holidays) == monthly_holidays)
```

**Step 2: 統計出力の修正**

`optimize_shift_with_diagnostics` 内の統計出力（lines 965-992）で、公休数の検証ロジックを新方式に合わせて更新。所定勤務日数ベースの出力を公休数ベースに変更。

**Step 3: コミット**

```bash
git add shift_optimizer.py
git commit -m "fix: 公休数制約を夜勤明け考慮に変更（夜勤翌日の休みは公休外）"
```

---

## Task 2: Python - 最低人数をソフト制約に変更

**目的:** グループ別最低人数制約をハード→ソフト制約に変更。公休数がハード制約であり、人数不足は許容する。

**Files:**
- Modify: `shift_optimizer.py:687-703` (制約7)
- Modify: `shift_optimizer.py:720-735` (目的関数)

**Step 1: 制約7をソフト制約に変更**

`shift_optimizer.py` の制約7（lines 687-703）を以下に置換:

```python
# ============================================
# 制約7: グループ別最低人数（ソフト制約）
# 最低人数を下回るとペナルティ。公休数がハード制約なので人数不足は許容。
# ============================================
min_early = MIN_STAFF_REQUIREMENTS[SHIFT_KEY_HAYADE]
min_day   = MIN_STAFF_REQUIREMENTS[SHIFT_KEY_NIKKIN]
min_late  = MIN_STAFF_REQUIREMENTS[SHIFT_KEY_OSODE]
min_night = MIN_STAFF_REQUIREMENTS[SHIFT_KEY_YAKIN]

min_staff_penalties = []

for d in range(num_days):
    # 早出
    early_short = model.NewIntVar(0, min_early, f'early_short_d{d}')
    model.Add(
        sum(shifts[(s, d, SHIFT_EARLY)] for s in range(num_staff)) + early_short >= min_early
    )
    min_staff_penalties.append(early_short * 50)

    # 日勤（日曜は0でも可）
    if d not in sundays:
        day_short = model.NewIntVar(0, min_day, f'day_short_d{d}')
        model.Add(
            sum(shifts[(s, d, SHIFT_DAY)] for s in range(num_staff)) + day_short >= min_day
        )
        min_staff_penalties.append(day_short * 50)

    # 遅出
    late_short = model.NewIntVar(0, min_late, f'late_short_d{d}')
    model.Add(
        sum(shifts[(s, d, SHIFT_LATE)] for s in range(num_staff)) + late_short >= min_late
    )
    min_staff_penalties.append(late_short * 50)

    # 夜勤
    night_short = model.NewIntVar(0, min_night, f'night_short_d{d}')
    model.Add(
        sum(shifts[(s, d, SHIFT_NIGHT)] for s in range(num_staff)) + night_short >= min_night
    )
    min_staff_penalties.append(night_short * 50)
```

**Step 2: 目的関数にペナルティを追加**

目的関数セクション（line 720付近）の `objective_terms` に追加:

```python
# ソフト制約: 最低人数不足ペナルティ
objective_terms.extend(min_staff_penalties)
```

**Step 3: コミット**

```bash
git add shift_optimizer.py
git commit -m "fix: グループ別最低人数をソフト制約に変更（公休数がハード制約）"
```

---

## Task 3: Python - 資格者配置の緩和スキップ禁止

**目的:** 喀痰吸引資格者の配置制約は法律で定められているため、relaxedモードでもスキップしない。

**Files:**
- Modify: `shift_optimizer.py:705-718` (制約8)

**Step 1: `if not relaxed:` ガードを削除**

```python
# 変更前 (line 708):
if not relaxed:
    suction_staff_indices = ...

# 変更後: relaxed ガードなし
suction_staff_indices = [i for i in range(num_staff) if staff_has_suction[i]]
if len(suction_staff_indices) > 0:
    for d in range(num_days):
        model.Add(
            sum(
                shifts[(s, d, t)]
                for s in suction_staff_indices
                for t in [SHIFT_EARLY, SHIFT_DAY, SHIFT_LATE, SHIFT_NIGHT]
            ) >= 1
        )
```

**補足:** 現在の実装はグループ単位で実行されるため、各グループ内で資格者がいれば制約有効。資格者がいないグループではスキップされるが、14名の資格者が複数グループに分散しているため全体の法的要件は満たされる。

**Step 2: コミット**

```bash
git add shift_optimizer.py
git commit -m "fix: 喀痰吸引資格者配置を緩和モードでも常に強制"
```

---

## Task 4: Python - 休み希望を全てソフト制約に変更

**目的:** 優先順位1をハード制約からソフト制約に変更。全優先順位をソフト制約にし、優先度に応じた重み付けで競合を解決。

**Files:**
- Modify: `shift_optimizer.py:596-620` (制約1)

**Step 1: 制約1を書き換え**

```python
# ============================================
# 制約1: 休み希望（全てソフト制約、優先順位で重み付け）
# ============================================
soft_holiday_penalties = []

for _, row in group_holiday_df.iterrows():
    row_staff_id = str(row['職員ID'])
    if row_staff_id not in staff_id_to_local:
        continue

    s = staff_id_to_local[row_staff_id]
    request_date = pd.to_datetime(row['日付']).date()

    if request_date.year == year and request_date.month == month:
        d = request_date.day - 1
        priority = int(row['優先順位'])

        # 全優先順位をソフト制約に（P1=30, P2=17, P3=14, ...）
        weight = max(1, 33 - priority * 3)
        not_rest = model.NewBoolVar(f'not_rest_s{s}_d{d}')
        model.Add(shifts[(s, d, SHIFT_REST)] == 0).OnlyEnforceIf(not_rest)
        model.Add(shifts[(s, d, SHIFT_REST)] == 1).OnlyEnforceIf(not_rest.Not())
        soft_holiday_penalties.append(not_rest * weight)
```

**Step 2: コミット**

```bash
git add shift_optimizer.py
git commit -m "fix: 休み希望を全てソフト制約に変更（優先順位で重み付け）"
```

---

## Task 5: GAS Backend - シフト名ハードコード修正

**目的:** '休み' や '夜勤' 等のハードコードを動的なシフトマスタ参照に統一。M_シフトで「ヤ」と定義されているなら「ヤ」で表示。

**Files:**
- Modify: `06_Code.gs` (12箇所: lines 727, 761, 862, 869, 874, 928, 989, 1063, 1073, 1089, 1098-1111, 1135-1155)
- Modify: `08_CSVService.gs` (1箇所: line 405)

**Step 1: 06_Code.gs - calculateShiftStatistics (lines 854-887)**

関数冒頭でシフトマスタを取得し、'休み' と '夜勤' の比較を動的名に変更:

```javascript
function calculateShiftStatistics(staffShifts, daysInMonth) {
  var shiftMap = getShiftMasterMap().byKey;
  var N_YASUMI = shiftMap[SHIFT_KEYS.YASUMI] || '休み';
  var N_YAKIN  = shiftMap[SHIFT_KEYS.YAKIN]  || '夜勤';

  return staffShifts.map(function(staff) {
    // shiftName === '休み' → shiftName === N_YASUMI
    // shiftName === '夜勤' → shiftName === N_YAKIN
    ...
  });
}
```

**Step 2: 06_Code.gs - apiGetShiftDataByGroup (lines 727, 761)**

関数冒頭で `var N_YASUMI = getShiftMasterMap().byKey[SHIFT_KEYS.YASUMI] || '休み';` を取得し、
- line 727: `{ shiftName: N_YASUMI, ... }`
- line 761: `shift['シフト名'] ? String(shift['シフト名']) : N_YASUMI`

**Step 3: 06_Code.gs - apiUpdateShift (line 928)**

`shiftName === '休み'` を動的名と比較。

**Step 4: 06_Code.gs - apiConfirmShiftsAndRegisterCalendar (line 989)**

`shift['シフト名'] === '休み'` を動的名と比較。

**Step 5: 06_Code.gs - apiRunDiagnostics (lines 1063-1155)**

関数冒頭で全シフト名を動的取得:
```javascript
var shiftMap = getShiftMasterMap().byKey;
var N_HAYADE = shiftMap[SHIFT_KEYS.HAYADE] || '早出';
var N_NIKKIN = shiftMap[SHIFT_KEYS.NIKKIN] || '日勤';
var N_OSODE  = shiftMap[SHIFT_KEYS.OSODE]  || '遅出';
var N_YAKIN  = shiftMap[SHIFT_KEYS.YAKIN]   || '夜勤';
var N_YASUMI = shiftMap[SHIFT_KEYS.YASUMI]  || '休み';
```
全てのハードコード文字列をこれらの変数に置換。

**Step 6: 08_CSVService.gs (line 405)**

`shiftName === '休み'` を動的名に変更。

**Step 7: コミット**

```bash
git add 06_Code.gs 08_CSVService.gs
git commit -m "fix: シフト名のハードコードを動的マスタ参照に統一"
```

---

## Task 6: GAS Backend - 確定API分離

**目的:** 「確定」（登録日時のみ更新）と「Googleカレンダー登録して確定」を分離。

**Files:**
- Modify: `06_Code.gs` (新規関数追加)

**Step 1: apiConfirmShifts 関数を追加（カレンダー登録なし）**

`06_Code.gs` の `apiConfirmShiftsAndRegisterCalendar` の直前に追加:

```javascript
function apiConfirmShifts(year, month, group) {
  try {
    var now = new Date();
    var registrationDate = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');

    var shifts = getConfirmedShiftsByMonth(year, month);
    var targetShifts = group
      ? shifts.filter(function(s) { return String(s['グループ']) === String(group); })
      : shifts;

    var shiftMap = getShiftMasterMap().byKey;
    var N_YASUMI = shiftMap[SHIFT_KEYS.YASUMI] || '休み';
    var confirmedCount = 0;

    for (var i = 0; i < targetShifts.length; i++) {
      var shift = targetShifts[i];
      if (shift['シフト名'] === N_YASUMI || !shift['シフト名']) continue;
      updateConfirmedShiftFields(shift['確定シフトID'], { '登録日時': registrationDate });
      confirmedCount++;
    }

    return { success: true, count: confirmedCount,
      message: confirmedCount + '件のシフトを確定しました' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}
```

**Step 2: コミット**

```bash
git add 06_Code.gs
git commit -m "feat: カレンダー登録なしの確定API (apiConfirmShifts) を追加"
```

---

## Task 7: Frontend - クライアントサイド集計更新

**目的:** シフト修正時に全データ再読み込みを行わず、クライアント側でデータを即座に更新して集計を再計算する。

**Files:**
- Modify: `07_index.html` (updateShiftCell 関数, 新規 recalculateStatistics 関数)

**Step 1: recalculateStatistics 関数を追加**

shiftEditData.staffShifts から statistics を再計算する関数を追加。
shiftMasterList から SHIFT_YASUMI と SHIFT_YAKIN の表示名を動的取得。
workDays, restDays, shiftCounts を計算して shiftEditData.statistics を更新。

**Step 2: updateShiftCell をクライアントサイド更新に変更**

現在の実装:
1. apiUpdateShift 呼び出し
2. 成功 → loadShiftEditData()（フルリロード）

変更後:
1. apiUpdateShift をバックグラウンドで呼び出し（ローディング表示なし）
2. ローカルの shiftEditData.staffShifts[staff].shifts[day] を即座に更新
3. recalculateStatistics() で statistics を再計算
4. renderShiftDailyStatsTable と renderShiftStatsTable を再描画
5. apiUpdateShift 失敗時のみ loadShiftEditData() でフルリロード

**Step 3: コミット**

```bash
git add 07_index.html
git commit -m "perf: シフト修正時のクライアントサイド集計更新（リロード不要）"
```

---

## Task 8: Frontend - 確定ボタン分離 + シフト名統一

**目的:** 「確定」ボタンと「Googleカレンダー登録して確定」ボタンの2種類を用意。また、07_index.htmlのシフト名ハードコードを修正。

**Files:**
- Modify: `07_index.html` (ボタンHTML + JS関数 + シフト名参照)

**Step 1: ボタンHTMLを2つに分離**

既存の確定ボタン (line 542-544) を、flex コンテナ内に2ボタンに分離:
- 「確定」ボタン (青色, apiConfirmShifts を呼び出す)
- 「Googleカレンダー登録して確定」ボタン (赤色, 既存の apiConfirmShiftsAndRegisterCalendar を呼び出す)

**Step 2: confirmShiftsOnly JS関数を追加**

apiConfirmShifts を呼び出す新関数。確認ダイアログは「登録日時が記録されます」のみ表示。

**Step 3: loadShiftEditData 内のボタン表示切替を修正**

両ボタンを表示するよう変更。

**Step 4: シフト名ハードコードの修正**

07_index.html 内の '休み' ハードコード箇所を修正:
- line 1980: ドロップダウンのデフォルト選択肢を shiftMasterList から SHIFT_YASUMI の名前を取得
- line 1982: `sm['シフト名'] !== '休み'` → `sm['シフトID'] !== 'SHIFT_YASUMI'` に変更
- line 2034: フォールバック文字列を shiftMasterList ベースに変更
- line 2058: '休み' フォールバックを動的取得した名前に変更

**Step 5: コミット**

```bash
git add 07_index.html
git commit -m "feat: 確定ボタンを分離 + シフト名ハードコード修正"
```

---

## Task 9: Frontend/Backend - 診断レポート改善（氏名表示 + フィルター）

**目的:** 診断レポートの各違反項目に氏名・グループを表示し、フィルター機能を追加。

**Files:**
- Modify: `06_Code.gs:1039-1176` (apiRunDiagnostics)
- Modify: `07_index.html` (診断レポートUI)

**Step 1: apiRunDiagnostics の違反データに構造化フィールドを追加**

各 violations.push / warnings.push に `staffId`, `staffName`, `group` フィールドを追加。
message 文字列内の職員ID表示を「氏名(Gグループ番号)」形式に変更。

例:
```javascript
var staffInfo = entry.staffInfo;
var displayName = staffInfo['氏名'] || name;
var staffGroup = staffInfo['グループ'] || '';

violations.push({
  type: '連勤制限違反', level: 'error', day: d,
  staffId: name, staffName: displayName, group: staffGroup,
  message: displayName + '(G' + staffGroup + '): ' + consecutiveStart + '日〜' + d + '日 (' + consecutiveDays + '連勤)'
});
```

レスポンスに staffList と groupList を追加（フィルター用）。

**Step 2: フィルターUI追加**

診断レポートパネルにグループ・職員のフィルタードロップダウンを追加。
select 要素の onchange で applyDiagnosticsFilter() を呼び出す。

**Step 3: フィルター用 JS 関数を追加**

- `diagnosticsData` 変数で診断結果を保持
- `applyDiagnosticsFilter()`: groupFilter/staffFilter でフィルタリング → renderDiagnosticsList に渡す
- `renderDiagnosticsList(items)`: 既存の描画ロジックを抽出して独立関数化

**Step 4: runDiagnostics の成功ハンドラを修正**

diagnosticsData にデータを保存。フィルタードロップダウンの選択肢を動的生成（DOM createElement 使用）。renderDiagnosticsList を呼び出し。

**Step 5: コミット**

```bash
git add 06_Code.gs 07_index.html
git commit -m "feat: 診断レポートに氏名・グループ表示とフィルター機能を追加"
```

---

## 実装順序と依存関係

```
Task 1 (公休数制約)  ──┐
Task 2 (最低人数ソフト) ├── Python独立（並行可能）
Task 3 (資格者常時強制) ├
Task 4 (休み希望ソフト) ┘

Task 5 (シフト名統一)  ── GAS Backend（Task 6, 7, 8 の前提）

Task 6 (確定API分離)   ── GAS Backend（Task 8 の前提）

Task 7 (クライアント集計) ── Frontend（Task 5 完了後）
Task 8 (確定ボタン分離)  ── Frontend（Task 5, 6 完了後）
Task 9 (診断レポート改善) ── Frontend + Backend（Task 5 完了後）
```

**推奨実行順序:** Task 1→2→3→4（Python一括）→ Task 5→6（GAS Backend）→ Task 7→8→9（Frontend）
