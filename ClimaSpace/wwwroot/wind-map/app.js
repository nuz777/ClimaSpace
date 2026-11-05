/**
 * ==============================================================================
 * ClimaSpace - Motor de Visualización de Viento en Vivo (MSN & Windy Style)
 * ------------------------------------------------------------------------------
 * Con soporte para CARTO Dark Matter garantizado, velocidad de flujo suave y
 * realista, identificación de ubicación en cursor y lectura y seguimiento de
 * huracanes con vórtice ciclónico interactivo.
 * ==============================================================================
 */

'use strict';

(function () {
  const WM_CONFIG = {
    initialView: {
      lat: 22.0, // Centrado estratégico para abarcar Caribe, Golfo de México, Colombia y EE.UU.
      lng: -78.0,
      zoom: 4,
      minZoom: 2,
      maxZoom: 16
    },
    grid: {
      rows: 8,
      cols: 8,
      paddingPercent: 0.15
    },
    particles: {
      baseCount: 3200,
      maxAge: 75,
      // Velocidad suave y realista por defecto (inspirada en MSN El Tiempo y Windy)
      speedFactors: {
        gentle: 0.015,
        normal: 0.025,
        fast: 0.045
      },
      currentSpeedMode: 'gentle',
      lineWidth: 1.8,
      fadeFactor: 0.075
    },
    colorScale: [
      { speed: 0,   rgb: [59, 130, 246], hex: '#3b82f6', label: 'Brisa ligera' },
      { speed: 10,  rgb: [6, 182, 212],  hex: '#06b6d4', label: 'Brisa suave' },
      { speed: 20,  rgb: [16, 185, 129], hex: '#10b981', label: 'Viento moderado' },
      { speed: 35,  rgb: [234, 179, 8],  hex: '#eab308', label: 'Viento fuerte' },
      { speed: 55,  rgb: [249, 115, 22], hex: '#f97316', label: 'Muy fuerte' },
      { speed: 70,  rgb: [239, 68, 68],  hex: '#ef4444', label: 'Temporal duro' },
      { speed: 100, rgb: [190, 18, 60],  hex: '#be123c', label: 'Huracán / Tormenta' }
    ]
  };

  // Lista de huracanes activos sincronizada en vivo con NOAA / NHC
  let trackedHurricanes = [];

  class WmMath {
    static normalizeLng(lng) {
      return ((((lng + 180) % 360) + 360) % 360) - 180;
    }
    static clamp(val, min, max) {
      return Math.max(min, Math.min(max, val));
    }
    static lerp(a, b, t) {
      return a + (b - a) * t;
    }
    static polarToVector(speed, deg) {
      const rad = (deg * Math.PI) / 180;
      return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad) };
    }
    static vectorToPolar(u, v) {
      const speed = Math.hypot(u, v);
      const deg = (Math.atan2(-u, -v) * (180 / Math.PI) + 360) % 360;
      return { speed, direction: deg };
    }
    static getCardinal(deg) {
      const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
      return dirs[Math.round((deg % 360) / 22.5) % 16];
    }
    static getColor(speed) {
      const scale = WM_CONFIG.colorScale;
      if (speed <= scale[0].speed) return scale[0];
      if (speed >= scale[scale.length - 1].speed) return scale[scale.length - 1];
      for (let i = 0; i < scale.length - 1; i++) {
        const s0 = scale[i], s1 = scale[i + 1];
        if (speed >= s0.speed && speed <= s1.speed) {
          const t = (speed - s0.speed) / (s1.speed - s0.speed);
          const r = Math.round(WmMath.lerp(s0.rgb[0], s1.rgb[0], t));
          const g = Math.round(WmMath.lerp(s0.rgb[1], s1.rgb[1], t));
          const b = Math.round(WmMath.lerp(s0.rgb[2], s1.rgb[2], t));
          return {
            hex: `rgb(${r}, ${g}, ${b})`,
            label: t < 0.5 ? s0.label : s1.label
          };
        }
      }
      return scale[0];
    }

    /**
     * Calcula la distancia en kilómetros entre dos coordenadas
     */
    static distanceKm(lat1, lon1, lat2, lon2) {
      const R = 6371; // Radio de la Tierra en km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    /**
     * Nomenclatura geográfica instantánea (0ms) para mares, océanos y regiones clave
     */
    static getInstantLocationName(lat, lon) {
      // 1. Detección de Mares y Océanos
      if (lat >= 9.0 && lat <= 22.0 && lon >= -89.0 && lon <= -59.0) {
        return lat <= 13.5 ? "Mar Caribe (Caribe Sur / Frente a Colombia)" : "Mar Caribe Central";
      }
      if (lat >= 18.0 && lat <= 31.0 && lon >= -98.0 && lon <= -80.0) {
        return "Golfo de México (Frente a EE. UU. y México)";
      }
      if (lat >= 20.0 && lat <= 55.0 && lon >= -80.0 && lon <= -15.0) {
        return "Océano Atlántico Norte";
      }
      if (lat >= -5.0 && lat <= 25.0 && lon >= -120.0 && lon <= -77.0) {
        return "Océano Pacífico Oriental";
      }
      if (lat >= 30.0 && lat <= 46.0 && lon >= 125.0 && lon <= 143.0) {
        return "Mar de Japón / Japón";
      }
      if (lat >= 30.0 && lat <= 46.0 && lon >= -6.0 && lon <= 36.0) {
        return "Mar Mediterráneo";
      }

      // 2. Regiones terrestres conocidas solicitadas
      // Colombia
      if (lat >= -4.5 && lat <= 13.5 && lon >= -79.0 && lon <= -66.5) {
        if (lat >= 4.3 && lat <= 5.0 && lon >= -74.4 && lon <= -73.8) return "Bogotá D.C., Colombia";
        if (lat >= 6.0 && lat <= 6.5 && lon >= -75.8 && lon <= -75.3) return "Medellín, Antioquia, Colombia";
        if (lat >= 3.2 && lat <= 3.7 && lon >= -76.7 && lon <= -76.3) return "Cali, Valle del Cauca, Colombia";
        if (lat >= 10.8 && lat <= 11.2 && lon >= -75.0 && lon <= -74.6) return "Barranquilla, Atlántico, Colombia";
        if (lat >= 10.3 && lat <= 10.6 && lon >= -75.6 && lon <= -75.4) return "Cartagena, Bolívar, Colombia";
        if (lat >= 10.0) return "Región Caribe, Colombia";
        if (lon <= -76.5) return "Región Pacífica / Chocó, Colombia";
        if (lat <= 2.0) return "Amazonía Colombiana";
        if (lon >= -72.0) return "Orinoquía / Llanos, Colombia";
        return "Colombia";
      }

      // Misisipi, Oklahoma, Kansas, Texas (solicitados por el usuario)
      if (lat >= 30.0 && lat <= 35.0 && lon >= -91.7 && lon <= -88.0) return "Misisipi, EE. UU. (Costa del Golfo)";
      if (lat >= 33.6 && lat <= 37.0 && lon >= -103.0 && lon <= -94.4) return "Oklahoma, EE. UU.";
      if (lat >= 37.0 && lat <= 40.0 && lon >= -102.0 && lon <= -94.5) return "Kansas, EE. UU.";
      if (lat >= 25.8 && lat <= 36.5 && lon >= -106.6 && lon <= -93.5) return "Texas, EE. UU.";
      if (lat >= 24.5 && lat <= 31.0 && lon >= -87.6 && lon <= -80.0) return "Florida, EE. UU.";
      if (lat >= 28.9 && lat <= 33.0 && lon >= -94.0 && lon <= -89.0) return "Luisiana, EE. UU.";

      // Japón
      if (lat >= 30.0 && lat <= 46.0 && lon >= 128.0 && lon <= 146.0) return "Japón";
      // Rusia
      if (lat >= 45.0 && lat <= 78.0 && lon >= 20.0 && lon <= 180.0) return "Rusia";

      const latDir = lat >= 0 ? 'N' : 'S';
      const lonDir = lon >= 0 ? 'E' : 'O';
      return `${Math.abs(lat).toFixed(2)}° ${latDir}, ${Math.abs(lon).toFixed(2)}° ${lonDir}`;
    }
  }

  class WmGrid {
    constructor(bounds, rows, cols) {
      this.latMin = bounds.latMin;
      this.latMax = bounds.latMax;
      this.lngMin = bounds.lngMin;
      this.lngMax = bounds.lngMax;
      this.rows = rows;
      this.cols = cols;
      this.dLat = (this.latMax - this.latMin) / Math.max(1, rows - 1);
      this.dLng = (this.lngMax - this.lngMin) / Math.max(1, cols - 1);
      this.matrix = Array.from({ length: rows }, () => new Array(cols).fill(null));
    }

    setCell(r, c, data) {
      if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
        this.matrix[r][c] = data;
      }
    }

    sample(lat, lng, hourIndex) {
      lat = WmMath.clamp(lat, -85, 85);
      lng = WmMath.normalizeLng(lng);

      let lngMin = this.lngMin, lngMax = this.lngMax, normLng = lng;
      if (lngMax < lngMin) {
        lngMax += 360;
        if (normLng < lngMin) normLng += 360;
      }

      const gy = (lat - this.latMin) / (this.dLat || 1);
      const gx = (normLng - lngMin) / (this.dLng || 1);

      const cgy = WmMath.clamp(gy, 0, this.rows - 2);
      const cgx = WmMath.clamp(gx, 0, this.cols - 2);

      const r0 = Math.floor(cgy), r1 = r0 + 1;
      const c0 = Math.floor(cgx), c1 = c0 + 1;
      const fy = cgy - r0, fx = cgx - c0;

      const v00 = this.getVec(r0, c0, hourIndex, lat, lng);
      const v10 = this.getVec(r0, c1, hourIndex, lat, lng);
      const v01 = this.getVec(r1, c0, hourIndex, lat, lng);
      const v11 = this.getVec(r1, c1, hourIndex, lat, lng);

      // Interpolación bilineal directa del campo de viento real (sin vórtices artificiales)
      const u = WmMath.lerp(WmMath.lerp(v00.u, v10.u, fx), WmMath.lerp(v01.u, v11.u, fx), fy);
      const v = WmMath.lerp(WmMath.lerp(v00.v, v10.v, fx), WmMath.lerp(v01.v, v11.v, fx), fy);

      const polar = WmMath.vectorToPolar(u, v);
      return {
        u, v,
        speed: Math.round(polar.speed * 10) / 10,
        direction: Math.round(polar.direction)
      };
    }

    getVec(r, c, hourIndex, lat, lng) {
      const cell = this.matrix[r] && this.matrix[r][c];
      if (cell && cell.hourly && cell.hourly.wind_speed_10m && cell.hourly.wind_speed_10m[hourIndex] !== undefined) {
        const spd = cell.hourly.wind_speed_10m[hourIndex] ?? 0;
        const dir = cell.hourly.wind_direction_10m[hourIndex] ?? 0;
        return WmMath.polarToVector(spd, dir);
      }
      // Respaldo sintético continuo
      const latRad = (lat * Math.PI) / 180;
      const lngRad = (lng * Math.PI) / 180;
      const shift = hourIndex * 0.05;
      const u = -20 * Math.sin(latRad * 2) + 7 * Math.sin(lngRad * 3 + shift);
      const v = 5 * Math.cos(lngRad * 2 + shift);
      return { u, v };
    }
  }

  class WmService {
    constructor() {
      this.cache = new Map();
      this.activeGrid = null;
      this.debounceTimer = null;
      this.onStatus = null;
    }

    async loadGrid(bounds) {
      clearTimeout(this.debounceTimer);
      return new Promise((resolve) => {
        this.debounceTimer = setTimeout(async () => {
          const s = bounds.getSouth(), n = bounds.getNorth(), w = bounds.getWest(), e = bounds.getEast();
          const latPad = (n - s) * WM_CONFIG.grid.paddingPercent;
          const lngPad = (e - w) * WM_CONFIG.grid.paddingPercent;

          const latMin = Math.max(-80, s - latPad);
          const latMax = Math.min(80, n + latPad);
          const lngMin = w - lngPad;
          const lngMax = e + lngPad;

          const cacheKey = `${s.toFixed(1)}_${n.toFixed(1)}_${w.toFixed(1)}_${e.toFixed(1)}`;
          if (this.cache.has(cacheKey)) {
            this.activeGrid = this.cache.get(cacheKey);
            if (this.onStatus) this.onStatus('cached');
            return resolve(this.activeGrid);
          }

          if (this.onStatus) this.onStatus('loading');

          const rows = WM_CONFIG.grid.rows, cols = WM_CONFIG.grid.cols;
          const backendUrl = `/Home/GetWindGrid?south=${latMin.toFixed(2)}&north=${latMax.toFixed(2)}&west=${lngMin.toFixed(2)}&east=${lngMax.toFixed(2)}`;

          try {
            let res = await fetch(backendUrl);
            if (!res.ok) {
              const lats = [], lngs = [];
              const dLat = (latMax - latMin) / (rows - 1);
              const dLng = (lngMax - lngMin) / (cols - 1);
              for (let r = 0; r < rows; r++) {
                const latVal = latMin + r * dLat;
                for (let c = 0; c < cols; c++) {
                  lats.push(latVal.toFixed(2));
                  lngs.push(WmMath.normalizeLng(lngMin + c * dLng).toFixed(2));
                }
              }
              const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lngs.join(',')}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&forecast_days=7`;
              res = await fetch(omUrl);
            }

            const data = await res.json();
            const arr = Array.isArray(data) ? data : [data];

            const grid = new WmGrid({ latMin, latMax, lngMin, lngMax }, rows, cols);
            let idx = 0;
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                if (idx < arr.length) {
                  grid.setCell(r, c, arr[idx++]);
                }
              }
            }

            if (this.cache.size >= 15) {
              this.cache.delete(this.cache.keys().next().value);
            }
            this.cache.set(cacheKey, grid);
            this.activeGrid = grid;
            if (this.onStatus) this.onStatus('success');
            resolve(grid);
          } catch (err) {
            console.warn('Uso de modelo sintético continuo:', err);
            const fallbackGrid = new WmGrid({ latMin, latMax, lngMin, lngMax }, rows, cols);
            this.activeGrid = fallbackGrid;
            if (this.onStatus) this.onStatus('synthetic');
            resolve(fallbackGrid);
          }
        }, 320);
      });
    }
  }

  class WmParticleEngine {
    constructor(canvas, map, service) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.map = map;
      this.service = service;
      this.particles = [];
      this.enabled = true;
      this.currentHour = 0;
      this.animId = null;

      this.initSize();
      this.initParticles();
    }

    initSize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.width = rect.width || window.innerWidth;
      this.height = rect.height || window.innerHeight;
      this.canvas.width = Math.floor(this.width * dpr);
      this.canvas.height = Math.floor(this.height * dpr);
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(dpr, dpr);
    }

    initParticles() {
      const count = Math.round(WM_CONFIG.particles.baseCount * Math.max(0.6, (this.width * this.height) / (1920 * 1080)));
      this.particles = Array.from({ length: count }, () => this.createP());
    }

    createP() {
      return {
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        age: Math.floor(Math.random() * WM_CONFIG.particles.maxAge),
        maxAge: WM_CONFIG.particles.maxAge + Math.floor(Math.random() * 20),
        speed: 0
      };
    }

    resetP(p) {
      p.x = Math.random() * this.width;
      p.y = Math.random() * this.height;
      p.age = 0;
      p.maxAge = WM_CONFIG.particles.maxAge + Math.floor(Math.random() * 20);
      p.speed = 0;
    }

    start() {
      if (this.animId) cancelAnimationFrame(this.animId);
      const loop = () => {
        this.render();
        this.animId = requestAnimationFrame(loop);
      };
      this.animId = requestAnimationFrame(loop);
    }

    render() {
      if (!this.enabled) return;
      const ctx = this.ctx;
      const grid = this.service.activeGrid;

      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${WM_CONFIG.particles.fadeFactor})`;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();

      if (!grid) return;

      const zoom = this.map.getZoom();
      // Factor de velocidad suave, delicado y agradable a la vista
      const baseFactor = WM_CONFIG.particles.speedFactors[WM_CONFIG.particles.currentSpeedMode] || 0.015;
      const zoomScale = Math.pow(1.08, Math.min(zoom, 10) - 4) * baseFactor;

      ctx.lineWidth = WM_CONFIG.particles.lineWidth;
      ctx.lineCap = 'round';

      const list = this.particles;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.age >= p.maxAge || p.x < 0 || p.x > this.width || p.y < 0 || p.y > this.height) {
          this.resetP(p);
        }

        const latLng = this.map.containerPointToLatLng([p.x, p.y]);
        const sample = grid.sample(latLng.lat, latLng.lng, this.currentHour);

        if (!sample || sample.speed === 0) {
          p.age += 2;
          continue;
        }

        const dx = sample.u * zoomScale;
        const dy = -sample.v * zoomScale;
        const nextX = p.x + dx;
        const nextY = p.y + dy;

        const color = WmMath.getColor(sample.speed);

        ctx.beginPath();
        ctx.strokeStyle = color.hex;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nextX, nextY);
        ctx.stroke();

        p.x = nextX;
        p.y = nextY;
        p.age++;
      }
    }

    clear() {
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.restore();
    }

    resize() {
      this.initSize();
      this.initParticles();
      this.clear();
    }
  }

  // Inicialización de la página cuando el DOM esté listo
  function initWindMapPage() {
    const mapEl = document.getElementById('windMap');
    if (!mapEl) return;

    // 1. Inicializar Leaflet con soporte de tiles robusto
    const map = L.map('windMap', {
      center: [WM_CONFIG.initialView.lat, WM_CONFIG.initialView.lng],
      zoom: WM_CONFIG.initialView.zoom,
      minZoom: WM_CONFIG.initialView.minZoom,
      maxZoom: WM_CONFIG.initialView.maxZoom,
      zoomControl: false,
      attributionControl: false
    });

    // Definición de capas base (CARTO Dark prioritario con fallback transparente)
    const baseLayers = {
      'carto-dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
        tileSize: 256
      }),
      'esri-dark': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18,
        tileSize: 256
      }),
      'esri-satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18,
        tileSize: 256
      }),
      'osm-standard': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        tileSize: 256
      })
    };

    let activeLayer = baseLayers['carto-dark'].addTo(map);

    // Si algún tile de Carto tiene problema, conmuta transparentemente a Esri Dark
    let cartoErrorCount = 0;
    baseLayers['carto-dark'].on('tileerror', function () {
      cartoErrorCount++;
      if (cartoErrorCount > 4 && map.hasLayer(baseLayers['carto-dark'])) {
        console.warn('Fallback automático de CARTO Dark a Esri Dark Gray');
        map.removeLayer(baseLayers['carto-dark']);
        activeLayer = baseLayers['esri-dark'].addTo(map);
      }
    });

    // Corrección crítica: InvalidateSize para garantizar que los tiles de CARTO se dibujen
    map.invalidateSize();
    setTimeout(() => map.invalidateSize(), 100);
    setTimeout(() => map.invalidateSize(), 350);
    setTimeout(() => map.invalidateSize(), 800);

    // 2. Motor de partículas y servicio de cuadrícula
    const canvas = document.getElementById('particleCanvas');
    const service = new WmService();
    const engine = new WmParticleEngine(canvas, map, service);

    // 3. Sistema de Lectura y Detección de Huracanes
    const hurricaneLayerGroup = L.layerGroup().addTo(map);

    function renderHurricanesOnMap(hurricanes) {
      hurricaneLayerGroup.clearLayers();

      hurricanes.forEach((h) => {
        // Icono animado giratorio en HTML
        const customIcon = L.divIcon({
          className: 'hurricane-leaflet-marker',
          html: `
            <div class="hurricane-marker-wrap" title="${h.name} - ${h.category} (${h.maxWindsKmh} km/h)">
              <div class="hurricane-marker-pulse"></div>
              <div class="hurricane-marker-icon">
                <i class="bi bi-hurricane"></i>
              </div>
              <span class="hurricane-marker-badge cat-${h.categoryLevel}">${h.category}</span>
            </div>
          `,
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        });

        // Marcador del ojo del huracán
        const marker = L.marker([h.latitude, h.longitude], { icon: customIcon });

        // Círculo de campo de vientos de tormenta
        const windCircle = L.circle([h.latitude, h.longitude], {
          radius: 280000, // 280 km
          color: '#ef4444',
          weight: 1.5,
          opacity: 0.6,
          fillColor: '#dc2626',
          fillOpacity: 0.08,
          dashArray: '4, 6'
        });

        // Círculo de la pared del ojo
        const eyeCircle = L.circle([h.latitude, h.longitude], {
          radius: 38000, // 38 km
          color: '#f87171',
          weight: 2,
          opacity: 0.9,
          fillColor: '#991b1b',
          fillOpacity: 0.25
        });

        // Popup interactivo con datos meteorológicos reales del ciclón
        marker.bindPopup(`
          <div style="font-family: inherit; min-width: 200px; color: #0f172a;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 6px;">
              <strong style="font-size: 1rem; color: #dc2626;"><i class="bi bi-hurricane me-1"></i>${h.name}</strong>
              <span style="background: #991b1b; color:#fff; font-size: 0.7rem; font-weight:700; padding: 2px 6px; border-radius: 9999px;">${h.category}</span>
            </div>
            <div style="font-size: 0.78rem; color: #475569; margin-bottom: 6px;">${h.locationDesc}</div>
            <div style="background: #f8fafc; border-radius: 6px; padding: 6px 8px; font-size: 0.75rem; border: 1px solid #e2e8f0;">
              <div><strong>Vientos sostenidos:</strong> ${h.maxWindsKmh} km/h</div>
              <div><strong>Presión mínima:</strong> ${h.pressureHpa} hPa</div>
              <div><strong>Trayectoria:</strong> ${h.movement}</div>
              <div><strong>Estado:</strong> <span style="color:#dc2626; font-weight:600;">${h.status}</span></div>
            </div>
          </div>
        `);

        hurricaneLayerGroup.addLayer(windCircle);
        hurricaneLayerGroup.addLayer(eyeCircle);
        hurricaneLayerGroup.addLayer(marker);
      });
    }

    // Poblar el menú desplegable de Huracanes con datos reales de NOAA
    function populateHurricanesPanel(hurricanes) {
      const listContainer = document.getElementById('windHurricanesList');
      const badge = document.getElementById('windHurricaneCountBadge');
      if (badge) {
        badge.textContent = hurricanes.length;
        badge.className = hurricanes.length > 0 ? "badge bg-danger rounded-pill" : "badge bg-secondary rounded-pill";
      }

      if (!listContainer) return;
      listContainer.innerHTML = '';

      if (!hurricanes || hurricanes.length === 0) {
        listContainer.innerHTML = `
          <div class="p-3 text-center text-white-50">
            <i class="bi bi-shield-check text-success fs-3 d-block mb-2"></i>
            <div class="fw-bold text-white small mb-1">Sin Huracanes Activos</div>
            <div style="font-size: 0.75rem; line-height: 1.35;">
              Datos oficiales en vivo del Centro Nacional de Huracanes (NHC / NOAA): No hay ciclones tropicales ni huracanes activos actualmente.
            </div>
          </div>
        `;
        return;
      }

      hurricanes.forEach((h) => {
        const card = document.createElement('div');
        card.className = 'wind-hurricane-card';
        card.innerHTML = `
          <div class="wind-hurricane-top">
            <span class="wind-hurricane-name"><i class="bi bi-hurricane text-danger me-1"></i>${h.name}</span>
            <span class="wind-hurricane-cat cat-${h.categoryLevel}">${h.category}</span>
          </div>
          <div class="wind-hurricane-desc">${h.locationDesc}</div>
          <div class="wind-hurricane-stats">
            <span><i class="bi bi-wind text-info me-1"></i>${h.maxWindsKmh} km/h</span>
            <span><i class="bi bi-speedometer text-warning me-1"></i>${h.pressureHpa} hPa</span>
            <span><i class="bi bi-compass text-secondary me-1"></i>${h.movement}</span>
          </div>
        `;

        card.addEventListener('click', () => {
          // Volar al ojo del huracán
          map.flyTo([h.latitude, h.longitude], 7, {
            duration: 2.0,
            easeLinearity: 0.25
          });
          document.getElementById('windHurricanesPanel')?.classList.add('d-none');
        });

        listContainer.appendChild(card);
      });
    }

    // Cargar huracanes reales en vivo desde el backend C# (NOAA NHC)
    async function loadHurricanes() {
      try {
        const res = await fetch('/Home/GetHurricanes');
        if (res.ok) {
          const list = await res.json();
          trackedHurricanes = Array.isArray(list) ? list : [];
        } else {
          trackedHurricanes = [];
        }
      } catch (e) {
        console.warn('Error consultando huracanes en vivo:', e);
        trackedHurricanes = [];
      }
      renderHurricanesOnMap(trackedHurricanes);
      populateHurricanesPanel(trackedHurricanes);
    }
    loadHurricanes();

    // Toggle del panel de huracanes
    const btnHurricanes = document.getElementById('windBtnHurricanes');
    const panelHurricanes = document.getElementById('windHurricanesPanel');
    const closeHurricanes = document.getElementById('windCloseHurricanesPanel');

    btnHurricanes?.addEventListener('click', (e) => {
      e.stopPropagation();
      panelHurricanes?.classList.toggle('d-none');
    });

    closeHurricanes?.addEventListener('click', () => {
      panelHurricanes?.classList.add('d-none');
    });

    document.addEventListener('click', (e) => {
      if (panelHurricanes && !panelHurricanes.contains(e.target) && e.target !== btnHurricanes) {
        panelHurricanes.classList.add('d-none');
      }
    });

    // Selector de velocidad de partículas
    const speedSelect = document.getElementById('windSpeedFactorSelect');
    speedSelect?.addEventListener('change', (e) => {
      WM_CONFIG.particles.currentSpeedMode = e.target.value;
    });

    // Pill de estado
    const statusBadge = document.getElementById('windStatusBadge');
    const statusText = document.getElementById('windStatusText');
    service.onStatus = (st) => {
      if (!statusBadge || !statusText) return;
      statusBadge.className = 'wind-status-badge';
      if (st === 'loading') {
        statusText.textContent = 'Actualizando viento...';
      } else if (st === 'success') {
        statusBadge.classList.add('success');
        statusText.textContent = '● En vivo: Open-Meteo API';
      } else if (st === 'cached') {
        statusBadge.classList.add('success');
        statusText.textContent = '● En memoria: 168h listas';
      } else {
        statusBadge.classList.add('warning');
        statusText.textContent = 'Modo simulación continua';
      }
    };

    // 4. Línea de tiempo (7 días / 168 horas)
    let currentHour = 0;
    let isPlaying = false;
    let playTimer = null;
    let playSpeed = 1;
    const baseDate = new Date();
    baseDate.setMinutes(0, 0, 0);

    const slider = document.getElementById('windTimelineSlider');
    const sliderProgress = document.getElementById('windSliderProgress');
    const btnPlay = document.getElementById('windBtnPlay');
    const playIcon = document.getElementById('windPlayIcon');
    const timePrimary = document.getElementById('windTimePrimary');
    const timeRelative = document.getElementById('windTimeRelative');
    const dayTabsContainer = document.getElementById('windDayTabs');

    function updateTimeUI() {
      const cur = new Date(baseDate.getTime() + currentHour * 3600 * 1000);
      const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      const hh = String(cur.getHours()).padStart(2, '0');

      if (timePrimary) {
        timePrimary.textContent = `${days[cur.getDay()]} ${cur.getDate()} ${months[cur.getMonth()]} — ${hh}:00`;
      }
      if (timeRelative) {
        timeRelative.textContent = currentHour === 0 ? 'Ahora' : `+${currentHour}h`;
      }
      if (slider) slider.value = currentHour;
      if (sliderProgress) sliderProgress.style.width = `${(currentHour / 167) * 100}%`;

      const activeDay = Math.floor(currentHour / 24);
      if (dayTabsContainer) {
        const tabs = dayTabsContainer.querySelectorAll('.wind-day-tab');
        tabs.forEach((tab, i) => tab.classList.toggle('active', i === activeDay));
      }
    }

    function setHour(h) {
      currentHour = WmMath.clamp(h, 0, 167);
      engine.currentHour = currentHour;
      updateTimeUI();
      inspectCurrentPoint();
    }

    // Inicializar pestañas de 7 días
    if (dayTabsContainer) {
      dayTabsContainer.innerHTML = '';
      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      for (let d = 0; d < 7; d++) {
        const tabDate = new Date(baseDate.getTime() + d * 24 * 3600 * 1000);
        const tab = document.createElement('div');
        tab.className = `wind-day-tab ${d === 0 ? 'active' : ''}`;
        tab.innerHTML = `
          <span class="wind-tab-name">${d === 0 ? 'Hoy' : dayNames[tabDate.getDay()]}</span>
          <span class="wind-tab-date">${tabDate.getDate()} ${tabDate.toLocaleString('es-ES', { month: 'short' })}</span>
        `;
        tab.addEventListener('click', () => setHour(d === 0 ? 0 : d * 24 + 12));
        dayTabsContainer.appendChild(tab);
      }
    }

    if (slider) {
      slider.addEventListener('input', (e) => setHour(parseInt(e.target.value, 10)));
    }

    function togglePlay() {
      isPlaying = !isPlaying;
      if (isPlaying) {
        playIcon.className = 'bi bi-pause-fill';
        const interval = Math.max(100, 700 / playSpeed);
        playTimer = setInterval(() => {
          let next = currentHour + 1;
          if (next > 167) next = 0;
          setHour(next);
        }, interval);
      } else {
        playIcon.className = 'bi bi-play-fill';
        clearInterval(playTimer);
      }
    }

    if (btnPlay) btnPlay.addEventListener('click', togglePlay);
    document.getElementById('windBtnPrev')?.addEventListener('click', () => setHour(currentHour - 1 < 0 ? 167 : currentHour - 1));
    document.getElementById('windBtnNext')?.addEventListener('click', () => setHour(currentHour + 1 > 167 ? 0 : currentHour + 1));
    document.getElementById('windBtnNow')?.addEventListener('click', () => setHour(0));

    document.querySelectorAll('.wind-btn-speed').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.wind-btn-speed').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        playSpeed = parseInt(btn.dataset.speed, 10);
        if (isPlaying) {
          togglePlay();
          togglePlay();
        }
      });
    });

    // 5. Tooltip de Inspección con Ubicación Identificada y Alerta de Ciclones
    const tooltip = document.getElementById('windTooltip');
    const locationEl = document.getElementById('windTooltipLocation');
    const cycloneAlertEl = document.getElementById('windTooltipHurricane');
    const cycloneAlertText = document.getElementById('windTooltipHurricaneText');
    const coordsEl = document.getElementById('windTooltipCoords');
    const speedEl = document.getElementById('windTooltipSpeed');
    const arrowEl = document.getElementById('windTooltipArrow');
    const cardinalEl = document.getElementById('windTooltipCardinal');
    const degreesEl = document.getElementById('windTooltipDegrees');
    const timeEl = document.getElementById('windTooltipTime');
    const scaleEl = document.getElementById('windTooltipScale');
    let lastLatLng = null;
    let reverseGeoDebounce = null;

    function inspect(latlng, pt) {
      lastLatLng = latlng;
      const grid = service.activeGrid;
      if (!grid || !tooltip) return;

      const sample = grid.sample(latlng.lat, latlng.lng, currentHour);
      if (!sample) return;

      const color = WmMath.getColor(sample.speed);
      const cardinal = WmMath.getCardinal(sample.direction);
      const blowTo = (sample.direction + 180) % 360;

      // 1. Ubicación geográfica inmediata (0ms)
      const instantLocation = WmMath.getInstantLocationName(latlng.lat, latlng.lng);
      if (locationEl) locationEl.textContent = instantLocation;

      // 2. Consulta enriquecida asíncrona debounced
      clearTimeout(reverseGeoDebounce);
      reverseGeoDebounce = setTimeout(async () => {
        try {
          const res = await fetch(`/Home/ReverseGeocode?lat=${latlng.lat.toFixed(4)}&lon=${latlng.lng.toFixed(4)}`);
          if (res.ok) {
            const data = await res.json();
            if (data && data.location && locationEl) {
              locationEl.textContent = data.location;
            }
          }
        } catch (e) {
          // Mantiene la ubicación instantánea
        }
      }, 300);

      // 3. Detección de proximidad a huracanes
      let nearbyHurricane = null;
      let minDistance = 9999;
      for (const h of trackedHurricanes) {
        const dist = WmMath.distanceKm(latlng.lat, latlng.lng, h.latitude, h.longitude);
        if (dist < 420 && dist < minDistance) {
          minDistance = dist;
          nearbyHurricane = h;
        }
      }

      if (nearbyHurricane && cycloneAlertEl && cycloneAlertText) {
        cycloneAlertEl.classList.remove('d-none');
        if (minDistance < 45) {
          cycloneAlertText.textContent = `¡EN EL OJO! ${nearbyHurricane.name} (${nearbyHurricane.category}) - ${nearbyHurricane.maxWindsKmh} km/h`;
        } else {
          cycloneAlertText.textContent = `A ${Math.round(minDistance)} km de ${nearbyHurricane.name} (${nearbyHurricane.category})`;
        }
      } else if (cycloneAlertEl) {
        cycloneAlertEl.classList.add('d-none');
      }

      // 4. Métricas de viento
      coordsEl.textContent = `${Math.abs(latlng.lat).toFixed(2)}° ${latlng.lat >= 0 ? 'N' : 'S'}, ${Math.abs(WmMath.normalizeLng(latlng.lng)).toFixed(2)}° ${latlng.lng >= 0 ? 'E' : 'O'}`;
      speedEl.textContent = sample.speed.toFixed(0);
      speedEl.style.color = color.hex;

      arrowEl.style.transform = `rotate(${blowTo}deg)`;
      arrowEl.style.color = color.hex;

      cardinalEl.textContent = `${cardinal} (${sample.direction}°)`;
      degreesEl.textContent = `sopla hacia ${WmMath.getCardinal(blowTo)}`;

      const curDate = new Date(baseDate.getTime() + currentHour * 3600 * 1000);
      timeEl.textContent = `${curDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} ${String(curDate.getHours()).padStart(2, '0')}:00`;

      scaleEl.textContent = color.label;
      scaleEl.style.background = color.hex;

      // Posicionamiento de la tarjeta
      if (pt) {
        let x = pt.x + 16, y = pt.y + 16;
        const wrapRect = mapEl.getBoundingClientRect();
        if (x + 280 > wrapRect.width) x = pt.x - 290;
        if (y + 180 > wrapRect.height) y = pt.y - 190;
        tooltip.style.left = `${Math.max(10, x)}px`;
        tooltip.style.top = `${Math.max(76, y)}px`;
      }
      tooltip.classList.remove('d-none');
    }

    function inspectCurrentPoint() {
      if (lastLatLng && tooltip && !tooltip.classList.contains('d-none')) {
        const pt = map.latLngToContainerPoint(lastLatLng);
        inspect(lastLatLng, pt);
      }
    }

    map.on('mousemove', (e) => inspect(e.latlng, e.containerPoint));
    map.on('click', (e) => inspect(e.latlng, e.containerPoint));
    document.getElementById('windCloseTooltip')?.addEventListener('click', (e) => {
      e.stopPropagation();
      tooltip?.classList.add('d-none');
    });

    // 6. Actualización de cuadrícula ante zoom y movimiento
    async function refreshGrid() {
      await service.loadGrid(map.getBounds());
      inspectCurrentPoint();
    }

    map.on('moveend zoomend', refreshGrid);
    map.on('zoomstart', () => engine.clear());
    window.addEventListener('resize', () => {
      map.invalidateSize();
      engine.resize();
    });

    // 7. Buscador de Ciudades
    const searchInput = document.getElementById('windCitySearch');
    const searchDropdown = document.getElementById('windSearchResults');
    let searchDebounce = null;

    searchInput?.addEventListener('input', () => {
      const q = searchInput.value.trim();
      clearTimeout(searchDebounce);
      if (q.length < 2) {
        if (searchDropdown) searchDropdown.classList.add('d-none');
        return;
      }
      searchDebounce = setTimeout(async () => {
        try {
          const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=es&format=json`);
          const data = await res.json();
          if (!data.results || !searchDropdown) return;
          searchDropdown.innerHTML = '';
          data.results.forEach((city) => {
            const item = document.createElement('div');
            item.className = 'wind-search-item';
            item.innerHTML = `
              <div>
                <div class="wind-search-main">${city.name}</div>
                <div class="wind-search-sub">${[city.admin1, city.country].filter(Boolean).join(', ')}</div>
              </div>
              <i class="bi bi-geo-alt text-info"></i>
            `;
            item.addEventListener('click', () => {
              searchInput.value = `${city.name}, ${city.country || ''}`;
              searchDropdown.classList.add('d-none');
              map.flyTo([city.latitude, city.longitude], 8, { duration: 1.6 });
            });
            searchDropdown.appendChild(item);
          });
          searchDropdown.classList.remove('d-none');
        } catch (e) {
          console.warn(e);
        }
      }, 300);
    });

    document.addEventListener('click', (e) => {
      if (searchDropdown && !searchDropdown.contains(e.target) && e.target !== searchInput) {
        searchDropdown.classList.add('d-none');
      }
    });

    // 8. Controles de cabecera
    document.getElementById('windToggleParticles')?.addEventListener('change', (e) => {
      engine.enabled = e.target.checked;
      if (!engine.enabled) engine.clear();
    });

    document.getElementById('windLayerSelect')?.addEventListener('change', (e) => {
      const selected = e.target.value;
      if (baseLayers[selected]) {
        map.removeLayer(activeLayer);
        activeLayer = baseLayers[selected].addTo(map);
        map.invalidateSize();
      }
    });

    document.getElementById('windBtnLocate')?.addEventListener('click', () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          map.flyTo([pos.coords.latitude, pos.coords.longitude], 8);
        });
      }
    });

    document.getElementById('windBtnFullscreen')?.addEventListener('click', () => {
      const wrapper = document.querySelector('.wind-section-wrapper');
      if (!document.fullscreenElement) {
        wrapper?.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    });

    document.getElementById('windBtnZoomIn')?.addEventListener('click', () => map.zoomIn());
    document.getElementById('windBtnZoomOut')?.addEventListener('click', () => map.zoomOut());

    // Carga inicial de datos
    updateTimeUI();
    refreshGrid();
    engine.start();
  }

  document.addEventListener('DOMContentLoaded', initWindMapPage);
})();
