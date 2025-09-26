// background.js (required by manifest MV3 background.service_worker)
self.addEventListener('install', () => {
  console.log('[background] installed');
});

self.addEventListener('activate', () => {
  console.log('[background] activated');
});

let loggedInUser = null;
let sessionId = null;

// Load auth state when background script starts
chrome.storage.local.get(['loggedIn', 'username', 'session_id'], (result) => {
  if (result.loggedIn) {
    loggedInUser = result.username;
    sessionId = result.session_id;
    console.log('Background: Loaded user session', loggedInUser);
  }
});

// Listen for storage changes (when popup logs in/out)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.loggedIn) {
    if (changes.loggedIn.newValue) {
      chrome.storage.local.get(['username', 'session_id'], (result) => {
        loggedInUser = result.username;
        sessionId = result.session_id;
        console.log('Background: User logged in', loggedInUser);
      });
    } else {
      console.log('Background: User logged out');
      loggedInUser = null;
      sessionId = null;
    }
  }
});

// Detect when tab is closed
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (loggedInUser && sessionId) {
    console.log(`Tab ${tabId} closed. Checking if this was the last kuaishou tab...`);
    
    // Check if there are any other kuaishou tabs open
    const allTabs = await chrome.tabs.query({});
    const kuaishouTabs = allTabs.filter(tab => 
      tab.url && tab.url.includes('kuaishou.com')
    );
    
    // If this was the last kuaishou tab, logout the user
    if (kuaishouTabs.length === 0) {
      console.log('Last kuaishou tab closed. Logging out user:', loggedInUser);
      
      // Call logout endpoint
      try {
        await fetch("https://extension1-production.up.railway.app/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId })
        });
        console.log('Background: Logout API call successful');
      } catch (err) {
        console.error('Background: Logout API error:', err);
      }
      
      // Clear local storage
      await chrome.storage.local.remove(['loggedIn', 'username', 'session_id']);
      loggedInUser = null;
      sessionId = null;
      
      console.log('Background: User automatically logged out due to tab closure');
    }
  }
});

// Also detect when window is closed (handles multiple tabs closing at once)
chrome.windows.onRemoved.addListener(async (windowId) => {
  if (loggedInUser && sessionId) {
    console.log(`Window ${windowId} closed. Checking for remaining kuaishou tabs...`);
    
    // Check if there are any kuaishou tabs left in any window
    const allTabs = await chrome.tabs.query({});
    const kuaishouTabs = allTabs.filter(tab => 
      tab.url && tab.url.includes('kuaishou.com')
    );
    
    // If no kuaishou tabs remain, logout
    if (kuaishouTabs.length === 0) {
      console.log('All kuaishou tabs closed. Logging out user:', loggedInUser);
      
      try {
        await fetch("https://extension1-production.up.railway.app/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId })
        });
      } catch (err) {
        console.error('Background: Logout API error:', err);
      }
      
      await chrome.storage.local.remove(['loggedIn', 'username', 'session_id']);
      loggedInUser = null;
      sessionId = null;
      
      console.log('Background: User automatically logged out due to window closure');
    }
  }
});

// Handle auth check requests from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "check_auth") {
    sendResponse({
      loggedIn: !!loggedInUser,
      username: loggedInUser || null
    });
    return true;
  }
});