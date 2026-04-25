// IDL du programme zkube-solana
// SOURCE DE VÉRITÉ : solana/target/idl/solana.json (anchor build)
// Programme: 7zdLjmcar3hQZoosNpgZ4JBmvbHzm8bxTBiBZCWrY2nN

export const IDL = {
  address: "7zdLjmcar3hQZoosNpgZ4JBmvbHzm8bxTBiBZCWrY2nN",
  metadata: { name: "solana", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    // ── close_game (ER → commit + undelegate) ────────────────────────────────
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
        { name: "magic_context", writable: true },
        { name: "magic_program" },
      ],
      args: [],
    },

    // ── create_game (mainnet + VRF) ───────────────────────────────────────────
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
      args: [{ name: "session_key", type: "pubkey" }],
    },

    // ── delegate_game (mainnet → délègue le PDA à l'ER) ──────────────────────
    // Le client passe uniquement { player, validator }.
    // Tous les autres comptes (buffer_pda, delegation_record_pda,
    // delegation_metadata_pda, pda, owner_program, delegation_program,
    // system_program) sont dérivés automatiquement par Anchor depuis l'IDL.
    {
      name: "delegate_game",
      discriminator: [116, 183, 70, 107, 112, 223, 122, 210],
      accounts: [
        { name: "player", writable: true, signer: true },
        { name: "validator", optional: true },
        {
          name: "buffer_pda",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [98, 117, 102, 102, 101, 114] },
              { kind: "account", path: "pda" },
            ],
            program: {
              kind: "const",
              value: [103, 233, 81, 90, 68, 18, 167, 19, 58, 180, 89, 17, 78, 94, 134, 250, 5, 140, 191, 248, 249, 160, 229, 227, 22, 188, 165, 15, 102, 2, 70, 51],
            },
          },
        },
        {
          name: "delegation_record_pda",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [100, 101, 108, 101, 103, 97, 116, 105, 111, 110] },
              { kind: "account", path: "pda" },
            ],
            program: { kind: "account", path: "delegation_program" },
          },
        },
        {
          name: "delegation_metadata_pda",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [100, 101, 108, 101, 103, 97, 116, 105, 111, 110, 45, 109, 101, 116, 97, 100, 97, 116, 97] },
              { kind: "account", path: "pda" },
            ],
            program: { kind: "account", path: "delegation_program" },
          },
        },
        {
          name: "pda",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [103, 97, 109, 101] },
              { kind: "account", path: "player" },
            ],
          },
        },
        { name: "owner_program", address: "7zdLjmcar3hQZoosNpgZ4JBmvbHzm8bxTBiBZCWrY2nN" },
        { name: "delegation_program", address: "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh" },
        { name: "system_program", address: "11111111111111111111111111111111" },
      ],
      args: [],
    },

    // ── initialize_treasury (one-time) ────────────────────────────────────────
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

    // ── make_move (ER — gratuit, ~50ms) ──────────────────────────────────────
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
              { kind: "account", path: "game_state.player", account: "GameState" },
            ],
          },
        },
      ],
      args: [
        { name: "row_index", type: "u8" },
        { name: "start_index", type: "u8" },
        { name: "final_index", type: "u8" },
        { name: "expected_move", type: "u32" },
      ],
    },

    // ── receive_randomness (callback VRF) ────────────────────────────────────
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

    // ── reset_game (migration / compte corrompu) ──────────────────────────────
    {
      name: "reset_game",
      discriminator: [97, 146, 71, 156, 110, 206, 124, 224],
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
        { name: "system_program", address: "11111111111111111111111111111111" },
      ],
      args: [],
    },

    // ── set_session_key (ER — reconnexion mid-game) ───────────────────────────
    {
      name: "set_session_key",
      discriminator: [13, 147, 179, 38, 67, 1, 69, 132],
      accounts: [
        { name: "player", signer: true },
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
      args: [{ name: "new_session_key", type: "pubkey" }],
    },

    // ── withdraw (treasury) ───────────────────────────────────────────────────
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
    { code: 6008, name: "NotDelegated", msg: "Le compte game_state n'est pas delegue a l'Ephemeral Rollup" },
    { code: 6009, name: "InvalidAuthority", msg: "L'authority de delegation ne correspond pas au joueur" },
    { code: 6010, name: "InvalidState", msg: "Phase de jeu invalide pour cette instruction" },
    { code: 6011, name: "InvalidOwner", msg: "L'owner du compte PDA n'est pas le programme attendu" },
    { code: 6012, name: "DelegationFailed", msg: "La delegation a l'Ephemeral Rollup a echoue" },
    { code: 6013, name: "InvalidMoveOrder", msg: "Ordre des moves invalide (expected_move != move_count)" },
    { code: 6014, name: "InvalidMagicProgram", msg: "Le programme magic_program est invalide" },
    { code: 6015, name: "InvalidMagicContext", msg: "Le compte magic_context est invalide" },
    { code: 6016, name: "GameNotFinished", msg: "La partie n'est pas encore terminee (game.over doit etre true)" },
  ],

  types: [
    {
      name: "GamePhase",
      type: {
        kind: "enum",
        variants: [
          { name: "Created" },
          { name: "Delegated" },
          { name: "Playing" },
          { name: "Finished" },
        ],
      },
    },
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
          { name: "delegated", type: "bool" },
          { name: "delegated_authority", type: "pubkey" },
          { name: "phase", type: { defined: { name: "GamePhase" } } },
          { name: "session_key", type: "pubkey" },
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
