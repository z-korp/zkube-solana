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
        {
          name: "treasury",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [116, 114, 101, 97, 115, 117, 114, 121] },
            ],
          },
        },
        { name: "system_program", address: "11111111111111111111111111111111" },
      ],
      args: [],
    },
    {
      name: "initialize_treasury",
      discriminator: [124, 186, 211, 195, 85, 165, 129, 166],
      accounts: [
        { name: "authority", writable: true, signer: true },
        {
          name: "treasury",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [116, 114, 101, 97, 115, 117, 114, 121] },
            ],
          },
        },
        { name: "system_program", address: "11111111111111111111111111111111" },
      ],
      args: [{ name: "fee_per_game", type: "u64" }],
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
        { name: "program_identity" },
        {
          name: "game_state",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [103, 97, 109, 101] },
              { kind: "account", path: "game_state.player", account: "GameState" },
            ],
          },
        },
      ],
      args: [{ name: "randomness", type: { array: ["u8", 32] } }],
    },
    {
      name: "withdraw",
      discriminator: [183, 18, 70, 156, 148, 109, 161, 34],
      accounts: [
        { name: "authority", signer: true },
        {
          name: "treasury",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [116, 114, 101, 97, 115, 117, 114, 121] },
            ],
          },
        },
        { name: "destination", writable: true },
        { name: "system_program", address: "11111111111111111111111111111111" },
      ],
      args: [{ name: "amount", type: "u64" }],
    },
  ],
  accounts: [
    { name: "GameState", discriminator: [144, 94, 208, 172, 248, 99, 134, 120] },
    { name: "Treasury", discriminator: [238, 239, 123, 238, 89, 1, 168, 253] },
  ],
  errors: [
    { code: 6000, name: "CustomError", msg: "Custom error message" },
    { code: 6001, name: "InvalidOracleQueue", msg: "Oracle queue invalide utiliser l'adresse DEFAULT_QUEUE de MagicBlock" },
    { code: 6002, name: "NotGameOwner", msg: "Tu n'es pas le proprietaire de cette partie" },
    { code: 6003, name: "GameOver", msg: "Cette partie est deja terminee" },
    { code: 6004, name: "InvalidMove", msg: "indices de move invalides row < 10, col < 8, start != end" },
    { code: 6005, name: "RandomnessAlreadySet", msg: "la randomness a deja ete injectee pour cette partie" },
    { code: 6006, name: "Unauthorized", msg: "Seule l'authority peut effectuer cette action" },
    { code: 6007, name: "InsufficientFunds", msg: "Fonds insuffisants dans la treasury" },
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
    {
      name: "Treasury",
      type: {
        kind: "struct",
        fields: [
          { name: "authority", type: "pubkey" },
          { name: "total_collected", type: "u64" },
          { name: "fee_per_game", type: "u64" },
        ],
      },
    },
  ],
};
