# YouTube Detox

A Chrome extension that helps you take control of your YouTube experience. No login required — just install and browse. All features are enabled by default and can be toggled from the extension popup.

## Features

### Disable Shorts
Hides all Shorts across YouTube — shelves, sidebar links, search results, and feed items. If a Short is opened directly, it can still play, but scrolling to other Shorts is blocked.

### Disable Recommendations
Hides the entire home page recommendation grid, so you only see content through your Subscriptions feed. A helpful link to your subscriptions is shown in place of the grid.

### Disable Auto-play
Ensures the auto-play toggle is always turned off when watching videos, preventing the next video from playing automatically.

### Disable Side Recommendations
Removes the suggested videos sidebar when watching a video, letting the player expand to full width.

### Disable "People Also Searched For"
Removes the "People also search for" cards that appear in search results.

### Disable Auto-preview
Stops videos from playing when hovering over thumbnails on the home page and feeds.

### Add Friction
Displays a configurable delay overlay before YouTube loads, giving you a moment to reconsider. Options include:
- **Delay duration** — 1 to 60 seconds
- **Trigger** — home page only, video pages only, or all pages
- **CAPTCHA** — optionally require a slider puzzle to proceed

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked** and select the project folder

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript, HTML, CSS
- Chrome Storage Sync API for persistent settings
- MutationObserver for YouTube's SPA navigation
