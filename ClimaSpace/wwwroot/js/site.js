// ==============================================================================
// ClimaSpace - Funcionalidad Global y Modo Oscuro
// ==============================================================================

(function () {
    'use strict';

    function initTheme() {
        const savedTheme = localStorage.getItem('climaspace-theme');
        const isDark = savedTheme === 'dark';
        applyTheme(isDark);
    }

    function applyTheme(isDark) {
        if (isDark) {
            document.documentElement.classList.add('dark-mode');
            if (document.body) document.body.classList.add('dark-mode');
        } else {
            document.documentElement.classList.remove('dark-mode');
            if (document.body) document.body.classList.remove('dark-mode');
        }

        const icon = document.getElementById('themeToggleIcon');
        const btn = document.getElementById('btnThemeToggle');
        if (icon) {
            icon.className = isDark ? 'bi bi-sun-fill text-white' : 'bi bi-moon-stars-fill';
        }
        if (btn) {
            btn.title = isDark ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro';
            btn.setAttribute('aria-label', btn.title);
        }
    }

    window.toggleDarkMode = function () {
        const isDark = document.documentElement.classList.contains('dark-mode') || 
                       (document.body && document.body.classList.contains('dark-mode'));
        const newTheme = !isDark;
        localStorage.setItem('climaspace-theme', newTheme ? 'dark' : 'light');
        applyTheme(newTheme);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTheme);
    } else {
        initTheme();
    }
})();
