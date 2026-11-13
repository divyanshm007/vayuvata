using System.Net;
using System.Net.Sockets;
using System.Text;
using MailKit.Security;
using MimeKit;
using Microsoft.Extensions.Options;

namespace VayuVata.Services;

public class EmailOptions
{
    /// <summary>Smtp = send through the SMTP server below. File = write each email as a text file into <see cref="FileDirectory"/> (local testing). None = send nothing (the attempt is still logged as NotConfigured).</summary>
    public string Provider { get; set; } = "None";
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    /// <summary>true = STARTTLS / SSL (almost every provider). The password is read from configuration / environment only, never stored in the database.</summary>
    public bool UseSsl { get; set; } = true;
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    public string FromAddress { get; set; } = "";
    public string FromName { get; set; } = "LIVVAir Protect";
    public string FileDirectory { get; set; } = "";
    public int TimeoutSeconds { get; set; } = 20;
}

public record EmailMessage(string To, string Subject, string Html, string Text);
public record EmailResult(string Status, string? Error = null)
{
    public static EmailResult Sent() => new("Sent");
}

/// <summary>The one place that sends email. Everything else (registration, approval, invitations, notifications) goes through it.</summary>
public interface IEmailSender
{
    Task<EmailResult> SendAsync(EmailMessage message, CancellationToken ct);
}

public class EmailSender(IOptions<EmailOptions> options, ILogger<EmailSender> log) : IEmailSender
{
    private readonly EmailOptions _o = options.Value;

    public async Task<EmailResult> SendAsync(EmailMessage m, CancellationToken ct)
    {
        switch (_o.Provider.Trim().ToLowerInvariant())
        {
            case "file":
                try
                {
                    Directory.CreateDirectory(_o.FileDirectory);
                    var name = $"{DateTime.UtcNow:yyyyMMdd-HHmmss-fff}-{Guid.NewGuid():N}"[..40] + ".txt";
                    await File.WriteAllTextAsync(Path.Combine(_o.FileDirectory, name), $"To: {m.To}\nSubject: {m.Subject}\n\n{m.Text}\n", Encoding.UTF8, ct);
                    return EmailResult.Sent();
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return new("Failed", ex.Message); }

            case "smtp":
                if (string.IsNullOrWhiteSpace(_o.Host) || string.IsNullOrWhiteSpace(_o.FromAddress)) return new("NotConfigured", "SMTP host or from-address is not configured.");
                try
                {
                    var msg = new MimeMessage();
                    msg.From.Add(new MailboxAddress(_o.FromName, _o.FromAddress));
                    msg.To.Add(MailboxAddress.Parse(m.To));
                    msg.Subject = m.Subject;
                    msg.Body = new BodyBuilder { HtmlBody = m.Html, TextBody = m.Text }.ToMessageBody();

                    using var client = new MailKit.Net.Smtp.SmtpClient { Timeout = _o.TimeoutSeconds * 1000 };
                    var secure = _o.Port == 465 ? SecureSocketOptions.SslOnConnect : _o.UseSsl ? SecureSocketOptions.StartTls : SecureSocketOptions.None;
                    using var socket = await ConnectAsync(_o.Host, _o.Port, ct);
                    await client.ConnectAsync(socket, _o.Host, _o.Port, secure, ct);
                    if (!string.IsNullOrEmpty(_o.User)) await client.AuthenticateAsync(_o.User, _o.Password, ct);
                    await client.SendAsync(msg, ct);
                    await client.DisconnectAsync(true, ct);
                    return EmailResult.Sent();
                }
                catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
                {
                    var why = ex.InnerException?.Message ?? ex.Message;
                    log.LogWarning("Email to {To} failed: {Message}", Mask(m.To), why);
                    return new("Failed", why.Length > 280 ? why[..280] : why);
                }

            default:
                return new("NotConfigured", "Email sending is not configured (Email:Provider).");
        }
    }

    /// <summary>Opens the TCP connection trying IPv4 addresses first: on networks where IPv6 is advertised but not routed, the default connect waits for the IPv6 attempt and times out.</summary>
    private async Task<Socket> ConnectAsync(string host, int port, CancellationToken ct)
    {
        var addresses = (await Dns.GetHostAddressesAsync(host, ct)).OrderBy(a => a.AddressFamily == AddressFamily.InterNetwork ? 0 : 1).ToArray();
        Exception? last = null;
        foreach (var a in addresses)
        {
            var socket = new Socket(a.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(TimeSpan.FromSeconds(Math.Max(3, _o.TimeoutSeconds / 3)));
                await socket.ConnectAsync(new IPEndPoint(a, port), cts.Token);
                return socket;
            }
            catch (Exception ex) { socket.Dispose(); last = ex; if (ct.IsCancellationRequested) throw; }
        }
        throw last ?? new SocketException((int)SocketError.HostNotFound);
    }

    private static string Mask(string email) { var at = email.IndexOf('@'); return at <= 1 ? "***" : email[0] + "***" + email[at..]; }
}

/// <summary>Plain, consistent HTML for every email. Names and other user input are always HTML-encoded.</summary>
public static class EmailTemplates
{
    public static string H(string? s) => WebUtility.HtmlEncode(s ?? "");

    public static EmailMessage Build(string to, string subject, string heading, string[] paragraphs, string? buttonText = null, string? buttonUrl = null, string? footer = null)
    {
        var html = new StringBuilder();
        html.Append("<div style=\"font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#14261b\">");
        html.Append($"<h2 style=\"color:#166534;margin:0 0 16px\">{H(heading)}</h2>");
        foreach (var p in paragraphs) html.Append($"<p style=\"line-height:1.5\">{p}</p>");     // paragraphs are built by the caller from H()-encoded parts
        if (buttonText is not null && buttonUrl is not null)
            html.Append($"<p style=\"margin:24px 0\"><a href=\"{H(buttonUrl)}\" style=\"background:#16A34A;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600\">{H(buttonText)}</a></p>")
                .Append($"<p style=\"font-size:12px;color:#64748b\">If the button does not work, copy this link into your browser:<br>{H(buttonUrl)}</p>");
        if (footer is not null) html.Append($"<p style=\"font-size:12px;color:#64748b\">{H(footer)}</p>");
        html.Append("<hr style=\"border:none;border-top:1px solid #e2e8f0;margin:24px 0\"><p style=\"font-size:12px;color:#94a3b8\">LIVVAir Protect · this is an automated message.</p></div>");

        var text = new StringBuilder(heading).Append("\n\n");
        foreach (var p in paragraphs) text.Append(WebUtility.HtmlDecode(System.Text.RegularExpressions.Regex.Replace(p, "<[^>]+>", ""))).Append("\n\n");
        if (buttonText is not null && buttonUrl is not null) text.Append(buttonText).Append(": ").Append(buttonUrl).Append("\n\n");
        if (footer is not null) text.Append(footer).Append("\n");
        return new EmailMessage(to, subject, html.ToString(), text.ToString());
    }
}
