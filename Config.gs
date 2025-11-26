/**
 * Config.gs - 設定管理
 * スクリプトプロパティとスプレッドシート設定を管理
 */

// スプレッドシートIDを取得（現在のスプレッドシート）
function getSpreadsheetId() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty('SPREADSHEET_ID');

  if (!ssId) {
    // 初回は現在のスプレッドシートIDを設定
    ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
    props.setProperty('SPREADSHEET_ID', ssId);
  }

  return ssId;
}

// スプレッドシートを取得
function getSpreadsheet() {
  return SpreadsheetApp.openById(getSpreadsheetId());
}

// 各シート名の定義
const SHEET_NAMES = {
  STAFF: 'M_職員',
  SHIFT_MASTER: 'M_シフト',
  HOLIDAY_REQUEST: 'T_シフト休み希望',
  CONFIRMED_SHIFT: 'T_確定シフト',
  SETTINGS: 'M_設定',
  WORK_SHEET: 'シフト作業用'
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
