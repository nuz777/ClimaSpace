namespace ClimaSpace.Models;

public class WeatherReport
{
    public string City { get; set; } = string.Empty;
    public string Country { get; set; } = string.Empty;
    public string Region { get; set; } = string.Empty;
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public DateTime LocalTime { get; set; }

    public CurrentWeather Current { get; set; } = new();
    public List<HourlyForecast> Hourly { get; set; } = [];
    public List<DailyForecast> Daily { get; set; } = [];

    public IReadOnlyList<string> PopularCities { get; set; } = [];

    // Helper for CSS styling depending on weather status & day/night
    public string ThemeClass => Current switch
    {
        { IsDay: false } => "theme-night",
        { Condition: WeatherCondition.Sunny } => "theme-sunny",
        { Condition: WeatherCondition.PartlyCloudy } => "theme-partly-cloudy",
        { Condition: WeatherCondition.Cloudy or WeatherCondition.Overcast } => "theme-cloudy",
        { Condition: WeatherCondition.LightRain or WeatherCondition.HeavyRain } => "theme-rainy",
        { Condition: WeatherCondition.Thunderstorm } => "theme-stormy",
        { Condition: WeatherCondition.Snow } => "theme-snow",
        { Condition: WeatherCondition.Fog } => "theme-fog",
        _ => "theme-default"
    };
}
