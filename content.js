// YouTube Detox - Content Script
// Runs on all youtube.com pages at document_start

(function () {
  "use strict";

  const DEFAULT_SETTINGS = {
    disableShorts: true,
    disableRecommendations: true,
    disableAutoplay: true,
    disableSideRecs: true,
    disableAlsoSearched: true,
    disableAutoPreview: true,
    frictionEnabled: true,
    frictionDuration: 5,
    frictionTrigger: "home", // "home" | "video" | "all"
    frictionCaptcha: true,
  };

  let settings = { ...DEFAULT_SETTINGS };
  let debounceTimer = null;
  let shortsKeyBlockInstalled = false;
  let frictionShownForUrl = null; // track to avoid re-showing on same page

  // --- Settings ---

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
        settings = result;
        resolve(settings);
      });
    });
  }

  function applyBodyClasses() {
    if (!document.body) return;
    document.body.classList.toggle(
      "ytd-shorts-disabled",
      settings.disableShorts
    );
    document.body.classList.toggle(
      "ytd-recs-disabled",
      settings.disableRecommendations
    );
    document.body.classList.toggle(
      "ytd-side-recs-disabled",
      settings.disableSideRecs
    );
    document.body.classList.toggle(
      "ytd-also-search-disabled",
      settings.disableAlsoSearched
    );
    document.body.classList.toggle(
      "ytd-no-preview",
      settings.disableAutoPreview
    );
  }

  // --- Helpers ---

  function isHomePage() {
    return location.pathname === "/" || location.pathname === "";
  }

  function isWatchPage() {
    return location.pathname === "/watch";
  }

  function isShortsPage() {
    return location.pathname.startsWith("/shorts/");
  }

  // --- Feature: Disable Shorts scrolling on /shorts/ pages ---

  function handleShortsPage() {
    if (!settings.disableShorts) return;
    if (!isShortsPage()) return;

    // Block keyboard navigation between shorts (install once)
    if (!shortsKeyBlockInstalled) {
      shortsKeyBlockInstalled = true;
      document.addEventListener(
        "keydown",
        (e) => {
          if (!settings.disableShorts || !isShortsPage()) return;
          if (["ArrowUp", "ArrowDown", "j", "k"].includes(e.key)) {
            e.stopPropagation();
            e.preventDefault();
          }
        },
        true // capture phase to intercept before YouTube's handlers
      );
    }

    // Block scroll and swipe on the shorts container (install once)
    const shortsContainer = document.querySelector("ytd-shorts");
    if (shortsContainer && !shortsContainer._ytdScrollBlocked) {
      shortsContainer._ytdScrollBlocked = true;
      shortsContainer.addEventListener(
        "wheel",
        (e) => {
          if (!settings.disableShorts) return;
          e.stopPropagation();
          e.preventDefault();
        },
        { passive: false, capture: true }
      );
      shortsContainer.addEventListener(
        "touchmove",
        (e) => {
          if (!settings.disableShorts) return;
          e.stopPropagation();
          e.preventDefault();
        },
        { passive: false, capture: true }
      );
    }

    // Don't touch the DOM — just let the active short play normally.
    // Scroll and keyboard blocking above prevents navigating to other shorts.
  }

  // --- Feature: Hide Shorts in search results (JS fallback for dynamic loading) ---

  function hideShortsInSearch() {
    if (!settings.disableShorts) return;
    if (location.pathname !== "/results") return;

    // Re-scan every time — hrefs may not be populated on first DOM insertion
    const selectors = [
      "ytd-video-renderer",
      "ytd-compact-video-renderer",
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((renderer) => {
        const link = renderer.querySelector('a[href*="/shorts/"]');
        if (link) {
          renderer.style.display = "none";
        }
      });
    }

    // Hide newer shorts components (grid shelf, lockup models)
    document
      .querySelectorAll(
        "grid-shelf-view-model, ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model"
      )
      .forEach((el) => (el.style.display = "none"));
  }

  // --- Feature: Disable Recommendations (non-subscribed channels) ---
  // CSS hides the entire #contents grid on the home page via body.ytd-recs-disabled.
  // This prevents the infinite-reload loop that happens when hiding individual items
  // (YouTube detects empty space and loads more recommendations to fill it).
  // JS only needs to insert the hint message.

  function hideNonSubscribedVideos() {
    if (!settings.disableRecommendations) return;
    if (!isHomePage()) return;
    showSubscriptionHint();
  }

  function showSubscriptionHint() {
    if (!isHomePage()) return;
    if (document.querySelector("#ytd-detox-hint")) return;

    const primary = document.querySelector(
      "ytd-browse[page-subtype='home'] ytd-rich-grid-renderer"
    );
    if (!primary) return;

    const hint = document.createElement("div");
    hint.id = "ytd-detox-hint";
    hint.style.cssText = `
      text-align: center;
      padding: 60px 20px;
      color: var(--yt-spec-text-secondary, #aaa);
      font-family: 'YouTube Sans', 'Roboto', sans-serif;
      font-size: 16px;
      line-height: 1.6;
    `;
    hint.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 16px;">&#x1f9d8;</div>
      <div style="font-size: 20px; font-weight: 500; color: var(--yt-spec-text-primary, #fff); margin-bottom: 8px;">
        YouTube Detox is active
      </div>
      <div>Recommendations are hidden. Visit your
        <a href="/feed/subscriptions" style="color: #3ea6ff; text-decoration: none;">Subscriptions</a>
        feed to see videos from channels you follow.
      </div>
    `;
    primary.prepend(hint);
  }

  // --- Feature: Disable Auto-play ---

  function disableAutoplay() {
    if (!settings.disableAutoplay) return;
    if (!isWatchPage()) return;

    // Click the autoplay toggle if it's currently on
    const toggle = document.querySelector(".ytp-autonav-toggle-button");
    if (toggle && toggle.getAttribute("aria-checked") === "true") {
      toggle.click();
    }
  }

  // --- Feature: Friction overlay ---

  function shouldShowFriction() {
    if (!settings.frictionEnabled) return false;
    const trigger = settings.frictionTrigger;
    if (trigger === "home") return isHomePage();
    if (trigger === "video") return isWatchPage();
    // "all"
    return true;
  }

  function dismissFrictionOverlay(overlay) {
    overlay.classList.add("ytd-friction-fade-out");
    setTimeout(() => overlay.remove(), 800);
  }

  // --- Slider puzzle CAPTCHA ---

  function drawPuzzlePiecePath(ctx, x, y, size) {
    // Draws a jigsaw-piece shaped clip path
    const s = size;
    const tab = s * 0.25; // tab bump size
    ctx.beginPath();
    ctx.moveTo(x, y);
    // Top edge with tab
    ctx.lineTo(x + s * 0.35, y);
    ctx.bezierCurveTo(
      x + s * 0.35, y - tab,
      x + s * 0.65, y - tab,
      x + s * 0.65, y
    );
    ctx.lineTo(x + s, y);
    // Right edge with tab
    ctx.lineTo(x + s, y + s * 0.35);
    ctx.bezierCurveTo(
      x + s + tab, y + s * 0.35,
      x + s + tab, y + s * 0.65,
      x + s, y + s * 0.65
    );
    ctx.lineTo(x + s, y + s);
    // Bottom edge
    ctx.lineTo(x, y + s);
    // Left edge
    ctx.lineTo(x, y);
    ctx.closePath();
  }

  function showCaptchaPhase(overlay) {
    const content = overlay.querySelector(".ytd-friction-content");
    if (!content) return;

    const W = 320;
    const H = 180;
    const pieceSize = 50;
    // Random target X for the puzzle hole (keep away from edges)
    const targetX = Math.floor(Math.random() * (W - pieceSize * 2 - 40)) + pieceSize + 20;
    const targetY = Math.floor((H - pieceSize) / 2);
    const tolerance = 5;

    content.innerHTML = `
      <div class="ytd-friction-title" style="margin-bottom:16px">Verify you're human</div>
      <div class="ytd-friction-subtitle" style="margin-bottom:20px">Drag the slider to complete the puzzle</div>
      <div class="ytd-captcha-canvas-wrap" id="ytd-captcha-wrap">
        <canvas id="ytd-captcha-bg" width="${W}" height="${H}"></canvas>
        <canvas id="ytd-captcha-piece" width="${pieceSize + 10}" height="${H}"
                style="position:absolute;top:0;left:0;"></canvas>
      </div>
      <div class="ytd-captcha-slider-track" id="ytd-captcha-track">
        <div class="ytd-captcha-slider-thumb" id="ytd-captcha-thumb">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
        <div class="ytd-captcha-slider-label" id="ytd-captcha-label">Slide to complete</div>
      </div>
      <div class="ytd-captcha-status" id="ytd-captcha-status"></div>
    `;

    requestAnimationFrame(() => {
      const bgCanvas = document.getElementById("ytd-captcha-bg");
      const pieceCanvas = document.getElementById("ytd-captcha-piece");
      if (!bgCanvas || !pieceCanvas) return;

      const bgCtx = bgCanvas.getContext("2d");
      const pcCtx = pieceCanvas.getContext("2d");

      // Draw a colorful abstract background
      const grad = bgCtx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, "#1a237e");
      grad.addColorStop(0.3, "#4a148c");
      grad.addColorStop(0.6, "#006064");
      grad.addColorStop(1, "#1b5e20");
      bgCtx.fillStyle = grad;
      bgCtx.fillRect(0, 0, W, H);

      // Draw random geometric shapes for visual complexity
      for (let i = 0; i < 20; i++) {
        bgCtx.fillStyle = `hsla(${Math.random() * 360}, 70%, 60%, 0.15)`;
        bgCtx.beginPath();
        const cx = Math.random() * W;
        const cy = Math.random() * H;
        const r = Math.random() * 40 + 10;
        bgCtx.arc(cx, cy, r, 0, Math.PI * 2);
        bgCtx.fill();
      }
      for (let i = 0; i < 12; i++) {
        bgCtx.strokeStyle = `hsla(${Math.random() * 360}, 60%, 70%, 0.2)`;
        bgCtx.lineWidth = Math.random() * 3 + 1;
        bgCtx.beginPath();
        bgCtx.moveTo(Math.random() * W, Math.random() * H);
        bgCtx.lineTo(Math.random() * W, Math.random() * H);
        bgCtx.stroke();
      }

      // Draw small dots grid
      bgCtx.fillStyle = "rgba(255,255,255,0.08)";
      for (let gx = 0; gx < W; gx += 16) {
        for (let gy = 0; gy < H; gy += 16) {
          bgCtx.fillRect(gx, gy, 1, 1);
        }
      }

      // Extract the puzzle piece image from the background
      pcCtx.save();
      drawPuzzlePiecePath(pcCtx, 5, targetY, pieceSize);
      pcCtx.clip();
      pcCtx.drawImage(bgCanvas, targetX - 5, 0, pieceSize + 10, H, 0, 0, pieceSize + 10, H);
      pcCtx.restore();

      // Draw piece outline
      pcCtx.save();
      drawPuzzlePiecePath(pcCtx, 5, targetY, pieceSize);
      pcCtx.strokeStyle = "rgba(255,255,255,0.8)";
      pcCtx.lineWidth = 2;
      pcCtx.stroke();
      pcCtx.restore();

      // Draw the hole on the background
      bgCtx.save();
      drawPuzzlePiecePath(bgCtx, targetX, targetY, pieceSize);
      bgCtx.fillStyle = "rgba(0,0,0,0.5)";
      bgCtx.fill();
      bgCtx.strokeStyle = "rgba(255,255,255,0.3)";
      bgCtx.lineWidth = 2;
      bgCtx.stroke();
      bgCtx.restore();

      // Slider interaction
      const thumb = document.getElementById("ytd-captcha-thumb");
      const track = document.getElementById("ytd-captcha-track");
      const label = document.getElementById("ytd-captcha-label");
      const status = document.getElementById("ytd-captcha-status");
      if (!thumb || !track) return;

      let dragging = false;
      let startX = 0;
      let currentOffset = 0;
      const trackWidth = W;
      const thumbWidth = 44;
      const maxOffset = trackWidth - thumbWidth;

      function updatePiecePosition(offset) {
        const piecePx = (offset / maxOffset) * (W - pieceSize - 10);
        pieceCanvas.style.left = piecePx + "px";
      }

      function onStart(e) {
        dragging = true;
        startX = (e.touches ? e.touches[0].clientX : e.clientX) - currentOffset;
        thumb.classList.add("ytd-captcha-thumb-active");
        if (label) label.style.opacity = "0";
      }

      function onMove(e) {
        if (!dragging) return;
        e.preventDefault();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let offset = clientX - startX;
        offset = Math.max(0, Math.min(maxOffset, offset));
        currentOffset = offset;
        thumb.style.transform = `translateX(${offset}px)`;
        updatePiecePosition(offset);
      }

      function onEnd() {
        if (!dragging) return;
        dragging = false;
        thumb.classList.remove("ytd-captcha-thumb-active");

        // Check if piece is in the right position
        const piecePx = (currentOffset / maxOffset) * (W - pieceSize - 10);
        const targetPx = targetX - 5;

        if (Math.abs(piecePx - targetPx) <= tolerance) {
          // Success
          thumb.style.background = "#4caf50";
          if (status) {
            status.textContent = "✓ Verified";
            status.style.color = "#4caf50";
          }
          pieceCanvas.style.left = targetPx + "px";
          setTimeout(() => dismissFrictionOverlay(overlay), 600);
        } else {
          // Fail — reset
          if (status) {
            status.textContent = "Try again";
            status.style.color = "#ff4444";
          }
          thumb.classList.add("ytd-captcha-shake");
          setTimeout(() => {
            thumb.classList.remove("ytd-captcha-shake");
            currentOffset = 0;
            thumb.style.transform = "translateX(0)";
            pieceCanvas.style.left = "0px";
            if (label) label.style.opacity = "1";
            if (status) status.textContent = "";
          }, 500);
        }
      }

      thumb.addEventListener("mousedown", onStart);
      thumb.addEventListener("touchstart", onStart, { passive: true });
      document.addEventListener("mousemove", onMove);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("mouseup", onEnd);
      document.addEventListener("touchend", onEnd);
    });
  }

  function showFrictionOverlay() {
    if (!shouldShowFriction()) return;

    // Don't re-show for the same URL
    const currentUrl = location.href;
    if (frictionShownForUrl === currentUrl) return;
    frictionShownForUrl = currentUrl;

    // Don't double-create
    if (document.querySelector("#ytd-friction-overlay")) return;

    const duration = Math.max(1, settings.frictionDuration || 5);

    const overlay = document.createElement("div");
    overlay.id = "ytd-friction-overlay";
    overlay.innerHTML = `
      <div class="ytd-friction-content">
        <div class="ytd-friction-icon">&#x1f9d8;</div>
        <div class="ytd-friction-title">Take a moment...</div>
        <div class="ytd-friction-subtitle">Do you really need to be here right now?</div>
        <div class="ytd-friction-bar-track">
          <div class="ytd-friction-bar-fill" id="ytd-friction-bar-fill"></div>
        </div>
        <div class="ytd-friction-time" id="ytd-friction-time">${duration}s</div>
      </div>
    `;
    document.documentElement.appendChild(overlay);

    // Start the progress bar animation after a frame so the transition kicks in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const fill = document.getElementById("ytd-friction-bar-fill");
        if (fill) {
          fill.style.transition = `width ${duration}s linear`;
          fill.style.width = "100%";
        }
      });
    });

    // Countdown text
    let remaining = duration;
    const timeEl = document.getElementById("ytd-friction-time");
    const countdownInterval = setInterval(() => {
      remaining--;
      if (timeEl) timeEl.textContent = `${Math.max(0, remaining)}s`;
      if (remaining <= 0) clearInterval(countdownInterval);
    }, 1000);

    // After timer: either show captcha or fade out
    setTimeout(() => {
      clearInterval(countdownInterval);
      if (settings.frictionCaptcha) {
        showCaptchaPhase(overlay);
      } else {
        dismissFrictionOverlay(overlay);
      }
    }, duration * 1000);
  }

  // --- Main loop ---

  function runAllFeatures() {
    applyBodyClasses();
    handleShortsPage();
    hideShortsInSearch();
    hideNonSubscribedVideos();
    disableAutoplay();
  }

  function scheduleRun() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      runAllFeatures();
    }, 150);
  }

  function resetHint() {
    const oldHint = document.querySelector("#ytd-detox-hint");
    if (oldHint) oldHint.remove();
  }

  // --- Init ---

  async function init() {
    await loadSettings();

    // At document_start, body may not exist yet - wait for it
    if (!document.body) {
      await new Promise((resolve) => {
        const obs = new MutationObserver(() => {
          if (document.body) {
            obs.disconnect();
            resolve();
          }
        });
        obs.observe(document.documentElement, { childList: true });
      });
    }

    // Immediately apply default body classes to prevent flash of hidden content.
    // Since all features default to ON, this hides everything right away.
    // applyBodyClasses() below will adjust if any feature is actually off.
    document.body.classList.add(
      "ytd-shorts-disabled",
      "ytd-recs-disabled",
      "ytd-side-recs-disabled",
      "ytd-also-search-disabled",
      "ytd-no-preview"
    );

    runAllFeatures();

    // Watch for DOM changes (YouTube is a SPA with dynamic content loading)
    new MutationObserver(scheduleRun).observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Show friction overlay on initial load
    showFrictionOverlay();

    // YouTube SPA navigation events
    window.addEventListener("yt-navigate-finish", () => {
      resetHint();
      showFrictionOverlay();
      runAllFeatures();
    });

    // Settings changed from popup
    chrome.storage.onChanged.addListener((changes) => {
      for (const key of Object.keys(changes)) {
        settings[key] = changes[key].newValue;
      }
      resetHint();
      runAllFeatures();
    });

    // Safety net: periodic check for anything missed by the observer
    setInterval(runAllFeatures, 2000);
  }

  init();
})();
