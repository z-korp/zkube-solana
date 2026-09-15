using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Newtonsoft.Json.Linq;

namespace ZKube.Persistence
{
    // JSON.parse compatibility for persisted product data: Json.NET otherwise
    // accepts comments, single quotes, undefined and trailing commas, and can
    // replace escaped lone UTF-16 surrogates. Iterative containers avoid a
    // recursive call stack and preserve JS double parsing/last-key-wins behavior.
    public sealed class StrictJson
    {
        private readonly string text;
        private int offset;
        private readonly List<Frame> stack = new List<Frame>();
        private sealed class Frame
        {
            public JContainer Container;
            public int State; // 0 first member/value, 1 required member/value, 2 delimiter
        }
        private StrictJson(string text) { this.text = text; }
        public static JToken Parse(string text) => new StrictJson(text).Document();
        // Shared JS String.trim semantics for product text and audio Number
        // coercion. In particular FEFF is trimmed and 0085 is preserved.
        private static bool White(char value) => value == '\u0009' || value == '\u000a' || value == '\u000b' || value == '\u000c' ||
            value == '\u000d' || value == '\u0020' || value == '\u00a0' || value == '\u1680' ||
            (value >= '\u2000' && value <= '\u200a') || value == '\u2028' || value == '\u2029' ||
            value == '\u202f' || value == '\u205f' || value == '\u3000' || value == '\ufeff';
        public static string TrimString(string value)
        {
            int start = 0, end = value.Length;
            while (start < end && White(value[start])) start++;
            while (end > start && White(value[end - 1])) end--;
            return value.Substring(start, end - start);
        }
        private JToken Document()
        {
            JToken root = Value();
            while (stack.Count != 0)
            {
                Frame frame = stack[stack.Count - 1];
                bool obj = frame.Container is JObject;
                char end = obj ? '}' : ']';
                Space();
                if (frame.State == 2)
                {
                    if (Take(end)) { stack.RemoveAt(stack.Count - 1); continue; }
                    Require(','); frame.State = 1; Space();
                }
                if (frame.State == 0 && Take(end)) { stack.RemoveAt(stack.Count - 1); continue; }
                frame.State = 2;
                if (obj)
                {
                    string key = String(); Space(); Require(':');
                    ((JObject)frame.Container)[key] = Value();
                }
                else frame.Container.Add(Value());
            }
            Space(); if (offset != text.Length) throw Invalid();
            return root;
        }
        private JToken Value()
        {
            Space();
            if (Take('{')) return Container(new JObject());
            if (Take('[')) return Container(new JArray());
            if (Peek() == '"') return new JValue(String());
            if (TakeLiteral("true")) return new JValue(true);
            if (TakeLiteral("false")) return new JValue(false);
            if (TakeLiteral("null")) return JValue.CreateNull();
            return Number();
        }
        private JToken Container(JContainer value)
        { stack.Add(new Frame { Container = value }); return value; }
        private JToken Number()
        {
            int start = offset; Take('-');
            if (!Take('0'))
            {
                if (Peek() < '1' || Peek() > '9') throw Invalid();
                Digits();
            }
            if (Take('.')) { if (!Digit(Peek())) throw Invalid(); Digits(); }
            if (Take('e') || Take('E'))
            {
                if (!Take('+')) Take('-');
                if (!Digit(Peek())) throw Invalid(); Digits();
            }
            string number = text.Substring(start, offset - start);
            if (!double.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out double value))
                value = OutOfRangeNumber(number);
            return new JValue(value);
        }
        private static double OutOfRangeNumber(string number)
        {
            // Mono reports overflow as TryParse=false; modern .NET and JSON.parse
            // accept it as infinity. The grammar is already validated. Classify
            // enormous exponents without parsing them into a bounded integer.
            bool negative = number[0] == '-';
            int exponentAt = number.IndexOfAny(new[] { 'e', 'E' });
            int end = exponentAt < 0 ? number.Length : exponentAt;
            long exponent = 0, bound = (long)number.Length + 1024;
            if (exponentAt >= 0)
            {
                int i = exponentAt + 1; bool minus = number[i] == '-';
                if (number[i] == '-' || number[i] == '+') i++;
                for (; i < number.Length; i++) exponent = Math.Min(bound, exponent * 10 + number[i] - '0');
                if (minus) exponent = -exponent;
            }
            int digits = 0, first = -1, fractional = 0; bool afterPoint = false;
            for (int i = negative ? 1 : 0; i < end; i++)
            {
                if (number[i] == '.') { afterPoint = true; continue; }
                if (first < 0 && number[i] != '0') first = digits;
                digits++; if (afterPoint) fractional++;
            }
            long magnitude = exponent + digits - fractional - first - 1;
            if (first < 0 || magnitude < -308) return negative ? -0d : 0d;
            if (magnitude < 308) throw Invalid();
            return negative ? double.NegativeInfinity : double.PositiveInfinity;
        }
        private string String()
        {
            Require('"'); var value = new StringBuilder();
            while (offset < text.Length)
            {
                char next = text[offset++];
                if (next == '"') return value.ToString();
                if (next < 0x20) throw Invalid();
                if (next != '\\') { value.Append(next); continue; }
                if (offset == text.Length) throw Invalid();
                switch (text[offset++])
                {
                    case '"': value.Append('"'); break;
                    case '\\': value.Append('\\'); break;
                    case '/': value.Append('/'); break;
                    case 'b': value.Append('\b'); break;
                    case 'f': value.Append('\f'); break;
                    case 'n': value.Append('\n'); break;
                    case 'r': value.Append('\r'); break;
                    case 't': value.Append('\t'); break;
                    case 'u':
                        int code = 0;
                        for (int i = 0; i < 4; i++)
                        {
                            if (offset == text.Length) throw Invalid();
                            char digit = text[offset++];
                            int hex = digit >= '0' && digit <= '9' ? digit - '0' : digit >= 'a' && digit <= 'f' ? digit - 'a' + 10 : digit >= 'A' && digit <= 'F' ? digit - 'A' + 10 : -1;
                            if (hex < 0) throw Invalid(); code = code * 16 + hex;
                        }
                        value.Append((char)code); break;
                    default: throw Invalid();
                }
            }
            throw Invalid();
        }
        private bool TakeLiteral(string value)
        {
            if (text.Length - offset < value.Length || string.CompareOrdinal(text, offset, value, 0, value.Length) != 0) return false;
            offset += value.Length; return true;
        }
        private char Peek() => offset < text.Length ? text[offset] : '\0';
        private bool Take(char value) { if (Peek() != value) return false; offset++; return true; }
        private void Require(char value) { if (!Take(value)) throw Invalid(); }
        private static bool Digit(char value) => value >= '0' && value <= '9';
        private void Digits() { while (Digit(Peek())) offset++; }
        private void Space() { while (Peek() == ' ' || Peek() == '\t' || Peek() == '\n' || Peek() == '\r') offset++; }
        private static FormatException Invalid() => new FormatException("Invalid local product JSON");
    }
}
