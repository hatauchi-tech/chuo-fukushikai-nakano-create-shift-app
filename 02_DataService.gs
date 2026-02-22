/**
 * DataService.gs - データアクセス層
 * スプレッドシートの各シートに対するCRUD操作を提供
 */

// ============================================
// M_職員マスタ関連
// ============================================

// 職員マスタのヘッダー初期化
function initializeStaffSheet() {
  const sheet = getOrCreateSheet(SHEET_NAMES.STAFF);

  if (sheet.getLastRow() === 0) {
    const headers = [
      '職員ID', '所属', '役職', 'グループ', 'カレンダーID', 'ユニット',
      '氏名', '雇用形態', '喀痰吸引資格者', '勤務配慮', '有効',
      'ログインID', 'パスワード'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8f4f8');
    console.log('M_職員シート初期化完了');
  }

  return sheet;
}

// 全職員データを取得
function getAllStaff() {
  try {
    const sheet = initializeStaffSheet();
    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) return [];

    const headers = data[0];
    const staffList = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const staff = {};

      headers.forEach((header, index) => {
        const value = row[index];
        // 日付・時刻オブジェクトを文字列に変換
        if (value instanceof Date) {
          staff[header] = Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
        } else if (value === null || value === undefined) {
          staff[header] = '';
        } else {
          staff[header] = value;
        }
      });

      staffList.push(staff);
    }

    console.log(`職員データ取得: ${staffList.length}件`);
    return staffList;
  } catch (e) {
    console.error('職員データ取得エラー:', e);
    throw e;
  }
}

// 有効な職員のみ取得
function getActiveStaff() {
  return getAllStaff().filter(staff => staff['有効'] === true || staff['有効'] === 'TRUE');
}

// ログインIDで職員を検索
function getStaffByLoginId(loginId) {
  const allStaff = getAllStaff();
  return allStaff.find(staff => String(staff['ログインID']) === String(loginId));
}

// 氏名で職員を検索
function getStaffByName(name) {
  const allStaff = getAllStaff();
  return allStaff.find(staff => staff['氏名'] === name);
}

// グループ別に職員を取得
function getStaffByGroup(groupNumber) {
  return getActiveStaff().filter(staff => staff['グループ'] == groupNumber);
}

// 職員データを保存/更新
function saveStaff(staffData) {
  try {
    const sheet = initializeStaffSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    // 職員IDで既存レコードを検索
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === staffData['職員ID']) {
        rowIndex = i;
        break;
      }
    }

    const rowData = headers.map(header => staffData[header] || '');

    if (rowIndex >= 0) {
      // 更新
      sheet.getRange(rowIndex + 1, 1, 1, rowData.length).setValues([rowData]);
      console.log(`職員更新: ${staffData['氏名']}`);
    } else {
      // 新規追加
      sheet.appendRow(rowData);
      console.log(`職員追加: ${staffData['氏名']}`);
    }

    return true;
  } catch (e) {
    console.error('職員データ保存エラー:', e);
    throw e;
  }
}

// ============================================
// M_シフトマスタ関連
// ============================================

// シフトマスタのヘッダー初期化
function initializeShiftMasterSheet() {
  const sheet = getOrCreateSheet(SHEET_NAMES.SHIFT_MASTER);

  if (sheet.getLastRow() === 0) {
    const headers = ['シフトID', 'シフト名', '開始時間', '終了時間', '備考'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#fff2cc');

    // デフォルトシフトを追加
    const defaultShifts = [
      ['SHIFT_HAYADE', '早出', '07:00', '16:00', ''],
      ['SHIFT_NIKKIN', '日勤', '09:00', '18:00', ''],
      ['SHIFT_OSODE', '遅出', '11:00', '20:00', ''],
      ['SHIFT_YAKIN', '夜勤', '17:00', '09:00', '翌朝まで'],
      ['SHIFT_YASUMI', '休み', '', '', '']
    ];

    defaultShifts.forEach(shift => sheet.appendRow(shift));
    console.log('M_シフトシート初期化完了');
  }

  return sheet;
}

// 全シフトマスタを取得
function getAllShiftMaster() {
  try {
    const sheet = initializeShiftMasterSheet();
    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) return [];

    const headers = data[0];
    const shiftList = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const shift = {};

      headers.forEach((header, index) => {
        const value = row[index];
        // 日付・時刻オブジェクトを文字列に変換
        if (value instanceof Date) {
          shift[header] = Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
        } else if (value === null || value === undefined) {
          shift[header] = '';
        } else {
          shift[header] = value;
        }
      });

      shiftList.push(shift);
    }

    console.log(`シフトマスタ取得: ${shiftList.length}件`);
    return shiftList;
  } catch (e) {
    console.error('シフトマスタ取得エラー:', e);
    throw e;
  }
}

// シフトIDとシフト名の相互変換マップを返す
// 戻り値: { byKey: {SHIFT_NIKKIN: '日勤', ...}, byName: {'日勤': 'SHIFT_NIKKIN', ...} }
function getShiftMasterMap() {
  try {
    var shifts = getAllShiftMaster();
    var byKey = {}, byName = {};
    shifts.forEach(function(s) {
      byKey[s['シフトID']] = s['シフト名'];
      byName[s['シフト名']] = s['シフトID'];
    });
    return { byKey: byKey, byName: byName };
  } catch (e) {
    console.error('シフトマスタマップ取得エラー:', e);
    // フォールバック（デフォルト値）
    return {
      byKey: {
        SHIFT_HAYADE: '早出', SHIFT_NIKKIN: '日勤', SHIFT_OSODE: '遅出',
        SHIFT_YAKIN: '夜勤', SHIFT_YASUMI: '休み'
      },
      byName: {
        '早出': 'SHIFT_HAYADE', '日勤': 'SHIFT_NIKKIN', '遅出': 'SHIFT_OSODE',
        '夜勤': 'SHIFT_YAKIN', '休み': 'SHIFT_YASUMI'
      }
    };
  }
}

// シフト名からシフト情報を取得
function getShiftByName(shiftName) {
  const allShifts = getAllShiftMaster();
  return allShifts.find(shift => shift['シフト名'] === shiftName);
}

// シフトマスタを保存/更新
function saveShiftMaster(shiftData) {
  try {
    const sheet = initializeShiftMasterSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    // シフトIDで既存レコードを検索
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === shiftData['シフトID']) {
        rowIndex = i;
        break;
      }
    }

    const rowData = headers.map(header => shiftData[header] || '');

    if (rowIndex >= 0) {
      // 更新
      sheet.getRange(rowIndex + 1, 1, 1, rowData.length).setValues([rowData]);
      console.log(`シフトマスタ更新: ${shiftData['シフト名']}`);
    } else {
      // 新規追加
      sheet.appendRow(rowData);
      console.log(`シフトマスタ追加: ${shiftData['シフト名']}`);
    }

    return true;
  } catch (e) {
    console.error('シフトマスタ保存エラー:', e);
    throw e;
  }
}

// シフトマスタを削除
function deleteShiftMaster(shiftId) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAMES.SHIFT_MASTER);
    const data = sheet.getDataRange().getValues();

    // シフトIDで該当行を検索
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === shiftId) {
        sheet.deleteRow(i + 1);
        console.log(`シフトマスタ削除: ${shiftId}`);
        return true;
      }
    }

    console.log(`シフトマスタ削除失敗: ${shiftId} が見つかりません`);
    return false;
  } catch (e) {
    console.error('シフトマスタ削除エラー:', e);
    throw e;
  }
}

// ============================================
// T_シフト休み希望関連
// ============================================

// 休み希望シートのヘッダー初期化
function initializeHolidayRequestSheet() {
  const sheet = getOrCreateSheet(SHEET_NAMES.HOLIDAY_REQUEST);

  if (sheet.getLastRow() === 0) {
    const headers = ['シフト休み希望ID', '氏名', '提出日時', '日付', '優先順位', '特記事項'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9ead3');
    console.log('T_シフト休み希望シート初期化完了（優先順位列を追加）');
  }

  return sheet;
}

// 休み希望を保存
// @param {string} name - 氏名
// @param {Array} requestList - [{date: ISO文字列, priority: 数値}] の配列
// @param {string} notes - 特記事項
function saveHolidayRequest(name, requestList, notes = '') {
  try {
    const sheet = initializeHolidayRequestSheet();
    const timestamp = new Date();

    // requestListが空の場合はエラー
    if (!requestList || requestList.length === 0) {
      throw new Error('休み希望データが空です');
    }

    // 既存の該当月データを削除（上書き保存）
    const firstDate = new Date(requestList[0].date);
    const yearMonth = Utilities.formatDate(firstDate, Session.getScriptTimeZone(), 'yyyyMM');
    deleteHolidayRequestByNameAndMonth(name, yearMonth);

    // 新規保存（日付と優先順位のペア）
    requestList.forEach(req => {
      const date = new Date(req.date);
      const priority = req.priority || 1;  // デフォルト第1希望
      const requestId = `REQ_${name}_${Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyyMMdd')}_${timestamp.getTime()}`;
      sheet.appendRow([requestId, name, timestamp, date, priority, notes]);
    });

    console.log(`休み希望保存: ${name} (${requestList.length}件)`);
    return true;
  } catch (e) {
    console.error('休み希望保存エラー:', e);
    throw e;
  }
}

// 氏名と月で休み希望を削除
function deleteHolidayRequestByNameAndMonth(name, yearMonth) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAMES.HOLIDAY_REQUEST);
    const data = sheet.getDataRange().getValues();

    const rowsToDelete = [];

    for (let i = data.length - 1; i >= 1; i--) {
      const rowName = data[i][1];
      const rowDate = data[i][3];

      if (rowName === name && rowDate) {
        const rowYearMonth = Utilities.formatDate(new Date(rowDate), Session.getScriptTimeZone(), 'yyyyMM');
        if (rowYearMonth === yearMonth) {
          rowsToDelete.push(i + 1);
        }
      }
    }

    // 逆順で削除（行番号のずれを防ぐ）
    rowsToDelete.reverse().forEach(rowIndex => {
      sheet.deleteRow(rowIndex);
    });

    if (rowsToDelete.length > 0) {
      console.log(`休み希望削除: ${name} ${yearMonth} (${rowsToDelete.length}件)`);
    }
  } catch (e) {
    console.error('休み希望削除エラー:', e);
  }
}

// 氏名と月で休み希望を取得
function getHolidayRequestByNameAndMonth(name, year, month) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAMES.HOLIDAY_REQUEST);
    const data = sheet.getDataRange().getValues();

    const requests = [];

    for (let i = 1; i < data.length; i++) {
      const rowName = data[i][1];
      const rowDate = data[i][3];
      const rowPriority = data[i][4];  // 優先順位列を追加

      if (rowName === name && rowDate) {
        const date = new Date(rowDate);
        if (date.getFullYear() == year && date.getMonth() + 1 == month) {
          requests.push({
            '日付': date.toISOString(),  // ISO文字列に変換
            '優先順位': rowPriority || 1,  // 優先順位（デフォルト1）
            '特記事項': data[i][5] || ''  // インデックスを5に変更
          });
        }
      }
    }

    console.log(`休み希望取得: ${name} ${year}/${month} (${requests.length}件)`);
    return requests;
  } catch (e) {
    console.error('休み希望取得エラー:', e);
    return [];
  }
}

// ============================================
// T_確定シフト関連
// ============================================

// 確定シフトシートのヘッダー初期化
function initializeConfirmedShiftSheet() {
  const sheet = getOrCreateSheet(SHEET_NAMES.CONFIRMED_SHIFT);

  if (sheet.getLastRow() === 0) {
    const headers = [
      '確定シフトID', '氏名', 'グループ', 'シフト名',
      '勤務開始日', '開始時間', '勤務終了日', '終了時間',
      '登録日時', 'カレンダーイベントID'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#fce5cd');
    console.log('T_確定シフトシート初期化完了');
  }

  return sheet;
}

// 確定シフトを保存
function saveConfirmedShift(shiftData) {
  try {
    const sheet = initializeConfirmedShiftSheet();
    const timestamp = new Date();

    const shiftId = `CONFIRMED_${shiftData['氏名']}_${Utilities.formatDate(shiftData['勤務開始日'], Session.getScriptTimeZone(), 'yyyyMMdd')}_${timestamp.getTime()}`;

    const rowData = [
      shiftId,
      shiftData['氏名'],
      shiftData['グループ'],
      shiftData['シフト名'],
      shiftData['勤務開始日'],
      shiftData['開始時間'],
      shiftData['勤務終了日'],
      shiftData['終了時間'],
      timestamp,
      shiftData['カレンダーイベントID'] || ''
    ];

    sheet.appendRow(rowData);
    console.log(`確定シフト保存: ${shiftData['氏名']} ${Utilities.formatDate(shiftData['勤務開始日'], Session.getScriptTimeZone(), 'yyyy/MM/dd')} - ${Utilities.formatDate(shiftData['勤務終了日'], Session.getScriptTimeZone(), 'yyyy/MM/dd')}`);

    return shiftId;
  } catch (e) {
    console.error('確定シフト保存エラー:', e);
    throw e;
  }
}

// 確定シフトを月別に削除
function deleteConfirmedShiftByMonth(year, month) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAMES.CONFIRMED_SHIFT);
    const data = sheet.getDataRange().getValues();

    const rowsToDelete = [];

    for (let i = data.length - 1; i >= 1; i--) {
      const startDate = data[i][4];  // 勤務開始日（インデックス4）

      if (startDate) {
        const date = new Date(startDate);
        if (date.getFullYear() == year && date.getMonth() + 1 == month) {
          rowsToDelete.push(i + 1);
        }
      }
    }

    // 逆順で削除（行番号のずれを防ぐ）
    rowsToDelete.reverse().forEach(rowIndex => {
      sheet.deleteRow(rowIndex);
    });

    console.log(`確定シフト削除: ${year}年${month}月 (${rowsToDelete.length}件)`);
    return rowsToDelete.length;
  } catch (e) {
    console.error('確定シフト削除エラー:', e);
    throw e;
  }
}

// 確定シフトを月別・グループ別に削除
function deleteConfirmedShiftByMonthAndGroup(year, month, selectedGroups) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAMES.CONFIRMED_SHIFT);
    const data = sheet.getDataRange().getValues();

    const rowsToDelete = [];

    for (let i = data.length - 1; i >= 1; i--) {
      const group = data[i][2];  // グループ（インデックス2）
      const startDate = data[i][4];  // 勤務開始日（インデックス4）

      if (startDate && selectedGroups.includes(parseInt(group))) {
        const date = new Date(startDate);
        if (date.getFullYear() == year && date.getMonth() + 1 == month) {
          rowsToDelete.push(i + 1);
        }
      }
    }

    // 逆順で削除（行番号のずれを防ぐ）
    rowsToDelete.reverse().forEach(rowIndex => {
      sheet.deleteRow(rowIndex);
    });

    console.log(`確定シフト削除（グループ選択）: ${year}年${month}月 グループ${selectedGroups.join(',')} (${rowsToDelete.length}件)`);
    return rowsToDelete.length;
  } catch (e) {
    console.error('確定シフト削除エラー（グループ選択）:', e);
    throw e;
  }
}

// 確定シフトを一括保存（高速化）
function saveConfirmedShiftsBulk(shiftsData) {
  try {
    const sheet = initializeConfirmedShiftSheet();
    const timestamp = new Date();

    if (shiftsData.length === 0) {
      return [];
    }

    // データテーブルを作成
    const rows = [];
    const savedShifts = [];

    shiftsData.forEach(shiftData => {
      const shiftId = `CONFIRMED_${shiftData['氏名']}_${Utilities.formatDate(shiftData['勤務開始日'], Session.getScriptTimeZone(), 'yyyyMMdd')}_${timestamp.getTime()}`;

      const row = [
        shiftId,
        shiftData['氏名'],
        shiftData['グループ'],
        shiftData['シフト名'],
        shiftData['勤務開始日'],
        shiftData['開始時間'],
        shiftData['勤務終了日'],
        shiftData['終了時間'],
        timestamp,
        ''  // カレンダーイベントID（後で更新）
      ];

      rows.push(row);

      // 返却用データ
      savedShifts.push({
        shiftId: shiftId,
        '氏名': shiftData['氏名'],
        'グループ': shiftData['グループ'],
        'シフト名': shiftData['シフト名'],
        '勤務開始日': shiftData['勤務開始日'],
        '開始時間': shiftData['開始時間'],
        '勤務終了日': shiftData['勤務終了日'],
        '終了時間': shiftData['終了時間'],
        'calendarId': shiftData['カレンダーID']
      });
    });

    // 配列一括貼り付け（高速化）
    if (rows.length > 0) {
      const lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
      console.log(`確定シフト一括保存: ${rows.length}件`);
    }

    return savedShifts;

  } catch (e) {
    console.error('確定シフト一括保存エラー:', e);
    throw e;
  }
}

// カレンダーイベントIDを更新
function updateCalendarEventId(shiftId, eventId) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAMES.CONFIRMED_SHIFT);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === shiftId) {
        sheet.getRange(i + 1, 10).setValue(eventId);  // 10列目（インデックス9）に変更
        console.log(`イベントID更新: ${shiftId} -> ${eventId}`);
        return true;
      }
    }

    return false;
  } catch (e) {
    console.error('イベントID更新エラー:', e);
    throw e;
  }
}

// 確定シフトを月別に取得
function getConfirmedShiftsByMonth(year, month) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAMES.CONFIRMED_SHIFT);
    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) return [];

    const headers = data[0];
    const shifts = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const startDate = row[4];  // 勤務開始日（インデックス4）

      if (startDate) {
        const date = new Date(startDate);
        if (date.getFullYear() == year && date.getMonth() + 1 == month) {
          const shift = {};
          headers.forEach((header, index) => {
            const value = row[index];
            if (value instanceof Date) {
              shift[header] = value;
            } else if (value === null || value === undefined) {
              shift[header] = '';
            } else {
              shift[header] = value;
            }
          });
          shifts.push(shift);
        }
      }
    }

    console.log(`確定シフト取得: ${year}年${month}月 (${shifts.length}件)`);
    return shifts;
  } catch (e) {
    console.error('確定シフト取得エラー:', e);
    return [];
  }
}

// 確定シフトを単一削除
function deleteConfirmedShift(shiftId) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAMES.CONFIRMED_SHIFT);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === shiftId) {
        sheet.deleteRow(i + 1);
        console.log(`確定シフト削除: ${shiftId}`);
        return true;
      }
    }

    console.log(`確定シフト削除失敗: ${shiftId} が見つかりません`);
    return false;
  } catch (e) {
    console.error('確定シフト削除エラー:', e);
    throw e;
  }
}

// 確定シフトを更新
function updateConfirmedShift(shiftId, shiftData) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAMES.CONFIRMED_SHIFT);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === shiftId) {
        // 既存データを保持しながら更新
        const rowData = headers.map((header, index) => {
          if (header === '確定シフトID') {
            return shiftId;  // IDは変更しない
          } else if (header === '登録日時' || header === 'カレンダーイベントID') {
            return data[i][index];  // これらは変更しない
          } else if (shiftData[header] !== undefined) {
            return shiftData[header];
          } else {
            return data[i][index];
          }
        });

        sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
        console.log(`確定シフト更新: ${shiftId}`);
        return true;
      }
    }

    console.log(`確定シフト更新失敗: ${shiftId} が見つかりません`);
    return false;
  } catch (e) {
    console.error('確定シフト更新エラー:', e);
    throw e;
  }
}

// 確定シフトの特定フィールドを更新
function updateConfirmedShiftFields(shiftId, fields) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAMES.CONFIRMED_SHIFT);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === shiftId) {
        // 指定されたフィールドのみ更新
        Object.keys(fields).forEach(fieldName => {
          const colIndex = headers.indexOf(fieldName);
          if (colIndex >= 0) {
            sheet.getRange(i + 1, colIndex + 1).setValue(fields[fieldName]);
          }
        });

        console.log(`確定シフトフィールド更新: ${shiftId} (${Object.keys(fields).join(', ')})`);
        return true;
      }
    }

    console.log(`確定シフトフィールド更新失敗: ${shiftId} が見つかりません`);
    return false;
  } catch (e) {
    console.error('確定シフトフィールド更新エラー:', e);
    throw e;
  }
}

// ============================================
// T_勤務指定（事前シフト固定）関連
// ============================================

function initializeShiftAssignmentSheet() {
  var sheet = getOrCreateSheet(SHEET_NAMES.SHIFT_ASSIGNMENT);
  if (sheet.getLastRow() === 0) {
    // 「シフトID」列にはキー（例: SHIFT_NIKKIN）を格納。シフト名称変更に対応
    var headers = ['指定ID', '氏名', 'グループ', '日付', 'シフトID', '登録者', '登録日時', '備考'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#ffe0b2');
    console.log('T_勤務指定シート初期化完了');
  }
  return sheet;
}

function saveShiftAssignment(staffName, date, shiftId, registeredBy, notes) {
  try {
    var sheet = initializeShiftAssignmentSheet();
    var timestamp = new Date();
    var dateObj = new Date(date);
    deleteShiftAssignmentByNameAndDate(staffName, dateObj);
    var assignmentId = 'ASSIGN_' + staffName + '_' +
      Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyyMMdd') + '_' + timestamp.getTime();
    var staff = getStaffByName(staffName);
    sheet.appendRow([assignmentId, staffName, staff ? staff['グループ'] : '',
      dateObj, shiftId, registeredBy || '', timestamp, notes || '']);
    return assignmentId;
  } catch (e) {
    console.error('勤務指定保存エラー:', e);
    throw e;
  }
}

function deleteShiftAssignmentByNameAndDate(staffName, dateObj) {
  try {
    var sheet = getOrCreateSheet(SHEET_NAMES.SHIFT_ASSIGNMENT);
    if (sheet.getLastRow() <= 1) return;
    var data = sheet.getDataRange().getValues();
    var targetStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyyMMdd');
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][1] === staffName && data[i][3]) {
        var rowStr = Utilities.formatDate(new Date(data[i][3]), Session.getScriptTimeZone(), 'yyyyMMdd');
        if (rowStr === targetStr) { sheet.deleteRow(i + 1); }
      }
    }
  } catch (e) {
    console.error('勤務指定削除（氏名・日付）エラー:', e);
    throw e;
  }
}

function deleteShiftAssignmentById(assignmentId) {
  try {
    var sheet = getOrCreateSheet(SHEET_NAMES.SHIFT_ASSIGNMENT);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === assignmentId) { sheet.deleteRow(i + 1); return true; }
    }
    return false;
  } catch (e) {
    console.error('勤務指定削除（ID）エラー:', e);
    throw e;
  }
}

function getShiftAssignmentsByMonth(year, month) {
  try {
    var sheet = getOrCreateSheet(SHEET_NAMES.SHIFT_ASSIGNMENT);
    if (sheet.getLastRow() <= 1) return [];
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var assignments = [];
    for (var i = 1; i < data.length; i++) {
      var dateVal = data[i][3];
      if (!dateVal) continue;
      var targetYM = String(year) + String(month).padStart(2, '0');
      var rowYM = Utilities.formatDate(new Date(dateVal), Session.getScriptTimeZone(), 'yyyyMM');
      if (rowYM === targetYM) {
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
  } catch (e) {
    console.error('勤務指定取得エラー:', e);
    return [];
  }
}

// ============================================
// M_イベント関連（予定・イベント表示）
// ============================================

function initializeEventSheet() {
  var sheet = getOrCreateSheet(SHEET_NAMES.EVENT);
  if (sheet.getLastRow() === 0) {
    var headers = ['イベントID', 'タイトル', '日付', '備考', '登録者', '登録日時'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d4edda');
    console.log('M_イベントシート初期化完了');
  }
  return sheet;
}

function saveEvent(title, date, notes, registeredBy) {
  try {
    var sheet = initializeEventSheet();
    var timestamp = new Date();
    var dateObj = new Date(date);
    var eventId = 'EVT_' + Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyyMMdd') +
      '_' + timestamp.getTime();
    sheet.appendRow([eventId, title, dateObj, notes || '', registeredBy || '', timestamp]);
    return eventId;
  } catch (e) {
    console.error('イベント保存エラー:', e);
    throw e;
  }
}

function deleteEventById(eventId) {
  try {
    var sheet = getOrCreateSheet(SHEET_NAMES.EVENT);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === eventId) { sheet.deleteRow(i + 1); return true; }
    }
    return false;
  } catch (e) {
    console.error('イベント削除エラー:', e);
    throw e;
  }
}

function getEventsByMonth(year, month) {
  try {
    var sheet = getOrCreateSheet(SHEET_NAMES.EVENT);
    if (sheet.getLastRow() <= 1) return [];
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var events = [];
    for (var i = 1; i < data.length; i++) {
      var dateVal = data[i][2];
      if (!dateVal) continue;
      var targetYM = String(year) + String(month).padStart(2, '0');
      var rowYM = Utilities.formatDate(new Date(dateVal), Session.getScriptTimeZone(), 'yyyyMM');
      if (rowYM === targetYM) {
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
  } catch (e) {
    console.error('イベント取得エラー:', e);
    return [];
  }
}
