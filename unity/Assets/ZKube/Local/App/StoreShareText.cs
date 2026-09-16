using System;
using System.Globalization;
using UnityEngine;

namespace ZKube.Local.App
{
    public static class StoreShareText
    {
        public static string Build(string name, string guardian, string realm, string objective,
            string objectiveTotal, ulong score, ulong streak, CultureInfo culture = null)
        {
            if (name == null || guardian == null || realm == null || objective == null || objectiveTotal == null)
                throw new ArgumentNullException("Share result is incomplete");
            return Application.productName + " · Daily\n" + name + " faced " + guardian + " in " + realm + ". " + objective + ": " + objectiveTotal +
                ". Score: " + score.ToString("N0", culture ?? CultureInfo.CurrentCulture) + ". " +
                streak.ToString(CultureInfo.InvariantCulture) + " day streak.";
        }

    }
}
