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

  function generateCaptcha() {
    const ops = [
      { sym: "+", fn: (a, b) => a + b },
      { sym: "-", fn: (a, b) => a - b },
      { sym: "×", fn: (a, b) => a * b },
    ];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let a, b;
    if (op.sym === "×") {
      a = Math.floor(Math.random() * 10) + 2;
      b = Math.floor(Math.random() * 10) + 2;
    } else if (op.sym === "-") {
      a = Math.floor(Math.random() * 40) + 10;
      b = Math.floor(Math.random() * a);
    } else {
      a = Math.floor(Math.random() * 50) + 10;
      b = Math.floor(Math.random() * 50) + 10;
    }
    return { question: `${a} ${op.sym} ${b}`, answer: op.fn(a, b) };
  }

  function dismissFrictionOverlay(overlay) {
    overlay.classList.add("ytd-friction-fade-out");
    setTimeout(() => overlay.remove(), 800);
  }

  function showCaptchaPhase(overlay) {
    const content = overlay.querySelector(".ytd-friction-content");
    if (!content) return;

    const captcha = generateCaptcha();

    content.innerHTML = `
      <div class="ytd-friction-icon">&#x1f512;</div>
      <div class="ytd-friction-title">One more thing...</div>
      <div class="ytd-friction-subtitle">Solve this to continue</div>
      <div class="ytd-captcha-question">${captcha.question} = ?</div>
      <input type="text" id="ytd-captcha-input" class="ytd-captcha-input"
             autocomplete="off" inputmode="numeric" placeholder="Answer">
      <div class="ytd-captcha-error" id="ytd-captcha-error"></div>
    `;

    // Focus the input after a frame
    requestAnimationFrame(() => {
      const input = document.getElementById("ytd-captcha-input");
      if (input) {
        input.focus();
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            const val = parseInt(input.value.trim(), 10);
            if (val === captcha.answer) {
              dismissFrictionOverlay(overlay);
            } else {
              const errEl = document.getElementById("ytd-captcha-error");
              if (errEl) errEl.textContent = "Wrong — try again";
              input.value = "";
              input.classList.add("ytd-captcha-shake");
              setTimeout(() => input.classList.remove("ytd-captcha-shake"), 400);
            }
          }
        });
      }
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
