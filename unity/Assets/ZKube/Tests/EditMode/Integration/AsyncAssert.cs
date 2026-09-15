using System;
using System.Threading.Tasks;
using NUnit.Framework;

namespace ZKube.Integration.Tests
{
    public static class AsyncAssert
    {
        // NUnit's synchronous ThrowsAsync adapter can block Unity's main-thread
        // context while the operation needs that same context to complete.
        public static async Task<T> Throws<T>(Func<Task> action, string message = null) where T : Exception
        {
            try { await action(); }
            catch (T error) { return error; }
            Assert.Fail(message ?? "Expected " + typeof(T).Name);
            return null;
        }
    }
}
