# 🌦️ ClimaSpace

> Aplicación meteorológica moderna desarrollada en **ASP.NET Core (.NET 10)** con diseño **Blanco y Azul**, **Radar Doppler en tiempo real** e integración híbrida (**Open-Meteo Live API** y **Simulador Procedural**).

![.NET 10](https://img.shields.io/badge/.NET-10.0-512BD4?logo=dotnet&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Enabled-2496ED?logo=docker&logoColor=white)
![ASP.NET Core](https://img.shields.io/badge/ASP.NET_Core-MVC-blue?logo=microsoft)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-199900?logo=leaflet&logoColor=white)
![Bootstrap 5](https://img.shields.io/badge/Bootstrap-5.3-7952B3?logo=bootstrap&logoColor=white)
![Licencia](https://img.shields.io/badge/Licencia-MIT-green)

---

## 🌟 Novedades y Características Principales

* 🌙 **Modo Oscuro Integral**:
  * Alternador de tema en la barra superior con persistencia instantánea en `localStorage`.
  * Adaptación completa de todas las tarjetas (`.selected-city-card`, `.hero-weather-card`, `.stat-box-white`, etc.) y controles a un tema oscuro profundo de alta legibilidad.
* 📱 **Diseño 100% Responsive**:
  * Optimizado para smartphones (pantallas `< 480px` y `< 768px`), tablets y computadoras de escritorio.
  * Cinta de pronóstico de 24 horas y botones de ciudades con deslizamiento táctil nativo fluido.
  * Radar meteorológico con altura adaptable y controles flexibles sin desbordamiento horizontal.
* 🐳 **Totalmente Dockerizado**:
  * Compilación y despliegue multi-stage con contenedores .NET 10 mediante `Dockerfile` y `docker-compose.yml`.
* 🎨 **Diseño Moderno "Blanco con Azul"**:
  * Estética limpia, luminosa y elegante inspirada en las interfaces meteorológicas modernas.
  * Tarjetas nítidas con sombras suaves y acentos en **Azul Real** (`#2563eb`), **Azul Profundo** (`#1d4ed8`) y **Cian Eléctrico** (`#06b6d4`).
* 🛰️ **Radar Meteorológico Doppler Interactivo**:
  * Integración con **Leaflet.js** y la API global de **RainViewer**.
  * Visualización de ecos de precipitación (lluvia, nieve y tormentas) actualizados cada 10 minutos.
  * Reproductor de animación con botón **Reproducir / Pausar**, indicador de hora Doppler y leyenda.
  * **Escáner Doppler 360°**: Efecto de barrido de radar animado conmutable.
* 💨 **Mapa de Viento MSN & Windy Style**:
  * Partículas dinámicas en tiempo real con geocodificación y seguimiento de huracanes.
* 🌐 **Datos en Vivo (Open-Meteo)**:
  * Consultas en tiempo real por defecto para cualquier ciudad del mundo sin necesidad de registrar claves.
  * Variables climáticas reales: temperatura, sensación, humedad, viento, presión barométrica, índice UV, calidad del aire y probabilidad de lluvia.
* ⏱️ **Pronóstico 24 Horas y Semanal**:
  * Cinta horizontal scrollable hora a hora con iconos climáticos animados y porcentajes de lluvia.
  * Lista de 7 días con barras relativas térmicas de progreso (mínimas y máximas).
* 🔄 **Conversor °C / °F al Vuelo**:
  * Alterna de Celsius a Fahrenheit en el acto mediante JavaScript sin recargar la página.

---

## 🚀 Despliegue con Docker y Ejecución Local

### Opción 1: Ejecución con Docker Compose (Recomendado)

```bash
docker compose up -d --build
```
Abre en tu navegador:
```text
http://localhost:8080
```

### Opción 2: Ejecución Local con .NET 10 SDK

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/nuz777/ClimaSpace.git
   cd ClimaSpace
   ```

2. Compilar la solución:
   ```bash
   dotnet build
   ```

3. Iniciar el servidor web:
   ```bash
   dotnet run --project ClimaSpace
   ```

4. Abrir en tu navegador:
   ```text
   http://localhost:5000  ó  https://localhost:5001
   ```

---

## 📂 Estructura del Proyecto

```text
ClimaSpace/
├── ClimaSpace/
│   ├── Controllers/
│   │   └── HomeController.cs          # Soporta parámetro 'city' y 'provider' (live/simulated)
│   ├── Models/
│   │   ├── WeatherCondition.cs        # Enum de condiciones climáticas
│   │   ├── CurrentWeather.cs          # Variables climáticas detalladas
│   │   ├── HourlyForecast.cs          # Pronóstico horario (24 horas)
│   │   ├── DailyForecast.cs           # Pronóstico a 7 días
│   │   └── WeatherReport.cs           # Agregado principal y metadatos de fuente
│   ├── Services/
│   │   ├── IWeatherService.cs         # Contrato desacoplado
│   │   ├── OpenMeteoWeatherService.cs # API en vivo (Geocoding + Forecast sin key)
│   │   └── SimulatedWeatherService.cs # Simulador procedural coherente
│   ├── Views/
│   │   ├── Home/
│   │   │   ├── Index.cshtml           # Dashboard con Radar Doppler y Hero Card
│   │   │   └── Privacy.cshtml         # Acerca de y Privacidad
│   │   └── Shared/
│   │       └── _Layout.cshtml         # Navbar blanco y azul, Leaflet.js e iconos
│   └── wwwroot/
│       ├── css/
│       │   └── weather.css            # Estilos Blanco y Azul, Radar y controles
│       └── js/
│           └── weather.js             # Leaflet + RainViewer Doppler animation y °C/°F
├── ClimaSpace.slnx
└── README.md
```

---

## 📄 Licencia

Distribuido bajo la Licencia [MIT](LICENSE).
