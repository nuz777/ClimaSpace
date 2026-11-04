using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using ClimaSpace.Models;
using ClimaSpace.Services;

namespace ClimaSpace.Controllers;

public class HomeController : Controller
{
    private readonly IWeatherService _weatherService;
    private readonly ILogger<HomeController> _logger;

    public HomeController(IWeatherService weatherService, ILogger<HomeController> logger)
    {
        _weatherService = weatherService;
        _logger = logger;
    }

    public async Task<IActionResult> Index(string? city = "Bogotá")
    {
        try
        {
            var weatherReport = await _weatherService.GetWeatherReportAsync(city);
            return View(weatherReport);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error al obtener reporte climático para la ciudad: {City}", city);
            return View("Error", new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }
    }

    [HttpGet]
    public async Task<IActionResult> QuickSearch(string query)
    {
        var cities = await _weatherService.GetPopularCitiesAsync();
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
