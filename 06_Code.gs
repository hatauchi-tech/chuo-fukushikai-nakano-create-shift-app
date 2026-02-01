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

/**
 * WebアプリのPOSTリクエスト処理（Webhook受信）
 */
function doPost(e) {
  try {
    console.log('Webhook受信');

    const requestData = JSON.parse(e.postData.contents);
    const action = requestData.action;

    let result;

    if (action === 'importShiftResult') {
      // シフト結果CSVのインポート
      result = handleShiftResultWebhook(requestData);
    } else {
      result = {
        success: false,
        message: '不明なアクション: ' + action,
        code: 400
      };
    }

    return ContentService.createTextOutput(
      JSON.stringify(result)
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error('doPostエラー:', error);
    return ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        message: 'エラーが発生しました: ' + error.message,
        code: 500
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================
// カスタムメニュー（スタンドアローンスクリプト用）
// ============================================

/**
 * スプレッドシート起動時にカスタムメニューを追加
 * スタンドアローンスクリプトの場合、トリガーを手動で設定する必要があります。
 * 設定方法:
 * 1. GASエディタで「トリガー」を開く
 * 2. 「トリガーを追加」をクリック
 * 3. 関数: onOpen, イベント: スプレッドシートから - 起動時
 */
function onOpen(e) {
  try {
    // スタンドアローンスクリプトの場合、スプレッドシートIDから取得
    const ss = getSpreadsheet();
    const ui = SpreadsheetApp.getUi();

    ui.createMenu('📅 シフト管理')
      .addItem('🌐 Webアプリを開く', 'openWebApp')
      .addSeparator()
      .addSubMenu(ui.createMenu('📤 CSV連携')
        .addItem('📤 休み希望CSV出力', 'showExportHolidayCSVDialog')
        .addItem('📥 シフト結果CSV取込', 'showImportShiftCSVDialog'))
      .addSeparator()
      .addItem('✅ ルールチェック', 'showRuleCheckDialog')
      .addItem('📝 シフト登録', 'showRegisterShiftDialog')
      .addSeparator()
      .addItem('🔧 初期設定', 'initializeAllSheets')
      .addToUi();

    console.log('カスタムメニュー追加完了');
  } catch (error) {
    console.error('カスタムメニュー追加エラー:', error);
  }
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
 * 休み希望CSV出力ダイアログ
 */
function showExportHolidayCSVDialog() {
  const ui = SpreadsheetApp.getUi();

  const monthResponse = ui.prompt(
    '休み希望CSV出力',
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

  // CSV出力実行
  const result = exportHolidayRequestToCSV(year, month);

  if (result.success) {
    ui.alert(
      '✅ CSV出力完了',
      `${result.message}\n\nファイル名: ${result.fileName}\n\n次のステップ:\n1. Google Driveのinputフォルダを確認\n2. Google Colabでシフト計算を実行`,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert('❌ エラー', result.message, ui.ButtonSet.OK);
  }
}

/**
 * シフト結果CSV取込ダイアログ
 */
function showImportShiftCSVDialog() {
  const ui = SpreadsheetApp.getUi();

  const fileIdResponse = ui.prompt(
    'シフト結果CSV取込',
    'DriveファイルIDを入力してください:\n（outputフォルダ内の「シフト結果_YYYYMM.csv」）',
    ui.ButtonSet.OK_CANCEL
  );

  if (fileIdResponse.getSelectedButton() !== ui.Button.OK) return;

  const fileId = fileIdResponse.getResponseText().trim();

  if (!fileId) {
    ui.alert('ファイルIDを入力してください');
    return;
  }

  // CSV取込実行
  ui.alert('処理中...', 'CSV取込を実行しています。しばらくお待ちください。', ui.ButtonSet.OK);

  const result = importShiftResultFromCSV(fileId);

  if (result.success) {
    ui.alert(
      '✅ CSV取込完了',
      `${result.message}\n\n次のステップ:\n1. シフト作業用シートで内容を確認\n2. 手修正が必要な場合は編集\n3. ルールチェックを実行\n4. シフト登録でカレンダーに反映`,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert('❌ エラー', result.message, ui.ButtonSet.OK);
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

  // ステップ1: 年月入力
  const monthResponse = ui.prompt(
    'シフト登録 - ステップ1/2',
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

  // ステップ2: 処理対象グループの選択
  const groupResponse = ui.prompt(
    'シフト登録 - ステップ2/2',
    '処理対象グループを選択してください:\n\n' +
    '1, 2, 3, 4, 5, 6 のいずれかを入力\n' +
    'ALL. 全グループを登録\n\n' +
    '番号をカンマ区切りで入力 (例: 1,2,3 または ALL):',
    ui.ButtonSet.OK_CANCEL
  );

  if (groupResponse.getSelectedButton() !== ui.Button.OK) return;

  const groupInput = groupResponse.getResponseText().trim().toUpperCase();
  let selectedGroups = [];

  if (groupInput === 'ALL') {
    selectedGroups = [1, 2, 3, 4, 5, 6];
  } else {
    selectedGroups = groupInput.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 6);
  }

  if (selectedGroups.length === 0) {
    ui.alert('有効なグループ番号が入力されていません');
    return;
  }

  // カレンダーに登録（選択されたグループのみ）
  const result = registerShiftToCalendarByGroup(year, month, selectedGroups);

  let message = result.message + '\n\n';
  message += `登録グループ: ${selectedGroups.join(', ')}\n`;
  message += `登録件数: ${result.count || 0}件`;

  ui.alert(message);
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
 * シフトマスタ保存
 */
function apiSaveShiftMaster(shiftData) {
  try {
    saveShiftMaster(shiftData);
    return { success: true, message: '保存しました' };
  } catch (e) {
    console.error('シフトマスタ保存エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * シフトマスタ削除
 */
function apiDeleteShiftMaster(shiftId) {
  try {
    const result = deleteShiftMaster(shiftId);
    if (result) {
      return { success: true, message: '削除しました' };
    } else {
      return { success: false, message: 'データが見つかりませんでした' };
    }
  } catch (e) {
    console.error('シフトマスタ削除エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * 休み希望保存
 * @param {string} name - 氏名
 * @param {Array} requestList - [{date: ISO文字列, priority: 数値}] の配列
 * @param {string} notes - 特記事項
 */
function apiSaveHolidayRequest(name, requestList, notes) {
  try {
    saveHolidayRequest(name, requestList, notes);
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

/**
 * 休み希望CSV出力
 */
function apiExportHolidayRequestToCSV(year, month) {
  try {
    return exportHolidayRequestToCSV(year, month);
  } catch (e) {
    console.error('CSV出力エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * シフト結果CSV取込
 */
function apiImportShiftResultFromCSV(fileId) {
  try {
    return importShiftResultFromCSV(fileId);
  } catch (e) {
    console.error('CSV取込エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * Google Colab URL取得API
 * スクリプトプロパティからGOOGLE_COLAB_URLを取得
 */
function apiGetColabUrl() {
  try {
    const props = PropertiesService.getScriptProperties();
    const url = props.getProperty('GOOGLE_COLAB_URL');
    return { success: true, url: url || '' };
  } catch (e) {
    console.error('Colab URL取得エラー:', e);
    return { success: false, url: '' };
  }
}

/**
 * カレンダー登録API
 */
function apiRegisterShiftToCalendar(year, month) {
  try {
    return registerShiftToCalendar(year, month);
  } catch (e) {
    console.error('カレンダー登録エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * シフト作成用3種CSV一括出力API
 * T_休み希望.csv, M_職員.csv, M_設定.csv を一括出力
 */
function apiExportAllCSVForShiftCreation(year, month) {
  try {
    return exportAllCSVForShiftCreation(year, month);
  } catch (e) {
    console.error('CSV一括出力エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * OUTPUTフォルダ内のCSVファイル一覧を取得API
 */
function apiGetOutputFiles() {
  try {
    const folderId = getDriveFolderId('output');
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFilesByType(MimeType.CSV);

    const fileList = [];
    while (files.hasNext()) {
      const file = files.next();
      fileList.push({
        id: file.getId(),
        name: file.getName(),
        lastUpdated: file.getLastUpdated().toISOString(),
        size: file.getSize()
      });
    }

    // 更新日時の新しい順にソート
    fileList.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

    return {
      success: true,
      files: fileList
    };
  } catch (e) {
    console.error('ファイル一覧取得エラー:', e);
    return { success: false, message: e.message, files: [] };
  }
}

/**
 * 対象月のシフト結果CSVを自動検索して取り込むAPI
 * @param {number} year - 対象年
 * @param {number} month - 対象月
 */
function apiImportShiftResultByMonth(year, month) {
  try {
    const ym = `${year}${String(month).padStart(2, '0')}`;
    const targetFileName = `シフト結果_${ym}.csv`;

    console.log(`シフト結果CSV自動取込開始: ${targetFileName}`);

    // OUTPUTフォルダから対象ファイルを検索
    const folderId = getDriveFolderId('output');
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFilesByName(targetFileName);

    if (!files.hasNext()) {
      return {
        success: false,
        message: `${targetFileName} が見つかりません。\nPythonでシフト最適化を実行してください。`
      };
    }

    const file = files.next();
    const fileId = file.getId();

    // 既存のインポート関数を呼び出し
    return importShiftResultFromCSV(fileId);

  } catch (e) {
    console.error('シフト結果CSV自動取込エラー:', e);
    return { success: false, message: e.message };
  }
}

// ============================================
// シフト修正画面用API
// ============================================

/**
 * グループ一覧を取得
 */
function apiGetGroups() {
  try {
    const staff = getActiveStaff();
    const groups = [...new Set(staff.map(s => s['グループ']))].filter(g => g).sort();
    return { success: true, groups: groups };
  } catch (e) {
    console.error('グループ一覧取得エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * シフトマスタ一覧を取得（シフト修正画面用）
 */
function apiGetShiftMaster() {
  try {
    const shifts = getAllShiftMaster();
    return { success: true, shifts: shifts };
  } catch (e) {
    console.error('シフトマスタ取得エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * グループ別シフトデータを取得（修正画面用）
 * @param {number} year - 対象年
 * @param {number} month - 対象月
 * @param {number} group - グループ番号
 */
function apiGetShiftDataByGroup(year, month, group) {
  try {
    console.log(`シフトデータ取得: ${year}年${month}月 グループ${group}`);

    // グループに属する職員を取得
    const allStaff = getActiveStaff();
    const groupStaff = allStaff.filter(s => String(s['グループ']) === String(group));

    if (groupStaff.length === 0) {
      return { success: false, message: `グループ${group}に職員がいません` };
    }

    // 確定シフトデータを取得
    const confirmedShifts = getConfirmedShiftsByMonth(year, month);

    // 月の日数と日付情報を生成
    const daysInMonth = new Date(year, month, 0).getDate();
    const dateInfo = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d);
      const dayOfWeek = date.getDay(); // 0=日, 6=土
      dateInfo.push({
        day: d,
        date: `${year}/${String(month).padStart(2,'0')}/${String(d).padStart(2,'0')}`,
        dayOfWeek: dayOfWeek,
        isHoliday: isJapaneseHoliday(year, month, d),
        isSaturday: dayOfWeek === 6,
        isSunday: dayOfWeek === 0
      });
    }

    // 職員ごとのシフトデータを構築
    const staffShifts = groupStaff.map(staff => {
      const staffName = staff['氏名'];
      const shifts = {};

      // 全日休みで初期化
      for (let d = 1; d <= daysInMonth; d++) {
        shifts[d] = { shiftName: '休み', startTime: '', endTime: '' };
      }

      // 確定シフトデータを上書き
      confirmedShifts.filter(s => s['氏名'] === staffName).forEach(shift => {
        const startDate = new Date(shift['勤務開始日']);
        if (startDate.getMonth() + 1 === month && startDate.getFullYear() === year) {
          const day = startDate.getDate();

          // 時刻をシリアライズ可能な文字列に変換（Date型対応）
          const formatTimeValue = (val) => {
            if (!val) return '';
            if (val instanceof Date) {
              return Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
            }
            return String(val);
          };

          // 登録日時をシリアライズ可能な文字列に変換
          let regDateStr = '';
          if (shift['登録日時']) {
            const regDate = shift['登録日時'];
            if (regDate instanceof Date) {
              regDateStr = Utilities.formatDate(regDate, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
            } else {
              regDateStr = String(regDate);
            }
          }

          shifts[day] = {
            shiftId: shift['確定シフトID'] ? String(shift['確定シフトID']) : '',
            shiftName: shift['シフト名'] ? String(shift['シフト名']) : '休み',
            startTime: formatTimeValue(shift['開始時間']),
            endTime: formatTimeValue(shift['終了時間']),
            registrationDate: regDateStr,
            calendarEventId: shift['カレンダーイベントID'] ? String(shift['カレンダーイベントID']) : ''
          };
        }
      });

      return {
        staffId: staff['職員ID'],
        name: staffName,
        group: staff['グループ'],
        shifts: shifts
      };
    });

    // 統計情報を計算
    const statistics = calculateShiftStatistics(staffShifts, daysInMonth);

    return {
      success: true,
      year: year,
      month: month,
      group: group,
      dateInfo: dateInfo,
      staffShifts: staffShifts,
      statistics: statistics
    };

  } catch (e) {
    console.error('シフトデータ取得エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * 日本の祝日判定（簡易版）
 */
function isJapaneseHoliday(year, month, day) {
  // 主要な祝日のみ対応
  const holidays = {
    '1/1': '元日',
    '2/11': '建国記念の日',
    '2/23': '天皇誕生日',
    '4/29': '昭和の日',
    '5/3': '憲法記念日',
    '5/4': 'みどりの日',
    '5/5': 'こどもの日',
    '8/11': '山の日',
    '11/3': '文化の日',
    '11/23': '勤労感謝の日'
  };

  // 固定祝日チェック
  const key = `${month}/${day}`;
  if (holidays[key]) return true;

  // 成人の日（1月第2月曜）
  if (month === 1 && getNthWeekday(year, 1, 1, 2) === day) return true;
  // 海の日（7月第3月曜）
  if (month === 7 && getNthWeekday(year, 7, 1, 3) === day) return true;
  // 敬老の日（9月第3月曜）
  if (month === 9 && getNthWeekday(year, 9, 1, 3) === day) return true;
  // スポーツの日（10月第2月曜）
  if (month === 10 && getNthWeekday(year, 10, 1, 2) === day) return true;

  // 春分・秋分は近似値
  if (month === 3 && day === 20) return true;
  if (month === 9 && day === 23) return true;

  return false;
}

/**
 * N番目の曜日の日付を取得
 */
function getNthWeekday(year, month, dayOfWeek, n) {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const date = new Date(year, month - 1, d);
    if (date.getMonth() + 1 !== month) break;
    if (date.getDay() === dayOfWeek) {
      count++;
      if (count === n) return d;
    }
  }
  return -1;
}

/**
 * シフト統計情報を計算
 * 休日数は夜勤明け後の必須休み（夜勤翌日・翌々日）を除外してカウント
 */
function calculateShiftStatistics(staffShifts, daysInMonth) {
  return staffShifts.map(staff => {
    let workDays = 0;
    let restDays = 0;
    const shiftCounts = {};

    // 1パス目: 夜勤明け必須休みの日を特定
    const mandatoryRestDays = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const shift = staff.shifts[d];
      const shiftName = shift.shiftName || '休み';
      if (shiftName === '夜勤') {
        if (d + 1 <= daysInMonth) mandatoryRestDays[d + 1] = true;
        if (d + 2 <= daysInMonth) mandatoryRestDays[d + 2] = true;
      }
    }

    // 2パス目: 集計
    for (let d = 1; d <= daysInMonth; d++) {
      const shift = staff.shifts[d];
      const shiftName = shift.shiftName || '休み';

      if (!shiftCounts[shiftName]) {
        shiftCounts[shiftName] = 0;
      }
      shiftCounts[shiftName]++;

      if (shiftName === '休み') {
        // 夜勤明け必須休みでない場合のみ休日数（公休）にカウント
        if (!mandatoryRestDays[d]) {
          restDays++;
        }
      } else {
        workDays++;
        // 夜勤は2日分換算
        if (shiftName === '夜勤') {
          workDays++;
        }
      }
    }

    return {
      name: staff.name,
      workDays: workDays,
      restDays: restDays,
      shiftCounts: shiftCounts
    };
  });
}

/**
 * シフトを更新
 * @param {string} staffName - 職員名
 * @param {number} year - 年
 * @param {number} month - 月
 * @param {number} day - 日
 * @param {string} shiftName - シフト名
 */
function apiUpdateShift(staffName, year, month, day, shiftName) {
  try {
    console.log(`シフト更新: ${staffName} ${year}/${month}/${day} → ${shiftName}`);

    const startDate = new Date(year, month - 1, day);
    const shiftInfo = getShiftByName(shiftName);

    // 開始・終了時間を設定
    let startTime = '';
    let endTime = '';
    let endDate = new Date(startDate);

    if (shiftInfo) {
      startTime = shiftInfo['開始時間'] || '';
      endTime = shiftInfo['終了時間'] || '';
      // 夜勤など終了時刻が開始より早い場合は翌日
      if (endTime && startTime && endTime < startTime) {
        endDate.setDate(endDate.getDate() + 1);
      }
    }

    // 既存のシフトを検索
    const existingShifts = getConfirmedShiftsByMonth(year, month);
    const existing = existingShifts.find(s =>
      s['氏名'] === staffName &&
      new Date(s['勤務開始日']).getDate() === day
    );

    if (shiftName === '休み') {
      // 休みの場合は削除
      if (existing && existing['確定シフトID']) {
        deleteConfirmedShift(existing['確定シフトID']);
      }
    } else {
      // 職員情報を取得
      const staff = getStaffByName(staffName);

      const shiftData = {
        '氏名': staffName,
        'グループ': staff ? staff['グループ'] : '',
        'シフト名': shiftName,
        '勤務開始日': startDate,
        '開始時間': startTime,
        '勤務終了日': endDate,
        '終了時間': endTime
      };

      if (existing && existing['確定シフトID']) {
        // 既存を更新
        updateConfirmedShift(existing['確定シフトID'], shiftData);
      } else {
        // 新規作成
        saveConfirmedShift(shiftData);
      }
    }

    return { success: true, message: 'シフトを更新しました' };

  } catch (e) {
    console.error('シフト更新エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * シフトを確定（カレンダー登録なし）
 * @param {number} year - 年
 * @param {number} month - 月
 * @param {number} group - グループ（省略時は全グループ）
 */
function apiConfirmShifts(year, month, group) {
  try {
    console.log(`シフト確定（カレンダーなし）: ${year}年${month}月 グループ${group || '全て'}`);

    const now = new Date();
    const registrationDate = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');

    const shifts = getConfirmedShiftsByMonth(year, month);
    const targetShifts = group
      ? shifts.filter(s => String(s['グループ']) === String(group))
      : shifts;

    let confirmedCount = 0;

    for (const shift of targetShifts) {
      if (shift['シフト名'] === '休み' || !shift['シフト名']) continue;

      updateConfirmedShiftFields(shift['確定シフトID'], {
        '登録日時': registrationDate
      });
      confirmedCount++;
    }

    return {
      success: true,
      count: confirmedCount,
      message: `${confirmedCount}件のシフトを確定しました`
    };

  } catch (e) {
    console.error('シフト確定エラー:', e);
    return { success: false, message: e.message };
  }
}

/**
 * シフトを確定してカレンダー登録
 * @param {number} year - 年
 * @param {number} month - 月
 * @param {number} group - グループ（省略時は全グループ）
 */
function apiConfirmShiftsAndRegisterCalendar(year, month, group) {
  try {
    console.log(`シフト確定・カレンダー登録: ${year}年${month}月 グループ${group || '全て'}`);

    // 登録日時を更新
    const now = new Date();
    const registrationDate = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');

    // 対象シフトを取得
    const shifts = getConfirmedShiftsByMonth(year, month);
    const targetShifts = group
      ? shifts.filter(s => String(s['グループ']) === String(group))
      : shifts;

    let registeredCount = 0;

    // 各シフトにカレンダー登録
    for (const shift of targetShifts) {
      if (shift['シフト名'] === '休み' || !shift['シフト名']) continue;

      const staff = getStaffByName(shift['氏名']);
      if (!staff || !staff['カレンダーID']) continue;

      const shiftInfo = getShiftByName(shift['シフト名']);
      if (!shiftInfo) continue;

      // カレンダーイベント作成
      const eventId = createOrUpdateCalendarEvent(
        staff['カレンダーID'],
        shift['氏名'],
        new Date(shift['勤務開始日']),
        new Date(shift['勤務終了日']),
        shiftInfo,
        shift['カレンダーイベントID'] || null
      );

      // シフトデータを更新
      if (eventId) {
        updateConfirmedShiftFields(shift['確定シフトID'], {
          '登録日時': registrationDate,
          'カレンダーイベントID': eventId
        });
        registeredCount++;
      }
    }

    return {
      success: true,
      count: registeredCount,
      message: `${registeredCount}件のシフトをカレンダーに登録しました`
    };

  } catch (e) {
    console.error('シフト確定エラー:', e);
    return { success: false, message: e.message };
  }
}
