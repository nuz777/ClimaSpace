namespace ClimaSpace.Services;

using System.Globalization;
using ClimaSpace.Models;

public class SimulatedWeatherService : IWeatherService
{
    private record CityProfile(
        string Name,
        string Country,
        string Region,
        double Lat,
        double Lon,
        int UtcOffsetHours,
        double BaseTemp,
        double TempVariance,
        WeatherCondition DefaultCondition);

    private static readonly Dictionary<string, CityProfile> PresetCities = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Bogotá"] = new("Bogotá", "Colombia", "Cundinamarca", 4.7110, -74.0721, -5, 14.5, 5.0, WeatherCondition.LightRain),
        ["Medellín"] = new("Medellín", "Colombia", "Antioquia", 6.2442, -75.5812, -5, 22.0, 4.0, WeatherCondition.PartlyCloudy),
        ["Cali"] = new("Cali", "Colombia", "Valle del Cauca", 3.4516, -76.5320, -5, 26.0, 5.0, WeatherCondition.PartlyCloudy),
        ["Barranquilla"] = new("Barranquilla", "Colombia", "Atlántico", 10.9685, -74.7813, -5, 29.0, 4.0, WeatherCondition.Sunny),
        ["Cartagena"] = new("Cartagena", "Colombia", "Bolívar", 10.3910, -75.4794, -5, 29.5, 3.5, WeatherCondition.Sunny),
        ["Bucaramanga"] = new("Bucaramanga", "Colombia", "Santander", 7.1254, -73.1198, -5, 23.0, 4.5, WeatherCondition.PartlyCloudy),
        ["Madrid"] = new("Madrid", "España", "Comunidad de Madrid", 40.4168, -3.7038, 1, 18.0, 8.0, WeatherCondition.Sunny),
        ["Miami"] = new("Miami", "Estados Unidos", "Florida", 25.7617, -80.1918, -5, 27.5, 3.5, WeatherCondition.PartlyCloudy),
        ["Tokio"] = new("Tokio", "Japón", "Kantō", 35.6762, 139.6503, 9, 16.0, 6.0, WeatherCondition.Sunny),
        ["Buenos Aires"] = new("Buenos Aires", "Argentina", "CABA", -34.6037, -58.3816, -3, 21.0, 7.0, WeatherCondition.PartlyCloudy),
        ["Ciudad de México"] = new("Ciudad de México", "México", "CDMX", 19.4326, -99.1332, -6, 19.0, 6.0, WeatherCondition.PartlyCloudy),
        ["Nueva York"] = new("Nueva York", "Estados Unidos", "New York", 40.7128, -74.0060, -5, 12.0, 7.0, WeatherCondition.Cloudy),
        ["Londres"] = new("Londres", "Reino Unido", "Greater London", 51.5074, -0.1278, 0, 11.0, 4.0, WeatherCondition.LightRain)
    };

    public Task<IReadOnlyList<string>> GetPopularCitiesAsync()
    {
        IReadOnlyList<string> list = PresetCities.Keys.ToList();
        return Task.FromResult(list);
    }

    public Task<WeatherReport> GetWeatherReportAsync(string? cityName)
    {
        cityName = string.IsNullOrWhiteSpace(cityName) ? "Bogotá" : cityName.Trim();

        // Normalizar búsqueda de Colombia
        if (string.Equals(cityName, "Colombia", StringComparison.OrdinalIgnoreCase) || 
            cityName.StartsWith("Bogot", StringComparison.OrdinalIgnoreCase))
        {
            cityName = "Bogotá";
        }

        CityProfile profile;
        if (!PresetCities.TryGetValue(cityName, out profile!))
        {
            profile = GenerateDeterministicProfile(cityName);
        }

        var utcNow = DateTime.UtcNow;
        var localTime = utcNow.AddHours(profile.UtcOffsetHours);
        var hour = localTime.Hour;
        var isDay = hour >= 6 && hour < 19;

        // Daily sinusoidal curve: lowest at 6:00 AM, highest at 15:00 PM
        double hourFactor = Math.Sin((hour - 9) * Math.PI / 12.0); // range -1 to 1
        double currentTemp = Math.Round(profile.BaseTemp + (hourFactor * (profile.TempVariance / 2.0)), 1);

        int daySeed = profile.Name.GetHashCode() ^ localTime.DayOfYear;
        var random = new Random(daySeed);

        var currentCondition = DetermineCurrentCondition(profile.DefaultCondition, isDay, random);
        var conditionDesc = GetConditionDescription(currentCondition, isDay);
        var iconClass = GetIconForCondition(currentCondition, isDay);

        int humidity = currentCondition switch
        {
            WeatherCondition.LightRain or WeatherCondition.HeavyRain => random.Next(78, 96),
            WeatherCondition.Thunderstorm => random.Next(85, 98),
            WeatherCondition.Fog => random.Next(90, 99),
            WeatherCondition.Overcast or WeatherCondition.Cloudy => random.Next(60, 80),
            _ => random.Next(35, 65)
        };

        double feelsLike = Math.Round(currentTemp + (humidity > 70 ? 1.5 : -0.8), 1);
        double windSpeed = Math.Round(random.NextDouble() * 18 + 4, 1);
        string[] windDirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        string windDir = windDirs[random.Next(windDirs.Length)];

        int uvIndex = !isDay ? 0 : currentCondition switch
        {
            WeatherCondition.Sunny => Math.Min(11, Math.Max(1, (int)(10 - Math.Abs(13 - hour) * 1.5))),
            WeatherCondition.PartlyCloudy => Math.Min(7, Math.Max(1, (int)(7 - Math.Abs(13 - hour) * 1.1))),
            _ => Math.Min(3, Math.Max(0, (int)(3 - Math.Abs(13 - hour) * 0.5)))
        };

        var currentWeather = new CurrentWeather
        {
            TemperatureC = currentTemp,
            FeelsLikeC = feelsLike,
            Humidity = humidity,
            WindSpeedKmh = windSpeed,
            WindDirection = windDir,
            PressureHpa = random.Next(1008, 1024),
            UvIndex = uvIndex,
            VisibilityKm = currentCondition == WeatherCondition.Fog ? 2.5 : random.Next(8, 12),
            DewPointC = Math.Round(currentTemp - ((100 - humidity) / 5.0), 1),
            AirQuality = uvIndex > 7 ? "Moderada (AQI 58)" : "Excelente (AQI 24)",
            Condition = currentCondition,
            ConditionDescription = conditionDesc,
            IconClass = iconClass,
            IsDay = isDay,
            Sunrise = "06:05",
            Sunset = "18:15"
        };

        // 24-hour forecast
        var hourlyForecasts = new List<HourlyForecast>();
        for (int i = 0; i < 24; i++)
        {
            var forecastTime = localTime.AddHours(i);
            var fHour = forecastTime.Hour;
            var fIsDay = fHour >= 6 && fHour < 19;
            double fHourFactor = Math.Sin((fHour - 9) * Math.PI / 12.0);
            double fTemp = Math.Round(profile.BaseTemp + (fHourFactor * (profile.TempVariance / 2.0)) + (random.NextDouble() * 0.8 - 0.4), 1);

            int fSeed = daySeed + i * 17;
            var fRandom = new Random(fSeed);
            var fCondition = DetermineCurrentCondition(profile.DefaultCondition, fIsDay, fRandom);

            int rainProb = fCondition switch
            {
                WeatherCondition.HeavyRain or WeatherCondition.Thunderstorm => fRandom.Next(75, 95),
                WeatherCondition.LightRain => fRandom.Next(45, 75),
                WeatherCondition.Overcast or WeatherCondition.Cloudy => fRandom.Next(20, 45),
                _ => fRandom.Next(0, 15)
            };

            hourlyForecasts.Add(new HourlyForecast
            {
                Time = i == 0 ? "Ahora" : forecastTime.ToString("HH:00"),
                TemperatureC = fTemp,
                PrecipitationProbability = rainProb,
                Condition = fCondition,
                IconClass = GetIconForCondition(fCondition, fIsDay)
            });
        }

        // 7-day forecast
        var culture = new CultureInfo("es-ES");
        var dailyForecasts = new List<DailyForecast>();
        for (int d = 0; d < 7; d++)
        {
            var fDate = localTime.Date.AddDays(d);
            int dSeed = profile.Name.GetHashCode() ^ fDate.DayOfYear;
            var dRandom = new Random(dSeed);

            double dayBase = profile.BaseTemp + (dRandom.NextDouble() * 4.0 - 2.0);
            double minTemp = Math.Round(dayBase - (profile.TempVariance / 2.0), 1);
            double maxTemp = Math.Round(dayBase + (profile.TempVariance / 2.0), 1);

            var dCondition = (WeatherCondition)dRandom.Next(0, 8);
            int rainProb = dCondition switch
            {
                WeatherCondition.HeavyRain or WeatherCondition.Thunderstorm => dRandom.Next(70, 95),
                WeatherCondition.LightRain => dRandom.Next(40, 70),
                WeatherCondition.Cloudy => dRandom.Next(15, 40),
                _ => dRandom.Next(0, 15)
            };

            string dayLabel = d switch
            {
                0 => "Hoy",
                1 => "Mañana",
                _ => culture.DateTimeFormat.GetDayName(fDate.DayOfWeek)
            };
            dayLabel = char.ToUpper(dayLabel[0]) + dayLabel[1..];

            dailyForecasts.Add(new DailyForecast
            {
                Date = fDate,
                DayName = dayLabel,
                MinTempC = minTemp,
                MaxTempC = maxTemp,
                Condition = dCondition,
                ConditionDescription = GetConditionDescription(dCondition, true),
                IconClass = GetIconForCondition(dCondition, true),
                PrecipitationProbability = rainProb
            });
        }

        var report = new WeatherReport
        {
            City = profile.Name,
            Country = profile.Country,
            Region = profile.Region,
            Latitude = profile.Lat,
            Longitude = profile.Lon,
            LocalTime = localTime,
            DataSource = "Simulador Meteorológico ClimaSpace",
            IsLiveApi = false,
            Provider = "simulated",
            Current = currentWeather,
            Hourly = hourlyForecasts,
            Daily = dailyForecasts,
            PopularCities = PresetCities.Keys.Take(9).ToList()
        };

        return Task.FromResult(report);
    }

    private static CityProfile GenerateDeterministicProfile(string cityName)
    {
        int hash = Math.Abs(cityName.GetHashCode());
        double lat = Math.Round(((hash % 1400) / 10.0) - 70.0, 4);
        double lon = Math.Round(((hash % 3600) / 10.0) - 180.0, 4);
        int utcOffset = (int)Math.Round(lon / 15.0);

        double latAbs = Math.Abs(lat);
        double baseTemp = Math.Round(30.0 - (latAbs * 0.45), 1);
        if (baseTemp < -5.0) baseTemp = -5.0;

        WeatherCondition cond = (hash % 6) switch
        {
            0 => WeatherCondition.Sunny,
            1 => WeatherCondition.PartlyCloudy,
            2 => WeatherCondition.Cloudy,
            3 => WeatherCondition.LightRain,
            4 => WeatherCondition.Thunderstorm,
            _ => WeatherCondition.Sunny
        };

        return new CityProfile(
            Name: CultureInfo.CurrentCulture.TextInfo.ToTitleCase(cityName.ToLowerInvariant()),
            Country: "Ubicación Global",
            Region: "Simulado",
            Lat: lat,
            Lon: lon,
            UtcOffsetHours: utcOffset,
            BaseTemp: baseTemp,
            TempVariance: 6.5,
            DefaultCondition: cond
        );
    }

    private static WeatherCondition DetermineCurrentCondition(WeatherCondition baseCond, bool isDay, Random random)
    {
        if (!isDay && baseCond == WeatherCondition.Sunny)
        {
            return WeatherCondition.ClearNight;
        }

        if (random.Next(100) < 75)
        {
            return baseCond;
        }

        return (WeatherCondition)random.Next(0, 7);
    }

    private static string GetConditionDescription(WeatherCondition cond, bool isDay) => cond switch
    {
        WeatherCondition.Sunny => "Cielo completamente despejado",
        WeatherCondition.ClearNight => "Noche despejada y estrellada",
        WeatherCondition.PartlyCloudy => isDay ? "Parcialmente nublado con intervalos de sol" : "Parcialmente nublado",
        WeatherCondition.Cloudy => "Cielo mayormente nublado",
        WeatherCondition.Overcast => "Cubierto de nubes densas",
        WeatherCondition.LightRain => "Lloviznas y chubascos ligeros",
        WeatherCondition.HeavyRain => "Lluvia intensa persistente",
        WeatherCondition.Thunderstorm => "Tormentas eléctricas con precipitaciones",
        WeatherCondition.Snow => "Nevadas y temperaturas bajo cero",
        WeatherCondition.Fog => "Niebla densa con visibilidad reducida",
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
        _ => "bi-brightness-high-fill text-warning"
    };
}
