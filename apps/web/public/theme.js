// Applies the saved theme before first paint (no flash of the wrong theme).
try {
  var t = localStorage.getItem('cv-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
