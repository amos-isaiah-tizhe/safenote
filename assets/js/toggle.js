export function initThemeToggle() {
  const body = document.body;
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  const btn = document.getElementById('themeToggle');

  // Safety check — if the button isn't on this page, do nothing
  if (!btn || !icon || !label) return;

  function applyTheme(isLight) {
    body.classList.toggle('light-mode', isLight);
    icon.className = isLight ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    label.textContent = isLight ? 'Light' : 'Dark';
  }

  // Apply saved preference on page load
  applyTheme(localStorage.getItem('theme') === 'light');

  btn.addEventListener('click', function () {
    const isLight = body.classList.toggle('light-mode');
    applyTheme(isLight);
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
  });
}
