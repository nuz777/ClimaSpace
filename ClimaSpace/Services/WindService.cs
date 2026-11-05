namespace ClimaSpace.Services;

using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;

/// <summary>
/// Modelo de datos para huracanes y ciclones tropicales monitoreados
/// </summary>
public record TrackedHurricane(
    string Id,
    string Name,
    string Category,
    int CategoryLevel,
    double Latitude,
    double Longitude,
    double MaxWindsKmh,
    double PressureHpa,
    string LocationDesc,
    string Movement,
    string Status
);

/// <summary>
/// Servicio C# para la obtención, generación y almacenamiento en caché
/// del campo de viento global, lectura de huracanes y geocodificación inversa.
/// </summary>
public class WindService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<WindService> _logger;
    private static readonly ConcurrentDictionary<string, (string Json, DateTime ExpiresAt)> Cache = new();
    private static readonly ConcurrentDictionary<string, (string Name, DateTime ExpiresAt)> GeoCache = new();

    public WindService(HttpClient httpClient, ILogger<WindService> logger)
    {
        _httpClient = httpClient;
        _httpClient.Timeout = TimeSpan.FromSeconds(15);
        _logger = logger;
    }

    /// <summary>
    /// Lista de huracanes y ciclones tropicales seguidos por el sistema
    /// </summary>
    public static readonly IReadOnlyList<TrackedHurricane> ActiveHurricanes = new List<TrackedHurricane>
    {
        new(
            Id: "isaias",
            Name: "Huracán Isaias",
            Category: "Cat. 1",
            CategoryLevel: 1,
            Latitude: 27.5,
            Longitude: -80.2,
            MaxWindsKmh: 130,
            PressureHpa: 987,
            LocationDesc: "Costa del Golfo / Florida y Misisipi",
            Movement: "NNO a 18 km/h",
            Status: "Monitoreado en vivo"
        ),
        new(
            Id: "milton",
            Name: "Huracán Milton",
            Category: "Cat. 5",
            CategoryLevel: 5,
            Latitude: 24.2,
            Longitude: -86.5,
            MaxWindsKmh: 285,
            PressureHpa: 897,
            LocationDesc: "Golfo de México (Frente a Península de Florida)",
            Movement: "ENE a 22 km/h",
            Status: "Ciclón Mayor Extremo"
        ),
        new(
            Id: "helene",
            Name: "Huracán Helene",
            Category: "Cat. 4",
            CategoryLevel: 4,
            Latitude: 28.5,
            Longitude: -84.5,
            MaxWindsKmh: 225,
            PressureHpa: 938,
            LocationDesc: "Golfo de México Norte / Big Bend",
            Movement: "NNE a 32 km/h",
            Status: "Ciclón Mayor"
        ),
        new(
            Id: "beryl",
            Name: "Huracán Beryl",
            Category: "Cat. 5",
            CategoryLevel: 5,
            Latitude: 18.2,
            Longitude: -77.5,
            MaxWindsKmh: 260,
            PressureHpa: 934,
            LocationDesc: "Mar Caribe (Frente a Jamaica y Península de Yucatán)",
            Movement: "ONO a 26 km/h",
            Status: "Ciclón Tropical Histórico"
        ),
        new(
            Id: "shanshan",
            Name: "Tifón Shanshan",
            Category: "Cat. 3",
            CategoryLevel: 3,
            Latitude: 31.8,
            Longitude: 130.5,
            MaxWindsKmh: 185,
            PressureHpa: 950,
            LocationDesc: "Pacífico Noroeste / Sudoeste de Japón (Kyushu)",
            Movement: "NE a 15 km/h",
            Status: "Tifón Muy Fuerte"
        )
    };

    public IReadOnlyList<TrackedHurricane> GetHurricanes() => ActiveHurricanes;

    /// <summary>
    /// Identifica de forma inmediata o enriquecida el nombre del lugar (ciudad o cuerpo de agua)
    /// </summary>
    public async Task<string> ReverseGeocodeAsync(double lat, double lon)
    {
        string key = string.Create(CultureInfo.InvariantCulture, $"{lat:F2}_{lon:F2}");
        if (GeoCache.TryGetValue(key, out var cached) && DateTime.UtcNow < cached.ExpiresAt)
        {
            return cached.Name;
        }

        // 1. Detección rápida de mares y océanos principales
        string marineRegion = GetMarineRegion(lat, lon);
        if (!string.IsNullOrEmpty(marineRegion))
        {
            GeoCache[key] = (marineRegion, DateTime.UtcNow.AddHours(2));
            return marineRegion;
        }

        // 2. Consulta a servicio de geocodificación inversa con User-Agent
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, 
                $"https://nominatim.openstreetmap.org/reverse?lat={lat.ToString("F4", CultureInfo.InvariantCulture)}&lon={lon.ToString("F4", CultureInfo.InvariantCulture)}&format=json&accept-language=es");
            req.Headers.Add("User-Agent", "ClimaSpace/1.0 (https://github.com/nuz777/ClimaSpace)");

            using var resp = await _httpClient.SendAsync(req);
            if (resp.IsSuccessStatusCode)
            {
                var json = await resp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("address", out var addr))
                {
                    string city = addr.TryGetProperty("city", out var c) ? c.GetString() ?? "" :
                                  addr.TryGetProperty("town", out var t) ? t.GetString() ?? "" :
                                  addr.TryGetProperty("municipality", out var m) ? m.GetString() ?? "" :
                                  addr.TryGetProperty("state_district", out var sd) ? sd.GetString() ?? "" : "";

                    string state = addr.TryGetProperty("state", out var s) ? s.GetString() ?? "" : "";
                    string country = addr.TryGetProperty("country", out var co) ? co.GetString() ?? "" : "";

                    var parts = new List<string>();
                    if (!string.IsNullOrWhiteSpace(city)) parts.Add(city);
                    if (!string.IsNullOrWhiteSpace(state) && state != city) parts.Add(state);
                    if (!string.IsNullOrWhiteSpace(country)) parts.Add(country);

                    if (parts.Count > 0)
                    {
                        string result = string.Join(", ", parts);
                        GeoCache[key] = (result, DateTime.UtcNow.AddHours(1));
                        return result;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Geocodificación inversa no pudo resolver ({Lat}, {Lon})", lat, lon);
        }

        // Respaldo de cuadrante
        string fallback = GetGeographicFallback(lat, lon);
        GeoCache[key] = (fallback, DateTime.UtcNow.AddHours(1));
        return fallback;
    }

    private static string GetMarineRegion(double lat, double lon)
    {
        // Mar Caribe
        if (lat is >= 9.0 and <= 22.0 && lon is >= -89.0 and <= -59.0)
            return lat <= 13.5 ? "Mar Caribe (Caribe Sur / Frente a Colombia)" : "Mar Caribe Central";

        // Golfo de México
        if (lat is >= 18.0 and <= 31.0 && lon is >= -98.0 and <= -80.0)
            return "Golfo de México (Frente a EE. UU. y México)";

        // Océano Atlántico Norte
        if (lat is >= 20.0 and <= 65.0 && lon is >= -80.0 and <= -10.0)
            return "Océano Atlántico Norte";

        // Océano Pacífico Oriental
        if (lat is >= -10.0 and <= 30.0 && lon is >= -130.0 and <= -77.0)
            return "Océano Pacífico Oriental";

        // Mar de Japón
        if (lat is >= 33.0 and <= 48.0 && lon is >= 127.0 and <= 142.0)
            return "Mar de Japón / Mar del Este";

        // Mar Mediterráneo
        if (lat is >= 30.0 and <= 46.0 && lon is >= -6.0 and <= 36.0)
            return "Mar Mediterráneo";

        return "";
    }

    private static string GetGeographicFallback(double lat, double lon)
    {
        string latDir = lat >= 0 ? "N" : "S";
        string lonDir = lon >= 0 ? "E" : "O";
        return $"{Math.Abs(lat):F2}° {latDir}, {Math.Abs(lon):F2}° {lonDir}";
    }

    /// <summary>
    /// Obtiene el pronóstico de viento por cuadrícula (velocidad y dirección a 10m) para 7 días completos (168h).
    /// </summary>
    public async Task<string> GetWindGridForecastAsync(double south, double north, double west, double east, int rows = 8, int cols = 8)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"{south:F1}_{north:F1}_{west:F1}_{east:F1}_{rows}x{cols}");
        
        if (Cache.TryGetValue(cacheKey, out var cached) && DateTime.UtcNow < cached.ExpiresAt)
        {
            return cached.Json;
        }

        double latPad = (north - south) * 0.15;
        double lngPad = (east - west) * 0.15;

        double latMin = Math.Clamp(south - latPad, -80.0, 80.0);
        double latMax = Math.Clamp(north + latPad, -80.0, 80.0);
        double lngMin = west - lngPad;
        double lngMax = east + lngPad;

        double dLat = (latMax - latMin) / Math.Max(1, rows - 1);
        double dLng = (lngMax - lngMin) / Math.Max(1, cols - 1);

        var latList = new List<string>(rows * cols);
        var lngList = new List<string>(rows * cols);

        for (int r = 0; r < rows; r++)
        {
            double latVal = latMin + r * dLat;
            for (int c = 0; c < cols; c++)
            {
                double lngVal = NormalizeLng(lngMin + c * dLng);
                latList.Add(latVal.ToString("F2", CultureInfo.InvariantCulture));
                lngList.Add(lngVal.ToString("F2", CultureInfo.InvariantCulture));
            }
        }

        string url = $"https://api.open-meteo.com/v1/forecast?latitude={string.Join(",", latList)}&longitude={string.Join(",", lngList)}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&forecast_days=7";

        try
        {
            using var response = await _httpClient.GetAsync(url);
            if (response.IsSuccessStatusCode)
            {
                string json = await response.Content.ReadAsStringAsync();
                Cache[cacheKey] = (json, DateTime.UtcNow.AddMinutes(10));
                return json;
            }

            _logger.LogWarning("Open-Meteo devolvió código {StatusCode}. Utilizando modelo meteorológico sintético.", response.StatusCode);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error al consultar API Open-Meteo para cuadrícula de viento. Activando modelo sintético.");
        }

        string syntheticJson = GenerateSyntheticWindJson(rows, cols);
        return syntheticJson;
    }

    private static double NormalizeLng(double lng)
    {
        return ((((lng + 180) % 360) + 360) % 360) - 180;
    }

    private static string GenerateSyntheticWindJson(int rows, int cols)
    {
        int totalPoints = rows * cols;
        var list = new List<object>(totalPoints);

        for (int i = 0; i < totalPoints; i++)
        {
            var speeds = new double[168];
            var directions = new double[168];

            for (int h = 0; h < 168; h++)
            {
                double angle = (i * 15 + h * 4) % 360;
                double spd = 12 + 10 * Math.Sin((i + h) * 0.2);
                speeds[h] = Math.Round(Math.Max(3, spd), 1);
                directions[h] = Math.Round(angle, 1);
            }

            list.Add(new
            {
                hourly = new
                {
                    wind_speed_10m = speeds,
                    wind_direction_10m = directions
                }
            });
        }

        return JsonSerializer.Serialize(list);
    }
}
