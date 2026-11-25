namespace VayuVata.Models;

public static class AlertCategory
{
    /// <summary>Filter replacement and bin cleaning reminders.</summary>
    public const string Maintenance = "Maintenance";
    /// <summary>The machine itself misbehaves: offline, outer sensor not delivering.</summary>
    public const string MachineError = "MachineError";
    /// <summary>The air itself changed suddenly: AQI or temperature far from the 5-day average.</summary>
    public const string AbnormalReading = "AbnormalReading";
}

public static class AlertStatus
{
    public const string Normal = "Normal";        // a deviation was detected but has not lasted long enough to warn (monitoring)
    public const string Warning = "Warning";
    public const string Critical = "Critical";
    public const string Resolved = "Resolved";
}

public static class AlertType
{
    public const string FilterReplacement = "FilterReplacement";
    public const string BinCleaning = "BinCleaning";
    public const string DeviceOffline = "DeviceOffline";
    public const string OuterSensorFailure = "OuterSensorFailure";
    /// <summary>The device sends data, but one or more of its sensors send none (stopped).</summary>
    public const string SensorNoData = "SensorNoData";
    public const string AqiAbnormal = "AqiAbnormal";
    public const string TemperatureAbnormal = "TemperatureAbnormal";
}

/// <summary>The one row of alert settings (dbo.AlertConfiguration): maintenance intervals, abnormal-reading thresholds and notification timings. Edited by the Super Admin.</summary>
public class AlertConfiguration
{
    public int Id { get; set; } = 1;

    // ---- maintenance
    /// <summary>Filter replacement every N days (default 45 = 1.5 months).</summary>
    public int FilterIntervalDays { get; set; } = 45;
    /// <summary>Bin cleaning every N days (default 90 = 3 months).</summary>
    public int BinIntervalDays { get; set; } = 90;
    /// <summary>A Warning starts this many days BEFORE the due date.</summary>
    public int MaintenanceWarnDaysBefore { get; set; } = 7;
    /// <summary>It becomes Critical this many days AFTER the due date if still not done.</summary>
    public int MaintenanceCriticalOverdueDays { get; set; } = 7;
    /// <summary>While an alert stays open, the reminder email is repeated every N days.</summary>
    public int MaintenanceRepeatDays { get; set; } = 7;

    // ---- abnormal readings
    /// <summary>The baseline is the average of the previous N days.</summary>
    public int BaselineDays { get; set; } = 5;
    /// <summary>The current value is the average of the last N minutes.</summary>
    public int RecentWindowMinutes { get; set; } = 60;
    /// <summary>AQI is abnormal when it differs from the baseline by more than this percent AND by at least <see cref="AqiMinChange"/>.</summary>
    public decimal AqiChangePercent { get; set; } = 50;
    public decimal AqiMinChange { get; set; } = 40;
    /// <summary>Temperature is abnormal when it differs from the baseline by more than this many degrees C.</summary>
    public decimal TempChangeDegrees { get; set; } = 8;
    /// <summary>A baseline needs at least this many readings, otherwise nothing is judged.</summary>
    public int MinBaselineSamples { get; set; } = 200;

    // ---- timings
    /// <summary>An abnormal change that lasts this many hours raises a Warning for the Super Admin.</summary>
    public int WarningAfterHours { get; set; } = 7;
    /// <summary>Beyond this many hours the alert becomes Critical and goes to the Admin and the User as well.</summary>
    public int CriticalAfterHours { get; set; } = 24;
    /// <summary>The condition must be gone this long before the alert is Resolved (short dips do not restart the clock).</summary>
    public int ResolveGraceMinutes { get; set; } = 60;

    // ---- machine errors
    /// <summary>No reading for this many minutes = the device is offline.</summary>
    public int OfflineAfterMinutes { get; set; } = 60;
    /// <summary>Outer sensor failure: at least this percent of the last hour's readings miss the outer temperature or humidity.</summary>
    public int OuterMissingPercent { get; set; } = 50;
    /// <summary>A sensor has stopped when it sent no value for this many minutes while the device still sends readings. 5 minutes by default: the TVOC sensor needs 3 to 5 minutes to warm up after a start.</summary>
    public int SensorNoDataMinutes { get; set; } = 5;

    public bool EmailEnabled { get; set; } = true;
    public DateTime? UpdatedAt { get; set; }
    public int? UpdatedByUserId { get; set; }
}

/// <summary>When the filter was last replaced and the bin last cleaned, per device (dbo.DeviceMaintenance). Missing = counted from the device's registration date.</summary>
public class DeviceMaintenance
{
    public string DeviceCode { get; set; } = "";
    public Device Device { get; set; } = null!;
    public DateTime? FilterChangedAt { get; set; }
    public DateTime? BinCleanedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public int? UpdatedByUserId { get; set; }
}

/// <summary>One alert of one device (dbo.Alerts). At most one open alert per device and type; a new one is created after it was resolved.</summary>
public class Alert
{
    public int Id { get; set; }
    public string DeviceCode { get; set; } = "";
    public Device Device { get; set; } = null!;
    public string Category { get; set; } = AlertCategory.AbnormalReading;
    public string AlertType { get; set; } = "";
    public string Status { get; set; } = AlertStatus.Normal;
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? WarningAt { get; set; }
    /// <summary>Set when the alert became Critical; for abnormal readings this is also when it was escalated to the Admin and the User.</summary>
    public DateTime? CriticalAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastNotifiedAt { get; set; }
    public decimal? Value { get; set; }
    public decimal? Baseline { get; set; }
    public string? Detail { get; set; }
}

/// <summary>Insert-only alert history: every opening, escalation, reminder and resolution with date, time, device and type (dbo.AlertEvents).</summary>
public class AlertEvent
{
    public long Id { get; set; }
    public int AlertId { get; set; }
    public Alert Alert { get; set; } = null!;
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string DeviceCode { get; set; } = "";
    public string Category { get; set; } = "";
    public string AlertType { get; set; } = "";
    public string Status { get; set; } = "";
    public string? Detail { get; set; }
}
