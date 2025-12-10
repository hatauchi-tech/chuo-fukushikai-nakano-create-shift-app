/**
 * Config.gs - 設定管理
 * スクリプトプロパティとスプレッドシート設定を管理
 */

// スプレッドシートを取得（スプレッドシートバインド型）
function getSpreadsheet() {
  try {
    // このGASはスプレッドシートにバインドされているため、getActiveSpreadsheet()を使用
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    console.error('スプレッドシート取得エラー:', e);
    throw new Error('このスクリプトはスプレッドシートにバインドされている必要があります');
  }
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

// ============================================
// Drive設定管理
// ============================================

/**
 * DriveフォルダIDを設定
 * 初回セットアップ時に実行
 */
function setupDriveFolders() {
  const ui = SpreadsheetApp.getUi();

  const inputFolderResponse = ui.prompt(
    'DriveフォルダID設定 (1/4)',
    'inputフォルダのIDを入力してください:\n（T_休み希望.csv格納用）',
    ui.ButtonSet.OK_CANCEL
  );

  if (inputFolderResponse.getSelectedButton() !== ui.Button.OK) return;
  const inputFolderId = inputFolderResponse.getResponseText();

  const outputFolderResponse = ui.prompt(
    'DriveフォルダID設定 (2/4)',
    'outputフォルダのIDを入力してください:\n（シフト結果.csv格納用）',
    ui.ButtonSet.OK_CANCEL
  );

  if (outputFolderResponse.getSelectedButton() !== ui.Button.OK) return;
  const outputFolderId = outputFolderResponse.getResponseText();

  const archiveFolderResponse = ui.prompt(
    'DriveフォルダID設定 (3/4)',
    'archiveフォルダのIDを入力してください:\n（過去データ保管用）',
    ui.ButtonSet.OK_CANCEL
  );

  if (archiveFolderResponse.getSelectedButton() !== ui.Button.OK) return;
  const archiveFolderId = archiveFolderResponse.getResponseText();

  const tokenResponse = ui.prompt(
    'Webhookトークン設定 (4/4)',
    'Webhook認証用のトークンを入力してください:\n（任意の文字列、Colab側と共有）',
    ui.ButtonSet.OK_CANCEL
  );

  if (tokenResponse.getSelectedButton() !== ui.Button.OK) return;
  const webhookToken = tokenResponse.getResponseText();

  // M_設定シートに保存
  setConfig('DRIVE_FOLDER_INPUT', inputFolderId);
  setConfig('DRIVE_FOLDER_OUTPUT', outputFolderId);
  setConfig('DRIVE_FOLDER_ARCHIVE', archiveFolderId);

  // スクリプトプロパティにWebhookトークンを保存
  const props = PropertiesService.getScriptProperties();
  props.setProperty('WEBHOOK_TOKEN', webhookToken);

  ui.alert('✅ Drive設定完了',
    `inputフォルダ: ${inputFolderId}\n` +
    `outputフォルダ: ${outputFolderId}\n` +
    `archiveフォルダ: ${archiveFolderId}\n` +
    `Webhookトークン: ${webhookToken.substring(0, 10)}...`,
    ui.ButtonSet.OK
  );

  console.log('Drive設定完了');
}
