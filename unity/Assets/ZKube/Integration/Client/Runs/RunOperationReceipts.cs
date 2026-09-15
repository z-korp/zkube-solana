using System;
using System.Collections.Generic;
using System.Threading;
using ZKube.Integration.Execution;

namespace ZKube.Integration.Client.Runs
{
    // One caller-owned invocation, retained even when observation after a
    // confirmed transaction throws. This is neither a journal nor a retry API.
    public sealed class RunOperationReceipts
    {
        private readonly object sync = new object();
        private readonly List<RunExecutionReceipt> steps = new List<RunExecutionReceipt>();
        private readonly string expectedAddress;
        private string address;
        private int started;
        public string Owner { get; }
        public IReadOnlyList<RunExecutionReceipt> Steps
        { get { lock (sync) return Array.AsReadOnly(steps.ToArray()); } }

        public RunOperationReceipts(string owner, string expectedAddress = null)
        {
            if (string.IsNullOrEmpty(owner)) throw new ArgumentException("A receipt scope needs an owner", nameof(owner));
            Owner = owner; this.expectedAddress = expectedAddress;
        }
        internal void Begin(string owner)
        {
            if (owner != Owner) throw new InvalidOperationException("Receipt scope identity changed");
            if (Interlocked.CompareExchange(ref started, 1, 0) != 0)
                throw new InvalidOperationException("A receipt scope belongs to one run operation");
        }
        internal void Bind(string runAddress)
        {
            if (string.IsNullOrEmpty(runAddress) || (expectedAddress != null && runAddress != expectedAddress) ||
                (address != null && address != runAddress)) throw new InvalidOperationException("Receipt scope run changed");
            address = runAddress;
        }
        internal void Record(ExecutionResult result)
        {
            if (address == null || started == 0) throw new InvalidOperationException("Receipt scope has no bound run");
            lock (sync) steps.Add(new RunExecutionReceipt(Owner, address, result));
        }
    }

    public sealed class RunExecutionReceipt
    {
        public string Owner { get; }
        public string Address { get; }
        public ExecutionResult Result { get; }
        internal RunExecutionReceipt(string owner, string address, ExecutionResult result)
        { Owner = owner; Address = address; Result = result; }
    }
}
