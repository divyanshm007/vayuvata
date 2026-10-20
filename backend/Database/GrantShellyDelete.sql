-- Run ONCE with the migration login. The runtime login normally cannot delete anything except refresh tokens;
-- deleting a Shelly switch (SuperAdmin only) needs DELETE on exactly these two tables and nothing else.
GRANT DELETE ON dbo.ShellyDevices TO vayuvata_uat;
GRANT DELETE ON dbo.ShellyCommands TO vayuvata_uat;
GO
