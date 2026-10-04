/* Runs before the app paints. One coordinated palette per document, never per route.
   Storage only avoids an immediate repeat; blocked storage must not block the app. */
(function () {
  var palettes = [
    { id: 'sage', accent: [43, 105, 88], canvas: [242, 247, 240], wash: [223, 237, 220], surface: [252, 253, 250], secondary: [232, 241, 225] },
    { id: 'apricot', accent: [153, 70, 43], canvas: [253, 246, 239], wash: [250, 226, 207], surface: [255, 252, 247], secondary: [249, 235, 221] },
    { id: 'lavender', accent: [106, 74, 146], canvas: [246, 243, 250], wash: [233, 224, 246], surface: [253, 251, 255], secondary: [239, 232, 246] },
    { id: 'rose', accent: [152, 67, 100], canvas: [252, 244, 246], wash: [248, 225, 232], surface: [255, 251, 251], secondary: [247, 232, 237] },
    { id: 'sky', accent: [45, 96, 146], canvas: [241, 247, 251], wash: [221, 237, 248], surface: [250, 253, 255], secondary: [230, 240, 248] },
    { id: 'butter', accent: [120, 91, 38], canvas: [251, 249, 237], wash: [246, 238, 201], surface: [255, 254, 247], secondary: [246, 242, 218] }
  ];
  var root = document.documentElement;
  if (root.dataset.palette) return;
  var previous;
  try { previous = sessionStorage.getItem('ff-last-palette'); } catch (_) {}
  var available = palettes.filter(function (p) { return p.id !== previous; });
  var palette = available[Math.floor(Math.random() * available.length)];
  root.dataset.palette = palette.id;
  try { sessionStorage.setItem('ff-last-palette', palette.id); } catch (_) {}
  function mix(a, b, weight) { return a.map(function (v, i) { return Math.round(v * (1 - weight) + b[i] * weight); }); }
  function token(name, rgb) { root.style.setProperty('--' + name, rgb.join(' ')); }
  var white = [255, 255, 255], black = [0, 0, 0], a = palette.accent;
  token('palette-light-canvas', palette.canvas);
  token('palette-light-wash', palette.wash);
  token('palette-light-surface', palette.surface);
  token('palette-light-surface2', palette.secondary);
  token('palette-light-fg', mix(a, black, 0.75));
  token('palette-light-muted', mix(a, black, 0.36));
  token('palette-light-faint', mix(a, black, 0.12));
  token('palette-light-line', mix(a, white, 0.78));
  token('palette-dark-canvas', mix(a, black, 0.86));
  token('palette-dark-wash', mix(a, black, 0.64));
  token('palette-dark-surface', mix(a, black, 0.79));
  token('palette-dark-surface2', mix(a, black, 0.66));
  token('palette-dark-fg', mix(a, white, 0.94));
  token('palette-dark-muted', mix(a, white, 0.80));
  token('palette-dark-faint', mix(a, white, 0.65));
  token('palette-dark-line', mix(a, white, 0.12));
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].forEach(function (step, i) {
    var lightness = [0.94, 0.86, 0.73, 0.58, 0.36, 0.12, 0, -0.15, -0.30, -0.48][i];
    token('brand-' + step, mix(a, lightness < 0 ? black : white, Math.abs(lightness)));
  });
  try {
    var mode = localStorage.getItem('ff-theme');
    root.classList.toggle('dark', mode === 'dark' || (mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches));
  } catch (_) {
    root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
})();
