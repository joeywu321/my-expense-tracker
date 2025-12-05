// --- 配置區 ---
// const firebaseConfig = {
//   // 從 Firebase Console > Project Settings > General 複製這一段
//   apiKey: "YOUR_API_KEY",
//   authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
//   projectId: "YOUR_PROJECT_ID",
//   storageBucket: "YOUR_PROJECT_ID.appspot.com",
//   messagingSenderId: "...",
//   appId: "...",
// };
const firebaseConfig = {
  apiKey: "AIzaSyCnpibjrQYnzCnIh5S4t1-DFs8YFnKYqPA",
  authDomain: "my-money-4b752.firebaseapp.com",
  projectId: "my-money-4b752",
  storageBucket: "my-money-4b752.firebasestorage.app",
  messagingSenderId: "133294452489",
  appId: "1:133294452489:web:5360ac7e7923705b746dd8",
  measurementId: "G-FYBX4Z9XXP",
};

// Google API 設定
const CLIENT_ID = "my-money-4b752"; // 從 Google Cloud Console 取得
const API_KEY = "AIzaSyCnpibjrQYnzCnIh5S4t1"; // 同 Firebase API Key 即可，或另外申請
const DISCOVERY_DOCS = [
  "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
  "https://sheets.googleapis.com/$discovery/rest?version=v4",
];
const SCOPES =
  "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/spreadsheets";

// --- 初始化 ---
firebase.initializeApp(firebaseConfig);
let tokenClient;
let gapiInited = false;
let gisInited = false;
let calendarId = null; // 儲存 "消費" 日曆的 ID

// UI 元素
const loginSection = document.getElementById("login-section");
const dashboardSection = document.getElementById("dashboard-section");
const statusMsg = document.getElementById("status-msg");

// 1. Google Identity Services 載入
function gapiLoaded() {
  gapi.load("client", initializeGapiClient);
}

async function initializeGapiClient() {
  await gapi.client.init({
    apiKey: API_KEY,
    discoveryDocs: DISCOVERY_DOCS,
  });
  gapiInited = true;
  checkAuth();
}

function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: "", // 定義在登入觸發時
  });
  gisInited = true;
  checkAuth();
}

// 2. 登入邏輯
function checkAuth() {
  if (!gapiInited || !gisInited) return;

  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      loginSection.classList.add("hidden");
      dashboardSection.classList.remove("hidden");
      // 請求 Google API Access Token
      requestAccessToken();
    } else {
      loginSection.classList.remove("hidden");
      dashboardSection.classList.add("hidden");
    }
  });
}

document.getElementById("login-btn").addEventListener("click", () => {
  // 先進行 Firebase 登入
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider);
});

document.getElementById("logout-btn").addEventListener("click", () => {
  firebase.auth().signOut();
  const token = gapi.client.getToken();
  if (token !== null) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken("");
  }
});

function requestAccessToken() {
  tokenClient.callback = async (resp) => {
    if (resp.error) throw resp;
    await mainAppLogic();
  };
  // 觸發彈窗請求 Calendar/Sheet 權限
  tokenClient.requestAccessToken({ prompt: "consent" });
}

// 3. 主應用邏輯
async function mainAppLogic() {
  updateStatus("正在搜尋 '消費' 日曆...");

  // 檢查是否有 "消費" 日曆
  const calendarList = await gapi.client.calendar.calendarList.list();
  const expenseCalendar = calendarList.result.items.find(
    (c) => c.summary === "消費"
  );

  if (expenseCalendar) {
    calendarId = expenseCalendar.id;
    updateStatus("找到日曆，正在讀取數據...");
  } else {
    updateStatus("找不到日曆，正在建立新日曆 '消費'...");
    const newCal = await gapi.client.calendar.calendars.insert({
      resource: { summary: "消費" },
    });
    calendarId = newCal.result.id;
  }

  await fetchAndCalculateExpenses();
}

// 4. 抓取消費紀錄並計算
async function fetchAndCalculateExpenses() {
  const now = new Date();
  // 設定當月的第一天和最後一天
  const startOfMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toISOString();
  const endOfMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59
  ).toISOString();

  document.getElementById("current-month").textContent = `${
    now.getMonth() + 1
  }月`;

  const response = await gapi.client.calendar.events.list({
    calendarId: calendarId,
    timeMin: startOfMonth,
    timeMax: endOfMonth,
    showDeleted: false,
    singleEvents: true,
    orderBy: "startTime",
  });

  const events = response.result.items;
  let totalSpent = 0;
  const expenseListEl = document.getElementById("expense-list");
  expenseListEl.innerHTML = "";
  const exportData = [["日期", "項目", "金額"]]; // 準備給 Excel 用

  if (events.length > 0) {
    events.forEach((event) => {
      const title = event.summary || "";
      // Regex: 抓取結尾的數字。例如 "午餐 150" -> 150, "計程車200" -> 200
      // \D 代表非數字字符，作為分隔
      const match = title.match(/(.*?)(\d+)$/);

      if (match) {
        const name = match[1].trim() || "未命名消費";
        const amount = parseInt(match[2], 10);
        totalSpent += amount;

        // 顯示在列表中
        const li = document.createElement("li");
        const date = new Date(
          event.start.dateTime || event.start.date
        ).toLocaleDateString();
        li.innerHTML = `<span>${date} ${name}</span> <span>$${amount}</span>`;
        expenseListEl.appendChild(li);

        exportData.push([date, name, amount]);
      }
    });
  } else {
    expenseListEl.innerHTML =
      "<li>本月尚無符合格式的消費 (例如: 午餐 120)</li>";
  }

  // 更新 UI 數字
  document.getElementById("total-spent").innerText = `$${totalSpent}`;

  const budget = parseInt(document.getElementById("budget-input").value) || 0;
  document.getElementById("remaining-budget").innerText = `$${
    budget - totalSpent
  }`;

  updateStatus("數據已更新");

  // 綁定匯出按鈕的資料
  document.getElementById("export-btn").onclick = () =>
    exportToSheet(exportData);
}

// 5. 匯出至 Google Sheet
async function exportToSheet(data) {
  updateStatus("正在建立 Google Sheet...");
  try {
    // 建立新試算表
    const spreadsheet = await gapi.client.sheets.spreadsheets.create({
      properties: {
        title: `消費紀錄_${new Date().toISOString().slice(0, 10)}`,
      },
    });

    const spreadsheetId = spreadsheet.result.spreadsheetId;

    // 寫入資料
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      resource: {
        values: data,
      },
    });

    const url = spreadsheet.result.spreadsheetUrl;
    updateStatus(
      `匯出成功！<a href="${url}" target="_blank">點此開啟試算表</a>`
    );
  } catch (err) {
    console.error(err);
    updateStatus("匯出失敗，請檢查 Console");
  }
}

function updateStatus(msg) {
  statusMsg.innerHTML = msg;
}

// 綁定預算輸入框變更
document.getElementById("budget-input").addEventListener("change", () => {
  const spent =
    parseInt(
      document.getElementById("total-spent").innerText.replace("$", "")
    ) || 0;
  const budget = parseInt(document.getElementById("budget-input").value) || 0;
  document.getElementById("remaining-budget").innerText = `$${budget - spent}`;
});

document
  .getElementById("refresh-btn")
  .addEventListener("click", fetchAndCalculateExpenses);
