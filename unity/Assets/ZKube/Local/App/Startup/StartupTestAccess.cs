#if UNITY_EDITOR
using System.Runtime.CompilerServices;
[assembly: InternalsVisibleTo("ZKube.StoreStartup.Tests")]
#if ZKUBE_STANDALONE
[assembly: InternalsVisibleTo("Tests")]
#endif
#endif
