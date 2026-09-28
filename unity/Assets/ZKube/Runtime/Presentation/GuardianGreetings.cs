using System;
using UnityEngine;

namespace ZKube.Presentation
{
    // Which realms' guardians have greeted the player on this device. The first
    // visit to a realm's map plays the greeting once.
    public sealed class GuardianGreetings
    {
        private const string Key = "zkube.greeted.realms";
        private readonly Func<int> read;
        private readonly Action<int> write;

        public GuardianGreetings(Func<int> read, Action<int> write)
        {
            this.read = read ?? throw new ArgumentNullException(nameof(read));
            this.write = write ?? throw new ArgumentNullException(nameof(write));
        }
        public static GuardianGreetings Device() =>
            new GuardianGreetings(() => PlayerPrefs.GetInt(Key, 0), value => { PlayerPrefs.SetInt(Key, value); PlayerPrefs.Save(); });

        public bool Greeted(byte realm) => (read() & 1 << realm) != 0;
        public void Greet(byte realm) => write(read() | 1 << realm);
    }
}
