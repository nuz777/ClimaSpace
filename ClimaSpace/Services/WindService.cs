namespace ClimaSpace.Services;

using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;

/// <summary>
/// Servicio C# para la obtención, generación y almacenamiento en caché
/// del campo de viento global e interpolación de Open-Meteo API.
/// </summary>
public class WindService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<WindService> _logger;
    private static readonly ConcurrentDictionary<string, (string Json, DateTime ExpiresAt)> Cache = new();

    public WindService(HttpClient httpClient, ILogger<WindService> logger)
    {
        _httpClient = httpClient;
        _httpClient.Timeout = TimeSpan.FromSeconds(15);
        _logger = logger;
    }

    /// <summary>
    /// Obtiene el pronóstico de viento por cuadrícula (velocidad y dirección a 10m) para 7 días completos (168h).
    /// </summary>
    public async Task<string> GetWindGridForecastAsync(double south, double north, double west, double east, int rows = 8, int cols = 8)
    {
        // Clave de caché redondeada para evitar consultas redundantes
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"{south:F1}_{north:F1}_{west:F1}_{east:F1}_{rows}x{cols}");
        
        if (Cache.TryGetValue(cacheKey, out var cached) && DateTime.UtcNow < cached.ExpiresAt)
        {
            return cached.Json;
        }

        // Padding para los límites del mapa
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
                // Almacenar en caché por 10 minutos
                Cache[cacheKey] = (json, DateTime.UtcNow.AddMinutes(10));
                return json;
            }

            _logger.LogWarning("Open-Meteo devolvió código {StatusCode}. Utilizando modelo meteorológico sintético.", response.StatusCode);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error al consultar API Open-Meteo para cuadrícula de viento. Activando modelo sintético.");
        }

        // Generar respaldo sintético si la red falla
        string syntheticJson = GenerateSyntheticWindJson(rows, cols);
        return syntheticJson;
    }

    private static double NormalizeLng(double lng)
    {
        return ((((lng + 180) % 360) + 360) % 360) - 180;
    }

    /// <summary>
    /// Genera una estructura JSON sintética compatible con Open-Meteo para emergencias sin conexión
    /// </summary>
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
