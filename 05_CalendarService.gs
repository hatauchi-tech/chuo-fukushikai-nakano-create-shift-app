/**
 * CalendarService.gs - カレンダー連携サービス
 * Googleカレンダーへのシフト登録・更新・削除を管理
 */

/**
 * シフトをカレンダーに登録
 * @param {number} year - 対象年
 * @param {number} month - 対象月
 */
function registerShiftToCalendar(year, month) {
  try {
    console.log(`カレンダー登録開始: ${year}年${month}月`);

    const sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.WORK_SHEET);
    if (!sheet) {
      return { success: false, message: '作業用シートが見つかりません' };
    }

    const staff = getActiveStaff();
    const daysInMonth = new Date(year, month, 0).getDate();
    const data = sheet.getDataRange().getValues();

    // まず既存の確定シフトを削除
    deleteConfirmedShiftByMonth(year, month);

    let registeredCount = 0;

    // 各スタッフのシフトをカレンダーに登録
    for (let i = 1; i < data.length; i++) {
      const name = data[i][0];
      const person = staff.find(s => s['氏名'] === name);

      if (!person) continue;

      for (let day = 1; day <= daysInMonth; day++) {
        const shiftName = data[i][day];

        if (shiftName && shiftName !== '休み' && shiftName !== '') {
          const date = new Date(year, month - 1, day);
          const shiftInfo = getShiftByName(shiftName);

          if (!shiftInfo) continue;

          // 確定シフトをDBに保存
          const shiftData = {
            '氏名': name,
            'グループ': person['グループ'],
            '日付': date,
            'シフト名': shiftName,
            '開始時間': shiftInfo['開始時間'],
            '終了時間': shiftInfo['終了時間']
          };

          const shiftId = saveConfirmedShift(shiftData);

          // カレンダーに登録
          if (person['カレンダーID']) {
            const eventId = createOrUpdateCalendarEvent(
              person['カレンダーID'],
              name,
              date,
              shiftInfo,
              null // 新規作成
            );

            if (eventId) {
              updateCalendarEventId(shiftId, eventId);
              registeredCount++;
            }
          }
        }
      }
    }

    console.log(`カレンダー登録完了: ${registeredCount}件`);

    return {
      success: true,
      count: registeredCount,
      message: `${registeredCount}件のシフトをカレンダーに登録しました`
    };

  } catch (e) {
    console.error('カレンダー登録エラー:', e);
    return { success: false, message: 'エラーが発生しました: ' + e.message };
  }
}

/**
 * カレンダーイベントを作成または更新
 * @param {string} calendarId - カレンダーID
 * @param {string} staffName - スタッフ名
 * @param {Date} date - 日付
 * @param {object} shiftInfo - シフト情報
 * @param {string} existingEventId - 既存のイベントID（更新時）
 * @return {string} イベントID
 */
function createOrUpdateCalendarEvent(calendarId, staffName, date, shiftInfo, existingEventId) {
  try {
    const calendar = CalendarApp.getCalendarById(calendarId);

    if (!calendar) {
      console.error(`カレンダーが見つかりません: ${calendarId}`);
      return null;
    }

    const title = `【${shiftInfo['シフト名']}】${staffName}`;
    let startTime, endTime;

    // 夜勤の場合は翌朝まで
    if (shiftInfo['シフト名'] === '夜勤') {
      startTime = new Date(date);
      const [startHour, startMinute] = shiftInfo['開始時間'].split(':');
      startTime.setHours(parseInt(startHour), parseInt(startMinute), 0);

      endTime = new Date(date);
      endTime.setDate(endTime.getDate() + 1); // 翌日
      const [endHour, endMinute] = shiftInfo['終了時間'].split(':');
      endTime.setHours(parseInt(endHour), parseInt(endMinute), 0);
    } else {
      startTime = new Date(date);
      const [startHour, startMinute] = shiftInfo['開始時間'].split(':');
      startTime.setHours(parseInt(startHour), parseInt(startMinute), 0);

      endTime = new Date(date);
      const [endHour, endMinute] = shiftInfo['終了時間'].split(':');
      endTime.setHours(parseInt(endHour), parseInt(endMinute), 0);
    }

    let event;

    if (existingEventId) {
      // 既存イベントを更新
      event = calendar.getEventById(existingEventId);
      if (event) {
        event.setTitle(title);
        event.setTime(startTime, endTime);
        console.log(`カレンダー更新: ${title} on ${calendarId}`);
      } else {
        // イベントが見つからない場合は新規作成
        event = calendar.createEvent(title, startTime, endTime);
        console.log(`カレンダー新規作成（更新失敗）: ${title} on ${calendarId}`);
      }
    } else {
      // 新規イベント作成
      event = calendar.createEvent(title, startTime, endTime);
      console.log(`カレンダー新規作成: ${title} on ${calendarId}`);
    }

    return event ? event.getId() : null;

  } catch (e) {
    console.error('カレンダーイベント作成/更新エラー:', e);
    return null;
  }
}

/**
 * カレンダーイベントを削除
 * @param {string} calendarId - カレンダーID
 * @param {string} eventId - イベントID
 */
function deleteCalendarEvent(calendarId, eventId) {
  try {
    const calendar = CalendarApp.getCalendarById(calendarId);

    if (!calendar) {
      console.error(`カレンダーが見つかりません: ${calendarId}`);
      return false;
    }

    const event = calendar.getEventById(eventId);

    if (event) {
      event.deleteEvent();
      console.log(`カレンダー削除: ${eventId} on ${calendarId}`);
      return true;
    } else {
      console.log(`イベントが見つかりません: ${eventId}`);
      return false;
    }

  } catch (e) {
    console.error('カレンダーイベント削除エラー:', e);
    return false;
  }
}

/**
 * 指定月のカレンダーイベントを一括削除
 * @param {number} year - 対象年
 * @param {number} month - 対象月
 */
function deleteCalendarEventsByMonth(year, month) {
  try {
    console.log(`カレンダー一括削除開始: ${year}年${month}月`);

    const staff = getActiveStaff();
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    let deletedCount = 0;

    staff.forEach(person => {
      if (!person['カレンダーID']) return;

      const calendar = CalendarApp.getCalendarById(person['カレンダーID']);
      if (!calendar) return;

      const events = calendar.getEvents(startDate, endDate);
      events.forEach(event => {
        event.deleteEvent();
        deletedCount++;
      });
    });

    console.log(`カレンダー一括削除完了: ${deletedCount}件`);
    return { success: true, count: deletedCount };

  } catch (e) {
    console.error('カレンダー一括削除エラー:', e);
    return { success: false, message: e.message };
  }
}
