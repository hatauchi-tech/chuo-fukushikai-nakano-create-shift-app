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
    headers: ['氏名', 'グループ', '日付', 'シフト名', '開始時間', '終了時間'],
    required: ['氏名', 'グループ', '日付', 'シフト名']
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

    // 対象月のデータをフィルタ
    const filteredRows = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const date = new Date(row[dateIndex]);

      if (date.getFullYear() === year && date.getMonth() + 1 === month) {
        // グループ情報を追加するため、職員マスタから取得
        const staff = getStaffByName(row[nameIndex]);
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
    const csvContent = csvRows.map(row => row.join(','')).join('\n');

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

/**
 * 氏名で職員を検索（02_DataService.gsに追加すべき関数）
 */
function getStaffByName(name) {
  const allStaff = getAllStaff();
  return allStaff.find(staff => staff['氏名'] === name);
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

    const nameIndex = headers.indexOf('氏名');
    const groupIndex = headers.indexOf('グループ');
    const dateIndex = headers.indexOf('日付');
    const shiftIndex = headers.indexOf('シフト名');
    const startTimeIndex = headers.indexOf('開始時間');
    const endTimeIndex = headers.indexOf('終了時間');

    // 年月を抽出（最初のデータから）
    const firstDate = new Date(dataRows[0][dateIndex]);
    const year = firstDate.getFullYear();
    const month = firstDate.getMonth() + 1;

    // 既存の確定シフトを削除
    console.log(`既存データ削除: ${year}年${month}月`);
    deleteConfirmedShiftByMonth(year, month);

    // 一括保存用の配列
    const shiftsToSave = [];

    dataRows.forEach(row => {
      const shiftName = row[shiftIndex];

      // 「休み」はスキップ
      if (!shiftName || shiftName === '休み' || shiftName === '') {
        return;
      }

      const date = new Date(row[dateIndex]);
      const startTime = row[startTimeIndex] || '00:00';
      const endTime = row[endTimeIndex] || '00:00';

      // 終了日を計算（夜勤など、終了時刻が開始時刻より早い場合は翌日）
      let endDate = new Date(date);
      if (endTime && startTime && endTime < startTime) {
        endDate.setDate(endDate.getDate() + 1);
      }

      // 職員情報を取得してカレンダーIDを追加
      const staff = getStaffByName(row[nameIndex]);

      shiftsToSave.push({
        '氏名': row[nameIndex],
        'グループ': row[groupIndex],
        'シフト名': shiftName,
        '勤務開始日': date,
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

  // ヘッダーチェック
  const headers = csvData[0];
  const requiredHeaders = CSV_SCHEMA.SHIFT_RESULT.headers;

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
  const dateIndex = headers.indexOf('日付');
  const shiftIndex = headers.indexOf('シフト名');

  for (let i = 1; i < Math.min(csvData.length, 6); i++) {
    const row = csvData[i];

    if (!row[nameIndex]) {
      errors.push(`${i + 1}行目: 氏名が空です`);
    }

    if (!row[dateIndex]) {
      errors.push(`${i + 1}行目: 日付が空です`);
    } else {
      const date = new Date(row[dateIndex]);
      if (isNaN(date.getTime())) {
        errors.push(`${i + 1}行目: 日付形式が不正です (${row[dateIndex]})`);
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
 * DriveフォルダIDを取得
 * @param {string} folderType - 'input', 'output', 'archive'
 * @return {string} フォルダID
 */
function getDriveFolderId(folderType) {
  const configKey = `DRIVE_FOLDER_${folderType.toUpperCase()}`;
  const folderId = getConfig(configKey);

  if (!folderId) {
    throw new Error(`${folderType}フォルダのIDが設定されていません（設定キー: ${configKey}）`);
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
