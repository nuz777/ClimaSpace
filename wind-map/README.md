# 💨 WindMap | Mapa de Viento Animado en Tiempo Real (Estilo MSN & Windy)

Aplicación web moderna, fluida y de alto rendimiento para la visualización interactiva y animada del campo de viento global en tiempo real y con pronóstico a 7 días. Desarrollada con **HTML5, CSS3 y JavaScript puro (Vanilla JS)**, sin necesidad obligatoria de backend ni dependencias pesadas de empaquetado.

Inspirada en la estética y funcionalidad de **MSN El Tiempo**, **Windy.com** y **Earth Nullschool**.

---

## 🌟 Características Principales

1. **Mapa Base Interactivo**:
   - Desarrollado sobre **Leaflet.js** con tiles oscuros de alto contraste (**CARTO Dark Matter**), capa satelital (**Esri World Imagery**) y mapa estándar (**OpenStreetMap**).
   - Control de zoom fluido, movimiento inercial y geolocalización del usuario.

2. **Datos Meteorológicos Reales (Open-Meteo API)**:
   - Consulta dinámica de la cuadrícula visible del mapa mediante la API pública y gratuita de [Open-Meteo](https://open-meteo.com/).
   - Obtención de las variables físicas `wind_speed_10m` (km/h) y `wind_direction_10m` (grados meteorológicos a 10 metros de altura).
   - Consulta masiva por lotes que descarga los **7 días completos (168 horas)** en una única petición por cuadrícula.

3. **Simulación de Partículas en `<canvas>`**:
   - Miles de partículas trazando líneas vectoriales que siguen con precisión la dirección y velocidad del viento local.
   - Descomposición vectorial trigonométrica:
     $$u = -\text{velocidad} \cdot \sin\left(\frac{\text{dirección} \cdot \pi}{180}\right)$$
     $$v = -\text{velocidad} \cdot \cos\left(\frac{\text{dirección} \cdot \pi}{180}\right)$$
   - Estelas continuas con desvanecimiento de persistencia visual utilizando operaciones compuestas (`destination-out`).
   - Densidad de partículas adaptativa según la resolución de pantalla y soporte para pantallas Retina/HiDPI (`window.devicePixelRatio`).

4. **Interpolación Bilineal**:
   - Cálculo en tiempo continuo de vectores $(u, v)$ en cualquier punto arbitrario de la pantalla mediante interpolación bilineal entre los nodos de la cuadrícula circundante.

5. **Escala Cromática Oficial de MSN El Tiempo**:
   - Degradado suave e interpolado entre los rangos:
     - **0 – 10 km/h**: Azul (`#3b82f6`) — *Brisa ligera*
     - **10 – 20 km/h**: Turquesa (`#06b6d4`) — *Brisa suave*
     - **20 – 35 km/h**: Verde (`#10b981`) — *Viento moderado*
     - **35 – 55 km/h**: Amarillo (`#eab308`) — *Viento fuerte*
     - **55 – 70 km/h**: Naranja (`#f97316`) — *Muy fuerte*
     - **70 – 100+ km/h**: Carmín / Rojo (`#ef4444` / `#be123c`) — *Temporal / Huracán*

6. **Línea de Tiempo Completa (7 Días / 168 Horas)**:
   - Barra inferior flotante con reproductor automático **Play / Pausa**.
   - Selector rápido con pestañas para cada uno de los **7 días** (*Hoy, D+1, D+2, ...*).
   - Control deslizante (*scrubber*) continuo con salto hora por hora.
   - Selector de velocidad de reproducción (1x, 2x, 4x) y botón "AHORA".

7. **Buscador de Ciudades (Geocodificación Open-Meteo)**:
   - Búsqueda predictiva con autocompletado en español que traslada la cámara con animación suave (`flyTo`) a cualquier ciudad del mundo (ej. *Madrid*, *Bogotá*, *Miami*, *Tokio*).

8. **Tooltip de Inspección al Cursor / Clic**:
   - Muestra velocidad exacta en km/h, rumbo cardinal (ej. *NNO (335°)*), fecha/hora y una flecha dinámica que rota en tiempo real hacia la dirección a la que sopla el viento.

9. **Rendimiento y Modo Resiliente**:
   - Animación impulsada por `requestAnimationFrame`.
   - Sistema de **caché LRU en memoria** para navegar y cambiar horas sin peticiones repetidas.
   - **Modelo atmosférico sintético continuo** como respaldo automático si no hay conexión a internet o se excede el límite de cuota.

---

## 📁 Estructura del Proyecto

```text
wind-map/
├── index.html       # Estructura semántica HTML5, controles flotantes y modal
├── style.css        # Diseño oscuro moderno, glassmorphism, responsive y paleta MSN
├── app.js           # Lógica JavaScript pura (Canvas, Leaflet, API, interpolación bilineal)
└── README.md        # Documentación técnica y guía de ejecución
```

---

## 🚀 Cómo Ejecutar la Aplicación

No se requiere ningún paso de compilación (`build`) ni instalación de paquetes (`npm install`). La aplicación se puede ejecutar de varias formas sencillas:

### Opción 1: Servidor local ligero con Python (Recomendado)
Desde la terminal, navega a la carpeta del proyecto y ejecuta:

```bash
# Python 3
cd wind-map
python3 -m http.server 8080
```
Luego abre tu navegador en: [http://localhost:8080](http://localhost:8080)

### Opción 2: Con Node.js (`npx serve` o `live-server`)
```bash
cd wind-map
npx serve .
```

### Opción 3: Abrir directamente en el navegador
Puedes hacer doble clic en el archivo `index.html` o abrirlo directamente en Google Chrome, Microsoft Edge, Mozilla Firefox o Safari:
```bash
# En Linux
xdg-open index.html
```

---

## ⌨️ Atajos de Teclado

| Tecla | Acción |
| :--- | :--- |
| <kbd>Espacio</kbd> | Reproducir / Pausar la animación de la línea de tiempo |
| <kbd>→</kbd> | Avanzar 1 hora en el pronóstico |
| <kbd>←</kbd> | Retroceder 1 hora en el pronóstico |
| <kbd>F</kbd> | Alternar modo de pantalla completa |
| <kbd>+</kbd> / <kbd>−</kbd> | Acercar o alejar el mapa |
| <kbd>Esc</kbd> | Desanclar tooltip o cerrar ventanas modales y sugerencias |

---

## 🛠️ Tecnologías y Recursos Externos

- **Leaflet.js** (v1.9.4): Visualización geoespacial cartográfica.
- **Open-Meteo Forecast API**: Datos meteorológicos globales libres y en tiempo real.
- **Open-Meteo Geocoding API**: Búsqueda global de coordenadas por nombre de localidad.
- **CARTO Dark Matter**: Mosaicos de mapa base optimizados para visualización nocturna.
- **Bootstrap Icons & Google Fonts (Inter)**: Iconografía e interfaz tipográfica limpia.

---

## 📄 Licencia

Proyecto de código abierto desarrollado para visualización meteorológica de alto impacto. Libre para uso educativo, técnico y comercial.
