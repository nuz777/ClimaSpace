using ClimaSpace.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllersWithViews();
builder.Services.AddHttpClient();

// Weather Service Registrations
builder.Services.AddScoped<SimulatedWeatherService>();
builder.Services.AddScoped<OpenMeteoWeatherService>();

// Default primary provider: Live Open-Meteo API (with automatic fallback to simulation)
builder.Services.AddScoped<IWeatherService, OpenMeteoWeatherService>();

var app = builder.Build();

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
        name: "default",
        pattern: "{controller=Home}/{action=Index}/{id?}")
    .WithStaticAssets();

app.Run();
