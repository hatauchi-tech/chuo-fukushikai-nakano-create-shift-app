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
    return HtmlService.createHtmlOutputFromFile('07_index')
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

  // ステップ1: 年月入力
  const monthResponse = ui.prompt(
    'ルールチェック - ステップ1/2',
    '対象年月を入力してください (例: 2025/01)',
    ui.ButtonSet.OK_CANCEL
  );

  if (monthResponse.getSelectedButton() !== ui.Button.OK) return;

  const input = monthResponse.getResponseText();
  const [year, month] = input.split('/').map(s => parseInt(s.trim()));

  if (!year || !month) {
    ui.alert('入力形式が正しくありません');
    return;
  }

  // ステップ2: チェックするルールを選択
  const ruleResponse = ui.prompt(
    'ルールチェック - ステップ2/2',
    'チェックするルールを選択してください:\n\n' +
    '1. 最低人数チェック（グループ別）\n' +
    '2. 連勤制限チェック（6連勤以上）\n' +
    '3. インターバルチェック（遅出→早出禁止）\n' +
    '4. 勤務日数上限チェック（月21日以内）\n' +
    '5. 夜勤明けルール（夜勤→休→休）\n' +
    '6. 資格者配置チェック（夜勤に資格者1名以上）\n' +
    'ALL. すべてのルールをチェック\n\n' +
    '番号をカンマ区切りで入力 (例: 1,2,3 または ALL):',
    ui.ButtonSet.OK_CANCEL
  );

  if (ruleResponse.getSelectedButton() !== ui.Button.OK) return;

  const ruleInput = ruleResponse.getResponseText().trim().toUpperCase();
  let selectedRules = [];

  if (ruleInput === 'ALL') {
    selectedRules = [1, 2, 3, 4, 5, 6];
  } else {
    selectedRules = ruleInput.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 6);
  }

  if (selectedRules.length === 0) {
    ui.alert('有効なルール番号が入力されていません');
    return;
  }

  // ルールチェック実行
  const result = checkShiftRulesSelective(year, month, selectedRules);

  if (result.success) {
    if (result.violations.length === 0) {
      ui.alert('✅ ルール違反はありませんでした！');
    } else {
      let message = `⚠️ ${result.violations.length}件の違反が見つかりました\n\n`;
      message += '違反箇所にはセルコメントが追加されました。\n';
      message += 'セルにマウスを合わせると詳細が確認できます。\n\n';
      message += '【違反内訳】\n';

      const violationsByType = {};
      result.violations.forEach(v => {
        violationsByType[v.type] = (violationsByType[v.type] || 0) + 1;
      });

      Object.keys(violationsByType).forEach(type => {
        message += `• ${type}: ${violationsByType[type]}件\n`;
      });

      ui.alert(message);
    }
  } else {
    ui.alert('エラー: ' + result.message);
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
