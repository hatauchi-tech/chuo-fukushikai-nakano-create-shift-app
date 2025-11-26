/**
 * Code.gs - メインエントリーポイント
 * Webアプリの起動とカスタムメニューを管理
 */

// ============================================
// Webアプリのエントリーポイント
// ============================================

/**
 * WebアプリのGETリクエスト処理
 */
function doGet(e) {
  try {
    console.log('Webアプリ起動');
    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('シフト管理システム')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) {
    console.error('doGetエラー:', error);
    return HtmlService.createHtmlOutput('エラーが発生しました: ' + error.message);
  }
}

// ============================================
// カスタムメニュー
// ============================================

/**
 * スプレッドシート起動時にカスタムメニューを追加
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('📅 シフト管理')
    .addItem('🌐 Webアプリを開く', 'openWebApp')
    .addSeparator()
    .addItem('✨ シフト案作成', 'showCreateShiftDialog')
    .addItem('✅ ルールチェック', 'showRuleCheckDialog')
    .addItem('📝 シフト登録', 'showRegisterShiftDialog')
    .addSeparator()
    .addItem('🔧 初期設定', 'initializeAllSheets')
    .addToUi();

  console.log('カスタムメニュー追加完了');
}

/**
 * Webアプリを開く
 */
function openWebApp() {
  const url = ScriptApp.getService().getUrl();
  const html = `<html>
    <body>
      <p>以下のURLをブラウザで開いてください:</p>
      <p><a href="${url}" target="_blank">${url}</a></p>
      <script>
        google.script.host.close();
        window.open("${url}", "_blank");
      </script>
    </body>
  </html>`;

  const htmlOutput = HtmlService.createHtmlOutput(html)
    .setWidth(500)
    .setHeight(150);

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Webアプリを開く');
}

/**
 * シフト案作成ダイアログ
 */
function showCreateShiftDialog() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'シフト案作成',
    '対象年月を入力してください (例: 2025/01)',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const input = response.getResponseText();
    const [year, month] = input.split('/').map(s => parseInt(s.trim()));

    if (year && month) {
      const result = createShiftDraft(year, month);
      ui.alert(result.message);
    } else {
      ui.alert('入力形式が正しくありません');
    }
  }
}

/**
 * ルールチェックダイアログ
 */
function showRuleCheckDialog() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'ルールチェック',
    '対象年月を入力してください (例: 2025/01)',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const input = response.getResponseText();
    const [year, month] = input.split('/').map(s => parseInt(s.trim()));

    if (year && month) {
      const result = checkShiftRules(year, month);

      if (result.success) {
        if (result.violations.length === 0) {
          ui.alert('✅ ルール違反はありませんでした！');
        } else {
          let message = `⚠️ ${result.violations.length}件の違反が見つかりました:\n\n`;
          result.violations.slice(0, 10).forEach(v => {
            message += `• ${v.message}\n`;
          });

          if (result.violations.length > 10) {
            message += `\n...他 ${result.violations.length - 10}件`;
          }

          ui.alert(message);
        }
      } else {
        ui.alert('エラー: ' + result.message);
      }
    } else {
      ui.alert('入力形式が正しくありません');
    }
  }
}

/**
 * シフト登録ダイアログ
 */
function showRegisterShiftDialog() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'シフト登録',
    '対象年月を入力してください (例: 2025/01)',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const input = response.getResponseText();
    const [year, month] = input.split('/').map(s => parseInt(s.trim()));

    if (year && month) {
      // まずルールチェック
      const checkResult = checkShiftRules(year, month);

      if (checkResult.violations && checkResult.violations.length > 0) {
        const confirm = ui.alert(
          '警告',
          `${checkResult.violations.length}件のルール違反があります。\n登録を続けますか？`,
          ui.ButtonSet.YES_NO
        );

        if (confirm !== ui.Button.YES) {
          return;
        }
      }

      // カレンダーに登録
      const result = registerShiftToCalendar(year, month);
      ui.alert(result.message);
    } else {
      ui.alert('入力形式が正しくありません');
    }
  }
}

/**
 * 全シートを初期化
 */
function initializeAllSheets() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '初期設定',
    '全シートを初期化します。既存のデータは保持されます。\n続けますか？',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      initializeStaffSheet();
      initializeShiftMasterSheet();
      initializeHolidayRequestSheet();
      initializeConfirmedShiftSheet();

      // M_設定シートを初期化
      const settingsSheet = getOrCreateSheet(SHEET_NAMES.SETTINGS);
      if (settingsSheet.getLastRow() === 0) {
        settingsSheet.appendRow(['設定ID', '設定値']);
        settingsSheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#d9d2e9');
      }

      ui.alert('✅ 初期設定が完了しました！');
    } catch (e) {
      console.error('初期化エラー:', e);
      ui.alert('❌ エラーが発生しました: ' + e.message);
    }
  }
}

// ============================================
// Webアプリ用APIエンドポイント
// ============================================

/**
 * ログイン処理
 */
function apiLogin(loginId, password) {
  return authenticateUser(loginId, password);
}

/**
 * ログアウト処理
 */
function apiLogout() {
  return logout();
}

/**
 * セッション情報取得
 */
function apiGetSession() {
  return getSession();
}

/**
 * 職員一覧取得
 */
function apiGetAllStaff() {
  try {
    return { success: true, data: getAllStaff() };
  } catch (e) {
    console.error('職員一覧取得エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * 職員保存
 */
function apiSaveStaff(staffData) {
  try {
    saveStaff(staffData);
    return { success: true, message: '保存しました' };
  } catch (e) {
    console.error('職員保存エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * シフトマスタ一覧取得
 */
function apiGetAllShiftMaster() {
  try {
    return { success: true, data: getAllShiftMaster() };
  } catch (e) {
    console.error('シフトマスタ取得エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * 休み希望保存
 */
function apiSaveHolidayRequest(name, dateList, notes) {
  try {
    saveHolidayRequest(name, dateList, notes);
    return { success: true, message: '休み希望を保存しました' };
  } catch (e) {
    console.error('休み希望保存エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * 休み希望取得
 */
function apiGetHolidayRequest(name, year, month) {
  try {
    const data = getHolidayRequestByNameAndMonth(name, year, month);
    return { success: true, data: data };
  } catch (e) {
    console.error('休み希望取得エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * 設定取得
 */
function apiGetConfig(key) {
  try {
    const value = getConfig(key);
    return { success: true, value: value };
  } catch (e) {
    console.error('設定取得エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * 設定保存
 */
function apiSetConfig(key, value) {
  try {
    setConfig(key, value);
    return { success: true, message: '設定を保存しました' };
  } catch (e) {
    console.error('設定保存エラー:', e);
    return { success: false, message: e.message };
  }
}
