using VayuVata.Helpers;

namespace VayuVata.DTOs.Alerts;

public class AlertDto
{
    public int Id { get; set; }
    public string DeviceId { get; set; } = "";
    public string DeviceName { get; set; } = "";
    /// <summary>Maintenance | MachineError | AbnormalReading</summary>
    public string Category { get; set; } = "";
    public string AlertType { get; set; } = "";
    /// <summary>Normal (watching) | Warning | Critical | Resolved</summary>
    public string Status { get; set; } = "";
    public DateTime StartedAt { get; set; }
    public DateTime? WarningAt { get; set; }
    public DateTime? CriticalAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public decimal? Value { get; set; }
    public decimal? Baseline { get; set; }
    public string? Detail { get; set; }
}

public class AlertQuery : PageQuery
{
    public string? Status { get; set; }
    public string? Category { get; set; }
    public string? DeviceId { get; set; }
}

public class AlertSummaryDto
{
    /// <summary>Devices in the caller's scope with no open Warning or Critical alert.</summary>
    public int NormalDevices { get; set; }
    public int WarningAlerts { get; set; }
    public int CriticalAlerts { get; set; }
    /// <summary>Alerts resolved in the last 7 days.</summary>
    public int ResolvedLast7Days { get; set; }
    public int MaintenanceOpen { get; set; }
    public int MachineErrorsOpen { get; set; }
    public int AbnormalReadingsOpen { get; set; }
    public int TotalDevices { get; set; }
}

public class AlertEventDto
{
    public long Id { get; set; }
    public int AlertId { get; set; }
    public DateTime At { get; set; }
    public string DeviceId { get; set; } = "";
    public string Category { get; set; } = "";
    public string AlertType { get; set; } = "";
    public string Status { get; set; } = "";
    public string? Detail { get; set; }
}

public class MaintenanceItemDto
{
    /// <summary>FilterReplacement | BinCleaning</summary>
    public string AlertType { get; set; } = "";
    public DateTime? LastDoneAt { get; set; }
    /// <summary>true when no date was recorded and the device registration date is used.</summary>
    public bool FromRegistration { get; set; }
    public DateTime DueAt { get; set; }
    public int DaysLeft { get; set; }
    /// <summary>Normal | Warning | Critical</summary>
    public string Status { get; set; } = "Normal";
}

public class DeviceMaintenanceDto
{
    public string DeviceId { get; set; } = "";
    public string DeviceName { get; set; } = "";
    public MaintenanceItemDto Filter { get; set; } = new();
    public MaintenanceItemDto Bin { get; set; } = new();
}

public class MarkMaintenanceDoneRequest
{
    /// <summary>FilterReplacement or BinCleaning.</summary>
    public string AlertType { get; set; } = "";
    /// <summary>When it was done (UTC). Omit for now. Not in the future.</summary>
    public DateTime? DoneAt { get; set; }
}

public class AlertConfigDto
{
    public int FilterIntervalDays { get; set; } = 45;
    public int BinIntervalDays { get; set; } = 90;
    public int MaintenanceWarnDaysBefore { get; set; } = 7;
    public int MaintenanceCriticalOverdueDays { get; set; } = 7;
    public int MaintenanceRepeatDays { get; set; } = 7;
    public int BaselineDays { get; set; } = 5;
    public int RecentWindowMinutes { get; set; } = 60;
    public decimal AqiChangePercent { get; set; } = 50;
    public decimal AqiMinChange { get; set; } = 40;
    public decimal TempChangeDegrees { get; set; } = 8;
    public int MinBaselineSamples { get; set; } = 200;
    public int WarningAfterHours { get; set; } = 7;
    public int CriticalAfterHours { get; set; } = 24;
    public int ResolveGraceMinutes { get; set; } = 60;
    public int OfflineAfterMinutes { get; set; } = 60;
    public int OuterMissingPercent { get; set; } = 50;
    public bool EmailEnabled { get; set; } = true;
    public DateTime? UpdatedAt { get; set; }
}

public class EvaluateResultDto
{
    public int Opened { get; set; }
    public int Escalated { get; set; }
    public int Resolved { get; set; }
    public int Emails { get; set; }
}
