/* Tracker pages (/trackers/*) — search filter, table sort, map inspector card.
   External file so CSP can keep 'unsafe-inline' out of script-src.
   Progressive enhancement only: with this file blocked, the pages remain complete
   static documents. No innerHTML anywhere — visibility toggles and node moves only. */
(function () {
  'use strict';

  if (!document.querySelector('[data-trk-page]')) return;

  /* ---------- search ---------- */
  var searchWrap = document.querySelector('[data-trk-search-wrap]');
  var searchInput = document.querySelector('[data-trk-search]');
  var countEl = document.querySelector('[data-trk-count]');
  var emptyEl = document.querySelector('[data-trk-empty]');

  function normalize(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function applyFilter(query) {
    var q = normalize(query);
    var rows = document.querySelectorAll('[data-trk-row]');
    /* when the page renders the same entity in two surfaces (cards + table), only
       rows marked data-trk-count-item are tallied; pages with a single surface
       mark none and every row counts */
    var hasCountItems = !!document.querySelector('[data-trk-row][data-trk-count-item]');
    var visible = 0;
    for (var i = 0; i < rows.length; i++) {
      var hay = rows[i].getAttribute('data-trk-search-text') || '';
      var show = q === '' || hay.indexOf(q) !== -1;
      rows[i].hidden = !show;
      if (show && (!hasCountItems || rows[i].hasAttribute('data-trk-count-item'))) visible++;
    }
    /* collapse hub groups whose every row is hidden */
    var groups = document.querySelectorAll('[data-trk-group]');
    for (var g = 0; g < groups.length; g++) {
      var anyVisible = groups[g].querySelector('[data-trk-row]:not([hidden])');
      groups[g].hidden = !anyVisible;
    }
    if (countEl) {
      var noun = countEl.getAttribute('data-trk-noun') || 'results';
      var countedNoun = visible === 1 && /s$/.test(noun) ? noun.slice(0, -1) : noun;
      countEl.textContent = q === '' ? '' : visible + ' ' + countedNoun;
    }
    var heading = document.querySelector('[data-trk-result-heading]');
    if (heading) {
      var allLabel = heading.getAttribute('data-trk-heading-all') || heading.textContent;
      var headingNoun = heading.getAttribute('data-trk-heading-noun') || 'result';
      heading.textContent = q === ''
        ? allLabel
        : visible + ' matching ' + headingNoun + (visible === 1 ? '' : 's');
    }
    if (emptyEl) emptyEl.hidden = !(q !== '' && visible === 0);
  }

  if (searchInput) {
    if (searchWrap) searchWrap.hidden = false;
    searchInput.addEventListener('input', function () {
      applyFilter(searchInput.value);
    });
  }

  /* ---------- table sort ---------- */
  function sortValue(td) {
    var v = td ? td.getAttribute('data-sort') : '';
    return v === null ? '' : v;
  }

  function makeComparator(colIndex, dir) {
    return function (a, b) {
      var av = sortValue(a.children[colIndex]);
      var bv = sortValue(b.children[colIndex]);
      /* empties always sink to the bottom regardless of direction */
      if (av === '' && bv === '') return 0;
      if (av === '') return 1;
      if (bv === '') return -1;
      var an = parseFloat(av);
      var bn = parseFloat(bv);
      var cmp;
      if (!isNaN(an) && !isNaN(bn) && String(an) === av && String(bn) === bv) {
        cmp = an - bn;
      } else {
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      }
      return dir === 'desc' ? -cmp : cmp;
    };
  }

  document.addEventListener('click', function (ev) {
    var th = ev.target && ev.target.closest ? ev.target.closest('th[data-trk-sort]') : null;
    if (!th) return;
    var table = th.closest('table');
    var tbody = table && table.querySelector('[data-trk-tbody]');
    if (!tbody) return;

    var headers = table.querySelectorAll('th[data-trk-sort]');
    var current = th.getAttribute('aria-sort');
    for (var i = 0; i < headers.length; i++) headers[i].setAttribute('aria-sort', 'none');
    var dir = current === 'ascending' ? 'desc' : 'asc';
    th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');

    var colIndex = Array.prototype.indexOf.call(th.parentNode.children, th);
    var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    rows.sort(makeComparator(colIndex, dir));
    for (var r = 0; r < rows.length; r++) tbody.appendChild(rows[r]);
  });

  /* ---------- map inspector card ---------- */
  var cardSlot = document.querySelector('[data-trk-card-slot]');
  var cardHint = document.querySelector('[data-trk-card-hint]');
  var activeCard = null;

  function showCard(id) {
    if (!cardSlot) return;
    if (activeCard) activeCard.hidden = true;
    var next = cardSlot.querySelector('[data-trk-card="' + id + '"]');
    if (next) {
      if (cardHint) cardHint.hidden = true;
      next.hidden = false;
      activeCard = next;
    }
  }

  function markerId(el) {
    var m = el && el.closest ? el.closest('[data-trk-marker]') : null;
    return m ? m.getAttribute('data-trk-marker') : null;
  }

  var mapEl = document.querySelector('[data-trk-map]');
  if (mapEl && cardSlot) {
    mapEl.addEventListener('mouseover', function (ev) {
      var id = markerId(ev.target);
      if (id) showCard(id);
    });
    mapEl.addEventListener('focusin', function (ev) {
      var id = markerId(ev.target);
      if (id) showCard(id);
    });
    mapEl.addEventListener('click', function (ev) {
      var id = markerId(ev.target);
      if (id) showCard(id);
    });
    mapEl.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var id = markerId(ev.target);
      if (id) {
        ev.preventDefault();
        showCard(id);
      }
    });
  }

  /* ---------- return loop, personalization, watch + share ---------- */
  var pageSlug = document.body.getAttribute('data-trk-page') || '';
  var WATCH_KEY = 'bb_tracker_watches';

  function readWatches() {
    try {
      var parsed = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(function (w) {
        return w && typeof w.slug === 'string' && typeof w.id === 'string';
      }) : [];
    } catch (e) {
      return [];
    }
  }

  function saveWatches(watches) {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(watches.slice(0, 50))); } catch (e) {}
  }

  function isWatched(id) {
    return readWatches().some(function (w) { return w.slug === pageSlug && w.id === id; });
  }

  function syncWatchButtons() {
    var buttons = document.querySelectorAll('[data-trk-watch], [data-trk-pulse-watch]');
    for (var i = 0; i < buttons.length; i++) {
      var id = buttons[i].getAttribute('data-trk-watch-id');
      if (!id) continue;
      var active = isWatched(id);
      buttons[i].setAttribute('aria-pressed', active ? 'true' : 'false');
      buttons[i].textContent = active ? 'Watching' : (buttons[i].hasAttribute('data-trk-pulse-watch') ? 'Watch this ' + (buttons[i].getAttribute('data-trk-watch-kind') || 'place') : 'Watch');
    }
    var pulse = document.querySelector('[data-trk-pulse-watch]');
    var status = document.querySelector('[data-trk-watch-status]');
    if (pulse && status && pulse.getAttribute('data-trk-watch-id') && pulse.getAttribute('aria-pressed') === 'true') {
      status.textContent = 'Changes highlighted on return';
    }
  }

  function toggleWatch(id, label) {
    var watches = readWatches();
    var index = watches.findIndex(function (w) { return w.slug === pageSlug && w.id === id; });
    var active;
    if (index >= 0) {
      watches.splice(index, 1);
      active = false;
    } else {
      watches.push({ slug: pageSlug, id: id, label: label || id, addedAt: new Date().toISOString() });
      active = true;
    }
    saveWatches(watches);
    syncWatchButtons();
    var status = document.querySelector('[data-trk-watch-status]');
    if (status) status.textContent = active ? 'Changes highlighted on return' : 'Watch removed';
  }

  function fmtDay(iso) {
    try {
      return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  var configEl = document.querySelector('[data-trk-config]');
  if (configEl) {
    try {
      var config = JSON.parse(configEl.textContent || '{}');
      var seenKey = 'bb_tracker_seen_' + config.slug;
      var lastSeen = localStorage.getItem(seenKey) || '';
      var delta = document.querySelector('[data-trk-delta]');
      var unseen = lastSeen
        ? (config.changes || []).filter(function (change) { return change.date > lastSeen.slice(0, 10); })
        : [];
      if (delta && lastSeen) {
        delta.textContent = unseen.length
          ? unseen.length + ' change' + (unseen.length === 1 ? '' : 's') + ' since your last visit. ' + unseen[0].entry
          : 'No changes since ' + fmtDay(lastSeen.slice(0, 10)) + '. Sources rechecked ' + fmtDay(config.lastVerified) + '.';
      }

      var home = (localStorage.getItem('bb_home_airport') || '').toUpperCase();
      var entity = config.entities && config.entities[home];
      var personal = document.querySelector('[data-trk-personal]');
      var personalEmpty = document.querySelector('[data-trk-personal-empty]');
      var pulseWatch = document.querySelector('[data-trk-pulse-watch]');
      if (entity && personal) {
        personal.hidden = false;
        if (personalEmpty) personalEmpty.hidden = true;
        var codeEl = personal.querySelector('[data-trk-personal-code]');
        var summaryEl = personal.querySelector('[data-trk-personal-summary]');
        var linkEl = personal.querySelector('[data-trk-personal-link]');
        if (codeEl) codeEl.textContent = entity.label;
        if (summaryEl) summaryEl.textContent = entity.summary;
        if (linkEl) linkEl.href = entity.href;
        if (pulseWatch) {
          pulseWatch.hidden = false;
          pulseWatch.setAttribute('data-trk-watch-id', home.toLowerCase());
          pulseWatch.setAttribute('data-trk-watch-label', entity.label);
          pulseWatch.setAttribute('data-trk-watch-kind', config.kind);
        }
      }
      try { localStorage.setItem(seenKey, new Date().toISOString()); } catch (e) {}
    } catch (e) {
      /* A malformed enhancement config must never hide the static tracker. */
    }
  }

  syncWatchButtons();

  document.addEventListener('click', function (ev) {
    var watch = ev.target && ev.target.closest ? ev.target.closest('[data-trk-watch], [data-trk-pulse-watch]') : null;
    if (watch) {
      toggleWatch(watch.getAttribute('data-trk-watch-id') || '', watch.getAttribute('data-trk-watch-label') || '');
      return;
    }
    var share = ev.target && ev.target.closest ? ev.target.closest('[data-trk-share]') : null;
    if (!share) return;
    var href = share.getAttribute('data-trk-share-href') || location.pathname;
    var url = new URL(href, location.origin).toString();
    var label = share.getAttribute('data-trk-share-label') || document.title;
    if (navigator.share) {
      navigator.share({ title: label, url: url }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        var before = share.textContent;
        share.textContent = 'Copied';
        setTimeout(function () { share.textContent = before; }, 1600);
      }).catch(function () {});
    }
  });
})();
