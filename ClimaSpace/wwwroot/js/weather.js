// ==========================================================================
// ClimaSpace - Controlador del Radar Doppler & Interfaz de Usuario
// ==========================================================================

let currentUnit = 'C';
let radarMap = null;
let radarLayers = [];
let currentRadarIndex = 0;
let radarAnimationTimer = null;
let isRadarPlaying = false;
let radarHost = 'https://tilecache.rainviewer.com';

// --------------------------------------------------------------------------
// 1. Manejo de Unidades de Temperatura (°C / °F)
// --------------------------------------------------------------------------
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

    document.querySelectorAll('[data-temp-c]').forEach(el => {
        const tempC = el.getAttribute('data-temp-c');
        const tempF = el.getAttribute('data-temp-f');
        const showUnit = el.getAttribute('data-show-unit') !== 'false';
        const unitSymbol = showUnit ? `°${unit}` : '';

        el.textContent = unit === 'C' ? `${tempC}${unitSymbol}` : `${tempF}${unitSymbol}`;
    });

    try {
        localStorage.setItem('climaspace_unit', unit);
    } catch (e) {}
}

// --------------------------------------------------------------------------
// 2. Inicialización del Radar Doppler Meteorológico (Leaflet + RainViewer)
// --------------------------------------------------------------------------
function initWeatherRadar(lat, lon, cityName, currentTemp, conditionDesc) {
    const mapContainer = document.getElementById('weatherRadarMap');
    if (!mapContainer || typeof L === 'undefined') return;

    // Destruir mapa previo si existe (para evitar fugas de memoria o errores de re-render)
    if (radarMap) {
        radarMap.remove();
        radarMap = null;
    }

    // Inicializar mapa Leaflet centrado en la ciudad
    radarMap = L.map('weatherRadarMap', {
        center: [lat, lon],
        zoom: 8,
        minZoom: 4,
        maxZoom: 14,
        zoomControl: true,
        attributionControl: false
    });

    // Capa Base: CartoDB Positron (Limpio, Blanco y Azul)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(radarMap);

    // Marcador de ciudad con pulso azul
    const pinHtml = `<div class="radar-city-pin"></div>`;
    const customIcon = L.divIcon({
        className: 'radar-pin-container',
        html: pinHtml,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    const marker = L.marker([lat, lon], { icon: customIcon }).addTo(radarMap);
    marker.bindPopup(`
        <div style="font-family: inherit; font-size: 0.9rem; text-align: center; padding: 4px;">
            <strong style="color: #2563eb;">📍 ${cityName}</strong><br/>
            <span style="font-size: 1.15rem; font-weight: 700; color: #0f172a;">${currentTemp}°C</span><br/>
            <span style="color: #64748b; font-size: 0.8rem;">${conditionDesc}</span>
        </div>
    `).openPopup();

    // Cargar capas de Doppler Radar desde RainViewer API
    loadRainViewerRadarLayers();
}

async function loadRainViewerRadarLayers() {
    const timeDisplay = document.getElementById('radarFrameTime');
    const playBtn = document.getElementById('btnRadarPlay');

    try {
        if (timeDisplay) timeDisplay.textContent = "Cargando ecos Doppler...";

        const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (!response.ok) throw new Error("No se pudo conectar con RainViewer");

        const data = await response.json();
        radarHost = data.host || 'https://tilecache.rainviewer.com';

        // Obtener los últimos frames del radar (past + nowcast)
        const frames = (data.radar && data.radar.past) ? data.radar.past : [];
        if (data.radar && data.radar.nowcast) {
            frames.push(...data.radar.nowcast);
        }

        if (frames.length === 0) {
            if (timeDisplay) timeDisplay.textContent = "Radar activo (Sin ecos de lluvia)";
            return;
        }

        // Crear capas de mosaico para cada frame
        radarLayers = frames.map(frame => {
            const layer = L.tileLayer(`${radarHost}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
                opacity: 0,
                zIndex: 100
            });
            layer.frameTime = new Date(frame.time * 1000);
            return layer;
        });

        // Añadir todas las capas al mapa
        radarLayers.forEach(layer => layer.addTo(radarMap));

        // Mostrar el último frame disponible
        currentRadarIndex = radarLayers.length - 1;
        showRadarFrame(currentRadarIndex);

        // Habilitar botón de Play
        if (playBtn) playBtn.disabled = false;

    } catch (err) {
        console.warn("RainViewer no disponible:", err);
        if (timeDisplay) timeDisplay.textContent = "Radar activo (Modo Base)";
    }
}

function showRadarFrame(index) {
    if (radarLayers.length === 0) return;

    // Ocultar todos los frames
    radarLayers.forEach((l, i) => {
        l.setOpacity(i === index ? 0.72 : 0);
    });

    const activeLayer = radarLayers[index];
    const timeDisplay = document.getElementById('radarFrameTime');
    if (timeDisplay && activeLayer.frameTime) {
        const timeFormatted = activeLayer.frameTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        timeDisplay.innerHTML = `<span class="badge bg-primary text-white me-1">Doppler</span> ${timeFormatted}`;
    }
}

function toggleRadarAnimation() {
    const playBtn = document.getElementById('btnRadarPlay');
    if (isRadarPlaying) {
        stopRadarAnimation();
    } else {
        startRadarAnimation();
    }
}

function startRadarAnimation() {
    if (radarLayers.length <= 1) return;
    isRadarPlaying = true;

    const playBtn = document.getElementById('btnRadarPlay');
    if (playBtn) {
        playBtn.innerHTML = '<i class="bi bi-pause-fill"></i> Pausar';
        playBtn.classList.replace('btn-primary', 'btn-outline-primary');
    }

    radarAnimationTimer = setInterval(() => {
        currentRadarIndex = (currentRadarIndex + 1) % radarLayers.length;
        showRadarFrame(currentRadarIndex);
    }, 750);
}

function stopRadarAnimation() {
    isRadarPlaying = false;
    clearInterval(radarAnimationTimer);

    const playBtn = document.getElementById('btnRadarPlay');
    if (playBtn) {
        playBtn.innerHTML = '<i class="bi bi-play-fill"></i> Reproducir';
        playBtn.classList.replace('btn-outline-primary', 'btn-primary');
    }
}

function toggleRadarSweep() {
    const sweepOverlay = document.getElementById('radarSweepOverlay');
    const sweepBtn = document.getElementById('btnRadarSweep');
    if (!sweepOverlay) return;

    sweepOverlay.classList.toggle('active');
    const isActive = sweepOverlay.classList.contains('active');

    if (sweepBtn) {
        if (isActive) {
            sweepBtn.classList.add('btn-info', 'text-white');
            sweepBtn.classList.remove('btn-outline-secondary');
        } else {
            sweepBtn.classList.remove('btn-info', 'text-white');
            sweepBtn.classList.add('btn-outline-secondary');
        }
    }
}

// --------------------------------------------------------------------------
// 3. Inicialización General al Cargar el DOM
// --------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    // Restaurar unidad °C / °F
    try {
        const savedUnit = localStorage.getItem('climaspace_unit');
        if (savedUnit && savedUnit === 'F') {
            setTemperatureUnit('F');
        }
    } catch (e) {}

    // Scroll horizontal táctil para la cinta de horas
    const hourlyScroll = document.querySelector('.hourly-scroll-white');
    if (hourlyScroll) {
        hourlyScroll.addEventListener('wheel', (evt) => {
            if (evt.deltaY !== 0) {
                evt.preventDefault();
                hourlyScroll.scrollLeft += evt.deltaY;
            }
        });
    }

    // Inicializar Radar si las coordenadas globales fueron inyectadas por Razor
    if (window.cityCoordinates) {
        initWeatherRadar(
            window.cityCoordinates.lat,
            window.cityCoordinates.lon,
            window.cityCoordinates.name,
            window.cityCoordinates.temp,
            window.cityCoordinates.desc
        );
    }
});
