(() => {
  if (window.videoTrackerLoaded) return;
  window.videoTrackerLoaded = true;

  // --- State ---
  let seenVideos = new Set();
  let videoDetails = [];
  let watchTimes = {};
  let videoKeys = {};
  const processedVideoElements = new WeakSet();
  let currentVideoId = null;

  // inactivity
  let inactivityStart = null;
  let inactivityTotal = 0;
  let trackingEnabled = false;
  let inactivitySessions = []; // store all inactivity logs
  let potentialInactivityStart = null;

  // --- Keyboard Tracking ---
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

  // --- Inactivity Tracking ---
  function resetInactivity() {
    if (inactivityStart !== null) {
      const inactiveFor = Date.now() - inactivityStart;
      inactivityTotal += inactiveFor;

      const session = {
        start: new Date(inactivityStart).toLocaleString(),
        end: new Date().toLocaleString(),
        duration: Math.round(inactiveFor / 1000) + "s"
      };
      inactivitySessions.push(session);

      console.log(
        `Active again | Inactivity session: Start = ${session.start}, End = ${session.end}, Duration = ${session.duration}`
      );

      inactivityStart = null;
    }
    potentialInactivityStart = null;
  }

  ["mousemove", "keydown", "mousedown", "scroll"].forEach(evt =>
    document.addEventListener(evt, resetInactivity)
  );

  setInterval(() => {
    if (trackingEnabled && !document.hidden) {
      if (potentialInactivityStart === null) {
        potentialInactivityStart = Date.now();
      } else if (!inactivityStart && Date.now() - potentialInactivityStart >= 2 * 60 * 1000) {
        inactivityStart = potentialInactivityStart;
        console.log(
          `Inactivity started at ${new Date(inactivityStart).toLocaleString()} (2 minutes threshold)`
        );
      }
    } else {
      potentialInactivityStart = null;
    }
  }, 1000);

  // Tab hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && trackingEnabled && inactivityStart === null) {
      inactivityStart = Date.now();
      console.log(`Inactivity started (tab minimized) at ${new Date(inactivityStart).toLocaleString()}`);
    } else if (!document.hidden) {
      resetInactivity();
    }
  });

  // Window focus/blur
  window.addEventListener("blur", () => {
    if (trackingEnabled && inactivityStart === null) {
      inactivityStart = Date.now();
      console.log(`Inactivity started (window blurred) at ${new Date(inactivityStart).toLocaleString()}`);
    }
  });
  window.addEventListener("focus", resetInactivity);

  // --- UI Box + Reset ---
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
    maxWidth: "260px",
    lineHeight: "1.4em"
  });
  counterBox.innerHTML = `<div id="counterText">Unique Videos: 0 | Current Video Length: 0s</div>`;
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
    seenVideos.clear();
    videoDetails = [];
    watchTimes = {};
    videoKeys = {};
    currentVideoId = null;
    inactivityStart = null;
    inactivityTotal = 0;
    inactivitySessions = [];
    updateCounter(0);
    console.log("Reset all counters & inactivity sessions");
  });
  counterBox.appendChild(resetBtn);

  function updateCounter(currentDuration = 0) {
    const counterText = counterBox.querySelector("#counterText");
    counterText.textContent =
      `Unique Videos: ${seenVideos.size} | Current Video Length: ${Math.round(currentDuration)}s`;
  }

  // --- Video Tracking ---
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
      const videoInfo = videoDetails.find(v => v.id === videoId);
      if (videoInfo) {
        const watched = watchTimes[videoId];
        const total = Math.round(videoInfo.duration);
        const status = classifyWatchStatus(watched, total);
        const firstTime = videoInfo.firstTime === true;
        const watchLabel = firstTime ? "Not Watched Before" : "Already Watched Before";
        const keys = videoKeys[videoId] || [];

        console.log(
          `Finalized video ${videoId}: Duration=${total}s, Watched=${watched}s → Status: ${status} | ${watchLabel} | Keys Pressed: ${keys.join(", ") || "None"}`
        );

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
        if (trackingEnabled) console.log(`New video counted ${videoId}: Duration=${video.duration}s`);
      }

      if (!watchTimes[videoId]) watchTimes[videoId] = 0;
      if (!videoKeys[videoId]) videoKeys[videoId] = [];

      let lastTime = 0;
      let interval = null;

      video.addEventListener("play", async () => {
        if (!trackingEnabled) return;
        if (currentVideoId && currentVideoId !== videoId) finalizePrevious(currentVideoId);
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
        if (trackingEnabled) finalizePrevious(videoId);
      });
    }

    if (video.readyState >= 1) {
      handleNewVideo();
    } else {
      video.addEventListener("loadedmetadata", handleNewVideo, { once: true });
    }
  }

  function scanForVideos() {
    document.querySelectorAll("video").forEach(video => {
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
      console.log("Tracking started");
    } else if (msg.action === "stop") {
      trackingEnabled = false;
      counterBox.style.display = "none";
      console.log("Tracking stopped");
    }
  });

  console.log("V1deo Tracker loaded. Use popup to Start/Stop.");
})();
