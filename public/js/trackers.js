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
    var visible = 0;
    for (var i = 0; i < rows.length; i++) {
      var hay = rows[i].getAttribute('data-trk-search-text') || '';
      var show = q === '' || hay.indexOf(q) !== -1;
      rows[i].hidden = !show;
      if (show) visible++;
    }
    /* collapse hub groups whose every row is hidden */
    var groups = document.querySelectorAll('[data-trk-group]');
    for (var g = 0; g < groups.length; g++) {
      var anyVisible = groups[g].querySelector('[data-trk-row]:not([hidden])');
      groups[g].hidden = !anyVisible;
    }
    if (countEl) {
      var noun = countEl.getAttribute('data-trk-noun') || 'results';
      countEl.textContent = q === '' ? '' : visible + ' ' + noun;
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
})();
