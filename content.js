(() => {
  if (window.videoTrackerLoaded) return;
  window.videoTrackerLoaded = true;

  let seenVideos = new Set();
  let videoDetails = [];
  let watchTimes = {};
  const processedVideoElements = new WeakSet();
  let currentVideoId = null;
  let inactivityStart = null;
  let inactivityTotal = 0;
  let trackingEnabled = false; // Start/Stop flag

//  Inactivity / Activity Tracking
  function resetInactivity() {
    if (inactivityStart !== null) {
      const inactiveFor = Date.now() - inactivityStart;
      inactivityTotal += inactiveFor;
      console.log(` User active again after ${Math.round(inactiveFor / 1000)}s inactivity.`);
      inactivityStart = null;
    }
    // Reset potential inactivity so 2-min threshold starts fresh
    potentialInactivityStart = null;
  }

  ["mousemove", "keydown", "mousedown", "scroll"].forEach(evt =>
    document.addEventListener(evt, resetInactivity)
  );

  // Only start inactivity timer after 2 minutes
  let potentialInactivityStart = null;
  setInterval(() => {
    if (trackingEnabled && !document.hidden) {
      if (potentialInactivityStart === null) {
        potentialInactivityStart = Date.now();
      } else if (!inactivityStart && Date.now() - potentialInactivityStart >= 2 * 60 * 1000) {
        // 2 minutes of inactivity passed
        inactivityStart = potentialInactivityStart;
        console.log(" Inactivity started (2 minutes threshold reached)");
      }
    } else {
      potentialInactivityStart = null; // Reset if tab hidden or tracking stopped
    }
  }, 1000); 

  // Counter Box UI (hidden by default)
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
    display: "none"
  });
  counterBox.textContent = "Unique Videos: 0 | Current Video Length: 0s";
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
    currentVideoId = null;
    inactivityStart = null;
    inactivityTotal = 0;
    updateCounter(0);
    console.log("🔄 Reset all counters");
  });
  counterBox.appendChild(resetBtn);

  function updateCounter(currentDuration = 0) {
    counterBox.firstChild.textContent =
      `Unique Videos: ${seenVideos.size} | Current Video Length: ${Math.round(currentDuration)}s`;
  }

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
        console.log(
          `Finalized video ${videoId}: Duration=${total}s, Watched=${watched}s → Status: ${status} | ${watchLabel}`
        );
        videoInfo.firstTime = false;
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
      } else {
        if (trackingEnabled) console.log(`Video ${videoId} detected again (Already Watched).`);
      }

      if (!watchTimes[videoId]) watchTimes[videoId] = 0;

      let lastTime = 0;
      let interval = null;

      video.addEventListener("play", () => {
        if (!trackingEnabled) return;
        if (currentVideoId && currentVideoId !== videoId) finalizePrevious(currentVideoId);
        currentVideoId = videoId;
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

  // 🔑 Listen to popup messages
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

  console.log("111,,Video Tracker loaded. Use popup to Start/Stop.");
})();