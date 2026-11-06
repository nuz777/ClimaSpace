/**
 * ==============================================================================
 * ClimaSpace - Capa de Viento Animado sobre Leaflet (MSN Weather Style)
 * ------------------------------------------------------------------------------
 * Overlay de viento integrado directamente sobre el mapa base de Leaflet:
 * 1. Campo de color continuo con colores idénticos a MSN e interpolación suave.
 * 2. Partículas animadas blancas semitransparentes que siguen el campo de flujo.
 * 3. Z-Index configurado en pane dedicado (por debajo de puntos y popups).
 * 4. Leyenda dinámica de velocidad (0 a 100+ km/h).
 * ==============================================================================
 */

(function () {
    'use strict';

    // --------------------------------------------------------------------------
    // 1. Paleta de Colores Oficial MSN Weather
    // --------------------------------------------------------------------------
    const MSN_WIND_PALETTE = [
        { speed: 0,   r: 168, g: 216, b: 232, a: 0.15 }, // #A8D8E8 (casi transparente)
        { speed: 10,  r: 95,  g: 180, b: 214, a: 0.65 }, // #5FB4D6
        { speed: 20,  r: 63,  g: 184, b: 175, a: 0.75 }, // #3FB8AF
        { speed: 35,  r: 108, g: 203, b: 95,  a: 0.80 }, // #6CCB5F
        { speed: 55,  r: 242, g: 216, b: 59,  a: 0.85 }, // #F2D83B
        { speed: 70,  r: 242, g: 154, b: 46,  a: 0.90 }, // #F29A2E
        { speed: 100, r: 224, g: 57,  b: 43,  a: 0.95 }  // #E0392B
    ];

    // Precomputar tabla de búsqueda (LUT) para velocidad extrema de renderizado
    const LUT_SIZE = 240;
    const COLOR_LUT = new Uint8ClampedArray(LUT_SIZE * 4);

    (function buildLut() {
        for (let i = 0; i < LUT_SIZE; i++) {
            const speed = (i / (LUT_SIZE - 1)) * 110; // Rango 0 a 110 km/h
            const c = sampleMsnPalette(speed);
            const idx = i * 4;
            COLOR_LUT[idx] = c.r;
            COLOR_LUT[idx + 1] = c.g;
            COLOR_LUT[idx + 2] = c.b;
            COLOR_LUT[idx + 3] = c.a;
        }
    })();

    function sampleMsnPalette(speed) {
        if (speed <= 0) {
            const p = MSN_WIND_PALETTE[0];
            return { r: p.r, g: p.g, b: p.b, a: Math.round(p.a * 255) };
        }
        const last = MSN_WIND_PALETTE[MSN_WIND_PALETTE.length - 1];
        if (speed >= last.speed) {
            return { r: last.r, g: last.g, b: last.b, a: Math.round(last.a * 255) };
        }

        for (let i = 0; i < MSN_WIND_PALETTE.length - 1; i++) {
            const p1 = MSN_WIND_PALETTE[i];
            const p2 = MSN_WIND_PALETTE[i + 1];
            if (speed >= p1.speed && speed <= p2.speed) {
                const t = (speed - p1.speed) / (p2.speed - p1.speed);
                // Interpolación cúbica suave (smoothstep) para eliminar bordes duros
                const smoothT = t * t * (3 - 2 * t);
                return {
                    r: Math.round(p1.r + (p2.r - p1.r) * smoothT),
                    g: Math.round(p1.g + (p2.g - p1.g) * smoothT),
                    b: Math.round(p1.b + (p2.b - p1.b) * smoothT),
                    a: Math.round((p1.a + (p2.a - p1.a) * smoothT) * 255)
                };
            }
        }
        return { r: last.r, g: last.g, b: last.b, a: Math.round(last.a * 255) };
    }

    function getLutColor(speed) {
        const clamped = Math.max(0, Math.min(110, speed));
        const idx = Math.floor((clamped / 110) * (LUT_SIZE - 1)) * 4;
        return [
            COLOR_LUT[idx],
            COLOR_LUT[idx + 1],
            COLOR_LUT[idx + 2],
            COLOR_LUT[idx + 3]
        ];
    }

    // --------------------------------------------------------------------------
    // 2. Estado del Módulo
    // --------------------------------------------------------------------------
    let isWindLayerActive = false;
    let mapInstance = null;
    let windPane = null;

    let colorCanvas = null;
    let colorCtx = null;
    let offscreenColorCanvas = null;
    let offscreenColorCtx = null;

    let particleCanvas = null;
    let particleCtx = null;
    let particleAnimId = null;

    let currentGrid = null;
    let gridRows = 14;
    let gridCols = 18;
    let isFetchingGrid = false;

    const particles = [];
    const NUM_PARTICLES = 1600;
    const SPEED_SCALE = 0.038; // Velocidad realista y suave
    const PARTICLE_LINE_WIDTH = 1.4;

    // --------------------------------------------------------------------------
    // 3. Inicialización y Gestión del Pane en Leaflet
    // --------------------------------------------------------------------------
    function ensureWindPane(map) {
        if (!map) return null;
        let pane = map.getPane('windLayerPane');
        if (!pane) {
            pane = map.createPane('windLayerPane');
            // Z-Index: 380 (por encima del mapa base 200, por debajo de Doppler 420, puntos 600 y popups 700)
            pane.style.zIndex = 380;
            pane.style.pointerEvents = 'none';
            pane.style.opacity = '0.78'; // Opacidad ajustable 70-80% según especificación
            pane.style.transition = 'opacity 0.3s ease';
        }
        return pane;
    }

    function ensureCanvases(map) {
        windPane = ensureWindPane(map);
        if (!windPane) return;

        if (!colorCanvas) {
            colorCanvas = document.createElement('canvas');
            colorCanvas.className = 'wind-layer-color-canvas';
            colorCanvas.style.position = 'absolute';
            colorCanvas.style.top = '0';
            colorCanvas.style.left = '0';
            colorCanvas.style.pointerEvents = 'none';
            windPane.appendChild(colorCanvas);
            colorCtx = colorCanvas.getContext('2d');
        }

        if (!offscreenColorCanvas) {
            offscreenColorCanvas = document.createElement('canvas');
            offscreenColorCtx = offscreenColorCanvas.getContext('2d');
        }

        if (!particleCanvas) {
            particleCanvas = document.createElement('canvas');
            particleCanvas.className = 'wind-layer-particle-canvas';
            particleCanvas.style.position = 'absolute';
            particleCanvas.style.top = '0';
            particleCanvas.style.left = '0';
            particleCanvas.style.pointerEvents = 'none';
            windPane.appendChild(particleCanvas);
            particleCtx = particleCanvas.getContext('2d');
        }

        alignCanvases(map);
    }

    function alignCanvases(map) {
        if (!map || !windPane) return;
        const mapPane = map.getPanes().mapPane;
        if (!mapPane) return;
        const mapPos = L.DomUtil.getPosition(mapPane) || { x: 0, y: 0 };
        if (colorCanvas) L.DomUtil.setPosition(colorCanvas, L.point(-mapPos.x, -mapPos.y));
        if (particleCanvas) L.DomUtil.setPosition(particleCanvas, L.point(-mapPos.x, -mapPos.y));
    }

    function resizeCanvases(map) {
        if (!map || !colorCanvas || !particleCanvas) return;
        const size = map.getSize();
        if (!size || size.x === 0 || size.y === 0) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = size.x;
        const h = size.y;

        if (colorCanvas.width !== w * dpr || colorCanvas.height !== h * dpr) {
            colorCanvas.width = w * dpr;
            colorCanvas.height = h * dpr;
            colorCanvas.style.width = w + 'px';
            colorCanvas.style.height = h + 'px';
            if (colorCtx) {
                colorCtx.setTransform(1, 0, 0, 1, 0, 0);
                colorCtx.scale(dpr, dpr);
            }
        }

        if (particleCanvas.width !== w * dpr || particleCanvas.height !== h * dpr) {
            particleCanvas.width = w * dpr;
            particleCanvas.height = h * dpr;
            particleCanvas.style.width = w + 'px';
            particleCanvas.style.height = h + 'px';
            if (particleCtx) {
                particleCtx.setTransform(1, 0, 0, 1, 0, 0);
                particleCtx.scale(dpr, dpr);
            }
        }

        alignCanvases(map);
    }

    // --------------------------------------------------------------------------
    // 4. Modelo Atmosférico y Obtención de Datos de Viento
    // --------------------------------------------------------------------------
    function generateSyntheticWindGrid(bounds, rows, cols) {
        const u = [];
        const v = [];
        const speed = [];

        const dLat = (bounds.north - bounds.south) / Math.max(1, rows - 1);
        const dLon = (bounds.east - bounds.west) / Math.max(1, cols - 1);

        // Incorporar ciclones y huracanes activos monitoreados
        const hurricanes = window.trackedRadarHurricanes || [];

        for (let r = 0; r < rows; r++) {
            const lat = bounds.south + r * dLat;
            for (let c = 0; c < cols; c++) {
                const lon = bounds.west + c * dLon;

                // Vientos planetarios de gran escala (Alisios y del Oeste)
                let baseU = 0;
                let baseV = 0;

                if (lat >= -5 && lat <= 28) {
                    // Vientos Alisios del Este en los trópicos y Caribe (soplando hacia el oeste)
                    baseU = -18 - Math.sin(lat * 0.12) * 8;
                    baseV = (lat > 10 ? -4 : 3) + Math.cos(lon * 0.08) * 3;
                } else if (lat > 28) {
                    // Vientos del Oeste en latitudes medias
                    baseU = 22 + Math.sin(lat * 0.1) * 12;
                    baseV = 5 + Math.sin(lon * 0.05) * 6;
                } else {
                    // Hemisferio Sur
                    baseU = -15 + Math.cos(lat * 0.1) * 6;
                    baseV = 4 + Math.sin(lon * 0.07) * 4;
                }

                // Perturbaciones mesoescalares suaves
                const wave = Math.sin(lat * 0.25 + lon * 0.2) * 5;
                baseU += wave;
                baseV += Math.cos(lat * 0.2 - lon * 0.15) * 4;

                // Campo de vórtice ciclónico intenso si hay un huracán en la zona
                for (let h of hurricanes) {
                    const dLatH = lat - h.latitude;
                    const dLonH = lon - h.longitude;
                    const distDeg = Math.hypot(dLatH, dLonH);
                    if (distDeg < 12) {
                        const maxW = h.maxWindsKmh || 130;
                        const factor = Math.exp(-Math.pow(distDeg / 3.8, 2)) * maxW;
                        // Giro ciclónico antihorario (Hemisferio Norte)
                        const angle = Math.atan2(dLatH, dLonH);
                        baseU += -Math.sin(angle) * factor * 0.85;
                        baseV += Math.cos(angle) * factor * 0.85;
                    }
                }

                const spd = Math.hypot(baseU, baseV);
                u.push(baseU);
                v.push(baseV);
                speed.push(spd);
            }
        }

        return {
            bounds,
            rows,
            cols,
            u,
            v,
            speed
        };
    }

    async function fetchLiveWindGrid(bounds) {
        if (isFetchingGrid) return;
        isFetchingGrid = true;

        try {
            const south = bounds.getSouth();
            const north = bounds.getNorth();
            const west = bounds.getWest();
            const east = bounds.getEast();

            const url = `/Home/GetWindGrid?south=${south.toFixed(2)}&north=${north.toFixed(2)}&west=${west.toFixed(2)}&east=${east.toFixed(2)}`;
            const res = await fetch(url);

            if (res.ok) {
                const data = await res.json();
                const list = Array.isArray(data) ? data : [data];

                if (list.length >= 4) {
                    const rows = 8;
                    const cols = 8;
                    const u = [];
                    const v = [];
                    const speed = [];

                    for (let item of list) {
                        let curSpd = 15;
                        let curDir = 90;
                        if (item.hourly && item.hourly.wind_speed_10m && item.hourly.wind_speed_10m.length > 0) {
                            curSpd = item.hourly.wind_speed_10m[0] || 15;
                            curDir = item.hourly.wind_direction_10m ? (item.hourly.wind_direction_10m[0] || 90) : 90;
                        }
                        const rad = (curDir * Math.PI) / 180;
                        const uVal = -curSpd * Math.sin(rad);
                        const vVal = -curSpd * Math.cos(rad);
                        u.push(uVal);
                        v.push(vVal);
                        speed.push(curSpd);
                    }

                    currentGrid = {
                        bounds: { south, north, west, east },
                        rows,
                        cols,
                        u,
                        v,
                        speed
                    };

                    if (isWindLayerActive) {
                        renderWindColorField();
                    }
                }
            }
        } catch (e) {
            // Silencioso: el modelo sintético garantiza continuidad sin interrupciones
        } finally {
            isFetchingGrid = false;
        }
    }

    // --------------------------------------------------------------------------
    // 5. Interpolación Bilineal y Campo de Color Continuo (MSN Palette)
    // --------------------------------------------------------------------------
    function sampleGrid(grid, lat, lon) {
        if (!grid) return { u: 0, v: 0, speed: 0 };
        const b = grid.bounds;
        if (lat < b.south || lat > b.north || lon < b.west || lon > b.east) {
            return { u: 0, v: 0, speed: 0 };
        }

        const normLat = (lat - b.south) / (b.north - b.south);
        const normLon = (lon - b.west) / (b.east - b.west);

        const rFloat = normLat * (grid.rows - 1);
        const cFloat = normLon * (grid.cols - 1);

        const r0 = Math.max(0, Math.min(grid.rows - 2, Math.floor(rFloat)));
        const r1 = r0 + 1;
        const c0 = Math.max(0, Math.min(grid.cols - 2, Math.floor(cFloat)));
        const c1 = c0 + 1;

        const tx = cFloat - c0;
        const ty = rFloat - r0;

        const i00 = r0 * grid.cols + c0;
        const i01 = r0 * grid.cols + c1;
        const i10 = r1 * grid.cols + c0;
        const i11 = r1 * grid.cols + c1;

        const w00 = (1 - tx) * (1 - ty);
        const w01 = tx * (1 - ty);
        const w10 = (1 - tx) * ty;
        const w11 = tx * ty;

        const u = w00 * grid.u[i00] + w01 * grid.u[i01] + w10 * grid.u[i10] + w11 * grid.u[i11];
        const v = w00 * grid.v[i00] + w01 * grid.v[i01] + w10 * grid.v[i10] + w11 * grid.v[i11];
        const speed = Math.hypot(u, v);

        return { u, v, speed };
    }

    function renderWindColorField() {
        if (!mapInstance || !colorCanvas || !colorCtx || !currentGrid) return;
        const size = mapInstance.getSize();
        if (!size || size.x === 0 || size.y === 0) return;

        // Renderizado a resolución escalonada con filtrado bilineal en canvas
        const step = 4; // Paso de 4px para 60fps con degradado ultrasuave
        const gw = Math.ceil(size.x / step);
        const gh = Math.ceil(size.y / step);

        if (offscreenColorCanvas.width !== gw || offscreenColorCanvas.height !== gh) {
            offscreenColorCanvas.width = gw;
            offscreenColorCanvas.height = gh;
        }

        const imgData = offscreenColorCtx.createImageData(gw, gh);
        const pixels = imgData.data;

        for (let gy = 0; gy < gh; gy++) {
            const py = gy * step;
            const rowOffset = gy * gw * 4;

            for (let gx = 0; gx < gw; gx++) {
                const px = gx * step;
                const latLng = mapInstance.containerPointToLatLng([px, py]);
                const sample = sampleGrid(currentGrid, latLng.lat, latLng.lng);
                const color = getLutColor(sample.speed);

                const idx = rowOffset + gx * 4;
                pixels[idx]     = color[0];
                pixels[idx + 1] = color[1];
                pixels[idx + 2] = color[2];
                pixels[idx + 3] = color[3];
            }
        }

        offscreenColorCtx.putImageData(imgData, 0, 0);

        // Pintar con suavizado de imagen bilineal sobre el canvas del mapa
        colorCtx.clearRect(0, 0, size.x, size.y);
        colorCtx.imageSmoothingEnabled = true;
        colorCtx.imageSmoothingQuality = 'high';
        colorCtx.drawImage(offscreenColorCanvas, 0, 0, size.x, size.y);
    }

    // --------------------------------------------------------------------------
    // 6. Partículas Animadas con Estela que se Desvanece (MSN Style)
    // --------------------------------------------------------------------------
    function initParticles(width, height) {
        particles.length = 0;
        for (let i = 0; i < NUM_PARTICLES; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                age: Math.floor(Math.random() * 65),
                maxAge: 45 + Math.floor(Math.random() * 45)
            });
        }
    }

    function animateParticles() {
        if (!isWindLayerActive || !mapInstance || !particleCanvas || !particleCtx || !currentGrid) {
            return;
        }

        const size = mapInstance.getSize();
        if (!size || size.x === 0 || size.y === 0) return;

        // Estela que se desvanece suavemente (Fade out gradual idéntico a MSN)
        particleCtx.globalCompositeOperation = 'destination-out';
        particleCtx.fillStyle = 'rgba(0, 0, 0, 0.075)';
        particleCtx.fillRect(0, 0, size.x, size.y);
        particleCtx.globalCompositeOperation = 'source-over';

        // Trazado de partículas blancas semitransparentes
        particleCtx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
        particleCtx.lineWidth = PARTICLE_LINE_WIDTH;
        particleCtx.lineCap = 'round';
        particleCtx.beginPath();

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];

            if (p.x < 0 || p.x > size.x || p.y < 0 || p.y > size.y || p.age >= p.maxAge) {
                p.x = Math.random() * size.x;
                p.y = Math.random() * size.y;
                p.age = 0;
                p.maxAge = 45 + Math.floor(Math.random() * 45);
                continue;
            }

            const latLng = mapInstance.containerPointToLatLng([p.x, p.y]);
            const wind = sampleGrid(currentGrid, latLng.lat, latLng.lng);

            if (wind.speed < 1.5) {
                p.age += 3;
                continue;
            }

            // Vector de velocidad en pantalla
            const nextX = p.x + wind.u * SPEED_SCALE;
            // El eje Y de pantalla crece hacia abajo, mientras que el viento Norte (v > 0) va hacia arriba
            const nextY = p.y - wind.v * SPEED_SCALE;

            particleCtx.moveTo(p.x, p.y);
            particleCtx.lineTo(nextX, nextY);

            p.x = nextX;
            p.y = nextY;
            p.age++;
        }

        particleCtx.stroke();
        particleAnimId = requestAnimationFrame(animateParticles);
    }

    // --------------------------------------------------------------------------
    // 7. Eventos de Mapa y Recalculo al Mover o Hacer Zoom
    // --------------------------------------------------------------------------
    function refreshWindLayerForCurrentView() {
        if (!mapInstance || !isWindLayerActive) return;
        const b = mapInstance.getBounds();
        const boundsObj = {
            south: b.getSouth(),
            north: b.getNorth(),
            west: b.getWest(),
            east: b.getEast()
        };

        // Generar inmediatamente la cuadrícula sintética física para 0ms de retardo
        currentGrid = generateSyntheticWindGrid(boundsObj, gridRows, gridCols);

        resizeCanvases(mapInstance);
        renderWindColorField();

        const size = mapInstance.getSize();
        initParticles(size.x, size.y);

        // Consultar en segundo plano Open-Meteo para actualizar con datos satelitales en vivo
        fetchLiveWindGrid(b);
    }

    function setupMapListeners(map) {
        if (!map) return;
        map.on('move', () => {
            if (isWindLayerActive) alignCanvases(map);
        });

        map.on('moveend zoomend resize', () => {
            if (isWindLayerActive) {
                refreshWindLayerForCurrentView();
            }
        });
    }

    // --------------------------------------------------------------------------
    // 8. API Pública: Activar / Desactivar Capa de Viento
    // --------------------------------------------------------------------------
    window.toggleWindLayer = function () {
        const map = window.radarMap;
        if (!map) {
            console.warn("Radar Map no está disponible aún.");
            return;
        }

        mapInstance = map;
        isWindLayerActive = !isWindLayerActive;

        const btn = document.getElementById('btnToggleWindLayer');
        const legend = document.getElementById('windLegendBox');

        if (isWindLayerActive) {
            ensureCanvases(map);
            setupMapListeners(map);

            if (btn) {
                btn.classList.add('active');
                btn.classList.replace('btn-outline-info', 'btn-info');
                btn.innerHTML = '<i class="bi bi-wind me-1"></i>Viento: ON';
            }

            if (legend) {
                legend.classList.remove('d-none');
            }

            refreshWindLayerForCurrentView();
            if (particleAnimId) cancelAnimationFrame(particleAnimId);
            particleAnimId = requestAnimationFrame(animateParticles);
        } else {
            if (particleAnimId) {
                cancelAnimationFrame(particleAnimId);
                particleAnimId = null;
            }

            if (colorCtx && colorCanvas) {
                colorCtx.clearRect(0, 0, colorCanvas.width, colorCanvas.height);
            }
            if (particleCtx && particleCanvas) {
                particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
            }

            if (btn) {
                btn.classList.remove('active');
                btn.innerHTML = '<i class="bi bi-wind me-1"></i>Mapa de Viento';
            }

            if (legend) {
                legend.classList.add('d-none');
            }
        }
    };

    // Enganche para cuando se inicialice o reinicialice el mapa en weather.js
    window.onRadarMapInitialized = function (map) {
        mapInstance = map;
        if (isWindLayerActive) {
            ensureCanvases(map);
            setupMapListeners(map);
            refreshWindLayerForCurrentView();
            if (!particleAnimId) {
                particleAnimId = requestAnimationFrame(animateParticles);
            }
        }
    };

})();
