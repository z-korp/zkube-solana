using System.Runtime.InteropServices;

namespace ZKube.Core
{
    public static class NativeCore
    {
        private const string Library = "zkube_core_ffi";

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl,
            EntryPoint = "zkube_core_abi_version")]
        public static extern uint AbiVersion();

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl,
            EntryPoint = "zkube_core_run_state_len")]
        public static extern uint RunStateLength();
    }
}
