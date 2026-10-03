/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/solana.json`.
 */
export type Solana = {
  "address": "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd",
  "metadata": {
    "name": "solana",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "zKube game program for Solana and MagicBlock"
  },
  "instructions": [
    {
      "name": "applyBonus",
      "discriminator": [
        50,
        139,
        204,
        203,
        95,
        151,
        77,
        180
      ],
      "accounts": [
        {
          "name": "activeRun",
          "writable": true
        },
        {
          "name": "ownerAuthority"
        },
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "actor",
          "writable": true,
          "signer": true
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "expectedAction",
          "type": "u32"
        },
        {
          "name": "row",
          "type": "u8"
        },
        {
          "name": "column",
          "type": "u8"
        },
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "claimDailyPrize",
      "discriminator": [
        50,
        255,
        168,
        107,
        1,
        40,
        93,
        254
      ],
      "accounts": [
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "arenaDaily",
          "docs": [
            "claim window. Read in the handler."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  100,
                  97,
                  105,
                  108,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "dayId"
              }
            ]
          }
        },
        {
          "name": "arenaBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arenaDaily"
              },
              {
                "kind": "arg",
                "path": "board"
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "ownerAuthority"
              }
            ]
          }
        },
        {
          "name": "ownerAuthority",
          "writable": true
        },
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "actor",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "dayId",
          "type": "u32"
        },
        {
          "name": "board",
          "type": {
            "defined": {
              "name": "dailyBoardKind"
            }
          }
        },
        {
          "name": "position",
          "type": "u32"
        }
      ]
    },
    {
      "name": "closeArenaDaily",
      "discriminator": [
        160,
        200,
        101,
        189,
        236,
        172,
        132,
        142
      ],
      "accounts": [
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "arenaDaily",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  100,
                  97,
                  105,
                  108,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "arena_daily.day_id",
                "account": "arenaDaily"
              }
            ]
          }
        },
        {
          "name": "scoreBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arenaDaily"
              },
              {
                "kind": "const",
                "value": [
                  115,
                  99,
                  111,
                  114,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "themeBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arenaDaily"
              },
              {
                "kind": "const",
                "value": [
                  116,
                  104,
                  101,
                  109,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "newestDaily",
          "docs": [
            "The newest prepared Daily, which receives what was never claimed.",
            "Needed only when something is left to move."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  100,
                  97,
                  105,
                  108,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "newest_daily.day_id",
                "account": "arenaDaily"
              }
            ]
          }
        },
        {
          "name": "cadenceFunding",
          "docs": [
            "canonical System-owned zero-data PDA and exposes no withdrawal path."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  100,
                  101,
                  110,
                  99,
                  101,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "caller",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "closeArenaPlayer",
      "discriminator": [
        202,
        241,
        245,
        122,
        192,
        220,
        159,
        49
      ],
      "accounts": [
        {
          "name": "arenaDaily",
          "docs": [
            "the handler."
          ]
        },
        {
          "name": "arenaPlayer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "arena_player.challenge",
                "account": "arenaPlayer"
              },
              {
                "kind": "account",
                "path": "arena_player.player",
                "account": "arenaPlayer"
              }
            ]
          }
        },
        {
          "name": "rentRecipient",
          "writable": true
        },
        {
          "name": "caller",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "commitRun",
      "discriminator": [
        56,
        156,
        109,
        85,
        156,
        162,
        63,
        150
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "activeRun",
          "writable": true
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "consumeArenaRun",
      "discriminator": [
        74,
        233,
        161,
        108,
        181,
        27,
        197,
        167
      ],
      "accounts": [
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "active_run.owner",
                "account": "activeRun"
              }
            ]
          }
        },
        {
          "name": "arenaDaily",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  100,
                  97,
                  105,
                  108,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "arena_daily.day_id",
                "account": "arenaDaily"
              }
            ]
          }
        },
        {
          "name": "arenaPlayer",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "active_run.daily_challenge",
                "account": "activeRun"
              },
              {
                "kind": "account",
                "path": "active_run.owner",
                "account": "activeRun"
              }
            ]
          }
        },
        {
          "name": "activeRun",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "active_run.owner",
                "account": "activeRun"
              },
              {
                "kind": "account",
                "path": "active_run.run_id",
                "account": "activeRun"
              }
            ]
          }
        },
        {
          "name": "rentRecipient",
          "writable": true
        },
        {
          "name": "scoreBoard",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "active_run.daily_challenge",
                "account": "activeRun"
              },
              {
                "kind": "const",
                "value": [
                  115,
                  99,
                  111,
                  114,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "themeBoard",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "active_run.daily_challenge",
                "account": "activeRun"
              },
              {
                "kind": "const",
                "value": [
                  116,
                  104,
                  101,
                  109,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "delegateActiveRun",
      "discriminator": [
        219,
        238,
        221,
        207,
        119,
        217,
        2,
        99
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "ownerAuthority"
        },
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                192,
                239,
                223,
                189,
                129,
                90,
                221,
                244,
                43,
                175,
                103,
                74,
                250,
                80,
                216,
                222,
                183,
                107,
                122,
                17,
                194,
                162,
                97,
                121,
                40,
                92,
                223,
                48,
                145,
                250,
                214,
                224
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true
        },
        {
          "name": "ownerProgram",
          "address": "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "depositArenaDaily",
      "discriminator": [
        90,
        108,
        3,
        251,
        15,
        171,
        133,
        247
      ],
      "accounts": [
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "arenaDaily",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  100,
                  97,
                  105,
                  108,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "arena_daily.day_id",
                "account": "arenaDaily"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "protocol"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "enterArena",
      "discriminator": [
        237,
        44,
        241,
        163,
        152,
        39,
        13,
        181
      ],
      "accounts": [
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "ownerAuthority"
              }
            ]
          }
        },
        {
          "name": "currentDaily",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  100,
                  97,
                  105,
                  108,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "current_daily.day_id",
                "account": "arenaDaily"
              }
            ]
          }
        },
        {
          "name": "arenaPlayer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "currentDaily"
              },
              {
                "kind": "account",
                "path": "ownerAuthority"
              }
            ]
          }
        },
        {
          "name": "scoreBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "currentDaily"
              },
              {
                "kind": "const",
                "value": [
                  115,
                  99,
                  111,
                  114,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "themeBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "currentDaily"
              },
              {
                "kind": "const",
                "value": [
                  116,
                  104,
                  101,
                  109,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "cadenceFunding",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  100,
                  101,
                  110,
                  99,
                  101,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "creditVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  100,
                  105,
                  116,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "activeRun",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "ownerAuthority"
              },
              {
                "kind": "arg",
                "path": "runId"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "ownerAuthority",
          "writable": true
        },
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "runId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "finalizeArenaDaily",
      "discriminator": [
        97,
        122,
        29,
        186,
        227,
        13,
        141,
        179
      ],
      "accounts": [
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "arenaDaily",
          "docs": [
            "after finalizing. Read in the handler."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  100,
                  97,
                  105,
                  108,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "dayId"
              }
            ]
          }
        },
        {
          "name": "followingDaily",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  100,
                  97,
                  105,
                  108,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "followingDay"
              }
            ]
          }
        },
        {
          "name": "scoreBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arenaDaily"
              },
              {
                "kind": "const",
                "value": [
                  115,
                  99,
                  111,
                  114,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "themeBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arenaDaily"
              },
              {
                "kind": "const",
                "value": [
                  116,
                  104,
                  101,
                  109,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "cadenceFunding",
          "docs": [
            "finalized boards no longer need."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  100,
                  101,
                  110,
                  99,
                  101,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "caller",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "dayId",
          "type": "u32"
        },
        {
          "name": "followingDay",
          "type": "u32"
        }
      ]
    },
    {
      "name": "finishRun",
      "discriminator": [
        125,
        146,
        243,
        213,
        56,
        220,
        214,
        25
      ],
      "accounts": [
        {
          "name": "activeRun",
          "writable": true
        },
        {
          "name": "ownerAuthority"
        },
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "actor",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "reason",
          "type": {
            "defined": {
              "name": "runFinishReason"
            }
          }
        }
      ]
    },
    {
      "name": "fulfillRowVrf",
      "discriminator": [
        191,
        157,
        173,
        3,
        242,
        20,
        212,
        83
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "activeRun",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "expectedRequestCounter",
          "type": "u32"
        }
      ]
    },
    {
      "name": "initializePlayer",
      "discriminator": [
        79,
        249,
        88,
        177,
        220,
        62,
        56,
        128
      ],
      "accounts": [
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "ownerAuthority"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "ownerAuthority"
        },
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeProtocol",
      "discriminator": [
        188,
        233,
        252,
        106,
        134,
        146,
        202,
        91
      ],
      "accounts": [
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "creditVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  100,
                  105,
                  116,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "teamDestination"
        },
        {
          "name": "authority",
          "docs": [
            "Governance authority chosen by the upgrade authority; pays both rents."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "upgradeAuthority",
          "docs": [
            "Only the program's upgrade authority may bootstrap its protocol."
          ],
          "signer": true
        },
        {
          "name": "program",
          "address": "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd"
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "initializeProtocolArgs"
            }
          }
        }
      ]
    },
    {
      "name": "playMove",
      "discriminator": [
        238,
        70,
        57,
        142,
        51,
        180,
        219,
        31
      ],
      "accounts": [
        {
          "name": "activeRun",
          "writable": true
        },
        {
          "name": "ownerAuthority"
        },
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "actor",
          "writable": true,
          "signer": true
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "expectedAction",
          "type": "u32"
        },
        {
          "name": "expectedMove",
          "type": "u16"
        },
        {
          "name": "row",
          "type": "u8"
        },
        {
          "name": "start",
          "type": "u8"
        },
        {
          "name": "destination",
          "type": "u8"
        },
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "prepareArenaDaily",
      "discriminator": [
        124,
        44,
        107,
        255,
        253,
        131,
        119,
        19
      ],
      "accounts": [
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "arenaDaily",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  100,
                  97,
                  105,
                  108,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "dayId"
              }
            ]
          }
        },
        {
          "name": "scoreBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arenaDaily"
              },
              {
                "kind": "const",
                "value": [
                  115,
                  99,
                  111,
                  114,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "themeBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97,
                  95,
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arenaDaily"
              },
              {
                "kind": "const",
                "value": [
                  116,
                  104,
                  101,
                  109,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "cadenceFunding",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  100,
                  101,
                  110,
                  99,
                  101,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "dayId",
          "type": "u32"
        }
      ]
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "purchaseKredits",
      "discriminator": [
        207,
        40,
        23,
        70,
        212,
        4,
        253,
        183
      ],
      "accounts": [
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "creditVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  100,
                  105,
                  116,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "teamDestination",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "kreditCount",
          "type": "u32"
        }
      ]
    },
    {
      "name": "recordCampaignStars",
      "discriminator": [
        110,
        150,
        128,
        15,
        241,
        145,
        200,
        96
      ],
      "accounts": [
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "ownerAuthority"
              }
            ]
          }
        },
        {
          "name": "ownerAuthority"
        },
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "actor",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "stars",
          "type": {
            "array": [
              "u8",
              25
            ]
          }
        }
      ]
    },
    {
      "name": "requestReroll",
      "discriminator": [
        143,
        43,
        219,
        79,
        85,
        112,
        137,
        252
      ],
      "accounts": [
        {
          "name": "activeRun",
          "writable": true
        },
        {
          "name": "ownerAuthority"
        },
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "actor",
          "writable": true,
          "signer": true
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "expectedAction",
          "type": "u32"
        },
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "requestVrf",
      "discriminator": [
        5,
        87,
        79,
        152,
        164,
        176,
        190,
        226
      ],
      "accounts": [
        {
          "name": "activeRun",
          "writable": true
        },
        {
          "name": "ownerAuthority"
        },
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "actor",
          "writable": true,
          "signer": true
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "setArenaSuspension",
      "discriminator": [
        63,
        137,
        66,
        46,
        61,
        168,
        231,
        58
      ],
      "accounts": [
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "protocol"
          ]
        }
      ],
      "args": [
        {
          "name": "suspendedUntilDay",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setFeaturedEmblem",
      "discriminator": [
        244,
        224,
        61,
        60,
        103,
        62,
        90,
        65
      ],
      "accounts": [
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "ownerAuthority"
              }
            ]
          }
        },
        {
          "name": "ownerAuthority"
        },
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "actor",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "emblemId",
          "type": "u8"
        },
        {
          "name": "frameTier",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setProtocolPause",
      "discriminator": [
        19,
        235,
        135,
        250,
        184,
        114,
        209,
        89
      ],
      "accounts": [
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "protocol"
          ]
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "activeRun",
      "discriminator": [
        18,
        213,
        113,
        41,
        44,
        1,
        247,
        233
      ]
    },
    {
      "name": "arenaBoard",
      "discriminator": [
        28,
        3,
        209,
        26,
        146,
        215,
        216,
        105
      ]
    },
    {
      "name": "arenaDaily",
      "discriminator": [
        228,
        157,
        121,
        82,
        246,
        25,
        89,
        216
      ]
    },
    {
      "name": "arenaPlayer",
      "discriminator": [
        234,
        4,
        116,
        159,
        57,
        241,
        251,
        233
      ]
    },
    {
      "name": "creditVault",
      "discriminator": [
        143,
        180,
        135,
        248,
        84,
        85,
        183,
        70
      ]
    },
    {
      "name": "playerState",
      "discriminator": [
        56,
        3,
        60,
        86,
        174,
        16,
        244,
        195
      ]
    },
    {
      "name": "protocolConfig",
      "discriminator": [
        207,
        91,
        250,
        28,
        152,
        179,
        215,
        209
      ]
    }
  ],
  "events": [
    {
      "name": "dailyFinalized",
      "discriminator": [
        137,
        20,
        11,
        151,
        190,
        138,
        60,
        80
      ]
    },
    {
      "name": "runScored",
      "discriminator": [
        182,
        97,
        5,
        51,
        139,
        99,
        63,
        253
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "gameOver",
      "msg": "The run is already terminal"
    },
    {
      "code": 6001,
      "name": "invalidMove",
      "msg": "The move coordinates are invalid"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "Only the configured authority may perform this action"
    },
    {
      "code": 6003,
      "name": "insufficientFunds",
      "msg": "The source account has insufficient funds"
    },
    {
      "code": 6004,
      "name": "invalidState",
      "msg": "The account is in an invalid state for this instruction"
    },
    {
      "code": 6005,
      "name": "invalidOwner",
      "msg": "The account owner or relationship is invalid"
    },
    {
      "code": 6006,
      "name": "invalidMoveOrder",
      "msg": "The expected move or action counter does not match"
    },
    {
      "code": 6007,
      "name": "arithmeticOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6008,
      "name": "protocolPaused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6009,
      "name": "invalidVersion",
      "msg": "Unsupported account version"
    },
    {
      "code": 6010,
      "name": "invalidRunId",
      "msg": "Invalid run id"
    },
    {
      "code": 6011,
      "name": "activeRunExists",
      "msg": "Finish or abandon the active run before starting another"
    },
    {
      "code": 6012,
      "name": "vrfRequestPending",
      "msg": "A VRF request is already pending"
    },
    {
      "code": 6013,
      "name": "vrfRequestMismatch",
      "msg": "The VRF callback does not match the pending request"
    },
    {
      "code": 6014,
      "name": "noPrize",
      "msg": "The player has no Daily prize"
    },
    {
      "code": 6015,
      "name": "boardIncomplete",
      "msg": "The Daily is not finalized, so its boards are not sealed"
    },
    {
      "code": 6016,
      "name": "accountingInvariant",
      "msg": "The financial accounting invariant does not balance"
    },
    {
      "code": 6017,
      "name": "insufficientKredits",
      "msg": "The player does not have a Kredit available"
    },
    {
      "code": 6018,
      "name": "dailyNotScheduled",
      "msg": "No paid Daily is scheduled for this day"
    },
    {
      "code": 6019,
      "name": "invalidSession",
      "msg": "The scoped player session is invalid"
    },
    {
      "code": 6020,
      "name": "invalidEmblem",
      "msg": "The featured emblem is invalid or not unlocked"
    },
    {
      "code": 6021,
      "name": "invalidPeriod",
      "msg": "The provided period is not the canonical current or successor period"
    },
    {
      "code": 6022,
      "name": "dailyFull",
      "msg": "This Daily has admitted every player it can size a board for"
    }
  ],
  "types": [
    {
      "name": "activeRun",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "rentPayer",
            "docs": [
              "Original signer that funded this account and receives its rent back."
            ],
            "type": "pubkey"
          },
          {
            "name": "dailyChallenge",
            "type": "pubkey"
          },
          {
            "name": "runId",
            "type": "u64"
          },
          {
            "name": "lifecycle",
            "type": {
              "defined": {
                "name": "runLifecycle"
              }
            }
          },
          {
            "name": "finishReason",
            "docs": [
              "Explicit caller-selected terminal resolution. Automatic completion or",
              "exhaustion keeps this empty."
            ],
            "type": {
              "option": {
                "defined": {
                  "name": "runFinishReason"
                }
              }
            }
          },
          {
            "name": "rulesHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "deadlineAt",
            "docs": [
              "Ranked actions and VRF callbacks are rejected at this immutable cutoff."
            ],
            "type": "i64"
          },
          {
            "name": "mapId",
            "type": "u8"
          },
          {
            "name": "rules",
            "type": {
              "defined": {
                "name": "realmRuleSnapshot"
              }
            }
          },
          {
            "name": "grid",
            "type": {
              "array": [
                "u8",
                80
              ]
            }
          },
          {
            "name": "nextRow",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "hasNextRow",
            "type": "bool"
          },
          {
            "name": "score",
            "type": "u32"
          },
          {
            "name": "dailyScore",
            "docs": [
              "Arena leaderboard score: pressure-scaled triangular action points."
            ],
            "type": "u32"
          },
          {
            "name": "objectiveTotal",
            "docs": [
              "Uncapped shared-kind increments attributable only to the Daily theme."
            ],
            "type": "u64"
          },
          {
            "name": "pressureScore",
            "type": "u32"
          },
          {
            "name": "dailyTheme",
            "type": {
              "defined": {
                "name": "dailyThemeSnapshot"
              }
            }
          },
          {
            "name": "actionCounter",
            "type": "u32"
          },
          {
            "name": "moves",
            "type": "u16"
          },
          {
            "name": "comboCounter",
            "docs": [
              "Saturating count of player moves that cleared at least two lines."
            ],
            "type": "u8"
          },
          {
            "name": "maxCombo",
            "type": "u8"
          },
          {
            "name": "streak",
            "docs": [
              "Consecutive player moves that each clear at least one line."
            ],
            "type": "u8"
          },
          {
            "name": "chargesEarned",
            "docs": [
              "Guardian trigger events produced across the run, before inventory caps."
            ],
            "type": "u8"
          },
          {
            "name": "levelLinesCleared",
            "type": "u16"
          },
          {
            "name": "bonusCharges",
            "type": "u8"
          },
          {
            "name": "rerollCharges",
            "docs": [
              "Held preview replacements; every run starts with one."
            ],
            "type": "u8"
          },
          {
            "name": "vrfRequestCounter",
            "docs": [
              "VRF requests issued for this run so far; the next request takes this number."
            ],
            "type": "u32"
          },
          {
            "name": "pendingVrfCounter",
            "type": "u32"
          },
          {
            "name": "replayHash",
            "docs": [
              "Domain-separated rolling commitment over rules, VRF rows, and actions."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "finishedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "arenaBoard",
      "docs": [
        "One board of a Daily. While the Daily runs, the account is this header",
        "followed by the retained rows, best first; only consuming a run writes",
        "them. Finalization fills the payout fields, keeps the paying rows and",
        "appends one claim bit per row. A board is sealed exactly when its Daily is",
        "finalized, so it carries no clock of its own."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "arenaDaily",
            "type": "pubkey"
          },
          {
            "name": "dayId",
            "type": "u32"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "dailyBoardKind"
              }
            }
          },
          {
            "name": "qualifiedCount",
            "type": "u32"
          },
          {
            "name": "widthCount",
            "type": "u32"
          },
          {
            "name": "payoutCount",
            "type": "u32"
          },
          {
            "name": "denominator",
            "type": "u128"
          },
          {
            "name": "poolLamports",
            "type": "u64"
          },
          {
            "name": "paidLamports",
            "type": "u64"
          },
          {
            "name": "rolloverLamports",
            "type": "u64"
          },
          {
            "name": "capacityLimited",
            "type": "bool"
          },
          {
            "name": "claimedLamports",
            "type": "u64"
          },
          {
            "name": "claimedCount",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "arenaBoardEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "score",
            "type": "u32"
          },
          {
            "name": "objectiveTotal",
            "type": "u64"
          },
          {
            "name": "finalizedAt",
            "type": "i64"
          },
          {
            "name": "replayHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "arenaDaily",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "dayId",
            "type": "u32"
          },
          {
            "name": "predecessorDay",
            "docs": [
              "The Daily prepared before this one. Its entries' prize share and its",
              "rollover reach this Daily only from that day, when it finalizes."
            ],
            "type": "u32"
          },
          {
            "name": "predecessorRolloverApplied",
            "type": "bool"
          },
          {
            "name": "rulesHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "finalizedAt",
            "type": "i64"
          },
          {
            "name": "ledger",
            "type": {
              "defined": {
                "name": "poolLedger"
              }
            }
          },
          {
            "name": "entriesPaid",
            "type": "u64"
          },
          {
            "name": "entriesScored",
            "type": "u64"
          },
          {
            "name": "entriesExpired",
            "type": "u64"
          },
          {
            "name": "uniquePlayers",
            "type": "u32"
          },
          {
            "name": "scoreQualifiedPlayers",
            "type": "u32"
          },
          {
            "name": "themeQualifiedPlayers",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "arenaPlayer",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "challenge",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "rentPayer",
            "docs": [
              "Original signer that funded this account and receives its rent back."
            ],
            "type": "pubkey"
          },
          {
            "name": "paidEntries",
            "type": "u32"
          },
          {
            "name": "resolvedEntries",
            "type": "u32"
          },
          {
            "name": "activePaidRunId",
            "type": "u64"
          },
          {
            "name": "scoreBest",
            "type": {
              "defined": {
                "name": "bestRun"
              }
            }
          },
          {
            "name": "themeBest",
            "type": {
              "defined": {
                "name": "bestRun"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "bestRun",
      "docs": [
        "A wallet's best result on one board of one Daily. The wallet is the",
        "daily player account's own `player`, so it is not repeated here."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "score",
            "type": "u32"
          },
          {
            "name": "objectiveTotal",
            "type": "u64"
          },
          {
            "name": "finalizedAt",
            "type": "i64"
          },
          {
            "name": "replayHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "competitionRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bestPrizeRank",
            "docs": [
              "Zero means no payout-bearing Daily rank."
            ],
            "type": "u16"
          },
          {
            "name": "wins",
            "type": "u32"
          },
          {
            "name": "rewardsLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "creditVault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "protocol",
            "type": "pubkey"
          },
          {
            "name": "availablePrizeLamports",
            "docs": [
              "Prize deposits not yet routed to a Daily by spent Kredits."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "dailyBoardKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "score"
          },
          {
            "name": "theme"
          }
        ]
      }
    },
    {
      "name": "dailyFinalized",
      "docs": [
        "Logged when a Daily really finalizes: not when a finalization finds it done",
        "already, and not when one yields for lack of compute. The public read model",
        "records a finalization only from this."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dayId",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "dailyThemeSnapshot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "value",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "guardianSnapshot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bonus",
            "type": "u8"
          },
          {
            "name": "trigger",
            "type": "u8"
          },
          {
            "name": "threshold",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "initializeProtocolArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "teamDestination",
            "type": "pubkey"
          },
          {
            "name": "replayDomain",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "playerState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "nextRunId",
            "type": "u64"
          },
          {
            "name": "activeRunId",
            "docs": [
              "Zero when the Arcade slot is idle."
            ],
            "type": "u64"
          },
          {
            "name": "activeRunDaily",
            "docs": [
              "Base-layer reservation remains authoritative while the run PDA is",
              "delegated to an ephemeral rollup."
            ],
            "type": "pubkey"
          },
          {
            "name": "activeRunDeadlineAt",
            "type": "i64"
          },
          {
            "name": "orphanRunId",
            "docs": [
              "A deterministically expired run remains reserved until its delayed ER",
              "copy is committed and the orphan account is closed."
            ],
            "type": "u64"
          },
          {
            "name": "campaignStars",
            "docs": [
              "Two bits per level for exactly ten zones of ten levels. Campaign stars",
              "are the sole progression source; all unlocks and badges are derived."
            ],
            "type": {
              "array": [
                "u8",
                25
              ]
            }
          },
          {
            "name": "featuredEmblem",
            "docs": [
              "Zero selects the strongest currently unlocked emblem automatically."
            ],
            "type": "u8"
          },
          {
            "name": "scoreRecord",
            "docs": [
              "The two Daily boards keep separate records. They rank the same runs by",
              "different metrics, so one aggregate cannot say whether a player wins by",
              "total performance or by playing the day's theme — which is the whole",
              "reason the pot splits in two."
            ],
            "type": {
              "defined": {
                "name": "competitionRecord"
              }
            }
          },
          {
            "name": "themeRecord",
            "type": {
              "defined": {
                "name": "competitionRecord"
              }
            }
          },
          {
            "name": "kreditBalance",
            "docs": [
              "One-way prepaid entries owned by this wallet identity."
            ],
            "type": "u64"
          },
          {
            "name": "ladderPoints",
            "docs": [
              "Monotonic, non-monetary points accumulated by qualification and claims."
            ],
            "type": "u64"
          },
          {
            "name": "highestLadderTier",
            "docs": [
              "Highest ladder tier ever reached; it never decreases, even through a reset."
            ],
            "type": "u8"
          },
          {
            "name": "featuredFrameTier",
            "docs": [
              "Ladder border the player has chosen to wear. Any tier they have ever",
              "reached stays available: a rank is earned once, and a border the player",
              "liked should not be taken back by a later reset."
            ],
            "type": "u8"
          },
          {
            "name": "bestDailyScore",
            "docs": [
              "Best `daily_score` ever recorded on a scored arcade run. A board keeps",
              "only payout-bearing rows and its accounts are recycled, so a personal",
              "best has nowhere else to survive."
            ],
            "type": "u32"
          },
          {
            "name": "lastEntryDayId",
            "docs": [
              "Day identifier of the most recent paid entry, which the streak below",
              "is measured against."
            ],
            "type": "u32"
          },
          {
            "name": "entryStreakDays",
            "docs": [
              "Consecutive days carrying at least one paid entry."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "poolLedger",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seededLamports",
            "type": "u64"
          },
          {
            "name": "entryLamports",
            "docs": [
              "The prize share of the entries of the Daily before this one."
            ],
            "type": "u64"
          },
          {
            "name": "rolloverInLamports",
            "type": "u64"
          },
          {
            "name": "payoutLamports",
            "type": "u64"
          },
          {
            "name": "rolloverOutLamports",
            "type": "u64"
          },
          {
            "name": "nextPotLamports",
            "docs": [
              "The prize share of this Daily's own entries. It waits here, outside",
              "this Daily's pot, and moves to the next Daily at finalization."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "protocolConfig",
      "docs": [
        "Run identifiers are per-player and begin at one on every fresh deployment."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "teamDestination",
            "type": "pubkey"
          },
          {
            "name": "replayDomain",
            "docs": [
              "Chain/deployment-specific replay domain used by canonical replay v2."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "suspendedUntilDay",
            "docs": [
              "Days below this absolute identifier are suspended; zero disables it."
            ],
            "type": "u32"
          },
          {
            "name": "launchDayId",
            "type": "u32"
          },
          {
            "name": "lastPreparedDay",
            "docs": [
              "Highest prepared Daily; the next prepared Daily names it as predecessor."
            ],
            "type": "u32"
          },
          {
            "name": "lastDailyId",
            "docs": [
              "Last finalized Daily committed by the permanent result root."
            ],
            "type": "u32"
          },
          {
            "name": "dailyRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "realmRuleSnapshot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "guardian",
            "type": {
              "defined": {
                "name": "guardianSnapshot"
              }
            }
          },
          {
            "name": "startingRows",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "runFinishReason",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "abandon"
          },
          {
            "name": "deadline"
          }
        ]
      }
    },
    {
      "name": "runLifecycle",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "prepared"
          },
          {
            "name": "delegated"
          },
          {
            "name": "awaitingVrf"
          },
          {
            "name": "playing"
          },
          {
            "name": "finished"
          }
        ]
      }
    },
    {
      "name": "runScored",
      "docs": [
        "Logged when a scored run is consumed. A finalized board keeps only its",
        "paying rows and daily player accounts close, so this is the public record",
        "of every result, including the ranks below the paying rows. It grants",
        "nothing: boards and claims never read it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dayId",
            "type": "u32"
          },
          {
            "name": "runId",
            "type": "u64"
          },
          {
            "name": "row",
            "type": {
              "defined": {
                "name": "arenaBoardEntry"
              }
            }
          }
        ]
      }
    },
    {
      "name": "sessionTokenV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "targetProgram",
            "type": "pubkey"
          },
          {
            "name": "sessionSigner",
            "type": "pubkey"
          },
          {
            "name": "feePayer",
            "type": "pubkey"
          },
          {
            "name": "validUntil",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
