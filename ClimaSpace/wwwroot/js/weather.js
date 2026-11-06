// ==========================================================================
// ClimaSpace - Controlador del Radar Doppler & Interfaz Dinámica SPA
// ==========================================================================

let currentUnit = 'C';
let currentProvider = window.currentProvider || 'live';
let currentCityName = (window.cityCoordinates && window.cityCoordinates.name) || 'Bogotá';

let radarMap = null;
let radarTileLayers = [null, null];
let activeBufferIndex = 0;
let radarFrames = [];
let currentRadarIndex = 0;
let radarAnimationTimer = null;
let isRadarPlaying = false;
let radarHost = 'https://tilecache.rainviewer.com';
let rainEchoGroup = null;
let regionalEchoGroup = null;
let currentManualLevel = null;
let radarCityMarkers = [];
let isDopplerSweepActive = false;
let detectedStormLayerGroup = null;

// ==========================================================================
// Motor de Renderizado Visual de Lluvia Doppler (IDW + Simplex Noise en Canvas)
// ==========================================================================
let dopplerCanvas = null;
let dopplerCtx = null;
let dopplerOffscreenCanvas = null;
let dopplerOffscreenCtx = null;
let localEchoCells = [];
let regionalEchoCells = [];
let liveRadarEchoes = [];
let isFetchingLiveDoppler = false;
let liveRadarLastFetched = 0;
let trackedRadarHurricanes = [];
let hurricaneLayerGroup = null;

// Generador de Ruido Simplex 2D para contornos orgánicos no circulares
const DopplerSimplex = (function () {
    const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
    const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = (i * 37 + 11) % 256;
    const perm = new Uint8Array(512);
    const gradP = new Array(512);
    const grad2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let i = 0; i < 512; i++) {
        perm[i] = p[i & 255];
        gradP[i] = grad2[perm[i] % 8];
    }
    return {
        noise2D: function (xin, yin) {
            const s = (xin + yin) * F2;
            const i = Math.floor(xin + s), j = Math.floor(yin + s);
            const t = (i + j) * G2;
            const x0 = xin - (i - t), y0 = yin - (j - t);
            let i1 = (x0 > y0) ? 1 : 0, j1 = (x0 > y0) ? 0 : 1;
            const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
            const x2 = x0 - 1.0 + 2.0 * G2, y2 = y0 - 1.0 + 2.0 * G2;
            const ii = i & 255, jj = j & 255;
            const g0 = gradP[ii + perm[jj]];
            const g1 = gradP[ii + i1 + perm[jj + j1]];
            const g2 = gradP[ii + 1 + perm[jj + 1]];
            let t0 = 0.5 - x0 * x0 - y0 * y0;
            const n0 = t0 < 0 ? 0 : (t0 *= t0, t0 * t0 * (g0[0] * x0 + g0[1] * y0));
            let t1 = 0.5 - x1 * x1 - y1 * y1;
            const n1 = t1 < 0 ? 0 : (t1 *= t1, t1 * t1 * (g1[0] * x1 + g1[1] * y1));
            let t2 = 0.5 - x2 * x2 - y2 * y2;
            const n2 = t2 < 0 ? 0 : (t2 *= t2, t2 * t2 * (g2[0] * x2 + g2[1] * y2));
            return 70.0 * (n0 + n1 + n2);
        }
    };
})();

// Tabla de Consulta (LUT) cromática continua de dBZ: Verde -> Amarillo -> Naranja -> Rojo -> Morado (>55 dBZ)
const DOPPLER_LUT = (function () {
    const lut = new Uint8ClampedArray(76 * 4);
    function lerp(a, b, t) { return a + (b - a) * t; }
    const stops = [
        { dbz: 10, r: 16, g: 185, b: 129, a: 0 },
        { dbz: 16, r: 16, g: 185, b: 129, a: 160 },
        { dbz: 25, r: 34, g: 197, b: 94,  a: 200 },
        { dbz: 32, r: 234, g: 179, b: 8,  a: 220 },
        { dbz: 40, r: 249, g: 115, b: 22, a: 235 },
        { dbz: 48, r: 239, g: 68,  b: 68, a: 245 },
        { dbz: 55, r: 220, g: 38,  b: 38, a: 250 },
        { dbz: 60, r: 168, g: 85,  b: 247, a: 255 },
        { dbz: 75, r: 124, g: 58,  b: 237, a: 255 }
    ];
    for (let v = 0; v <= 75; v++) {
        let r = 0, g = 0, b = 0, a = 0;
        if (v >= stops[0].dbz) {
            for (let i = 0; i < stops.length - 1; i++) {
                const s0 = stops[i], s1 = stops[i + 1];
                if (v >= s0.dbz && v <= s1.dbz) {
                    const t = (v - s0.dbz) / (s1.dbz - s0.dbz);
                    r = Math.round(lerp(s0.r, s1.r, t));
                    g = Math.round(lerp(s0.g, s1.g, t));
                    b = Math.round(lerp(s0.b, s1.b, t));
                    a = Math.round(lerp(s0.a, s1.a, t));
                    break;
                }
            }
            if (v > stops[stops.length - 1].dbz) {
                const last = stops[stops.length - 1];
                r = last.r; g = last.g; b = last.b; a = last.a;
            }
        }
        const idx = v * 4;
        lut[idx] = r; lut[idx + 1] = g; lut[idx + 2] = b; lut[idx + 3] = a;
    }
    return lut;
})();

function initDopplerCanvas() {
    dopplerCanvas = document.getElementById('dopplerRadarCanvas');
    if (!dopplerCanvas) return;
    dopplerCtx = dopplerCanvas.getContext('2d');
    if (!dopplerOffscreenCanvas) {
        dopplerOffscreenCanvas = document.createElement('canvas');
        dopplerOffscreenCtx = dopplerOffscreenCanvas.getContext('2d');
    }
}

function renderDopplerCanvas() {
    if (!radarMap) return;
    if (!dopplerCanvas || !dopplerCtx) {
        initDopplerCanvas();
        if (!dopplerCanvas || !dopplerCtx) return;
    }

    const size = radarMap.getSize();
    if (!size || size.x === 0 || size.y === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.floor(size.x * dpr);
    const targetH = Math.floor(size.y * dpr);

    if (dopplerCanvas.width !== targetW || dopplerCanvas.height !== targetH) {
        dopplerCanvas.width = targetW;
        dopplerCanvas.height = targetH;
        dopplerCanvas.style.width = size.x + 'px';
        dopplerCanvas.style.height = size.y + 'px';
    }

    dopplerCtx.setTransform(1, 0, 0, 1, 0, 0);
    dopplerCtx.scale(dpr, dpr);

    const allCells = [...localEchoCells, ...regionalEchoCells];
    if (allCells.length === 0) {
        dopplerCtx.clearRect(0, 0, size.x, size.y);
        return;
    }

    // Cuadrícula rasterizada continua IDW (Inverse Distance Weighting)
    const S = 3;
    const gw = Math.ceil(size.x / S);
    const gh = Math.ceil(size.y / S);

    if (dopplerOffscreenCanvas.width !== gw || dopplerOffscreenCanvas.height !== gh) {
        dopplerOffscreenCanvas.width = gw;
        dopplerOffscreenCanvas.height = gh;
    }

    const grid = new Float32Array(gw * gh);
    const zoom = radarMap.getZoom();

    for (let c = 0; c < allCells.length; c++) {
        const cell = allCells[c];
        const pt = radarMap.latLngToContainerPoint([cell.lat, cell.lon]);

        // Proyección adaptativa del radio de la célula según zoom:
        // Evita que desaparezca al alejar (mínimo visible 28px)
        // y evita que se desvanezca o se lave al acercar (máximo suave adaptado)
        const cosLat = Math.cos(cell.lat * Math.PI / 180);
        const radiusM = cell.radius || 35000;
        const edge = radarMap.latLngToContainerPoint([cell.lat, cell.lon + radiusM / (111320 * (cosLat > 0.05 ? cosLat : 1.0))]);
        const geoPx = Math.hypot(edge.x - pt.x, edge.y - pt.y);

        const minPx = Math.max(28, 18 + zoom * 2.2);
        const maxAllowedPx = Math.max(minPx, 80 + zoom * 26);
        const rPx = Math.max(minPx, Math.min(geoPx, maxAllowedPx));

        // Descartar solo si está completamente fuera de la vista de pantalla visible (más el radio rPx)
        if (pt.x < -rPx || pt.x > size.x + rPx || pt.y < -rPx || pt.y > size.y + rPx) {
            continue;
        }

        const sx = pt.x / S;
        const sy = pt.y / S;
        const sr = rPx / S;

        const maxR = sr * 1.35;
        const minX = Math.max(0, Math.floor(sx - maxR));
        const maxX = Math.min(gw - 1, Math.ceil(sx + maxR));
        const minY = Math.max(0, Math.floor(sy - maxR));
        const maxY = Math.min(gh - 1, Math.ceil(sy + maxR));
        if (minX > maxX || minY > maxY) continue;

        const seed = cell.seed || (Math.abs(cell.lat * 1000 + cell.lon * 100) % 100);

        for (let y = minY; y <= maxY; y++) {
            const dy = y - sy;
            const row = y * gw;
            for (let x = minX; x <= maxX; x++) {
                const dx = x - sx;
                const dist = Math.hypot(dx, dy);
                // Ruido Simplex al contorno para siluetas de lluvia orgánicas
                const noise = DopplerSimplex.noise2D(x * 0.055 + seed, y * 0.055 + seed) * 0.35;
                const effR = sr * (1.0 + noise);
                if (dist < effR) {
                    // Núcleo Doppler central sólido (40% del radio) y desvanecimiento suave hacia el borde
                    const coreFrac = 0.40;
                    let norm = 1.0;
                    if (dist > effR * coreFrac) {
                        norm = 1.0 - ((dist - effR * coreFrac) / (effR * (1.0 - coreFrac)));
                    }
                    const val = cell.dbz * Math.pow(Math.max(0, norm), 0.85) * (cell.opacityMult || 1.0);
                    const idx = row + x;
                    if (val > grid[idx]) {
                        grid[idx] = val;
                    }
                }
            }
        }
    }

    const imgData = dopplerOffscreenCtx.createImageData(gw, gh);
    const data = imgData.data;

    for (let i = 0; i < grid.length; i++) {
        const dbz = grid[i];
        if (dbz >= 10) {
            const lutIdx = Math.min(75, Math.round(dbz)) * 4;
            const pIdx = i * 4;
            data[pIdx] = DOPPLER_LUT[lutIdx];
            data[pIdx + 1] = DOPPLER_LUT[lutIdx + 1];
            data[pIdx + 2] = DOPPLER_LUT[lutIdx + 2];
            data[pIdx + 3] = DOPPLER_LUT[lutIdx + 3];
        }
    }

    dopplerOffscreenCtx.putImageData(imgData, 0, 0);

    dopplerCtx.clearRect(0, 0, size.x, size.y);
    dopplerCtx.save();
    // Blur gaussiano leve y bordes que se desvanecen a transparente
    dopplerCtx.filter = 'blur(4px)';
    dopplerCtx.imageSmoothingEnabled = true;
    dopplerCtx.imageSmoothingQuality = 'high';
    dopplerCtx.drawImage(dopplerOffscreenCanvas, 0, 0, size.x, size.y);
    dopplerCtx.restore();
}

// Catálogo de localidades con "puntos azulitos" interactivos en el radar
const RADAR_CITIES = [
    { name: "Bogotá", country: "Colombia", lat: 4.7110, lon: -74.0721, isColombia: true },
    { name: "Medellín", country: "Colombia", lat: 6.2442, lon: -75.5812, isColombia: true },
    { name: "Cali", country: "Colombia", lat: 3.4516, lon: -76.5320, isColombia: true },
    { name: "Barranquilla", country: "Colombia", lat: 10.9685, lon: -74.7813, isColombia: true },
    { name: "Juan Mina", country: "Colombia (Barranquilla)", lat: 10.9558, lon: -74.8917, isColombia: true },
    { name: "Cartagena", country: "Colombia", lat: 10.3910, lon: -75.4794, isColombia: true },
    { name: "Bucaramanga", country: "Colombia", lat: 7.1254, lon: -73.1198, isColombia: true },
    { name: "Santa Marta", country: "Colombia", lat: 11.2408, lon: -74.1990, isColombia: true },
    { name: "Pereira", country: "Colombia", lat: 4.8133, lon: -75.6961, isColombia: true },
    { name: "Cúcuta", country: "Colombia", lat: 7.8939, lon: -72.5078, isColombia: true },
    { name: "Manizales", country: "Colombia", lat: 5.0689, lon: -75.5174, isColombia: true },
    { name: "Villavicencio", country: "Colombia", lat: 4.1420, lon: -73.6266, isColombia: true },
    { name: "Pasto", country: "Colombia", lat: 1.2136, lon: -77.2811, isColombia: true },
    { name: "San Andrés", country: "Colombia", lat: 12.5847, lon: -81.7006, isColombia: true },
    { name: "Mississippi", country: "EE.UU.", lat: 32.2988, lon: -90.1848, isColombia: false },
    { name: "Oklahoma", country: "EE.UU.", lat: 35.4676, lon: -97.5164, isColombia: false },
    { name: "Kansas", country: "EE.UU.", lat: 37.6922, lon: -97.3375, isColombia: false },
    { name: "Texas", country: "EE.UU.", lat: 29.7604, lon: -95.3698, isColombia: false },
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

function formatTempDisplay(cVal, fVal, withUnit = true) {
    const val = currentUnit === 'C' ? cVal : fVal;
    const unit = withUnit ? `°${currentUnit}` : '';
    return `${val}${unit}`;
}

// --------------------------------------------------------------------------
// 2. Transición Dinámica de Ciudad (SIN RECARGAR LA PÁGINA)
// --------------------------------------------------------------------------
async function selectCity(cityName) {
    if (!cityName) return;
    cityName = cityName.trim();

    const spinner = document.getElementById('searchBtnSpinner');
    const btnText = document.getElementById('searchBtnText');
    const searchInput = document.getElementById('citySearchInput');

    if (spinner) spinner.classList.remove('d-none');
    if (btnText) btnText.textContent = 'Cargando...';

    try {
        const response = await fetch(`/Home/GetWeatherData?city=${encodeURIComponent(cityName)}&provider=${encodeURIComponent(currentProvider)}`);
        if (!response.ok) throw new Error("Error al consultar datos");

        const data = await response.json();
        currentCityName = data.city;

        // Actualizar URL en el navegador sin recargar la página
        const newUrl = `/?city=${encodeURIComponent(data.city)}&provider=${encodeURIComponent(currentProvider)}`;
        window.history.pushState({ city: data.city, provider: currentProvider }, '', newUrl);
        document.title = `${data.city} - Radar y Clima - ClimaSpace`;

        // Actualizar input de búsqueda
        if (searchInput) searchInput.value = data.city;

        // 1. Actualizar el mapa y la posición
        if (radarMap) {
            radarMap.flyTo([data.latitude, data.longitude], Math.max(radarMap.getZoom(), 7), {
                duration: 1.2,
                easeLinearity: 0.25
            });
        }

        window.cityCoordinates = {
            lat: data.latitude,
            lon: data.longitude,
            name: data.city,
            temp: data.current.temperatureC,
            desc: data.current.conditionDescription,
            precip: data.current.precipitationMm
        };

        // 2. Actualizar puntos azulitos y reflejar ciudad activa
        highlightActiveCityDot(data.city);

        // 3. Actualizar ecos Doppler de lluvia y feed en vivo
        renderPrecipitationEchoes(data.latitude, data.longitude, data.current.conditionDescription, data.current.precipitationMm, data.city);
        fetchLiveDopplerRadarFeed();

        // 4. Actualizar Tarjeta "El tiempo ahora en: [Ciudad]"
        updateSelectedCard(data);

        // 5. Actualizar Tarjeta Hero y Pronóstico de 24h
        updateHeroCard(data);

        // 6. Actualizar Pronóstico de 7 días
        updateDailyForecast(data.daily);

        // 7. Actualizar Grilla de 8 Métricas Secundarias
        updateSecondaryMetrics(data.current);

        // 8. Actualizar píldoras de sugerencias
        updateSuggestionPills(data.city);

    } catch (err) {
        console.error("Error al actualizar ciudad:", err);
    } finally {
        if (spinner) spinner.classList.add('d-none');
        if (btnText) btnText.textContent = 'Buscar';
    }
}

function handleSearchSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('citySearchInput');
    if (input && input.value) {
        selectCity(input.value);
    }
}

function switchProvider(provider) {
    if (currentProvider === provider) return;
    currentProvider = provider;

    const btnLive = document.getElementById('providerLiveBtn');
    const btnSim = document.getElementById('providerSimBtn');

    if (btnLive && btnSim) {
        if (provider === 'live') {
            btnLive.classList.add('active');
            btnSim.classList.remove('active');
        } else {
            btnSim.classList.add('active');
            btnLive.classList.remove('active');
        }
    }

    // Refrescar la ciudad actual con el nuevo proveedor sin recargar la página
    selectCity(currentCityName);
}

// --------------------------------------------------------------------------
// 3. Actualizadores DOM para SPA
// --------------------------------------------------------------------------
function updateSelectedCard(data) {
    const elCity = document.getElementById('selectedCardCity');
    const elCountry = document.getElementById('selectedCardCountry');
    const elTime = document.getElementById('selectedCardTime');
    const elTemp = document.getElementById('selectedCardTemp');
    const elDesc = document.getElementById('selectedCardDesc');
    const elIcon = document.getElementById('selectedCardIcon');
    const elFeels = document.getElementById('selectedCardFeelsLike');
    const elHum = document.getElementById('selectedCardHumidity');
    const elWind = document.getElementById('selectedCardWind');
    const elBadge = document.getElementById('selectedCardProviderBadge');

    if (elCity) elCity.textContent = data.city;
    if (elCountry) {
        elCountry.textContent = data.country.toLowerCase().includes('colombia') ? '🇨🇴 Colombia' : data.country;
    }
    if (elTime) {
        const dateObj = new Date(data.localTime);
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        elTime.textContent = `${timeStr}`;
    }
    if (elTemp) {
        elTemp.setAttribute('data-temp-c', data.current.temperatureC);
        elTemp.setAttribute('data-temp-f', data.current.temperatureF);
        elTemp.textContent = formatTempDisplay(data.current.temperatureC, data.current.temperatureF, false);
    }
    if (elDesc) elDesc.textContent = data.current.conditionDescription;
    if (elIcon) elIcon.className = `bi ${data.current.iconClass} fs-1 text-warning`;
    if (elFeels) {
        elFeels.setAttribute('data-temp-c', data.current.feelsLikeC);
        elFeels.setAttribute('data-temp-f', data.current.feelsLikeF);
        elFeels.textContent = formatTempDisplay(data.current.feelsLikeC, data.current.feelsLikeF, true);
    }
    if (elHum) elHum.textContent = `${data.current.humidity}%`;
    if (elWind) elWind.textContent = `${data.current.windSpeedKmh} km/h`;
    if (elBadge) {
        elBadge.className = data.isLiveApi ? 'badge bg-success rounded-pill px-2 py-1 small' : 'badge bg-warning text-dark rounded-pill px-2 py-1 small';
        elBadge.textContent = data.isLiveApi ? 'En Vivo' : 'Simulado';
    }

    if (isFullscreenCityCardCollapsed) {
        const text = document.getElementById('textToggleFullscreenCard');
        if (text) text.textContent = `Ver información (${data.city})`;
    }
}

function updateHeroCard(data) {
    const elCity = document.getElementById('heroCityName');
    const elCountry = document.getElementById('heroCountryBadge');
    const elCoords = document.getElementById('heroCoords');
    const elTemp = document.getElementById('heroTemp');
    const elFeels = document.getElementById('heroFeelsLike');
    const elDesc = document.getElementById('heroDesc');
    const elIcon = document.getElementById('heroIcon');
    const elSunrise = document.getElementById('heroSunrise');
    const elSunset = document.getElementById('heroSunset');
    const elStatus = document.getElementById('heroStatusText');

    if (elCity) elCity.textContent = data.city;
    if (elCountry) {
        let countryName = data.country;
        if (!countryName && data.city && data.city.includes(',')) {
            countryName = data.city.split(',').pop().trim();
        }
        if (!countryName) countryName = 'Colombia';
        elCountry.innerHTML = `<i class="bi bi-geo-alt-fill text-warning"></i> <span id="heroCountryText">${countryName}</span>`;
    }
    if (elCoords) elCoords.textContent = `Lat: ${data.latitude}, Lon: ${data.longitude}`;
    if (elStatus) elStatus.textContent = `Actualizado para ${data.city}`;
    if (elTemp) {
        elTemp.setAttribute('data-temp-c', data.current.temperatureC);
        elTemp.setAttribute('data-temp-f', data.current.temperatureF);
        elTemp.textContent = formatTempDisplay(data.current.temperatureC, data.current.temperatureF, false);
    }
    if (elFeels) {
        elFeels.setAttribute('data-temp-c', data.current.feelsLikeC);
        elFeels.setAttribute('data-temp-f', data.current.feelsLikeF);
        elFeels.textContent = formatTempDisplay(data.current.feelsLikeC, data.current.feelsLikeF, true);
    }
    if (elDesc) elDesc.textContent = data.current.conditionDescription;
    if (elIcon) elIcon.className = `bi ${data.current.iconClass} weather-hero-icon text-warning`;
    if (elSunrise) elSunrise.textContent = data.current.sunrise;
    if (elSunset) elSunset.textContent = data.current.sunset;

    // Actualizar cinta horizontal de 24 horas con animación escalonada
    const hourlyContainer = document.getElementById('hourlyForecastContainer');
    if (hourlyContainer && data.hourly) {
        hourlyContainer.innerHTML = data.hourly.map((h, idx) => {
            const iconCls = (h.iconClass || '').replace('text-primary', 'text-white');
            return `
            <div class="hourly-card-white" style="animation-delay: ${idx * 35}ms;">
                <div class="small text-white-50 mb-1">${h.time}</div>
                <i class="bi ${iconCls} fs-3 my-2 d-block"></i>
                <div class="fw-bold mb-1" data-temp-c="${h.temperatureC}" data-temp-f="${h.temperatureF}">
                    ${formatTempDisplay(h.temperatureC, h.temperatureF, true)}
                </div>
                ${h.precipitationProbability > 0 ? 
                    `<div class="small text-info fw-semibold"><i class="bi bi-droplet-fill small"></i>${h.precipitationProbability}%</div>` :
                    `<div class="small text-white-50">-</div>`}
            </div>
        `;
        }).join('');
    }
}

function updateDailyForecast(daily) {
    const dailyContainer = document.getElementById('dailyForecastContainer');
    if (!dailyContainer || !daily) return;

    dailyContainer.innerHTML = daily.map(d => {
        const dateObj = new Date(d.date);
        const dateStr = dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });

        return `
            <div class="daily-row-white d-flex align-items-center justify-content-between py-3">
                <div style="min-width: 90px;">
                    <div class="fw-bold text-dark">${d.dayName}</div>
                    <div class="small text-muted">${dateStr}</div>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <i class="bi ${d.iconClass} fs-4"></i>
                    ${d.precipitationProbability > 15 ? 
                        `<span class="badge bg-primary-subtle text-primary border border-primary-subtle small" style="font-size: 0.72rem;">${d.precipitationProbability}%</span>` : 
                        ''}
                </div>
                <div class="text-end" style="min-width: 110px;">
                    <div class="d-flex justify-content-end align-items-center gap-2">
                        <span class="small text-muted" data-temp-c="${d.minTempC}" data-temp-f="${d.minTempF}">
                            ${formatTempDisplay(d.minTempC, d.minTempF, true)}
                        </span>
                        <div class="temp-bar-bg-blue flex-grow-1" style="width: 50px;">
                            <div class="temp-bar-fill-blue" style="width: 75%;"></div>
                        </div>
                        <span class="fw-bold text-dark" data-temp-c="${d.maxTempC}" data-temp-f="${d.maxTempF}">
                            ${formatTempDisplay(d.maxTempC, d.maxTempF, true)}
                        </span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function updateSecondaryMetrics(current) {
    const elHum = document.getElementById('metricHumidity');
    const elWind = document.getElementById('metricWind');
    const elWindDir = document.getElementById('metricWindDir');
    const elUv = document.getElementById('metricUv');
    const elPress = document.getElementById('metricPressure');
    const elVis = document.getElementById('metricVisibility');
    const elDew = document.getElementById('metricDewPoint');
    const elAir = document.getElementById('metricAirQuality');

    if (elHum) elHum.textContent = `${current.humidity}%`;
    if (elWind) elWind.textContent = current.windSpeedKmh;
    if (elWindDir) elWindDir.textContent = current.windDirection;
    if (elUv) elUv.textContent = current.uvIndex;
    if (elPress) elPress.textContent = current.pressureHpa;
    if (elVis) elVis.textContent = current.visibilityKm;
    if (elDew) {
        const dewF = Math.round(current.dewPointC * 9.0 / 5.0 + 32.0, 1);
        elDew.setAttribute('data-temp-c', current.dewPointC);
        elDew.setAttribute('data-temp-f', dewF);
        elDew.textContent = formatTempDisplay(current.dewPointC, dewF, true);
    }
    if (elAir) elAir.textContent = current.airQuality;
}

function updateSuggestionPills(activeCity) {
    const pills = document.querySelectorAll('#popularCitiesContainer .city-pill-white');
    pills.forEach(pill => {
        const cityName = pill.getAttribute('data-city') || pill.textContent.trim();
        const isActive = cityName.toLowerCase() === activeCity.toLowerCase() || 
                         (cityName === 'Bogotá' && activeCity.includes('Bogot'));
        if (isActive) {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });
}

// --------------------------------------------------------------------------
// 4. Inicialización del Radar Doppler Meteorológico
// --------------------------------------------------------------------------
function initWeatherRadar(lat, lon, cityName, currentTemp, conditionDesc, precipMm) {
    const mapContainer = document.getElementById('weatherRadarMap');
    if (!mapContainer || typeof L === 'undefined') return;

    if (radarMap) {
        radarMap.remove();
        radarMap = null;
        radarTileLayers = [null, null];
        activeBufferIndex = 0;
    }

    // Configuración robusta de Leaflet
    radarMap = L.map('weatherRadarMap', {
        center: [lat, lon],
        zoom: 7,
        minZoom: 2,
        maxZoom: 18,
        zoomControl: true,
        attributionControl: false
    });

    // 1. Capa Base Principal: Esri Light Gray Canvas (Nativo, limpio, sin marcas de agua y SIN saturación de departamentos)
    const esriLightBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 16,
        maxZoom: 18,
        minZoom: 2,
        attribution: '&copy; Esri, HERE'
    }).addTo(radarMap);

    // 2. Capa Alternativa: Satélite Meteorológico HD (Completamente limpio, sin texto de departamentos)
    const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 18,
        maxZoom: 18,
        minZoom: 2,
        attribution: '&copy; Esri World Imagery'
    });

    L.control.layers({
        "Mapa Radar Limpio (Sin texto)": esriLightBase,
        "Satélite Meteorológico HD": esriSatellite
    }, null, { position: 'topright' }).addTo(radarMap);

    // 2.5 Inicializar lienzo canvas de ecos continuos Doppler
    initDopplerCanvas();

    radarMap.on('move zoom zoomend moveend resize viewreset', () => {
        renderDopplerCanvas();
    });

    radarMap.on('baselayerchange', (e) => {
        const c = document.getElementById('dopplerRadarCanvas');
        if (c) {
            c.classList.toggle('mode-normal', e.name && e.name.includes('Satélite'));
        }
    });

    // 3. Crear pane dedicado para los ecos Doppler (por encima de mapas y RainViewer, zIndex 420)
    if (!radarMap.getPane('dopplerEchoPane')) {
        radarMap.createPane('dopplerEchoPane');
        radarMap.getPane('dopplerEchoPane').style.zIndex = 420;
    }

    // 4. Agregar PUNTOS AZULITOS interactivos en el mapa
    addRadarCityDots(cityName);

    // 5. Graficación visible de Ecos Doppler con todos los colores
    renderPrecipitationEchoes(lat, lon, conditionDesc, precipMm, cityName);

    // 6. Consultar y renderizar feed en vivo de la API meteorológica (Open-Meteo)
    fetchLiveDopplerRadarFeed();

    // 6.5 Cargar y monitorear huracanes y ciclones oficiales en vivo (NOAA / JTWC)
    loadRadarHurricanes();

    // 7. Cargar mosaicos de Radar RainViewer (capa dual)
    loadRainViewerRadarLayers();

    // 8. Re-escanear tormentas severas al mover o hacer zoom en el mapa si el barrido está activo
    radarMap.on('moveend zoomend', () => {
        if (isDopplerSweepActive) {
            scanDopplerForSevereStorms();
        }
    });

    if (isDopplerSweepActive) {
        scanDopplerForSevereStorms();
    }
}

function addRadarCityDots(activeCityName) {
    if (!radarMap) return;
    radarCityMarkers = [];

    RADAR_CITIES.forEach(city => {
        const isActive = activeCityName && (
            city.name.toLowerCase() === activeCityName.toLowerCase() ||
            activeCityName.toLowerCase().includes(city.name.toLowerCase())
        );

        const dotClass = isActive ? "radar-city-dot active-city" : "radar-city-dot";
        const dotHtml = `<div class="${dotClass}" id="dot-${city.name.replace(/\s+/g, '')}" title="${city.name}"></div>`;

        const dotIcon = L.divIcon({
            className: 'radar-dot-wrapper',
            html: dotHtml,
            iconSize: isActive ? [12, 12] : [8, 8],
            iconAnchor: isActive ? [6, 6] : [4, 4]
        });

        const marker = L.marker([city.lat, city.lon], { icon: dotIcon, zIndexOffset: isActive ? 500 : 100 }).addTo(radarMap);

        marker.bindTooltip(`<strong>${city.name}</strong> <span class="text-secondary small">(${city.country})</span>`, {
            direction: 'top',
            offset: [0, -8],
            className: 'shadow-sm border rounded-pill px-2 py-1 small'
        });

        // Al hacer clic: ACTUALIZA TODO VÍA AJAX SIN RECARGAR LA PÁGINA
        marker.on('click', () => {
            selectCity(city.name);
        });

        radarCityMarkers.push({ name: city.name, marker: marker });
    });
}

function highlightActiveCityDot(cityName) {
    RADAR_CITIES.forEach(city => {
        const dotEl = document.getElementById(`dot-${city.name.replace(/\s+/g, '')}`);
        if (!dotEl) return;

        const isActive = cityName && (
            city.name.toLowerCase() === cityName.toLowerCase() ||
            cityName.toLowerCase().includes(city.name.toLowerCase())
        );

        if (isActive) {
            dotEl.className = "radar-city-dot active-city";
        } else {
            dotEl.className = "radar-city-dot";
        }
    });
}

// --------------------------------------------------------------------------
// 5. Visualización Gráfica Completa de Ecos Doppler (Verde -> Púrpura)
// --------------------------------------------------------------------------
function setManualDopplerLevel(level) {
    currentManualLevel = (level === 'auto' || level === currentManualLevel) ? null : level;

    // Actualizar clase activa en píldoras
    document.querySelectorAll('.radar-color-pill').forEach(pill => {
        pill.classList.remove('active-level');
    });
    if (currentManualLevel) {
        const activePill = document.querySelector(`.radar-color-pill.c-${currentManualLevel}`);
        if (activePill) activePill.classList.add('active-level');
    }

    if (window.cityCoordinates) {
        renderPrecipitationEchoes(
            window.cityCoordinates.lat,
            window.cityCoordinates.lon,
            window.cityCoordinates.desc,
            window.cityCoordinates.precip,
            window.cityCoordinates.name,
            currentManualLevel
        );
    }

    if (!currentManualLevel) {
        fetchLiveDopplerRadarFeed();
    }

    // Si se activa nivel Rojo o Granizo, iniciar el barrido Doppler automáticamente para detectarlo
    if ((level === 'red' || level === 'purple') && !isDopplerSweepActive) {
        toggleRadarSweep();
    } else if (isDopplerSweepActive) {
        scanDopplerForSevereStorms();
    }
}

function renderPrecipitationEchoes(lat, lon, conditionDesc, precipMm, cityName, forcedLevel) {
    if (!radarMap) return;

    if (!radarMap.getPane('dopplerEchoPane')) {
        radarMap.createPane('dopplerEchoPane');
        radarMap.getPane('dopplerEchoPane').style.zIndex = 420;
    }

    if (rainEchoGroup) {
        radarMap.removeLayer(rainEchoGroup);
    }
    rainEchoGroup = L.layerGroup().addTo(radarMap);
    localEchoCells = [];

    const badge = document.getElementById('radarActiveEchoBadge');
    const desc = (conditionDesc || "").toLowerCase();
    const precip = typeof precipMm === 'number' ? precipMm : 0;
    const city = cityName || (window.cityCoordinates ? window.cityCoordinates.name : "esta zona");

    // Determinar nivel Doppler
    let level = forcedLevel || currentManualLevel;

    if (!level) {
        const isSevereHail = desc.includes("granizo") || desc.includes("sever") || precip >= 30;
        const isTorrential = desc.includes("torment") || desc.includes("torrencial") || (precip >= 15 && precip < 30);
        const isHeavy = desc.includes("fuerte") || desc.includes("intens") || desc.includes("chubasc") || (precip >= 7.5 && precip < 15);
        const isModerate = desc.includes("moderad") || (precip >= 2.5 && precip < 7.5);
        const isDrizzle = desc.includes("llovizn") || desc.includes("drizzle") || desc.includes("ligera") || desc.includes("lluv") || (precip > 0 && precip < 2.5);

        if (isSevereHail) level = 'purple';
        else if (isTorrential) level = 'red';
        else if (isHeavy) level = 'orange';
        else if (isModerate) level = 'yellow';
        else if (isDrizzle) level = 'green';
    }

    if (level === 'green') {
        if (badge) {
            badge.className = "badge bg-success text-white rounded-pill px-3 py-1 small fw-bold shadow-sm";
            badge.innerHTML = `<i class="bi bi-cloud-drizzle-fill me-1"></i>🟩 Eco Verde: Llovizna activa en ${city} (5 - 25 dBZ)`;
        }
        // Celda central y satélites orgánicos (sin bordes stroke ni anillos concéntricos)
        localEchoCells.push({ lat, lon, radius: 46000, dbz: 22, opacityMult: 1.0, seed: 14 });
        localEchoCells.push({ lat: lat + 0.12, lon: lon - 0.14, radius: 34000, dbz: 18, opacityMult: 0.9, seed: 48 });
        localEchoCells.push({ lat: lat - 0.10, lon: lon + 0.12, radius: 28000, dbz: 16, opacityMult: 0.85, seed: 75 });

        // Hit-layer invisible para tooltip
        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 46000,
            stroke: false,
            fillColor: '#000000',
            fillOpacity: 0.0001,
            interactive: true
        }).bindTooltip(`🟩 <strong>Eco Doppler Verde (18 dBZ):</strong> Llovizna activa en ${city} (&lt; 2.5 mm/h)`, { direction: 'top' }).addTo(rainEchoGroup);
    }
    else if (level === 'yellow') {
        if (badge) {
            badge.className = "badge bg-warning text-dark rounded-pill px-3 py-1 small fw-bold shadow-sm";
            badge.innerHTML = `<i class="bi bi-cloud-rain-fill me-1"></i>🟨 Eco Amarillo: Lluvia Moderada en ${city} (25 - 35 dBZ)`;
        }
        localEchoCells.push({ lat, lon, radius: 48000, dbz: 33, opacityMult: 1.0, seed: 25 });
        localEchoCells.push({ lat: lat + 0.10, lon: lon - 0.12, radius: 32000, dbz: 25, opacityMult: 0.9, seed: 59 });

        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 48000,
            stroke: false,
            fillColor: '#000000',
            fillOpacity: 0.0001,
            interactive: true
        }).bindTooltip(`🟨 <strong>Eco Doppler Amarillo (30 dBZ):</strong> Lluvia moderada en ${city} (2.5 - 7.5 mm/h)`, { direction: 'top' }).addTo(rainEchoGroup);
    }
    else if (level === 'orange') {
        if (badge) {
            badge.className = "badge bg-danger text-white rounded-pill px-3 py-1 small fw-bold shadow-sm";
            badge.innerHTML = `<i class="bi bi-cloud-rain-heavy-fill me-1"></i>🟧 Eco Naranja: Lluvia Fuerte en ${city} (35 - 45 dBZ)`;
        }
        localEchoCells.push({ lat, lon, radius: 50000, dbz: 43, opacityMult: 1.0, seed: 36 });
        localEchoCells.push({ lat: lat + 0.08, lon: lon - 0.10, radius: 34000, dbz: 32, opacityMult: 0.9, seed: 68 });

        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 50000,
            stroke: false,
            fillColor: '#000000',
            fillOpacity: 0.0001,
            interactive: true
        }).bindTooltip(`🟧 <strong>Eco Doppler Naranja (40 dBZ):</strong> Lluvia fuerte en ${city} (7.5 - 15 mm/h)`, { direction: 'top' }).addTo(rainEchoGroup);
    }
    else if (level === 'red') {
        if (badge) {
            badge.className = "badge bg-danger text-white rounded-pill px-3 py-1 small fw-bold shadow-sm";
            badge.innerHTML = `<i class="bi bi-cloud-lightning-rain-fill me-1"></i>🟥 Eco Rojo: Tormenta / Lluvia Torrencial (45 - 55 dBZ)`;
        }
        localEchoCells.push({ lat, lon, radius: 52000, dbz: 53, opacityMult: 1.0, seed: 47 });
        localEchoCells.push({ lat: lat + 0.06, lon: lon - 0.08, radius: 36000, dbz: 38, opacityMult: 0.9, seed: 81 });

        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 52000,
            stroke: false,
            fillColor: '#000000',
            fillOpacity: 0.0001,
            interactive: true
        }).bindTooltip(`🟥 <strong>Eco Doppler Rojo (50 dBZ):</strong> Tormenta y Lluvia Torrencial en ${city} (15 - 30 mm/h)`, { direction: 'top' }).addTo(rainEchoGroup);
    }
    else if (level === 'purple') {
        if (badge) {
            badge.className = "badge text-white rounded-pill px-3 py-1 small fw-bold shadow-sm";
            badge.style.backgroundColor = '#7c3aed';
            badge.innerHTML = `<i class="bi bi-lightning-charge-fill me-1"></i>🟪 Eco Severo: Tormenta Extrema / Granizo (> 55 dBZ)`;
        }
        localEchoCells.push({ lat, lon, radius: 55000, dbz: 63, opacityMult: 1.0, seed: 58 });
        localEchoCells.push({ lat: lat + 0.05, lon: lon - 0.07, radius: 38000, dbz: 46, opacityMult: 0.9, seed: 93 });

        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 55000,
            stroke: false,
            fillColor: '#000000',
            fillOpacity: 0.0001,
            interactive: true
        }).bindTooltip(`🟪 <strong>Alerta Doppler (60 dBZ):</strong> Tormenta Severa / Granizo en ${city} (> 30 mm/h)`, { direction: 'top' }).addTo(rainEchoGroup);
    }
    else {
        if (badge) {
            badge.className = "badge bg-light text-secondary border rounded-pill px-3 py-1 small";
            badge.innerHTML = `<i class="bi bi-cloud-sun me-1"></i>Sin precipitación en ${city} (0.0 mm/h — Despejado)`;
        }
        localEchoCells = [];
    }

    renderDopplerCanvas();

    if (isDopplerSweepActive) {
        scanDopplerForSevereStorms();
    }
}

// --------------------------------------------------------------------------
// 6. Ecos Doppler en Vivo desde la API Meteorológica Real (100% DATOS REALES)
// --------------------------------------------------------------------------
async function fetchLiveDopplerRadarFeed() {
    if (isFetchingLiveDoppler) return;
    const now = Date.now();
    // Cachear durante 45 segundos para no saturar y mantener respuestas en vivo instantáneas
    if (now - liveRadarLastFetched < 45000 && liveRadarEchoes.length > 0) {
        regionalEchoCells = [...liveRadarEchoes];
        renderDopplerCanvas();
        return;
    }

    isFetchingLiveDoppler = true;
    try {
        const queryCities = [...RADAR_CITIES];
        if (window.cityCoordinates && !queryCities.some(c => 
            Math.abs(c.lat - window.cityCoordinates.lat) < 0.05 && 
            Math.abs(c.lon - window.cityCoordinates.lon) < 0.05)) {
            queryCities.push({
                name: window.cityCoordinates.name,
                country: "Local",
                lat: window.cityCoordinates.lat,
                lon: window.cityCoordinates.lon,
                isColombia: true
            });
        }

        const lats = queryCities.map(c => c.lat.toFixed(4)).join(',');
        const lons = queryCities.map(c => c.lon.toFixed(4)).join(',');
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);

        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!resp.ok) throw new Error(`Open-Meteo API HTTP ${resp.status}`);
        const data = await resp.json();
        const items = Array.isArray(data) ? data : [data];

        const generatedEchoes = [];

        items.forEach((item, idx) => {
            const city = queryCities[idx];
            if (!city || !item.current) return;

            const cur = item.current;
            const precip = Math.max(cur.precipitation || 0, cur.rain || 0);
            const code = cur.weather_code || 0;
            const clouds = cur.cloud_cover || 0;
            const temp = cur.temperature_2m;
            const windSpd = cur.wind_speed_10m || 0;
            const windDir = cur.wind_direction_10m || 0;

            let dbz = 0;
            let conditionText = "Despejado";

            // Relación Z-R Marshall-Palmer para reflectividad real de radar
            if (precip > 0.05) {
                dbz = Math.min(65, Math.max(16, Math.round(10 * Math.log10(200 * Math.pow(precip, 1.6)))));
                if (dbz >= 55) conditionText = `Tormenta Severa / Granizo (${precip.toFixed(1)} mm/h)`;
                else if (dbz >= 45) conditionText = `Tormenta / Lluvia Fuerte (${precip.toFixed(1)} mm/h)`;
                else if (dbz >= 35) conditionText = `Lluvia Fuerte (${precip.toFixed(1)} mm/h)`;
                else if (dbz >= 25) conditionText = `Lluvia Moderada (${precip.toFixed(1)} mm/h)`;
                else conditionText = `Llovizna (${precip.toFixed(1)} mm/h)`;
            } else if ([95, 96, 99].includes(code)) {
                dbz = 52;
                conditionText = "Tormenta Eléctrica";
            } else if ([80, 81, 82].includes(code)) {
                dbz = 36;
                conditionText = "Chubascos Dispersos";
            } else if ([61, 63, 65, 66, 67].includes(code)) {
                dbz = code === 65 ? 42 : (code === 63 ? 34 : 26);
                conditionText = "Lluvia Activa";
            } else if ([51, 53, 55, 56, 57].includes(code)) {
                dbz = code === 55 ? 24 : 18;
                conditionText = "Llovizna Fina";
            } else if ([45, 48].includes(code) && clouds >= 80) {
                dbz = 15;
                conditionText = "Niebla Densa / Humedad";
            }

            // Actualizar tooltip del marcador de ciudad con métricas atmosféricas reales
            const markerObj = radarCityMarkers.find(m => m.name.toLowerCase() === city.name.toLowerCase());
            if (markerObj && markerObj.marker) {
                const dbzBadge = dbz >= 45 ? `<span class="badge bg-danger text-white ms-1">${dbz} dBZ</span>` :
                                 (dbz >= 25 ? `<span class="badge bg-warning text-dark ms-1">${dbz} dBZ</span>` :
                                 (dbz >= 12 ? `<span class="badge bg-success text-white ms-1">${dbz} dBZ</span>` : ''));
                markerObj.marker.bindTooltip(`
                    <div class="p-1">
                        <strong>${city.name}</strong> <span class="text-secondary small">(${city.country})</span>
                        <div class="small text-muted mt-1">
                            <i class="bi bi-thermometer-half text-danger"></i> ${temp}°C • ${conditionText} ${dbzBadge}
                        </div>
                        <div class="small text-muted">
                            <i class="bi bi-wind text-info"></i> ${windSpd} km/h • Nubes: ${clouds}%
                        </div>
                    </div>
                `, { direction: 'top', offset: [0, -8], className: 'shadow border rounded p-1 small' });
            }

            // Si hay reflectividad Doppler detectable (>= 12 dBZ), generar células en el canvas
            if (dbz >= 12) {
                const baseR = Math.min(52000, Math.max(22000, 20000 + dbz * 480));
                // Célula central
                generatedEchoes.push({
                    lat: city.lat,
                    lon: city.lon,
                    radius: baseR,
                    baseRadius: baseR,
                    dbz: dbz,
                    baseDbz: dbz,
                    opacityMult: 1.0,
                    seed: (idx * 29 + 17) % 100,
                    name: city.name
                });

                // Célula satélite según viento real para contorno Doppler orgánico
                const rad = (windDir * Math.PI) / 180.0;
                const offsetLat = Math.cos(rad) * 0.09 + (Math.sin(idx * 3.7) * 0.04);
                const offsetLon = Math.sin(rad) * 0.09 + (Math.cos(idx * 2.3) * 0.04);
                const satDbz = Math.max(12, dbz - 7);
                generatedEchoes.push({
                    lat: city.lat + offsetLat,
                    lon: city.lon + offsetLon,
                    radius: baseR * 0.74,
                    baseRadius: baseR * 0.74,
                    dbz: satDbz,
                    baseDbz: satDbz,
                    opacityMult: 0.85,
                    seed: (idx * 47 + 53) % 100,
                    name: city.name
                });
            }
        });

        liveRadarEchoes = generatedEchoes;
        regionalEchoCells = [...liveRadarEchoes];
        liveRadarLastFetched = Date.now();

        // Inyectar bandas de lluvia Doppler de huracanes activos si existen
        injectHurricaneDopplerEchoes();

        renderDopplerCanvas();

        const timeDisplay = document.getElementById('radarFrameTime');
        if (timeDisplay && (!radarFrames || radarFrames.length === 0)) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            timeDisplay.innerHTML = `<span class="badge bg-success text-white me-1"><i class="bi bi-broadcast"></i> En Vivo</span> Open-Meteo API (${timeStr})`;
        }

        if (isDopplerSweepActive) {
            scanDopplerForSevereStorms();
        }

    } catch (err) {
        console.warn("Aviso al consultar feed de radar Open-Meteo:", err);
    } finally {
        isFetchingLiveDoppler = false;
    }
}

function renderRegionalColombiaEchoes(frameIndex = null) {
    if (!radarMap) return;

    if (!regionalEchoGroup) {
        regionalEchoGroup = L.layerGroup().addTo(radarMap);
    }

    if (liveRadarEchoes.length === 0) {
        fetchLiveDopplerRadarFeed();
        return;
    }

    if (frameIndex !== null) {
        // Al reproducir la animación en redes 4G, las manchas reales respiran, se modulan y pulsan suavemente
        regionalEchoCells = liveRadarEchoes.map(cell => {
            const phase = Math.sin((frameIndex * 0.6) + cell.seed * 0.1);
            return {
                ...cell,
                radius: cell.baseRadius * (0.85 + 0.3 * (phase * 0.5 + 0.5)),
                dbz: Math.max(10, Math.min(75, cell.baseDbz + Math.round(phase * 4))),
                opacityMult: 0.65 + 0.35 * (phase * 0.5 + 0.5)
            };
        });
    } else {
        regionalEchoCells = [...liveRadarEchoes];
    }

    renderDopplerCanvas();
}

// --------------------------------------------------------------------------
// 6. Carga de Fotogramas del Radar Doppler (RainViewer con Doble Búfer para Redes 4G)
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
            if (timeDisplay) timeDisplay.textContent = "Radar activo (Modo Base)";
            return;
        }

        radarFrames = frames;
        currentRadarIndex = radarFrames.length - 1;

        const initialPath = radarFrames[currentRadarIndex].path;
        const initialUrl = `${radarHost}${initialPath}/256/{z}/{x}/{y}/1/1_1.png`;

        // Limpiar capas previas si existen
        if (radarTileLayers[0] && radarMap.hasLayer(radarTileLayers[0])) radarMap.removeLayer(radarTileLayers[0]);
        if (radarTileLayers[1] && radarMap.hasLayer(radarTileLayers[1])) radarMap.removeLayer(radarTileLayers[1]);

        // Doble búfer para 4G: dos capas alternantes para evitar parpadeos en blanco
        radarTileLayers[0] = L.tileLayer(initialUrl, {
            opacity: 0.85,
            zIndex: 100,
            minNativeZoom: 1,
            minZoom: 2,
            maxNativeZoom: 7,
            maxZoom: 18,
            tileSize: 256,
            keepBuffer: 12
        }).addTo(radarMap);

        radarTileLayers[1] = L.tileLayer('', {
            opacity: 0,
            zIndex: 99,
            minNativeZoom: 1,
            minZoom: 2,
            maxNativeZoom: 7,
            maxZoom: 18,
            tileSize: 256,
            keepBuffer: 12
        }).addTo(radarMap);

        activeBufferIndex = 0;
        updateRadarTimeDisplay(radarFrames[currentRadarIndex].time);

        if (playBtn) playBtn.disabled = false;

    } catch (err) {
        console.warn("RainViewer no disponible o con límite de tasa (429):", err);
        if (timeDisplay) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            timeDisplay.innerHTML = `<span class="badge bg-success text-white me-1"><i class="bi bi-broadcast"></i> En Vivo</span> Open-Meteo Doppler (${timeStr})`;
        }
    } finally {
        if (playBtn) playBtn.disabled = false;
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
    if (radarFrames.length === 0) return;

    currentRadarIndex = index;
    const frame = radarFrames[index];
    const newUrl = `${radarHost}${frame.path}/256/{z}/{x}/{y}/1/1_1.png`;

    // 1. Doble búfer para conexiones 4G móviles:
    // Cargar en la capa inactiva y alternar opacidades para que nunca quede el mapa en blanco
    const nextIndex = 1 - activeBufferIndex;
    const nextLayer = radarTileLayers[nextIndex];
    const currentLayer = radarTileLayers[activeBufferIndex];

    if (nextLayer && currentLayer) {
        nextLayer.setUrl(newUrl);
        nextLayer.setOpacity(0.85);
        setTimeout(() => {
            if (currentLayer && activeBufferIndex !== nextIndex) {
                currentLayer.setOpacity(0);
            }
        }, 320);
        activeBufferIndex = nextIndex;
    } else if (radarTileLayers[0]) {
        radarTileLayers[0].setUrl(newUrl);
    }

    updateRadarTimeDisplay(frame.time);

    // 2. Animar las manchas Doppler para que aparezcan, se muevan y desaparezcan en ciclo
    renderRegionalColombiaEchoes(index);

    if (isDopplerSweepActive) {
        scanDopplerForSevereStorms();
    }
}

function toggleRadarAnimation() {
    if (isRadarPlaying) {
        stopRadarAnimation();
    } else {
        startRadarAnimation();
    }
}

function startRadarAnimation() {
    isRadarPlaying = true;

    const playBtn = document.getElementById('btnRadarPlay');
    if (playBtn) {
        playBtn.innerHTML = '<i class="bi bi-pause-fill"></i> Pausar';
        playBtn.classList.replace('btn-primary', 'btn-outline-primary');
    }

    const totalFrames = radarFrames.length > 0 ? radarFrames.length : 8;

    // Intervalo de 1150 ms: perfecto para streaming continuo en redes móviles 4G
    radarAnimationTimer = setInterval(() => {
        currentRadarIndex = (currentRadarIndex + 1) % totalFrames;
        if (radarFrames.length > 0) {
            showRadarFrame(currentRadarIndex);
        } else {
            renderRegionalColombiaEchoes(currentRadarIndex);
            const timeDisplay = document.getElementById('radarFrameTime');
            if (timeDisplay) {
                const minsAgo = (totalFrames - 1 - currentRadarIndex) * 5;
                timeDisplay.innerHTML = `<span class="badge bg-primary text-white me-1">Doppler T-${minsAgo}m</span> En Vivo`;
            }
        }
    }, 1150);
}

function stopRadarAnimation() {
    isRadarPlaying = false;
    clearInterval(radarAnimationTimer);

    const playBtn = document.getElementById('btnRadarPlay');
    if (playBtn) {
        playBtn.innerHTML = '<i class="bi bi-play-fill"></i> Reproducir';
        playBtn.classList.replace('btn-outline-primary', 'btn-primary');
    }

    // Restablecer todas las manchas Doppler al estado en vivo presente
    renderRegionalColombiaEchoes(null);
    if (isDopplerSweepActive) {
        scanDopplerForSevereStorms();
    }
}

function toggleRadarSweep() {
    const sweepOverlay = document.getElementById('radarSweepOverlay');
    const sweepBtn = document.getElementById('btnRadarSweep');
    const hud = document.getElementById('radarDetectionHud');
    if (!sweepOverlay) return;

    isDopplerSweepActive = !isDopplerSweepActive;

    if (isDopplerSweepActive) {
        sweepOverlay.classList.add('active');
        if (hud) hud.classList.remove('d-none');
        if (sweepBtn) {
            sweepBtn.classList.add('btn-info', 'text-white');
            sweepBtn.classList.remove('btn-outline-secondary');
            sweepBtn.innerHTML = '<i class="bi bi-bullseye me-1"></i>Barrido Activo';
        }
        scanDopplerForSevereStorms();
    } else {
        sweepOverlay.classList.remove('active', 'alert-red', 'alert-purple');
        if (hud) hud.classList.add('d-none');
        if (sweepBtn) {
            sweepBtn.classList.remove('btn-info', 'text-white');
            sweepBtn.classList.add('btn-outline-secondary');
            sweepBtn.innerHTML = '<i class="bi bi-bullseye me-1"></i>Barrido Doppler';
        }
        if (detectedStormLayerGroup && radarMap) {
            detectedStormLayerGroup.clearLayers();
        }
    }
}

// --------------------------------------------------------------------------
// Monitoreo Oficial de Huracanes y Ciclones Tropicales en el Radar Doppler
// --------------------------------------------------------------------------
async function loadRadarHurricanes() {
    try {
        const res = await fetch('/Home/GetHurricanes');
        if (res.ok) {
            const data = await res.json();
            trackedRadarHurricanes = Array.isArray(data) ? data : [];
        }
    } catch (e) {
        console.warn("Aviso al consultar huracanes:", e);
    }

    const badge = document.getElementById('radarHurricaneBadge');
    if (badge) {
        badge.textContent = trackedRadarHurricanes.length;
        badge.className = trackedRadarHurricanes.length > 0 
            ? "badge bg-white text-danger ms-1 fw-bold" 
            : "badge bg-secondary text-white ms-1";
    }

    renderRadarHurricanesMenu();
    renderHurricanesOnRadarMap();
    injectHurricaneDopplerEchoes();
}

function toggleRadarHurricanesMenu() {
    const dropdown = document.getElementById('radarHurricanesDropdown');
    if (dropdown) {
        dropdown.classList.toggle('d-none');
    }
}

function renderRadarHurricanesMenu() {
    const list = document.getElementById('radarHurricanesList');
    if (!list) return;

    if (trackedRadarHurricanes.length === 0) {
        list.innerHTML = `<div class="p-3 text-center text-muted small"><i class="bi bi-shield-check text-success me-1"></i>No hay ciclones tropicales activos actualmente en monitoreo oficial de NOAA / JTWC.</div>`;
        return;
    }

    list.innerHTML = trackedRadarHurricanes.map(h => `
        <div class="radar-hurricane-item" onclick="focusRadarOnHurricane('${h.id}')" title="Centrar radar en ${h.name}">
            <div class="d-flex align-items-center justify-content-between mb-1">
                <span class="fw-bold text-dark small"><i class="bi bi-hurricane text-danger me-1"></i>${h.name}</span>
                <span class="badge bg-danger text-white">${h.category}</span>
            </div>
            <div class="small text-muted">
                <i class="bi bi-wind text-primary"></i> ${h.maxWindsKmh} km/h • Presión: ${h.pressureHpa} hPa
            </div>
            <div class="small text-danger fw-semibold mt-1">
                <i class="bi bi-geo-alt-fill me-1"></i>${h.locationDesc}
            </div>
            <div class="small text-secondary mt-1">
                <i class="bi bi-compass me-1"></i>${h.movement}
            </div>
        </div>
    `).join('');
}

function renderHurricanesOnRadarMap() {
    if (!radarMap) return;

    if (!hurricaneLayerGroup) {
        hurricaneLayerGroup = L.layerGroup().addTo(radarMap);
    }
    hurricaneLayerGroup.clearLayers();

    trackedRadarHurricanes.forEach(h => {
        const icon = L.divIcon({
            className: 'radar-hurricane-icon-wrapper',
            html: `<div class="radar-hurricane-icon-marker" title="${h.name} (${h.category})"><i class="bi bi-hurricane"></i></div>`,
            iconSize: [44, 44],
            iconAnchor: [22, 22]
        });

        const marker = L.marker([h.latitude, h.longitude], {
            icon: icon,
            zIndexOffset: 900
        }).addTo(hurricaneLayerGroup);

        marker.bindPopup(`
            <div class="p-2 text-start" style="min-width: 220px;">
                <div class="d-flex align-items-center justify-content-between mb-1">
                    <strong class="text-danger"><i class="bi bi-hurricane me-1"></i>${h.name}</strong>
                    <span class="badge bg-danger text-white">${h.category}</span>
                </div>
                <div class="small text-muted mb-1">
                    <strong>Vientos Máx:</strong> ${h.maxWindsKmh} km/h<br>
                    <strong>Presión:</strong> ${h.pressureHpa} hPa<br>
                    <strong>Movimiento:</strong> ${h.movement}
                </div>
                <div class="small text-dark fw-semibold mb-1">
                    <i class="bi bi-geo-alt-fill text-danger me-1"></i>${h.locationDesc}
                </div>
                <div class="badge bg-dark text-white-50 w-100 text-center mt-1">
                    Monitoreo Oficial NOAA / JTWC en Vivo
                </div>
            </div>
        `);
    });
}

function injectHurricaneDopplerEchoes() {
    if (!trackedRadarHurricanes || trackedRadarHurricanes.length === 0) return;

    trackedRadarHurricanes.forEach((h, hIdx) => {
        const eyeRadius = Math.min(65000, 32000 + (h.categoryLevel || 1) * 8000);
        const hurricaneCells = [
            {
                lat: h.latitude,
                lon: h.longitude,
                radius: eyeRadius,
                baseRadius: eyeRadius,
                dbz: 60,
                baseDbz: 60,
                opacityMult: 1.0,
                seed: 88 + hIdx,
                name: `${h.name} (Pared del Ojo)`
            },
            {
                lat: h.latitude + 0.35,
                lon: h.longitude - 0.40,
                radius: eyeRadius * 1.3,
                baseRadius: eyeRadius * 1.3,
                dbz: 50,
                baseDbz: 50,
                opacityMult: 0.9,
                seed: 12 + hIdx,
                name: `${h.name} (Banda Espiral Norte)`
            },
            {
                lat: h.latitude - 0.40,
                lon: h.longitude + 0.45,
                radius: eyeRadius * 1.4,
                baseRadius: eyeRadius * 1.4,
                dbz: 46,
                baseDbz: 46,
                opacityMult: 0.85,
                seed: 45 + hIdx,
                name: `${h.name} (Banda Espiral Sur)`
            },
            {
                lat: h.latitude + 0.65,
                lon: h.longitude + 0.30,
                radius: eyeRadius * 1.6,
                baseRadius: eyeRadius * 1.6,
                dbz: 38,
                baseDbz: 38,
                opacityMult: 0.75,
                seed: 73 + hIdx,
                name: `${h.name} (Banda Alimentadora)`
            }
        ];

        hurricaneCells.forEach(hc => {
            const rIdx = regionalEchoCells.findIndex(c => c.name === hc.name);
            if (rIdx >= 0) {
                regionalEchoCells[rIdx] = hc;
            } else {
                regionalEchoCells.push(hc);
            }

            const lIdx = liveRadarEchoes.findIndex(c => c.name === hc.name);
            if (lIdx >= 0) {
                liveRadarEchoes[lIdx] = hc;
            } else {
                liveRadarEchoes.push(hc);
            }
        });
    });

    renderDopplerCanvas();
}

function focusRadarOnHurricane(hurricaneId) {
    const h = trackedRadarHurricanes.find(x => x.id === hurricaneId);
    if (!h || !radarMap) return;

    const dropdown = document.getElementById('radarHurricanesDropdown');
    if (dropdown) dropdown.classList.add('d-none');

    // Volar directamente a la posición del ciclón (ej. cerca de Japón)
    radarMap.flyTo([h.latitude, h.longitude], 7, {
        duration: 1.6,
        easeLinearity: 0.25
    });

    // Inyectar bandas de lluvia en esa posición
    injectHurricaneDopplerEchoes();

    // Abrir popup en el marcador
    if (hurricaneLayerGroup) {
        hurricaneLayerGroup.eachLayer(layer => {
            if (layer.getLatLng && 
                Math.abs(layer.getLatLng().lat - h.latitude) < 0.2 &&
                Math.abs(layer.getLatLng().lng - h.longitude) < 0.2) {
                layer.openPopup();
            }
        });
    }

    // Iniciar barrido Doppler para fijar objetivo en el ciclón
    if (!isDopplerSweepActive) {
        toggleRadarSweep();
    } else {
        scanDopplerForSevereStorms();
    }
}

document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('radarHurricanesDropdown');
    const btn = document.getElementById('btnRadarHurricanes');
    if (dropdown && !dropdown.classList.contains('d-none')) {
        if (!dropdown.contains(e.target) && btn && !btn.contains(e.target)) {
            dropdown.classList.add('d-none');
        }
    }
});

/**
 * Escanea el cuadrante del radar y detecta en tiempo real tormentas severas púrpuras y rojas
 */
function scanDopplerForSevereStorms() {
    if (!radarMap || !isDopplerSweepActive) return;

    if (!detectedStormLayerGroup) {
        detectedStormLayerGroup = L.layerGroup().addTo(radarMap);
    }
    detectedStormLayerGroup.clearLayers();

    const sweepOverlay = document.getElementById('radarSweepOverlay');
    const hudPulse = document.getElementById('hudPulse');
    const hudTitle = document.getElementById('hudTitle');
    const hudBody = document.getElementById('hudBody');

    // Evaluación de tormentas severas exclusivamente basada en observaciones en vivo de la API
    const candidateStorms = [];

    // 1. Tormentas reales detectadas por la API en vivo en las estaciones activas
    if (regionalEchoCells && regionalEchoCells.length > 0) {
        const seenNames = new Set();
        regionalEchoCells.forEach(cell => {
            if (cell.name && !seenNames.has(cell.name)) {
                if (cell.dbz >= 55) {
                    seenNames.add(cell.name);
                    candidateStorms.push({
                        name: `Núcleo Severo en ${cell.name}`,
                        lat: cell.lat,
                        lon: cell.lon,
                        type: "purple",
                        dbz: `${Math.round(cell.dbz)} dBZ`,
                        hazard: "Granizo destructivo (>2 cm) / Turbonadas severas",
                        region: cell.name
                    });
                } else if (cell.dbz >= 45) {
                    seenNames.add(cell.name);
                    candidateStorms.push({
                        name: `Tormenta Roja en ${cell.name}`,
                        lat: cell.lat,
                        lon: cell.lon,
                        type: "red",
                        dbz: `${Math.round(cell.dbz)} dBZ`,
                        hazard: "Tormenta eléctrica y precipitación intensa (>15 mm/h)",
                        region: cell.name
                    });
                }
            }
        });
    }

    // 2. Evaluar tormenta en la localidad actualmente seleccionada
    if (window.cityCoordinates) {
        const cCity = window.cityCoordinates.name;
        const cLat = window.cityCoordinates.lat;
        const cLon = window.cityCoordinates.lon;
        const cDesc = (window.cityCoordinates.desc || "").toLowerCase();
        const cPrecip = typeof window.cityCoordinates.precip === 'number' ? window.cityCoordinates.precip : 0;

        let localLevel = currentManualLevel;
        if (!localLevel) {
            if (cDesc.includes("granizo") || cDesc.includes("sever") || cPrecip >= 30) {
                localLevel = 'purple';
            } else if (cDesc.includes("torment") || cDesc.includes("torrencial") || (cPrecip >= 15 && cPrecip < 30)) {
                localLevel = 'red';
            }
        }

        if (localLevel === 'purple' && !candidateStorms.some(s => s.region && s.region.toLowerCase() === cCity.toLowerCase())) {
            candidateStorms.unshift({
                name: `Núcleo Severo en ${cCity}`,
                lat: cLat,
                lon: cLon,
                type: "purple",
                dbz: "60 - 65 dBZ",
                hazard: "Granizo destructivo (>2 cm) / Turbonadas severas",
                region: cCity
            });
        } else if (localLevel === 'red' && !candidateStorms.some(s => s.region && s.region.toLowerCase() === cCity.toLowerCase())) {
            candidateStorms.unshift({
                name: `Tormenta Roja en ${cCity}`,
                lat: cLat,
                lon: cLon,
                type: "red",
                dbz: "48 - 54 dBZ",
                hazard: "Tormenta eléctrica y lluvia torrencial (>15 mm/h)",
                region: cCity
            });
        }
    }

    // Filtrar tormentas visibles en la ventana actual del mapa o dentro de rango radar (450 km)
    const bounds = radarMap.getBounds();
    const mapCenter = radarMap.getCenter();

    const detectedStorms = candidateStorms.filter(s => {
        if (bounds.contains([s.lat, s.lon])) return true;
        const distKm = mapCenter.distanceTo([s.lat, s.lon]) / 1000.0;
        return distKm <= 450.0;
    });

    const purpleDetections = detectedStorms.filter(s => s.type === 'purple');
    const redDetections = detectedStorms.filter(s => s.type === 'red');

    // 1. Caso: Al menos una tormenta severa con granizo detectada por el barrido
    if (purpleDetections.length > 0) {
        if (sweepOverlay) {
            sweepOverlay.classList.remove('alert-red');
            sweepOverlay.classList.add('alert-purple');
        }
        if (hudPulse) hudPulse.className = "hud-status-pulse pulse-purple";
        if (hudTitle) hudTitle.textContent = "⚡ ALERTA: TORMENTA SEVERA / GRANIZO DETECTADO";
        if (hudBody) {
            hudBody.innerHTML = `
                <div class="d-flex align-items-center justify-content-between mb-1">
                    <span class="badge text-white px-2 py-1" style="background:#7c3aed;">
                        <i class="bi bi-lightning-charge-fill me-1"></i>🟪 ${purpleDetections.length} Núcleo(s) Severo(s) (>55 dBZ)
                    </span>
                    <span class="badge bg-danger text-white">${redDetections.length > 0 ? `+${redDetections.length} Rojas` : 'Extrema'}</span>
                </div>
                <div class="small fw-semibold text-warning">
                    <i class="bi bi-shield-exclamation me-1"></i>${purpleDetections[0].hazard}
                </div>
                <div class="small text-white-50 mt-1">
                    Blanco fijado: <strong>${purpleDetections[0].name}</strong> • ${purpleDetections[0].dbz}
                </div>
            `;
        }
    }
    // 2. Caso: Tormentas rojas detectadas (sin granizo severo)
    else if (redDetections.length > 0) {
        if (sweepOverlay) {
            sweepOverlay.classList.remove('alert-purple');
            sweepOverlay.classList.add('alert-red');
        }
        if (hudPulse) hudPulse.className = "hud-status-pulse pulse-red";
        if (hudTitle) hudTitle.textContent = "🚨 DETECCIÓN: TORMENTA ROJA DETECTADA";
        if (hudBody) {
            hudBody.innerHTML = `
                <div class="d-flex align-items-center justify-content-between mb-1">
                    <span class="badge bg-danger text-white px-2 py-1">
                        <i class="bi bi-cloud-lightning-rain-fill me-1"></i>🟥 ${redDetections.length} Célula(s) Roja(s) (45-55 dBZ)
                    </span>
                    <span class="badge bg-warning text-dark">Alerta Eléctrica</span>
                </div>
                <div class="small text-light">
                    <i class="bi bi-lightning-fill text-warning me-1"></i>${redDetections[0].hazard}
                </div>
                <div class="small text-white-50 mt-1">
                    Blanco fijado: <strong>${redDetections[0].name}</strong> • ${redDetections[0].dbz}
                </div>
            `;
        }
    }
    // 3. Caso: Sin tormentas rojas ni núcleos de granizo en el rango
    else {
        if (sweepOverlay) {
            sweepOverlay.classList.remove('alert-red', 'alert-purple');
        }
        if (hudPulse) hudPulse.className = "hud-status-pulse pulse-cyan";
        if (hudTitle) hudTitle.textContent = "🟢 BARRIDO DOPPLER: DATOS REALES EN VIVO";
        if (hudBody) {
            hudBody.innerHTML = `
                <div class="text-white-50 small">
                    <i class="bi bi-shield-check text-success me-1"></i>Barrido 360° en vivo: Cuadrante despejado. Sin tormentas severas ni células convectivas (&lt;45 dBZ) detectadas por la API.
                </div>
            `;
        }
    }

    // Graficar indicadores de blanco pulsante (Ping Targets) en cada tormenta detectada
    detectedStorms.forEach(storm => {
        const blipIcon = L.divIcon({
            className: 'radar-blip-wrapper',
            html: `<div class="radar-detect-blip ${storm.type}" title="${storm.name}"><div class="blip-core"></div></div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });

        const blipMarker = L.marker([storm.lat, storm.lon], { 
            icon: blipIcon, 
            zIndexOffset: 850 
        }).addTo(detectedStormLayerGroup);

        blipMarker.bindTooltip(`
            <div class="p-1 text-start" style="min-width: 170px;">
                <div class="fw-bold ${storm.type === 'purple' ? 'text-primary' : 'text-danger'} mb-1">
                    ${storm.type === 'purple' ? '🟪' : '🟥'} ${storm.name} ${storm.type === 'purple' ? '(Alerta de Granizo / Severo)' : '(Tormenta Eléctrica)'}
                </div>
                <div class="small text-dark mb-1"><strong>Reflectividad:</strong> <span class="badge ${storm.type === 'purple' ? 'bg-purple text-white' : 'bg-danger text-white'}" style="${storm.type === 'purple' ? 'background:#7c3aed;' : ''}">${storm.dbz}</span></div>
                <div class="small text-secondary mb-1"><strong>Condición:</strong> ${storm.hazard}</div>
                <div class="small text-success fw-semibold"><i class="bi bi-bullseye me-1"></i>Blanco fijado por Barrido Doppler</div>
            </div>
        `, { 
            direction: 'top', 
            offset: [0, -10],
            className: 'shadow-lg border rounded-3 p-1'
        });
    });
}

// --------------------------------------------------------------------------
// 7. Modo Pantalla Completa del Radar Doppler y Tarjeta de Ciudad Integrada
// --------------------------------------------------------------------------
let isFullscreenCityCardCollapsed = false;

function setRadarCityCardFullscreen(isFullscreen) {
    const card = document.getElementById('selectedCityCard');
    const fsSlot = document.getElementById('radarFullscreenCitySlot');
    const fsBody = document.getElementById('radarFullscreenCardBody');
    const defaultSlot = document.getElementById('selectedCityCardDefaultSlot');

    if (!card || !fsSlot || !defaultSlot || !fsBody) return;

    if (isFullscreen) {
        if (!fsBody.contains(card)) {
            fsBody.appendChild(card);
        }
        fsSlot.classList.remove('d-none');

        // Prevenir que los eventos de click o scroll sobre la tarjeta se propaguen al mapa Leaflet
        if (window.L && L.DomEvent) {
            L.DomEvent.disableClickPropagation(fsSlot);
            L.DomEvent.disableScrollPropagation(fsSlot);
        }
    } else {
        if (!defaultSlot.contains(card)) {
            defaultSlot.appendChild(card);
        }
        fsSlot.classList.add('d-none');
    }
}

function toggleFullscreenCityCard() {
    const fsBody = document.getElementById('radarFullscreenCardBody');
    const icon = document.getElementById('iconToggleFullscreenCard');
    const text = document.getElementById('textToggleFullscreenCard');
    const city = currentCityName || 'Ciudad';

    if (!fsBody) return;

    isFullscreenCityCardCollapsed = !isFullscreenCityCardCollapsed;
    if (isFullscreenCityCardCollapsed) {
        fsBody.classList.add('d-none');
        if (icon) icon.className = 'bi bi-chevron-down me-1';
        if (text) text.textContent = `Ver información (${city})`;
    } else {
        fsBody.classList.remove('d-none');
        if (icon) icon.className = 'bi bi-chevron-up me-1';
        if (text) text.textContent = 'Ocultar información';
    }
}

function toggleRadarFullscreen() {
    const radarCard = document.querySelector('.radar-card');
    const btnIcon = document.getElementById('btnFullscreenIcon');
    const btnText = document.getElementById('btnFullscreenText');
    const floatingIcon = document.getElementById('floatingFullscreenIcon');

    if (!radarCard) return;

    const isFs = !!(document.fullscreenElement || 
                    document.webkitFullscreenElement || 
                    document.mozFullScreenElement || 
                    document.msFullscreenElement || 
                    radarCard.classList.contains('is-fullscreen'));

    if (!isFs) {
        // Mover la tarjeta de la ciudad seleccionada al interior del radar en pantalla completa
        setRadarCityCardFullscreen(true);

        // Solicitar pantalla completa nativa o fallback CSS
        const reqFs = radarCard.requestFullscreen || 
                      radarCard.webkitRequestFullscreen || 
                      radarCard.mozRequestFullScreen || 
                      radarCard.msRequestFullscreen;

        if (reqFs) {
            reqFs.call(radarCard).catch(() => {
                radarCard.classList.add('is-fullscreen');
            });
        } else {
            radarCard.classList.add('is-fullscreen');
        }

        radarCard.classList.add('is-fullscreen');
        if (btnText) btnText.textContent = "Salir Pantalla Completa";
        if (btnIcon) {
            btnIcon.classList.remove('bi-arrows-fullscreen');
            btnIcon.classList.add('bi-fullscreen-exit');
        }
        if (floatingIcon) {
            floatingIcon.classList.remove('bi-arrows-fullscreen');
            floatingIcon.classList.add('bi-fullscreen-exit');
        }
    } else {
        // Restaurar la tarjeta a su columna original
        setRadarCityCardFullscreen(false);

        // Salir de pantalla completa
        const exitFs = document.exitFullscreen || 
                       document.webkitExitFullscreen || 
                       document.mozCancelFullScreen || 
                       document.msExitFullscreen;

        if (exitFs && (document.fullscreenElement || document.webkitFullscreenElement)) {
            exitFs.call(document).catch(() => {});
        }

        radarCard.classList.remove('is-fullscreen');
        if (btnText) btnText.textContent = "Pantalla Completa";
        if (btnIcon) {
            btnIcon.classList.remove('bi-fullscreen-exit');
            btnIcon.classList.add('bi-arrows-fullscreen');
        }
        if (floatingIcon) {
            floatingIcon.classList.remove('bi-fullscreen-exit');
            floatingIcon.classList.add('bi-arrows-fullscreen');
        }
    }

    // Recalcular tamaño de Leaflet para llenar toda la pantalla y redibujar canvas Doppler
    if (radarMap) {
        setTimeout(() => {
            radarMap.invalidateSize();
            if (typeof renderDopplerCanvas === 'function') renderDopplerCanvas();
        }, 80);
        setTimeout(() => {
            radarMap.invalidateSize();
            if (typeof renderDopplerCanvas === 'function') renderDopplerCanvas();
        }, 300);
    }
}

document.addEventListener('fullscreenchange', handleFullscreenChangeEvent);
document.addEventListener('webkitfullscreenchange', handleFullscreenChangeEvent);
document.addEventListener('mozfullscreenchange', handleFullscreenChangeEvent);
document.addEventListener('MSFullscreenChange', handleFullscreenChangeEvent);

function handleFullscreenChangeEvent() {
    const radarCard = document.querySelector('.radar-card');
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
    const btnIcon = document.getElementById('btnFullscreenIcon');
    const btnText = document.getElementById('btnFullscreenText');
    const floatingIcon = document.getElementById('floatingFullscreenIcon');

    setRadarCityCardFullscreen(isFs);

    if (!isFs && radarCard) {
        radarCard.classList.remove('is-fullscreen');
        if (btnText) btnText.textContent = "Pantalla Completa";
        if (btnIcon) {
            btnIcon.classList.remove('bi-fullscreen-exit');
            btnIcon.classList.add('bi-arrows-fullscreen');
        }
        if (floatingIcon) {
            floatingIcon.classList.remove('bi-fullscreen-exit');
            floatingIcon.classList.add('bi-arrows-fullscreen');
        }
    }
    if (radarMap) {
        setTimeout(() => {
            radarMap.invalidateSize();
            if (typeof renderDopplerCanvas === 'function') renderDopplerCanvas();
        }, 150);
    }
}

// --------------------------------------------------------------------------
// 7. Inicialización al Cargar el DOM
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
            window.cityCoordinates.desc,
            window.cityCoordinates.precip
        );
    }

    // Manejar evento 'popstate' para los botones de atrás/adelante del navegador
    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.city) {
            selectCity(e.state.city);
        }
    });
});
