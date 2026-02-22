/**
 * Config.gs - 設定管理
 * スクリプトプロパティとスプレッドシート設定を管理
 */

// スプレッドシートを取得（スタンドアローン型）
function getSpreadsheet() {
  try {
    // スクリプトプロパティからSPREADSHEET_IDを取得
    const props = PropertiesService.getScriptProperties();
    const spreadsheetId = props.getProperty('SPREADSHEET_ID');

    if (!spreadsheetId) {
      throw new Error('SPREADSHEET_IDがスクリプトプロパティに設定されていません');
    }

    return SpreadsheetApp.openById(spreadsheetId);
  } catch (e) {
    console.error('スプレッドシート取得エラー:', e);
    throw new Error('スプレッドシートを開けません: ' + e.message);
  }
}

// 各シート名の定義
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

// シートを取得（存在しなければ作成）
function getOrCreateSheet(sheetName) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    console.log(`シート作成: ${sheetName}`);
  }

  return sheet;
}

// 設定値を取得
function getConfig(key, defaultValue = null) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAMES.SETTINGS);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        return data[i][1];
      }
    }

    return defaultValue;
  } catch (e) {
    console.error(`設定取得エラー [${key}]:`, e);
    return defaultValue;
  }
}

// 設定値を保存
function setConfig(key, value) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAMES.SETTINGS);
    const data = sheet.getDataRange().getValues();

    // 既存の設定を検索
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        console.log(`設定更新: ${key} = ${value}`);
        return;
      }
    }

    // 新規追加
    sheet.appendRow([key, value]);
    console.log(`設定追加: ${key} = ${value}`);
  } catch (e) {
    console.error(`設定保存エラー [${key}]:`, e);
    throw e;
  }
}

// 管理者メールアドレスを取得
function getAdminEmail() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('ADMIN_EMAIL') || Session.getActiveUser().getEmail();
}

// ============================================
// Drive設定管理
// ============================================

/**
 * 現在のスクリプトプロパティを確認（デバッグ用）
 * GASエディタから実行して、ログで確認できます
 */
function checkScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();

  console.log('=== スクリプトプロパティ一覧 ===');
  for (const key in allProps) {
    console.log(`${key}: ${allProps[key]}`);
  }

  return allProps;
}

/**
 * スクリプトプロパティの設定状態を検証
 */
function validateScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  const requiredKeys = [
    'SPREADSHEET_ID',
    'DRIVE_FOLDER_INPUT',
    'DRIVE_FOLDER_OUTPUT',
    'DRIVE_FOLDER_ARCHIVE',
    'WEBHOOK_TOKEN'
  ];

  const missing = [];
  requiredKeys.forEach(key => {
    if (!props.getProperty(key)) {
      missing.push(key);
    }
  });

  if (missing.length > 0) {
    console.error('不足しているスクリプトプロパティ:', missing.join(', '));
    return { valid: false, missing: missing };
  }

  console.log('✅ すべてのスクリプトプロパティが設定されています');
  return { valid: true, missing: [] };
}
