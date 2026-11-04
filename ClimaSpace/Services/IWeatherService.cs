namespace ClimaSpace.Services;

using ClimaSpace.Models;

public interface IWeatherService
{
    Task<WeatherReport> GetWeatherReportAsync(string? cityName);
    Task<IReadOnlyList<string>> GetPopularCitiesAsync();
}
