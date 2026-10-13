using System.Text.RegularExpressions;

namespace VayuVata.Helpers;

/// <summary>
/// Keeps secrets out of logs. Request logging never records headers, bodies or query strings; this is the second line of defence
/// for the few free-text values that are logged (request path, e-mail addresses, exception messages).
/// </summary>
public static partial class LogRedactor
{
    [GeneratedRegex(@"eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}(\.[A-Za-z0-9_\-]*)?")] private static partial Regex Jwt();
    [GeneratedRegex(@"vv_[A-Za-z0-9_\-]{16,}")] private static partial Regex DeviceKey();
    [GeneratedRegex(@"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=\-]{8,}")] private static partial Regex AuthHeader();
    [GeneratedRegex(@"(?i)\b(password|pwd|secret|apikey|api_key|x-device-key|authorization|token)\s*[=:]\s*[^\s;,&""']+")] private static partial Regex KeyValue();

    /// <summary>Removes control characters (log forging) and masks anything that looks like a credential.</summary>
    public static string Clean(string? value, int maxLength = 200)
    {
        if (string.IsNullOrEmpty(value)) return "";
        var s = value.Length > maxLength ? value[..maxLength] : value;
        s = string.Create(s.Length, s, static (span, src) => { for (var i = 0; i < src.Length; i++) span[i] = char.IsControl(src[i]) ? '?' : src[i]; });
        s = Jwt().Replace(s, "[redacted-jwt]");
        s = DeviceKey().Replace(s, "[redacted-key]");
        s = AuthHeader().Replace(s, "$1 [redacted]");
        return KeyValue().Replace(s, m => m.Value[..(m.Value.IndexOfAny([':', '=']) + 1)] + "[redacted]");
    }

    /// <summary>a***@example.com - enough to correlate an attempt, not enough to harvest addresses from logs.</summary>
    public static string MaskEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return "(empty)";
        var e = Clean(email.Trim(), 256);
        var at = e.IndexOf('@');
        return at <= 0 ? "***" : e[0] + "***" + e[at..];
    }
}
