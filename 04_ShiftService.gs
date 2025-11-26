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
 */
function createShiftDraft(year, month) {
  try {
    console.log(`シフト案作成開始: ${year}年${month}月`);

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

    // ランダムにシフトを配置（たたき台）
    assignShiftsRandomly(workSheet, staff, daysInMonth);

    console.log('シフト案作成完了');
    return { success: true, message: 'シフト案を作成しました' };

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
 * ランダムにシフトを配置（たたき台レベル）
 */
function assignShiftsRandomly(sheet, staff, daysInMonth) {
  const shiftTypes = ['早出', '日勤', '遅出', '夜勤'];

  for (let day = 1; day <= daysInMonth; day++) {
    for (let i = 0; i < staff.length; i++) {
      const currentValue = sheet.getRange(i + 2, day + 2).getValue();  // グループ列追加により+2に変更

      // 休み希望が既に入っている場合はスキップ
      if (currentValue === '休み') continue;

      const person = staff[i];

      // 勤務配慮ありの場合は夜勤を除外
      let availableShifts = [...shiftTypes];
      if (person['勤務配慮'] === true || person['勤務配慮'] === 'TRUE') {
        availableShifts = availableShifts.filter(s => s !== '夜勤');
      }

      // ランダムでシフトを割り当て（休みも含む）
      const random = Math.random();
      if (random < 0.3) {
        // 30%の確率で休み
        sheet.getRange(i + 2, day + 2).setValue('休み');  // グループ列追加により+2に変更
      } else {
        // ランダムでシフト選択
        const shiftIndex = Math.floor(Math.random() * availableShifts.length);
        sheet.getRange(i + 2, day + 2).setValue(availableShifts[shiftIndex]);  // グループ列追加により+2に変更
      }
    }
  }
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
