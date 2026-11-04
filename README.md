# 🌦️ ClimaSpace

> Aplicación meteorológica moderna desarrollada en **ASP.NET Core (.NET 10)** con interfaz dinámica Glassmorphism y un motor de simulación procedural desacoplado.

![.NET 10](https://img.shields.io/badge/.NET-10.0-512BD4?logo=dotnet&logoColor=white)
![ASP.NET Core](https://img.shields.io/badge/ASP.NET_Core-MVC-blue?logo=microsoft)
![Bootstrap 5](https://img.shields.io/badge/Bootstrap-5.3-7952B3?logo=bootstrap&logoColor=white)
![Licencia](https://img.shields.io/badge/Licencia-MIT-green)

---

## 🌟 Características Principales

* 🔬 **Motor de Simulación Meteorológica Inteligente**:
  * **Ciclo Solar Senoidal**: La temperatura evoluciona naturalmente según la hora solar local (mínimo térmico a las 06:00 y pico máximo a las 15:00).
  * **Coherencia Biofísica**: Relación física real entre variables: si hay lluvia o tormenta, la humedad sube al $>80\%$, las nubes aumentan y el índice UV disminuye.
  * **Soporte Global Ilimitado**: Posee un catálogo preconfigurado para ciudades representativas (*Bogotá, Medellín, Madrid, Barcelona, Buenos Aires, Ciudad de México, Miami, Tokio, Nueva York, Reikiavik, etc.*) y un generador determinístico para **cualquier ciudad del mundo**.
* 🎨 **UI Moderna en Glassmorphism**:
  * **Temas Ambientales Dinámicos**: El fondo y degradados de la aplicación reaccionan a la condición climática y al estado día/noche (soleado, nublado, lluvioso, tormentoso, noche estrellada).
  * **Selector de Unidades Instantáneo**: Alterna entre **°C** y **°F** en tiempo real sin recargar la página, recordando la preferencia del usuario.
* ⏱️ **Pronóstico Detallado**:
  * **Cinta Horaria de 24 Horas**: Vista scrollable de cada hora con probabilidades de precipitación e iconos climáticos.
  * **Pronóstico Semanal de 7 Días**: Tarjetas diarias con barras térmicas relativas (mínimas y máximas).
  * **Métricas Secundarias**: Humedad, viento (velocidad y dirección), índice UV, presión atmosférica, visibilidad, calidad del aire y punto de rocío.
* 🏛️ **Clean Architecture & Inversión de Control**:
  * El controlador y las vistas consumen `IWeatherService`. La aplicación no depende de la implementación simulada.

---

## 🏗️ Arquitectura y Migración a API Real

La aplicación implementa el patrón de repositorio/servicio para desacoplar el origen de los datos de la interfaz de usuario:

```
[Cliente Web / Razor]
         │
         ▼
[HomeController] ──(depende de)──► [IWeatherService]
                                          ▲
                     ┌────────────────────┴────────────────────┐
                     │                                         │
        [SimulatedWeatherService]                     [OpenWeatherMapService]
              (Actual)                                      (Futuro)
```

### ¿Cómo conectar una API real (OpenWeatherMap, MeteoBlue, etc.)?

Solo necesitas crear una clase que implemente `IWeatherService`:

```csharp
public class OpenWeatherMapService : IWeatherService
{
    private readonly HttpClient _httpClient;
    
    public OpenWeatherMapService(HttpClient httpClient) => _httpClient = httpClient;

    public async Task<WeatherReport> GetWeatherReportAsync(string? cityName)
    {
        // 1. Llamar a la API externa
        // 2. Mapear el JSON de respuesta al modelo WeatherReport
        // 3. Retornar el reporte
    }

    public Task<IReadOnlyList<string>> GetPopularCitiesAsync() => ...;
}
```

Y en `Program.cs`, sustituyes la inyección en una sola línea:

```csharp
// Cambiar:
// builder.Services.AddScoped<IWeatherService, SimulatedWeatherService>();

// Por:
builder.Services.AddScoped<IWeatherService, OpenWeatherMapService>();
```

---

## 🚀 Requisitos y Ejecución Local

### Prerrequisitos
* [.NET 10 SDK](https://dotnet.microsoft.com/download)
* Navegador web moderno

### Pasos para ejecutar

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/nuz777/ClimaSpace.git
   cd ClimaSpace
   ```

2. Restaurar dependencias y compilar:
   ```bash
   dotnet build
   ```

3. Iniciar el servidor de desarrollo:
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
│   │   └── HomeController.cs          # Orquestador de peticiones y búsqueda
│   ├── Models/
│   │   ├── WeatherCondition.cs        # Enum de condiciones climáticas
│   │   ├── CurrentWeather.cs          # Variables climáticas actuales
│   │   ├── HourlyForecast.cs          # Pronóstico horario (24 horas)
│   │   ├── DailyForecast.cs           # Pronóstico semanal (7 días)
│   │   └── WeatherReport.cs           # Agregado principal y reglas de temas
│   ├── Services/
│   │   ├── IWeatherService.cs         # Contrato abstracto del servicio
│   │   └── SimulatedWeatherService.cs # Generador determinístico procedural
│   ├── Views/
│   │   ├── Home/
│   │   │   ├── Index.cshtml           # Dashboard principal interactivo
│   │   │   └── Privacy.cshtml         # Acerca de y Políticas
│   │   └── Shared/
│   │       └── _Layout.cshtml         # Shell visual, Bootstrap Icons y fuentes
│   └── wwwroot/
│       ├── css/
│       │   └── weather.css            # Estilos Glassmorphism y temas reactivos
│       └── js/
│           └── weather.js             # Lógica cliente (°C/°F, accesibilidad)
├── ClimaSpace.slnx                    # Solución .NET
└── README.md
```

---

## 📄 Licencia

Este proyecto se distribuye bajo la Licencia [MIT](LICENSE).
