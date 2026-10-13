namespace VayuVata.Services;

/// <summary>
/// Device-clock semantics of POST /api/v1/sensor-data. These defaults reproduce the behaviour the live UAT service has had since
/// 11 Oct 2026 (the ESP32 reports its local IST wall-clock time as recordedAt), so the existing device keeps working unchanged.
/// </summary>
public class IngestOptions
{
    /// <summary>How far ahead of UTC a device-supplied recordedAt may be (IST is UTC+5:30, so a device clock that is labelled UTC is up to 5.5 h "ahead").</summary>
    public int FutureToleranceMinutes { get; set; } = 360;
    /// <summary>When the device omits recordedAt the server stamps "now" plus this offset (330 = IST wall-clock, matching the device and the created_at default).</summary>
    public int MissingRecordedAtOffsetMinutes { get; set; } = 330;
}

/// <summary>Device authentication switches.</summary>
public class DeviceAuthOptions
{
    /// <summary>
    /// SECURITY-SENSITIVE, default false. When true a device may present the stored SHA-256 key HASH (what is visible in the Devices table)
    /// instead of its raw key. The live ESP32 currently authenticates this way, so UAT enables it explicitly; turning it off requires
    /// reflashing the device with its real vv_ key.
    /// </summary>
    public bool AcceptStoredHashAsKey { get; set; }
}
