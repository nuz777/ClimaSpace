using ClimaSpace.Services;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);

// Soporte para variable de entorno PORT inyectada por Render, Railway u otros hosts cloud
var cloudPort = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(cloudPort))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{cloudPort}");
}

// Configuración de cabeceras reenviadas (Reverse Proxy / SSL termination en Render)
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

// Add services to the container.
builder.Services.AddControllersWithViews();
builder.Services.AddHttpClient();

// Weather Service Registrations
builder.Services.AddScoped<SimulatedWeatherService>();
builder.Services.AddScoped<OpenMeteoWeatherService>();
builder.Services.AddScoped<WindService>();

// Default primary provider: Live Open-Meteo API (with automatic fallback to simulation)
builder.Services.AddScoped<IWeatherService, OpenMeteoWeatherService>();

var app = builder.Build();

app.UseForwardedHeaders();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();

app.UseAuthorization();

app.MapStaticAssets();

app.MapControllerRoute(
    name: "viento",
    pattern: "viento",
    defaults: new { controller = "Home", action = "Viento" });

app.MapControllerRoute(
        name: "default",
        pattern: "{controller=Home}/{action=Index}/{id?}")
    .WithStaticAssets();

app.Run();
