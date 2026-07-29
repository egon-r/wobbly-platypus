(function () {
  'use strict';

  var MODE_KEY = 'mbs_mode';

  var cards = document.querySelectorAll('.mode-card');
  var currentMode = 'auto-scroll';

  /* Load current mode */
  function loadMode() {
    try {
      chrome.storage.sync.get(MODE_KEY, function (result) {
        if (chrome.runtime && chrome.runtime.lastError) return;
        if (result && result[MODE_KEY]) {
          currentMode = result[MODE_KEY];
          highlightCard(currentMode);
        }
      });
    } catch (_) {
      /* storage unavailable, use default */
    }
  }

  /* Highlight the selected card */
  function highlightCard(mode) {
    cards.forEach(function (card) {
      var isSelected = card.getAttribute('data-mode') === mode;
      card.classList.toggle('selected', isSelected);
    });
  }

  /* Save mode and notify content script */
  function selectMode(mode) {
    if (mode === currentMode) return;
    currentMode = mode;

    /* Save to storage */
    try {
      chrome.storage.sync.set(
        { mbs_mode: mode },
        function () {
          if (chrome.runtime && chrome.runtime.lastError) {
            /* silent fail */
          }
        }
      );
    } catch (_) {
      /* silent fail */
    }

    highlightCard(mode);

    /* Notify active tab */
    try {
      chrome.tabs.query(
        { active: true, currentWindow: true },
        function (tabs) {
          if (!tabs || !tabs.length) return;
          tabs.forEach(function (tab) {
            try {
              chrome.tabs.sendMessage(tab.id, { mode: mode }, function () {
                /* Ignore errors (content script may not be injected yet) */
                if (chrome.runtime && chrome.runtime.lastError) {
                  /* silent */
                }
              });
            } catch (_) {
              /* silent */
            }
          });
        }
      );
    } catch (_) {
      /* silent */
    }
  }

  /* Click handlers */
  cards.forEach(function (card) {
    card.addEventListener('click', function () {
      var mode = card.getAttribute('data-mode');
      if (mode) selectMode(mode);
    });
  });

  /* Init */
  loadMode();
})();
