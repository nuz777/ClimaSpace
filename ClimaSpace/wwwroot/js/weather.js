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
let regionalEchoGroup = null;
let currentManualLevel = null;
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

        // 3. Actualizar ecos Doppler de lluvia
        renderPrecipitationEchoes(data.latitude, data.longitude, data.current.conditionDescription, data.current.precipitationMm, data.city);

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
function initWeatherRadar(lat, lon, cityName, currentTemp, conditionDesc, precipMm) {
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

    // 3. Crear pane dedicado para los ecos Doppler (por encima de mapas y RainViewer, zIndex 420)
    if (!radarMap.getPane('dopplerEchoPane')) {
        radarMap.createPane('dopplerEchoPane');
        radarMap.getPane('dopplerEchoPane').style.zIndex = 420;
    }

    // 4. Agregar PUNTOS AZULITOS interactivos en el mapa
    addRadarCityDots(cityName);

    // 5. Graficación visible de Ecos Doppler con todos los colores
    renderPrecipitationEchoes(lat, lon, conditionDesc, precipMm, cityName);

    // 6. Graficar frentes y ecos regionales en Colombia
    renderRegionalColombiaEchoes();

    // 7. Cargar datos de Radar RainViewer
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

    // 1. NIVEL VERDE: Llovizna y Lluvia Ligera (5 - 25 dBZ) -> 100% VERDE
    if (level === 'green') {
        if (badge) {
            badge.className = "badge bg-success text-white rounded-pill px-3 py-1 small fw-bold shadow-sm";
            badge.innerHTML = `<i class="bi bi-cloud-drizzle-fill me-1"></i>🟩 Eco Verde: Llovizna activa en ${city} (5 - 25 dBZ)`;
        }

        // Celda Principal de Llovizna Verde (44 km de radio - claramente visible)
        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 44000,
            color: '#059669',
            fillColor: '#10b981',
            fillOpacity: 0.55,
            weight: 2.5
        }).bindTooltip(`🟩 <strong>Eco Doppler Verde (18 dBZ):</strong> Llovizna activa en ${city} (&lt; 2.5 mm/h)`, { direction: 'top' }).addTo(rainEchoGroup);

        // Celda Periférica 1 (Norte / Costa)
        L.circle([lat + 0.12, lon - 0.14], {
            pane: 'dopplerEchoPane',
            radius: 34000,
            color: '#16a34a',
            fillColor: '#22c55e',
            fillOpacity: 0.48,
            weight: 2
        }).bindTooltip(`🟩 <strong>Frente de Llovizna:</strong> Nubosidad lluviosa costera (15 dBZ)`, { direction: 'top' }).addTo(rainEchoGroup);

        // Celda Periférica 2 (Sur / Interior)
        L.circle([lat - 0.10, lon + 0.12], {
            pane: 'dopplerEchoPane',
            radius: 28000,
            color: '#059669',
            fillColor: '#34d399',
            fillOpacity: 0.45,
            weight: 2
        }).bindTooltip(`🟩 <strong>Lloviznas Dispersas:</strong> Gotas finas (12 dBZ)`, { direction: 'top' }).addTo(rainEchoGroup);

        // Núcleo de Drizzle Continuo
        L.circle([lat + 0.03, lon + 0.02], {
            pane: 'dopplerEchoPane',
            radius: 20000,
            color: '#047857',
            fillColor: '#10b981',
            fillOpacity: 0.68,
            weight: 2.5
        }).bindTooltip(`🟩 <strong>Llovizna Continua:</strong> 1.5 - 2.5 mm/h`, { direction: 'top' }).addTo(rainEchoGroup);
    }
    // 2. NIVEL AMARILLO: Lluvia Moderada (25 - 35 dBZ) -> Verde exterior + Amarillo central
    else if (level === 'yellow') {
        if (badge) {
            badge.className = "badge bg-warning text-dark rounded-pill px-3 py-1 small fw-bold shadow-sm";
            badge.innerHTML = `<i class="bi bi-cloud-rain-fill me-1"></i>🟨 Eco Amarillo: Lluvia Moderada en ${city} (25 - 35 dBZ)`;
        }

        // Anillo exterior Verde
        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 46000,
            color: '#059669',
            fillColor: '#10b981',
            fillOpacity: 0.45,
            weight: 2
        }).bindTooltip(`🟩 <strong>Eco Verde:</strong> Llovizna periférica (15 dBZ)`, { direction: 'top' }).addTo(rainEchoGroup);

        L.circle([lat + 0.10, lon - 0.12], {
            pane: 'dopplerEchoPane',
            radius: 32000,
            color: '#16a34a',
            fillColor: '#22c55e',
            fillOpacity: 0.48,
            weight: 2
        }).addTo(rainEchoGroup);

        // Núcleo central Amarillo
        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 22000,
            color: '#ca8a04',
            fillColor: '#eab308',
            fillOpacity: 0.65,
            weight: 2.5
        }).bindTooltip(`🟨 <strong>Eco Doppler Amarillo (30 dBZ):</strong> Lluvia moderada (2.5 - 7.5 mm/h)`, { direction: 'top' }).addTo(rainEchoGroup);
    }
    // 3. NIVEL NARANJA: Lluvia Fuerte (35 - 45 dBZ) -> Verde -> Amarillo -> Naranja
    else if (level === 'orange') {
        if (badge) {
            badge.className = "badge bg-danger text-white rounded-pill px-3 py-1 small fw-bold shadow-sm";
            badge.innerHTML = `<i class="bi bi-cloud-rain-heavy-fill me-1"></i>🟧 Eco Naranja: Lluvia Fuerte en ${city} (35 - 45 dBZ)`;
        }

        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 48000,
            color: '#059669',
            fillColor: '#10b981',
            fillOpacity: 0.42,
            weight: 2
        }).addTo(rainEchoGroup);

        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 30000,
            color: '#ca8a04',
            fillColor: '#eab308',
            fillOpacity: 0.55,
            weight: 2
        }).addTo(rainEchoGroup);

        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 16000,
            color: '#ea580c',
            fillColor: '#f97316',
            fillOpacity: 0.72,
            weight: 2.5
        }).bindTooltip(`🟧 <strong>Eco Doppler Naranja (40 dBZ):</strong> Lluvia fuerte (7.5 - 15 mm/h)`, { direction: 'top' }).addTo(rainEchoGroup);
    }
    // 4. NIVEL ROJO: Tormenta / Lluvia Torrencial (45 - 55 dBZ)
    else if (level === 'red') {
        if (badge) {
            badge.className = "badge bg-danger text-white rounded-pill px-3 py-1 small fw-bold shadow-sm";
            badge.innerHTML = `<i class="bi bi-cloud-lightning-rain-fill me-1"></i>🟥 Eco Rojo: Tormenta / Lluvia Torrencial (45 - 55 dBZ)`;
        }

        L.circle([lat, lon], { pane: 'dopplerEchoPane', radius: 50000, color: '#059669', fillColor: '#10b981', fillOpacity: 0.40, weight: 2 }).addTo(rainEchoGroup);
        L.circle([lat, lon], { pane: 'dopplerEchoPane', radius: 34000, color: '#ca8a04', fillColor: '#eab308', fillOpacity: 0.50, weight: 2 }).addTo(rainEchoGroup);
        L.circle([lat, lon], { pane: 'dopplerEchoPane', radius: 20000, color: '#ea580c', fillColor: '#f97316', fillOpacity: 0.65, weight: 2 }).addTo(rainEchoGroup);
        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 9500,
            color: '#dc2626',
            fillColor: '#ef4444',
            fillOpacity: 0.82,
            weight: 2.5
        }).bindTooltip(`🟥 <strong>Eco Doppler Rojo (50 dBZ):</strong> Tormenta y Lluvia Torrencial (15 - 30 mm/h)`, { direction: 'top' }).addTo(rainEchoGroup);
    }
    // 5. NIVEL PÚRPURA: Tormenta Severa con Granizo (> 55 dBZ)
    else if (level === 'purple') {
        if (badge) {
            badge.className = "badge text-white rounded-pill px-3 py-1 small fw-bold shadow-sm";
            badge.style.backgroundColor = '#7c3aed';
            badge.innerHTML = `<i class="bi bi-lightning-charge-fill me-1"></i>🟪 Eco Púrpura: Tormenta Severa / Granizo (> 55 dBZ)`;
        }

        L.circle([lat, lon], { pane: 'dopplerEchoPane', radius: 52000, color: '#059669', fillColor: '#10b981', fillOpacity: 0.40, weight: 2 }).addTo(rainEchoGroup);
        L.circle([lat, lon], { pane: 'dopplerEchoPane', radius: 36000, color: '#ca8a04', fillColor: '#eab308', fillOpacity: 0.50, weight: 2 }).addTo(rainEchoGroup);
        L.circle([lat, lon], { pane: 'dopplerEchoPane', radius: 22000, color: '#ea580c', fillColor: '#f97316', fillOpacity: 0.62, weight: 2 }).addTo(rainEchoGroup);
        L.circle([lat, lon], { pane: 'dopplerEchoPane', radius: 11000, color: '#dc2626', fillColor: '#ef4444', fillOpacity: 0.75, weight: 2 }).addTo(rainEchoGroup);
        L.circle([lat, lon], {
            pane: 'dopplerEchoPane',
            radius: 4500,
            color: '#7c3aed',
            fillColor: '#8b5cf6',
            fillOpacity: 0.92,
            weight: 3
        }).bindTooltip(`🟪 <strong>Eco Doppler Púrpura (60 dBZ):</strong> Núcleo de Granizo / Turbonada (> 30 mm/h)`, { direction: 'top' }).addTo(rainEchoGroup);
    }
    // SIN PRECIPITACIÓN LOCAL
    else {
        if (badge) {
            badge.className = "badge bg-light text-secondary border rounded-pill px-3 py-1 small";
            badge.innerHTML = `<i class="bi bi-cloud-sun me-1"></i>Sin lluvia local en ${city} — Ecos regionales activos`;
        }
    }
}

// --------------------------------------------------------------------------
// Graficación Permanente de Ecos Regionales en Colombia (Chocó, Caribe, etc.)
// --------------------------------------------------------------------------
function renderRegionalColombiaEchoes() {
    if (!radarMap) return;

    if (!regionalEchoGroup) {
        regionalEchoGroup = L.layerGroup().addTo(radarMap);
    }
    regionalEchoGroup.clearLayers();

    // 1. Frente de Llovizna y Lluvias en la Costa Pacífica (Chocó - zona de alta reflectividad tropical)
    L.circle([5.69, -76.65], {
        pane: 'dopplerEchoPane',
        radius: 65000,
        color: '#059669',
        fillColor: '#10b981',
        fillOpacity: 0.45,
        weight: 2
    }).bindTooltip("🟩 <strong>Frente Doppler Verde:</strong> Lloviznas en la Cuenca Pacífica (18 dBZ)", { direction: 'top' }).addTo(regionalEchoGroup);

    L.circle([5.85, -76.80], {
        pane: 'dopplerEchoPane',
        radius: 38000,
        color: '#ca8a04',
        fillColor: '#eab308',
        fillOpacity: 0.50,
        weight: 1.5
    }).bindTooltip("🟨 <strong>Frente Doppler Amarillo:</strong> Lluvia moderada (28 dBZ)", { direction: 'top' }).addTo(regionalEchoGroup);

    // 2. Celdas de Llovizna Verde en la Sierra Nevada y Serranía
    L.circle([10.75, -73.65], {
        pane: 'dopplerEchoPane',
        radius: 38000,
        color: '#059669',
        fillColor: '#10b981',
        fillOpacity: 0.42,
        weight: 2
    }).bindTooltip("🟩 <strong>Eco Doppler Verde:</strong> Lloviznas orográficas en la Sierra Nevada (15 dBZ)", { direction: 'top' }).addTo(regionalEchoGroup);

    // 3. Sistema de Llovizna Verde en el Piedemonte Amazónico
    L.circle([1.61, -75.61], {
        pane: 'dopplerEchoPane',
        radius: 52000,
        color: '#059669',
        fillColor: '#10b981',
        fillOpacity: 0.40,
        weight: 2
    }).bindTooltip("🟩 <strong>Eco Doppler Verde:</strong> Nubosidad con llovizna en la Amazonía (14 dBZ)", { direction: 'top' }).addTo(regionalEchoGroup);
}

// --------------------------------------------------------------------------
// 6. Carga de Fotogramas del Radar Doppler (RainViewer API con Paleta Universal 1)
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
        // Paleta 1 = Universal Doppler (Verde -> Amarillo -> Naranja -> Rojo -> Púrpura)
        const initialUrl = `${radarHost}${initialPath}/256/{z}/{x}/{y}/1/1_1.png`;

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
    // Paleta 1 = Universal Doppler
    const newUrl = `${radarHost}${frame.path}/256/{z}/{x}/{y}/1/1_1.png`;

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
