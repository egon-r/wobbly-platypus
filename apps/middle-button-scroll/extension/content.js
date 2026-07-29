(function () {
  'use strict';

  /* ===== Configuration ===== */
  var MODE_KEY = 'mbs_mode';
  var DEFAULT_MODE = 'auto-scroll';

  /* ===== State ===== */
  var mode = DEFAULT_MODE;
  var active = false;
  var startX = 0;
  var startY = 0;
  var lastX = 0;
  var lastY = 0;
  var rafId = null;
  var hideTimeout = null;

  var hasStorage =
    typeof chrome !== 'undefined' &&
    chrome.storage &&
    typeof chrome.storage.sync === 'object' &&
    typeof chrome.storage.sync.get === 'function';

  var hasRuntime =
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    typeof chrome.runtime.onMessage === 'object' &&
    chrome.runtime.onMessage !== null;

  /* ===== Indicator ===== */

  function buildIndicator() {
    var el = document.createElement('div');
    el.id = '__mbs_indicator';
    el.setAttribute(
      'style',
      [
        'position:fixed',
        'top:16px',
        'right:16px',
        'z-index:2147483647',
        'background:rgba(0,0,0,0.78)',
        'color:#fff',
        'padding:6px 14px',
        'border-radius:8px',
        'font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif',
        'pointer-events:none',
        'opacity:0',
        'transition:opacity 0.3s ease',
        'display:flex',
        'align-items:center',
        'gap:6px',
        'backdrop-filter:blur(4px)',
        'letter-spacing:0.01em',
        'user-select:none',
      ].join(';')
    );
    el.innerHTML =
      '<span id="__mbs_dir" style="display:inline-block;width:14px;text-align:center;font-size:15px;line-height:1"></span>' +
      '<span id="__mbs_label"></span>';
    return el;
  }

  var indicator = buildIndicator();
  document.documentElement.appendChild(indicator);

  function showInd() {
    indicator.style.opacity = '1';
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  }

  function scheduleHide() {
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(function () {
      indicator.style.opacity = '0';
    }, 1500);
  }

  function setLabel(text) {
    var el = document.getElementById('__mbs_label');
    if (el) el.textContent = text;
  }

  function setDir(text) {
    var el = document.getElementById('__mbs_dir');
    if (el) el.textContent = text;
  }

  function clearDir() {
    setDir('');
  }

  /* ===== Direction helper (auto-scroll) ===== */
  function updateDirection(dx, dy) {
    var ax = Math.abs(dx);
    var ay = Math.abs(dy);
    var threshold = 5;

    if (ax < threshold && ay < threshold) {
      setDir('\u25C9'); /* ◉ */
      return;
    }

    if (ay >= ax) {
      setDir(dy < 0 ? '\u2191' : '\u2193'); /* ↑ / ↓ */
    } else {
      setDir(dx < 0 ? '\u2190' : '\u2192'); /* ← / → */
    }
  }

  /* ===== Mode management ===== */
  function applyMode(newMode) {
    mode = newMode;
    var label = mode === 'auto-scroll' ? 'Auto-scroll' : 'Drag-scroll';
    setLabel(label);
    showInd();
    scheduleHide();
  }

  function loadMode() {
    if (!hasStorage) return;
    try {
      chrome.storage.sync.get(MODE_KEY, function (result) {
        if (chrome.runtime && chrome.runtime.lastError) return;
        if (result && result[MODE_KEY]) {
          applyMode(result[MODE_KEY]);
        }
      });
    } catch (_) {
      /* storage unavailable */
    }
  }

  /* Listen for popup messages */
  if (hasRuntime) {
    try {
      chrome.runtime.onMessage.addListener(function (msg) {
        if (
          msg &&
          (msg.mode === 'auto-scroll' || msg.mode === 'drag-scroll')
        ) {
          applyMode(msg.mode);
        }
      });
    } catch (_) {
      /* runtime unavailable */
    }
  }

  /* ===== Scrolling ===== */

  function startAutoScroll() {
    function tick() {
      if (!active) return;

      var dx = lastX - startX;
      var dy = lastY - startY;
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 5) {
        var speed = Math.min(dist * 0.2, 40);
        var nx = dx / dist;
        var ny = dy / dist;
        window.scrollBy(nx * speed, ny * speed);
        updateDirection(dx, dy);
      } else {
        clearDir();
      }

      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  function stopScrolling() {
    if (!active) return;
    active = false;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    try {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    } catch (_) {
      /* body may not exist */
    }

    clearDir();
    scheduleHide();
  }

  /* ===== Event handlers ===== */

  function onMouseDown(e) {
    if (e.button !== 1) return;
    e.preventDefault();

    active = true;
    startX = e.clientX;
    startY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;

    try {
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    } catch (_) {
      /* body may not exist */
    }

    showInd();
    setLabel(mode === 'auto-scroll' ? 'Auto-scroll' : 'Drag-scroll');

    if (mode === 'auto-scroll') {
      startAutoScroll();
    }
  }

  function onMouseMove(e) {
    if (!active) return;

    if (mode === 'drag-scroll') {
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      window.scrollBy(-dx, -dy);
    }

    lastX = e.clientX;
    lastY = e.clientY;
  }

  function onMouseUp() {
    stopScrolling();
  }

  function onMouseLeave() {
    stopScrolling();
  }

  /* ===== Register listeners ===== */
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mouseleave', onMouseLeave);

  /* ===== Init ===== */
  loadMode();
})();
