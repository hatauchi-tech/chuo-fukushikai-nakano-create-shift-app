/**
 * ShiftService.gs - シフト作成・チェックサービス
 * シフト案の自動作成とルールチェック機能を提供
 */

// ============================================
// シフト案作成
// ============================================

/**
 * シフト案を作成する（たたき台レベル）
 * @param {number} year - 対象年
 * @param {number} month - 対象月
 * @param {number} monthlyHolidays - 月間公休日数（デフォルト: 9日）
 */
function createShiftDraft(year, month, monthlyHolidays) {
  try {
    // デフォルト値の設定
    if (!monthlyHolidays || monthlyHolidays <= 0) {
      monthlyHolidays = 9; // デフォルト9日
    }

    console.log(`シフト案作成開始: ${year}年${month}月 (公休数: ${monthlyHolidays}日)`);

    const staff = getActiveStaff();
    const daysInMonth = new Date(year, month, 0).getDate();

    // 作業用シートを初期化
    const workSheet = initializeWorkSheet(year, month, staff, daysInMonth);

    // 各スタッフの休み希望を反映
    staff.forEach((person, index) => {
      const holidays = getHolidayRequestByNameAndMonth(person['氏名'], year, month);
      holidays.forEach(holiday => {
        const day = new Date(holiday['日付']).getDate();
        workSheet.getRange(index + 2, day + 2).setValue('休み');  // グループ列追加により+2に変更
      });
    });

    // 最適化アルゴリズムでシフトを配置（公休数を渡す）
    const result = assignShiftsWithOptimization(workSheet, staff, year, month, daysInMonth, monthlyHolidays);

    console.log('シフト案作成完了');
    return result;

  } catch (e) {
    console.error('シフト案作成エラー:', e);
    return { success: false, message: 'エラーが発生しました: ' + e.message };
  }
}

/**
 * 作業用シートを初期化（高速化・改善版）
 */
function initializeWorkSheet(year, month, staff, daysInMonth) {
  const ss = getSpreadsheet();
  const sheetName = SHEET_NAMES.WORK_SHEET;

  // 既存のシートを削除して再作成
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) {
    ss.deleteSheet(sheet);
  }
  sheet = ss.insertSheet(sheetName);

  // データテーブル全体を配列で作成（高速化）
  const tableData = [];

  // ヘッダー行を作成（氏名・グループ列を追加）
  const headers = ['氏名', 'グループ'];
  const headerDates = []; // 日付型データ用

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    headers.push(date);  // 日付型データを追加
    headerDates.push(date);
  }
  tableData.push(headers);

  // スタッフ行を作成
  staff.forEach(person => {
    const row = [person['氏名'], person['グループ']];
    for (let day = 1; day <= daysInMonth; day++) {
      row.push('');  // 空のシフト欄
    }
    tableData.push(row);
  });

  // 配列一括貼り付け（高速化）
  const range = sheet.getRange(1, 1, tableData.length, headers.length);
  range.setValues(tableData);

  // ヘッダーのスタイル設定
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange
    .setFontWeight('bold')
    .setBackground('#4a86e8')
    .setFontColor('#ffffff');

  // 日付列の表示形式を「M/d(aaa)」に設定
  const dateHeaderRange = sheet.getRange(1, 3, 1, daysInMonth);
  dateHeaderRange.setNumberFormat('M/d(aaa)');

  // 固定列を2列（氏名・グループ）に設定
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);

  // シフト名のプルダウン（入力規則）を設定
  const shiftMaster = getAllShiftMaster();
  const shiftNames = shiftMaster.map(shift => shift['シフト名']);

  if (shiftNames.length > 0 && staff.length > 0) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(shiftNames, true)  // プルダウン表示
      .setAllowInvalid(true)  // リスト外の値も許可
      .build();

    // シフト欄（3列目以降、2行目以降）に入力規則を設定
    const shiftRange = sheet.getRange(2, 3, staff.length, daysInMonth);
    shiftRange.setDataValidation(rule);
  }

  console.log(`作業用シート初期化完了: ${staff.length}名 × ${daysInMonth}日`);
  return sheet;
}

/**
 * 新・シフト生成アルゴリズム（3段階処理）
 *
 * 【処理順序】
 * STEP1: 月間公休日数を割り当て（休み希望の優先順位調整付き）
 * STEP2: 資格者の夜勤を割り当て
 * STEP3: 残りのシフトを割り当て（最低人数、連勤制限、インターバル制限）
 *
 * @param {Object} sheet - 作業用シート
 * @param {Array} staff - スタッフ配列
 * @param {number} year - 対象年
 * @param {number} month - 対象月
 * @param {number} daysInMonth - 月の日数
 * @param {number} monthlyHolidays - 月間公休日数
 */
function assignShiftsWithOptimization(sheet, staff, year, month, daysInMonth, monthlyHolidays) {
  try {
    console.log(`\n━━━ シフト生成開始: ${year}年${month}月 ━━━`);
    console.log(`月間公休日数: ${monthlyHolidays}日`);
    console.log(`対象スタッフ数: ${staff.length}名\n`);

    // シフトデータを2次元配列で管理（高速化）
    const shiftData = [];
    for (let i = 0; i < staff.length; i++) {
      shiftData[i] = [];
      for (let day = 0; day < daysInMonth; day++) {
        shiftData[i][day] = '';  // 初期化
      }
    }

    // ━━━ STEP1: 月間公休日数を割り当て（優先順位調整付き） ━━━
    console.log('【STEP1】休み希望の優先順位調整開始...');
    assignHolidaysWithPriority(shiftData, staff, year, month, daysInMonth, monthlyHolidays);

    // ━━━ STEP2: 資格者の夜勤を割り当て ━━━
    console.log('\n【STEP2】資格者の夜勤割り当て開始...');
    assignQualifiedNightShiftsFirst(shiftData, staff, daysInMonth);

    // ━━━ STEP3: 残りのシフトを割り当て ━━━
    console.log('\n【STEP3】残りシフトの割り当て開始...');
    assignRemainingShifts(shiftData, staff, year, month, daysInMonth);

    // シートに一括書き込み
    const writeData = [];
    for (let i = 0; i < staff.length; i++) {
      writeData[i] = shiftData[i];
    }

    if (writeData.length > 0) {
      sheet.getRange(2, 3, staff.length, daysInMonth).setValues(writeData);
    }

    console.log('\n━━━ シフト生成完了 ━━━\n');
    return { success: true, message: `シフト案を作成しました（公休${monthlyHolidays}日/月）` };

  } catch (e) {
    console.error('シフト生成エラー:', e);
    return { success: false, message: 'シフト生成エラー: ' + e.message };
  }
}

// ============================================
// STEP1: 休み希望の優先順位調整
// ============================================

/**
 * STEP1: 月間公休日数を割り当て（優先順位調整付き）
 */
function assignHolidaysWithPriority(shiftData, staff, year, month, daysInMonth, monthlyHolidays) {
  // 各スタッフの休み希望を収集
  const holidayRequests = [];

  for (let i = 0; i < staff.length; i++) {
    const person = staff[i];
    const requests = getHolidayRequestByNameAndMonth(person['氏名'], year, month);

    requests.forEach(req => {
      const day = new Date(req['日付']).getDate() - 1;  // 0-indexed
      const priority = req['優先順位'] || 99;  // 休み希望データの優先順位（数値が小さいほど優先度が高い）

      holidayRequests.push({
        staffIndex: i,
        staffName: person['氏名'],
        day: day,
        priority: priority
      });
    });
  }

  // 日付ごとにグループ化して優先順位でソート
  const requestsByDay = {};
  for (let day = 0; day < daysInMonth; day++) {
    requestsByDay[day] = [];
  }

  holidayRequests.forEach(req => {
    requestsByDay[req.day].push(req);
  });

  // 各日の重複をチェックして優先順位で調整
  let totalAssigned = 0;
  for (let day = 0; day < daysInMonth; day++) {
    const requests = requestsByDay[day];

    // 優先順位でソート（数値が小さいほど優先度が高い）
    requests.sort((a, b) => a.priority - b.priority);

    // 優先順位が高い人から割り当て
    requests.forEach(req => {
      if (shiftData[req.staffIndex][req.day] === '') {
        shiftData[req.staffIndex][req.day] = '休み';
        totalAssigned++;
      }
    });
  }

  console.log(`休み希望を${totalAssigned}件割り当てました`);
}

// ============================================
// STEP2: 資格者の夜勤割り当て
// ============================================

/**
 * STEP2: 資格者の夜勤を優先的に割り当て
 */
function assignQualifiedNightShiftsFirst(shiftData, staff, daysInMonth) {
  // 資格者リスト
  const qualifiedStaff = staff.map((p, i) => {
    const isQualified = (p['喀痰吸引資格者'] === true || p['喀痰吸引資格者'] === 'TRUE');
    const canNightShift = !(p['勤務配慮'] === true || p['勤務配慮'] === 'TRUE');
    return (isQualified && canNightShift) ? i : -1;
  }).filter(i => i >= 0);

  console.log(`資格者（夜勤可能）: ${qualifiedStaff.length}名`);

  let assignedCount = 0;

  // 各日に資格者の夜勤を最低1名配置
  for (let day = 0; day < daysInMonth; day++) {
    let hasQualified = false;

    for (const staffIndex of qualifiedStaff) {
      if (shiftData[staffIndex][day] === '' && canAssignShift(shiftData, staff, staffIndex, day, '夜勤')) {
        shiftData[staffIndex][day] = '夜勤';
        hasQualified = true;
        assignedCount++;
        break;
      }
    }

    if (!hasQualified) {
      console.log(`⚠️ 警告: ${day + 1}日に資格者の夜勤を配置できませんでした`);
    }
  }

  console.log(`資格者の夜勤を${assignedCount}件割り当てました`);
}

// ============================================
// STEP3: 残りのシフト割り当て
// ============================================

/**
 * STEP3: 残りのシフトを最低人数・連勤制限・インターバル制限を考慮して割り当て
 */
function assignRemainingShifts(shiftData, staff, year, month, daysInMonth) {
  // グループごとにスタッフをグループ化
  const staffByGroup = {};
  for (let i = 0; i < staff.length; i++) {
    const group = staff[i]['グループ'];
    if (!staffByGroup[group]) {
      staffByGroup[group] = [];
    }
    staffByGroup[group].push({ index: i, data: staff[i] });
  }

  let assignedCount = 0;

  // 日ごとに処理
  for (let day = 0; day < daysInMonth; day++) {
    const date = new Date(year, month - 1, day + 1);
    const isSunday = date.getDay() === 0;

    // 各グループごとに最低人数を確保
    for (let group = 1; group <= 6; group++) {
      const groupStaff = staffByGroup[group] || [];

      // 夜勤: 1名以上（既に資格者が割り当て済みの場合はスキップ）
      const nightShiftCount = countShiftInGroup(shiftData, groupStaff, day, '夜勤');
      if (nightShiftCount < 1) {
        assignedCount += assignShiftToGroupSimple(shiftData, staff, groupStaff, day, '夜勤', 1 - nightShiftCount);
      }

      // 早出: 2名以上
      assignedCount += assignShiftToGroupSimple(shiftData, staff, groupStaff, day, '早出', 2);

      // 日勤: 1名以上（日曜は0名OK）
      if (!isSunday) {
        assignedCount += assignShiftToGroupSimple(shiftData, staff, groupStaff, day, '日勤', 1);
      }

      // 遅出: 1名以上
      assignedCount += assignShiftToGroupSimple(shiftData, staff, groupStaff, day, '遅出', 1);
    }
  }

  // 残りを休みで埋める
  fillRemainingWithRest(shiftData, staff, daysInMonth);

  console.log(`残りシフトを${assignedCount}件割り当てました`);
}

/**
 * グループ内の特定シフトの人数をカウント
 */
function countShiftInGroup(shiftData, groupStaff, day, shiftType) {
  let count = 0;
  for (const s of groupStaff) {
    if (shiftData[s.index][day] === shiftType) {
      count++;
    }
  }
  return count;
}

/**
 * グループ内に指定シフトを必要人数分割り当て（シンプル版）
 */
function assignShiftToGroupSimple(shiftData, staff, groupStaff, day, shiftType, requiredCount) {
  let assignedCount = 0;

  for (const s of groupStaff) {
    if (assignedCount >= requiredCount) break;

    if (shiftData[s.index][day] === '' && canAssignShift(shiftData, staff, s.index, day, shiftType)) {
      shiftData[s.index][day] = shiftType;
      assignedCount++;
    }
  }

  return assignedCount;
}

/**
 * 残りのセルを休みで埋める
 */
function fillRemainingWithRest(shiftData, staff, daysInMonth) {
  for (let staffIndex = 0; staffIndex < staff.length; staffIndex++) {
    for (let day = 0; day < daysInMonth; day++) {
      if (shiftData[staffIndex][day] === '') {
        shiftData[staffIndex][day] = '休み';
      }
    }
  }
}

/**
 * 制約チェック：指定されたシフトを割り当て可能かチェック
 */
function canAssignShift(shiftData, staff, staffIndex, day, shiftType) {
  // 既に何か入っている場合は不可
  if (shiftData[staffIndex][day] !== '') return false;

  // 勤務配慮者は夜勤不可
  const person = staff[staffIndex];
  if (shiftType === '夜勤' && (person['勤務配慮'] === true || person['勤務配慮'] === 'TRUE')) {
    return false;
  }

  // 連勤制限チェック（5連勤以内）
  if (!checkConsecutiveDaysConstraint(shiftData[staffIndex], day)) {
    return false;
  }

  // 月間勤務日数上限チェック（21日以内、夜勤は2日分換算）
  if (!checkMonthlyWorkDaysConstraint(shiftData[staffIndex], shiftType)) {
    return false;
  }

  // インターバルルールチェック（遅出→早出禁止）
  if (!checkIntervalConstraint(shiftData[staffIndex], day, shiftType)) {
    return false;
  }

  // 夜勤明けルールチェック（夜勤→休→休）
  if (!checkNightShiftRestConstraint(shiftData[staffIndex], day, shiftType)) {
    return false;
  }

  return true;
}

/**
 * 連勤制限チェック（5連勤以内）
 */
function checkConsecutiveDaysConstraint(staffShiftData, day) {
  let consecutiveDays = 0;

  // 指定日から遡って連勤日数をカウント
  for (let d = day - 1; d >= 0; d--) {
    if (staffShiftData[d] !== '' && staffShiftData[d] !== '休み') {
      consecutiveDays++;
    } else {
      break;
    }
  }

  // 5連勤まで許可（現在4連勤以下なら、今日割り当てて5連勤まで）
  return consecutiveDays < 5;
}

/**
 * 月間勤務日数上限チェック（21日以内、夜勤は2日分換算）
 */
function checkMonthlyWorkDaysConstraint(staffShiftData, shiftType) {
  let workDays = 0;

  for (let d = 0; d < staffShiftData.length; d++) {
    if (staffShiftData[d] === '夜勤') {
      workDays += 2; // 夜勤は2日分
    } else if (staffShiftData[d] !== '' && staffShiftData[d] !== '休み') {
      workDays += 1;
    }
  }

  // 今日割り当てるシフトを加算
  if (shiftType === '夜勤') {
    workDays += 2;
  } else if (shiftType !== '休み' && shiftType !== '') {
    workDays += 1;
  }

  // 21日以内
  return workDays <= 21;
}

/**
 * インターバルルールチェック（遅出→早出禁止）
 */
function checkIntervalConstraint(staffShiftData, day, shiftType) {
  if (day === 0) return true;  // 初日はチェック不要

  const prevShift = staffShiftData[day - 1];

  // 前日が遅出で、今日が早出の場合は不可
  if (prevShift === '遅出' && shiftType === '早出') {
    return false;
  }

  return true;
}

/**
 * 夜勤明けルールチェック（夜勤→休→休）
 */
function checkNightShiftRestConstraint(staffShiftData, day, shiftType) {
  // 前日が夜勤の場合、今日は休みでなければならない
  if (day > 0 && staffShiftData[day - 1] === '夜勤' && shiftType !== '休み') {
    return false;
  }

  // 前々日が夜勤の場合、今日も休みでなければならない
  if (day > 1 && staffShiftData[day - 2] === '夜勤' && shiftType !== '休み') {
    return false;
  }

  // 今日が夜勤の場合、前日が夜勤ではないことを確認
  if (shiftType === '夜勤' && day > 0 && staffShiftData[day - 1] === '夜勤') {
    return false;
  }

  return true;
}

// ============================================
// ルールチェック機能
// ============================================

/**
 * シフトのルールチェックを実行
 */
function checkShiftRules(year, month) {
  try {
    console.log(`ルールチェック開始: ${year}年${month}月`);

    const sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.WORK_SHEET);
    if (!sheet) {
      return { success: false, message: '作業用シートが見つかりません' };
    }

    const staff = getActiveStaff();
    const daysInMonth = new Date(year, month, 0).getDate();
    const data = sheet.getDataRange().getValues();

    const violations = [];

    // 各ルールをチェック
    violations.push(...checkMinimumStaffRule(data, staff, daysInMonth));
    violations.push(...checkConsecutiveWorkDaysRule(data, staff, daysInMonth));
    violations.push(...checkIntervalRule(data, staff, daysInMonth));
    violations.push(...checkMaxWorkDaysRule(data, staff, daysInMonth));
    violations.push(...checkNightShiftRestRule(data, staff, daysInMonth));
    violations.push(...checkQualifiedStaffRule(data, staff, daysInMonth));

    // 違反箇所をハイライト
    highlightViolations(sheet, violations);

    console.log(`ルールチェック完了: ${violations.length}件の違反`);

    return {
      success: true,
      violations: violations,
      message: `チェック完了: ${violations.length}件の違反が見つかりました`
    };

  } catch (e) {
    console.error('ルールチェックエラー:', e);
    return { success: false, message: 'エラーが発生しました: ' + e.message };
  }
}

/**
 * シフトのルールチェックを実行（選択式）
 * @param {number} year - 対象年
 * @param {number} month - 対象月
 * @param {Array} selectedRules - チェックするルール番号の配列 [1,2,3,4,5,6]
 */
function checkShiftRulesSelective(year, month, selectedRules) {
  try {
    console.log(`ルールチェック開始: ${year}年${month}月 (選択: ${selectedRules.join(',')})`);

    const sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.WORK_SHEET);
    if (!sheet) {
      return { success: false, message: '作業用シートが見つかりません' };
    }

    const staff = getActiveStaff();
    const daysInMonth = new Date(year, month, 0).getDate();
    const data = sheet.getDataRange().getValues();

    const violations = [];

    // 選択されたルールのみチェック
    if (selectedRules.includes(1)) {
      violations.push(...checkMinimumStaffRule(data, staff, daysInMonth));
    }
    if (selectedRules.includes(2)) {
      violations.push(...checkConsecutiveWorkDaysRule(data, staff, daysInMonth));
    }
    if (selectedRules.includes(3)) {
      violations.push(...checkIntervalRule(data, staff, daysInMonth));
    }
    if (selectedRules.includes(4)) {
      violations.push(...checkMaxWorkDaysRule(data, staff, daysInMonth));
    }
    if (selectedRules.includes(5)) {
      violations.push(...checkNightShiftRestRule(data, staff, daysInMonth));
    }
    if (selectedRules.includes(6)) {
      violations.push(...checkQualifiedStaffRule(data, staff, daysInMonth));
    }

    // 違反箇所にコメントを追加（背景色ではなく）
    addViolationComments(sheet, violations);

    console.log(`ルールチェック完了: ${violations.length}件の違反`);

    return {
      success: true,
      violations: violations,
      message: `チェック完了: ${violations.length}件の違反が見つかりました`
    };

  } catch (e) {
    console.error('ルールチェックエラー:', e);
    return { success: false, message: 'エラーが発生しました: ' + e.message };
  }
}

/**
 * ルール1-4: 最低人数チェック（グループ別）
 */
function checkMinimumStaffRule(data, staff, daysInMonth) {
  const violations = [];

  // グループごとにチェック
  for (let group = 1; group <= 6; group++) {
    const groupStaff = staff.filter(s => s['グループ'] == group);
    const groupIndices = groupStaff.map(s => {
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === s['氏名']) return i;
      }
      return -1;
    }).filter(i => i >= 0);

    for (let day = 1; day <= daysInMonth; day++) {
      const shiftCounts = { '早出': 0, '日勤': 0, '遅出': 0, '夜勤': 0 };

      groupIndices.forEach(rowIndex => {
        const shiftName = data[rowIndex][day + 1];  // グループ列追加により+1に変更
        if (shiftCounts.hasOwnProperty(shiftName)) {
          shiftCounts[shiftName]++;
        }
      });

      // 最低人数チェック
      if (shiftCounts['早出'] < 2) {
        violations.push({
          type: '最低人数不足',
          group: group,
          day: day,
          shift: '早出',
          message: `グループ${group} ${day}日: 早出が${shiftCounts['早出']}名（最低2名必要）`
        });
      }

      // 日曜日以外は日勤1名以上
      // ヘッダーから日付を取得して曜日を判定
      const headerDate = data[0][day + 1];  // グループ列追加により+1に変更
      const isSunday = (headerDate instanceof Date) && headerDate.getDay() === 0;
      if (!isSunday && shiftCounts['日勤'] < 1) {
        violations.push({
          type: '最低人数不足',
          group: group,
          day: day,
          shift: '日勤',
          message: `グループ${group} ${day}日: 日勤が${shiftCounts['日勤']}名（最低1名必要）`
        });
      }

      if (shiftCounts['遅出'] < 1) {
        violations.push({
          type: '最低人数不足',
          group: group,
          day: day,
          shift: '遅出',
          message: `グループ${group} ${day}日: 遅出が${shiftCounts['遅出']}名（最低1名必要）`
        });
      }

      if (shiftCounts['夜勤'] < 1) {
        violations.push({
          type: '最低人数不足',
          group: group,
          day: day,
          shift: '夜勤',
          message: `グループ${group} ${day}日: 夜勤が${shiftCounts['夜勤']}名（最低1名必要）`
        });
      }
    }
  }

  return violations;
}

/**
 * ルール6: 連勤制限チェック（6連勤以上でエラー）
 */
function checkConsecutiveWorkDaysRule(data, staff, daysInMonth) {
  const violations = [];

  for (let i = 1; i < data.length; i++) {
    const name = data[i][0];
    let consecutiveDays = 0;
    let startDay = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const shiftName = data[i][day + 1];  // グループ列追加により+1に変更

      if (shiftName !== '休み' && shiftName !== '') {
        if (consecutiveDays === 0) {
          startDay = day;
        }
        consecutiveDays++;

        // 6連勤以上で違反
        if (consecutiveDays >= 6) {
          violations.push({
            type: '連勤制限違反',
            row: i,
            day: day,
            name: name,
            message: `${name}: ${startDay}日〜${day}日 (${consecutiveDays}連勤)`
          });
        }
      } else {
        consecutiveDays = 0;
      }
    }
  }

  return violations;
}

/**
 * ルール7: インターバルチェック（遅出→翌日早出は禁止）
 */
function checkIntervalRule(data, staff, daysInMonth) {
  const violations = [];

  for (let i = 1; i < data.length; i++) {
    const name = data[i][0];

    for (let day = 1; day < daysInMonth; day++) {
      const todayShift = data[i][day + 1];  // グループ列追加により+1に変更
      const tomorrowShift = data[i][day + 2];  // グループ列追加により+2に変更

      if (todayShift === '遅出' && tomorrowShift === '早出') {
        violations.push({
          type: 'インターバル違反',
          row: i,
          day: day,
          name: name,
          message: `${name}: ${day}日遅出 → ${day + 1}日早出`
        });
      }
    }
  }

  return violations;
}

/**
 * ルール8: 勤務日数上限チェック（月21日以内、夜勤は2日分換算）
 */
function checkMaxWorkDaysRule(data, staff, daysInMonth) {
  const violations = [];

  for (let i = 1; i < data.length; i++) {
    const name = data[i][0];
    let workDays = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const shiftName = data[i][day + 1];  // グループ列追加により+1に変更

      if (shiftName === '夜勤') {
        workDays += 2; // 夜勤は2日分
      } else if (shiftName !== '休み' && shiftName !== '') {
        workDays += 1;
      }
    }

    if (workDays > 21) {
      violations.push({
        type: '勤務日数超過',
        row: i,
        name: name,
        message: `${name}: 勤務日数${workDays}日（上限21日）`
      });
    }
  }

  return violations;
}

/**
 * ルール9: 夜勤明けルール（夜勤→休→休）
 */
function checkNightShiftRestRule(data, staff, daysInMonth) {
  const violations = [];

  for (let i = 1; i < data.length; i++) {
    const name = data[i][0];

    for (let day = 1; day <= daysInMonth - 2; day++) {
      const shift1 = data[i][day + 1];  // グループ列追加により+1に変更
      const shift2 = data[i][day + 2];  // グループ列追加により+2に変更
      const shift3 = data[i][day + 3];  // グループ列追加により+3に変更

      if (shift1 === '夜勤') {
        if (shift2 !== '休み') {
          violations.push({
            type: '夜勤明け違反',
            row: i,
            day: day + 1,
            name: name,
            message: `${name}: ${day}日夜勤後、${day + 1}日が休みではない`
          });
        }
        if (shift3 !== '休み') {
          violations.push({
            type: '夜勤明け違反',
            row: i,
            day: day + 2,
            name: name,
            message: `${name}: ${day}日夜勤後、${day + 2}日が休みではない`
          });
        }
      }
    }
  }

  return violations;
}

/**
 * ルール11: 資格者配置チェック（全グループで夜勤に喀痰吸引資格者が最低1名）
 */
function checkQualifiedStaffRule(data, staff, daysInMonth) {
  const violations = [];

  for (let day = 1; day <= daysInMonth; day++) {
    let hasQualified = false;

    for (let i = 1; i < data.length; i++) {
      const name = data[i][0];
      const shiftName = data[i][day + 1];  // グループ列追加により+1に変更

      if (shiftName === '夜勤') {
        const person = staff.find(s => s['氏名'] === name);
        if (person && (person['喀痰吸引資格者'] === true || person['喀痰吸引資格者'] === 'TRUE')) {
          hasQualified = true;
          break;
        }
      }
    }

    if (!hasQualified) {
      violations.push({
        type: '資格者不在',
        day: day,
        message: `${day}日: 夜勤に喀痰吸引資格者が配置されていません`
      });
    }
  }

  return violations;
}

/**
 * 違反箇所をハイライト表示（旧方式 - 背景色）
 */
function highlightViolations(sheet, violations) {
  // まず全セルの背景色をクリア
  const maxRow = sheet.getLastRow();
  const maxCol = sheet.getLastColumn();
  sheet.getRange(2, 3, maxRow - 1, maxCol - 2).setBackground(null);  // グループ列対応

  // 違反箇所を赤くハイライト
  violations.forEach(v => {
    if (v.row && v.day) {
      sheet.getRange(v.row + 1, v.day + 2).setBackground('#ff0000').setFontColor('#ffffff');  // グループ列対応
    }
  });
}

/**
 * 違反箇所にコメントを追加（新方式）
 */
function addViolationComments(sheet, violations) {
  try {
    // まず全セルのコメントをクリア（シフト欄のみ）
    const maxRow = sheet.getLastRow();
    const maxCol = sheet.getLastColumn();
    if (maxRow > 1 && maxCol > 2) {
      const shiftRange = sheet.getRange(2, 3, maxRow - 1, maxCol - 2);
      shiftRange.clearNote();
    }

    // 違反箇所ごとにコメントを集約（同じセルに複数の違反がある場合を考慮）
    const commentMap = {};  // key: "row,col", value: [messages]

    violations.forEach(v => {
      if (v.row && v.day) {
        const row = v.row + 1;
        const col = v.day + 2;  // グループ列追加により+2
        const key = `${row},${col}`;

        if (!commentMap[key]) {
          commentMap[key] = [];
        }

        // コメント内容を作成
        const commentText = `【${v.type}】\n${v.message}`;
        commentMap[key].push(commentText);
      }
    });

    // コメントを追加
    Object.keys(commentMap).forEach(key => {
      const [row, col] = key.split(',').map(Number);
      const messages = commentMap[key];
      const fullComment = messages.join('\n\n');

      const cell = sheet.getRange(row, col);
      cell.setNote(fullComment);

      // 視認性向上のため、コメントがあるセルに薄い黄色背景を設定（オプション）
      cell.setBackground('#fff3cd');
    });

    console.log(`コメント追加完了: ${Object.keys(commentMap).length}セルに追加`);

  } catch (e) {
    console.error('コメント追加エラー:', e);
    throw e;
  }
}
