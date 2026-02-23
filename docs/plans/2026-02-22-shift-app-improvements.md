# シフト作成アプリ 改修実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 改修要望リストに基づき、①診断レポート画面表示、②事前勤務指定機能、③イベント事前表示機能の3つを実装する（月途中再計算は保留）。

**Architecture:** Google Apps Script (GAS) + HTML/JS の既存 WebApp 構成を維持しながら、スプレッドシートに新シートを追加し、GAS に新 API 関数を追加した後、07_index.html の UI を拡張する。

**Tech Stack:** Google Apps Script (GAS), HTML, Tailwind CSS, Google Sheets

---

## 改修要望サマリー

| # | 要望 | 優先度 | 対応方針 |
|---|------|--------|----------|
| 1 | 警告・アラートの画面表示（診断レポート） | 高 | 既存ルールチェック機能を活用してUI表示 |
| 2 | 事前の勤務指定（シフト固定）機能 | 高 | 新シートと新UI追加 |
| 3 | 予定・イベントの事前表示機能 | 中〜高 | 新シートとカレンダーへの表示追加 |
| 4 | 月途中の急なシフト再計算機能 | 低〜中 | **保留** |

---

## セキュリティ方針（重要）

HTML を動的に構築する箇所では必ず DOM API（createElement / textContent / dataset）を使用し、
ユーザー由来データを直接 innerHTML に埋め込まない。
どうしても innerHTML を使う場合は以下の escapeHtml() を必ず通すこと。

```javascript
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

---

# フェーズ1: 警告・アラートの画面表示（診断レポート）

## 概要
T_確定シフト を読んでルールチェックを行う `apiRunDiagnostics` API を追加し、
シフト修正画面に診断レポートパネルを追加する。

---

### Task 1: バックエンド - 診断レポート API の追加

**Files:**
- Modify: `06_Code.gs`

**Step 1: 以下の関数を 06_Code.gs の末尾に追加する**

```javascript
/**
 * 診断レポートAPI - T_確定シフトをもとにルールチェックを実行
 */
function apiRunDiagnostics(year, month) {
  try {
    var violations = [];
    var warnings = [];
    var confirmedShifts = getConfirmedShiftsByMonth(year, month);

    if (confirmedShifts.length === 0) {
      return {
        success: true, hasData: false,
        violations: [], warnings: [],
        summary: { total: 0, error: 0, warning: 0 },
        message: year + '年' + month + '月の確定シフトデータがありません'
      };
    }

    var daysInMonth = new Date(year, month, 0).getDate();
    var allStaff = getActiveStaff();

    // 職員ごとのシフトマップを構築
    var staffShiftMap = {};
    allStaff.forEach(function(staff) {
      staffShiftMap[staff['氏名']] = { staffInfo: staff, shifts: {} };
      for (var d = 1; d <= daysInMonth; d++) {
        staffShiftMap[staff['氏名']].shifts[d] = '休み';
      }
    });
    confirmedShifts.forEach(function(shift) {
      var day = new Date(shift['勤務開始日']).getDate();
      var name = shift['氏名'];
      if (staffShiftMap[name]) {
        staffShiftMap[name].shifts[day] = shift['シフト名'] || '休み';
      }
    });

    var staffNames = Object.keys(staffShiftMap);

    // 個人ルールチェック
    staffNames.forEach(function(name) {
      var entry = staffShiftMap[name];
      var consecutiveDays = 0;
      var consecutiveStart = 0;
      var workDays = 0;

      for (var d = 1; d <= daysInMonth; d++) {
        var s = entry.shifts[d];

        if (s !== '休み' && s !== '') {
          if (consecutiveDays === 0) consecutiveStart = d;
          consecutiveDays++;
          if (consecutiveDays >= 6) {
            violations.push({ type: '連勤制限違反', level: 'error', day: d,
              message: name + ': ' + consecutiveStart + '日〜' + d + '日 (' + consecutiveDays + '連勤)' });
          }
        } else { consecutiveDays = 0; }

        if (s === '夜勤') { workDays += 2; }
        else if (s !== '休み' && s !== '') { workDays += 1; }

        if (d < daysInMonth && s === '遅出' && entry.shifts[d + 1] === '早出') {
          violations.push({ type: 'インターバル違反', level: 'error', day: d,
            message: name + ': ' + d + '日遅出 → ' + (d + 1) + '日早出' });
        }

        if (s === '夜勤') {
          if (d + 1 <= daysInMonth && entry.shifts[d + 1] !== '休み') {
            violations.push({ type: '夜勤明け違反', level: 'error', day: d + 1,
              message: name + ': ' + d + '日夜勤後、' + (d + 1) + '日が休みではない' });
          }
          if (d + 2 <= daysInMonth && entry.shifts[d + 2] !== '休み') {
            violations.push({ type: '夜勤明け違反', level: 'error', day: d + 2,
              message: name + ': ' + d + '日夜勤後、' + (d + 2) + '日が休みではない' });
          }
        }
      }

      if (workDays > 21) {
        violations.push({ type: '勤務日数超過', level: 'error', day: null,
          message: name + ': 勤務日数' + workDays + '日（上限21日）' });
      }
    });

    // グループ別・日別チェック
    for (var d = 1; d <= daysInMonth; d++) {
      var groupCounts = {};
      var nightQualified = false;

      staffNames.forEach(function(name) {
        var entry = staffShiftMap[name];
        var s = entry.shifts[d];
        var group = entry.staffInfo['グループ'];
        if (!group) return;
        if (!groupCounts[group]) {
          groupCounts[group] = { '早出': 0, '日勤': 0, '遅出': 0, '夜勤': 0 };
        }
        if (groupCounts[group].hasOwnProperty(s)) { groupCounts[group][s]++; }
        if (s === '夜勤' &&
            (entry.staffInfo['喀痰吸引資格者'] === true || entry.staffInfo['喀痰吸引資格者'] === 'TRUE')) {
          nightQualified = true;
        }
      });

      Object.keys(groupCounts).forEach(function(group) {
        var c = groupCounts[group];
        if (c['早出'] < 2) violations.push({ type: '最低人数不足', level: 'error', day: d,
          message: d + '日 G' + group + ': 早出' + c['早出'] + '名（最低2名必要）' });
        // 業務ルール: 日曜日は日勤0名でも可（04_ShiftService.gs の checkMinimumStaffRule と同じ仕様）
        var isSunday = new Date(year, month - 1, d).getDay() === 0;
        if (!isSunday && c['日勤'] < 1) violations.push({ type: '最低人数不足', level: 'error', day: d,
          message: d + '日 G' + group + ': 日勤' + c['日勤'] + '名（最低1名必要）' });
        if (c['遅出'] < 1) violations.push({ type: '最低人数不足', level: 'error', day: d,
          message: d + '日 G' + group + ': 遅出' + c['遅出'] + '名（最低1名必要）' });
        if (c['夜勤'] < 1) violations.push({ type: '最低人数不足', level: 'error', day: d,
          message: d + '日 G' + group + ': 夜勤' + c['夜勤'] + '名（最低1名必要）' });
      });

      if (!nightQualified) {
        warnings.push({ type: '資格者不在', level: 'warning', day: d,
          message: d + '日: 夜勤に喀痰吸引資格者が配置されていません' });
      }
    }

    var allIssues = violations.concat(warnings);
    allIssues.sort(function(a, b) { return (a.day || 0) - (b.day || 0); });

    return {
      success: true, hasData: true,
      violations: violations, warnings: warnings,
      summary: { total: allIssues.length, error: violations.length, warning: warnings.length },
      message: '診断完了: エラー' + violations.length + '件、警告' + warnings.length + '件'
    };
  } catch (e) {
    console.error('診断レポートエラー:', e);
    return { success: false, message: e.message };
  }
}
```

**Step 2: GASエディタで `apiRunDiagnostics(2026, 1)` を実行してエラーなく動作することを確認**

**Step 3: Commit**
```bash
git add 06_Code.gs
git commit -m "feat: 診断レポートAPI (apiRunDiagnostics) を追加"
```

---

### Task 2: フロントエンド - 診断レポートパネルを追加

**Files:**
- Modify: `07_index.html`

**Step 1: スクリプトブロック内の先頭（`let currentSession = null;` の前）に escapeHtml() 関数を追加する**

```javascript
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

**Step 2: シフト修正画面 `<div id="shiftEditMessage">` の直前に診断パネルHTMLを追加する**

```html
          <!-- 診断レポートパネル -->
          <div id="diagnosticsPanel" class="hidden mt-6">
            <div class="bg-white border border-gray-200 rounded-lg p-6">
              <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold text-gray-800">診断レポート</h3>
                <button onclick="runDiagnostics()"
                  class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm">
                  診断を実行
                </button>
              </div>
              <div id="diagnosticsResult" class="hidden">
                <div id="diagnosticsSummary" class="flex gap-4 mb-4"></div>
                <div id="diagnosticsList"></div>
              </div>
              <p id="diagnosticsEmpty" class="text-gray-500 text-sm">
                「診断を実行」ボタンを押すと、現在のシフトデータのルール違反を確認できます。
              </p>
            </div>
          </div>
```

**Step 3: `loadShiftEditData()` の成功ハンドラーでテーブルを表示した直後に診断パネルも表示するコードを追加する**

```javascript
document.getElementById('shiftEditTableContainer').classList.remove('hidden');
document.getElementById('diagnosticsPanel').classList.remove('hidden');
document.getElementById('diagnosticsResult').classList.add('hidden');
document.getElementById('diagnosticsEmpty').classList.remove('hidden');
```

**Step 4: `runDiagnostics()` 関数をスクリプトブロックに追加する（DOM操作でXSS回避）**

```javascript
function runDiagnostics() {
  var targetMonth = document.getElementById('shiftEditTargetMonth').value;
  if (!targetMonth) { alert('対象月を選択してください'); return; }
  var parts = targetMonth.split('-').map(Number);
  var year = parts[0], month = parts[1];

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (!result.success) { alert('エラー: ' + result.message); return; }

      document.getElementById('diagnosticsEmpty').classList.add('hidden');
      document.getElementById('diagnosticsResult').classList.remove('hidden');

      var summaryEl = document.getElementById('diagnosticsSummary');
      summaryEl.textContent = '';

      if (!result.hasData) {
        summaryEl.textContent = '確定シフトデータがありません';
        document.getElementById('diagnosticsList').textContent = '';
        return;
      }

      // サマリーバッジをDOM操作で構築
      var errSpan = document.createElement('span');
      errSpan.className = 'px-3 py-1 rounded-full font-semibold ' +
        (result.summary.error > 0 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800');
      errSpan.textContent = 'エラー: ' + result.summary.error + '件';
      summaryEl.appendChild(errSpan);

      var warnSpan = document.createElement('span');
      warnSpan.className = 'px-3 py-1 rounded-full font-semibold ' +
        (result.summary.warning > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800');
      warnSpan.textContent = '警告: ' + result.summary.warning + '件';
      summaryEl.appendChild(warnSpan);

      var listEl = document.getElementById('diagnosticsList');
      listEl.textContent = '';

      if (result.summary.total === 0) {
        listEl.textContent = 'ルール違反は見つかりませんでした';
        return;
      }

      // タイプ別グループ化してDOM構築
      var grouped = {};
      result.violations.concat(result.warnings).forEach(function(v) {
        if (!grouped[v.type]) grouped[v.type] = [];
        grouped[v.type].push(v);
      });

      Object.keys(grouped).forEach(function(type) {
        var items = grouped[type];
        var isError = items[0].level === 'error';

        var wrapper = document.createElement('div');
        wrapper.className = 'mb-4 border rounded-lg overflow-hidden ' +
          (isError ? 'border-red-200' : 'border-yellow-200');

        var header = document.createElement('div');
        header.className = 'px-4 py-2 font-semibold ' +
          (isError ? 'bg-red-50 text-red-800' : 'bg-yellow-50 text-yellow-800');
        header.textContent = (isError ? 'エラー: ' : '警告: ') + type + ' (' + items.length + '件)';
        wrapper.appendChild(header);

        var ul = document.createElement('ul');
        ul.className = 'divide-y divide-gray-100';
        items.forEach(function(item) {
          var li = document.createElement('li');
          li.className = 'px-4 py-2 text-sm text-gray-700';
          li.textContent = item.message; // textContent でXSS安全
          ul.appendChild(li);
        });
        wrapper.appendChild(ul);
        listEl.appendChild(wrapper);
      });
    })
    .withFailureHandler(function(error) {
      hideLoading();
      alert('診断の実行に失敗しました');
      console.error(error);
    })
    .apiRunDiagnostics(year, month);
}
```

**Step 5: 動作確認（GASデプロイ後）**
1. 管理者でログイン → シフト修正タブへ
2. 月・グループを選択して「表示」→ 診断パネルが表示されることを確認
3. 「診断を実行」→ 違反一覧が表示されることを確認

**Step 6: Commit**
```bash
git add 07_index.html
git commit -m "feat: 診断レポートパネルをシフト修正画面に追加"
```

---

# フェーズ2: 事前の勤務指定（シフト固定）機能

---

### Task 3: データ層 - 新シートの初期化関数を追加

**Files:**
- Modify: `01_Config.gs`
- Modify: `02_DataService.gs`
- Modify: `06_Code.gs`

**Step 1: `01_Config.gs` の SHEET_NAMES に2つ追加する**

```javascript
const SHEET_NAMES = {
  STAFF: 'M_職員',
  SHIFT_MASTER: 'M_シフト',
  HOLIDAY_REQUEST: 'T_シフト休み希望',
  CONFIRMED_SHIFT: 'T_確定シフト',
  SETTINGS: 'M_設定',
  WORK_SHEET: 'シフト作業用',
  SHIFT_ASSIGNMENT: 'T_勤務指定',
  EVENT: 'M_イベント'
};
```

**Step 2: `02_DataService.gs` の末尾に以下を追加する**

```javascript
// ============================================
// T_勤務指定（事前シフト固定）関連
// ============================================

function initializeShiftAssignmentSheet() {
  var sheet = getOrCreateSheet('T_勤務指定');
  if (sheet.getLastRow() === 0) {
    var headers = ['指定ID', '氏名', 'グループ', '日付', 'シフト名', '登録者', '登録日時', '備考'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#ffe0b2');
    console.log('T_勤務指定シート初期化完了');
  }
  return sheet;
}

function saveShiftAssignment(staffName, date, shiftName, registeredBy, notes) {
  var sheet = initializeShiftAssignmentSheet();
  var timestamp = new Date();
  var dateObj = new Date(date);
  deleteShiftAssignmentByNameAndDate(staffName, dateObj);
  var assignmentId = 'ASSIGN_' + staffName + '_' +
    Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyyMMdd') + '_' + timestamp.getTime();
  var staff = getStaffByName(staffName);
  sheet.appendRow([assignmentId, staffName, staff ? staff['グループ'] : '',
    dateObj, shiftName, registeredBy || '', timestamp, notes || '']);
  return assignmentId;
}

function deleteShiftAssignmentByNameAndDate(staffName, dateObj) {
  var sheet = getOrCreateSheet('T_勤務指定');
  if (sheet.getLastRow() <= 1) return;
  var data = sheet.getDataRange().getValues();
  var targetStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyyMMdd');
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][1] === staffName && data[i][3]) {
      var rowStr = Utilities.formatDate(new Date(data[i][3]), Session.getScriptTimeZone(), 'yyyyMMdd');
      if (rowStr === targetStr) { sheet.deleteRow(i + 1); }
    }
  }
}

function deleteShiftAssignmentById(assignmentId) {
  var sheet = getOrCreateSheet('T_勤務指定');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === assignmentId) { sheet.deleteRow(i + 1); return true; }
  }
  return false;
}

function getShiftAssignmentsByMonth(year, month) {
  var sheet = getOrCreateSheet('T_勤務指定');
  if (sheet.getLastRow() <= 1) return [];
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var assignments = [];
  for (var i = 1; i < data.length; i++) {
    var dateVal = data[i][3];
    if (!dateVal) continue;
    var date = new Date(dateVal);
    if (date.getFullYear() == year && date.getMonth() + 1 == month) {
      var assignment = {};
      headers.forEach(function(header, idx) {
        var value = data[i][idx];
        assignment[header] = (value instanceof Date)
          ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : (value !== null && value !== undefined ? String(value) : '');
      });
      assignments.push(assignment);
    }
  }
  return assignments;
}

// ============================================
// M_イベント関連（予定・イベント表示）
// ============================================

function initializeEventSheet() {
  var sheet = getOrCreateSheet('M_イベント');
  if (sheet.getLastRow() === 0) {
    var headers = ['イベントID', 'タイトル', '日付', '備考', '登録者', '登録日時'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d4edda');
    console.log('M_イベントシート初期化完了');
  }
  return sheet;
}

function saveEvent(title, date, notes, registeredBy) {
  var sheet = initializeEventSheet();
  var timestamp = new Date();
  var dateObj = new Date(date);
  var eventId = 'EVT_' + Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyyMMdd') +
    '_' + timestamp.getTime();
  sheet.appendRow([eventId, title, dateObj, notes || '', registeredBy || '', timestamp]);
  return eventId;
}

function deleteEventById(eventId) {
  var sheet = getOrCreateSheet('M_イベント');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === eventId) { sheet.deleteRow(i + 1); return true; }
  }
  return false;
}

function getEventsByMonth(year, month) {
  var sheet = getOrCreateSheet('M_イベント');
  if (sheet.getLastRow() <= 1) return [];
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var events = [];
  for (var i = 1; i < data.length; i++) {
    var dateVal = data[i][2];
    if (!dateVal) continue;
    var date = new Date(dateVal);
    if (date.getFullYear() == year && date.getMonth() + 1 == month) {
      var ev = {};
      headers.forEach(function(header, idx) {
        var value = data[i][idx];
        ev[header] = (value instanceof Date)
          ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : (value !== null && value !== undefined ? String(value) : '');
      });
      events.push(ev);
    }
  }
  return events;
}
```

**Step 3: `06_Code.gs` の `initializeAllSheets()` に以下を追加する**

```javascript
      initializeShiftAssignmentSheet();
      initializeEventSheet();
```

**Step 4: GASエディタで `initializeAllSheets()` を実行してシートが作成されることを確認**

**Step 5: Commit**
```bash
git add 01_Config.gs 02_DataService.gs 06_Code.gs
git commit -m "feat: T_勤務指定・M_イベントシートのデータ層を追加"
```

---

### Task 4: バックエンド - 勤務指定・イベント API の追加

**Files:**
- Modify: `06_Code.gs`

**Step 1: `06_Code.gs` の末尾に以下を追加する**

```javascript
function apiGetShiftAssignments(year, month) {
  try {
    return { success: true, assignments: getShiftAssignmentsByMonth(year, month) };
  } catch (e) { return { success: false, message: e.message }; }
}

function apiSaveShiftAssignment(staffName, date, shiftName, notes) {
  try {
    var session = getSession();
    if (!session || !session.isAdmin) return { success: false, message: '管理者権限が必要です' };
    var id = saveShiftAssignment(staffName, date, shiftName, session.name, notes);
    return { success: true, assignmentId: id, message: '勤務指定を保存しました' };
  } catch (e) { return { success: false, message: e.message }; }
}

function apiDeleteShiftAssignment(assignmentId) {
  try {
    var session = getSession();
    if (!session || !session.isAdmin) return { success: false, message: '管理者権限が必要です' };
    var result = deleteShiftAssignmentById(assignmentId);
    return { success: result, message: result ? '削除しました' : 'データが見つかりません' };
  } catch (e) { return { success: false, message: e.message }; }
}

function apiGetEventsByMonth(year, month) {
  try {
    return { success: true, events: getEventsByMonth(year, month) };
  } catch (e) { return { success: false, message: e.message }; }
}

function apiSaveEvent(title, date, notes) {
  try {
    var session = getSession();
    if (!session || !session.isAdmin) return { success: false, message: '管理者権限が必要です' };
    var id = saveEvent(title, date, notes, session.name);
    return { success: true, eventId: id, message: 'イベントを保存しました' };
  } catch (e) { return { success: false, message: e.message }; }
}

function apiDeleteEvent(eventId) {
  try {
    var session = getSession();
    if (!session || !session.isAdmin) return { success: false, message: '管理者権限が必要です' };
    var result = deleteEventById(eventId);
    return { success: result, message: result ? '削除しました' : 'データが見つかりません' };
  } catch (e) { return { success: false, message: e.message }; }
}
```

**Step 2: Commit**
```bash
git add 06_Code.gs
git commit -m "feat: 勤務指定・イベントのCRUD APIを追加"
```

---

### Task 5: CSV出力 - 勤務指定データを M_設定 CSV に追記

**Files:**
- Modify: `08_CSVService.gs`

**Step 1: `exportSettingsToCSV()` 内の `settings.push(['DAYS_IN_MONTH', daysInMonth]);` の後に追加する**

```javascript
    // 勤務指定データを設定として追加（Python側で ASSIGN_ プレフィクスで識別）
    var assignments = getShiftAssignmentsByMonth(year, month);
    assignments.forEach(function(assign) {
      var dateStr = assign['日付'].replace(/-/g, '');
      settings.push(['ASSIGN_' + assign['氏名'] + '_' + dateStr, assign['シフト名']]);
    });
    if (assignments.length > 0) {
      console.log('勤務指定データをM_設定CSVに追加: ' + assignments.length + '件');
    }
```

**Step 2: Commit**
```bash
git add 08_CSVService.gs
git commit -m "feat: 勤務指定データをM_設定CSVに出力するよう追加"
```

---

### Task 6: フロントエンド - 勤務指定管理 UI の追加

**Files:**
- Modify: `07_index.html`

**Step 1: ナビゲーション ul タグ内に「勤務指定」タブを追加する**

```html
          <li>
            <button onclick="showView('shift-assignment')"
              class="nav-btn px-4 py-2 rounded hover:bg-blue-100 transition bg-purple-50 border border-purple-200">
              勤務指定
            </button>
          </li>
```

**Step 2: `showView()` 関数の viewIdMap と views 配列に shiftAssignmentView を追加し、初期化処理も追加する**

viewIdMap に追加:
```javascript
'shift-assignment': 'shiftAssignmentView'
```

views 配列に追加:
```javascript
'shiftAssignmentView'
```

初期化処理に追加:
```javascript
} else if (viewId === 'shiftAssignmentView') {
  initShiftAssignmentView();
}
```

**Step 3: シフト修正画面の `</div>` 直後・`</main>` の前に勤務指定管理ビューHTMLを追加する**

```html
      <!-- 勤務指定管理画面（管理者専用） -->
      <div id="shiftAssignmentView" class="hidden">
        <div class="bg-white rounded-lg shadow-lg p-6">
          <h2 class="text-2xl font-bold mb-4 text-gray-800">事前勤務指定（シフト固定）</h2>
          <p class="text-gray-600 mb-4 text-sm bg-yellow-50 border border-yellow-200 rounded p-3">
            自動シフト作成前に特定の職員の特定日のシフトを固定できます。
            3種CSV出力時に M_設定.csv に含まれます。
          </p>
          <div class="mb-4 flex gap-2">
            <input type="month" id="shiftAssignTargetMonth"
              class="px-4 py-2 border border-gray-300 rounded-lg">
            <button onclick="loadShiftAssignments()"
              class="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition">
              表示
            </button>
          </div>
          <div class="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
            <h3 class="text-md font-semibold text-purple-800 mb-3">新規勤務指定を追加</h3>
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">職員名</label>
                <select id="assignStaffName"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">-- 選択 --</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">日付</label>
                <input type="date" id="assignDate"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">シフト</label>
                <select id="assignShiftName"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">-- 選択 --</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">備考</label>
                <input type="text" id="assignNotes"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              </div>
            </div>
            <div class="mt-3">
              <button onclick="addShiftAssignment()"
                class="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 transition text-sm">
                指定を追加
              </button>
            </div>
            <p id="assignmentAddMessage" class="mt-2 text-sm hidden"></p>
          </div>
          <h3 class="text-md font-semibold text-gray-800 mb-3">勤務指定一覧</h3>
          <div class="overflow-x-auto border border-gray-200 rounded-lg">
            <table class="min-w-full text-sm">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">日付</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">職員名</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">G</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">シフト</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">備考</th>
                  <th class="px-4 py-2 text-center text-xs font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody id="assignmentTableBody" class="bg-white divide-y divide-gray-200">
              </tbody>
            </table>
          </div>
        </div>
      </div>
```

**Step 4: スクリプトブロックに勤務指定管理JS関数を追加する（全てDOM操作でXSS安全）**

```javascript
var assignmentStaffList = [];

function initShiftAssignmentView() {
  var now = new Date();
  document.getElementById('shiftAssignTargetMonth').value =
    now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  // 職員リスト読み込み
  if (assignmentStaffList.length === 0) {
    google.script.run
      .withSuccessHandler(function(result) {
        if (!result.success) return;
        assignmentStaffList = result.data.filter(function(s) {
          return s['有効'] === true || s['有効'] === 'TRUE';
        });
        var select = document.getElementById('assignStaffName');
        assignmentStaffList.forEach(function(s) {
          var opt = document.createElement('option');
          opt.value = s['氏名'];
          opt.textContent = s['氏名'] + ' (G' + s['グループ'] + ')';
          select.appendChild(opt);
        });
      })
      .withFailureHandler(function(e) { console.error(e); })
      .apiGetAllStaff();
  }

  // シフトリスト読み込み
  google.script.run
    .withSuccessHandler(function(result) {
      if (!result.success) return;
      var select = document.getElementById('assignShiftName');
      select.innerHTML = '';
      var defOpt = document.createElement('option');
      defOpt.value = '';
      defOpt.textContent = '-- 選択 --';
      select.appendChild(defOpt);
      result.shifts.filter(function(s) { return s['シフト名'] !== '休み'; }).forEach(function(s) {
        var opt = document.createElement('option');
        opt.value = s['シフト名'];
        opt.textContent = s['シフト名'];
        select.appendChild(opt);
      });
    })
    .withFailureHandler(function(e) { console.error(e); })
    .apiGetShiftMaster();
}

function loadShiftAssignments() {
  var targetMonth = document.getElementById('shiftAssignTargetMonth').value;
  if (!targetMonth) { alert('対象月を選択してください'); return; }
  var parts = targetMonth.split('-').map(Number);
  var year = parts[0], month = parts[1];

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      var tbody = document.getElementById('assignmentTableBody');
      tbody.textContent = '';

      var makeRow = function(cells, isHeader) {
        var tr = document.createElement('tr');
        cells.forEach(function(text) {
          var td = document.createElement('td');
          td.className = 'px-4 py-2' + (isHeader ? ' text-center' : '');
          td.textContent = text;
          tr.appendChild(td);
        });
        return tr;
      };

      if (!result.success || result.assignments.length === 0) {
        var tr = document.createElement('tr');
        var td = document.createElement('td');
        td.colSpan = 6;
        td.className = 'px-4 py-4 text-center text-gray-500';
        td.textContent = !result.success
          ? ('エラー: ' + result.message)
          : (year + '年' + month + '月の勤務指定はありません');
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      var sorted = result.assignments.slice().sort(function(a, b) {
        return (a['日付'] || '').localeCompare(b['日付'] || '');
      });

      sorted.forEach(function(a) {
        var tr = document.createElement('tr');
        [a['日付'], a['氏名'], a['グループ'], a['シフト名'], a['備考'] || '-'].forEach(function(val) {
          var td = document.createElement('td');
          td.className = 'px-4 py-2';
          td.textContent = val;
          tr.appendChild(td);
        });
        var tdBtn = document.createElement('td');
        tdBtn.className = 'px-4 py-2 text-center';
        var btn = document.createElement('button');
        btn.className = 'bg-red-100 text-red-700 px-3 py-1 rounded hover:bg-red-200 text-xs';
        btn.textContent = '削除';
        btn.dataset.id = a['指定ID']; // dataset で安全にIDを渡す
        btn.addEventListener('click', function() { deleteAssignment(this.dataset.id); });
        tdBtn.appendChild(btn);
        tr.appendChild(tdBtn);
        tbody.appendChild(tr);
      });
    })
    .withFailureHandler(function(e) { hideLoading(); console.error(e); })
    .apiGetShiftAssignments(year, month);
}

function addShiftAssignment() {
  var staffName = document.getElementById('assignStaffName').value;
  var date = document.getElementById('assignDate').value;
  var shiftName = document.getElementById('assignShiftName').value;
  var notes = document.getElementById('assignNotes').value;
  var msgEl = document.getElementById('assignmentAddMessage');

  if (!staffName || !date || !shiftName) {
    msgEl.textContent = '職員名、日付、シフトはすべて必須です';
    msgEl.className = 'mt-2 text-sm text-red-600';
    msgEl.classList.remove('hidden');
    return;
  }

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      msgEl.classList.remove('hidden');
      msgEl.textContent = result.success ? '保存しました' : result.message;
      msgEl.className = 'mt-2 text-sm ' + (result.success ? 'text-green-600' : 'text-red-600');
      if (result.success) {
        document.getElementById('assignStaffName').value = '';
        document.getElementById('assignDate').value = '';
        document.getElementById('assignShiftName').value = '';
        document.getElementById('assignNotes').value = '';
        loadShiftAssignments();
      }
    })
    .withFailureHandler(function(e) {
      hideLoading();
      msgEl.textContent = 'エラーが発生しました';
      msgEl.className = 'mt-2 text-sm text-red-600';
      msgEl.classList.remove('hidden');
      console.error(e);
    })
    .apiSaveShiftAssignment(staffName, date, shiftName, notes);
}

function deleteAssignment(assignmentId) {
  if (!confirm('この勤務指定を削除しますか？')) return;
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) { loadShiftAssignments(); }
      else { alert('削除エラー: ' + result.message); }
    })
    .withFailureHandler(function(e) { hideLoading(); console.error(e); })
    .apiDeleteShiftAssignment(assignmentId);
}
```

**Step 5: 動作確認**
1. GASデプロイ後、管理者でログイン
2. ナビに「勤務指定」タブが表示されることを確認
3. 職員・日付・シフトを選択して「指定を追加」→ 一覧に表示されることを確認
4. 「削除」ボタンで削除できることを確認
5. 3種CSV出力後、M_設定.csv に ASSIGN_ 行が含まれることを Drive で確認

**Step 6: Commit**
```bash
git add 07_index.html
git commit -m "feat: 勤務指定管理UIを追加（XSS対策済み）"
```

---

# フェーズ3: 予定・イベントの事前表示機能

---

### Task 7: フロントエンド - 休み希望画面へのイベント表示

**Files:**
- Modify: `07_index.html`

**Step 1: `loadHolidayRequest()` 内で休み希望取得後にイベントも取得するよう変更する**

`renderCalendar(year, month, result.data)` の呼び出し（2箇所）を以下に置き換える:

```javascript
google.script.run
  .withSuccessHandler(function(evResult) {
    hideLoading();
    var events = evResult.success ? evResult.events : [];
    renderCalendar(year, month, result.data, events);
  })
  .withFailureHandler(function(e) {
    hideLoading();
    renderCalendar(year, month, result.data, []);
    console.error(e);
  })
  .apiGetEventsByMonth(year, month);
```

**Step 2: `renderCalendar()` のシグネチャを変更してイベントマップを構築する**

```javascript
function renderCalendar(year, month, savedRequests, events) {
  events = events || [];
  // 日→イベントリストのマップ
  var eventMap = {};
  events.forEach(function(e) {
    var day = parseInt(e['日付'].split('-')[2]);
    if (!eventMap[day]) eventMap[day] = [];
    eventMap[day].push(e);
  });
  // ... 既存のカレンダー生成ロジック ...
```

各日のセル(`dayDiv`)を生成した後に以下を追加する（DOM操作でXSS安全）:

```javascript
  // イベントマーカーをDOM操作で追加
  var dayEvents = eventMap[d] || [];
  dayEvents.forEach(function(ev) {
    var evEl = document.createElement('div');
    evEl.className = 'mt-1 px-1 bg-orange-500 text-white text-xs rounded truncate';
    evEl.textContent = ev['タイトル']; // textContent でXSS安全
    evEl.title = ev['タイトル'] + (ev['備考'] ? ': ' + ev['備考'] : '');
    dayDiv.appendChild(evEl);
  });
```

また、カレンダー描画後に `renderEventList(events)` を呼び出す。

**Step 3: `initHolidayRequestView()` に管理者チェックを追加する**

```javascript
function initHolidayRequestView() {
  var now = new Date();
  document.getElementById('targetMonth').value =
    now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  if (currentSession && currentSession.isAdmin) {
    document.getElementById('eventManagementSection').classList.remove('hidden');
  }
  loadHolidayRequest();
}
```

**Step 4: 休み希望画面のカレンダー上部にイベント管理セクションHTMLを追加する**

`<div id="calendar">` の直前に追加:

```html
          <!-- イベント管理セクション（管理者のみ表示） -->
          <div id="eventManagementSection" class="mb-6 hidden">
            <div class="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div class="flex justify-between items-center mb-3">
                <h3 class="text-md font-semibold text-orange-800">イベント・予定管理（管理者）</h3>
                <button onclick="toggleEventForm()"
                  class="text-orange-700 hover:text-orange-900 text-sm underline">
                  + イベントを追加
                </button>
              </div>
              <div id="eventAddForm" class="hidden mb-3 p-3 bg-white border border-orange-200 rounded">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">タイトル</label>
                    <input type="text" id="eventTitle"
                      class="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      placeholder="全体会議 など">
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">日付</label>
                    <input type="date" id="eventDate"
                      class="w-full px-2 py-1 border border-gray-300 rounded text-sm">
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">備考</label>
                    <input type="text" id="eventNotes"
                      class="w-full px-2 py-1 border border-gray-300 rounded text-sm">
                  </div>
                </div>
                <button onclick="addEvent()"
                  class="bg-orange-600 text-white px-4 py-1 rounded hover:bg-orange-700 transition text-sm">
                  追加
                </button>
                <span id="eventAddMsg" class="ml-2 text-sm"></span>
              </div>
              <div id="eventList" class="text-sm text-gray-700">
                イベントを読み込み中...
              </div>
            </div>
          </div>
```

**Step 5: スクリプトブロックにイベント管理JS関数を追加する（DOM操作でXSS安全）**

```javascript
function toggleEventForm() {
  document.getElementById('eventAddForm').classList.toggle('hidden');
}

function addEvent() {
  var title = document.getElementById('eventTitle').value.trim();
  var date = document.getElementById('eventDate').value;
  var notes = document.getElementById('eventNotes').value.trim();
  var msgEl = document.getElementById('eventAddMsg');

  if (!title || !date) { msgEl.textContent = 'タイトルと日付は必須です'; return; }

  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      msgEl.textContent = result.success ? '追加しました' : result.message;
      if (result.success) {
        document.getElementById('eventTitle').value = '';
        document.getElementById('eventDate').value = '';
        document.getElementById('eventNotes').value = '';
        loadHolidayRequest(); // カレンダーを再読み込み
      }
    })
    .withFailureHandler(function(e) { hideLoading(); console.error(e); })
    .apiSaveEvent(title, date, notes);
}

function deleteEvent(eventId) {
  if (!confirm('このイベントを削除しますか？')) return;
  showLoading();
  google.script.run
    .withSuccessHandler(function(result) {
      hideLoading();
      if (result.success) { loadHolidayRequest(); }
      else { alert('削除エラー: ' + result.message); }
    })
    .withFailureHandler(function(e) { hideLoading(); console.error(e); })
    .apiDeleteEvent(eventId);
}

// renderCalendar() の末尾から呼び出す
function renderEventList(events) {
  var listEl = document.getElementById('eventList');
  if (!listEl) return;
  listEl.textContent = '';
  if (!events || events.length === 0) {
    listEl.textContent = 'この月のイベントはありません';
    return;
  }
  var sorted = events.slice().sort(function(a, b) {
    return (a['日付'] || '').localeCompare(b['日付'] || '');
  });
  sorted.forEach(function(ev) {
    var row = document.createElement('div');
    row.className = 'flex items-center justify-between py-1 border-b border-orange-100';

    var text = document.createElement('span');
    var day = ev['日付'].split('-')[2];
    text.textContent = day + '日: ' + ev['タイトル'] +
      (ev['備考'] ? ' (' + ev['備考'] + ')' : '');
    row.appendChild(text);

    if (currentSession && currentSession.isAdmin) {
      var btn = document.createElement('button');
      btn.className = 'text-red-500 hover:text-red-700 text-xs ml-2';
      btn.textContent = '削除';
      btn.dataset.id = ev['イベントID']; // dataset で安全にIDを渡す
      btn.addEventListener('click', function() { deleteEvent(this.dataset.id); });
      row.appendChild(btn);
    }
    listEl.appendChild(row);
  });
}
```

**Step 6: 動作確認**
1. 管理者でログイン → 休み希望提出画面にイベント管理セクションが表示されることを確認
2. イベント（例: 「全体会議」）を追加 → カレンダーの対象日にマーカーが表示されることを確認
3. 一般職員でログイン → 管理セクションは非表示だがマーカーは表示されることを確認

**Step 7: Commit**
```bash
git add 07_index.html
git commit -m "feat: 休み希望画面へのイベント表示機能を追加（XSS対策済み）"
```

---

# 最終確認

### Task 8: 統合テスト

**Step 1: GASエディタで初期化を実行**
```
initializeAllSheets()
```
→ M_イベント、T_勤務指定の両シートが作成されることを確認

**Step 2: 動作確認チェックリスト**

- [ ] 診断レポート: シフト修正画面で「診断を実行」が動作する
- [ ] 診断レポート: エラー・警告が種類別に表示される
- [ ] 診断レポート: データなしの場合メッセージが表示される
- [ ] 勤務指定: ナビに「勤務指定」タブが表示される
- [ ] 勤務指定: 追加・削除が動作する
- [ ] 勤務指定: 3種CSV出力後、M_設定.csv に ASSIGN_ 行が含まれる
- [ ] イベント: 管理者のみイベント管理セクションが表示される
- [ ] イベント: イベント追加後カレンダーにマーカーが表示される
- [ ] イベント: 一般職員でもカレンダーのマーカーが見える

**Step 3: 最終 Commit**
```bash
git add .
git commit -m "feat: シフト作成アプリ改修完了（診断レポート・勤務指定・イベント表示）"
```

---

---

# フェーズ2b: Python 側への勤務指定対応（shift_optimizer.py）

## 概要
GAS側が M_設定.csv に `ASSIGN_氏名_YYYYMMDD` 形式で勤務指定を書き出す。
`shift_optimizer.py` でこれを読み込み、CP-SAT モデルにハード制約として追加する。

---

### Task 9: shift_optimizer.py に事前勤務指定のハード制約を追加

**Files:**
- Modify: `shift_optimizer.py`

**Step 1: ファイル先頭のインポートに `re` を追加する（既になければ）**

```python
import re
```

**Step 2: `optimize_shift()` 関数内の設定値取得ブロック（`max_consecutive_work = ...` の行）の後に、勤務指定の解析コードを追加する**

追加位置: `print(f'  最大連勤: {max_consecutive_work}日')` の直後

```python
    # ============================================
    # 事前勤務指定を解析（ASSIGN_ キー）
    # ============================================
    pre_assignments = []  # [(staff_index, day_index_0based, shift_type_index)]

    for _, row in settings_df.iterrows():
        setting_id = str(row['設定ID'])
        # ASSIGN_氏名_YYYYMMDD 形式をパース
        m = re.match(r'ASSIGN_(.+)_(\d{4})(\d{2})(\d{2})$', setting_id)
        if not m:
            continue
        name = m.group(1)
        year_a = int(m.group(2))
        month_a = int(m.group(3))
        day_a = int(m.group(4))
        shift_name = str(row['設定値']).strip()

        if name not in staff_names:
            print(f'  ⚠️ 事前指定: 職員が見つかりません - {name}')
            continue
        if year_a != year or month_a != month:
            continue
        if day_a < 1 or day_a > num_days:
            print(f'  ⚠️ 事前指定: 日付が範囲外 - {name} {day_a}日')
            continue
        if shift_name not in SHIFT_TYPES:
            print(f'  ⚠️ 事前指定: 不明なシフト名 - {shift_name} ({name} {day_a}日) - スキップ')
            continue

        s = staff_names.index(name)
        d = day_a - 1  # 0-indexed
        t = SHIFT_TYPES.index(shift_name)
        pre_assignments.append((s, d, t, name, day_a, shift_name))

    if pre_assignments:
        print(f'  📌 事前勤務指定: {len(pre_assignments)}件')
    else:
        print('  📌 事前勤務指定: なし')
```

**Step 3: 制約1（休み希望）の直前に、事前勤務指定のハード制約を追加する**

追加位置: `# 制約1: 休み希望` のコメントの直前

```python
    # ============================================
    # 制約0: 事前勤務指定（ハード制約）
    # ============================================
    for s, d, t, name, day, shift_name in pre_assignments:
        model.Add(shifts[(s, d, t)] == 1)
        print(f'    → {name} {day}日: {shift_name} を固定')
```

**Step 4: 手動テスト手順**

1. M_設定.csv に手動でテスト行を追加する（例）:
   ```
   ASSIGN_山田太郎_20260115,早出
   ```
2. Google Colab で shift_optimizer.py を実行
3. ログに `📌 事前勤務指定: 1件` と `→ 山田太郎 15日: 早出 を固定` が表示されることを確認
4. 出力 CSV で山田太郎の15日が「早出」になっていることを確認
5. テスト行を削除して再実行し、指定なしの場合も正常動作することを確認

**注意:** 事前指定が他の制約（夜勤明けルール・連勤制限など）と矛盾する場合、
CP-SAT ソルバーが INFEASIBLE になる可能性がある。
矛盾する指定は管理者側で事前に確認する必要がある（診断レポート機能で検出可能）。

**Step 5: Commit**
```bash
git add shift_optimizer.py
git commit -m "feat: shift_optimizer.py に事前勤務指定のハード制約を追加"
```

---

# 最終確認（更新版）

### Task 10: 統合テスト

**Step 1: GASエディタで初期化を実行**
```
initializeAllSheets()
```
→ M_イベント、T_勤務指定の両シートが作成されることを確認

**Step 2: 動作確認チェックリスト**

- [ ] 診断レポート: シフト修正画面で「診断を実行」が動作する
- [ ] 診断レポート: エラー・警告が種類別に表示される
- [ ] 診断レポート: データなしの場合メッセージが表示される
- [ ] 勤務指定(GAS): ナビに「勤務指定」タブが表示される
- [ ] 勤務指定(GAS): 追加・削除が動作する
- [ ] 勤務指定(GAS): 3種CSV出力後、M_設定.csv に ASSIGN_ 行が含まれる
- [ ] 勤務指定(Python): shift_optimizer.py 実行時に事前指定が反映される
- [ ] イベント: 管理者のみイベント管理セクションが表示される
- [ ] イベント: イベント追加後カレンダーにマーカーが表示される
- [ ] イベント: 一般職員でもカレンダーのマーカーが見える

**Step 3: 最終 Commit**
```bash
git add .
git commit -m "feat: シフト作成アプリ改修完了（診断レポート・勤務指定・イベント表示）"
```

---

## 補足: 月途中の急なシフト再計算機能（保留）

要望4は大規模改修のため本計画には含めない。
初期リリース後のフィードバックを踏まえて別途計画立案する。
