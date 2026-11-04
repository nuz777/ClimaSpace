namespace ClimaSpace.Models;

public class DailyForecast
{
    public DateTime Date { get; set; }
    public string DayName { get; set; } = string.Empty;
    public double MinTempC { get; set; }
    public double MaxTempC { get; set; }
    public double MinTempF => Math.Round(MinTempC * 9.0 / 5.0 + 32.0, 1);
    public double MaxTempF => Math.Round(MaxTempC * 9.0 / 5.0 + 32.0, 1);
    public int PrecipitationProbability { get; set; }
    public WeatherCondition Condition { get; set; }
    public string ConditionDescription { get; set; } = string.Empty;
    public string IconClass { get; set; } = "bi-sun-fill";
}
