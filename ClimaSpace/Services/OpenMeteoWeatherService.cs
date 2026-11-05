namespace ClimaSpace.Services;

using System.Globalization;
using System.Text.Json;
using ClimaSpace.Models;
using Microsoft.Extensions.Logging;

public class OpenMeteoWeatherService : IWeatherService
{
    private readonly HttpClient _httpClient;
    private readonly SimulatedWeatherService _fallbackService;
    private readonly ILogger<OpenMeteoWeatherService> _logger;
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (WeatherReport Report, DateTime ExpiresAt)> Cache = new(StringComparer.OrdinalIgnoreCase);

    public OpenMeteoWeatherService(
        HttpClient httpClient, 
        SimulatedWeatherService fallbackService,
        ILogger<OpenMeteoWeatherService> logger)
    {
        _httpClient = httpClient;
        _httpClient.Timeout = TimeSpan.FromSeconds(15);
        _fallbackService = fallbackService;
        _logger = logger;
    }

    public Task<IReadOnlyList<string>> GetPopularCitiesAsync()
    {
        return _fallbackService.GetPopularCitiesAsync();
    }

    public async Task<WeatherReport> GetWeatherReportAsync(string? cityName)
    {
        cityName = string.IsNullOrWhiteSpace(cityName) ? "Bogotá, Colombia" : cityName.Trim();

        // Si se busca "Colombia" a secas, enfocar en Bogotá, capital de Colombia
        if (string.Equals(cityName, "Colombia", StringComparison.OrdinalIgnoreCase))
        {
            cityName = "Bogotá, Colombia";
        }

        string queryCity = cityName.ToLowerInvariant().Trim() switch
        {
            "colombia" => "Bogotá, Colombia",
            "missipi" or "mississippi" => "Jackson, Mississippi",
            "olkhahoma" or "oklahoma" => "Oklahoma City, United States",
            "kansas" => "Wichita, Kansas",
            "texas" => "Houston, Texas",
            "juan mina" or "juan mina en colombia" or "barranquilla - juan mina" or "barranquilla juan mina" or "juan mina barranquilla" or "juan mina, barranquilla" => "Juan Mina, Atlantico, Colombia",
            _ => cityName
        };

        // Revisar caché en memoria (3 minutos de vigencia para respuestas instantáneas)
        if (Cache.TryGetValue(cityName, out var cached) && DateTime.UtcNow < cached.ExpiresAt)
        {
            return cached.Report;
        }

        try
        {
            // 1. Geocodificación: Obtener coordenadas de la ciudad
            var geocodeUrl = $"https://geocoding-api.open-meteo.com/v1/search?name={Uri.EscapeDataString(queryCity)}&count=1&language=es&format=json";
            using var geoResponse = await _httpClient.GetAsync(geocodeUrl);

            if (!geoResponse.IsSuccessStatusCode)
            {
                _logger.LogWarning("Geocoding API falló con código {StatusCode}. Usando fallback simulado.", geoResponse.StatusCode);
                return await GetFallbackReport(cityName);
            }

            var geoJson = await geoResponse.Content.ReadAsStringAsync();
            using var geoDoc = JsonDocument.Parse(geoJson);

            if (!geoDoc.RootElement.TryGetProperty("results", out var results) || results.GetArrayLength() == 0)
            {
                _logger.LogInformation("No se encontraron coordenadas para '{City}'. Usando fallback simulado.", cityName);
                return await GetFallbackReport(cityName);
            }

            var firstResult = results[0];
            string resolvedName = firstResult.GetProperty("name").GetString() ?? cityName;
            string country = firstResult.TryGetProperty("country", out var cProp) ? (cProp.GetString() ?? "") : "";
            string region = firstResult.TryGetProperty("admin1", out var rProp) ? (rProp.GetString() ?? "") : "";

            // Preservar nombres canónicos solicitados por el usuario
            if (cityName.Equals("Mississippi", StringComparison.OrdinalIgnoreCase) || cityName.Equals("missipi", StringComparison.OrdinalIgnoreCase))
                resolvedName = "Mississippi";
            else if (cityName.Equals("Oklahoma", StringComparison.OrdinalIgnoreCase) || cityName.Equals("olkhahoma", StringComparison.OrdinalIgnoreCase))
                resolvedName = "Oklahoma";
            else if (cityName.Equals("Kansas", StringComparison.OrdinalIgnoreCase))
                resolvedName = "Kansas";
            else if (cityName.Equals("Texas", StringComparison.OrdinalIgnoreCase))
                resolvedName = "Texas";
            else if (cityName.StartsWith("juan mina", StringComparison.OrdinalIgnoreCase) || cityName.Contains("juan mina", StringComparison.OrdinalIgnoreCase))
                resolvedName = "Juan Mina";

            double lat = firstResult.GetProperty("latitude").GetDouble();
            double lon = firstResult.GetProperty("longitude").GetDouble();

            // 2. Pronóstico en vivo de Open-Meteo
            var forecastUrl = $"https://api.open-meteo.com/v1/forecast?latitude={lat.ToString(CultureInfo.InvariantCulture)}&longitude={lon.ToString(CultureInfo.InvariantCulture)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max&timezone=auto";

            using var forecastResponse = await _httpClient.GetAsync(forecastUrl);
            if (!forecastResponse.IsSuccessStatusCode)
            {
                _logger.LogWarning("Forecast API falló con código {StatusCode}. Usando fallback simulado.", forecastResponse.StatusCode);
                return await GetFallbackReport(cityName);
            }

            var forecastJson = await forecastResponse.Content.ReadAsStringAsync();
            using var forecastDoc = JsonDocument.Parse(forecastJson);
            var root = forecastDoc.RootElement;

            // Hora local calculada
            int utcOffsetSeconds = root.TryGetProperty("utc_offset_seconds", out var uos) ? uos.GetInt32() : 0;
            DateTime localTime = DateTime.UtcNow.AddSeconds(utcOffsetSeconds);

            // Parsear clima actual
            var currentElem = root.GetProperty("current");
            double temp = currentElem.GetProperty("temperature_2m").GetDouble();
            int humidity = (int)Math.Round(currentElem.GetProperty("relative_humidity_2m").GetDouble());
            double feelsLike = currentElem.GetProperty("apparent_temperature").GetDouble();
            bool isDay = currentElem.GetProperty("is_day").GetInt32() == 1;
            int weatherCode = currentElem.GetProperty("weather_code").GetInt32();
            double precipMm = currentElem.TryGetProperty("precipitation", out var pVal) && pVal.ValueKind == JsonValueKind.Number ? pVal.GetDouble() : 0.0;
            double pressure = currentElem.GetProperty("surface_pressure").GetDouble();
            double windSpeed = currentElem.GetProperty("wind_speed_10m").GetDouble();
            int windDirDegrees = currentElem.GetProperty("wind_direction_10m").GetInt32();
            string windDir = DegreesToCardinal(windDirDegrees);

            var condition = MapWmoCodeToCondition(weatherCode, isDay);
            var conditionDesc = MapWmoCodeToDescription(weatherCode, isDay);
            var iconClass = GetIconForCondition(condition, isDay);

            // Parsear Daily para amanecer, atardecer y UV
            string sunriseStr = "06:00";
            string sunsetStr = "18:00";
            int uvIndex = 4;
            var dailyForecasts = new List<DailyForecast>();
            var culture = new CultureInfo("es-ES");

            if (root.TryGetProperty("daily", out var dailyElem))
            {
                var dTimes = dailyElem.GetProperty("time");
                var dCodes = dailyElem.GetProperty("weather_code");
                var dMaxTemps = dailyElem.GetProperty("temperature_2m_max");
                var dMinTemps = dailyElem.GetProperty("temperature_2m_min");
                var dRainProbs = dailyElem.GetProperty("precipitation_probability_max");
                var dSunrises = dailyElem.GetProperty("sunrise");
                var dSunsets = dailyElem.GetProperty("sunset");
                var dUvs = dailyElem.GetProperty("uv_index_max");

                if (dSunrises.GetArrayLength() > 0)
                {
                    var sVal = dSunrises[0].GetString();
                    if (DateTime.TryParse(sVal, out var dtSunrise)) sunriseStr = dtSunrise.ToString("HH:mm");
                }
                if (dSunsets.GetArrayLength() > 0)
                {
                    var sVal = dSunsets[0].GetString();
                    if (DateTime.TryParse(sVal, out var dtSunset)) sunsetStr = dtSunset.ToString("HH:mm");
                }
                if (dUvs.GetArrayLength() > 0)
                {
                    uvIndex = (int)Math.Round(dUvs[0].GetDouble());
                }

                int daysCount = Math.Min(7, dTimes.GetArrayLength());
                for (int d = 0; d < daysCount; d++)
                {
                    string dateStr = dTimes[d].GetString() ?? "";
                    DateTime.TryParse(dateStr, out var dayDate);
                    int dCode = dCodes[d].GetInt32();
                    double maxT = dMaxTemps[d].GetDouble();
                    double minT = dMinTemps[d].GetDouble();
                    int rainP = dRainProbs.GetArrayLength() > d && dRainProbs[d].ValueKind == JsonValueKind.Number ? dRainProbs[d].GetInt32() : 0;

                    var dCond = MapWmoCodeToCondition(dCode, true);
                    string dayLabel = d switch
                    {
                        0 => "Hoy",
                        1 => "Mañana",
                        _ => culture.DateTimeFormat.GetDayName(dayDate.DayOfWeek)
                    };
                    dayLabel = char.ToUpper(dayLabel[0]) + dayLabel[1..];

                    dailyForecasts.Add(new DailyForecast
                    {
                        Date = dayDate,
                        DayName = dayLabel,
                        MinTempC = Math.Round(minT, 1),
                        MaxTempC = Math.Round(maxT, 1),
                        Condition = dCond,
                        ConditionDescription = MapWmoCodeToDescription(dCode, true),
                        IconClass = GetIconForCondition(dCond, true),
                        PrecipitationProbability = rainP
                    });
                }
            }

            // Parsear Hourly para las siguientes 24 horas
            var hourlyForecasts = new List<HourlyForecast>();
            if (root.TryGetProperty("hourly", out var hourlyElem))
            {
                var hTimes = hourlyElem.GetProperty("time");
                var hTemps = hourlyElem.GetProperty("temperature_2m");
                var hCodes = hourlyElem.GetProperty("weather_code");
                var hRain = hourlyElem.GetProperty("precipitation_probability");

                // Encontrar el índice más cercano a la hora actual
                int startIndex = 0;
                string currentHourStr = localTime.ToString("yyyy-MM-ddTHH:00");
                for (int h = 0; h < hTimes.GetArrayLength(); h++)
                {
                    var tVal = hTimes[h].GetString();
                    if (tVal != null && tVal.StartsWith(currentHourStr))
                    {
                        startIndex = h;
                        break;
                    }
                }

                int maxHours = Math.Min(24, hTimes.GetArrayLength() - startIndex);
                for (int i = 0; i < maxHours; i++)
                {
                    int index = startIndex + i;
                    var tStr = hTimes[index].GetString() ?? "";
                    DateTime.TryParse(tStr, out var hDate);
                    bool hIsDay = hDate.Hour >= 6 && hDate.Hour < 19;
                    int hCode = hCodes[index].GetInt32();
                    var hCond = MapWmoCodeToCondition(hCode, hIsDay);
                    double hTemp = hTemps[index].GetDouble();
                    int hRainProb = hRain[index].ValueKind == JsonValueKind.Number ? hRain[index].GetInt32() : 0;

                    hourlyForecasts.Add(new HourlyForecast
                    {
                        Time = i == 0 ? "Ahora" : hDate.ToString("HH:00"),
                        TemperatureC = Math.Round(hTemp, 1),
                        PrecipitationProbability = hRainProb,
                        Condition = hCond,
                        IconClass = GetIconForCondition(hCond, hIsDay)
                    });
                }
            }

            double dewPoint = Math.Round(temp - ((100 - humidity) / 5.0), 1);
            var popularCities = await _fallbackService.GetPopularCitiesAsync();

            var report = new WeatherReport
            {
                City = resolvedName,
                Country = country,
                Region = region,
                Latitude = Math.Round(lat, 4),
                Longitude = Math.Round(lon, 4),
                LocalTime = localTime,
                DataSource = "Open-Meteo Live API (Tiempo Real)",
                IsLiveApi = true,
                Provider = "live",
                Current = new CurrentWeather
                {
                    TemperatureC = Math.Round(temp, 1),
                    FeelsLikeC = Math.Round(feelsLike, 1),
                    Humidity = humidity,
                    WindSpeedKmh = Math.Round(windSpeed, 1),
                    WindDirection = windDir,
                    PressureHpa = (int)Math.Round(pressure),
                    UvIndex = uvIndex,
                    VisibilityKm = condition == WeatherCondition.Fog ? 2.0 : 10.0,
                    DewPointC = dewPoint,
                    AirQuality = uvIndex > 6 ? "Moderada (AQI 52)" : "Excelente (AQI 22)",
                    Condition = condition,
                    ConditionDescription = conditionDesc,
                    PrecipitationMm = Math.Round(precipMm, 2),
                    IconClass = iconClass,
                    IsDay = isDay,
                    Sunrise = sunriseStr,
                    Sunset = sunsetStr
                },
                Hourly = hourlyForecasts,
                Daily = dailyForecasts,
                PopularCities = popularCities.Take(12).ToList()
            };

            Cache[cityName] = (report, DateTime.UtcNow.AddMinutes(5));
            Cache[resolvedName] = (report, DateTime.UtcNow.AddMinutes(5));

            return report;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Excepción al consultar Open-Meteo para {City}. Usando fallback simulado.", cityName);
            return await GetFallbackReport(cityName);
        }
    }

    private async Task<WeatherReport> GetFallbackReport(string cityName)
    {
        var report = await _fallbackService.GetWeatherReportAsync(cityName);
        report.DataSource = "Simulador Procedural ClimaSpace (Modo Offline/Fallback)";
        report.IsLiveApi = false;
        report.Provider = "simulated";
        return report;
    }

    private static WeatherCondition MapWmoCodeToCondition(int code, bool isDay) => code switch
    {
        0 => isDay ? WeatherCondition.Sunny : WeatherCondition.ClearNight,
        1 => isDay ? WeatherCondition.Sunny : WeatherCondition.ClearNight,
        2 => WeatherCondition.PartlyCloudy,
        3 => WeatherCondition.Cloudy,
        45 or 48 => WeatherCondition.Fog,
        51 or 53 or 55 or 56 or 57 => WeatherCondition.LightRain,
        61 or 63 => WeatherCondition.LightRain,
        65 or 66 or 67 or 80 or 81 or 82 => WeatherCondition.HeavyRain,
        71 or 73 or 75 or 77 or 85 or 86 => WeatherCondition.Snow,
        95 or 96 or 99 => WeatherCondition.Thunderstorm,
        _ => isDay ? WeatherCondition.Sunny : WeatherCondition.ClearNight
    };

    private static string MapWmoCodeToDescription(int code, bool isDay) => code switch
    {
        0 => isDay ? "Cielo completamente despejado" : "Noche clara y despejada",
        1 => isDay ? "Mayormente soleado" : "Noche mayormente despejada",
        2 => "Parcialmente nublado",
        3 => "Nublado con cobertura nubosa",
        45 or 48 => "Presencia de niebla densa",
        51 or 53 or 55 => "Lloviznas ligeras dispersas",
        61 or 63 => "Lluvias moderadas",
        65 => "Lluvias intensas continuas",
        80 or 81 or 82 => "Chubascos de lluvia",
        71 or 73 or 75 or 77 => "Nevadas ligeras a moderadas",
        85 or 86 => "Chubascos de nieve",
        95 => "Tormenta eléctrica moderada",
        96 or 99 => "Tormenta eléctrica con granizo",
        _ => "Tiempo estable"
    };

    private static string GetIconForCondition(WeatherCondition cond, bool isDay) => cond switch
    {
        WeatherCondition.Sunny => "bi-sun-fill text-warning",
        WeatherCondition.ClearNight => "bi-moon-stars-fill text-info",
        WeatherCondition.PartlyCloudy => isDay ? "bi-cloud-sun-fill text-warning" : "bi-cloud-moon-fill text-info",
        WeatherCondition.Cloudy => "bi-clouds-fill text-secondary",
        WeatherCondition.Overcast => "bi-cloud-fill text-secondary",
        WeatherCondition.LightRain => "bi-cloud-drizzle-fill text-primary",
        WeatherCondition.HeavyRain => "bi-cloud-rain-heavy-fill text-primary",
        WeatherCondition.Thunderstorm => "bi-cloud-lightning-rain-fill text-warning",
        WeatherCondition.Snow => "bi-snow text-info",
        WeatherCondition.Fog => "bi-cloud-fog2 text-secondary",
        _ => isDay ? "bi-brightness-high-fill text-warning" : "bi-moon-fill text-info"
    };

    private static string DegreesToCardinal(int degrees)
    {
        string[] cardinals = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
        int index = (int)Math.Round((degrees % 360) / 22.5);
        return cardinals[index % 16];
    }
}
