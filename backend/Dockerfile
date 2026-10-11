# syntax=docker/dockerfile:1
# VayuVata API - multi-stage build. Runs as a non-root user and listens on 8080.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
# Restore first so the layer is cached until the package list changes.
COPY VayuVata.csproj ./
RUN dotnet restore
COPY . .
RUN dotnet publish VayuVata.csproj -c Release -o /app/publish --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish ./
ENV ASPNETCORE_URLS=http://+:8080 \
    DOTNET_EnableDiagnostics=0
EXPOSE 8080
# Built-in non-root account of the official image.
USER $APP_UID
ENTRYPOINT ["dotnet", "VayuVata.dll"]
