# 🌦️ ClimaSpace

> Aplicación meteorológica moderna desarrollada en **ASP.NET Core (.NET 10)** con diseño **Blanco y Azul**, **Radar Doppler en tiempo real** e integración híbrida (**Open-Meteo Live API** y **Simulador Procedural**).

![.NET 10](https://img.shields.io/badge/.NET-10.0-512BD4?logo=dotnet&logoColor=white)
![ASP.NET Core](https://img.shields.io/badge/ASP.NET_Core-MVC-blue?logo=microsoft)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-199900?logo=leaflet&logoColor=white)
![Bootstrap 5](https://img.shields.io/badge/Bootstrap-5.3-7952B3?logo=bootstrap&logoColor=white)
![Licencia](https://img.shields.io/badge/Licencia-MIT-green)

---

## 🌟 Novedades y Características Principales

* 🎨 **Diseño Moderno "Blanco con Azul"**:
  * Estética limpia, luminosa y elegante inspirada en las interfaces de software meteorológico contemporáneo.
  * Tarjetas blancas nítidas con sombras suaves y acentos en **Azul Real** (`#2563eb`), **Azul Profundo** (`#1d4ed8`) y **Cian Eléctrico** (`#06b6d4`).
  * Tarjeta Hero en degradado azul zafiro con iconos animados y métricas destacadas.
* 🛰️ **Radar Meteorológico Doppler Interactivo**:
  * Integración con **Leaflet.js** y la API global de **RainViewer**.
  * Visualización de ecos de precipitación (lluvia, nieve y tormentas) actualizados cada 10 minutos.
  * Reproductor de animación con botón **Reproducir / Pausar**, indicador de hora del fotograma Doppler y leyenda de intensidad.
  * **Escaner Doppler 360°**: Efecto de barrido de radar animado conmutable.
  * Marcador de ciudad con pulso circular dinámico sobre la ubicación consultada.
* 🌐 **Integración con API Real (Open-Meteo)**:
  * Consultas en tiempo real para cualquier ciudad del mundo sin necesidad de registrar claves ni pagar suscripciones.
  * Geocodificación automática por nombre de urbe.
  * Variables climáticas reales: temperatura, humedad, viento, presión barométrica, índice UV, calidad del aire y probabilidad de lluvia.
* 🧪 **Modo Híbrido (API en Vivo vs. Modo Simulación)**:
  * Selector instantáneo en la cabecera para alternar entre **Datos en Vivo** y el **Simulador Matemático Procedural**.
  * Si la conexión a la API externa falla o estás sin conexión, el sistema realiza fallback transparente a la simulación sin interrupciones.
* ⏱️ **Pronóstico 24 Horas y Semanal**:
  * Cinta horizontal scrollable hora a hora con iconos climáticos y porcentajes de precipitación.
  * Lista de 7 días con barras relativas térmicas de progreso (mínimas y máximas).
* 🔄 **Conversor °C / °F al Vuelo**:
  * Alterna de Celsius a Fahrenheit en el acto mediante JavaScript sin recargar la página, conservando la preferencia en `localStorage`.

---

## 🏗️ Arquitectura de Servicios

```
[Cliente Web / Razor View]
           │
           ▼
    [HomeController]
           │
     ┌─────┴────────────────────────┐
     ▼                              ▼
(provider = "live")        (provider = "simulated")
     │                              │
     ▼                              ▼
[OpenMeteoWeatherService]   [SimulatedWeatherService]
     │ (Fallback)                   │
     └──────────────────────────────┘
                    │
                    ▼
            [IWeatherService]
```

---

## 🚀 Requisitos y Ejecución Local

### Prerrequisitos
* [.NET 10 SDK](https://dotnet.microsoft.com/download)
* Conexión a Internet (para los mosaicos del radar y la API en vivo; si no hay red, opera el simulador automáticamente).

### Pasos para ejecutar

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
