using System.Threading.Tasks;

namespace ZKube.Integration
{
    public interface IPublicClientStore
    {
        Task<string> Read(string owner, string field);
        Task Write(string owner, string field, string value);
        Task<bool> CompareExchange(string owner, string field, string expected, string value);
    }
}
