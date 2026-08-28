// Temporary ISEE 2026 announcement banner — auto-removes itself once the
// conference window has passed so no manual takedown is needed. Safe to
// delete this file (and the banner markup/CSS) after 2026-09-03.
(function () {
  var BANNER_START = new Date("2026-08-28T00:00:00");
  var BANNER_END = new Date("2026-09-03T23:59:59");
  var now = new Date();

  if (now < BANNER_START || now > BANNER_END) {
    var banner = document.getElementById("isee2026-banner");
    if (banner) banner.remove();
  }
})();
