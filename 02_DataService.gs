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
  return allStaff.find(staff => staff['ログインID'] === loginId);
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

// シフト名からシフト情報を取得
function getShiftByName(shiftName) {
  const allShifts = getAllShiftMaster();
  return allShifts.find(shift => shift['シフト名'] === shiftName);
}

// ============================================
// T_シフト休み希望関連
// ============================================

// 休み希望シートのヘッダー初期化
function initializeHolidayRequestSheet() {
  const sheet = getOrCreateSheet(SHEET_NAMES.HOLIDAY_REQUEST);

  if (sheet.getLastRow() === 0) {
    const headers = ['シフト休み希望ID', '氏名', '提出日時', '日付', '特記事項'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9ead3');
    console.log('T_シフト休み希望シート初期化完了');
  }

  return sheet;
}

// 休み希望を保存
function saveHolidayRequest(name, dateList, notes = '') {
  try {
    const sheet = initializeHolidayRequestSheet();
    const timestamp = new Date();

    // ISO文字列をDateオブジェクトに変換
    const dates = dateList.map(d => new Date(d));

    // 既存の該当月データを削除（上書き保存）
    const yearMonth = Utilities.formatDate(dates[0], Session.getScriptTimeZone(), 'yyyyMM');
    deleteHolidayRequestByNameAndMonth(name, yearMonth);

    // 新規保存
    dates.forEach(date => {
      const requestId = `REQ_${name}_${Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyyMMdd')}_${timestamp.getTime()}`;
      sheet.appendRow([requestId, name, timestamp, date, notes]);
    });

    console.log(`休み希望保存: ${name} (${dates.length}件)`);
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

      if (rowName === name && rowDate) {
        const date = new Date(rowDate);
        if (date.getFullYear() == year && date.getMonth() + 1 == month) {
          requests.push({
            '日付': date.toISOString(),  // ISO文字列に変換
            '特記事項': data[i][4] || ''
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
