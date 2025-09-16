const loginForm = document.getElementById("loginForm");
const trackerUI = document.getElementById("trackerUI");
const loginBtn = document.getElementById("loginBtn");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginStatus = document.getElementById("loginStatus");

// backend endpoint
const BACKEND_LOGIN_URL = "https://extension1-production.up.railway.app/login";

// wrapper div for non-kuaishou message
let outsideMsg = document.createElement("div");
outsideMsg.innerHTML = `
  <p style="text-align:center; font-size:14px; color:#444;">
    Please open <br><b>https://www.kuaishou.com/new-reco</b><br> to use this extension.
  </p>`;
outsideMsg.classList.add("hidden");
document.body.appendChild(outsideMsg);

function showLogin() {
  loginForm.classList.remove("hidden");
  trackerUI.classList.add("hidden");
  outsideMsg.classList.add("hidden");
  loginStatus.textContent = "";
}
function showTracker() {
  loginForm.classList.add("hidden");
  trackerUI.classList.remove("hidden");
  outsideMsg.classList.add("hidden");
  loginStatus.textContent = "";
}
function showOutsideMsg() {
  loginForm.classList.add("hidden");
  trackerUI.classList.add("hidden");
  outsideMsg.classList.remove("hidden");
  loginStatus.textContent = "";
}

// check active tab
async function checkTabAndUI() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0]) {
    showOutsideMsg();
    return false;
  }
  const url = tabs[0].url || "";
  if (url.startsWith("https://www.kuaishou.com/new-reco")) {
    // check login state
    chrome.storage.local.get(["loggedIn"], (res) => {
      if (res && res.loggedIn) {
        showTracker();
      } else {
        showLogin();
      }
    });
    return true;
  } else {
    showOutsideMsg();
    return false;
  }
}

// content script injection helper
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return true;
  } catch (err) {
    console.error("Failed to inject content.js:", err);
    return false;
  }
}

// send action (start/stop)
async function sendActionToTab(action) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0]) return;

  const injected = await ensureContentScript(tabs[0].id);
  if (!injected) return;

  chrome.tabs.sendMessage(tabs[0].id, { action }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("popup: sendMessage error:", chrome.runtime.lastError.message);
    }
  });
}

// login
loginBtn.addEventListener("click", async () => {
  loginStatus.textContent = "Logging in...";
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  if (!username || !password) {
    loginStatus.textContent = "Enter username and password.";
    return;
  }

  try {
    const resp = await fetch(BACKEND_LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json();

    if (data && data.success) {
      chrome.storage.local.set({ loggedIn: true }, () => {
        showTracker();
      });
    } else {
      loginStatus.textContent = "Invalid username or password.";
    }
  } catch (err) {
    console.error("popup: login fetch error:", err);
    loginStatus.textContent = "Server error (check backend).";
  }
});

// logout
logoutBtn.addEventListener("click", async () => {
  await sendActionToTab("stop");
  chrome.storage.local.remove("loggedIn", () => {
    showLogin();
  });
});

// start/stop
startBtn.addEventListener("click", async () => {
  loginStatus.textContent = "Starting...";
  await sendActionToTab("start");
  setTimeout(() => (loginStatus.textContent = ""), 1000);
});
stopBtn.addEventListener("click", async () => {
  loginStatus.textContent = "Stopping...";
  await sendActionToTab("stop");
  setTimeout(() => (loginStatus.textContent = ""), 1000);
});

// run on popup load
checkTabAndUI();
