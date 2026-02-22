/**
 * CSVService.gs - CSV入出力サービス
 * Driveとの連携、CSV形式のバリデーション
 */

// ============================================
// CSVスキーマ定義
// ============================================

const CSV_SCHEMA = {
  HOLIDAY_REQUEST: {
    headers: ['氏名', 'グループ', '日付', '優先順位', '特記事項'],
    required: ['氏名', 'グループ', '日付', '優先順位']
  },
  SHIFT_RESULT: {
    // Python出力形式に合わせたヘッダー
    headers: ['確定シフトID', '氏名', 'グループ', 'シフト名', '勤務開始日', '開始時間', '勤務終了日', '終了時間', '登録日時', 'カレンダーイベントID'],
    required: ['氏名', 'グループ', 'シフト名', '勤務開始日']
  },
  STAFF: {
    headers: ['職員ID', '氏名', 'グループ', 'ユニット', '雇用形態', '喀痰吸引資格者', '勤務配慮', '有効'],
    required: ['職員ID', '氏名', 'グループ']
  },
  SETTINGS: {
    headers: ['設定ID', '設定値'],
    required: ['設定ID', '設定値']
  }
};

// ============================================
// CSV出力機能（T_休み希望）
// ============================================

/**
 * 休み希望データをCSV出力
 * @param {number} year - 対象年
 * @param {number} month - 対象月
 * @return {Object} 結果オブジェクト
 */
function exportHolidayRequestToCSV(year, month) {
  try {
    console.log(`CSV出力開始: ${year}年${month}月`);

    // 対象月のデータを取得
    const sheet = getOrCreateSheet(SHEET_NAMES.HOLIDAY_REQUEST);
    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) {
      throw new Error('出力するデータがありません');
    }

    // ヘッダー
    const headers = data[0];
    const nameIndex = headers.indexOf('氏名');
    const dateIndex = headers.indexOf('日付');
    const priorityIndex = headers.indexOf('優先順位');
    const notesIndex = headers.indexOf('特記事項');

    // 職員データを最初に1回だけ取得してキャッシュ（パフォーマンス改善）
    const allStaff = getAllStaff();
    const staffMap = {};
    allStaff.forEach(staff => {
      staffMap[staff['氏名']] = staff;
    });

    // 対象月のデータをフィルタ
    const filteredRows = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const date = new Date(row[dateIndex]);

      if (date.getFullYear() === year && date.getMonth() + 1 === month) {
        // キャッシュからグループ情報を取得
        const staff = staffMap[row[nameIndex]];
        const group = staff ? staff['グループ'] : '';

        filteredRows.push([
          row[nameIndex],                                           // 氏名
          group,                                                    // グループ
          Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd'), // 日付
          row[priorityIndex] || 1,                                  // 優先順位
          row[notesIndex] || ''                                     // 特記事項
        ]);
      }
    }

    if (filteredRows.length === 0) {
      throw new Error(`${year}年${month}月のデータがありません`);
    }

    // CSVデータ作成
    const csvHeaders = CSV_SCHEMA.HOLIDAY_REQUEST.headers;
    const csvRows = [csvHeaders, ...filteredRows];
    const csvContent = csvRows.map(row => row.join(',')).join('\n');

    // Driveに保存
    const fileName = `T_休み希望_${year}${String(month).padStart(2, '0')}.csv`;
    const fileId = saveToDrive(fileName, csvContent, 'input');

    console.log(`CSV出力完了: ${fileName} (${filteredRows.length}件)`);

    return {
      success: true,
      fileName: fileName,
      fileId: fileId,
      count: filteredRows.length,
      message: `${filteredRows.length}件のデータをCSV出力しました`
    };

  } catch (e) {
    console.error('CSV出力エラー:', e);
    return {
      success: false,
      message: 'エラーが発生しました: ' + e.message
    };
  }
}

// ============================================
// CSV出力機能（M_職員）
// ============================================

/**
 * 職員マスタをCSV出力
 * @param {number} year - 対象年
 * @param {number} month - 対象月
 * @return {Object} 結果オブジェクト
 */
function exportStaffToCSV(year, month) {
  try {
    console.log(`M_職員CSV出力開始: ${year}年${month}月`);

    const staffList = getActiveStaff();

    if (staffList.length === 0) {
      throw new Error('出力する職員データがありません');
    }

    // CSVデータ作成
    const csvHeaders = CSV_SCHEMA.STAFF.headers;
    const csvRows = [csvHeaders];

    staffList.forEach(staff => {
      csvRows.push([
        staff['職員ID'] || '',
        staff['氏名'] || '',
        staff['グループ'] || '',
        staff['ユニット'] || '',
        staff['雇用形態'] || '',
        staff['喀痰吸引資格者'] ? 'TRUE' : 'FALSE',
        staff['勤務配慮'] ? 'TRUE' : 'FALSE',
        staff['有効'] ? 'TRUE' : 'FALSE'
      ]);
    });

    const csvContent = csvRows.map(row => row.join(',')).join('\n');

    // Driveに保存（YYYYMM形式のファイル名）
    const yearMonth = `${year}${String(month).padStart(2, '0')}`;
    const fileName = `M_職員_${yearMonth}.csv`;
    const fileId = saveToDrive(fileName, csvContent, 'input');

    console.log(`M_職員CSV出力完了: ${staffList.length}件`);

    return {
      success: true,
      fileName: fileName,
      fileId: fileId,
      count: staffList.length,
      message: `${staffList.length}件の職員データをCSV出力しました`
    };

  } catch (e) {
    console.error('M_職員CSV出力エラー:', e);
    return {
      success: false,
      message: 'エラーが発生しました: ' + e.message
    };
  }
}

// ============================================
// CSV出力機能（M_設定）
// ============================================

/**
 * 設定データをCSV出力（対象月の設定のみ）
 * @param {number} year - 対象年
 * @param {number} month - 対象月
 * @return {Object} 結果オブジェクト
 */
function exportSettingsToCSV(year, month) {
  try {
    console.log(`M_設定CSV出力開始: ${year}年${month}月`);

    const yearMonth = `${year}${String(month).padStart(2, '0')}`;

    // 必要な設定を取得
    const settings = [];

    // 公休日数
    const holidaysKey = `MONTHLY_HOLIDAYS_${yearMonth}`;
    const holidaysValue = getConfig(holidaysKey, 9);
    settings.push([holidaysKey, holidaysValue]);

    // 対象年月
    settings.push(['TARGET_YEAR', year]);
    settings.push(['TARGET_MONTH', month]);

    // 月の日数
    const daysInMonth = new Date(year, month, 0).getDate();
    settings.push(['DAYS_IN_MONTH', daysInMonth]);

    // シフトマスタのキー→名称マッピングをエクスポート（Python側でシフト名を動的取得）
    var shiftMaster = getAllShiftMaster();
    shiftMaster.forEach(function(shift) {
      settings.push([shift['シフトID'] + '_NAME', shift['シフト名']]);
    });
    if (shiftMaster.length > 0) {
      console.log('シフトマスタをM_設定CSVに追加: ' + shiftMaster.length + '件');
    }

    // 勤務指定データを設定として追加（Python側で ASSIGN_ プレフィクスで識別）
    // 設定値はシフトID（キー）で出力。シフト名称変更があってもキーは不変
    var assignments = getShiftAssignmentsByMonth(year, month);
    assignments.forEach(function(assign) {
      var dateStr = assign['日付'].replace(/-/g, '');
      settings.push(['ASSIGN_' + assign['氏名'] + '_' + dateStr, assign['シフトID']]);
    });
    if (assignments.length > 0) {
      console.log('勤務指定データをM_設定CSVに追加: ' + assignments.length + '件');
    }

    // CSVデータ作成
    const csvHeaders = CSV_SCHEMA.SETTINGS.headers;
    const csvRows = [csvHeaders, ...settings];
    const csvContent = csvRows.map(row => row.join(',')).join('\n');

    // Driveに保存
    const fileName = `M_設定_${yearMonth}.csv`;
    const fileId = saveToDrive(fileName, csvContent, 'input');

    console.log(`M_設定CSV出力完了: ${settings.length}件`);

    return {
      success: true,
      fileName: fileName,
      fileId: fileId,
      count: settings.length,
      message: `${settings.length}件の設定をCSV出力しました`
    };

  } catch (e) {
    console.error('M_設定CSV出力エラー:', e);
    return {
      success: false,
      message: 'エラーが発生しました: ' + e.message
    };
  }
}

// ============================================
// 3種CSV一括出力
// ============================================

/**
 * シフト作成用の3種類CSVを一括出力
 * @param {number} year - 対象年
 * @param {number} month - 対象月
 * @return {Object} 結果オブジェクト
 */
function exportAllCSVForShiftCreation(year, month) {
  try {
    console.log(`シフト作成用CSV一括出力開始: ${year}年${month}月`);

    const results = {
      holidayRequest: null,
      staff: null,
      settings: null
    };

    // 1. 休み希望CSV
    results.holidayRequest = exportHolidayRequestToCSV(year, month);
    if (!results.holidayRequest.success) {
      // 休み希望がなくても他のCSVは出力を続ける
      console.log('休み希望データなし、スキップ');
    }

    // 2. 職員CSV（年月付きファイル名で出力）
    results.staff = exportStaffToCSV(year, month);
    if (!results.staff.success) {
      throw new Error('職員CSV出力に失敗: ' + results.staff.message);
    }

    // 3. 設定CSV
    results.settings = exportSettingsToCSV(year, month);
    if (!results.settings.success) {
      throw new Error('設定CSV出力に失敗: ' + results.settings.message);
    }

    // 結果サマリー
    const outputFiles = [];
    if (results.holidayRequest && results.holidayRequest.success) {
      outputFiles.push(results.holidayRequest.fileName);
    }
    outputFiles.push(results.staff.fileName);
    outputFiles.push(results.settings.fileName);

    console.log(`シフト作成用CSV一括出力完了: ${outputFiles.length}ファイル`);

    return {
      success: true,
      files: outputFiles,
      details: results,
      message: `${outputFiles.length}ファイルを出力しました: ${outputFiles.join(', ')}`
    };

  } catch (e) {
    console.error('CSV一括出力エラー:', e);
    return {
      success: false,
      message: 'エラーが発生しました: ' + e.message
    };
  }
}

// ============================================
// CSV入力機能（シフト結果）
// ============================================

/**
 * シフト結果CSVをインポート
 * @param {string} fileId - DriveファイルID
 * @return {Object} 結果オブジェクト
 */
function importShiftResultFromCSV(fileId) {
  try {
    console.log(`CSV取込開始: ${fileId}`);

    // Driveからファイル取得
    const file = DriveApp.getFileById(fileId);
    const csvContent = file.getBlob().getDataAsString('UTF-8');

    // CSVパース
    const csvData = Utilities.parseCsv(csvContent);

    if (csvData.length <= 1) {
      throw new Error('CSVデータが空です');
    }

    // バリデーション
    const validationResult = validateShiftResultCSV(csvData);
    if (!validationResult.valid) {
      throw new Error('CSV形式エラー: ' + validationResult.errors.join(', '));
    }

    // データ変換
    const headers = csvData[0];
    const dataRows = csvData.slice(1);

    // Python出力形式のカラムインデックス
    const shiftIdIndex = headers.indexOf('確定シフトID');
    const nameIndex = headers.indexOf('氏名');
    const groupIndex = headers.indexOf('グループ');
    const shiftIndex = headers.indexOf('シフト名');
    const startDateIndex = headers.indexOf('勤務開始日');
    const startTimeIndex = headers.indexOf('開始時間');
    const endDateIndex = headers.indexOf('勤務終了日');
    const endTimeIndex = headers.indexOf('終了時間');

    // 年月を抽出（最初のデータから）
    const firstDate = new Date(dataRows[0][startDateIndex]);
    const year = firstDate.getFullYear();
    const month = firstDate.getMonth() + 1;

    // 既存の確定シフトを削除
    console.log(`既存データ削除: ${year}年${month}月`);
    deleteConfirmedShiftByMonth(year, month);

    // 職員データを最初に1回だけ取得してキャッシュ（パフォーマンス改善）
    const allStaff = getAllStaff();
    const staffMap = {};
    allStaff.forEach(staff => {
      staffMap[staff['氏名']] = staff;
    });
    console.log(`職員キャッシュ作成: ${allStaff.length}件`);

    // 一括保存用の配列
    const shiftsToSave = [];

    dataRows.forEach(row => {
      const shiftName = row[shiftIndex];

      // 「休み」はスキップ
      if (!shiftName || shiftName === '休み' || shiftName === '') {
        return;
      }

      const startDate = new Date(row[startDateIndex]);
      const startTime = row[startTimeIndex] || '00:00';
      const endTime = row[endTimeIndex] || '00:00';

      // 終了日を取得（Python側で既に計算済み）
      let endDate;
      if (row[endDateIndex] && row[endDateIndex] !== '') {
        endDate = new Date(row[endDateIndex]);
      } else {
        // 終了日がない場合は開始日と同じ
        endDate = new Date(startDate);
        if (endTime && startTime && endTime < startTime) {
          endDate.setDate(endDate.getDate() + 1);
        }
      }

      // キャッシュから職員情報を取得（スプレッドシートアクセスなし）
      const staff = staffMap[row[nameIndex]];

      shiftsToSave.push({
        '氏名': row[nameIndex],
        'グループ': row[groupIndex],
        'シフト名': shiftName,
        '勤務開始日': startDate,
        '開始時間': startTime,
        '勤務終了日': endDate,
        '終了時間': endTime,
        'カレンダーID': staff ? staff['カレンダーID'] : ''
      });
    });

    // 一括保存
    const savedShifts = saveConfirmedShiftsBulk(shiftsToSave);

    // アーカイブ
    archiveFile(file);

    console.log(`CSV取込完了: ${savedShifts.length}件`);

    return {
      success: true,
      count: savedShifts.length,
      year: year,
      month: month,
      message: `${year}年${month}月のシフトを${savedShifts.length}件取り込みました`
    };

  } catch (e) {
    console.error('CSV取込エラー:', e);
    return {
      success: false,
      message: 'エラーが発生しました: ' + e.message
    };
  }
}

/**
 * シフト結果CSVのバリデーション
 * @param {Array} csvData - CSVデータ（2次元配列）
 * @return {Object} バリデーション結果
 */
function validateShiftResultCSV(csvData) {
  const errors = [];

  // ヘッダーチェック（必須ヘッダーのみチェック）
  const headers = csvData[0];
  const requiredHeaders = CSV_SCHEMA.SHIFT_RESULT.required;

  requiredHeaders.forEach(header => {
    if (!headers.includes(header)) {
      errors.push(`必須ヘッダーが不足: ${header}`);
    }
  });

  // データ行チェック
  if (csvData.length <= 1) {
    errors.push('データが0件です');
  }

  // 各行のバリデーション（サンプル：最初の5行のみ）
  const nameIndex = headers.indexOf('氏名');
  const startDateIndex = headers.indexOf('勤務開始日');
  const shiftIndex = headers.indexOf('シフト名');

  for (let i = 1; i < Math.min(csvData.length, 6); i++) {
    const row = csvData[i];

    if (!row[nameIndex]) {
      errors.push(`${i + 1}行目: 氏名が空です`);
    }

    if (!row[startDateIndex]) {
      errors.push(`${i + 1}行目: 勤務開始日が空です`);
    } else {
      const date = new Date(row[startDateIndex]);
      if (isNaN(date.getTime())) {
        errors.push(`${i + 1}行目: 勤務開始日の形式が不正です (${row[startDateIndex]})`);
      }
    }

    if (!row[shiftIndex]) {
      errors.push(`${i + 1}行目: シフト名が空です`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

// ============================================
// Drive操作ヘルパー関数
// ============================================

/**
 * DriveにCSVファイルを保存
 * @param {string} fileName - ファイル名
 * @param {string} content - CSV内容
 * @param {string} folderType - フォルダタイプ ('input' or 'output')
 * @return {string} ファイルID
 */
function saveToDrive(fileName, content, folderType) {
  try {
    const folderId = getDriveFolderId(folderType);
    const folder = DriveApp.getFolderById(folderId);

    // 既存ファイルがあれば削除
    const existingFiles = folder.getFilesByName(fileName);
    while (existingFiles.hasNext()) {
      const existingFile = existingFiles.next();
      console.log(`既存ファイル削除: ${existingFile.getName()}`);
      existingFile.setTrashed(true);
    }

    // 新規ファイル作成
    const file = folder.createFile(fileName, content, MimeType.CSV);
    console.log(`Driveに保存: ${fileName} (${folderId})`);

    return file.getId();

  } catch (e) {
    console.error('Drive保存エラー:', e);
    throw new Error('Driveへの保存に失敗しました: ' + e.message);
  }
}

/**
 * ファイルをアーカイブフォルダに移動
 * @param {File} file - Driveファイル
 */
function archiveFile(file) {
  try {
    const archiveFolderId = getDriveFolderId('archive');
    const archiveFolder = DriveApp.getFolderById(archiveFolderId);

    // タイムスタンプ付きでリネーム
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    const baseName = file.getName().replace('.csv', '');
    const newName = `${baseName}_${timestamp}.csv`;

    // コピーしてアーカイブフォルダに保存
    const archivedFile = file.makeCopy(newName, archiveFolder);
    console.log(`アーカイブ: ${newName}`);

  } catch (e) {
    console.error('アーカイブエラー:', e);
    // アーカイブ失敗は処理を止めない
  }
}

/**
 * DriveフォルダIDを取得（スクリプトプロパティから）
 * @param {string} folderType - 'input', 'output', 'archive'
 * @return {string} フォルダID
 */
function getDriveFolderId(folderType) {
  const props = PropertiesService.getScriptProperties();
  const configKey = `DRIVE_FOLDER_${folderType.toUpperCase()}`;
  const folderId = props.getProperty(configKey);

  if (!folderId) {
    throw new Error(`${folderType}フォルダのIDがスクリプトプロパティに設定されていません（設定キー: ${configKey}）`);
  }

  return folderId;
}

// ============================================
// Webhook処理（Colab連携）
// ============================================

/**
 * Colabからのシフト結果受信（Webhook）
 * @param {Object} requestData - リクエストデータ
 * @return {Object} レスポンス
 */
function handleShiftResultWebhook(requestData) {
  try {
    // トークン検証
    const token = requestData.token;
    const expectedToken = PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN');

    if (!expectedToken) {
      throw new Error('Webhookトークンが設定されていません');
    }

    if (token !== expectedToken) {
      console.error('トークン検証失敗');
      return {
        success: false,
        message: '認証エラー',
        code: 401
      };
    }

    // ファイルIDを取得
    const fileId = requestData.fileId;
    if (!fileId) {
      throw new Error('fileIdが指定されていません');
    }

    // CSV取込実行
    const result = importShiftResultFromCSV(fileId);

    return result;

  } catch (e) {
    console.error('Webhook処理エラー:', e);
    return {
      success: false,
      message: 'エラーが発生しました: ' + e.message,
      code: 500
    };
  }
}
