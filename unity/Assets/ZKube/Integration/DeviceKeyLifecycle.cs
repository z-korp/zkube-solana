using System;
using System.Security.Cryptography;
using System.Threading.Tasks;

namespace ZKube.Integration
{
    public interface INativeDeviceKeyLifecycle : INativeWalletTransport
    {
        Task<byte[]> LoadCandidateSeed(string owner);
        Task<byte[]> CreateCandidateSeed(string owner);
        Task PromoteCandidateSeed(string owner, byte[] expectedActiveFingerprint, byte[] expectedCandidateFingerprint);
    }

    public sealed class DeviceKeyLifecycle
    {
        private readonly INativeDeviceKeyLifecycle native;
        public DeviceKeyLifecycle(INativeDeviceKeyLifecycle native) { this.native = native ?? throw new ArgumentNullException(nameof(native)); }
        // Only an explicit enable/renew action calls this. Reads never create keys.
        public async Task<DeviceSigner> PrepareCandidate(string owner)
        {
            SolanaAddress.Bytes(owner);
            var seed = await native.CreateCandidateSeed(owner).ConfigureAwait(false);
            try { return new DeviceSigner(seed); }
            finally { Clear(seed); }
        }
        public async Task Promote(string owner, string expectedActive, string expectedCandidate)
        {
            SolanaAddress.Bytes(owner); SolanaAddress.Bytes(expectedCandidate);
            if (expectedActive != null) SolanaAddress.Bytes(expectedActive);
            byte[] active = null, candidate = null, activeFingerprint = null, candidateFingerprint = null;
            try
            {
                active = await native.LoadDeviceSeed(owner).ConfigureAwait(false);
                candidate = await native.LoadCandidateSeed(owner).ConfigureAwait(false);
                string activeKey = Address(active), candidateKey = Address(candidate);
                // Public metadata may still contain the pre-promotion identities
                // after native promotion committed and the process stopped.
                if (candidate == null && activeKey == expectedCandidate)
                {
                    candidateFingerprint = Fingerprint(active);
                    await native.PromoteCandidateSeed(owner, null, candidateFingerprint).ConfigureAwait(false);
                    return;
                }
                if (activeKey != expectedActive || candidateKey != expectedCandidate)
                    throw new InvalidOperationException("Device key identity differs from durable session metadata");
                activeFingerprint = active == null ? null : Fingerprint(active);
                candidateFingerprint = Fingerprint(candidate);
                await native.PromoteCandidateSeed(owner, activeFingerprint, candidateFingerprint).ConfigureAwait(false);
            }
            finally { Clear(active); Clear(candidate); Clear(activeFingerprint); Clear(candidateFingerprint); }
        }
        private static string Address(byte[] seed)
        {
            if (seed == null) return null;
            using var signer = new DeviceSigner(seed); return signer.Address;
        }
        private static byte[] Fingerprint(byte[] seed)
        {
            if (seed == null || seed.Length != 32) throw new FormatException("Invalid candidate seed");
            using var hash = SHA256.Create(); return hash.ComputeHash(seed);
        }
        private static void Clear(byte[] value) { if (value != null) Array.Clear(value, 0, value.Length); }
    }
}
