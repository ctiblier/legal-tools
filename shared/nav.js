// Shared navigation component
// Depends on: tools.js (must be loaded first — provides TOOLS global)
// Usage: call initNav({ title, subtitle, currentPath }) on each page

(function () {
  'use strict';

  /**
   * Build the tools dropdown menu items from the global TOOLS array.
   * External tools get target="_blank" and a ↗ indicator.
   */
  function buildToolLinks(currentPath) {
    return TOOLS.map(function (tool) {
      var isActive = !tool.external && tool.path === currentPath;
      var ariaCurrent = isActive ? ' aria-current="page"' : '';

      if (tool.external) {
        return (
          '<a href="' + tool.path + '" target="_blank" rel="noopener noreferrer" role="menuitem">' +
          tool.name + ' &#x2197;</a>'
        );
      }

      return (
        '<a href="' + tool.path + '" role="menuitem"' + ariaCurrent + '>' +
        tool.name + '</a>'
      );
    }).join('\n            ');
  }

  /**
   * Build footer tool links column from the global TOOLS array.
   */
  function buildFooterToolLinks() {
    return TOOLS.map(function (tool) {
      if (tool.external) {
        return (
          '<a href="' + tool.path + '" target="_blank" rel="noopener noreferrer">' +
          tool.name + ' &#x2197;</a>'
        );
      }
      return '<a href="' + tool.path + '">' + tool.name + '</a>';
    }).join('\n            ');
  }

  /**
   * Determine whether a nav link matches the current path.
   * Returns aria-current="page" attribute string or empty string.
   */
  function ariaCurrent(href, currentPath) {
    // Normalise both to no trailing slash for comparison,
    // but treat "/" specially.
    var normalised = currentPath.replace(/\/$/, '') || '/';
    var hrefNorm = href.replace(/\/$/, '') || '/';
    if (hrefNorm === normalised) {
      return ' aria-current="page"';
    }
    return '';
  }

  /**
   * Generate the header innerHTML.
   */
  function buildHeader(options) {
    var title = options.title || 'BatesStamp.com';
    var subtitle = options.subtitle || '';

    var subtitleHtml = subtitle
      ? '<p>' + subtitle + '</p>'
      : '';

    return (
      '<h1>' + title + '</h1>' +
      subtitleHtml
    );
  }

  /**
   * Generate the nav innerHTML.
   */
  function buildNav(currentPath) {
    var toolLinks = buildToolLinks(currentPath);

    var homeAttr = ariaCurrent('/', currentPath);
    var aboutAttr = ariaCurrent('/about.html', currentPath);
    var privacyAttr = ariaCurrent('/privacy-policy.html', currentPath);
    var tosAttr = ariaCurrent('/terms-of-service.html', currentPath);

    return (
      '<div class="nav-links">\n' +
      '        <a href="/"' + homeAttr + '>Home</a>\n' +
      '        <div class="tools-dropdown">\n' +
      '            <button class="tools-dropdown-toggle" aria-expanded="false" aria-haspopup="true">Tools &#9662;</button>\n' +
      '            <div class="tools-dropdown-menu" role="menu">\n' +
      '            ' + toolLinks + '\n' +
      '            </div>\n' +
      '        </div>\n' +
      '        <a href="/about.html"' + aboutAttr + '>About</a>\n' +
      '        <a href="/privacy-policy.html"' + privacyAttr + '>Privacy Policy</a>\n' +
      '        <a href="/terms-of-service.html"' + tosAttr + '>Terms of Service</a>\n' +
      '    </div>'
    );
  }

  /**
   * Generate the footer innerHTML.
   */
  function buildFooter() {
    var footerToolLinks = buildFooterToolLinks();

    return (
      '<nav aria-label="Footer navigation">\n' +
      '    <div class="footer-top">\n' +
      '        <div class="footer-col">\n' +
      '            <h4>BatesStamp.com</h4>\n' +
      '            <p>Free, private legal document tools. Your documents are processed entirely in your browser — we never see, upload, or store your files.</p>\n' +
      '        </div>\n' +
      '        <div class="footer-col">\n' +
      '            <h4>Pages</h4>\n' +
      '            <a href="/">Home</a>\n' +
      '            <a href="/about.html">About &amp; Contact</a>\n' +
      '            <a href="/privacy-policy.html">Privacy Policy</a>\n' +
      '            <a href="/terms-of-service.html">Terms of Service</a>\n' +
      '        </div>\n' +
      '        <div class="footer-col">\n' +
      '            <h4>Tools</h4>\n' +
      '            ' + footerToolLinks + '\n' +
      '        </div>\n' +
      '    </div>\n' +
      '</nav>\n' +
      '<div class="footer-bottom">\n' +
      '    <p>&#169; 2026 BatesStamp.com. All processing happens on your device.</p>\n' +
      '</div>'
    );
  }

  /**
   * Wire up dropdown toggle behaviour.
   * - Click button: toggle open/close
   * - Click outside: close
   * - Escape key: close and return focus to toggle button
   */
  function initDropdown() {
    var toggle = document.querySelector('.tools-dropdown-toggle');
    var menu = document.querySelector('.tools-dropdown-menu');

    if (!toggle || !menu) return;

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = menu.classList.contains('open');
      if (isOpen) {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      } else {
        menu.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
      }
    });

    document.addEventListener('click', function () {
      if (menu.classList.contains('open')) {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('open')) {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });

    // Prevent clicks inside the menu from closing it immediately
    menu.addEventListener('click', function (e) {
      e.stopPropagation();
    });
  }

  /**
   * Public API — called by each page after DOM is ready.
   *
   * @param {Object} options
   * @param {string} options.title       - Page h1 text
   * @param {string} options.subtitle    - Page subtitle text
   * @param {string} [options.currentPath] - Override for active-link detection
   *                                         (defaults to window.location.pathname)
   */
  window.initNav = function (options) {
    options = options || {};
    var currentPath = options.currentPath || window.location.pathname;

    // Inject header
    var headerEl = document.getElementById('site-header');
    if (headerEl) {
      headerEl.innerHTML = buildHeader(options);
    }

    // Inject nav
    var navEl = document.getElementById('site-nav');
    if (navEl) {
      navEl.innerHTML = buildNav(currentPath);
      initDropdown();
    }

    // Inject footer
    var footerEl = document.getElementById('site-footer');
    if (footerEl) {
      footerEl.innerHTML = buildFooter();
    }
  };

}());
