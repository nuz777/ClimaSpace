// ==========================================================================
// ClimaSpace - Controlador del Radar Doppler & Interfaz de Usuario
// ==========================================================================

let currentUnit = 'C';
let radarMap = null;
let radarTileLayer = null;
let radarFrames = [];
let currentRadarIndex = 0;
let radarAnimationTimer = null;
let isRadarPlaying = false;
let radarHost = 'https://tilecache.rainviewer.com';
let rainEchoGroup = null;

// Catálogo de localidades con "puntos azulitos" interactivos en el radar
const RADAR_CITIES = [
    { name: "Bogotá", country: "Colombia", lat: 4.7110, lon: -74.0721, isColombia: true },
    { name: "Medellín", country: "Colombia", lat: 6.2442, lon: -75.5812, isColombia: true },
    { name: "Cali", country: "Colombia", lat: 3.4516, lon: -76.5320, isColombia: true },
    { name: "Barranquilla", country: "Colombia", lat: 10.9685, lon: -74.7813, isColombia: true },
    { name: "Cartagena", country: "Colombia", lat: 10.3910, lon: -75.4794, isColombia: true },
    { name: "Bucaramanga", country: "Colombia", lat: 7.1254, lon: -73.1198, isColombia: true },
    { name: "Santa Marta", country: "Colombia", lat: 11.2408, lon: -74.1990, isColombia: true },
    { name: "Pereira", country: "Colombia", lat: 4.8133, lon: -75.6961, isColombia: true },
    { name: "Cúcuta", country: "Colombia", lat: 7.8939, lon: -72.5078, isColombia: true },
    { name: "Manizales", country: "Colombia", lat: 5.0689, lon: -75.5174, isColombia: true },
    { name: "Villavicencio", country: "Colombia", lat: 4.1420, lon: -73.6266, isColombia: true },
    { name: "Pasto", country: "Colombia", lat: 1.2136, lon: -77.2811, isColombia: true },
    { name: "San Andrés", country: "Colombia", lat: 12.5847, lon: -81.7006, isColombia: true },
    { name: "Madrid", country: "España", lat: 40.4168, lon: -3.7038, isColombia: false },
    { name: "Miami", country: "EE.UU.", lat: 25.7617, lon: -80.1918, isColombia: false },
    { name: "Nueva York", country: "EE.UU.", lat: 40.7128, lon: -74.0060, isColombia: false },
    { name: "Tokio", country: "Japón", lat: 35.6762, lon: 139.6503, isColombia: false },
    { name: "Buenos Aires", country: "Argentina", lat: -34.6037, lon: -58.3816, isColombia: false },
    { name: "Ciudad de México", country: "México", lat: 19.4326, lon: -99.1332, isColombia: false }
];

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
// 2. Inicialización del Radar Doppler Meteorológico
// --------------------------------------------------------------------------
function initWeatherRadar(lat, lon, cityName, currentTemp, conditionDesc) {
    const mapContainer = document.getElementById('weatherRadarMap');
    if (!mapContainer || typeof L === 'undefined') return;

    if (radarMap) {
        radarMap.remove();
        radarMap = null;
    }

    // Configuración robusta de Leaflet para soportar zoom in y zoom out sin romper capas
    radarMap = L.map('weatherRadarMap', {
        center: [lat, lon],
        zoom: 8,
        minZoom: 3,
        maxZoom: 18,
        zoomControl: true,
        attributionControl: false
    });

    // 1. Capa Base: Esri Light Gray Canvas (Nativo y sin marcas de agua)
    const esriLightBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 16,
        maxZoom: 18,
        minZoom: 2,
        attribution: '&copy; Esri, HERE'
    }).addTo(radarMap);

    // 2. Capa de Nombres y Etiquetas sobre el mapa
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 16,
        maxZoom: 18,
        minZoom: 2,
        zIndex: 50
    }).addTo(radarMap);

    // 3. Opción de mapa alternativo: OpenStreetMap
    const osmBase = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        minZoom: 2,
        attribution: '&copy; OpenStreetMap'
    });

    L.control.layers({
        "Mapa Radar Claro": esriLightBase,
        "OpenStreetMap": osmBase
    }, null, { position: 'topright' }).addTo(radarMap);

    // 4. Agregar PUNTOS AZULITOS de selección en el mapa
    addRadarCityDots(cityName);

    // 5. Graficación visible de Ecos de Lluvia y Chubascos
    renderPrecipitationEchoes(lat, lon, conditionDesc);

    // 6. Cargar datos de Radar RainViewer
    loadRainViewerRadarLayers();
}

// --------------------------------------------------------------------------
// 3. Puntos Azulitos Interactivos para Seleccionar Ciudad en el Radar
// --------------------------------------------------------------------------
function addRadarCityDots(activeCityName) {
    if (!radarMap) return;

    const currentProvider = window.currentProvider || 'live';

    RADAR_CITIES.forEach(city => {
        const isActive = activeCityName && (
            city.name.toLowerCase() === activeCityName.toLowerCase() ||
            activeCityName.toLowerCase().includes(city.name.toLowerCase())
        );

        const dotClass = isActive ? "radar-city-dot active-city" : "radar-city-dot";
        const dotHtml = `<div class="${dotClass}" title="${city.name}"></div>`;

        const dotIcon = L.divIcon({
            className: 'radar-dot-wrapper',
            html: dotHtml,
            iconSize: isActive ? [18, 18] : [14, 14],
            iconAnchor: isActive ? [9, 9] : [7, 7]
        });

        const marker = L.marker([city.lat, city.lon], { icon: dotIcon, zIndexOffset: isActive ? 500 : 100 }).addTo(radarMap);

        marker.bindTooltip(`<strong>${city.name}</strong> <span class="text-secondary small">(${city.country})</span>`, {
            direction: 'top',
            offset: [0, -8],
            className: 'shadow-sm border rounded-pill px-2 py-1 small'
        });

        marker.on('click', () => {
            // Navegar directamente a la ciudad seleccionada
            window.location.href = `/?city=${encodeURIComponent(city.name)}&provider=${currentProvider}`;
        });
    });
}

// --------------------------------------------------------------------------
// 4. Visualización Gráfica de Ecos de Lluvia, Chubascos y Tormentas
// --------------------------------------------------------------------------
function renderPrecipitationEchoes(lat, lon, conditionDesc) {
    if (!radarMap) return;

    if (rainEchoGroup) {
        radarMap.removeLayer(rainEchoGroup);
    }
    rainEchoGroup = L.layerGroup().addTo(radarMap);

    const desc = (conditionDesc || "").toLowerCase();
    const hasPrecipitation = desc.includes("lluv") || 
                             desc.includes("chubasc") || 
                             desc.includes("torment") || 
                             desc.includes("drizzle") || 
                             desc.includes("rain") ||
                             desc.includes("shower");

    if (hasPrecipitation) {
        const isHeavy = desc.includes("intens") || desc.includes("torment") || desc.includes("heavy");

        // Círculo Doppler Exterior (Verde: Llovizna / Precipitación ligera)
        L.circle([lat, lon], {
            radius: isHeavy ? 28000 : 18000,
            color: '#10b981',
            fillColor: '#10b981',
            fillOpacity: 0.32,
            weight: 1.5,
            className: 'radar-rain-echo-pulse'
        }).addTo(rainEchoGroup);

        // Círculo Doppler Medio (Amarillo: Moderada)
        L.circle([lat, lon], {
            radius: isHeavy ? 18000 : 10000,
            color: '#eab308',
            fillColor: '#eab308',
            fillOpacity: 0.45,
            weight: 1.5
        }).addTo(rainEchoGroup);

        // Núcleo Doppler (Naranja / Rojo: Fuerte)
        L.circle([lat, lon], {
            radius: isHeavy ? 9000 : 4500,
            color: '#ef4444',
            fillColor: '#f97316',
            fillOpacity: 0.6,
            weight: 2
        }).addTo(rainEchoGroup);

        // Etiqueta flotante Doppler
        const echoPopup = L.popup({ autoClose: false, closeOnClick: false, offset: [0, -10] })
            .setLatLng([lat, lon])
            .setContent(`
                <div class="text-center" style="font-size: 0.8rem; line-height: 1.3;">
                    <strong class="text-danger"><i class="bi bi-cloud-rain-heavy-fill me-1"></i>Eco de Precipitación Activo</strong><br/>
                    <span class="text-secondary small">Intensidad Doppler: Moderada a Alta</span>
                </div>
            `);
        
        // Abrir popup si el usuario hace clic en el área
        rainEchoGroup.on('click', () => echoPopup.openOn(radarMap));
    }
}

// --------------------------------------------------------------------------
// 5. Carga de Fotogramas del Radar Doppler (RainViewer API)
// --------------------------------------------------------------------------
async function loadRainViewerRadarLayers() {
    const timeDisplay = document.getElementById('radarFrameTime');
    const playBtn = document.getElementById('btnRadarPlay');

    try {
        if (timeDisplay) timeDisplay.textContent = "Sincronizando radar Doppler...";

        const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (!response.ok) throw new Error("No se pudo conectar con RainViewer");

        const data = await response.json();
        radarHost = data.host || 'https://tilecache.rainviewer.com';

        const frames = (data.radar && data.radar.past) ? data.radar.past : [];
        if (data.radar && data.radar.nowcast) {
            frames.push(...data.radar.nowcast);
        }

        if (frames.length === 0) {
            if (timeDisplay) timeDisplay.textContent = "Radar activo (Sin ecos)";
            return;
        }

        radarFrames = frames;
        currentRadarIndex = radarFrames.length - 1;

        // Crear una ÚNICA capa de mosaico Doppler de alta resiliencia al zoom
        // Usamos esquema de color 4 (The Weather Channel) o 6 (NEXRAD) para máxima visibilidad
        const initialPath = radarFrames[currentRadarIndex].path;
        const initialUrl = `${radarHost}${initialPath}/256/{z}/{x}/{y}/4/1_1.png`;

        if (radarTileLayer) {
            radarMap.removeLayer(radarTileLayer);
        }

        radarTileLayer = L.tileLayer(initialUrl, {
            opacity: 0.82,
            zIndex: 100,
            maxNativeZoom: 12,
            maxZoom: 18,
            minNativeZoom: 2,
            minZoom: 2,
            keepBuffer: 6,
            updateWhenZooming: false,
            updateWhenIdle: true
        }).addTo(radarMap);

        updateRadarTimeDisplay(radarFrames[currentRadarIndex].time);

        if (playBtn) playBtn.disabled = false;

    } catch (err) {
        console.warn("RainViewer no disponible:", err);
        if (timeDisplay) timeDisplay.textContent = "Radar activo (Modo Base)";
    }
}

function updateRadarTimeDisplay(unixTimestamp) {
    const timeDisplay = document.getElementById('radarFrameTime');
    if (timeDisplay && unixTimestamp) {
        const frameDate = new Date(unixTimestamp * 1000);
        const timeFormatted = frameDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        timeDisplay.innerHTML = `<span class="badge bg-primary text-white me-1">Doppler</span> ${timeFormatted}`;
    }
}

function showRadarFrame(index) {
    if (!radarTileLayer || radarFrames.length === 0) return;

    currentRadarIndex = index;
    const frame = radarFrames[index];
    const newUrl = `${radarHost}${frame.path}/256/{z}/{x}/{y}/4/1_1.png`;

    // Cambiar URL de la capa existente: CERO sobrecarga de red ni parpadeos al hacer zoom
    radarTileLayer.setUrl(newUrl);
    updateRadarTimeDisplay(frame.time);
}

function toggleRadarAnimation() {
    if (isRadarPlaying) {
        stopRadarAnimation();
    } else {
        startRadarAnimation();
    }
}

function startRadarAnimation() {
    if (radarFrames.length <= 1) return;
    isRadarPlaying = true;

    const playBtn = document.getElementById('btnRadarPlay');
    if (playBtn) {
        playBtn.innerHTML = '<i class="bi bi-pause-fill"></i> Pausar';
        playBtn.classList.replace('btn-primary', 'btn-outline-primary');
    }

    radarAnimationTimer = setInterval(() => {
        currentRadarIndex = (currentRadarIndex + 1) % radarFrames.length;
        showRadarFrame(currentRadarIndex);
    }, 700);
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
// 6. Inicialización al Cargar el DOM
// --------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    try {
        const savedUnit = localStorage.getItem('climaspace_unit');
        if (savedUnit && savedUnit === 'F') {
            setTemperatureUnit('F');
        }
    } catch (e) {}

    const hourlyScroll = document.querySelector('.hourly-scroll-white');
    if (hourlyScroll) {
        hourlyScroll.addEventListener('wheel', (evt) => {
            if (evt.deltaY !== 0) {
                evt.preventDefault();
                hourlyScroll.scrollLeft += evt.deltaY;
            }
        });
    }

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
