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
    /// <summary>
    /// Default true (unchanged behaviour). Pass <c>includeTotal=false</c> to skip the COUNT(*) query on large lists;
    /// <c>totalCount</c>/<c>totalPages</c> are then null and <c>hasNextPage</c> tells whether another page exists.
    /// </summary>
    public bool IncludeTotal { get; set; } = true;
}

public class PagedResult<T>
{
    public List<T> Items { get; set; } = [];
    public int Page { get; set; }
    public int PageSize { get; set; }
    /// <summary>Total matching rows; null when the request passed includeTotal=false.</summary>
    public int? TotalCount { get; set; }
    public int? TotalPages => TotalCount is null ? null : PageSize == 0 ? 0 : (int)Math.Ceiling(TotalCount.Value / (double)PageSize);
    /// <summary>True when at least one more page follows this one.</summary>
    public bool HasNextPage { get; set; }
}

public static class PaginationExtensions
{
    public static async Task<PagedResult<T>> ToPagedAsync<T>(this IQueryable<T> query, PageQuery p, CancellationToken ct = default)
    {
        var skip = (p.Page - 1) * p.PageSize;
        if (p.IncludeTotal)
        {
            var total = await query.CountAsync(ct);
            var items = await query.Skip(skip).Take(p.PageSize).ToListAsync(ct);
            return new PagedResult<T> { Items = items, Page = p.Page, PageSize = p.PageSize, TotalCount = total, HasNextPage = skip + items.Count < total };
        }
        // No COUNT(*): read one extra row to learn whether a next page exists.
        var rows = await query.Skip(skip).Take(p.PageSize + 1).ToListAsync(ct);
        var more = rows.Count > p.PageSize;
        if (more) rows.RemoveAt(rows.Count - 1);
        return new PagedResult<T> { Items = rows, Page = p.Page, PageSize = p.PageSize, HasNextPage = more };
    }
}
