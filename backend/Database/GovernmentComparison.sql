-- Government comparison tables (EF migration GovernmentComparison). Apply with the migration tool (--migrate); this script is the same DDL for manual use.
﻿CREATE TABLE [GovernmentStations] (
    [Id] int NOT NULL IDENTITY,
    [Name] nvarchar(200) NOT NULL,
    [City] nvarchar(100) NOT NULL,
    [State] nvarchar(100) NOT NULL,
    [Latitude] decimal(9,6) NOT NULL,
    [Longitude] decimal(9,6) NOT NULL,
    [LastSeenAt] datetime2(0) NOT NULL,
    CONSTRAINT [PK_GovernmentStations] PRIMARY KEY ([Id])
);
GO

CREATE TABLE [GovernmentSyncLogs] (
    [Id] bigint NOT NULL IDENTITY,
    [StartedAt] datetime2(0) NOT NULL,
    [CompletedAt] datetime2(0) NULL,
    [RecordsFetched] int NOT NULL,
    [StationsAdded] int NOT NULL,
    [ReadingsAdded] int NOT NULL,
    [Status] varchar(16) NOT NULL,
    [Error] nvarchar(500) NULL,
    [Trigger] varchar(16) NOT NULL,
    CONSTRAINT [PK_GovernmentSyncLogs] PRIMARY KEY ([Id])
);
GO

CREATE TABLE [DeviceStationMappings] (
    [Id] bigint NOT NULL IDENTITY,
    [device_id] nvarchar(64) NOT NULL,
    [StationId] int NOT NULL,
    [DistanceKm] decimal(8,3) NOT NULL,
    [DeviceLatitude] decimal(9,6) NOT NULL,
    [DeviceLongitude] decimal(9,6) NOT NULL,
    [MatchedAt] datetime2(0) NOT NULL,
    [ValidTo] datetime2(0) NULL,
    [Method] varchar(16) NOT NULL,
    CONSTRAINT [PK_DeviceStationMappings] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_DeviceStationMappings_Devices_device_id] FOREIGN KEY ([device_id]) REFERENCES [Devices] ([DeviceId]) ON DELETE NO ACTION,
    CONSTRAINT [FK_DeviceStationMappings_GovernmentStations_StationId] FOREIGN KEY ([StationId]) REFERENCES [GovernmentStations] ([Id]) ON DELETE NO ACTION
);
GO

CREATE TABLE [GovernmentStationReadings] (
    [Id] bigint NOT NULL IDENTITY,
    [StationId] int NOT NULL,
    [Pollutant] varchar(16) NOT NULL,
    [ObservedAt] datetime2(0) NOT NULL,
    [MinValue] decimal(10,2) NULL,
    [MaxValue] decimal(10,2) NULL,
    [AvgValue] decimal(10,2) NULL,
    [FetchedAt] datetime2(0) NOT NULL,
    CONSTRAINT [PK_GovernmentStationReadings] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_GovernmentStationReadings_GovernmentStations_StationId] FOREIGN KEY ([StationId]) REFERENCES [GovernmentStations] ([Id]) ON DELETE NO ACTION
);
GO

CREATE INDEX [IX_DeviceStationMappings_StationId] ON [DeviceStationMappings] ([StationId]);
GO

CREATE UNIQUE INDEX [UX_DeviceStationMappings_current] ON [DeviceStationMappings] ([device_id]) WHERE [ValidTo] IS NULL;
GO

CREATE UNIQUE INDEX [UX_GovernmentStationReadings_identity] ON [GovernmentStationReadings] ([StationId], [Pollutant], [ObservedAt]);
GO

CREATE UNIQUE INDEX [UX_GovernmentStations_identity] ON [GovernmentStations] ([Name], [Latitude], [Longitude]);
GO

INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
VALUES (N'20261016114631_GovernmentComparison', N'10.0.12');
GO

