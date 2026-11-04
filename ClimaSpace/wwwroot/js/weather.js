// ==========================================================================
// ClimaSpace - Controlador del Radar Doppler & Interfaz Dinámica SPA
// ==========================================================================

let currentUnit = 'C';
let currentProvider = window.currentProvider || 'live';
let currentCityName = (window.cityCoordinates && window.cityCoordinates.name) || 'Bogotá';

let radarMap = null;
let radarTileLayer = null;
let radarFrames = [];
let currentRadarIndex = 0;
let radarAnimationTimer = null;
let isRadarPlaying = false;
let radarHost = 'https://tilecache.rainviewer.com';
let rainEchoGroup = null;
let radarCityMarkers = [];

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

        // 2. Actualizar puntos azulitos y reflejar ciudad activa
        highlightActiveCityDot(data.city);

        // 3. Actualizar ecos Doppler de lluvia
        renderPrecipitationEchoes(data.latitude, data.longitude, data.current.conditionDescription);

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
    if (elCountry) elCountry.textContent = data.country;
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

    // Actualizar cinta horizontal de 24 horas
    const hourlyContainer = document.getElementById('hourlyForecastContainer');
    if (hourlyContainer && data.hourly) {
        hourlyContainer.innerHTML = data.hourly.map(h => `
            <div class="hourly-card-white">
                <div class="small text-white-50 mb-1">${h.time}</div>
                <i class="bi ${h.iconClass} fs-3 my-2 d-block"></i>
                <div class="fw-bold mb-1" data-temp-c="${h.temperatureC}" data-temp-f="${h.temperatureF}">
                    ${formatTempDisplay(h.temperatureC, h.temperatureF, true)}
                </div>
                ${h.precipitationProbability > 0 ? 
                    `<div class="small text-info fw-semibold"><i class="bi bi-droplet-fill small"></i>${h.precipitationProbability}%</div>` :
                    `<div class="small text-white-50">-</div>`}
            </div>
        `).join('');
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
function initWeatherRadar(lat, lon, cityName, currentTemp, conditionDesc) {
    const mapContainer = document.getElementById('weatherRadarMap');
    if (!mapContainer || typeof L === 'undefined') return;

    if (radarMap) {
        radarMap.remove();
        radarMap = null;
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

    // 4. Agregar PUNTOS AZULITOS interactivos en el mapa
    addRadarCityDots(cityName);

    // 5. Graficación visible de Ecos de Lluvia y Chubascos
    renderPrecipitationEchoes(lat, lon, conditionDesc);

    // 6. Cargar datos de Radar RainViewer
    loadRainViewerRadarLayers();
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
            iconSize: isActive ? [18, 18] : [14, 14],
            iconAnchor: isActive ? [9, 9] : [7, 7]
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
// 5. Visualización Gráfica de Ecos de Lluvia, Chubascos y Tormentas
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

        L.circle([lat, lon], {
            radius: isHeavy ? 28000 : 18000,
            color: '#10b981',
            fillColor: '#10b981',
            fillOpacity: 0.32,
            weight: 1.5,
            className: 'radar-rain-echo-pulse'
        }).addTo(rainEchoGroup);

        L.circle([lat, lon], {
            radius: isHeavy ? 18000 : 10000,
            color: '#eab308',
            fillColor: '#eab308',
            fillOpacity: 0.45,
            weight: 1.5
        }).addTo(rainEchoGroup);

        L.circle([lat, lon], {
            radius: isHeavy ? 9000 : 4500,
            color: '#ef4444',
            fillColor: '#f97316',
            fillOpacity: 0.6,
            weight: 2
        }).addTo(rainEchoGroup);
    }
}

// --------------------------------------------------------------------------
// 6. Carga de Fotogramas del Radar Doppler (RainViewer API)
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

        const initialPath = radarFrames[currentRadarIndex].path;
        const initialUrl = `${radarHost}${initialPath}/256/{z}/{x}/{y}/4/1_1.png`;

        if (radarTileLayer) {
            radarMap.removeLayer(radarTileLayer);
        }

        radarTileLayer = L.tileLayer(initialUrl, {
            opacity: 0.85,
            zIndex: 100,
            minNativeZoom: 1,
            minZoom: 2,
            maxNativeZoom: 7, // Cero "Zoom level not supported"
            maxZoom: 18,
            tileSize: 256,
            keepBuffer: 8,
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
            window.cityCoordinates.desc
        );
    }

    // Manejar evento 'popstate' para los botones de atrás/adelante del navegador
    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.city) {
            selectCity(e.state.city);
        }
    });
});
