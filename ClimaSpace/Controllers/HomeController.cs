using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using ClimaSpace.Models;
using ClimaSpace.Services;

namespace ClimaSpace.Controllers;

public class HomeController : Controller
{
    private readonly OpenMeteoWeatherService _openMeteoService;
    private readonly SimulatedWeatherService _simulatedService;
    private readonly ILogger<HomeController> _logger;

    public HomeController(
        OpenMeteoWeatherService openMeteoService,
        SimulatedWeatherService simulatedService,
        ILogger<HomeController> logger)
    {
        _openMeteoService = openMeteoService;
        _simulatedService = simulatedService;
        _logger = logger;
    }

    public async Task<IActionResult> Index(string? city = "Bogotá, Colombia", string? provider = "live")
    {
        city = string.IsNullOrWhiteSpace(city) ? "Bogotá, Colombia" : city.Trim();
        provider = string.Equals(provider, "simulated", StringComparison.OrdinalIgnoreCase) ? "simulated" : "live";

        try
        {
            WeatherReport weatherReport;
            if (provider == "simulated")
            {
                weatherReport = await _simulatedService.GetWeatherReportAsync(city);
                weatherReport.Provider = "simulated";
            }
            else
            {
                weatherReport = await _openMeteoService.GetWeatherReportAsync(city);
                weatherReport.Provider = "live";
            }

            return View(weatherReport);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error al obtener reporte climático para la ciudad: {City}", city);
            return View("Error", new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetWeatherData(string? city = "Bogotá, Colombia", string? provider = "live")
    {
        city = string.IsNullOrWhiteSpace(city) ? "Bogotá, Colombia" : city.Trim();
        provider = string.Equals(provider, "simulated", StringComparison.OrdinalIgnoreCase) ? "simulated" : "live";

        try
        {
            WeatherReport weatherReport;
            if (provider == "simulated")
            {
                weatherReport = await _simulatedService.GetWeatherReportAsync(city);
                weatherReport.Provider = "simulated";
            }
            else
            {
                weatherReport = await _openMeteoService.GetWeatherReportAsync(city);
                weatherReport.Provider = "live";
            }

            return Json(weatherReport);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error en GetWeatherData para la ciudad: {City}", city);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpGet]
    public async Task<IActionResult> QuickSearch(string query)
    {
        var cities = await _simulatedService.GetPopularCitiesAsync();
        var filtered = cities.Where(c => c.Contains(query, StringComparison.OrdinalIgnoreCase)).ToList();
        return Json(filtered);
    }

    public IActionResult Privacy()
    {
        return View();
    }

    [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
    public IActionResult Error()
    {
        return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
    }
}
