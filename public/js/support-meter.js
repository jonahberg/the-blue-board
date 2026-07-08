// P3 cost-transparency meter — "what it costs to keep this free".
//
// Lazily fetches /api/support-stats the FIRST time the About/Donate popover (#legal-details)
// is opened, and renders a compact two-bar meter into #support-meter, right above the existing
// BMAC donate link. Deliberately defensive: any failure (network, non-200, unexpected shape, or
// an explicit {configured:false} on the live-feed side) must leave the popover exactly as it was
// — this widget only ever adds to the popover, never breaks it.
(function () {
  'use strict';

  var details = document.getElementById('legal-details');
  var mount = document.getElementById('support-meter');
  if (!details || !mount) return;

  var fetched = false;

  function pctClass(pct) {
    return pct >= 85 ? 'sm-bar-fill-warn' : '';
  }

  function renderBar(label, valueLabel, pct) {
    var clamped = Math.max(0, Math.min(100, pct));
    return (
      '<div class="sm-row">' +
        '<div class="sm-row-label"><span>' + label + '</span><span>' + valueLabel + '</span></div>' +
        '<div class="sm-bar"><div class="sm-bar-fill ' + pctClass(clamped) + '" style="width:' + clamped + '%"></div></div>' +
      '</div>'
    );
  }

  function render(data) {
    if (!data || typeof data !== 'object') return;

    var rows = '';

    var boards = data.boards;
    if (boards && Number.isFinite(boards.used) && Number.isFinite(boards.budget) && boards.budget > 0) {
      var boardsPct = (boards.used / boards.budget) * 100;
      rows += renderBar(
        "Today's board refreshes",
        boards.used + '/' + boards.budget,
        boardsPct
      );
    }

    var liveFeed = data.liveFeed;
    if (liveFeed && liveFeed.configured && Number.isFinite(liveFeed.usedPct)) {
      rows += renderBar(
        'Live-feed budget this month',
        '~' + liveFeed.usedPct + '% used',
        liveFeed.usedPct
      );
    }

    // Nothing meaningful to show (e.g. both sources unconfigured/malformed) — stay empty.
    if (!rows) return;

    var note = typeof data.monthlyCostNote === 'string' ? data.monthlyCostNote : '';

    mount.innerHTML =
      '<div class="sm-wrap">' +
        rows +
        (note ? '<p class="sm-note">' + note + '</p>' : '') +
      '</div>';
  }

  function load() {
    if (fetched) return;
    fetched = true;

    fetch('/api/support-stats')
      .then(function (resp) {
        if (!resp.ok) throw new Error('support-stats: ' + resp.status);
        return resp.json();
      })
      .then(render)
      .catch(function () {
        // Silent — the popover must not regress on fetch failure.
      });
  }

  details.addEventListener('toggle', function () {
    if (details.open) load();
  });
})();
