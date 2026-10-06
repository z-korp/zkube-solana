using System;
using System.Globalization;
using System.Text;

namespace ZKube.Core.Generated
{
    // The player's language. Every word a player reads comes from the table of
    // the language in use, generated from assets/words with one accessor per
    // key. A change shows in the next thing drawn; Changed tells whoever has
    // already drawn. Numbers and dates take the language's own form here too.
    public static partial class Words
    {
        public static int Language { get; private set; }
        public static string Code => Codes[Language];
        public static event Action Changed;

        // The language for a code: itself, else the one that shares its first
        // part ("fr-CA" reads French, "pt" reads pt-BR, "zh" reads zh-Hans), else English.
        public static int Find(string code)
        {
            if (string.IsNullOrEmpty(code)) return 0;
            int exact = Array.IndexOf(Codes, code);
            if (exact >= 0) return exact;
            string family = code.Split('-')[0];
            for (int i = 0; i < Codes.Length; i++) if (Codes[i].Split('-')[0] == family) return i;
            return 0;
        }
        public static void Use(string code)
        {
            int next = Find(code);
            if (next == Language) return;
            Language = next; Changed?.Invoke();
        }

        // What a language's script font draws for it: its characters past the Latin, symbol and punctuation blocks.
        public static string ScriptCharacters(int language)
        {
            var own = new StringBuilder();
            if (ScriptFonts[language] != null) foreach (char c in CharactersOf[language]) if (c > '\u2e7f') own.Append(c);
            return own.ToString();
        }

        public static string At(int row) => tables[Language][row];
        private static string Counted(int row, long n) => tables[Language][row + Form(n)];
        // Which of a counted phrase's rows the language takes for n. Russian: 1 ход, 2 хода, 5 ходов, and 11 to 14 are "many".
        private static int Form(long n)
        {
            switch (plurals[Language])
            {
                case 0: return n == 1 ? 0 : 1;
                case 1: return n == 0 || n == 1 ? 0 : 1;
                case 3: return n % 10 == 1 && n % 100 != 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 1 : 2;
                default: return 0;
            }
        }

        // A whole number with the language's thousands separator.
        public static string Number(ulong value)
        {
            string digits = value.ToString(CultureInfo.InvariantCulture);
            if (digits.Length <= 3) return digits;
            var grouped = new StringBuilder(digits.Length + digits.Length / 3);
            for (int i = 0; i < digits.Length; i++)
            {
                if (i > 0 && (digits.Length - i) % 3 == 0) grouped.Append(FormatThousands);
                grouped.Append(digits[i]);
            }
            return grouped.ToString();
        }
        public static string Number(long value) => value < 0 ? "-" + Number((ulong)(-value)) : Number((ulong)value);
        // A number with a fraction, written with the language's decimal mark.
        public static string Decimal(decimal value, string format) =>
            value.ToString(format, CultureInfo.InvariantCulture).Replace(".", FormatDecimal);

        public static string Month(int month) => At(monthRow + month - 1);
        public static string Weekday(DayOfWeek day) => At(weekdayRow + (int)day);
        // A day of the year ("6 Oct"), with its weekday ("Tue 6 Oct") or its year.
        public static string Date(DateTime day) => FormatDate(DayOfMonth(day), Month(day.Month));
        public static string DateWithWeekday(DateTime day) => FormatDateWeekday(Weekday(day.DayOfWeek), DayOfMonth(day), Month(day.Month));
        public static string DateWithYear(DateTime day) =>
            FormatDateYear(DayOfMonth(day), Month(day.Month), day.Year.ToString(CultureInfo.InvariantCulture));
        // The first of a month is written as the language writes it: French says "1er oct.".
        private static string DayOfMonth(DateTime day) => day.Day == 1 ? FormatDayFirst : day.Day.ToString(CultureInfo.InvariantCulture);

        // A large figure cut to one decimal and its unit: thousands by thousands
        // ("18.4K"), or by ten thousands where the language counts that way.
        public static string Compact(decimal value)
        {
            int step = int.Parse(FormatCompactStep, CultureInfo.InvariantCulture);
            decimal unit = 1; for (int i = 0; i < step; i++) unit *= 10;
            if (value < unit) return Decimal(value, "0.#");
            int size = 0;
            while (value >= unit && size < CompactUnits) { value /= unit; size++; }
            return Decimal(decimal.Truncate(value * 10) / 10, "0.0") + At(compactRow + size - 1);
        }
    }
}
