# ==============================================================================
# ClimaSpace - Dockerfile Multi-Stage (.NET 10)
# ==============================================================================

# Etapa 1: Compilación con .NET 10 SDK
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copiar definición del proyecto y restaurar dependencias
COPY ["ClimaSpace/ClimaSpace.csproj", "ClimaSpace/"]
RUN dotnet restore "ClimaSpace/ClimaSpace.csproj"

# Copiar el código fuente completo
COPY . .
WORKDIR "/src/ClimaSpace"
RUN dotnet build "ClimaSpace.csproj" -c Release -o /app/build

# Etapa 2: Publicación
FROM build AS publish
RUN dotnet publish "ClimaSpace.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Etapa 3: Imagen Final de Runtime ASP.NET Core 10
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
EXPOSE 8080
ENV ASPNETCORE_HTTP_PORTS=8080
ENV ASPNETCORE_ENVIRONMENT=Production

COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "ClimaSpace.dll"]
