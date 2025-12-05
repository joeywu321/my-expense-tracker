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
    'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
    'https://sheets.googleapis.com/$discovery/rest?version=v4'
];
const SCOPES = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/spreadsheets';

// --- 初始化 ---
firebase.initializeApp(firebaseConfig);
let tokenClient;
let gapiInited = false;
let gisInited = false;
let calendarId = null;

// UI 元素
const loginSection = document.getElementById('login-section');
const dashboardSection = document.getElementById('dashboard-section');
const statusMsg = document.getElementById('status-msg');
const actionCard = document.querySelector('.action-card'); // 取得操作區卡片

// 1. Google Identity Services 載入
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
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
        callback: '', // 定義在觸發時
    });
    gisInited = true;
    checkAuth();
}

// 2. 登入邏輯 (修正重點：改用 Redirect)
function checkAuth() {
    if (!gapiInited || !gisInited) return;
    
    // 檢查 Redirect 回來的結果 (處理登入後的狀態)
    firebase.auth().getRedirectResult().then((result) => {
        if (result.user) {
            console.log("Redirect login successful");
        }
    }).catch((error) => {
        console.error(error);
        alert("登入失敗: " + error.message);
    });

    // 監聽登入狀態
    firebase.auth().onAuthStateChanged((user) => {
        if (user) {
            loginSection.classList.add('hidden');
            dashboardSection.classList.remove('hidden');
            
            // 重要修改：登入後不要自動抓資料，因為沒有 Access Token
            // 顯示一個按鈕讓使用者點擊，這樣才不會被擋
            showConnectButton();
        } else {
            loginSection.classList.remove('hidden');
            dashboardSection.classList.add('hidden');
        }
    });
}

// 修改登入按鈕行為：使用 signInWithRedirect
document.getElementById('login-btn').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    // 使用 Redirect 解決彈窗被擋問題
    firebase.auth().signInWithRedirect(provider);
});

document.getElementById('logout-btn').addEventListener('click', () => {
    firebase.auth().signOut();
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
    }
    location.reload(); // 重新整理頁面以清除狀態
});

// 3. 新增：顯示「授權日曆」按鈕
function showConnectButton() {
    // 先清空操作區，避免重複
    statusMsg.innerHTML = "請點擊下方按鈕以讀取日曆數據";
    // 隱藏原本的功能按鈕，顯示授權按鈕
    document.querySelector('.btn-group').classList.add('hidden');
    
    // 檢查是否已經有授權按鈕，沒有才建立
    if (!document.getElementById('grant-btn')) {
        const grantBtn = document.createElement('button');
        grantBtn.id = 'grant-btn';
        grantBtn.className = 'btn';
        grantBtn.style.backgroundColor = '#34a853'; // 綠色
        grantBtn.innerText = '授權並讀取日曆 (必要)';
        
        // 插入到 statusMsg 之後
        statusMsg.parentNode.insertBefore(grantBtn, statusMsg.nextSibling);

        // 綁定點擊事件 -> 這是「使用者主動點擊」，瀏覽器不會擋
        grantBtn.addEventListener('click', () => {
            tokenClient.callback = async (resp) => {
                if (resp.error) {
                    throw resp;
                }
                // 授權成功，移除授權按鈕，顯示功能區
                grantBtn.remove();
                document.querySelector('.btn-group').classList.remove('hidden');
                await mainAppLogic();
            };
            tokenClient.requestAccessToken({prompt: 'consent'});
        });
    }
}

// 4. 主應用邏輯 (與原本相同)
async function mainAppLogic() {
    updateStatus("正在搜尋 '消費' 日曆...");
    
    try {
        const calendarList = await gapi.client.calendar.calendarList.list();
        const expenseCalendar = calendarList.result.items.find(c => c.summary === '消費');

        if (expenseCalendar) {
            calendarId = expenseCalendar.id;
            updateStatus("找到日曆，正在讀取數據...");
        } else {
            updateStatus("找不到日曆，正在建立新日曆 '消費'...");
            const newCal = await gapi.client.calendar.calendars.insert({
                resource: { summary: '消費' }
            });
            calendarId = newCal.result.id;
        }

        await fetchAndCalculateExpenses();
    } catch (error) {
        console.error("Error:", error);
        updateStatus("讀取失敗，請確認是否已授權。");
        // 如果失敗，可能需要重新顯示授權按鈕
        showConnectButton();
    }
}

// 5. 抓取消費紀錄並計算 (與原本相同)
async function fetchAndCalculateExpenses() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
    
    document.getElementById('current-month').textContent = `${now.getMonth() + 1}月`;

    const response = await gapi.client.calendar.events.list({
        'calendarId': calendarId,
        'timeMin': startOfMonth,
        'timeMax': endOfMonth,
        'showDeleted': false,
        'singleEvents': true,
        'orderBy': 'startTime'
    });

    const events = response.result.items;
    let totalSpent = 0;
    const expenseListEl = document.getElementById('expense-list');
    expenseListEl.innerHTML = '';
    const exportData = [['日期', '項目', '金額']]; 

    if (events.length > 0) {
        events.forEach(event => {
            const title = event.summary || '';
            const match = title.match(/(.*?)(\d+)$/);
            
            if (match) {
                const name = match[1].trim() || '未命名消費';
                const amount = parseInt(match[2], 10);
                totalSpent += amount;

                const li = document.createElement('li');
                const date = new Date(event.start.dateTime || event.start.date).toLocaleDateString();
                li.innerHTML = `<span>${date} ${name}</span> <span>$${amount}</span>`;
                expenseListEl.appendChild(li);

                exportData.push([date, name, amount]);
            }
        });
    } else {
        expenseListEl.innerHTML = '<li>本月尚無符合格式的消費 (例如: 午餐 120)</li>';
    }

    document.getElementById('total-spent').innerText = `$${totalSpent}`;
    
    const budget = parseInt(document.getElementById('budget-input').value) || 0;
    document.getElementById('remaining-budget').innerText = `$${budget - totalSpent}`;
    
    updateStatus("數據已更新");

    // 重新綁定匯出按鈕 (防止多次綁定，先移除舊的)
    const exportBtn = document.getElementById('export-btn');
    const newExportBtn = exportBtn.cloneNode(true);
    exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);
    newExportBtn.onclick = () => exportToSheet(exportData);
}

// 6. 匯出至 Google Sheet (與原本相同)
async function exportToSheet(data) {
    updateStatus("正在建立 Google Sheet...");
    try {
        const spreadsheet = await gapi.client.sheets.spreadsheets.create({
            properties: {
                title: `消費紀錄_${new Date().toISOString().slice(0,10)}`
            }
        });
        
        const spreadsheetId = spreadsheet.result.spreadsheetId;

        await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: 'Sheet1!A1',
            valueInputOption: 'RAW',
            resource: {
                values: data
            }
        });

        const url = spreadsheet.result.spreadsheetUrl;
        updateStatus(`匯出成功！<a href="${url}" target="_blank">點此開啟試算表</a>`);
    } catch (err) {
        console.error(err);
        updateStatus("匯出失敗: " + (err.result?.error?.message || err.message));
    }
}

function updateStatus(msg) {
    statusMsg.innerHTML = msg;
}

// 預算與重新整理按鈕
document.getElementById('budget-input').addEventListener('change', () => {
    const spent = parseInt(document.getElementById('total-spent').innerText.replace('$','')) || 0;
    const budget = parseInt(document.getElementById('budget-input').value) || 0;
    document.getElementById('remaining-budget').innerText = `$${budget - spent}`;
});

document.getElementById('refresh-btn').addEventListener('click', fetchAndCalculateExpenses);