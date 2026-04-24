// News banner — defer /data/news-latest.json until after load so it stays off
// the critical path. Extracted from public/index.html so Content-Security-
// Policy can drop 'unsafe-inline' from script-src.
(function () {
  function loadNewsBanner() {
    try {
      fetch('/data/news-latest.json')
        .then(function (r) {
          if (!r.ok) return;
          return r.json();
        })
        .then(function (d) {
          if (!d || !d.length) return;
          var banner = document.getElementById('news-banner');
          if (!banner) return;
          var dismissed = localStorage.getItem('news_dismissed_slug');
          if (dismissed === d[0].slug) return;
          var link = document.getElementById('news-banner-link');
          var read = document.getElementById('news-banner-read');
          var idx = 0;
          var paused = false;
          var timer = null;
          function show(i) {
            var a = d[i];
            link.style.opacity = '0';
            setTimeout(
              function () {
                link.textContent = a.title;
                link.href = '/news/' + a.slug;
                read.href = '/news/' + a.slug;
                link.style.opacity = '1';
              },
              d.length > 1 ? 400 : 0
            );
          }
          function advance() {
            if (paused || d.length < 2) return;
            idx = (idx + 1) % d.length;
            show(idx);
          }
          show(0);
          banner.style.display = 'flex';
          if (d.length > 1) {
            timer = setInterval(advance, 6000);
            banner.addEventListener('mouseenter', function () {
              paused = true;
            });
            banner.addEventListener('mouseleave', function () {
              paused = false;
            });
          }
          link.addEventListener('click', function () {
            try {
              window.va && window.va.track('news_banner_click', { slug: d[idx].slug });
            } catch (e) {}
          });
          read.addEventListener('click', function () {
            try {
              window.va && window.va.track('news_banner_click', { slug: d[idx].slug });
            } catch (e) {}
          });
          document.getElementById('news-banner-dismiss').addEventListener('click', function () {
            banner.style.display = 'none';
            if (timer) clearInterval(timer);
            localStorage.setItem('news_dismissed_slug', d[0].slug);
          });
        })
        .catch(function () {});
    } catch (e) {}
  }
  function scheduleNewsBanner() {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(loadNewsBanner, { timeout: 4000 });
    } else {
      setTimeout(loadNewsBanner, 1500);
    }
  }
  if (document.readyState === 'complete') {
    scheduleNewsBanner();
  } else {
    window.addEventListener('load', scheduleNewsBanner, { once: true });
  }
})();
