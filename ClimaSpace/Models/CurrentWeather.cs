namespace ClimaSpace.Models;

public class CurrentWeather
{
    public double TemperatureC { get; set; }
    public double TemperatureF => Math.Round(TemperatureC * 9.0 / 5.0 + 32.0, 1);

    public double FeelsLikeC { get; set; }
    public double FeelsLikeF => Math.Round(FeelsLikeC * 9.0 / 5.0 + 32.0, 1);

    public int Humidity { get; set; }
    public double WindSpeedKmh { get; set; }
    public string WindDirection { get; set; } = "NE";
    public int PressureHpa { get; set; } = 1013;
    public int UvIndex { get; set; }
    public double VisibilityKm { get; set; } = 10.0;
    public double DewPointC { get; set; }
    public string AirQuality { get; set; } = "Buena (AQI 35)";

    public WeatherCondition Condition { get; set; }
    public string ConditionDescription { get; set; } = string.Empty;
    public double PrecipitationMm { get; set; }
    public string IconClass { get; set; } = "bi-sun-fill";
    public bool IsDay { get; set; } = true;

    public string Sunrise { get; set; } = "06:05";
    public string Sunset { get; set; } = "18:20";
}
