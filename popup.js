const loginForm = document.getElementById("loginForm");
const trackerUI = document.getElementById("trackerUI");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginStatus = document.getElementById("loginStatus");
const loggedUser = document.getElementById("loggedUser"); // dedicated span for username

// backend endpoints
const BACKEND_LOGIN_URL = "https://extension1-production.up.railway.app/login";
const BACKEND_LOGOUT_URL = "https://extension1-production.up.railway.app/logout";

// wrapper div for non-kuaishou message
let outsideMsg = document.createElement("div");
outsideMsg.innerHTML = `
  <p style="text-align:center; font-size:14px; color:black; ">
    Please open <br><b>https://www.kuaishou.com/new-reco</b><br> to use this extension.
  </p>`;
outsideMsg.classList.add("hidden");
document.body.appendChild(outsideMsg);

function showLogin() {
  loginForm.classList.remove("hidden");
  trackerUI.classList.add("hidden");
  outsideMsg.classList.add("hidden");
  loginStatus.textContent = "";
  if (loggedUser) loggedUser.textContent = "";
}

function showTracker() {
  loginForm.classList.add("hidden");
  trackerUI.classList.remove("hidden");
  outsideMsg.classList.add("hidden");

  chrome.storage.local.get(["username"], (res) => {
    if (res && res.username) {
      if (loggedUser) loggedUser.textContent = res.username;
    } else {
      if (loggedUser) loggedUser.textContent = "";
    }
  });

  loginStatus.textContent = "";
}

function showOutsideMsg() {
  loginForm.classList.add("hidden");
  trackerUI.classList.add("hidden");
  outsideMsg.classList.remove("hidden");
  loginStatus.textContent = "";
  if (loggedUser) loggedUser.textContent = "";
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
    chrome.storage.local.get(["loggedIn", "username", "session_id"], (res) => {
      if (res && res.loggedIn && res.username && res.session_id) {
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

// send action (start/stop/reset)
async function sendActionToTab(action) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0]) return;

  const injected = await ensureContentScript(tabs[0].id);
  if (!injected) return;

  // include session_id + username from storage
  chrome.storage.local.get(["username", "session_id"], (res) => {
    const msg = { action, username: res.username, session_id: res.session_id };
    chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
      if (chrome.runtime.lastError) {
        console.error("popup: sendMessage error:", chrome.runtime.lastError.message);
      }

      // Check if backend requested session split (auto-update session_id)
      if (response && response.action === "session_split" && response.new_session_id) {
        console.warn("Session split detected. Switching to new session:", response.new_session_id);
        chrome.storage.local.set({ session_id: response.new_session_id }, () => {
          console.log("popup: session_id updated to", response.new_session_id);
        });
      }
    });
  });
}

// Handle messages from content script and background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "check_auth") {
    chrome.storage.local.get(["loggedIn", "username"], (result) => {
      sendResponse({
        loggedIn: !!result.loggedIn,
        username: result.username || null
      });
    });
    return true;
  }
  
  // Handle session split messages from content script
  if (message.action === "session_split" && message.new_session_id) {
    console.warn("Session split detected. Switching to new session:", message.new_session_id);
    chrome.storage.local.set({ session_id: message.new_session_id }, () => {
      console.log("popup: session_id updated to", message.new_session_id);
    });
  }
  
  return true;
});

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

    if (data && data.success && data.session_id) {
      // Save login state, username, and session_id
      chrome.storage.local.set(
        { 
          loggedIn: true, 
          username, 
          session_id: data.session_id 
        },
        async () => {
          showTracker();
          
          // Notify all tabs that user has logged in (to unlock blocked pages)
          const allTabs = await chrome.tabs.query({});
          for (const tab of allTabs) {
            if (tab.url && tab.url.includes('kuaishou.com')) {
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  files: ["content.js"]
                });
                chrome.tabs.sendMessage(tab.id, { 
                  action: "user_logged_in",
                  username: username,
                  session_id: data.session_id
                });
              } catch (err) {
                console.log("Could not notify tab:", tab.id, err);
              }
            }
          }
          
          // Reset counters and start tracking automatically
          await sendActionToTab("reset");
          await sendActionToTab("start");
          
          if (loggedUser) loggedUser.textContent = username;
          loginStatus.textContent = "Logged in successfully! Counting started.";
          
          // Clear status after 2 seconds
          setTimeout(() => {
            loginStatus.textContent = "";
          }, 2000);
        }
      );
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
  loginStatus.textContent = "Logging out...";
  
  // Stop counting first
  await sendActionToTab("stop");
  
  // Logout from backend
  chrome.storage.local.get(["session_id"], async (res) => {
    if (res.session_id) {
      try {
        await fetch(BACKEND_LOGOUT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: res.session_id }),
        });
      } catch (err) {
        console.error("popup: logout fetch error:", err);
      }
    }
  });

  // Notify all tabs that user has logged out
  const allTabs = await chrome.tabs.query({});
  for (const tab of allTabs) {
    if (tab.url && tab.url.includes('kuaishou.com')) {
      try {
        chrome.tabs.sendMessage(tab.id, { action: "user_logged_out" });
      } catch (err) {
        console.log("Could not notify tab:", tab.id, err);
      }
    }
  }

  // Reset counters and clear storage
  await sendActionToTab("reset");
  
  chrome.storage.local.remove(["loggedIn", "username", "session_id"], () => {
    showLogin();
    loginStatus.textContent = "Logged out successfully! Counting stopped.";
    
    // Clear status after 2 seconds
    setTimeout(() => {
      loginStatus.textContent = "";
    }, 2000);
  });
});

// run on popup load
checkTabAndUI();