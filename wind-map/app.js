/**
 * ==============================================================================
 * WindMap - Mapa de Viento Animado en Tiempo Real (MSN & Windy Style)
 * ------------------------------------------------------------------------------
 * Aplicación web en JavaScript Vanilla que visualiza vectores de viento (U, V)
 * en una cuadrícula interpolada bilinealmente sobre un lienzo <canvas> animado
 * con partículas y estelas fluidas sobre Leaflet.js y la API gratuita Open-Meteo.
 * ==============================================================================
 */

'use strict';

/* ==============================================================================
   1. CONFIGURACIÓN Y CONSTANTES GLOBALES
   ============================================================================== */
const CONFIG = {
  // Coordenadas iniciales del mapa (Vista panorámica atlántica / Europa / América)
  initialView: {
    lat: 36.5,
    lng: -30.0,
    zoom: 4,
    minZoom: 2,
    maxZoom: 16
  },
  
  // Resolución de la cuadrícula de muestreo Open-Meteo (8x8 = 64 puntos)
  grid: {
    rows: 8,
    cols: 8,
    paddingPercent: 0.15 // Margen de seguridad fuera del viewport visible
  },

  // Parámetros del motor de simulación de partículas
  particles: {
    baseCount: 3200,      // Cantidad base de partículas para pantallas estándar
    maxAge: 75,           // Tiempo de vida en fotogramas antes de renacer
    speedScale: 0.85,     // Factor multiplicador de desplazamiento por velocidad
    lineWidth: 1.8,       // Grosor de la estela
    fadeFactor: 0.075     // Tasa de desvanecimiento de estelas (destination-out alpha)
  },

  // Escala cromática de velocidad de viento según especificaciones MSN (km/h)
  // 0-10 Azul, 10-20 Turquesa, 20-35 Verde, 35-55 Amarillo, 55-70 Naranja, 70-100+ Rojo
  colorScale: [
    { speed: 0,   rgb: [59, 130, 246], hex: '#3b82f6', label: 'Brisa ligera' },
    { speed: 10,  rgb: [6, 182, 212],  hex: '#06b6d4', label: 'Brisa suave' },
    { speed: 20,  rgb: [16, 185, 129], hex: '#10b981', label: 'Viento moderado' },
    { speed: 35,  rgb: [234, 179, 8],  hex: '#eab308', label: 'Viento fuerte' },
    { speed: 55,  rgb: [249, 115, 22], hex: '#f97316', label: 'Muy fuerte' },
    { speed: 70,  rgb: [239, 68, 68],  hex: '#ef4444', label: 'Temporal duro' },
    { speed: 100, rgb: [190, 18, 60],  hex: '#be123c', label: 'Huracán / Tormenta' }
  ],

  // Endpoints oficiales de la API gratuita Open-Meteo
  api: {
    forecastUrl: 'https://api.open-meteo.com/v1/forecast',
    geocodingUrl: 'https://geocoding-api.open-meteo.com/v1/search',
    debounceMoveMs: 400
  }
};

/* ==============================================================================
   2. UTILIDADES MATEMÁTICAS Y DE COLOR
   ============================================================================== */
class MathUtils {
  /**
   * Normaliza una longitud al rango estándar [-180, 180]
   */
  static normalizeLng(lng) {
    return ((((lng + 180) % 360) + 360) % 360) - 180;
  }

  /**
   * Limita un número entre un mínimo y un máximo
   */
  static clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  /**
   * Convierte velocidad (km/h) y dirección meteorológica (grados, de dónde viene)
   * a componentes vectoriales físicos hacia donde se mueve el aire:
   *   u: componente horizontal (Oeste -> Este positivo)
   *   v: componente vertical (Sur -> Norte positivo)
   */
  static polarToVector(speed, directionDeg) {
    const rad = (directionDeg * Math.PI) / 180;
    const u = -speed * Math.sin(rad);
    const v = -speed * Math.cos(rad);
    return { u, v };
  }

  /**
   * Convierte componentes vectoriales (u, v) a velocidad y dirección meteorológica
   */
  static vectorToPolar(u, v) {
    const speed = Math.hypot(u, v);
    const deg = (Math.atan2(-u, -v) * (180 / Math.PI) + 360) % 360;
    return { speed, direction: deg };
  }

  /**
   * Obtiene la dirección cardinal en español (16 rumbos)
   */
  static getCardinalDirection(deg) {
    const directions = [
      'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
      'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'
    ];
    const index = Math.round(((deg % 360) / 22.5)) % 16;
    return directions[index];
  }

  /**
   * Interpolación lineal suave entre dos valores
   */
  static lerp(a, b, t) {
    return a + (b - a) * t;
  }
}

class ColorRamp {
  /**
   * Devuelve un objeto de color { r, g, b, hex, label } interpolado para la velocidad dada
   */
  static getColor(speed) {
    const scale = CONFIG.colorScale;
    if (speed <= scale[0].speed) {
      const c = scale[0];
      return { r: c.rgb[0], g: c.rgb[1], b: c.rgb[2], hex: c.hex, label: c.label };
    }
    if (speed >= scale[scale.length - 1].speed) {
      const c = scale[scale.length - 1];
      return { r: c.rgb[0], g: c.rgb[1], b: c.rgb[2], hex: c.hex, label: c.label };
    }

    for (let i = 0; i < scale.length - 1; i++) {
      const s0 = scale[i];
      const s1 = scale[i + 1];
      if (speed >= s0.speed && speed <= s1.speed) {
        const t = (speed - s0.speed) / (s1.speed - s0.speed);
        const r = Math.round(MathUtils.lerp(s0.rgb[0], s1.rgb[0], t));
        const g = Math.round(MathUtils.lerp(s0.rgb[1], s1.rgb[1], t));
        const b = Math.round(MathUtils.lerp(s0.rgb[2], s1.rgb[2], t));
        const label = t < 0.5 ? s0.label : s1.label;
        return {
          r, g, b,
          hex: `rgb(${r}, ${g}, ${b})`,
          label
        };
      }
    }
    return { r: 59, g: 130, b: 246, hex: '#3b82f6', label: 'Brisa' };
  }
}

/* ==============================================================================
   3. MODELO DE CUADRÍCULA E INTERPOLACIÓN BILINEAL
   ============================================================================== */
class WindGrid {
  constructor(bounds, rows, cols) {
    this.latMin = bounds.latMin;
    this.latMax = bounds.latMax;
    this.lngMin = bounds.lngMin;
    this.lngMax = bounds.lngMax;
    this.rows = rows;
    this.cols = cols;
    this.dLat = (this.latMax - this.latMin) / Math.max(1, rows - 1);
    this.dLng = (this.lngMax - this.lngMin) / Math.max(1, cols - 1);
    
    // Matriz de puntos de pronóstico: [row][col] => { hourly: { wind_speed_10m: [], wind_direction_10m: [] } }
    this.matrix = [];
    for (let r = 0; r < rows; r++) {
      this.matrix[r] = new Array(cols).fill(null);
    }
  }

  /**
   * Asigna los datos obtenidos de la API a la celda [r][c]
   */
  setCell(r, c, forecastData) {
    if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
      this.matrix[r][c] = forecastData;
    }
  }

  /**
   * Muestreo con interpolación bilineal de velocidad y dirección en cualquier lat/lng
   * @param {number} lat - Latitud geográfica
   * @param {number} lng - Longitud geográfica
   * @param {number} hourIndex - Índice de la hora seleccionada (0 a 167)
   */
  sample(lat, lng, hourIndex) {
    // Normalizar longitud y acotar latitud
    lat = MathUtils.clamp(lat, -85, 85);
    lng = MathUtils.normalizeLng(lng);

    // Si la cuadrícula cruza el antimeridiano (lngMax < lngMin)
    let lngMin = this.lngMin;
    let lngMax = this.lngMax;
    let normalizedLng = lng;
    if (lngMax < lngMin) {
      lngMax += 360;
      if (normalizedLng < lngMin) normalizedLng += 360;
    }

    // Coordenadas fraccionarias dentro de la cuadrícula
    const gy = (lat - this.latMin) / (this.dLat || 1);
    const gx = (normalizedLng - lngMin) / (this.dLng || 1);

    // Acotar índices para interpolación entre celdas adyacentes
    const cgy = MathUtils.clamp(gy, 0, this.rows - 2);
    const cgx = MathUtils.clamp(gx, 0, this.cols - 2);

    const r0 = Math.floor(cgy);
    const r1 = r0 + 1;
    const c0 = Math.floor(cgx);
    const c1 = c0 + 1;

    const fy = cgy - r0;
    const fx = cgx - c0;

    // Obtener valores en los 4 nodos adyacentes
    const v00 = this.getCellVector(r0, c0, hourIndex, lat, lng);
    const v10 = this.getCellVector(r0, c1, hourIndex, lat, lng);
    const v01 = this.getCellVector(r1, c0, hourIndex, lat, lng);
    const v11 = this.getCellVector(r1, c1, hourIndex, lat, lng);

    // Interpolación bilineal de U y V
    const uTop = MathUtils.lerp(v00.u, v10.u, fx);
    const uBottom = MathUtils.lerp(v01.u, v11.u, fx);
    const u = MathUtils.lerp(uTop, uBottom, fy);

    const vTop = MathUtils.lerp(v00.v, v10.v, fx);
    const vBottom = MathUtils.lerp(v01.v, v11.v, fx);
    const v = MathUtils.lerp(vTop, vBottom, fy);

    const polar = MathUtils.vectorToPolar(u, v);
    return {
      u,
      v,
      speed: Math.round(polar.speed * 10) / 10,
      direction: Math.round(polar.direction)
    };
  }

  /**
   * Extrae o simula el vector (u, v) para una celda dada
   */
  getCellVector(r, c, hourIndex, fallbackLat, fallbackLng) {
    const cell = this.matrix[r] && this.matrix[r][c];
    if (cell && cell.hourly && cell.hourly.wind_speed_10m && cell.hourly.wind_speed_10m[hourIndex] !== undefined) {
      const spd = cell.hourly.wind_speed_10m[hourIndex] ?? 0;
      const dir = cell.hourly.wind_direction_10m[hourIndex] ?? 0;
      return MathUtils.polarToVector(spd, dir);
    }
    // Modelo atmosférico de respaldo continuo (trade winds & westerlies)
    return WindGrid.getSyntheticAtmosphereVector(fallbackLat, fallbackLng, hourIndex);
  }

  /**
   * Modelo físico sintético continuo de respaldo atmosférico en caso de corte o retardo de red
   */
  static getSyntheticAtmosphereVector(lat, lng, hourIndex = 0) {
    const latRad = (lat * Math.PI) / 180;
    const lngRad = (lng * Math.PI) / 180;
    const timeShift = hourIndex * 0.05;

    // Vientos zonales (Alisios del este en trópicos, vientos del oeste en latitudes medias)
    let zonalU = -25 * Math.sin(latRad * 2) + 10 * Math.sin(lngRad * 3 + timeShift);
    let zonalV = 6 * Math.cos(lngRad * 2 + timeShift);

    // Vórtices ciclónicos naturales
    const vortexX = Math.sin(lngRad * 4 + timeShift) * 12;
    const vortexY = Math.cos(latRad * 3) * 8;

    const u = zonalU + vortexX;
    const v = zonalV + vortexY;
    return { u, v };
  }
}

/* ==============================================================================
   4. SERVICIO DE DATOS Y CACHÉ OPEN-METEO
   ============================================================================== */
class OpenMeteoService {
  constructor() {
    this.cache = new Map(); // Llave: bounding box aproximado -> WindGrid
    this.activeGrid = null;
    this.debounceTimer = null;
    this.isLoading = false;
    this.onStatusChange = null;
  }

  /**
   * Genera una clave de caché basada en las esquinas del área visible
   */
  generateCacheKey(bounds) {
    const s = bounds.getSouth().toFixed(1);
    const n = bounds.getNorth().toFixed(1);
    const w = bounds.getWest().toFixed(1);
    const e = bounds.getEast().toFixed(1);
    return `${s}_${n}_${w}_${e}`;
  }

  /**
   * Solicita el pronóstico de 7 días para la cuadrícula del área visible
   */
  async loadGrid(bounds, force = false) {
    clearTimeout(this.debounceTimer);

    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        const south = bounds.getSouth();
        const north = bounds.getNorth();
        const west = bounds.getWest();
        const east = bounds.getEast();

        // Expansión con padding para evitar bordes vacíos durante el arrastre
        const latPad = (north - south) * CONFIG.grid.paddingPercent;
        const lngPad = (east - west) * CONFIG.grid.paddingPercent;

        const latMin = Math.max(-80, south - latPad);
        const latMax = Math.min(80, north + latPad);
        const lngMin = west - lngPad;
        const lngMax = east + lngPad;

        const gridBounds = { latMin, latMax, lngMin, lngMax };
        const rows = CONFIG.grid.rows;
        const cols = CONFIG.grid.cols;

        const cacheKey = this.generateCacheKey(bounds);
        if (!force && this.cache.has(cacheKey)) {
          this.activeGrid = this.cache.get(cacheKey);
          if (this.onStatusChange) this.onStatusChange('cached');
          return resolve(this.activeGrid);
        }

        // Construcción de la lista de coordenadas para consulta masiva
        const lats = [];
        const lngs = [];
        const dLat = (latMax - latMin) / (rows - 1);
        const dLng = (lngMax - lngMin) / (cols - 1);

        for (let r = 0; r < rows; r++) {
          const latVal = latMin + r * dLat;
          for (let c = 0; c < cols; c++) {
            const lngVal = MathUtils.normalizeLng(lngMin + c * dLng);
            lats.push(latVal.toFixed(2));
            lngs.push(lngVal.toFixed(2));
          }
        }

        const url = `${CONFIG.api.forecastUrl}?latitude=${lats.join(',')}&longitude=${lngs.join(',')}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&forecast_days=7`;

        try {
          if (this.onStatusChange) this.onStatusChange('loading');
          this.isLoading = true;

          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Open-Meteo HTTP error ${response.status}`);
          }

          const rawData = await response.json();
          // Si es un único punto devuelve un objeto; si son varios devuelve un array
          const resultsArray = Array.isArray(rawData) ? rawData : [rawData];

          const newGrid = new WindGrid(gridBounds, rows, cols);
          let pointIndex = 0;

          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (pointIndex < resultsArray.length) {
                newGrid.setCell(r, c, resultsArray[pointIndex]);
                pointIndex++;
              }
            }
          }

          // Almacenar en caché y limitar tamaño a 15 entradas recientes
          if (this.cache.size >= 15) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
          }
          this.cache.set(cacheKey, newGrid);

          this.activeGrid = newGrid;
          this.isLoading = false;
          if (this.onStatusChange) this.onStatusChange('success');
          resolve(this.activeGrid);
        } catch (err) {
          console.warn('Fallo al consultar Open-Meteo, utilizando modelo atmosférico sintético:', err);
          this.isLoading = false;
          
          // Crear cuadrícula sintética si la red falla
          const fallbackGrid = new WindGrid(gridBounds, rows, cols);
          this.activeGrid = fallbackGrid;
          if (this.onStatusChange) this.onStatusChange('synthetic');
          resolve(fallbackGrid);
        }
      }, CONFIG.api.debounceMoveMs);
    });
  }
}

/* ==============================================================================
   5. MOTOR DE SIMULACIÓN DE PARTÍCULAS (HTML5 CANVAS)
   ============================================================================== */
class ParticleEngine {
  constructor(canvas, map, openMeteoService) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: false });
    this.map = map;
    this.service = openMeteoService;

    this.particles = [];
    this.isRunning = true;
    this.isEnabled = true;
    this.animFrameId = null;
    this.currentHour = 0;

    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    this.initCanvasSize();
    this.initParticles();
  }

  /**
   * Sincroniza las dimensiones del canvas con la resolución del dispositivo y ventana
   */
  initCanvasSize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
  }

  /**
   * Genera el conjunto inicial de partículas aleatorias
   */
  initParticles() {
    // Escala la densidad de partículas según el área en pantalla
    const areaFactor = (this.width * this.height) / (1920 * 1080);
    const count = Math.round(CONFIG.particles.baseCount * Math.max(0.6, areaFactor));
    
    this.particles = new Array(count);
    for (let i = 0; i < count; i++) {
      this.particles[i] = this.createParticle();
    }
  }

  createParticle() {
    return {
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      age: Math.floor(Math.random() * CONFIG.particles.maxAge),
      maxAge: CONFIG.particles.maxAge + Math.floor(Math.random() * 20),
      speed: 0
    };
  }

  /**
   * Reinicia una partícula fuera de límites o expirada
   */
  resetParticle(p) {
    p.x = Math.random() * this.width;
    p.y = Math.random() * this.height;
    p.age = 0;
    p.maxAge = CONFIG.particles.maxAge + Math.floor(Math.random() * 20);
    p.speed = 0;
  }

  /**
   * Establece la hora del pronóstico actual (0 a 167)
   */
  setHour(hourIndex) {
    this.currentHour = hourIndex;
  }

  /**
   * Alterna la visibilidad de la animación de partículas
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  /**
   * Limpia el canvas por completo
   */
  clear() {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  /**
   * Inicia el ciclo continuo de animación
   */
  start() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.isRunning = true;
    const loop = () => {
      if (this.isRunning) {
        this.renderFrame();
        this.animFrameId = requestAnimationFrame(loop);
      }
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  /**
   * Detiene el ciclo de animación
   */
  stop() {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /**
   * Ejecuta un fotograma de simulación
   */
  renderFrame() {
    if (!this.isEnabled) return;

    const ctx = this.ctx;
    const grid = this.service.activeGrid;

    // Efecto de desvanecimiento de estela mediante destination-out
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0, 0, 0, ${CONFIG.particles.fadeFactor})`;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();

    if (!grid) return;

    const zoom = this.map.getZoom();
    // Factor de desplazamiento que escala sutilmente con el nivel de zoom
    const zoomScale = Math.pow(1.15, zoom - 4) * CONFIG.particles.speedScale * 0.12;

    ctx.lineWidth = CONFIG.particles.lineWidth;
    ctx.lineCap = 'round';

    const particles = this.particles;
    const len = particles.length;

    for (let i = 0; i < len; i++) {
      const p = particles[i];

      if (p.age >= p.maxAge || p.x < 0 || p.x > this.width || p.y < 0 || p.y > this.height) {
        this.resetParticle(p);
      }

      // Convertir coordenada de pantalla a latitud/longitud en Leaflet
      const latLng = this.map.containerPointToLatLng([p.x, p.y]);
      const sample = grid.sample(latLng.lat, latLng.lng, this.currentHour);

      if (!sample || sample.speed === 0) {
        p.age += 2;
        continue;
      }

      // Movimiento vectorial: u desplaza en X (Este), -v desplaza en Y (Norte hacia arriba de pantalla)
      const dx = sample.u * zoomScale;
      const dy = -sample.v * zoomScale;

      const nextX = p.x + dx;
      const nextY = p.y + dy;

      // Color dinámico según la escala MSN
      const color = ColorRamp.getColor(sample.speed);

      ctx.beginPath();
      ctx.strokeStyle = color.hex;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nextX, nextY);
      ctx.stroke();

      p.x = nextX;
      p.y = nextY;
      p.speed = sample.speed;
      p.age++;
    }
  }

  /**
   * Maneja el redimensionamiento de pantalla y zoom
   */
  resize() {
    this.initCanvasSize();
    this.initParticles();
    this.clear();
  }
}

/* ==============================================================================
   6. CONTROLADOR DE LA LÍNEA DE TIEMPO (7 DÍAS / 168 HORAS)
   ============================================================================== */
class TimelineController {
  constructor(particleEngine, onHourChanged) {
    this.engine = particleEngine;
    this.onHourChanged = onHourChanged;

    this.currentHour = 0;
    this.isPlaying = false;
    this.playSpeedMultiplier = 1; // 1x, 2x, 4x
    this.playTimer = null;
    this.baseIntervalMs = 700;

    this.baseDate = new Date();
    // Alinear al inicio de la hora actual
    this.baseDate.setMinutes(0, 0, 0);

    this.initDOMElements();
    this.initDayTabs();
    this.bindEvents();
    this.updateDisplay();
  }

  initDOMElements() {
    this.slider = document.getElementById('timeline-slider');
    this.sliderFill = document.getElementById('slider-fill');
    this.btnPlay = document.getElementById('btn-play');
    this.playIcon = document.getElementById('play-icon');
    this.btnPrev = document.getElementById('btn-prev-hour');
    this.btnNext = document.getElementById('btn-next-hour');
    this.btnNow = document.getElementById('btn-now');
    this.timePrimary = document.getElementById('time-display-primary');
    this.timeRelative = document.getElementById('time-display-relative');
    this.dayTabsContainer = document.getElementById('day-tabs-container');
    this.speedButtons = document.querySelectorAll('.btn-speed');
  }

  /**
   * Genera los 7 botones de día (Hoy, D+1, D+2, ... D+6)
   */
  initDayTabs() {
    this.dayTabsContainer.innerHTML = '';
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const d = new Date(this.baseDate.getTime() + dayOffset * 24 * 3600 * 1000);
      const isToday = dayOffset === 0;
      const tab = document.createElement('div');
      tab.className = `day-tab ${isToday ? 'active' : ''}`;
      tab.dataset.dayOffset = dayOffset;

      const name = isToday ? 'Hoy' : dayNames[d.getDay()];
      const dateNum = `${d.getDate()} ${d.toLocaleString('es-ES', { month: 'short' })}`;

      tab.innerHTML = `
        <span class="day-tab-name">${name}</span>
        <span class="day-tab-date">${dateNum}</span>
      `;

      tab.addEventListener('click', () => {
        // Al hacer clic en un día, situar en las 12:00 del mediodía de ese día (o en la hora actual si es hoy)
        const targetHour = isToday ? 0 : dayOffset * 24 + 12;
        this.setHour(targetHour);
      });

      this.dayTabsContainer.appendChild(tab);
    }
  }

  bindEvents() {
    // Control deslizante
    this.slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.setHour(val, false);
    });

    // Botón Reproducir / Pausa
    this.btnPlay.addEventListener('click', () => this.togglePlay());

    // Botones de paso hora a hora
    this.btnPrev.addEventListener('click', () => this.stepHour(-1));
    this.btnNext.addEventListener('click', () => this.stepHour(1));

    // Botón AHORA
    this.btnNow.addEventListener('click', () => this.setHour(0));

    // Multiplicador de velocidad de reproducción (1x, 2x, 4x)
    this.speedButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.speedButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.playSpeedMultiplier = parseInt(btn.dataset.speed, 10);
        if (this.isPlaying) {
          this.restartPlayLoop();
        }
      });
    });

    // Atajos de teclado para la línea de tiempo
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.stepHour(1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.stepHour(-1);
      }
    });
  }

  /**
   * Cambia la hora activa en el pronóstico
   */
  setHour(hourIndex, updateSlider = true) {
    hourIndex = MathUtils.clamp(hourIndex, 0, 167);
    this.currentHour = hourIndex;
    if (updateSlider) {
      this.slider.value = hourIndex;
    }

    this.engine.setHour(hourIndex);
    this.updateDisplay();

    if (this.onHourChanged) {
      this.onHourChanged(this.currentHour, this.getCurrentDate());
    }
  }

  stepHour(delta) {
    let next = this.currentHour + delta;
    if (next > 167) next = 0;
    if (next < 0) next = 167;
    this.setHour(next);
  }

  togglePlay() {
    this.isPlaying = !this.isPlaying;
    if (this.isPlaying) {
      this.playIcon.classList.replace('bi-play-fill', 'bi-pause-fill');
      this.btnPlay.title = 'Pausar (Espacio)';
      this.startPlayLoop();
    } else {
      this.playIcon.classList.replace('bi-pause-fill', 'bi-play-fill');
      this.btnPlay.title = 'Reproducir (Espacio)';
      this.stopPlayLoop();
    }
  }

  startPlayLoop() {
    this.stopPlayLoop();
    const interval = Math.max(120, this.baseIntervalMs / this.playSpeedMultiplier);
    this.playTimer = setInterval(() => {
      this.stepHour(1);
    }, interval);
  }

  restartPlayLoop() {
    this.startPlayLoop();
  }

  stopPlayLoop() {
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
  }

  getCurrentDate() {
    return new Date(this.baseDate.getTime() + this.currentHour * 3600 * 1000);
  }

  /**
   * Actualiza los textos y la barra de progreso de la interfaz
   */
  updateDisplay() {
    const curDate = this.getCurrentDate();
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    const dayName = dayNames[curDate.getDay()];
    const dayNum = curDate.getDate();
    const month = monthNames[curDate.getMonth()];
    const hours = String(curDate.getHours()).padStart(2, '0');
    const mins = '00';

    this.timePrimary.textContent = `${dayName}, ${dayNum} de ${month} — ${hours}:${mins}`;

    if (this.currentHour === 0) {
      this.timeRelative.textContent = 'Ahora';
      this.timeRelative.style.background = 'rgba(56, 189, 248, 0.2)';
    } else {
      this.timeRelative.textContent = `+${this.currentHour}h pronóstico`;
      this.timeRelative.style.background = 'rgba(16, 185, 129, 0.2)';
    }

    // Porcentaje de la barra de progreso
    const percent = (this.currentHour / 167) * 100;
    this.sliderFill.style.width = `${percent}%`;

    // Resaltar la pestaña del día correspondiente
    const activeDayOffset = Math.floor(this.currentHour / 24);
    const tabs = this.dayTabsContainer.querySelectorAll('.day-tab');
    tabs.forEach((tab, index) => {
      if (index === activeDayOffset) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  }
}

/* ==============================================================================
   7. CONTROLADOR DEL BUSCADOR DE CIUDADES (GEOCODING)
   ============================================================================== */
class GeocodingController {
  constructor(map, onCitySelect) {
    this.map = map;
    this.onCitySelect = onCitySelect;
    this.input = document.getElementById('city-search');
    this.btnClear = document.getElementById('btn-clear-search');
    this.dropdown = document.getElementById('search-results');
    this.debounceTimer = null;

    this.bindEvents();
  }

  bindEvents() {
    this.input.addEventListener('input', () => {
      const query = this.input.value.trim();
      if (query.length > 0) {
        this.btnClear.classList.remove('hidden');
      } else {
        this.btnClear.classList.add('hidden');
        this.closeDropdown();
        return;
      }

      clearTimeout(this.debounceTimer);
      if (query.length < 2) {
        this.closeDropdown();
        return;
      }

      this.debounceTimer = setTimeout(() => this.search(query), 320);
    });

    this.btnClear.addEventListener('click', () => {
      this.input.value = '';
      this.btnClear.classList.add('hidden');
      this.closeDropdown();
      this.input.focus();
    });

    // Cerrar sugerencias al hacer clic fuera
    document.addEventListener('click', (e) => {
      if (!this.input.contains(e.target) && !this.dropdown.contains(e.target)) {
        this.closeDropdown();
      }
    });

    // Navegación con teclado en el buscador
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeDropdown();
      }
    });
  }

  async search(query) {
    const url = `${CONFIG.api.geocodingUrl}?name=${encodeURIComponent(query)}&count=5&language=es&format=json`;

    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();

      if (!data.results || data.results.length === 0) {
        this.showNoResults();
        return;
      }

      this.renderResults(data.results);
    } catch (err) {
      console.warn('Error al buscar ciudades:', err);
    }
  }

  renderResults(results) {
    this.dropdown.innerHTML = '';
    results.forEach((city) => {
      const item = document.createElement('div');
      item.className = 'search-dropdown-item';

      const region = [city.admin1, city.country].filter(Boolean).join(', ');

      item.innerHTML = `
        <div>
          <div class="search-item-main">${city.name}</div>
          <div class="search-item-sub">${region}</div>
        </div>
        <div class="search-item-sub">
          <i class="bi bi-geo-alt"></i>
        </div>
      `;

      item.addEventListener('click', () => {
        this.selectCity(city);
      });

      this.dropdown.appendChild(item);
    });

    this.dropdown.classList.remove('hidden');
  }

  showNoResults() {
    this.dropdown.innerHTML = `
      <div class="search-dropdown-empty">
        No se encontraron ciudades coincidentes
      </div>
    `;
    this.dropdown.classList.remove('hidden');
  }

  selectCity(city) {
    this.input.value = `${city.name}, ${city.country || ''}`;
    this.closeDropdown();

    // Vuelo cinematográfico fluido hacia la ciudad
    this.map.flyTo([city.latitude, city.longitude], 9, {
      duration: 1.8,
      easeLinearity: 0.25
    });

    if (this.onCitySelect) {
      this.onCitySelect(city);
    }
  }

  closeDropdown() {
    this.dropdown.classList.add('hidden');
    this.dropdown.innerHTML = '';
  }
}

/* ==============================================================================
   8. CONTROLADOR DE INSPECCIÓN Y TOOLTIP DINÁMICO
   ============================================================================== */
class TooltipController {
  constructor(map, openMeteoService, timelineController) {
    this.map = map;
    this.service = openMeteoService;
    this.timeline = timelineController;

    this.tooltipEl = document.getElementById('cursor-tooltip');
    this.coordsEl = document.getElementById('tooltip-coords');
    this.speedEl = document.getElementById('tooltip-speed');
    this.arrowEl = document.getElementById('tooltip-arrow');
    this.cardinalEl = document.getElementById('tooltip-cardinal');
    this.degreesEl = document.getElementById('tooltip-degrees');
    this.timeEl = document.getElementById('tooltip-time');
    this.scaleEl = document.getElementById('tooltip-scale');
    this.btnClose = document.getElementById('btn-close-tooltip');

    this.lastLatLng = null;
    this.pinned = false;

    this.bindEvents();
  }

  bindEvents() {
    // Al mover el ratón sobre el mapa
    this.map.on('mousemove', (e) => {
      if (this.pinned) return;
      this.inspectPoint(e.latlng, e.containerPoint);
    });

    // Al hacer clic en el mapa: anclar tooltip
    this.map.on('click', (e) => {
      this.pinned = true;
      this.inspectPoint(e.latlng, e.containerPoint);
    });

    // Cerrar tooltip
    this.btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
      this.pinned = false;
    });

    // Ocultar si el cursor sale del mapa
    this.map.getContainer().addEventListener('mouseleave', () => {
      if (!this.pinned) this.hide();
    });

    // Atajo Esc para desanclar
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.pinned = false;
        this.hide();
      }
    });
  }

  /**
   * Muestra las métricas de viento en el punto geográfico indicado
   */
  inspectPoint(latlng, containerPoint) {
    this.lastLatLng = latlng;
    const grid = this.service.activeGrid;
    if (!grid) return;

    const sample = grid.sample(latlng.lat, latlng.lng, this.timeline.currentHour);
    if (!sample) return;

    const color = ColorRamp.getColor(sample.speed);
    const cardinal = MathUtils.getCardinalDirection(sample.direction);

    // Formatear coordenadas legibles
    const latStr = `${Math.abs(latlng.lat).toFixed(2)}° ${latlng.lat >= 0 ? 'N' : 'S'}`;
    const lngNorm = MathUtils.normalizeLng(latlng.lng);
    const lngStr = `${Math.abs(lngNorm).toFixed(2)}° ${lngNorm >= 0 ? 'E' : 'O'}`;

    this.coordsEl.textContent = `${latStr}, ${lngStr}`;
    this.speedEl.textContent = sample.speed.toFixed(0);
    this.speedEl.style.color = color.hex;

    // La flecha rota indicando hacia dónde sopla el viento
    // (sample.direction es de dónde viene, hacia dónde sopla es +180°)
    const blowToAngle = (sample.direction + 180) % 360;
    this.arrowEl.style.transform = `rotate(${blowToAngle}deg)`;
    this.arrowEl.style.color = color.hex;

    this.cardinalEl.textContent = `${cardinal} (${sample.direction}°)`;
    this.degreesEl.textContent = `sopla hacia ${MathUtils.getCardinalDirection(blowToAngle)}`;

    const curDate = this.timeline.getCurrentDate();
    const hours = String(curDate.getHours()).padStart(2, '0');
    this.timeEl.textContent = `${curDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} ${hours}:00`;

    this.scaleEl.textContent = color.label;
    this.scaleEl.style.background = color.hex;

    // Posicionar la tarjeta flotante
    this.positionTooltip(containerPoint);
    this.tooltipEl.classList.remove('hidden');
  }

  positionTooltip(point) {
    const margin = 16;
    const tooltipWidth = 250;
    const tooltipHeight = 150;
    const mapRect = this.map.getContainer().getBoundingClientRect();

    let x = point.x + margin;
    let y = point.y + margin;

    // Evitar que se desborde por la derecha o por abajo
    if (x + tooltipWidth > mapRect.width - 20) {
      x = point.x - tooltipWidth - margin;
    }
    if (y + tooltipHeight > mapRect.height - 100) {
      y = point.y - tooltipHeight - margin;
    }

    this.tooltipEl.style.left = `${Math.max(10, x)}px`;
    this.tooltipEl.style.top = `${Math.max(80, y)}px`;
  }

  /**
   * Refresca el tooltip si la hora de pronóstico cambia
   */
  refresh() {
    if (this.lastLatLng && !this.tooltipEl.classList.contains('hidden')) {
      const containerPoint = this.map.latLngToContainerPoint(this.lastLatLng);
      this.inspectPoint(this.lastLatLng, containerPoint);
    }
  }

  hide() {
    this.tooltipEl.classList.add('hidden');
  }
}

/* ==============================================================================
   9. GESTOR PRINCIPAL DE LA APLICACIÓN (INIT & UI CONTROLLER)
   ============================================================================== */
class WindMapApp {
  constructor() {
    this.map = null;
    this.canvas = null;
    this.service = null;
    this.engine = null;
    this.timeline = null;
    this.geocoder = null;
    this.tooltip = null;
    this.baseLayers = {};
    this.currentBaseLayer = null;

    this.init();
  }

  async init() {
    this.initMap();
    this.initCanvasAndEngine();
    this.initControllers();
    this.bindUIEvents();

    // Carga inicial de datos de viento
    await this.updateWindGrid();

    // Iniciar bucle de partículas
    this.engine.start();
  }

  /**
   * Inicializa el mapa base Leaflet con controles desactivados por defecto
   */
  initMap() {
    this.map = L.map('map', {
      center: [CONFIG.initialView.lat, CONFIG.initialView.lng],
      zoom: CONFIG.initialView.zoom,
      minZoom: CONFIG.initialView.minZoom,
      maxZoom: CONFIG.initialView.maxZoom,
      zoomControl: false,      // Reemplazado por botones flotantes personalizados
      attributionControl: false // Personalizado para diseño limpio
    });

    // Definición de capas base (Oscuro, Satélite y OpenStreetMap)
    this.baseLayers = {
      'carto-dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19
      }),
      'esri-satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18
      }),
      'osm-standard': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      })
    };

    // Añadir capa CARTO Dark por defecto
    this.currentBaseLayer = this.baseLayers['carto-dark'].addTo(this.map);
  }

  /**
   * Inicializa el overlay Canvas y el motor de partículas
   */
  initCanvasAndEngine() {
    this.canvas = document.getElementById('particle-canvas');
    this.service = new OpenMeteoService();
    this.engine = new ParticleEngine(this.canvas, this.map, this.service);

    // Conectar eventos del servicio con el pill de estado
    const statusPill = document.getElementById('status-pill');
    const statusText = statusPill.querySelector('.status-text');

    this.service.onStatusChange = (status) => {
      statusPill.className = 'status-pill';
      if (status === 'loading') {
        statusText.textContent = 'Actualizando viento (Open-Meteo)...';
      } else if (status === 'success') {
        statusPill.classList.add('success');
        statusText.textContent = '● En vivo: Open-Meteo API (10m)';
      } else if (status === 'cached') {
        statusPill.classList.add('success');
        statusText.textContent = '● En caché: 168 horas listas';
      } else if (status === 'synthetic') {
        statusPill.classList.add('warning');
        statusText.textContent = 'Modo simulación meteorológica';
      }
    };
  }

  /**
   * Inicializa controladores de interfaz de usuario
   */
  initControllers() {
    // Línea de tiempo
    this.timeline = new TimelineController(this.engine, (hourIndex) => {
      if (this.tooltip) this.tooltip.refresh();
    });

    // Geocodificación y búsqueda
    this.geocoder = new GeocodingController(this.map);

    // Tooltip de inspección
    this.tooltip = new TooltipController(this.map, this.service, this.timeline);
  }

  /**
   * Vincula eventos de Leaflet, botones y atajos de teclado
   */
  bindUIEvents() {
    // Redimensionamiento de ventana
    window.addEventListener('resize', () => {
      this.engine.resize();
    });

    // Actualizar campo de viento al mover o hacer zoom en el mapa
    this.map.on('moveend zoomend', () => {
      this.updateWindGrid();
    });

    // Redibujar partículas durante zoom para fluidez
    this.map.on('zoomstart', () => {
      this.engine.clear();
    });

    // Checkbox "Animación de viento"
    const toggleParticles = document.getElementById('toggle-particles');
    toggleParticles.addEventListener('change', (e) => {
      this.engine.setEnabled(e.target.checked);
    });

    // Selector de capa base
    const layerSelect = document.getElementById('layer-select');
    layerSelect.addEventListener('change', (e) => {
      const selected = e.target.value;
      if (this.baseLayers[selected]) {
        this.map.removeLayer(this.currentBaseLayer);
        this.currentBaseLayer = this.baseLayers[selected].addTo(this.map);
      }
    });

    // Botones de Zoom
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      this.map.zoomIn();
    });
    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      this.map.zoomOut();
    });

    // Botón de Pantalla Completa
    const btnFullscreen = document.getElementById('btn-fullscreen');
    btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

    // Botón de geolocalización del usuario
    document.getElementById('btn-locate').addEventListener('click', () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            this.map.flyTo([pos.coords.latitude, pos.coords.longitude], 8);
          },
          (err) => {
            alert('No se pudo obtener la ubicación actual. Permiso denegado o no disponible.');
          }
        );
      }
    });

    // Modal de Información y Ayuda
    const infoModal = document.getElementById('info-modal');
    document.getElementById('btn-info').addEventListener('click', () => {
      infoModal.classList.remove('hidden');
    });
    document.getElementById('btn-close-modal').addEventListener('click', () => {
      infoModal.classList.add('hidden');
    });
    document.getElementById('btn-modal-ok').addEventListener('click', () => {
      infoModal.classList.add('hidden');
    });
    infoModal.addEventListener('click', (e) => {
      if (e.target === infoModal) infoModal.classList.add('hidden');
    });

    // Atajo de tecla 'F' para pantalla completa
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'f' || e.key === 'F') {
        this.toggleFullscreen();
      }
    });
  }

  /**
   * Descarga o recupera de la caché el campo de viento de la vista actual
   */
  async updateWindGrid() {
    const bounds = this.map.getBounds();
    await this.service.loadGrid(bounds);
    if (this.tooltip) this.tooltip.refresh();
  }

  /**
   * Alterna el modo de pantalla completa HTML5
   */
  toggleFullscreen() {
    const doc = document.documentElement;
    const btn = document.getElementById('btn-fullscreen');
    const icon = btn.querySelector('i');

    if (!document.fullscreenElement) {
      if (doc.requestFullscreen) {
        doc.requestFullscreen();
      } else if (doc.webkitRequestFullscreen) {
        doc.webkitRequestFullscreen();
      }
      icon.classList.replace('bi-arrows-fullscreen', 'bi-fullscreen-exit');
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      icon.classList.replace('bi-fullscreen-exit', 'bi-arrows-fullscreen');
    }
  }
}

// Inicialización de la aplicación cuando el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', () => {
  window.app = new WindMapApp();
});
