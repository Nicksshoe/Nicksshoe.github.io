/* Loads the real game (../index.html) and swaps only its stylesheet.
   The production page is not modified. Script URLs resolve from the site root
   via <base>, and potenshall:* localStorage keys are namespaced so a preview
   draft does not count as the live site's daily run. */
(function () {
  'use strict';
  var s = document.currentScript;
  var theme = s.dataset.theme;
  var title = s.dataset.title;
  var cssUrl = new URL(s.dataset.css, location.href);
  var indexUrl = new URL('../index.html', location.href);
  var root = new URL('../', location.href).href;

  function fail(msg) {
    document.body.innerHTML = '<p style="font:16px/1.5 system-ui,sans-serif;padding:24px;max-width:40em">' + msg + '</p>';
  }

  Promise.all([
    fetch(indexUrl).then(function (r) { if (!r.ok) throw new Error('index.html ' + r.status); return r.text(); }),
    fetch(cssUrl).then(function (r) { if (!r.ok) throw new Error(s.dataset.css + ' ' + r.status); return r.text(); })
  ]).then(function (parts) {
    var html = parts[0];
    var css = parts[1];
    if (html.indexOf('<style>') < 0 || html.indexOf('engine.js') < 0) throw new Error('index.html did not look like the game page');
    var doc = html;
    doc = doc.replace(/href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]+"/, 'href="' + s.dataset.fonts + '"');
    doc = doc.replace(/<style>[\s\S]*?<\/style>/, '<style>\n' + css + '\n</style>');
    doc = doc.replace('<head>', '<head>\n<base href="' + root + '">\n<meta name="robots" content="noindex, nofollow">');
    doc = doc.replace('<title>Potential Damage</title>', '<title>' + title + '</title>');
    doc = doc.replace('<body>', '<body class="' + theme + '">');
    var isolate = '<script>(function(){var p="pd-preview:";var g=Storage.prototype.getItem,s=Storage.prototype.setItem,r=Storage.prototype.removeItem;function k(x){return typeof x==="string"&&x.indexOf("potenshall:")===0?p+x:x}Storage.prototype.getItem=function(x){return g.call(this,k(x))};Storage.prototype.setItem=function(x,v){return s.call(this,k(x),v)};Storage.prototype.removeItem=function(x){return r.call(this,k(x))}})();<\/script>\n';
    doc = doc.replace('<script src="engine.js', isolate + '<script src="engine.js');
    document.open();
    document.write(doc);
    document.close();
  }).catch(function (err) {
    fail('This preview could not load the game. Serve the repo from its root (the page has to be able to fetch index.html). ' + err.message);
  });
})();
