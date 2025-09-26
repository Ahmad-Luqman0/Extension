(() => {
  if (window.videoTrackerLoaded) return;
  window.videoTrackerLoaded = true;

  // --- Block access until logged in --- //
  let authCheckInterval;
  let blockOverlay = null;

  function checkAuthAndBlock() {
    // Check if user is logged in
    chrome.storage.local.get(["loggedIn", "username", "session_id"], (result) => {
      const isLoggedIn = !!result.loggedIn;
      
      if (!isLoggedIn && !blockOverlay) {
        // Block the page with overlay
        blockOverlay = document.createElement('div');
        blockOverlay.id = 'auth-block-overlay';
        Object.assign(blockOverlay.style, {
          position: 'fixed',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%',
          background: 'rgba(0,0,0,0.95)',
          color: 'white',
          zIndex: '10000',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          fontSize: '18px',
          textAlign: 'center',
          flexDirection: 'column',
          fontFamily: 'Arial, sans-serif'
        });
        
        blockOverlay.innerHTML = `
          <h2 style="margin-bottom: 20px;">Authentication Required</h2>
          <p style="margin-bottom: 10px;">Please log in through the extension to access this website.</p>
          <p style="font-size: 14px; margin-top: 10px;">
            Click the extension icon in the toolbar to login.
          </p>
          <div style="margin-top: 30px; font-size: 14px; color: #ccc;">
            This page will automatically unlock after successful login.
          </div>
        `;
        
        document.body.style.overflow = 'hidden';
        document.body.appendChild(blockOverlay);
        
        // Prevent any interaction
        blockOverlay.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
        });
        blockOverlay.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Remove any existing content
        const existingContent = Array.from(document.body.children);
        for (let element of existingContent) {
          if (element.id !== 'auth-block-overlay') {
            element.style.display = 'none';
          }
        }

        // Periodically check if user has logged in
        authCheckInterval = setInterval(() => {
          chrome.storage.local.get(["loggedIn"], (result) => {
            if (result.loggedIn) {
              clearInterval(authCheckInterval);
              removeBlockOverlay();
            }
          });
        }, 1000);
        
      } else if (isLoggedIn && blockOverlay) {
        // User is logged in, remove overlay
        clearInterval(authCheckInterval);
        removeBlockOverlay();
      }
    });
  }

  function removeBlockOverlay() {
    if (blockOverlay) {
      blockOverlay.remove();
      blockOverlay = null;
      document.body.style.overflow = '';
      
      // Restore all hidden content
      const existingContent = document.body.children;
      for (let element of existingContent) {
        element.style.display = '';
      }
      console.log("Page unlocked after successful login");
    }
  }

  // Initial auth check
  checkAuthAndBlock();

  // --- State --- //
  let seenVideos = new Set();
  let videoDetails = [];
  let watchTimes = {};
  let videoKeys = {};
  const processedVideoElements = new WeakSet();
  let currentVideoId = null;

  //------- user, session info --------//
  window.loggedInUser = null;
  window.sessionId = null;

  // ------- inactivity -------- //
  let inactivityStart = null;
  let inactivityTotal = 0;
  let trackingEnabled = false;
  let inactivitySessions = [];
  let potentialInactivityStart = null;
  let inactivityType = null;

  // ------ Sequential video counter  ---- //
  let videoCounter = 0;

  // --- Backend Push Helper --- //
  function pushInactivityToDB(start, end, duration, type) {
    if (!window.sessionId) return;

    const payload = {
      session_id: window.sessionId,
      starttime: new Date(start).toISOString(),
      endtime: new Date(end).toISOString(),
      duration: Math.round(duration / 1000), // seconds
      type: type,
    };

    fetch("https://extension1-production.up.railway.app/log_inactivity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("Inactivity pushed to DB:", data);

        // -----  Handle session split ---- //
        if (data.new_session_id) {
          console.warn("Session split detected. Switching to new session:", data.new_session_id);
          window.sessionId = data.new_session_id;

          // -----  Update storage ------ //
          chrome.storage.local.set({ session_id: data.new_session_id });

          //---- Tell popup too ----- //
          chrome.runtime.sendMessage({
            action: "session_split",
            new_session_id: data.new_session_id
          });
        }
      })
      .catch((err) => console.error("Inactivity push error:", err));
  }

  // --- Keyboard Tracking --- //
  async function enableKeyboardLock() {
    try {
      if (navigator.keyboard && navigator.keyboard.lock) {
        await navigator.keyboard.lock();
        console.log("Keyboard lock enabled.");
      }
    } catch (err) {
      console.warn("Keyboard lock not supported:", err);
    }
  }

  document.addEventListener("keydown", (e) => {
    if (trackingEnabled && currentVideoId) {
      if (!videoKeys[currentVideoId]) videoKeys[currentVideoId] = [];
      videoKeys[currentVideoId].push(e.key);
      console.log(`Key pressed on video ${currentVideoId}:`, e.key);
    }
  });

  // --- Inactivity Tracking ------ //
  function resetInactivity() {
    if (inactivityStart !== null) {
      const inactiveFor = Date.now() - inactivityStart;
      inactivityTotal += inactiveFor;

      const session = {
        start: new Date(inactivityStart).toLocaleString(),
        end: new Date().toLocaleString(),
        duration: Math.round(inactiveFor / 1000) + "s",
        type: inactivityType || "Unknown",
      };
      inactivitySessions.push(session);

      console.log(
        `Active again | Inactivity Type = ${session.type} | Start = ${session.start}, End = ${session.end}, Duration = ${session.duration}`
      );

      // -----  push to DB ------//
      pushInactivityToDB(inactivityStart, Date.now(), inactiveFor, inactivityType);

      inactivityStart = null;
      inactivityType = null;
    }
    potentialInactivityStart = null;
  }

  ["mousemove", "keydown", "mousedown", "scroll"].forEach((evt) =>
    document.addEventListener(evt, resetInactivity)
  );

  // ------  Inactivity no keyboard/mouse activity for 2 min ------- //
  setInterval(() => {
    if (trackingEnabled && !document.hidden) {
      if (potentialInactivityStart === null) {
        potentialInactivityStart = Date.now();
      } else if (
        !inactivityStart &&
        Date.now() - potentialInactivityStart >= 2 * 60 * 1000
      ) {
        inactivityStart = potentialInactivityStart;
        inactivityType = "No Keyboard/Mouse Activity";
        console.log(
          `Inactivity started at ${new Date(
            inactivityStart
          ).toLocaleString()} | Type: ${inactivityType}`
        );
      }
    } else {
      potentialInactivityStart = null;
    }
  }, 1000);

  // ------ When Tab is hidden / window minimized ------- //
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && trackingEnabled && inactivityStart === null) {
      inactivityStart = Date.now();
      inactivityType = "Window Minimized / Tab Hidden";
      console.log(
        `Inactivity started (tab minimized) at ${new Date(
          inactivityStart
        ).toLocaleString()}`
      );
    } else if (!document.hidden) {
      resetInactivity();
    }
  });

  // ------- Window on Window ------- //
  window.addEventListener("blur", () => {
    if (trackingEnabled && inactivityStart === null) {
      inactivityStart = Date.now();
      inactivityType = "Window Blurred (Lost Focus)";
      console.log(
        `Inactivity started (window blurred) at ${new Date(
          inactivityStart
        ).toLocaleString()}`
      );
    }
  });
  window.addEventListener("focus", resetInactivity);

  // --- UI Box + Reset --- //
  const counterBox = document.createElement("div");
  Object.assign(counterBox.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    background: "rgba(0, 0, 0, 0.8)",
    color: "#fff",
    padding: "10px",
    borderRadius: "8px",
    fontSize: "14px",
    zIndex: "9999",
    display: "none",
    maxWidth: "280px",
    lineHeight: "1.4em",
  });
  counterBox.innerHTML = `
    <div id="counterText">Unique Videos: 0 | Current Video Length: 0s</div>
    <div id="inactivityText" style="margin-top:4px;font-size:12px;color:#aaa;"></div>
  `;
  document.body.appendChild(counterBox);

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset";
  Object.assign(resetBtn.style, {
    marginTop: "6px",
    display: "block",
    background: "#ff5555",
    border: "none",
    color: "#fff",
    padding: "4px 8px",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
  });
  resetBtn.addEventListener("click", () => {
    resetAll();
  });
  counterBox.appendChild(resetBtn);

  function resetAll() {
    seenVideos.clear();
    videoDetails = [];
    watchTimes = {};
    videoKeys = {};
    currentVideoId = null;
    inactivityStart = null;
    inactivityTotal = 0;
    inactivitySessions = [];
    inactivityType = null;
    videoCounter = 0; // reset counter
    updateCounter(0);
    console.log("Reset all counters & inactivity sessions");
  }

  function updateCounter(currentDuration = 0) {
    const counterText = counterBox.querySelector("#counterText");
    counterText.textContent = `Unique Videos: ${videoCounter} | Current Video Length: ${Math.round(
      currentDuration
    )}s`;

    const inactivityText = counterBox.querySelector("#inactivityText");
    if (inactivitySessions.length > 0) {
      const last = inactivitySessions[inactivitySessions.length - 1];
      inactivityText.textContent = `Last Inactivity → ${last.type} | ${last.duration}`;
    } else {
      inactivityText.textContent = "";
    }
  }

  // --- Video Tracking ---  //
  function generateVideoId(video) {
    return [
      video.currentSrc || video.src || "nosrc",
      Math.round(video.duration) || "noduration",
      video.videoWidth + "x" + video.videoHeight,
    ].join("_");
  }

  function classifyWatchStatus(watched, duration) {
    if (watched <= 0) return "Not Watched";
    const ratio = watched / duration;
    if (ratio < 0.25) return "Barely Watched";
    if (ratio < 0.5) return "Partially Watched";
    if (ratio < 0.9) return "Mostly Watched";
    return "Fully Watched";
  }

  function finalizePrevious(videoId) {
    if (videoId && watchTimes[videoId] !== undefined) {
      const videoInfo = videoDetails.find((v) => v.id === videoId);
      if (videoInfo) {
        const watched = watchTimes[videoId];
        const total = Math.round(videoInfo.duration);
        const status = classifyWatchStatus(watched, total);
        const firstTime = videoInfo.firstTime === true;
        const keys = videoKeys[videoId] || [];

        console.log(
          `Finalized video ${videoInfo.src}: Duration=${total}s, Watched=${watched}s → Status: ${status} | Keys: ${
            keys.join(", ") || "None"
          }`
        );

        if (firstTime && window.sessionId) {
          videoCounter++; //increment for first video

          const videoEntry = {
            counter: videoCounter,
            session_id: window.sessionId,
            videoId: videoInfo.src,
            duration: total,
            watched: watched,
            status: status,
            keys: keys,
          };

          fetch("https://extension1-production.up.railway.app/log_video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(videoEntry),
          })
            .then((res) => res.json())
            .then((data) => console.log("Video pushed:", data))
            .catch((err) => console.error("Push error:", err));
        }

        videoInfo.firstTime = false;
        videoKeys[videoId] = [];
      }
    }
  }

  function trackVideo(video) {
    if (processedVideoElements.has(video)) return;
    processedVideoElements.add(video);

    function handleNewVideo() {
      let videoId = generateVideoId(video);

      if (!seenVideos.has(videoId)) {
        seenVideos.add(videoId);
        videoDetails.push({
          id: videoId,
          src: video.currentSrc || video.src,
          duration: video.duration,
          firstTime: true,
        });
        if (trackingEnabled)
          console.log(`New video counted ${videoId}: Duration=${video.duration}s`);
      }

      if (!watchTimes[videoId]) watchTimes[videoId] = 0;
      if (!videoKeys[videoId]) videoKeys[videoId] = [];

      let lastTime = 0;
      let interval = null;

      video.addEventListener("play", async () => {
        if (!trackingEnabled) return;
        if (currentVideoId && currentVideoId !== videoId)
          finalizePrevious(currentVideoId); //  finalize old before new starts
        currentVideoId = videoId;
        await enableKeyboardLock();
        updateCounter(video.duration);

        if (!interval) {
          interval = setInterval(() => {
            if (trackingEnabled && !video.paused && !video.ended) {
              let currentTime = Math.floor(video.currentTime);
              if (currentTime !== lastTime) {
                watchTimes[videoId]++;
                lastTime = currentTime;
              }
            }
          }, 1000);
        }
      });

      video.addEventListener("pause", () => {
        clearInterval(interval);
        interval = null;
      });

      video.addEventListener("ended", () => {
        clearInterval(interval);
        interval = null;
        if (trackingEnabled) finalizePrevious(videoId); //  finalize on end
      });
    }

    if (video.readyState >= 1) {
      handleNewVideo();
    } else {
      video.addEventListener("loadedmetadata", handleNewVideo, { once: true });
    }
  }

  function scanForVideos() {
    document.querySelectorAll("video").forEach((video) => {
      if (!processedVideoElements.has(video)) {
        trackVideo(video);
      }
    });
  }

  scanForVideos();
  const observer = new MutationObserver(scanForVideos);
  observer.observe(document.body, { childList: true, subtree: true });

  // --- Popup Messages ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "start") {
      trackingEnabled = true;
      counterBox.style.display = "block";
      window.loggedInUser = msg.username;
      window.sessionId = msg.session_id;
      videoCounter = 0; //  reset on new session
      console.log("Tracking started for user:", window.loggedInUser);
    } else if (msg.action === "stop") {
      trackingEnabled = false;
      counterBox.style.display = "none";
      console.log("Tracking stopped");

      if (currentVideoId) {
        finalizePrevious(currentVideoId); //  push last video
        currentVideoId = null;
      }

      if (window.sessionId) {
        fetch("https://extension1-production.up.railway.app/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: window.sessionId }),
        })
          .then((res) => res.json())
          .then((data) => console.log("Session ended:", data))
          .catch((err) => console.error("Logout error:", err));

        window.sessionId = null;
        window.loggedInUser = null;
      }
    } else if (msg.action === "reset_counter") {
      resetAll(); // handle reset from popup/login
    } else if (msg.action === "user_logged_in") {
      // User logged in - remove block overlay
      window.loggedInUser = msg.username;
      window.sessionId = msg.session_id;
      removeBlockOverlay();
    } else if (msg.action === "user_logged_out") {
      // User logged out - show block overlay
      window.loggedInUser = null;
      window.sessionId = null;
      trackingEnabled = false;
      counterBox.style.display = "none";
      checkAuthAndBlock();
    }
  });

  console.log("Video Tracker loaded on page.");
})();