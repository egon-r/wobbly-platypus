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

  /* Click-scroll state */
  var anchorX = 0;
  var anchorY = 0;

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

  /* ===== Gizmo (click-scroll crosshair overlay) ===== */

  var gizmo = null;

  function buildGizmo() {
    var el = document.createElement('div');
    el.id = '__mbs_gizmo';
    el.style.cssText =
      'position:fixed;z-index:2147483646;pointer-events:none;opacity:0;transition:opacity 0.2s ease;';
    el.innerHTML =
      '<svg width="60" height="60" viewBox="0 0 60 60" style="display:block;overflow:visible">' +
      /* Outer reticle circles */
      '<circle cx="30" cy="30" r="26" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="1.5"/>' +
      '<circle cx="30" cy="30" r="20" fill="none" stroke="rgba(0,0,0,0.1)" stroke-width="0.5"/>' +
      /* Crosshair lines */
      '<line x1="18" y1="30" x2="42" y2="30" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>' +
      '<line x1="30" y1="18" x2="30" y2="42" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>' +
      /* Center dot */
      '<circle cx="30" cy="30" r="2" fill="rgba(0,0,0,0.5)"/>' +
      /* Direction arrow (upward by default, rotated to match mouse direction) */
      '<polygon id="__mbs_arrow" points="30,8 26,18 34,18" fill="rgba(26,115,232,0.7)" opacity="0"/>' +
      '</svg>';
    return el;
  }

  function showGizmo(x, y) {
    if (!gizmo) {
      gizmo = buildGizmo();
      document.documentElement.appendChild(gizmo);
    }
    gizmo.style.left = x - 30 + 'px';
    gizmo.style.top = y - 30 + 'px';
    gizmo.style.opacity = '1';
  }

  function hideGizmo() {
    if (gizmo) {
      gizmo.style.opacity = '0';
    }
  }

  function updateGizmo(dx, dy, dist) {
    var arrow = document.getElementById('__mbs_arrow');
    if (!arrow) return;

    if (dist <= 5) {
      arrow.setAttribute('opacity', '0');
      return;
    }

    /* Rotate arrow to point in the direction of mouse movement */
    var angle = Math.atan2(dy, dx) * (180 / Math.PI);
    arrow.setAttribute('transform', 'rotate(' + angle + ', 30, 30)');

    /* Speed: arrow opacity scales with distance (0.3 → 1.0) */
    var speed = Math.min(dist / 100, 1);
    arrow.setAttribute('opacity', String(Math.max(0.3, speed)));
  }

  /* ===== Direction helper ===== */
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
    /* If switching away from click-scroll while it's active, deactivate it */
    if (active && mode === 'click-scroll' && newMode !== 'click-scroll') {
      stopClickScroll();
    }
    mode = newMode;
    var label =
      mode === 'auto-scroll'
        ? 'Auto-scroll'
        : mode === 'drag-scroll'
          ? 'Drag-scroll'
          : 'Click-scroll';
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
          (msg.mode === 'auto-scroll' ||
            msg.mode === 'drag-scroll' ||
            msg.mode === 'click-scroll')
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

  /* ===== Click-scroll ===== */

  function startClickScroll(e) {
    active = true;
    anchorX = e.clientX;
    anchorY = e.clientY;

    showGizmo(anchorX, anchorY);
    showInd();
    setLabel('Click-scroll');
    setDir('\u25C9'); /* ◉ */

    try {
      document.body.style.cursor = 'crosshair';
      document.body.style.userSelect = 'none';
    } catch (_) {
      /* body may not exist */
    }
  }

  function stopClickScroll() {
    active = false;

    hideGizmo();

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

    if (mode === 'click-scroll') {
      if (active) {
        stopClickScroll();
      } else {
        startClickScroll(e);
      }
      return;
    }

    /* Auto-scroll / Drag-scroll (existing behavior) */
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

    if (mode === 'click-scroll') {
      var dx = e.clientX - anchorX;
      var dy = e.clientY - anchorY;
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 5) {
        window.scrollBy(dx * 0.1, dy * 0.1);
        updateDirection(dx, dy);
        updateGizmo(dx, dy, dist);
      } else {
        setDir('\u25C9'); /* ◉ */
        updateGizmo(dx, dy, dist);
      }
      return;
    }

    if (mode === 'drag-scroll') {
      var dx2 = e.clientX - lastX;
      var dy2 = e.clientY - lastY;
      window.scrollBy(-dx2, -dy2);
    }

    lastX = e.clientX;
    lastY = e.clientY;
  }

  function onMouseUp() {
    if (mode === 'click-scroll') {
      /* Do not deactivate — toggle mode stays active until next click */
      return;
    }
    stopScrolling();
  }

  function onMouseLeave() {
    if (mode === 'click-scroll') {
      /* Keep active but subtly fade the gizmo */
      if (gizmo) {
        gizmo.style.opacity = '0.15';
      }
      return;
    }
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
