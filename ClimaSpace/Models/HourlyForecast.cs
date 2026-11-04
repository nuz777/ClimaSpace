namespace ClimaSpace.Models;

public class HourlyForecast
{
    public string Time { get; set; } = string.Empty;
    public double TemperatureC { get; set; }
    public double TemperatureF => Math.Round(TemperatureC * 9.0 / 5.0 + 32.0, 1);
    public int PrecipitationProbability { get; set; }
    public WeatherCondition Condition { get; set; }
    public string IconClass { get; set; } = "bi-sun-fill";
}
