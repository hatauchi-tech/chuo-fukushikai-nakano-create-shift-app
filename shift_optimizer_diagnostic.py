"""
シフト最適化システム（診断機能付き）v2.1

特徴:
- INFEASIBLE時に原因分析と対策を出力
- グループごとの診断実行
- 部分的な結果出力（成功したグループのみ）
- 制約緩和モードによる緊急対応

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

#@markdown ---
#@markdown ### 診断モード設定
ENABLE_PARTIAL_OUTPUT = True  #@param {type:"boolean"}
RELAXED_MODE = False  #@param {type:"boolean"}

# ============================================
# ライブラリインストール・インポート
# ============================================

# Google Colabで必要なライブラリをインストール
import subprocess
import sys

def install_packages():
    """必要なパッケージをインストール"""
    packages = ['ortools', 'pandas']
    for package in packages:
        try:
            __import__(package.replace('-', '_'))
        except ImportError:
            print(f'📦 {package} をインストール中...')
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', package])

install_packages()

import pandas as pd
import numpy as np
import calendar
import requests
import io
import json
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

# 最低必要人数（グループごと）
MIN_STAFF_REQUIREMENTS = {
    '早出': 2,
    '日勤': 1,  # 日曜は0
    '遅出': 1,
    '夜勤': 1
}

# ============================================
# 診断結果クラス
# ============================================

class DiagnosticResult:
    """診断結果を格納するクラス"""

    def __init__(self):
        self.errors = []  # エラー一覧
        self.warnings = []  # 警告一覧
        self.group_results = {}  # グループ別結果
        self.staff_issues = []  # 職員別問題
        self.suggestions = []  # 改善提案
        self.partial_results = None  # 部分的な結果

    def add_error(self, category, message, details=None):
        self.errors.append({
            'category': category,
            'message': message,
            'details': details
        })

    def add_warning(self, category, message, details=None):
        self.warnings.append({
            'category': category,
            'message': message,
            'details': details
        })

    def add_suggestion(self, suggestion):
        self.suggestions.append(suggestion)

    def to_dict(self):
        return {
            'errors': self.errors,
            'warnings': self.warnings,
            'group_results': self.group_results,
            'staff_issues': self.staff_issues,
            'suggestions': self.suggestions
        }

    def print_report(self):
        """診断レポートを出力"""
        print('\n' + '='*60)
        print('📋 診断レポート')
        print('='*60)

        # エラー
        if self.errors:
            print('\n❌ エラー一覧:')
            for i, err in enumerate(self.errors, 1):
                print(f'  {i}. [{err["category"]}] {err["message"]}')
                if err.get('details'):
                    print(f'     詳細: {err["details"]}')
        else:
            print('\n✅ エラーなし')

        # 警告
        if self.warnings:
            print('\n⚠️ 警告一覧:')
            for i, warn in enumerate(self.warnings, 1):
                print(f'  {i}. [{warn["category"]}] {warn["message"]}')
                if warn.get('details'):
                    print(f'     詳細: {warn["details"]}')

        # グループ別結果
        if self.group_results:
            print('\n📊 グループ別診断結果:')
            for group, result in sorted(self.group_results.items()):
                status = '✅' if result.get('success') else '❌'
                print(f'  グループ{group}: {status} {result.get("message", "")}')
                if result.get('details'):
                    for key, val in result['details'].items():
                        print(f'    - {key}: {val}')

        # 職員別問題
        if self.staff_issues:
            print('\n👤 職員別の問題:')
            for issue in self.staff_issues:
                print(f'  - {issue["name"]}: {issue["issue"]}')

        # 改善提案
        if self.suggestions:
            print('\n💡 改善提案:')
            for i, suggestion in enumerate(self.suggestions, 1):
                print(f'  {i}. {suggestion}')

        print('\n' + '='*60)


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
# 事前診断（Pre-flight Check）
# ============================================

def preflight_check(holiday_df, staff_df, settings_df, year, month):
    """
    最適化実行前の診断チェック
    制約が満たせるかを事前に検証
    """
    print('\n🔍 事前診断を実行中...')

    diagnostic = DiagnosticResult()

    days_in_month = calendar.monthrange(year, month)[1]
    dates = [datetime(year, month, d) for d in range(1, days_in_month + 1)]

    # 有効な職員のみ
    active_staff = staff_df[staff_df['有効'] == True].copy()

    # 設定値取得
    year_month_key = f'MONTHLY_HOLIDAYS_{year}{str(month).zfill(2)}'
    monthly_holidays = int(get_setting(settings_df, year_month_key, 9))
    scheduled_work_days = days_in_month - monthly_holidays

    # 日曜日をカウント
    sundays = sum(1 for d in dates if d.weekday() == 6)

    # グループ一覧
    groups = active_staff['グループ'].unique()

    print(f'  対象月: {year}年{month}月（{days_in_month}日間、日曜{sundays}日）')
    print(f'  総職員数: {len(active_staff)}名')
    print(f'  グループ数: {len(groups)}')
    print(f'  月間公休日数: {monthly_holidays}日')
    print(f'  所定勤務日数: {scheduled_work_days}日（夜勤2日換算）')

    # ============================================
    # グループごとの診断
    # ============================================

    for group in sorted(groups):
        group_staff = active_staff[active_staff['グループ'] == group]
        group_size = len(group_staff)

        # 勤務配慮者（夜勤不可）をカウント
        care_staff = group_staff[
            (group_staff['勤務配慮'] == True) |
            (group_staff['勤務配慮'] == 'TRUE') |
            (group_staff['勤務配慮'] == '有') |
            (group_staff['勤務配慮'] == 'あり')
        ]
        night_capable = group_size - len(care_staff)

        # 喀痰吸引資格者をカウント
        suction_staff = group_staff[
            (group_staff['喀痰吸引資格者'] == True) |
            (group_staff['喀痰吸引資格者'] == 'TRUE') |
            (group_staff['喀痰吸引資格者'] == '有') |
            (group_staff['喀痰吸引資格者'] == 'あり')
        ]

        result = {
            'success': True,
            'message': '',
            'details': {
                '人数': group_size,
                '夜勤可能者': night_capable,
                '喀痰吸引資格者': len(suction_staff)
            }
        }

        # ============================================
        # チェック1: 最低人数確認
        # ============================================
        min_daily_staff = MIN_STAFF_REQUIREMENTS['早出'] + \
                          MIN_STAFF_REQUIREMENTS['日勤'] + \
                          MIN_STAFF_REQUIREMENTS['遅出'] + \
                          MIN_STAFF_REQUIREMENTS['夜勤']  # = 5

        if group_size < min_daily_staff:
            result['success'] = False
            result['message'] = f'人数不足（{group_size}名 < 最低{min_daily_staff}名）'
            diagnostic.add_error(
                'グループ人数',
                f'グループ{group}は最低{min_daily_staff}名必要ですが、{group_size}名しかいません',
                f'早出2+日勤1+遅出1+夜勤1={min_daily_staff}名/日が必要'
            )
            diagnostic.add_suggestion(f'グループ{group}に{min_daily_staff - group_size}名以上の増員が必要')

        # ============================================
        # チェック2: 夜勤可能者の確認
        # ============================================
        required_night_shifts = days_in_month  # 毎日1名必要

        # 夜勤1回で3日拘束（夜勤日+休み2日）
        # 1人あたり最大夜勤回数 = (31 - 公休10) / 3 ≈ 7回（理論最大）
        max_nights_per_person = (days_in_month - monthly_holidays) // 3

        if night_capable == 0:
            result['success'] = False
            result['message'] = '夜勤可能者が0名'
            diagnostic.add_error(
                '夜勤配置',
                f'グループ{group}には夜勤可能な職員がいません',
                f'全員が勤務配慮（夜勤免除）になっています'
            )
            diagnostic.add_suggestion(f'グループ{group}に夜勤可能な職員を配置してください')
        elif night_capable * max_nights_per_person < required_night_shifts:
            result['success'] = False
            nights_shortage = required_night_shifts - (night_capable * max_nights_per_person)
            result['message'] = f'夜勤枠不足（{nights_shortage}回分）'
            diagnostic.add_error(
                '夜勤配置',
                f'グループ{group}の夜勤可能者{night_capable}名では{days_in_month}日分の夜勤をカバーできません',
                f'最大{night_capable * max_nights_per_person}回 < 必要{required_night_shifts}回'
            )
            diagnostic.add_suggestion(f'グループ{group}に夜勤可能者を{(required_night_shifts // max_nights_per_person) + 1 - night_capable}名追加してください')

        # ============================================
        # チェック3: 勤務枠の過不足確認
        # ============================================
        # 平日: 早出2+日勤1+遅出1+夜勤1 = 5枠
        # 日曜: 早出2+日勤0+遅出1+夜勤1 = 4枠
        weekdays = days_in_month - sundays
        required_slots = weekdays * 5 + sundays * 4

        # 各職員の勤務可能枠（所定勤務日数）
        # 夜勤2日換算を考慮した概算
        # 仮定: 夜勤可能者は平均4回夜勤、それ以外は通常勤務
        total_available_slots = 0
        for _, staff in group_staff.iterrows():
            is_care = staff.get('勤務配慮', '') in [True, 'TRUE', '有', 'あり']
            if is_care:
                # 夜勤不可 = 所定勤務日数がすべて通常勤務
                total_available_slots += scheduled_work_days
            else:
                # 夜勤可能 = 夜勤4回想定（4夜勤 + 17通常 = 21日換算）
                avg_nights = 4
                normal_days = scheduled_work_days - (avg_nights * 2)  # 21 - 8 = 13
                total_available_slots += normal_days + avg_nights

        result['details']['必要勤務枠'] = required_slots
        result['details']['供給可能枠'] = total_available_slots

        if total_available_slots < required_slots:
            shortage = required_slots - total_available_slots
            diagnostic.add_warning(
                '勤務枠',
                f'グループ{group}は勤務枠が不足する可能性があります',
                f'必要{required_slots}枠 > 供給可能{total_available_slots}枠（不足{shortage}枠）'
            )

        # ============================================
        # チェック4: 喀痰吸引資格者の確認
        # ============================================
        if len(suction_staff) == 0:
            diagnostic.add_warning(
                '資格者配置',
                f'グループ{group}には喀痰吸引資格者がいません',
                '全日に資格者を配置する制約が満たせない可能性があります'
            )

        # 結果を保存
        if result['success'] and not result['message']:
            result['message'] = 'OK'
        diagnostic.group_results[group] = result

    # ============================================
    # 職員別の休み希望チェック
    # ============================================
    for _, row in holiday_df.iterrows():
        staff_name = row['氏名']
        staff_info = active_staff[active_staff['氏名'] == staff_name]

        if len(staff_info) == 0:
            diagnostic.add_warning(
                '休み希望',
                f'休み希望を出した「{staff_name}」が職員マスタに存在しません',
                'この休み希望は無視されます'
            )

    # 休み希望の集中日チェック
    holiday_counts = holiday_df.groupby('日付').size()
    for date_str, count in holiday_counts.items():
        if count > len(active_staff) * 0.3:  # 30%以上が同日に休み希望
            diagnostic.add_warning(
                '休み希望集中',
                f'{date_str}に{count}名の休み希望が集中しています',
                '人員配置が困難になる可能性があります'
            )

    # 総合判定
    has_critical_error = any(
        not result.get('success', True)
        for result in diagnostic.group_results.values()
    )

    if has_critical_error:
        diagnostic.add_error(
            '総合判定',
            '制約を満たせないグループがあります',
            '部分出力モードで実行可能なグループのみ処理します'
        )

    return diagnostic


# ============================================
# グループ別最適化
# ============================================

def optimize_single_group(group, group_staff, holiday_df, settings_df, year, month, relaxed=False):
    """
    単一グループのシフト最適化

    Args:
        group: グループ番号
        group_staff: グループの職員DataFrame
        holiday_df: 休み希望DataFrame
        settings_df: 設定DataFrame
        year: 対象年
        month: 対象月
        relaxed: 制約緩和モード

    Returns:
        (success, result_df or error_message, diagnostic_info)
    """

    days_in_month = calendar.monthrange(year, month)[1]
    dates = [datetime(year, month, d) for d in range(1, days_in_month + 1)]

    staff_names = group_staff['氏名'].tolist()
    num_staff = len(staff_names)
    num_days = days_in_month
    num_shifts = len(SHIFT_TYPES)

    # 設定値取得
    year_month_key = f'MONTHLY_HOLIDAYS_{year}{str(month).zfill(2)}'
    monthly_holidays = int(get_setting(settings_df, year_month_key, 9))
    scheduled_work_days = days_in_month - monthly_holidays
    max_consecutive_work = int(get_setting(settings_df, 'MAX_CONSECUTIVE_WORK_DAYS', 5))

    # 職員属性を取得
    staff_has_care = {}
    staff_has_suction = {}

    for i, name in enumerate(staff_names):
        staff_info = group_staff[group_staff['氏名'] == name].iloc[0]

        care_value = staff_info.get('勤務配慮', '')
        staff_has_care[i] = (care_value == True or care_value == 'TRUE' or care_value == '有' or care_value == 'あり')

        suction_value = staff_info.get('喀痰吸引資格者', '')
        staff_has_suction[i] = (suction_value == True or suction_value == 'TRUE' or suction_value == '有' or suction_value == 'あり')

    # 日曜日判定
    sundays = set()
    for d in range(num_days):
        if dates[d].weekday() == 6:
            sundays.add(d)

    # ============================================
    # CP-SATモデル構築
    # ============================================
    model = cp_model.CpModel()

    # 変数
    shifts = {}
    for s in range(num_staff):
        for d in range(num_days):
            for t in range(num_shifts):
                shifts[(s, d, t)] = model.NewBoolVar(f'shift_s{s}_d{d}_t{t}')

    # 基本制約: 各スタッフは各日に1つのシフトのみ
    for s in range(num_staff):
        for d in range(num_days):
            model.AddExactlyOne(shifts[(s, d, t)] for t in range(num_shifts))

    # 制約1: 休み希望
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
                model.Add(shifts[(s, d, SHIFT_REST)] == 1)

    # 制約2: 連勤制限
    for s in range(num_staff):
        for d in range(num_days - max_consecutive_work):
            work_vars = []
            for i in range(max_consecutive_work + 1):
                is_working = model.NewBoolVar(f'working_s{s}_d{d+i}')
                model.Add(shifts[(s, d + i, SHIFT_REST)] == 0).OnlyEnforceIf(is_working)
                model.Add(shifts[(s, d + i, SHIFT_REST)] == 1).OnlyEnforceIf(is_working.Not())
                work_vars.append(is_working)
            model.Add(sum(work_vars) <= max_consecutive_work)

    # 制約3: 所定勤務日数（夜勤2日換算）
    for s in range(num_staff):
        work_days_count = sum(
            shifts[(s, d, t)]
            for d in range(num_days)
            for t in [SHIFT_EARLY, SHIFT_DAY, SHIFT_LATE]
        )
        work_days_count += sum(shifts[(s, d, SHIFT_NIGHT)] for d in range(num_days)) * 2

        if relaxed:
            # 緩和モード: ±2日の余裕
            model.Add(work_days_count >= scheduled_work_days - 2)
            model.Add(work_days_count <= scheduled_work_days + 2)
        else:
            model.Add(work_days_count == scheduled_work_days)

    # 制約4: インターバル（遅出→翌日早出は禁止）
    for s in range(num_staff):
        for d in range(num_days - 1):
            model.AddImplication(
                shifts[(s, d, SHIFT_LATE)],
                shifts[(s, d + 1, SHIFT_EARLY)].Not()
            )

    # 制約5: 夜勤明けルール（夜勤→休→休）
    for s in range(num_staff):
        for d in range(num_days):
            if d + 1 < num_days:
                model.AddImplication(
                    shifts[(s, d, SHIFT_NIGHT)],
                    shifts[(s, d + 1, SHIFT_REST)]
                )
            if d + 2 < num_days:
                model.AddImplication(
                    shifts[(s, d, SHIFT_NIGHT)],
                    shifts[(s, d + 2, SHIFT_REST)]
                )

    # 制約6: 勤務配慮者は夜勤免除
    for s in range(num_staff):
        if staff_has_care[s]:
            for d in range(num_days):
                model.Add(shifts[(s, d, SHIFT_NIGHT)] == 0)

    # 制約7: グループ別最低人数
    min_early = 1 if relaxed else MIN_STAFF_REQUIREMENTS['早出']
    min_day = 0 if relaxed else MIN_STAFF_REQUIREMENTS['日勤']
    min_late = 1 if relaxed else MIN_STAFF_REQUIREMENTS['遅出']
    min_night = 1 if relaxed else MIN_STAFF_REQUIREMENTS['夜勤']

    for d in range(num_days):
        model.Add(sum(shifts[(s, d, SHIFT_EARLY)] for s in range(num_staff)) >= min_early)

        if d in sundays:
            model.Add(sum(shifts[(s, d, SHIFT_DAY)] for s in range(num_staff)) >= 0)
        else:
            model.Add(sum(shifts[(s, d, SHIFT_DAY)] for s in range(num_staff)) >= min_day)

        model.Add(sum(shifts[(s, d, SHIFT_LATE)] for s in range(num_staff)) >= min_late)
        model.Add(sum(shifts[(s, d, SHIFT_NIGHT)] for s in range(num_staff)) >= min_night)

    # 制約8: 喀痰吸引資格者配置（緩和モードでは省略可）
    if not relaxed:
        suction_staff_indices = [i for i in range(num_staff) if staff_has_suction[i]]
        if len(suction_staff_indices) > 0:
            for d in range(num_days):
                model.Add(
                    sum(
                        shifts[(s, d, t)]
                        for s in suction_staff_indices
                        for t in [SHIFT_EARLY, SHIFT_DAY, SHIFT_LATE, SHIFT_NIGHT]
                    ) >= 1
                )

    # 目的関数（夜勤回数の公平性）
    night_counts = []
    for s in range(num_staff):
        if not staff_has_care[s]:
            night_count = sum(shifts[(s, d, SHIFT_NIGHT)] for d in range(num_days))
            night_counts.append(night_count)

    if night_counts:
        max_nights = model.NewIntVar(0, num_days, 'max_nights')
        min_nights = model.NewIntVar(0, num_days, 'min_nights')
        model.AddMaxEquality(max_nights, night_counts)
        model.AddMinEquality(min_nights, night_counts)
        night_diff = model.NewIntVar(0, num_days, 'night_diff')
        model.Add(night_diff == max_nights - min_nights)
        model.Minimize(night_diff * 10)

    # ============================================
    # 求解
    # ============================================
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 60.0
    solver.parameters.num_search_workers = 4

    status = solver.Solve(model)

    diagnostic_info = {
        'status': status,
        'staff_count': num_staff,
        'night_capable': sum(1 for i in range(num_staff) if not staff_has_care[i]),
        'suction_qualified': sum(1 for i in range(num_staff) if staff_has_suction[i])
    }

    if status not in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
        status_name = {
            cp_model.UNKNOWN: 'UNKNOWN',
            cp_model.MODEL_INVALID: 'MODEL_INVALID',
            cp_model.INFEASIBLE: 'INFEASIBLE',
        }.get(status, str(status))
        return (False, f'最適化失敗 (status: {status_name})', diagnostic_info)

    # 結果をDataFrameに変換
    results = []
    for s, staff_name in enumerate(staff_names):
        staff_info = group_staff[group_staff['氏名'] == staff_name].iloc[0]

        for d in range(num_days):
            date = dates[d]
            assigned_shift = None
            for t in range(num_shifts):
                if solver.Value(shifts[(s, d, t)]) == 1:
                    assigned_shift = SHIFT_TYPES[t]
                    break

            if assigned_shift is None:
                assigned_shift = '休み'

            shift_info = SHIFT_INFO.get(assigned_shift, {'開始時間': '', '終了時間': ''})

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
    return (True, result_df, diagnostic_info)


def optimize_shift_with_diagnostics(holiday_df, staff_df, settings_df, year, month, partial_output=True, relaxed=False):
    """
    診断機能付きシフト最適化

    Args:
        holiday_df: 休み希望DataFrame
        staff_df: 職員DataFrame
        settings_df: 設定DataFrame
        year: 対象年
        month: 対象月
        partial_output: 部分出力を有効にするか
        relaxed: 制約緩和モード

    Returns:
        (result_df, diagnostic_result)
    """
    print('\n⚙️ シフト最適化を実行中（診断機能付き）...')

    # 事前診断
    diagnostic = preflight_check(holiday_df, staff_df, settings_df, year, month)

    if diagnostic.errors:
        print('\n⚠️ 事前診断でエラーが検出されました')
        if not partial_output:
            diagnostic.print_report()
            return (None, diagnostic)
        print('  部分出力モードで続行します...')

    # 有効な職員のみ
    active_staff = staff_df[staff_df['有効'] == True].copy()
    groups = sorted(active_staff['グループ'].unique())

    all_results = []
    success_groups = []
    failed_groups = []

    # グループごとに最適化
    for group in groups:
        print(f'\n  グループ{group}を処理中...')

        group_staff = active_staff[active_staff['グループ'] == group]

        # グループの休み希望のみ抽出
        group_staff_names = group_staff['氏名'].tolist()
        group_holiday = holiday_df[holiday_df['氏名'].isin(group_staff_names)]

        success, result, info = optimize_single_group(
            group, group_staff, group_holiday, settings_df, year, month, relaxed
        )

        if success:
            print(f'    ✅ グループ{group}: 成功')
            all_results.append(result)
            success_groups.append(group)
            diagnostic.group_results[group] = {
                'success': True,
                'message': '最適化成功',
                'details': info
            }
        else:
            print(f'    ❌ グループ{group}: 失敗 - {result}')
            failed_groups.append(group)
            diagnostic.group_results[group] = {
                'success': False,
                'message': result,
                'details': info
            }

            # 緩和モードで再試行
            if not relaxed and partial_output:
                print(f'    🔄 グループ{group}: 制約緩和モードで再試行...')
                success2, result2, info2 = optimize_single_group(
                    group, group_staff, group_holiday, settings_df, year, month, relaxed=True
                )
                if success2:
                    print(f'    ⚠️ グループ{group}: 緩和モードで成功（制約違反あり）')
                    all_results.append(result2)
                    diagnostic.group_results[group]['relaxed_success'] = True
                    diagnostic.add_warning(
                        'グループ制約緩和',
                        f'グループ{group}は制約を緩和して最適化しました',
                        '最低人数や所定勤務日数が一部守られていない可能性があります'
                    )

    # 結果をまとめる
    if all_results:
        combined_df = pd.concat(all_results, ignore_index=True)
    else:
        combined_df = None

    # 失敗グループへの対策提案
    for group in failed_groups:
        group_info = diagnostic.group_results[group].get('details', {})

        if group_info.get('night_capable', 0) == 0:
            diagnostic.add_suggestion(
                f'グループ{group}: 夜勤可能な職員を最低1名配置してください'
            )
        elif group_info.get('staff_count', 0) < 5:
            diagnostic.add_suggestion(
                f'グループ{group}: 職員を{5 - group_info.get("staff_count", 0)}名以上増員してください'
            )
        else:
            diagnostic.add_suggestion(
                f'グループ{group}: 休み希望を調整するか、他グループから応援を検討してください'
            )

    # サマリー出力
    print(f'\n📊 最適化結果サマリー:')
    print(f'  成功グループ: {success_groups if success_groups else "なし"}')
    print(f'  失敗グループ: {failed_groups if failed_groups else "なし"}')

    if combined_df is not None:
        print(f'  出力レコード数: {len(combined_df)}件')

        # 統計出力
        for shift_type in SHIFT_TYPES:
            count = len(combined_df[combined_df['シフト名'] == shift_type])
            print(f'  {shift_type}: {count}件')

    diagnostic.partial_results = combined_df

    return (combined_df, diagnostic)


# ============================================
# CSV保存
# ============================================

def save_result_to_drive(result_df, year, month, suffix=''):
    """シフト結果をDriveに保存"""
    creds = authenticate_drive()
    service = build('drive', 'v3', credentials=creds)

    csv_buffer = io.BytesIO()
    result_df.to_csv(csv_buffer, index=False, encoding='utf-8')
    csv_buffer.seek(0)

    year_month = f'{year}{str(month).zfill(2)}'
    file_name = f'シフト結果_{year_month}{suffix}.csv'

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


def save_diagnostic_report(diagnostic, year, month):
    """診断レポートをDriveに保存"""
    creds = authenticate_drive()
    service = build('drive', 'v3', credentials=creds)

    report = diagnostic.to_dict()
    json_buffer = io.BytesIO(json.dumps(report, ensure_ascii=False, indent=2).encode('utf-8'))

    year_month = f'{year}{str(month).zfill(2)}'
    file_name = f'診断レポート_{year_month}.json'

    # 既存ファイル削除
    query = f"name='{file_name}' and '{OUTPUT_FOLDER_ID}' in parents and trashed=false"
    results = service.files().list(q=query, fields='files(id)').execute()
    for file in results.get('files', []):
        service.files().delete(fileId=file['id']).execute()

    file_metadata = {
        'name': file_name,
        'parents': [OUTPUT_FOLDER_ID],
        'mimeType': 'application/json'
    }

    media = MediaIoBaseUpload(json_buffer, mimetype='application/json', resumable=True)

    file = service.files().create(
        body=file_metadata,
        media_body=media,
        fields='id'
    ).execute()

    print(f'✅ {file_name} をDriveに保存しました')
    return file.get('id')


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
    """メイン処理（診断機能付き）"""
    print(f'\n{"="*60}')
    print(f'🗓️ シフト計算開始（診断機能付き）: {TARGET_YEAR}年{TARGET_MONTH}月')
    print(f'{"="*60}\n')

    print(f'設定:')
    print(f'  部分出力モード: {"有効" if ENABLE_PARTIAL_OUTPUT else "無効"}')
    print(f'  制約緩和モード: {"有効" if RELAXED_MODE else "無効"}')

    try:
        # 1. CSV読込
        print('\n[1/5] CSV読込')
        holiday_df, staff_df, settings_df = load_all_input_data(TARGET_YEAR, TARGET_MONTH)

        # 2. シフト最適化（診断機能付き）
        print('\n[2/5] シフト最適化（診断機能付き）')
        result_df, diagnostic = optimize_shift_with_diagnostics(
            holiday_df, staff_df, settings_df,
            TARGET_YEAR, TARGET_MONTH,
            partial_output=ENABLE_PARTIAL_OUTPUT,
            relaxed=RELAXED_MODE
        )

        # 3. 診断レポート出力
        print('\n[3/5] 診断レポート出力')
        diagnostic.print_report()

        if result_df is None or len(result_df) == 0:
            print('\n❌ 出力可能な結果がありません')

            # 診断レポートのみ保存
            save_diagnostic_report(diagnostic, TARGET_YEAR, TARGET_MONTH)

            print(f'\n{"="*60}')
            print('❌ シフト計算に失敗しました')
            print('診断レポートを確認し、問題を修正してから再実行してください')
            print(f'{"="*60}\n')
            return None

        # 4. 結果プレビュー
        print('\n📊 結果プレビュー（最初の20件）:')
        print(result_df.head(20))

        # 5. CSV保存
        print('\n[4/5] CSV保存')

        # 部分結果の場合はサフィックスを追加
        suffix = ''
        if diagnostic.errors:
            suffix = '_partial'
            print('⚠️ 部分的な結果として保存します')

        file_id = save_result_to_drive(result_df, TARGET_YEAR, TARGET_MONTH, suffix)
        save_diagnostic_report(diagnostic, TARGET_YEAR, TARGET_MONTH)

        # 6. Webhook通知（完全な結果の場合のみ）
        print('\n[5/5] Webhook通知')
        if not suffix:
            webhook_result = notify_gas_webhook(file_id, TARGET_YEAR, TARGET_MONTH)
        else:
            print('⚠️ 部分的な結果のためWebhook送信をスキップ')
            webhook_result = {'success': True, 'message': 'スキップ（部分結果）'}

        print(f'\n{"="*60}')
        if webhook_result.get('success') and not suffix:
            print('✅ すべての処理が完了しました！')
            print(f'\n📋 次のステップ:')
            print(f'  1. GASアプリの「シフト修正」画面を開く')
            print(f'  2. 対象月とグループを選択して「表示」')
            print(f'  3. 必要に応じてシフトを修正')
            print(f'  4. 「確定してカレンダー登録」ボタンをクリック')
        else:
            print('⚠️ 部分的な結果が出力されました')
            print(f'\n📋 次のステップ:')
            print(f'  1. 診断レポートを確認')
            print(f'  2. 失敗したグループの問題を修正')
            print(f'  3. 再度シフト計算を実行')
            print(f'  または')
            print(f'  4. 部分的な結果をGASで手動インポートし、')
            print(f'     失敗グループは手動でシフト作成')
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
