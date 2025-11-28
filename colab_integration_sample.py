"""
Google Colab連携サンプルコード

このスクリプトは、Google Colabからシフト計算結果をGASに送信するためのサンプルです。
実際のシフト最適化アルゴリズムは、このスクリプトの前に実装されている前提です。
"""

import requests
import pandas as pd
from google.colab import auth
from google.auth import default
import gspread
from oauth2client.service_account import ServiceAccountCredentials

# ============================================
# 設定（実際の値に置き換えてください）
# ============================================

# GASのWebアプリURL（デプロイ後に取得）
GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'

# Webhookトークン（GAS側と同じ値）
WEBHOOK_TOKEN = 'YOUR_SECRET_TOKEN'

# DriveフォルダID
INPUT_FOLDER_ID = 'YOUR_INPUT_FOLDER_ID'
OUTPUT_FOLDER_ID = 'YOUR_OUTPUT_FOLDER_ID'

# ============================================
# Drive認証
# ============================================

def authenticate_drive():
    """
    Google Drive認証
    """
    auth.authenticate_user()
    creds, _ = default()
    return creds


# ============================================
# CSV読込
# ============================================

def load_holiday_requests_from_drive(year, month):
    """
    DriveからT_休み希望.csvを読み込む

    Args:
        year (int): 対象年
        month (int): 対象月

    Returns:
        pd.DataFrame: 休み希望データ
    """
    from googleapiclient.discovery import build

    creds = authenticate_drive()
    service = build('drive', 'v3', credentials=creds)

    # ファイル名
    file_name = f'T_休み希望_{year}{str(month).zfill(2)}.csv'

    # inputフォルダ内のファイルを検索
    query = f"name='{file_name}' and '{INPUT_FOLDER_ID}' in parents and trashed=false"
    results = service.files().list(q=query, fields='files(id, name)').execute()
    files = results.get('files', [])

    if not files:
        raise FileNotFoundError(f'{file_name} が見つかりません')

    file_id = files[0]['id']

    # CSVダウンロード
    request = service.files().get_media(fileId=file_id)
    import io
    fh = io.BytesIO()
    from googleapiclient.http import MediaIoBaseDownload
    downloader = MediaIoBaseDownload(fh, request)

    done = False
    while not done:
        status, done = downloader.next_chunk()

    # DataFrameに変換
    fh.seek(0)
    df = pd.read_csv(fh)

    print(f'✅ {file_name} を読み込みました ({len(df)}件)')
    return df


# ============================================
# シフト計算（ダミー実装）
# ============================================

def calculate_shift(holiday_requests_df, year, month):
    """
    シフト計算のダミー実装

    実際のシフト最適化アルゴリズムをここに実装してください。

    Args:
        holiday_requests_df (pd.DataFrame): 休み希望データ
        year (int): 対象年
        month (int): 対象月

    Returns:
        pd.DataFrame: シフト結果データ
    """
    print('⚙️ シフト計算を実行中...')

    # ここに実際の最適化アルゴリズムを実装
    # 以下はダミーデータ

    import calendar
    from datetime import datetime, timedelta

    # 月の日数を取得
    days_in_month = calendar.monthrange(year, month)[1]

    # スタッフリスト（実際はM_職員から取得）
    staff_list = holiday_requests_df['氏名'].unique()

    # シフト結果を格納するリスト
    shift_results = []

    for staff_name in staff_list:
        group = holiday_requests_df[holiday_requests_df['氏名'] == staff_name]['グループ'].iloc[0]

        # 休み希望を取得
        staff_holidays = holiday_requests_df[holiday_requests_df['氏名'] == staff_name]
        holiday_dates = pd.to_datetime(staff_holidays['日付']).dt.date.tolist()

        for day in range(1, days_in_month + 1):
            date = datetime(year, month, day).date()

            # 休み希望の日は「休み」
            if date in holiday_dates:
                shift_name = '休み'
                start_time = ''
                end_time = ''
            else:
                # ダミー：日によってシフトを割り当て
                if day % 3 == 0:
                    shift_name = '早出'
                    start_time = '07:00'
                    end_time = '16:00'
                elif day % 3 == 1:
                    shift_name = '日勤'
                    start_time = '09:00'
                    end_time = '18:00'
                else:
                    shift_name = '遅出'
                    start_time = '11:00'
                    end_time = '20:00'

            shift_results.append({
                '氏名': staff_name,
                'グループ': group,
                '日付': date.strftime('%Y-%m-%d'),
                'シフト名': shift_name,
                '開始時間': start_time,
                '終了時間': end_time
            })

    result_df = pd.DataFrame(shift_results)

    print(f'✅ シフト計算完了 ({len(result_df)}件)')
    return result_df


# ============================================
# CSV保存
# ============================================

def save_shift_result_to_drive(result_df, year, month):
    """
    シフト結果をDriveに保存

    Args:
        result_df (pd.DataFrame): シフト結果データ
        year (int): 対象年
        month (int): 対象月

    Returns:
        str: 保存されたファイルのID
    """
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseUpload
    import io

    creds = authenticate_drive()
    service = build('drive', 'v3', credentials=creds)

    # CSV形式に変換
    csv_buffer = io.BytesIO()
    result_df.to_csv(csv_buffer, index=False, encoding='utf-8')
    csv_buffer.seek(0)

    # ファイル名
    file_name = f'シフト結果_{year}{str(month).zfill(2)}.csv'

    # 既存ファイルを削除
    query = f"name='{file_name}' and '{OUTPUT_FOLDER_ID}' in parents and trashed=false"
    results = service.files().list(q=query, fields='files(id)').execute()
    for file in results.get('files', []):
        service.files().delete(fileId=file['id']).execute()
        print(f'🗑️ 既存ファイル削除: {file_name}')

    # 新規ファイル作成
    file_metadata = {
        'name': file_name,
        'parents': [OUTPUT_FOLDER_ID],
        'mimeType': 'text/csv'
    }

    media = MediaIoBaseUpload(csv_buffer, mimetype='text/csv', resumable=True)

    file = service.files().create(
        body=file_metadata,
        media_body=media,
        fields='id'
    ).execute()

    file_id = file.get('id')

    print(f'✅ {file_name} をDriveに保存しました (ID: {file_id})')
    return file_id


# ============================================
# GAS Webhook通知
# ============================================

def notify_gas_webhook(file_id, year, month):
    """
    GASにWebhookを送信してシフト結果を取り込ませる

    Args:
        file_id (str): DriveファイルID
        year (int): 対象年
        month (int): 対象月

    Returns:
        dict: レスポンス
    """
    payload = {
        'action': 'importShiftResult',
        'token': WEBHOOK_TOKEN,
        'fileId': file_id,
        'year': year,
        'month': month
    }

    print('📡 GASにWebhook送信中...')

    response = requests.post(GAS_WEBHOOK_URL, json=payload)

    if response.status_code == 200:
        result = response.json()
        if result.get('success'):
            print(f'✅ Webhook送信成功: {result.get("message")}')
        else:
            print(f'❌ Webhook処理失敗: {result.get("message")}')
        return result
    else:
        print(f'❌ HTTP Error {response.status_code}: {response.text}')
        return {'success': False, 'message': f'HTTP Error {response.status_code}'}


# ============================================
# メイン処理
# ============================================

def main(year, month):
    """
    メイン処理フロー

    Args:
        year (int): 対象年
        month (int): 対象月
    """
    print(f'\n{"="*60}')
    print(f'シフト計算開始: {year}年{month}月')
    print(f'{"="*60}\n')

    try:
        # 1. CSV読込
        print('[1/4] CSV読込')
        holiday_requests_df = load_holiday_requests_from_drive(year, month)

        # 2. シフト計算
        print('\n[2/4] シフト計算')
        result_df = calculate_shift(holiday_requests_df, year, month)

        # 3. CSV保存
        print('\n[3/4] CSV保存')
        file_id = save_shift_result_to_drive(result_df, year, month)

        # 4. Webhook通知
        print('\n[4/4] Webhook通知')
        webhook_result = notify_gas_webhook(file_id, year, month)

        print(f'\n{"="*60}')
        if webhook_result.get('success'):
            print('✅ すべての処理が完了しました！')
            print(f'\n次のステップ:')
            print(f'1. スプレッドシートの「シフト作業用」シートを確認')
            print(f'2. 必要に応じて手修正')
            print(f'3. ルールチェックを実行')
            print(f'4. シフト登録でカレンダーに反映')
        else:
            print('❌ 処理中にエラーが発生しました')
        print(f'{"="*60}\n')

    except Exception as e:
        print(f'\n❌ エラー: {e}')
        import traceback
        traceback.print_exc()


# ============================================
# 実行例
# ============================================

if __name__ == '__main__':
    # 対象年月を指定
    TARGET_YEAR = 2025
    TARGET_MONTH = 1

    main(TARGET_YEAR, TARGET_MONTH)
