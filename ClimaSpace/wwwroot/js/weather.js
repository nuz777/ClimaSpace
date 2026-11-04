// ClimaSpace - Interacción del Cliente

let currentUnit = 'C';

function setTemperatureUnit(unit) {
    if (currentUnit === unit) return;
    currentUnit = unit;

    const btnC = document.getElementById('btnCelsius');
    const btnF = document.getElementById('btnFahrenheit');

    if (btnC && btnF) {
        if (unit === 'C') {
            btnC.classList.add('active');
            btnF.classList.remove('active');
        } else {
            btnF.classList.add('active');
            btnC.classList.remove('active');
        }
    }

    // Actualizar todos los elementos con atributos data-temp-c y data-temp-f
    document.querySelectorAll('[data-temp-c]').forEach(el => {
        const tempC = el.getAttribute('data-temp-c');
        const tempF = el.getAttribute('data-temp-f');
        const showUnit = el.getAttribute('data-show-unit') !== 'false';
        const unitSymbol = showUnit ? `°${unit}` : '';

        el.textContent = unit === 'C' ? `${tempC}${unitSymbol}` : `${tempF}${unitSymbol}`;
    });

    // Guardar preferencia en localStorage
    try {
        localStorage.setItem('climaspace_unit', unit);
    } catch (e) {
        // LocalStorage no disponible
    }
}

// Cargar preferencia al iniciar
document.addEventListener('DOMContentLoaded', () => {
    try {
        const savedUnit = localStorage.getItem('climaspace_unit');
        if (savedUnit && (savedUnit === 'C' || savedUnit === 'F') && savedUnit !== 'C') {
            setTemperatureUnit(savedUnit);
        }
    } catch (e) {}

    // Auto-scroll al día de hoy en el carrusel de horas si es necesario
    const hourlyScroll = document.querySelector('.hourly-scroll');
    if (hourlyScroll) {
        hourlyScroll.addEventListener('wheel', (evt) => {
            if (evt.deltaY !== 0) {
                evt.preventDefault();
                hourlyScroll.scrollLeft += evt.deltaY;
            }
        });
    }
});
