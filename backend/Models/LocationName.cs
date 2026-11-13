namespace VayuVata.Models;

/// <summary>
/// Cached place name of a position ("Vasundhara, Ghaziabad, Uttar Pradesh"), so the map service is asked once per spot, not on every page view.
/// The key is the position rounded to 4 decimals (about 11 m).
/// </summary>
public class LocationName
{
    public int Id { get; set; }
    public decimal LatKey { get; set; }
    public decimal LonKey { get; set; }
    public string Name { get; set; } = "";
    public DateTime FetchedAt { get; set; } = DateTime.UtcNow;
}
