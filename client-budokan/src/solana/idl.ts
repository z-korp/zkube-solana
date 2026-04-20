// IDL du programme zkube-solana
// Généré par: anchor build (programs/solana)
// Programme: 8vB8kAAsuxLGejEweuJRdnAAe5wuUFTdt2fRQjeqvC6v

export const IDL = {
  address: "8vB8kAAsuxLGejEweuJRdnAAe5wuUFTdt2fRQjeqvC6v",
  metadata: { name: "solana", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    {
      name: "close_game",
      discriminator: [237, 236, 157, 201, 253, 20, 248, 67],
      accounts: [
        { name: "player", writable: true, signer: true },
        {
          name: "game_state",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [103, 97, 109, 101] },
              { kind: "account", path: "player" },
            ],
          },
        },
      ],
      args: [],
    },
    {
      name: "create_game",
      discriminator: [124, 69, 75, 66, 184, 220, 72, 206],
      accounts: [
        { name: "player", writable: true, signer: true },
        {
          name: "game_state",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [103, 97, 109, 101] },
              { kind: "account", path: "player" },
            ],
          },
        },
        { name: "oracle_queue", writable: true },
        {
          name: "identity",
          pda: {
            seeds: [
              { kind: "const", value: [105, 100, 101, 110, 116, 105, 116, 121] },
            ],
          },
        },
        { name: "vrf_program" },
        { name: "slot_hashes" },
        { name: "system_program", address: "11111111111111111111111111111111" },
      ],
      args: [],
    },
    {
      name: "make_move",
      discriminator: [78, 77, 152, 203, 222, 211, 208, 233],
      accounts: [
        { name: "player", signer: true },
        {
          name: "game_state",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [103, 97, 109, 101] },
              { kind: "account", path: "player" },
            ],
          },
        },
      ],
      args: [
        { name: "row_index", type: "u8" },
        { name: "start_index", type: "u8" },
        { name: "final_index", type: "u8" },
      ],
    },
    {
      name: "receive_randomness",
      discriminator: [118, 124, 23, 234, 168, 81, 207, 220],
      accounts: [
        {
          name: "game_state",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [103, 97, 109, 101] },
              {
                kind: "account",
                path: "game_state.player",
                account: "GameState",
              },
            ],
          },
        },
      ],
      args: [{ name: "randomness", type: { array: ["u8", 32] } }],
    },
  ],
  accounts: [
    { name: "GameState", discriminator: [144, 94, 208, 172, 248, 99, 134, 120] },
  ],
  types: [
    {
      name: "GameState",
      type: {
        kind: "struct",
        fields: [
          { name: "player", type: "pubkey" },
          { name: "blocks", type: { array: ["u8", 80] } },
          { name: "next_row", type: { array: ["u8", 8] } },
          { name: "score", type: "u32" },
          { name: "combo_counter", type: "u8" },
          { name: "max_combo", type: "u8" },
          { name: "move_count", type: "u32" },
          { name: "seed", type: "u64" },
          { name: "over", type: "bool" },
        ],
      },
    },
  ],
} as const;

export type ZkubeSolanaIDL = typeof IDL;
