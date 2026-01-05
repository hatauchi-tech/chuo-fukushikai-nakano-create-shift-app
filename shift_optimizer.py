"""
シフト最適化システム（Google Colab版）v2.0

制約条件:
- 休み希望の優先順位: 第1希望から順に優先的に割り当て
- 月間公休日数: 設定された日数を厳守
- 連勤制限: 連続5日まで（6連勤以上は不可）
- 月間勤務日数上限: 21日以内（夜勤は2日分換算）
- インターバル: 遅出→翌日早出は禁止
- 夜勤明けルール: 夜勤→休→休（翌日・翌々日は休み必須）
- 資格者配置: 全日に喀痰吸引資格者を最低1名配置
- グループ別最低人数: 早出2名、日勤1名（日曜0可）、遅出1名、夜勤1名
- 勤務配慮ありのスタッフは夜勤免除
"""

# ============================================
# 設定（フォーム入力）
# ============================================

#@title 📅 シフト計算設定
#@markdown ### 対象年月を入力してください
TARGET_YEAR = 2025  #@param {type:"integer"}
TARGET_MONTH = 12   #@param {type:"integer"}

#@markdown ---
#@markdown ### Google Drive フォルダID
INPUT_FOLDER_ID = '1yUWaYiWftiAyy-IjoWyMxhkEAYDE8puR'  #@param {type:"string"}
OUTPUT_FOLDER_ID = '1Gxo0-sE1HjVD7q97LFRwAhPa7hHhvJfd'  #@param {type:"string"}

#@markdown ---
#@markdown ### GAS Webhook設定
GAS_WEBHOOK_URL = ''  #@param {type:"string"}
WEBHOOK_TOKEN = ''  #@param {type:"string"}

# ============================================
# ライブラリインストール・インポート
# ============================================

# !pip install -q ortools pandas

import pandas as pd
import numpy as np
import calendar
import requests
import io
from datetime import datetime, timedelta
from ortools.sat.python import cp_model
from google.colab import auth
from google.auth import default
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload

# ============================================
# 定数定義
# ============================================

# シフト種類
SHIFT_TYPES = ['早出', '日勤', '遅出', '夜勤', '休み']
SHIFT_EARLY = 0   # 早出
SHIFT_DAY = 1     # 日勤
SHIFT_LATE = 2    # 遅出
SHIFT_NIGHT = 3   # 夜勤
SHIFT_REST = 4    # 休み

# シフト時間情報
SHIFT_INFO = {
    '早出': {'開始時間': '07:00', '終了時間': '16:00'},
    '日勤': {'開始時間': '09:00', '終了時間': '18:00'},
    '遅出': {'開始時間': '11:00', '終了時間': '20:00'},
    '夜勤': {'開始時間': '17:00', '終了時間': '10:00'},  # 翌日終了
    '休み': {'開始時間': '', '終了時間': ''}
}

# ============================================
# Google Drive認証
# ============================================

def authenticate_drive():
    """Google Drive認証"""
    auth.authenticate_user()
    creds, _ = default()
    return creds

# ============================================
# CSV読み込み
# ============================================

def load_csv_from_drive(file_name, folder_id):
    """DriveからCSVを読み込む"""
    creds = authenticate_drive()
    service = build('drive', 'v3', credentials=creds)

    query = f"name='{file_name}' and '{folder_id}' in parents and trashed=false"
    results = service.files().list(q=query, fields='files(id, name)').execute()
    files = results.get('files', [])

    if not files:
        raise FileNotFoundError(f'{file_name} が見つかりません')

    file_id = files[0]['id']
    request = service.files().get_media(fileId=file_id)
    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)

    done = False
    while not done:
        status, done = downloader.next_chunk()

    fh.seek(0)
    df = pd.read_csv(fh)

    print(f'✅ {file_name} を読み込みました ({len(df)}件)')
    return df


def load_all_input_data(year, month):
    """すべての入力データを読み込む"""
    year_month = f'{year}{str(month).zfill(2)}'

    holiday_df = load_csv_from_drive(f'T_休み希望_{year_month}.csv', INPUT_FOLDER_ID)
    staff_df = load_csv_from_drive(f'M_職員_{year_month}.csv', INPUT_FOLDER_ID)
    settings_df = load_csv_from_drive(f'M_設定_{year_month}.csv', INPUT_FOLDER_ID)

    return holiday_df, staff_df, settings_df


def get_setting(settings_df, setting_id, default_value=None):
    """設定値を取得"""
    row = settings_df[settings_df['設定ID'] == setting_id]
    if len(row) > 0:
        return row.iloc[0]['設定値']
    return default_value


# ============================================
# シフト最適化（OR-Tools CP-SAT）
# ============================================

def optimize_shift(holiday_df, staff_df, settings_df, year, month):
    """
    OR-Toolsを使用してシフト最適化を実行

    全制約条件:
    1. 休み希望の優先順位
    2. 連勤制限（5日まで）
    3. 所定勤務日数（夜勤2日換算）
    4. インターバル（遅出→早出禁止）
    5. 夜勤明けルール（夜勤→休→休）
    6. 勤務配慮者は夜勤免除
    7. グループ別最低人数
    8. 喀痰吸引資格者配置

    ※公休日数は制約せず、所定勤務日数（夜勤2日換算）で管理
    """
    print('⚙️ シフト最適化を実行中...')

    # 月の日数
    days_in_month = calendar.monthrange(year, month)[1]
    dates = [datetime(year, month, d) for d in range(1, days_in_month + 1)]

    # 有効な職員のみ
    active_staff = staff_df[staff_df['有効'] == True].copy()
    staff_names = active_staff['氏名'].tolist()
    num_staff = len(staff_names)
    num_days = days_in_month
    num_shifts = len(SHIFT_TYPES)

    print(f'  職員数: {num_staff}名')
    print(f'  日数: {num_days}日')

    # 設定値取得
    # 月別公休日数: MONTHLY_HOLIDAYS_YYYYMM 形式
    year_month_key = f'MONTHLY_HOLIDAYS_{year}{str(month).zfill(2)}'
    monthly_holidays = int(get_setting(settings_df, year_month_key, 9))

    # 所定勤務日数 = 月の日数 - 公休日数
    scheduled_work_days = days_in_month - monthly_holidays

    max_consecutive_work = int(get_setting(settings_df, 'MAX_CONSECUTIVE_WORK_DAYS', 5))

    print(f'  月間公休日数: {monthly_holidays}日（設定ID: {year_month_key}）')
    print(f'  所定勤務日数: {scheduled_work_days}日（夜勤2日換算）')
    print(f'  最大連勤: {max_consecutive_work}日')

    # 職員属性を取得
    staff_has_care = {}  # 勤務配慮あり
    staff_has_suction = {}  # 喀痰吸引資格
    staff_groups = {}  # グループ

    for i, name in enumerate(staff_names):
        staff_info = active_staff[active_staff['氏名'] == name].iloc[0]
        staff_groups[i] = staff_info['グループ']

        # 勤務配慮（夜勤免除）
        care_value = staff_info.get('勤務配慮', '')
        staff_has_care[i] = (care_value == True or care_value == 'TRUE' or care_value == '有' or care_value == 'あり')

        # 喀痰吸引資格者
        suction_value = staff_info.get('喀痰吸引資格者', '')
        staff_has_suction[i] = (suction_value == True or suction_value == 'TRUE' or suction_value == '有' or suction_value == 'あり')

    # 日曜日判定
    sundays = set()
    for d in range(num_days):
        if dates[d].weekday() == 6:  # 日曜
            sundays.add(d)

    # グループ一覧
    groups = active_staff['グループ'].unique()

    # ============================================
    # CP-SATモデル構築
    # ============================================
    model = cp_model.CpModel()

    # 変数: shifts[s, d, t] = 1 if スタッフsが日dにシフトtを担当
    shifts = {}
    for s in range(num_staff):
        for d in range(num_days):
            for t in range(num_shifts):
                shifts[(s, d, t)] = model.NewBoolVar(f'shift_s{s}_d{d}_t{t}')

    # ============================================
    # 基本制約: 各スタッフは各日に1つのシフトのみ
    # ============================================
    for s in range(num_staff):
        for d in range(num_days):
            model.AddExactlyOne(shifts[(s, d, t)] for t in range(num_shifts))

    # ============================================
    # 制約1: 休み希望（優先順位1は必須、2以降はソフト制約）
    # ============================================
    priority1_constraints = []
    soft_holiday_penalties = []

    for _, row in holiday_df.iterrows():
        staff_name = row['氏名']
        if staff_name not in staff_names:
            continue

        s = staff_names.index(staff_name)
        request_date = pd.to_datetime(row['日付']).date()

        if request_date.year == year and request_date.month == month:
            d = request_date.day - 1
            priority = int(row['優先順位'])

            if priority == 1:
                # 優先順位1は必ず休み（ハード制約）
                model.Add(shifts[(s, d, SHIFT_REST)] == 1)
            else:
                # 優先順位2以降はソフト制約
                # 優先順位が低い（数字が大きい）ほどペナルティ小
                weight = max(1, 20 - priority * 3)
                # 休みでない場合にペナルティ
                not_rest = model.NewBoolVar(f'not_rest_s{s}_d{d}')
                model.Add(shifts[(s, d, SHIFT_REST)] == 0).OnlyEnforceIf(not_rest)
                model.Add(shifts[(s, d, SHIFT_REST)] == 1).OnlyEnforceIf(not_rest.Not())
                soft_holiday_penalties.append(not_rest * weight)

    # ============================================
    # 制約2: 連勤制限（5日まで、6連勤禁止）
    # ============================================
    for s in range(num_staff):
        for d in range(num_days - max_consecutive_work):
            # max_consecutive_work + 1 日連続で勤務（休み以外）することを禁止
            work_vars = []
            for i in range(max_consecutive_work + 1):
                is_working = model.NewBoolVar(f'working_s{s}_d{d+i}')
                model.Add(shifts[(s, d + i, SHIFT_REST)] == 0).OnlyEnforceIf(is_working)
                model.Add(shifts[(s, d + i, SHIFT_REST)] == 1).OnlyEnforceIf(is_working.Not())
                work_vars.append(is_working)
            # 6日連続勤務を禁止
            model.Add(sum(work_vars) <= max_consecutive_work)

    # ============================================
    # 制約3: 所定勤務日数（夜勤2日換算）
    # 早出・日勤・遅出は1日、夜勤は2日として換算
    # ※公休日数は制約せず、所定勤務日数のみで管理
    # ============================================
    for s in range(num_staff):
        # 通常勤務（早出、日勤、遅出）は1日換算
        work_days_count = sum(
            shifts[(s, d, t)]
            for d in range(num_days)
            for t in [SHIFT_EARLY, SHIFT_DAY, SHIFT_LATE]
        )
        # 夜勤は2日換算
        work_days_count += sum(shifts[(s, d, SHIFT_NIGHT)] for d in range(num_days)) * 2
        # 所定勤務日数を厳守（夜勤2日換算）
        model.Add(work_days_count == scheduled_work_days)

    # ============================================
    # 制約5: インターバル（遅出→翌日早出は禁止）
    # ============================================
    for s in range(num_staff):
        for d in range(num_days - 1):
            # 遅出の翌日に早出を禁止
            model.AddImplication(
                shifts[(s, d, SHIFT_LATE)],
                shifts[(s, d + 1, SHIFT_EARLY)].Not()
            )

    # ============================================
    # 制約6: 夜勤明けルール（夜勤→休→休）
    # ============================================
    for s in range(num_staff):
        for d in range(num_days):
            if d + 1 < num_days:
                # 夜勤の翌日は休み必須
                model.AddImplication(
                    shifts[(s, d, SHIFT_NIGHT)],
                    shifts[(s, d + 1, SHIFT_REST)]
                )
            if d + 2 < num_days:
                # 夜勤の翌々日も休み必須
                model.AddImplication(
                    shifts[(s, d, SHIFT_NIGHT)],
                    shifts[(s, d + 2, SHIFT_REST)]
                )

    # ============================================
    # 制約7: 勤務配慮者は夜勤免除
    # ============================================
    for s in range(num_staff):
        if staff_has_care[s]:
            for d in range(num_days):
                model.Add(shifts[(s, d, SHIFT_NIGHT)] == 0)

    # ============================================
    # 制約8: グループ別最低人数
    # ============================================
    for group in groups:
        group_staff_indices = [
            i for i, name in enumerate(staff_names)
            if staff_groups[i] == group
        ]

        for d in range(num_days):
            # 早出: 2名以上
            model.Add(
                sum(shifts[(s, d, SHIFT_EARLY)] for s in group_staff_indices) >= 2
            )

            # 日勤: 1名以上（日曜は0名OK）
            if d in sundays:
                model.Add(
                    sum(shifts[(s, d, SHIFT_DAY)] for s in group_staff_indices) >= 0
                )
            else:
                model.Add(
                    sum(shifts[(s, d, SHIFT_DAY)] for s in group_staff_indices) >= 1
                )

            # 遅出: 1名以上
            model.Add(
                sum(shifts[(s, d, SHIFT_LATE)] for s in group_staff_indices) >= 1
            )

            # 夜勤: 1名以上
            model.Add(
                sum(shifts[(s, d, SHIFT_NIGHT)] for s in group_staff_indices) >= 1
            )

    # ============================================
    # 制約9: 喀痰吸引資格者を全日最低1名配置
    # ============================================
    suction_staff_indices = [i for i in range(num_staff) if staff_has_suction[i]]

    if len(suction_staff_indices) > 0:
        for d in range(num_days):
            # 資格者が少なくとも1人勤務（休み以外）
            model.Add(
                sum(
                    shifts[(s, d, t)]
                    for s in suction_staff_indices
                    for t in [SHIFT_EARLY, SHIFT_DAY, SHIFT_LATE, SHIFT_NIGHT]
                ) >= 1
            )
    else:
        print('  ⚠️ 喀痰吸引資格者がいません')

    # ============================================
    # 目的関数
    # ============================================
    objective_terms = []

    # ソフト制約: 休み希望違反ペナルティ
    objective_terms.extend(soft_holiday_penalties)

    # 公平性: 夜勤回数の分散を最小化
    night_counts = []
    for s in range(num_staff):
        if not staff_has_care[s]:  # 夜勤可能な人のみ
            night_count = sum(shifts[(s, d, SHIFT_NIGHT)] for d in range(num_days))
            night_counts.append(night_count)

    # 夜勤回数の最大・最小の差を最小化
    if night_counts:
        max_nights = model.NewIntVar(0, num_days, 'max_nights')
        min_nights = model.NewIntVar(0, num_days, 'min_nights')
        model.AddMaxEquality(max_nights, night_counts)
        model.AddMinEquality(min_nights, night_counts)
        night_diff = model.NewIntVar(0, num_days, 'night_diff')
        model.Add(night_diff == max_nights - min_nights)
        objective_terms.append(night_diff * 10)

    # 目的関数を設定
    if objective_terms:
        model.Minimize(sum(objective_terms))

    # ============================================
    # 求解
    # ============================================
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 120.0
    solver.parameters.num_search_workers = 4

    print('  ソルバー実行中...')
    status = solver.Solve(model)

    if status == cp_model.OPTIMAL:
        print(f'  ✅ 最適解が見つかりました')
    elif status == cp_model.FEASIBLE:
        print(f'  ⚠️ 実行可能解が見つかりました（最適解ではない可能性）')
    else:
        status_name = {
            cp_model.UNKNOWN: 'UNKNOWN',
            cp_model.MODEL_INVALID: 'MODEL_INVALID',
            cp_model.INFEASIBLE: 'INFEASIBLE',
        }.get(status, str(status))
        raise Exception(f'最適化に失敗しました (status: {status_name})')

    # ============================================
    # 結果をDataFrameに変換
    # ============================================
    results = []

    for s, staff_name in enumerate(staff_names):
        staff_info = active_staff[active_staff['氏名'] == staff_name].iloc[0]
        group = staff_info['グループ']

        for d in range(num_days):
            date = dates[d]

            # どのシフトが割り当てられたか
            assigned_shift = None
            for t in range(num_shifts):
                if solver.Value(shifts[(s, d, t)]) == 1:
                    assigned_shift = SHIFT_TYPES[t]
                    break

            if assigned_shift is None:
                assigned_shift = '休み'

            shift_info = SHIFT_INFO.get(assigned_shift, {'開始時間': '', '終了時間': ''})

            # 終了日を計算（夜勤の場合は翌日）
            end_date = date
            if assigned_shift == '夜勤' and shift_info['終了時間']:
                end_date = date + timedelta(days=1)

            results.append({
                '確定シフトID': '',
                '氏名': staff_name,
                'グループ': group,
                'シフト名': assigned_shift,
                '勤務開始日': date.strftime('%Y-%m-%d'),
                '開始時間': shift_info['開始時間'],
                '勤務終了日': end_date.strftime('%Y-%m-%d'),
                '終了時間': shift_info['終了時間'],
                '登録日時': '',
                'カレンダーイベントID': ''
            })

    result_df = pd.DataFrame(results)

    # ============================================
    # 統計出力
    # ============================================
    print(f'\n📊 最適化結果統計:')
    print(f'  総レコード数: {len(result_df)}')

    for shift_type in SHIFT_TYPES:
        count = len(result_df[result_df['シフト名'] == shift_type])
        print(f'  {shift_type}: {count}件')

    # 制約充足確認
    print(f'\n✅ 制約充足確認:')

    # 所定勤務日数確認（夜勤2日換算）
    print(f'\n📊 所定勤務日数確認（夜勤2日換算、目標{scheduled_work_days}日）:')
    for s, name in enumerate(staff_names):
        staff_shifts = result_df[result_df['氏名'] == name]
        normal_count = len(staff_shifts[staff_shifts['シフト名'].isin(['早出', '日勤', '遅出'])])
        night_count = len(staff_shifts[staff_shifts['シフト名'] == '夜勤'])
        rest_count = len(staff_shifts[staff_shifts['シフト名'] == '休み'])
        work_value = normal_count + night_count * 2  # 夜勤2日換算
        calendar_work = normal_count + night_count  # 暦日ベース
        if work_value != scheduled_work_days:
            print(f'  ⚠️ {name}: {work_value}日（通常{normal_count} + 夜勤{night_count}×2）, 暦日{calendar_work}日, 休み{rest_count}日')
        else:
            print(f'  ✅ {name}: {work_value}日（通常{normal_count} + 夜勤{night_count}×2）, 暦日{calendar_work}日, 休み{rest_count}日')

    # 夜勤配分確認
    print(f'\n🌙 夜勤配分:')
    for s, name in enumerate(staff_names):
        if not staff_has_care[s]:
            staff_shifts = result_df[result_df['氏名'] == name]
            night_count = len(staff_shifts[staff_shifts['シフト名'] == '夜勤'])
            print(f'  {name}: {night_count}回')

    return result_df


# ============================================
# CSV保存
# ============================================

def save_result_to_drive(result_df, year, month):
    """シフト結果をDriveに保存"""
    creds = authenticate_drive()
    service = build('drive', 'v3', credentials=creds)

    csv_buffer = io.BytesIO()
    result_df.to_csv(csv_buffer, index=False, encoding='utf-8')
    csv_buffer.seek(0)

    year_month = f'{year}{str(month).zfill(2)}'
    file_name = f'シフト結果_{year_month}.csv'

    # 既存ファイル削除
    query = f"name='{file_name}' and '{OUTPUT_FOLDER_ID}' in parents and trashed=false"
    results = service.files().list(q=query, fields='files(id)').execute()
    for file in results.get('files', []):
        service.files().delete(fileId=file['id']).execute()
        print(f'🗑️ 既存ファイル削除: {file_name}')

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
    """GASにWebhookを送信"""
    if not GAS_WEBHOOK_URL or GAS_WEBHOOK_URL == '':
        print('⚠️ GAS_WEBHOOK_URLが未設定のためWebhook送信をスキップ')
        return {'success': True, 'message': 'Webhook送信スキップ'}

    payload = {
        'action': 'importShiftResult',
        'token': WEBHOOK_TOKEN,
        'fileId': file_id,
        'year': year,
        'month': month
    }

    print('📡 GASにWebhook送信中...')

    try:
        response = requests.post(GAS_WEBHOOK_URL, json=payload, timeout=30)

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
    except Exception as e:
        print(f'❌ Webhook送信エラー: {e}')
        return {'success': False, 'message': str(e)}


# ============================================
# メイン処理
# ============================================

def main():
    """メイン処理"""
    print(f'\n{"="*60}')
    print(f'🗓️ シフト計算開始: {TARGET_YEAR}年{TARGET_MONTH}月')
    print(f'{"="*60}\n')

    try:
        # 1. CSV読込
        print('[1/4] CSV読込')
        holiday_df, staff_df, settings_df = load_all_input_data(TARGET_YEAR, TARGET_MONTH)

        # 2. シフト最適化
        print('\n[2/4] シフト最適化')
        result_df = optimize_shift(holiday_df, staff_df, settings_df, TARGET_YEAR, TARGET_MONTH)

        # 3. 結果プレビュー
        print('\n📊 結果プレビュー（最初の20件）:')
        print(result_df.head(20))

        # 4. CSV保存
        print('\n[3/4] CSV保存')
        file_id = save_result_to_drive(result_df, TARGET_YEAR, TARGET_MONTH)

        # 5. Webhook通知
        print('\n[4/4] Webhook通知')
        webhook_result = notify_gas_webhook(file_id, TARGET_YEAR, TARGET_MONTH)

        print(f'\n{"="*60}')
        if webhook_result.get('success'):
            print('✅ すべての処理が完了しました！')
            print(f'\n📋 次のステップ:')
            print(f'  1. GASアプリの「シフト修正」画面を開く')
            print(f'  2. 対象月とグループを選択して「表示」')
            print(f'  3. 必要に応じてシフトを修正')
            print(f'  4. 「確定してカレンダー登録」ボタンをクリック')
        else:
            print('⚠️ Webhookは失敗しましたが、CSVはDriveに保存されています')
            print('GASアプリから手動でCSVを取り込んでください')
        print(f'{"="*60}\n')

        return result_df

    except Exception as e:
        print(f'\n❌ エラー: {e}')
        import traceback
        traceback.print_exc()
        return None


# ============================================
# 実行
# ============================================

if __name__ == '__main__':
    result = main()
