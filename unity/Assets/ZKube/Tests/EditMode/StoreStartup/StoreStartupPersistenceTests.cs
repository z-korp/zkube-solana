using System;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using ZKube.Persistence;

namespace ZKube.Local.App.Tests
{
    public sealed class StoreStartupPersistenceTests
    {
        private string directory;
        private string ProductPath => Path.Combine(directory, LocalProductCodec.StorageKey + ".json");
        [SetUp] public void SetUp()
        {
            directory = Path.GetFullPath(Path.Combine(Application.dataPath, "../../build/unity/harness/store-startup/files/" + Guid.NewGuid().ToString("N")));
        }
        [TearDown] public void TearDown() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
        private LocalProductStore Product() => new LocalProductStore(
            key => { Assert.AreEqual(LocalProductCodec.StorageKey, key); return AtomicProductFile.Read(ProductPath); },
            (key, value) => {
                Assert.AreEqual(LocalProductCodec.StorageKey, key);
                AtomicProductFile.Write(ProductPath, value);
            });
        [Test] public void FlushedProductPublicationReplacesWholeDocumentAndClearsStalePending()
        {
            Assert.IsNull(AtomicProductFile.Read(ProductPath));
            var first = new LocalProductState { Name = "First", BestDailyScore = 12 };
            var second = new LocalProductState { Name = "Second", BestDailyScore = 34, CampaignOwned = true };
            AtomicProductFile.Write(ProductPath, LocalProductCodec.Encode(first));
            File.WriteAllText(ProductPath + ".pending", "interrupted partial JSON");
            Assert.AreEqual("First", Product().Read.Name, "Restart reads only the published file");
            AtomicProductFile.Write(ProductPath, LocalProductCodec.Encode(second));
            Assert.AreEqual("Second", Product().Read.Name); Assert.AreEqual(34, Product().Read.BestDailyScore);
            Assert.IsTrue(Product().Read.CampaignOwned); Assert.IsFalse(File.Exists(ProductPath + ".pending"));
        }
        [Test] public void FailedPendingWritePreservesPreviouslyPublishedProduct()
        {
            var original = LocalProductCodec.Encode(new LocalProductState { Name = "Saved", BestDailyScore = 22 });
            AtomicProductFile.Write(ProductPath, original); Directory.CreateDirectory(ProductPath + ".pending");
            Assert.Catch(() => AtomicProductFile.Write(ProductPath, "replacement"));
            Assert.AreEqual(original, AtomicProductFile.Read(ProductPath));
        }
        [Test] public void UnpublishedPendingFileCannotBecomeProductOnRestart()
        {
            Directory.CreateDirectory(directory); File.WriteAllText(ProductPath + ".pending", "unfinished");
            Assert.IsNull(AtomicProductFile.Read(ProductPath));
        }
        [Test] public void ExistingUnreadableProductPathIsAnErrorNotAnAbsentSave()
        {
            Directory.CreateDirectory(ProductPath);
            Assert.Catch(() => AtomicProductFile.Read(ProductPath));
        }
        [Test] public void FailedAtomicPublicationRemovesOnlyItsPendingFile()
        {
            Directory.CreateDirectory(ProductPath); string marker = Path.Combine(ProductPath, "unchanged");
            File.WriteAllText(marker, "existing directory content");
            Assert.Catch(() => AtomicProductFile.Write(ProductPath, "new content"));
            Assert.AreEqual("existing directory content", File.ReadAllText(marker));
            Assert.IsFalse(File.Exists(ProductPath + ".pending"));
        }
    }
}
