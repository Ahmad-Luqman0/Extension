// popup.js
// Handles login persistence, injecting content.js if needed, and sending start/stop messages.

const loginForm = document.getElementById("loginForm");
const trackerUI = document.getElementById("trackerUI");
const loginBtn = document.getElementById("loginBtn");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginStatus = document.getElementById("loginStatus");

const BACKEND_LOGIN_URL = "https://extension1-production.up.railway.app/login";

// helper: get active tab
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

// show/hide UI
function showLogin() {
  loginForm.classList.remove("hidden");
  trackerUI.classList.add("hidden");
  loginStatus.textContent = "";
}
function showTracker() {
  loginForm.classList.add("hidden");
  trackerUI.classList.remove("hidden");
  loginStatus.textContent = "";
}

// ensure content script injected into given tab
async function ensureContentScript(tabId) {
  try {
    // If content script already injected by content_scripts, this will still be fine
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    console.log("popup: content.js injected (or already present) into tab", tabId);
    return true;
  } catch (err) {
    console.error("popup: failed to inject content.js:", err);
    return false;
  }
}

// send a message to content script, ensure injection first
async function sendActionToTab(action) {
  const tab = await getActiveTab();
  if (!tab) {
    console.error("popup: no active tab");
    loginStatus.textContent = "No active tab found.";
    return;
  }

  // If host is not matching kuaishou, we still attempt injection — but host_permissions restricts injection to allowed hosts.
  // If injection fails because of host mismatch, ensureContentScript will throw.
  const injected = await ensureContentScript(tab.id);
  if (!injected) {
    loginStatus.textContent = "Could not inject script (check host/permissions).";
    return;
  }

  // send message
  chrome.tabs.sendMessage(tab.id, { action }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("popup: sendMessage error:", chrome.runtime.lastError.message);
      loginStatus.textContent = "Message failed: " + chrome.runtime.lastError.message;
    } else {
      console.log("popup: message sent:", action, "response:", response);
      loginStatus.textContent = ""; // clear
    }
  });
}

// check stored login state on load
chrome.storage.local.get(["loggedIn"], (res) => {
  if (res && res.loggedIn) {
    showTracker();
  } else {
    showLogin();
  }
});

// login flow
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
      body: JSON.stringify({ username, password })
    });
    const data = await resp.json();

    if (data && data.success) {
      // persist login
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

// logout: send stop to page, then clear login
logoutBtn.addEventListener("click", async () => {
  // try to stop tracking on page (best-effort)
  await sendActionToTab("stop");

  chrome.storage.local.remove("loggedIn", () => {
    showLogin();
  });
});

// start/stop buttons
startBtn.addEventListener("click", async () => {
  loginStatus.textContent = "Starting...";
  await sendActionToTab("start");
  // small UI feedback
  setTimeout(() => loginStatus.textContent = "", 1000);
});

stopBtn.addEventListener("click", async () => {
  loginStatus.textContent = "Stopping...";
  await sendActionToTab("stop");
  setTimeout(() => loginStatus.textContent = "", 1000);
});
