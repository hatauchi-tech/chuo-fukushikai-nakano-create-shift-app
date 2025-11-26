/**
 * AuthService.gs - 認証サービス
 * ログイン認証とセッション管理
 */

// ログイン認証
function authenticateUser(loginId, password) {
  try {
    console.log(`ログイン試行: ${loginId}`);

    const staff = getStaffByLoginId(loginId);

    if (!staff) {
      console.log(`ログイン失敗: ユーザーが見つかりません (${loginId})`);
      return {
        success: false,
        message: 'ログインIDまたはパスワードが正しくありません'
      };
    }

    // 有効フラグチェック
    if (staff['有効'] !== true && staff['有効'] !== 'TRUE') {
      console.log(`ログイン失敗: 無効なユーザー (${loginId})`);
      return {
        success: false,
        message: 'このアカウントは無効化されています'
      };
    }

    // パスワードチェック
    if (staff['パスワード'] !== password) {
      console.log(`ログイン失敗: パスワード不一致 (${loginId})`);
      return {
        success: false,
        message: 'ログインIDまたはパスワードが正しくありません'
      };
    }

    // 認証成功
    console.log(`ログイン成功: ${staff['氏名']} (${loginId})`);

    // セッション情報を作成
    const session = {
      loginId: staff['ログインID'],
      staffId: staff['職員ID'],
      name: staff['氏名'],
      group: staff['グループ'],
      role: staff['役職'],
      isAdmin: isAdminRole(staff['役職'])
    };

    return {
      success: true,
      session: session,
      message: 'ログインしました'
    };

  } catch (e) {
    console.error('認証エラー:', e);
    return {
      success: false,
      message: 'システムエラーが発生しました'
    };
  }
}

// 管理者ロールかどうかを判定
function isAdminRole(role) {
  const adminRoles = ['管理者', '施設長', '主任', 'リーダー'];
  return adminRoles.includes(role);
}

// セッション情報を取得（UserPropertiesから）
function getSession() {
  try {
    const userProps = PropertiesService.getUserProperties();
    const sessionJson = userProps.getProperty('SESSION');

    if (!sessionJson) {
      return null;
    }

    return JSON.parse(sessionJson);
  } catch (e) {
    console.error('セッション取得エラー:', e);
    return null;
  }
}

// セッション情報を保存
function setSession(sessionData) {
  try {
    const userProps = PropertiesService.getUserProperties();
    userProps.setProperty('SESSION', JSON.stringify(sessionData));
    console.log(`セッション保存: ${sessionData.name}`);
  } catch (e) {
    console.error('セッション保存エラー:', e);
  }
}

// セッション情報をクリア
function clearSession() {
  try {
    const userProps = PropertiesService.getUserProperties();
    userProps.deleteProperty('SESSION');
    console.log('セッションクリア');
  } catch (e) {
    console.error('セッションクリアエラー:', e);
  }
}

// ログアウト
function logout() {
  clearSession();
  return { success: true, message: 'ログアウトしました' };
}
