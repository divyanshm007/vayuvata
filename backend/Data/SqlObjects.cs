using System.Reflection;

namespace VayuVata.Data;

/// <summary>SQL scripts under Database/Objects, embedded in the assembly so migrations apply exactly the reviewed text.</summary>
public static class SqlObjects
{
    public static string Read(string fileName)
    {
        var asm = typeof(SqlObjects).Assembly;
        using var s = asm.GetManifestResourceStream($"SqlObjects.{fileName}")
                      ?? throw new InvalidOperationException($"Embedded SQL object '{fileName}' not found.");
        using var r = new StreamReader(s);
        return r.ReadToEnd();
    }
}
