using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using VayuVata.Data;
using VayuVata.DTOs.Registration;
using VayuVata.Models;

namespace VayuVata.Services;

/// <summary>Sends emails through the one email service (<see cref="IEmailSender"/>) and records every attempt in dbo.EmailLogs. Shared by registration and video management.</summary>
public class NotificationService(VayuVataDbContext db, IEmailSender email, IOptions<RegistrationOptions> options)
{
    private readonly RegistrationOptions _o = options.Value;

    /// <summary>Super Admin notification addresses: the configured override, otherwise the active Super Admin accounts' own emails.</summary>
    public async Task<List<string>> SuperAdminEmailsAsync(CancellationToken ct)
    {
        var configured = _o.SuperAdminNotifyEmails.Select(e => (e ?? "").Trim().ToLowerInvariant()).Where(e => e.Length > 0).Distinct().ToList();
        if (configured.Count > 0) return configured;
        return await db.Users.AsNoTracking().Where(u => u.Role == Roles.SuperAdmin && u.IsActive).Select(u => u.Email).Distinct().ToListAsync(ct);
    }

    /// <summary>Sends one email and records the outcome. A failed email never fails the operation that caused it.</summary>
    public async Task<EmailOutcomeDto> SendAsync(string template, EmailMessage msg, int? requestId, int? userId, CancellationToken ct)
    {
        EmailResult result;
        try { result = await email.SendAsync(msg, ct); }
        catch (Exception ex) when (ex is not OperationCanceledException) { result = new("Failed", ex.Message.Length > 280 ? ex.Message[..280] : ex.Message); }
        db.EmailLogs.Add(new EmailLog { ToEmail = msg.To, Subject = msg.Subject.Length > 200 ? msg.Subject[..200] : msg.Subject, Template = template, Status = result.Status, Error = result.Error, RequestId = requestId, UserId = userId });
        await db.SaveChangesAsync(CancellationToken.None);
        return new EmailOutcomeDto { To = msg.To, Template = template, Status = result.Status };
    }

    public async Task<List<EmailOutcomeDto>> ToSuperAdminsAsync(string template, string subject, string heading, string[] paragraphs, int? requestId, int? userId, CancellationToken ct)
    {
        var list = new List<EmailOutcomeDto>();
        foreach (var to in await SuperAdminEmailsAsync(ct))
            list.Add(await SendAsync(template, EmailTemplates.Build(to, subject, heading, paragraphs), requestId, userId, ct));
        return list;
    }
}
