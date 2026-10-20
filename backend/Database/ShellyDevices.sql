CREATE TABLE [ShellyDevices] (
    [Id] int NOT NULL IDENTITY,
    [Name] nvarchar(150) NOT NULL,
    [ShellyId] varchar(32) NOT NULL,
    [AuthKey] nvarchar(300) NOT NULL,
    [CloudHost] varchar(100) NOT NULL,
    [Channel] tinyint NOT NULL,
    [device_id] nvarchar(64) NULL,
    [IsActive] bit NOT NULL DEFAULT CAST(1 AS bit),
    [CreatedAt] datetime2(3) NOT NULL DEFAULT (SYSUTCDATETIME()),
    [UpdatedAt] datetime2(3) NULL,
    CONSTRAINT [PK_ShellyDevices] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_ShellyDevices_Devices_device_id] FOREIGN KEY ([device_id]) REFERENCES [Devices] ([DeviceId]) ON DELETE NO ACTION
);
GO

CREATE TABLE [ShellyCommands] (
    [Id] bigint NOT NULL IDENTITY,
    [ShellyDeviceId] int NOT NULL,
    [UserId] int NOT NULL,
    [TurnOn] bit NOT NULL,
    [Succeeded] bit NOT NULL,
    [Error] nvarchar(300) NULL,
    [At] datetime2(3) NOT NULL DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT [PK_ShellyCommands] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_ShellyCommands_ShellyDevices_ShellyDeviceId] FOREIGN KEY ([ShellyDeviceId]) REFERENCES [ShellyDevices] ([Id]) ON DELETE NO ACTION,
    CONSTRAINT [FK_ShellyCommands_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [Users] ([Id]) ON DELETE NO ACTION
);
GO

CREATE INDEX [IX_ShellyCommands_device_at] ON [ShellyCommands] ([ShellyDeviceId], [At]);
GO

CREATE INDEX [IX_ShellyCommands_UserId] ON [ShellyCommands] ([UserId]);
GO

CREATE UNIQUE INDEX [UX_ShellyDevices_device] ON [ShellyDevices] ([device_id]) WHERE [device_id] IS NOT NULL;
GO

CREATE UNIQUE INDEX [UX_ShellyDevices_ShellyId] ON [ShellyDevices] ([ShellyId]);
GO

INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
VALUES (N'20261020194845_ShellyDevices', N'10.0.12');
GO

