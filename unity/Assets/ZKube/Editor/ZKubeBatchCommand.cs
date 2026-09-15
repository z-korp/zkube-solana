using System;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace ZKube.Editor
{
    // A fresh result file is written only after the method returns. build.py can
    // therefore distinguish completed work from a later Editor teardown crash.
    public static class ZKubeBatchCommand
    {
        [Serializable]
        private sealed class Result
        {
            public string method;
            public string status;
        }

        public static void Complete()
        {
            var path = Environment.GetEnvironmentVariable("ZKUBE_BATCH_RESULT");
            if (string.IsNullOrEmpty(path)) return;
            var method = Environment.GetEnvironmentVariable("ZKUBE_BATCH_METHOD");
            File.WriteAllText(path, JsonUtility.ToJson(new Result { method = method, status = "ok" }));
            Debug.Log("ZKUBE_BATCH_COMPLETED " + method);
        }

        public static void Run()
        {
            try
            {
                var name = Environment.GetEnvironmentVariable("ZKUBE_BATCH_METHOD")
                    ?? throw new InvalidOperationException("Missing batch method");
                var separator = name.LastIndexOf('.');
                if (separator < 1) throw new InvalidOperationException("Invalid batch method");
                var type = AppDomain.CurrentDomain.GetAssemblies()
                    .Select(assembly => assembly.GetType(name.Substring(0, separator), false))
                    .FirstOrDefault(candidate => candidate != null);
                var method = type?.GetMethod(name.Substring(separator + 1),
                    BindingFlags.Public | BindingFlags.Static, null, Type.EmptyTypes, null);
                if (method == null || method.ReturnType != typeof(void) || method.DeclaringType == typeof(ZKubeBatchCommand))
                    throw new InvalidOperationException("Batch method must be a public static void method without parameters");
                method.Invoke(null, null);
                Complete();
            }
            catch (Exception error)
            {
                while (error is TargetInvocationException invocation && invocation.InnerException != null)
                    error = invocation.InnerException;
                Debug.LogException(error);
                EditorApplication.Exit(1);
            }
        }
    }
}
