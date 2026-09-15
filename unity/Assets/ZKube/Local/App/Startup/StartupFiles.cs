namespace ZKube.Local.App
{
    internal static class StartupFiles
    {
        internal static string Read(string path) => ZKube.Persistence.AtomicProductFile.Read(path);
        internal static void Write(string path, string value) => ZKube.Persistence.AtomicProductFile.Write(path, value);
    }
}
