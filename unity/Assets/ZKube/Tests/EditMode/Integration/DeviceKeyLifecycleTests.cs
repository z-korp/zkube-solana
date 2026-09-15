using System;
using System.Linq;
using System.Security.Cryptography;
using System.Threading.Tasks;
using NUnit.Framework;

namespace ZKube.Integration.Tests
{
    public sealed class DeviceKeyLifecycleTests
    {
        private sealed class Native : INativeDeviceKeyLifecycle
        {
            public byte[] Active, Candidate;
            public bool ChangeCandidateBeforeCommit;
            public int Creations, Promotions;
            public Task<string> Request(string json) => throw new InvalidOperationException("No wallet request allowed");
            public Task<byte[]> LoadDeviceSeed(string owner) => Task.FromResult(Active?.ToArray());
            public Task<byte[]> LoadCandidateSeed(string owner) => Task.FromResult(Candidate?.ToArray());
            public Task<byte[]> CreateDeviceSeed(string owner) => throw new InvalidOperationException("No active key creation allowed");
            public Task RemoveDeviceSeed(string owner) => throw new InvalidOperationException("No key deletion allowed");
            public Task<byte[]> CreateCandidateSeed(string owner)
            { Creations++; Candidate ??= Enumerable.Repeat((byte)2, 32).ToArray(); return Task.FromResult(Candidate.ToArray()); }
            public async Task PromoteCandidateSeed(string owner, byte[] expectedActive, byte[] expectedCandidate)
            {
                await Task.Yield();
                if (ChangeCandidateBeforeCommit) Candidate = Enumerable.Repeat((byte)3, 32).ToArray();
                bool Match(byte[] seed, byte[] fingerprint)
                { if (seed == null || fingerprint == null) return seed == null && fingerprint == null; using var hash = SHA256.Create(); return hash.ComputeHash(seed).SequenceEqual(fingerprint); }
                if (Candidate == null && Match(Active, expectedCandidate)) return;
                if (!Match(Active, expectedActive) || !Match(Candidate, expectedCandidate)) throw new InvalidOperationException("Synthetic changed snapshot");
                Active = Candidate; Candidate = null; Promotions++;
            }
        }
        [Test]
        public async Task PublicIdentitiesAndNativeFingerprintCasBothGuardPromotionAcrossRestart()
        {
            byte[] old = Enumerable.Repeat((byte)1, 32).ToArray(), next = Enumerable.Repeat((byte)2, 32).ToArray();
            using var oldSigner = new DeviceSigner(old); using var candidate = new DeviceSigner(next);
            var native = new Native { Active = old, Candidate = next }; var lifecycle = new DeviceKeyLifecycle(native);
            await AsyncAssert.Throws<InvalidOperationException>(() => lifecycle.Promote(oldSigner.Address, candidate.Address, candidate.Address));
            native.ChangeCandidateBeforeCommit = true;
            await AsyncAssert.Throws<InvalidOperationException>(() => lifecycle.Promote(oldSigner.Address, oldSigner.Address, candidate.Address));
            Assert.That(native.Active, Is.EqualTo(old)); Assert.That(native.Promotions, Is.Zero);
            native.Candidate = next; native.ChangeCandidateBeforeCommit = false;
            await lifecycle.Promote(oldSigner.Address, oldSigner.Address, candidate.Address);
            await new DeviceKeyLifecycle(native).Promote(oldSigner.Address, oldSigner.Address, candidate.Address);
            Assert.That(native.Promotions, Is.EqualTo(1)); Assert.That(native.Active, Is.EqualTo(next)); Assert.That(native.Candidate, Is.Null);
        }
        [Test]
        public async Task MissingCandidateReadNeverCreatesAndInitialPromotionNeedsNoOldKey()
        {
            using var owner = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray());
            var native = new Native(); var lifecycle = new DeviceKeyLifecycle(native);
            Assert.That(await lifecycle.LoadCandidate(owner.Address), Is.Null); Assert.That(native.Creations, Is.Zero);
            using var prepared = await lifecycle.PrepareCandidate(owner.Address);
            await lifecycle.Promote(owner.Address, null, prepared.Address);
            Assert.That(native.Active, Is.Not.Null); Assert.That(native.Candidate, Is.Null);
        }
    }
}
