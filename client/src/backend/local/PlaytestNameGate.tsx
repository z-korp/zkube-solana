import { useState, type FormEvent } from "react";

import { useConnectedPlayer, useIdentityActions } from "@/backend/client";
import { storePlaytestName } from "./playtest";

export default function PlaytestNameGate() {
  const player = useConnectedPlayer();
  const identity = useIdentityActions();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const normalized = storePlaytestName(name);
      await player.connectAndEnable("local");
      await identity.setLabel(normalized);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 grid place-items-center bg-[#02050d] p-5 text-white">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm rounded-3xl border border-white/15 bg-[#101a2b] p-6 shadow-2xl"
      >
        <p className="font-display text-4xl text-[#FFF4D7]">Owner play build</p>
        <p className="mt-2 font-sans text-sm leading-6 text-white/60">
          Pick the name shown beside your local runs. It stays on this device.
        </p>
        <input
          autoFocus
          aria-label="Playtest name"
          maxLength={24}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          className="mt-5 w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 font-sans text-base outline-none focus:border-cyan-300/60"
        />
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={busy || name.trim().length === 0}
          className="mt-4 w-full rounded-xl bg-amber-300 px-4 py-3 font-sans text-sm font-black text-slate-950 disabled:opacity-40"
        >
          {busy ? "Opening…" : "Play"}
        </button>
      </form>
    </div>
  );
}
