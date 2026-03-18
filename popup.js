// YouTube Detox - Popup Script

const TOGGLE_KEYS = [
  "disableShorts",
  "disableRecommendations",
  "disableAutoplay",
  "disableSideRecs",
  "disableAlsoSearched",
  "disableAutoPreview",
  "frictionEnabled",
];

const DEFAULT_SETTINGS = {
  disableShorts: true,
  disableRecommendations: true,
  disableAutoplay: true,
  disableSideRecs: true,
  disableAlsoSearched: true,
  disableAutoPreview: true,
  frictionEnabled: true,
  frictionDuration: 5,
  frictionTrigger: "home",
};

const frictionOptions = document.getElementById("frictionOptions");
const frictionDuration = document.getElementById("frictionDuration");
const frictionTrigger = document.getElementById("frictionTrigger");
const frictionToggle = document.getElementById("frictionEnabled");

function updateFrictionVisibility(enabled) {
  if (frictionOptions) {
    frictionOptions.classList.toggle("visible", enabled);
  }
}

// Load settings and set all control states
chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
  for (const key of TOGGLE_KEYS) {
    const checkbox = document.getElementById(key);
    if (checkbox) {
      checkbox.checked = result[key];
    }
  }
  if (frictionDuration) frictionDuration.value = result.frictionDuration;
  if (frictionTrigger) frictionTrigger.value = result.frictionTrigger;
  updateFrictionVisibility(result.frictionEnabled);
});

// Save toggle settings when changed
for (const key of TOGGLE_KEYS) {
  const checkbox = document.getElementById(key);
  if (checkbox) {
    checkbox.addEventListener("change", () => {
      chrome.storage.sync.set({ [key]: checkbox.checked });
    });
  }
}

// Friction toggle also shows/hides options
if (frictionToggle) {
  frictionToggle.addEventListener("change", () => {
    updateFrictionVisibility(frictionToggle.checked);
  });
}

// Friction duration
if (frictionDuration) {
  frictionDuration.addEventListener("change", () => {
    const val = Math.max(1, Math.min(60, parseInt(frictionDuration.value) || 5));
    frictionDuration.value = val;
    chrome.storage.sync.set({ frictionDuration: val });
  });
}

// Friction trigger
if (frictionTrigger) {
  frictionTrigger.addEventListener("change", () => {
    chrome.storage.sync.set({ frictionTrigger: frictionTrigger.value });
  });
}
