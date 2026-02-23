# 「管理者権限が必要です」バグ修正計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 勤務指定・イベント管理で「管理者権限が必要です」と表示されるバグの根本原因を特定し修正する。

**Architecture:** GAS Web App (SPA) のセッション管理 (`PropertiesService.getUserProperties()`) において、`authenticateUser()` で `setSession()` が正しく呼ばれているにも関わらず、後続API呼び出しで `getSession()` が null を返す問題を調査・修正する。

**Tech Stack:** Google Apps Script, clasp, PropertiesService

---

## 調査結果サマリー

### 影響範囲

以下4つのAPI関数で `getSession()` → `session.isAdmin` チェックが行われている:

| 関数 | ファイル:行 | 機能 |
|------|------------|------|
| `apiSaveShiftAssignment` | `06_Code.gs:1197` | 勤務指定の保存 |
| `apiDeleteShiftAssignment` | `06_Code.gs:1206` | 勤務指定の削除 |
| `apiSaveEvent` | `06_Code.gs:1221` | イベントの保存 |
| `apiDeleteEvent` | `06_Code.gs:1230` | イベントの削除 |

### ローカルコード確認結果

- `03_AuthService.gs:53` - `setSession(session)` が `authenticateUser()` 内で正しく呼ばれている
- `03_AuthService.gs:49` - `isAdmin: isAdminRole(staff['役職'])` で管理者判定
- `03_AuthService.gs:73` - `isAdminRole()` は `role === '管理者'` で正しく判定

### 原因仮説（可能性順）

**仮説1: GASに最新コードが未反映（最有力）**
- 前回セッションで `authenticateUser()` に `setSession(session)` を追加する修正を実施
- しかし `clasp push` が失敗（clasp未インストール）
- GAS上のコードが古く、`setSession()` 呼び出しがない可能性
- 症状と一致: フロントエンドの `currentSession.isAdmin` は true（レスポンスから取得）だが、バックエンドの `getSession()` は null を返す

**仮説2: デプロイ設定の不整合**
- `appsscript.json` は `executeAs: "USER_ACCESSING"` だが、README は `Execute as: Me` と記載
- 実際のデプロイ設定により `UserProperties` のスコープが変わる
- `Execute as: Me` の場合、全ユーザーが同一の UserProperties を共有

**仮説3: M_職員の役職データ不正**
- 「管理者」文字列に余計な空白や全角/半角の違いがある可能性
- ただし、ナビバーに管理者メニューが表示されているなら `isAdmin = true` がフロントエンドに返っているため、この仮説の可能性は低い

---

## Task 1: GAS上のコードとローカルコードの差分確認

**Files:**
- 確認: `03_AuthService.gs`（GASエディタ上のコード）

**Step 1: GASエディタでコードを確認する**

ブラウザで以下を確認:
1. https://script.google.com/ を開く
2. scriptId `1A0K3s-CLbFriky-ccEHH6cgQNkI-IAUHUVTbExho1u08gUV4FSdT9qHF` のプロジェクトを開く
3. `03_AuthService.gs` の `authenticateUser()` 関数を確認
4. `setSession(session);` の呼び出しがあるか確認

**期待結果:**
- `setSession(session)` がない場合 → 仮説1が確定。Task 2に進む
- `setSession(session)` がある場合 → 仮説2または3を調査。Task 3に進む

---

## Task 2: 最新コードをGASに反映

**前提:** Task 1で `setSession(session)` がGAS上にないことが確認された場合

**Files:**
- 反映対象: 全 `.gs` ファイルおよび `07_index.html`

**方法A: clasp を使用（推奨）**

**Step 1: clasp をインストール**

```bash
npm install -g @google/clasp
```
または
```bash
npx @google/clasp push
```

**Step 2: clasp にログイン**

```bash
clasp login
```
ブラウザでGoogle認証を完了する。

**Step 3: コードをpush**

```bash
clasp push
```

**Step 4: push結果を確認**

期待出力: `Pushed N files.`

**方法B: 手動コピー（claspが使えない場合）**

**Step 1: GASエディタを開く**

https://script.google.com/ → プロジェクトを開く

**Step 2: 各ファイルのコードを更新**

以下のファイルをローカルからGASエディタにコピー&ペースト:
1. `01_Config.gs`
2. `02_DataService.gs`
3. `03_AuthService.gs` ← 最重要（`setSession` 修正含む）
4. `04_ShiftService.gs`
5. `05_CalendarService.gs`
6. `06_Code.gs`
7. `07_index.html`
8. `08_CSVService.gs`

**Step 3: 保存を確認**

各ファイルで Ctrl+S を押して保存。

**Step 5: コミット**

```bash
git add -A && git commit -m "docs: CLAUDE.md作成、バグ調査計画書作成"
```

---

## Task 3: デプロイ設定の確認・修正

**Step 1: 現在のデプロイ設定を確認**

GASエディタで:
1. 「デプロイ」→「デプロイを管理」
2. 現在のデプロイの「次のユーザーとして実行」設定を確認

**Step 2: 設定が正しいことを確認**

推奨設定:
- **次のユーザーとして実行**: `自分`（スクリプトオーナー）
  - 理由: スプレッドシートへのアクセス権限をスクリプトオーナーの権限で実行
  - 注意: この場合、全ユーザーが同一の UserProperties を共有する
- **アクセスできるユーザー**: `組織内のすべてのユーザー`（または適切な範囲）

**Step 3: デプロイを更新**

設定変更した場合:
1. 「デプロイを管理」→「編集（鉛筆アイコン）」
2. バージョン: 「新しいバージョン」を選択
3. 「デプロイ」をクリック

---

## Task 4: 動作確認

**Step 1: Webアプリにアクセス**

デプロイURLをブラウザで開く。

**Step 2: 管理者アカウントでログイン**

M_職員シートで「役職」が「管理者」のユーザーのログインID/パスワードでログイン。

**Step 3: 勤務指定の保存テスト**

1. ナビバーで「勤務指定」タブをクリック
2. 職員名、日付、シフトを選択
3. 「追加」ボタンをクリック
4. 「保存しました」と表示されることを確認（「管理者権限が必要です」が出ないこと）

**Step 4: イベントの保存テスト**

1. 「休み希望提出」画面の下部にあるイベント管理セクション
2. タイトル、日付を入力して「追加」
3. 「追加しました」と表示されることを確認

**Step 5: 勤務指定の削除テスト**

1. 勤務指定一覧から削除ボタンをクリック
2. 確認ダイアログで「OK」
3. 正常に削除されることを確認

---

## Task 5: 追加の堅牢性改善（オプション）

**もしTask 4で問題が解決しない場合の追加調査:**

**Step 1: デバッグログを追加**

`06_Code.gs` の `apiSaveShiftAssignment` にログを追加:

```javascript
function apiSaveShiftAssignment(staffId, staffName, date, shiftId, notes) {
  try {
    var session = getSession();
    console.log('apiSaveShiftAssignment - session:', JSON.stringify(session));
    if (!session || !session.isAdmin) {
      console.log('管理者チェック失敗 - session null:', !session, ', isAdmin:', session ? session.isAdmin : 'N/A');
      return { success: false, message: '管理者権限が必要です' };
    }
    var id = saveShiftAssignment(staffId, staffName, date, shiftId, session.name, notes);
    return { success: true, assignmentId: id, message: '勤務指定を保存しました' };
  } catch (e) { return { success: false, message: e.message }; }
}
```

**Step 2: M_職員シートの役職データを確認**

GASエディタで以下を実行して、管理者ユーザーのデータを確認:

```javascript
function debugCheckAdminUser() {
  var staff = getAllStaff();
  staff.forEach(function(s) {
    console.log('氏名:', s['氏名'], ', 役職:', JSON.stringify(s['役職']),
                ', 型:', typeof s['役職'], ', isAdmin:', isAdminRole(s['役職']));
  });
}
```

**Step 3: セッション保存・取得のデバッグ**

GASエディタで以下を実行:

```javascript
function debugSession() {
  // 保存テスト
  var testSession = { loginId: 'test', isAdmin: true, name: 'テスト' };
  setSession(testSession);
  console.log('保存した値:', JSON.stringify(testSession));

  // 取得テスト
  var loaded = getSession();
  console.log('取得した値:', JSON.stringify(loaded));
  console.log('isAdmin:', loaded ? loaded.isAdmin : 'null');
}
```

---

## 完了チェックリスト

- [ ] GASエディタで `03_AuthService.gs` の `authenticateUser()` に `setSession(session)` があることを確認
- [ ] 最新コードがGASに反映されている（clasp push または手動コピー）
- [ ] デプロイが最新バージョンで更新されている
- [ ] 管理者ログインで勤務指定の追加が成功する
- [ ] 管理者ログインでイベントの追加が成功する
- [ ] 管理者ログインで勤務指定の削除が成功する
- [ ] 管理者ログインでイベントの削除が成功する
