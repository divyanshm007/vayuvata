using Microsoft.EntityFrameworkCore;

namespace VayuVata.Helpers;

public class PageQuery
{
    public const int MaxPageSize = 100;
    private int _page = 1, _pageSize = 20;

    /// <summary>1-based page number.</summary>
    public int Page { get => _page; set => _page = Math.Max(1, value); }
    /// <summary>Items per page (1-100, default 20).</summary>
    public int PageSize { get => _pageSize; set => _pageSize = Math.Clamp(value, 1, MaxPageSize); }
}

public class PagedResult<T>
{
    public List<T> Items { get; set; } = [];
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalCount { get; set; }
    public int TotalPages => PageSize == 0 ? 0 : (int)Math.Ceiling(TotalCount / (double)PageSize);
}

public static class PaginationExtensions
{
    public static async Task<PagedResult<T>> ToPagedAsync<T>(this IQueryable<T> query, PageQuery p, CancellationToken ct = default)
    {
        var total = await query.CountAsync(ct);
        var items = await query.Skip((p.Page - 1) * p.PageSize).Take(p.PageSize).ToListAsync(ct);
        return new PagedResult<T> { Items = items, Page = p.Page, PageSize = p.PageSize, TotalCount = total };
    }
}
