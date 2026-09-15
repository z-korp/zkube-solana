using System.IO;
using System.Text;

namespace ZKube.Local.App
{
    // Scene-owned product file and separate evidence-store file use the same
    // flushed sibling write + atomic publication. Never promote an incomplete
    // .pending file after restart.
    internal static class StartupFiles
    {
        internal static string Read(string path)
        {
            try { return File.ReadAllText(path); }
            catch (FileNotFoundException) { return null; }
            catch (DirectoryNotFoundException) { return null; }
            // Access/I/O failures are not evidence of an absent saved product.
        }
        internal static void Write(string path, string value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string pending = path + ".pending";
            try
            {
                using (var stream = new FileStream(pending, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    var bytes = Encoding.UTF8.GetBytes(value);
                    stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
                }
                if (File.Exists(path)) File.Replace(pending, path, null);
                else File.Move(pending, path);
            }
            finally { if (File.Exists(pending)) File.Delete(pending); }
        }
    }
}
