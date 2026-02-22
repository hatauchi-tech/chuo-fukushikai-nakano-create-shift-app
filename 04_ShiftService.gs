/**
 * ShiftService.gs - シフトルールチェックサービス
 * ルールチェック機能を提供（シフト生成機能はPythonに移行）
 */

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
  // M_シフトからキー→現在のシフト名を動的取得
  const sn = getShiftMasterMap().byKey;
  const N_HAYADE = sn[SHIFT_KEYS.HAYADE] || '早出';
  const N_NIKKIN = sn[SHIFT_KEYS.NIKKIN] || '日勤';
  const N_OSODE  = sn[SHIFT_KEYS.OSODE]  || '遅出';
  const N_YAKIN  = sn[SHIFT_KEYS.YAKIN]  || '夜勤';

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
      const shiftCounts = {};
      shiftCounts[N_HAYADE] = 0;
      shiftCounts[N_NIKKIN] = 0;
      shiftCounts[N_OSODE]  = 0;
      shiftCounts[N_YAKIN]  = 0;

      groupIndices.forEach(rowIndex => {
        const shiftName = data[rowIndex][day + 1];  // グループ列追加により+1に変更
        if (shiftCounts.hasOwnProperty(shiftName)) {
          shiftCounts[shiftName]++;
        }
      });

      // 最低人数チェック
      if (shiftCounts[N_HAYADE] < 2) {
        violations.push({
          type: '最低人数不足',
          group: group,
          day: day,
          shift: N_HAYADE,
          message: `グループ${group} ${day}日: ${N_HAYADE}が${shiftCounts[N_HAYADE]}名（最低2名必要）`
        });
      }

      // 日曜日以外は日勤1名以上
      // ヘッダーから日付を取得して曜日を判定
      const headerDate = data[0][day + 1];  // グループ列追加により+1に変更
      const isSunday = (headerDate instanceof Date) && headerDate.getDay() === 0;
      // 業務ルール: 日曜日は日勤0名でも可（04_ShiftService.gs の checkMinimumStaffRule と同じ仕様）
      if (!isSunday && shiftCounts[N_NIKKIN] < 1) {
        violations.push({
          type: '最低人数不足',
          group: group,
          day: day,
          shift: N_NIKKIN,
          message: `グループ${group} ${day}日: ${N_NIKKIN}が${shiftCounts[N_NIKKIN]}名（最低1名必要）`
        });
      }

      if (shiftCounts[N_OSODE] < 1) {
        violations.push({
          type: '最低人数不足',
          group: group,
          day: day,
          shift: N_OSODE,
          message: `グループ${group} ${day}日: ${N_OSODE}が${shiftCounts[N_OSODE]}名（最低1名必要）`
        });
      }

      if (shiftCounts[N_YAKIN] < 1) {
        violations.push({
          type: '最低人数不足',
          group: group,
          day: day,
          shift: N_YAKIN,
          message: `グループ${group} ${day}日: ${N_YAKIN}が${shiftCounts[N_YAKIN]}名（最低1名必要）`
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
  const N_YASUMI = getShiftMasterMap().byKey[SHIFT_KEYS.YASUMI] || '休み';

  for (let i = 1; i < data.length; i++) {
    const name = data[i][0];
    let consecutiveDays = 0;
    let startDay = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const shiftName = data[i][day + 1];  // グループ列追加により+1に変更

      if (shiftName !== N_YASUMI && shiftName !== '') {
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
  const shiftMap = getShiftMasterMap().byKey;
  const N_HAYADE = shiftMap[SHIFT_KEYS.HAYADE] || '早出';
  const N_OSODE  = shiftMap[SHIFT_KEYS.OSODE]  || '遅出';

  for (let i = 1; i < data.length; i++) {
    const name = data[i][0];

    for (let day = 1; day < daysInMonth; day++) {
      const todayShift = data[i][day + 1];  // グループ列追加により+1に変更
      const tomorrowShift = data[i][day + 2];  // グループ列追加により+2に変更

      if (todayShift === N_OSODE && tomorrowShift === N_HAYADE) {
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
  const shiftMap = getShiftMasterMap().byKey;
  const N_YAKIN  = shiftMap[SHIFT_KEYS.YAKIN]  || '夜勤';
  const N_YASUMI = shiftMap[SHIFT_KEYS.YASUMI] || '休み';

  for (let i = 1; i < data.length; i++) {
    const name = data[i][0];
    let workDays = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const shiftName = data[i][day + 1];  // グループ列追加により+1に変更

      if (shiftName === N_YAKIN) {
        workDays += 2; // 夜勤は2日分
      } else if (shiftName !== N_YASUMI && shiftName !== '') {
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
  const shiftMap = getShiftMasterMap().byKey;
  const N_YAKIN  = shiftMap[SHIFT_KEYS.YAKIN]  || '夜勤';
  const N_YASUMI = shiftMap[SHIFT_KEYS.YASUMI] || '休み';

  for (let i = 1; i < data.length; i++) {
    const name = data[i][0];

    for (let day = 1; day <= daysInMonth - 2; day++) {
      const shift1 = data[i][day + 1];  // グループ列追加により+1に変更
      const shift2 = data[i][day + 2];  // グループ列追加により+2に変更
      const shift3 = data[i][day + 3];  // グループ列追加により+3に変更

      if (shift1 === N_YAKIN) {
        if (shift2 !== N_YASUMI) {
          violations.push({
            type: '夜勤明け違反',
            row: i,
            day: day + 1,
            name: name,
            message: `${name}: ${day}日夜勤後、${day + 1}日が休みではない`
          });
        }
        if (shift3 !== N_YASUMI) {
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
  const N_YAKIN = getShiftMasterMap().byKey[SHIFT_KEYS.YAKIN] || '夜勤';

  for (let day = 1; day <= daysInMonth; day++) {
    let hasQualified = false;

    for (let i = 1; i < data.length; i++) {
      const name = data[i][0];
      const shiftName = data[i][day + 1];  // グループ列追加により+1に変更

      if (shiftName === N_YAKIN) {
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
