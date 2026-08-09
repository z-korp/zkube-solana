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
      "name": "abandonRun",
      "discriminator": [
        35,
        86,
        196,
        223,
        149,
        225,
        12,
        24
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
      "args": []
    },
    {
      "name": "acceptProtocolAuthority",
      "discriminator": [
        237,
        122,
        6,
        39,
        53,
        202,
        141,
        113
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
          "name": "pendingAuthority",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "activateArenaDaily",
      "discriminator": [
        119,
        214,
        15,
        122,
        237,
        1,
        96,
        197
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
          "name": "dailyRulesCatalog"
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
          "name": "caller",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "activateArenaRules",
      "discriminator": [
        209,
        23,
        60,
        135,
        59,
        141,
        138,
        142
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
          "name": "arcadeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "dailyRulesCatalog"
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "protocol"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "activateCampaignMap",
      "discriminator": [
        241,
        93,
        123,
        235,
        248,
        135,
        200,
        83
      ],
      "accounts": [
        {
          "name": "protocol",
          "writable": true
        },
        {
          "name": "mapCatalog"
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "protocol"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "activateContentRelease",
      "discriminator": [
        112,
        124,
        37,
        124,
        159,
        223,
        144,
        145
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
          "name": "dailyRulesCatalog",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  105,
                  108,
                  121,
                  95,
                  114,
                  117,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "arg",
                "path": "dailyRulesVersion"
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
          "name": "contentVersion",
          "type": "u32"
        },
        {
          "name": "dailyRulesVersion",
          "type": "u32"
        },
        {
          "name": "campaignMapCount",
          "type": "u8"
        }
      ]
    },
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
          "name": "delegationRecordActive"
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
      "name": "archiveArenaDaily",
      "discriminator": [
        145,
        28,
        86,
        204,
        154,
        22,
        173,
        217
      ],
      "accounts": [
        {
          "name": "arcadeArchive",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101,
                  95,
                  97,
                  114,
                  99,
                  104,
                  105,
                  118,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "arenaDaily",
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
          "name": "caller",
          "signer": true
        }
      ],
      "args": []
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
          "name": "board",
          "type": {
            "defined": {
              "name": "dailyBoardKind"
            }
          }
        }
      ]
    },
    {
      "name": "cleanupOrphanActiveRun",
      "discriminator": [
        181,
        40,
        52,
        240,
        230,
        27,
        96,
        63
      ],
      "accounts": [
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
          "name": "rentRecipient",
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
                  114,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
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
          "name": "caller",
          "signer": true
        }
      ],
      "args": []
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
          "name": "arcadeArchive",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101,
                  95,
                  97,
                  114,
                  99,
                  104,
                  105,
                  118,
                  101
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
            "closed System placeholder."
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
                  114,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
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
                "path": "arenaDaily"
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
                  114,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "active_run.owner",
                "account": "activeRun"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "consumeCampaignRun",
      "discriminator": [
        168,
        216,
        114,
        59,
        82,
        199,
        176,
        11
      ],
      "accounts": [
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
                "path": "owner"
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
          "name": "owner",
          "relations": [
            "activeRun",
            "playerState"
          ]
        },
        {
          "name": "rentRecipient",
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
                  114,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "createPlayerLabel",
      "discriminator": [
        61,
        83,
        168,
        37,
        203,
        195,
        254,
        100
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
          "name": "playerLabel",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  98,
                  101,
                  108
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
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "playerLabelArgs"
            }
          }
        }
      ]
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
          "name": "arcadeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101
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
                "kind": "account",
                "path": "following_daily.day_id",
                "account": "arenaDaily"
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
      "args": [
        {
          "name": "runId",
          "type": "u64"
        },
        {
          "name": "expectedEntryLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "expireDailyClaims",
      "discriminator": [
        68,
        234,
        33,
        180,
        137,
        221,
        235,
        146
      ],
      "accounts": [
        {
          "name": "arcadeArchive",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101,
                  95,
                  97,
                  114,
                  99,
                  104,
                  105,
                  118,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "arcadeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "dailyRulesCatalog"
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
                "kind": "account",
                "path": "following_daily.day_id",
                "account": "arenaDaily"
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
      "name": "expireUnresolvedArenaRun",
      "discriminator": [
        39,
        183,
        178,
        83,
        131,
        219,
        138,
        63
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
                "path": "owner"
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
                "path": "arenaDaily"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner"
        },
        {
          "name": "caller",
          "signer": true
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
                "kind": "account",
                "path": "following_daily.day_id",
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
          "name": "cadenceFunding",
          "docs": [
            "Canonical recyclable cadence-rent PDA. It can sign only through the",
            "narrow funded self-CPI wrapper."
          ],
          "writable": true,
          "signer": true,
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
          "name": "scorePayoutCount",
          "type": "u32"
        },
        {
          "name": "themePayoutCount",
          "type": "u32"
        }
      ]
    },
    {
      "name": "forceFinishDeadline",
      "discriminator": [
        127,
        24,
        175,
        82,
        140,
        88,
        108,
        159
      ],
      "accounts": [
        {
          "name": "activeRun",
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
        },
        {
          "name": "magicFeeVault",
          "docs": [
            "protocol infrastructure for gasless ER VRF and is unrelated to the",
            "owner's base-layer player funding PDA."
          ],
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
      "name": "fundedCreatePlayerLabel",
      "discriminator": [
        28,
        170,
        69,
        230,
        197,
        34,
        128,
        83
      ],
      "accounts": [
        {
          "name": "protocol"
        },
        {
          "name": "playerState"
        },
        {
          "name": "playerLabel",
          "writable": true
        },
        {
          "name": "playerFunding",
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
                  114,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
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
          "name": "sessionToken"
        },
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "zkubeProgram",
          "address": "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "playerLabelArgs"
            }
          }
        }
      ]
    },
    {
      "name": "fundedDelegateActiveRun",
      "discriminator": [
        102,
        174,
        16,
        12,
        194,
        90,
        137,
        177
      ],
      "accounts": [
        {
          "name": "bufferPda",
          "writable": true
        },
        {
          "name": "delegationRecordPda",
          "writable": true
        },
        {
          "name": "delegationMetadataPda",
          "writable": true
        },
        {
          "name": "pda",
          "writable": true
        },
        {
          "name": "playerFunding",
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
                  114,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
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
          "name": "sessionToken"
        },
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "ownerProgram",
          "address": "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd"
        },
        {
          "name": "delegationProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "fundedEnterArena",
      "discriminator": [
        206,
        116,
        24,
        77,
        137,
        195,
        205,
        22
      ],
      "accounts": [
        {
          "name": "protocol"
        },
        {
          "name": "arcadeConfig"
        },
        {
          "name": "playerState",
          "writable": true
        },
        {
          "name": "currentDaily",
          "writable": true
        },
        {
          "name": "arenaPlayer",
          "writable": true
        },
        {
          "name": "followingDaily",
          "writable": true
        },
        {
          "name": "creditVault",
          "writable": true
        },
        {
          "name": "activeRun",
          "writable": true
        },
        {
          "name": "playerFunding",
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
                  114,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
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
          "name": "sessionToken"
        },
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "zkubeProgram",
          "address": "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd"
        }
      ],
      "args": [
        {
          "name": "runId",
          "type": "u64"
        },
        {
          "name": "expectedEntryLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fundedFinalizeArenaDaily",
      "discriminator": [
        44,
        120,
        53,
        233,
        237,
        29,
        9,
        251
      ],
      "accounts": [
        {
          "name": "arenaDaily",
          "writable": true
        },
        {
          "name": "followingDaily",
          "writable": true
        },
        {
          "name": "scoreBoard",
          "writable": true
        },
        {
          "name": "themeBoard",
          "writable": true
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
        },
        {
          "name": "zkubeProgram",
          "address": "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd"
        }
      ],
      "args": [
        {
          "name": "scorePayoutCount",
          "type": "u32"
        },
        {
          "name": "themePayoutCount",
          "type": "u32"
        }
      ]
    },
    {
      "name": "fundedPrepareArenaDaily",
      "discriminator": [
        49,
        198,
        221,
        1,
        136,
        42,
        220,
        205
      ],
      "accounts": [
        {
          "name": "protocol"
        },
        {
          "name": "arcadeConfig"
        },
        {
          "name": "arcadeArchive"
        },
        {
          "name": "dailyRulesCatalog"
        },
        {
          "name": "realmMapCatalog"
        },
        {
          "name": "passiveMapCatalog"
        },
        {
          "name": "arenaDaily",
          "writable": true
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
        },
        {
          "name": "zkubeProgram",
          "address": "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd"
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
      "name": "fundedPrepareCampaignRun",
      "discriminator": [
        100,
        111,
        127,
        144,
        180,
        127,
        15,
        84
      ],
      "accounts": [
        {
          "name": "protocol"
        },
        {
          "name": "playerState",
          "docs": [
            "this unchecked prevents Anchor from serializing a stale outer copy over",
            "the changes made by the self-CPI."
          ],
          "writable": true
        },
        {
          "name": "mapCatalog"
        },
        {
          "name": "activeRun",
          "writable": true
        },
        {
          "name": "playerFunding",
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
                  114,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
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
          "name": "sessionToken"
        },
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "zkubeProgram",
          "address": "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd"
        }
      ],
      "args": [
        {
          "name": "runId",
          "type": "u64"
        },
        {
          "name": "mapId",
          "type": "u8"
        },
        {
          "name": "level",
          "type": "u8"
        }
      ]
    },
    {
      "name": "initializeArcade",
      "discriminator": [
        59,
        29,
        147,
        89,
        249,
        229,
        124,
        107
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
          "name": "dailyRulesCatalog"
        },
        {
          "name": "arcadeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "operatorRevenueVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  112,
                  101,
                  114,
                  97,
                  116,
                  111,
                  114,
                  95,
                  114,
                  101,
                  118,
                  101,
                  110,
                  117,
                  101
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
      "args": []
    },
    {
      "name": "initializeArcadeArchive",
      "discriminator": [
        252,
        103,
        113,
        174,
        74,
        226,
        174,
        2
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
          "name": "arcadeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "dailyRulesCatalog"
        },
        {
          "name": "arcadeArchive",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101,
                  95,
                  97,
                  114,
                  99,
                  104,
                  105,
                  118,
                  101
                ]
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
          "name": "firstDayId",
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
          "name": "playerFunding",
          "docs": [
            "account is accepted; no retired program-owned layout is convertible."
          ],
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
                  114,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
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
          "name": "teamDestination"
        },
        {
          "name": "authority",
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
          "name": "delegationRecordActive"
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
          "name": "arcadeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "arcadeArchive",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101,
                  95,
                  97,
                  114,
                  99,
                  104,
                  105,
                  118,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "dailyRulesCatalog"
        },
        {
          "name": "realmMapCatalog"
        },
        {
          "name": "passiveMapCatalog"
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
          "name": "payer",
          "writable": true,
          "signer": true
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
      "name": "prepareCampaignRun",
      "discriminator": [
        196,
        98,
        234,
        167,
        109,
        145,
        158,
        94
      ],
      "accounts": [
        {
          "name": "protocol"
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
          "name": "mapCatalog"
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
      "args": [
        {
          "name": "runId",
          "type": "u64"
        },
        {
          "name": "mapId",
          "type": "u8"
        },
        {
          "name": "level",
          "type": "u8"
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
      "name": "proposeProtocolAuthority",
      "discriminator": [
        196,
        230,
        103,
        192,
        225,
        211,
        253,
        246
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
          "name": "pendingAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "publishArenaRules",
      "discriminator": [
        116,
        174,
        217,
        126,
        196,
        62,
        165,
        90
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
          "name": "dailyRulesCatalog",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  105,
                  108,
                  121,
                  95,
                  114,
                  117,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "arg",
                "path": "args.rules_version"
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
          "name": "args",
          "type": {
            "defined": {
              "name": "publishArenaRulesArgs"
            }
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
          "name": "arcadeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101
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
          "name": "operatorRevenueVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  112,
                  101,
                  114,
                  97,
                  116,
                  111,
                  114,
                  95,
                  114,
                  101,
                  118,
                  101,
                  110,
                  117,
                  101
                ]
              }
            ]
          }
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
        },
        {
          "name": "expectedUnitLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "requestRowVrf",
      "discriminator": [
        9,
        81,
        254,
        165,
        167,
        236,
        63,
        112
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
          "name": "delegationRecordActive"
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
      "name": "seedLaunchPools",
      "discriminator": [
        0,
        171,
        164,
        86,
        246,
        236,
        150,
        59
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
          "name": "arcadeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101
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
          "name": "dailyLamports",
          "type": "u64"
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
        }
      ]
    },
    {
      "name": "setPlayerLabel",
      "discriminator": [
        9,
        240,
        56,
        233,
        167,
        202,
        97,
        44
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
          "name": "playerLabel",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  98,
                  101,
                  108
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
          "name": "args",
          "type": {
            "defined": {
              "name": "playerLabelArgs"
            }
          }
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
    },
    {
      "name": "submitArenaBoardChunk",
      "discriminator": [
        121,
        149,
        35,
        141,
        119,
        21,
        206,
        131
      ],
      "accounts": [
        {
          "name": "arenaDaily",
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
                "path": "kind"
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
          "name": "kind",
          "type": {
            "defined": {
              "name": "dailyBoardKind"
            }
          }
        },
        {
          "name": "entries",
          "type": {
            "vec": {
              "defined": {
                "name": "submittedBoardEntry"
              }
            }
          }
        },
        {
          "name": "seal",
          "type": "bool"
        }
      ]
    },
    {
      "name": "syncDailyProfile",
      "discriminator": [
        35,
        146,
        149,
        125,
        173,
        65,
        199,
        49
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
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
                "path": "player_state.owner",
                "account": "playerState"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "board",
          "type": {
            "defined": {
              "name": "dailyBoardKind"
            }
          }
        }
      ]
    },
    {
      "name": "topUpArenaDaily",
      "discriminator": [
        254,
        172,
        152,
        98,
        150,
        111,
        105,
        28
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
          "name": "arcadeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  99,
                  97,
                  100,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "dailyRulesCatalog"
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
      "name": "updateTeamDestination",
      "discriminator": [
        16,
        114,
        229,
        63,
        229,
        123,
        12,
        250
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
          "name": "teamDestination"
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "protocol"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "withdrawOperatorRevenue",
      "discriminator": [
        230,
        148,
        0,
        222,
        126,
        208,
        248,
        212
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
          "name": "operatorRevenueVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  112,
                  101,
                  114,
                  97,
                  116,
                  111,
                  114,
                  95,
                  114,
                  101,
                  118,
                  101,
                  110,
                  117,
                  101
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
          "name": "authority",
          "signer": true,
          "relations": [
            "protocol"
          ]
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
      "name": "withdrawPlayerFunding",
      "discriminator": [
        186,
        115,
        58,
        115,
        207,
        128,
        127,
        224
      ],
      "accounts": [
        {
          "name": "playerFunding",
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
                  114,
                  95,
                  102,
                  117,
                  110,
                  100,
                  105,
                  110,
                  103
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
          "name": "lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "writeMapCatalog",
      "discriminator": [
        217,
        226,
        89,
        178,
        63,
        54,
        125,
        83
      ],
      "accounts": [
        {
          "name": "protocol"
        },
        {
          "name": "mapCatalog",
          "writable": true
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
          "name": "args",
          "type": {
            "defined": {
              "name": "writeMapCatalogArgs"
            }
          }
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
      "name": "arcadeArchive",
      "discriminator": [
        217,
        86,
        182,
        61,
        130,
        66,
        2,
        190
      ]
    },
    {
      "name": "arcadeConfig",
      "discriminator": [
        72,
        72,
        85,
        65,
        185,
        246,
        125,
        96
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
      "name": "dailyRulesCatalog",
      "discriminator": [
        93,
        100,
        115,
        16,
        136,
        177,
        218,
        183
      ]
    },
    {
      "name": "mapCatalog",
      "discriminator": [
        24,
        88,
        127,
        223,
        53,
        15,
        187,
        130
      ]
    },
    {
      "name": "operatorRevenueVault",
      "discriminator": [
        56,
        144,
        233,
        76,
        43,
        97,
        107,
        200
      ]
    },
    {
      "name": "playerLabel",
      "discriminator": [
        190,
        106,
        117,
        227,
        51,
        162,
        202,
        216
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
      "name": "cadenceArchived",
      "discriminator": [
        233,
        44,
        114,
        4,
        20,
        38,
        100,
        186
      ]
    },
    {
      "name": "campaignLevelRewarded",
      "discriminator": [
        5,
        6,
        248,
        45,
        123,
        108,
        217,
        107
      ]
    },
    {
      "name": "competitionProfileSynced",
      "discriminator": [
        119,
        50,
        140,
        56,
        141,
        91,
        185,
        106
      ]
    },
    {
      "name": "contentReleaseActivated",
      "discriminator": [
        159,
        30,
        50,
        177,
        23,
        41,
        6,
        246
      ]
    },
    {
      "name": "dailyClaimsExpired",
      "discriminator": [
        170,
        108,
        47,
        73,
        96,
        233,
        198,
        92
      ]
    },
    {
      "name": "dailyPrizeClaimed",
      "discriminator": [
        216,
        54,
        95,
        104,
        170,
        90,
        193,
        179
      ]
    },
    {
      "name": "featuredEmblemSet",
      "discriminator": [
        108,
        243,
        154,
        135,
        9,
        73,
        25,
        108
      ]
    },
    {
      "name": "kreditsPurchased",
      "discriminator": [
        70,
        98,
        220,
        228,
        8,
        206,
        14,
        217
      ]
    },
    {
      "name": "playerLabelSet",
      "discriminator": [
        74,
        160,
        127,
        145,
        172,
        254,
        51,
        31
      ]
    },
    {
      "name": "prizePoolFunded",
      "discriminator": [
        38,
        202,
        147,
        153,
        180,
        195,
        54,
        247
      ]
    },
    {
      "name": "protocolAuthorityAccepted",
      "discriminator": [
        14,
        90,
        138,
        158,
        76,
        49,
        104,
        97
      ]
    },
    {
      "name": "protocolAuthorityProposed",
      "discriminator": [
        73,
        229,
        220,
        91,
        40,
        178,
        53,
        17
      ]
    },
    {
      "name": "protocolPauseChanged",
      "discriminator": [
        67,
        33,
        235,
        73,
        71,
        124,
        172,
        110
      ]
    },
    {
      "name": "teamDestinationChanged",
      "discriminator": [
        25,
        40,
        202,
        69,
        125,
        154,
        54,
        205
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
      "name": "invalidMagicProgram",
      "msg": "The MagicBlock program is invalid"
    },
    {
      "code": 6008,
      "name": "gameNotFinished",
      "msg": "The run is not ready to finish"
    },
    {
      "code": 6009,
      "name": "challengeNotStarted",
      "msg": "The Daily challenge has not started"
    },
    {
      "code": 6010,
      "name": "challengeEnded",
      "msg": "The Daily challenge entry or play window has ended"
    },
    {
      "code": 6011,
      "name": "challengeNotEnded",
      "msg": "The Daily challenge has not ended"
    },
    {
      "code": 6012,
      "name": "alreadySubmitted",
      "msg": "This Daily attempt has already been submitted"
    },
    {
      "code": 6013,
      "name": "arithmeticOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6014,
      "name": "invalidMap",
      "msg": "Invalid map"
    },
    {
      "code": 6015,
      "name": "invalidLevel",
      "msg": "Invalid level"
    },
    {
      "code": 6016,
      "name": "invalidStars",
      "msg": "Invalid star rating"
    },
    {
      "code": 6017,
      "name": "protocolPaused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6018,
      "name": "invalidVersion",
      "msg": "Unsupported account version"
    },
    {
      "code": 6019,
      "name": "invalidRunId",
      "msg": "Invalid run id"
    },
    {
      "code": 6020,
      "name": "activeRunExists",
      "msg": "Finish or abandon the active run before starting another"
    },
    {
      "code": 6021,
      "name": "mapLocked",
      "msg": "Map is locked"
    },
    {
      "code": 6022,
      "name": "mapDisabled",
      "msg": "Map is disabled"
    },
    {
      "code": 6023,
      "name": "contentVersionMismatch",
      "msg": "Content version mismatch"
    },
    {
      "code": 6024,
      "name": "invalidBlockWeights",
      "msg": "Invalid block weights"
    },
    {
      "code": 6025,
      "name": "vrfRequestPending",
      "msg": "A VRF request is already pending"
    },
    {
      "code": 6026,
      "name": "noVrfRequestPending",
      "msg": "No VRF request is pending"
    },
    {
      "code": 6027,
      "name": "vrfRequestMismatch",
      "msg": "The VRF callback does not match the pending request"
    },
    {
      "code": 6028,
      "name": "noPrize",
      "msg": "The player has no Daily prize"
    },
    {
      "code": 6029,
      "name": "prizeAlreadyClaimed",
      "msg": "This Daily prize position was already claimed"
    },
    {
      "code": 6030,
      "name": "claimWindowClosed",
      "msg": "The Daily prize claim window has closed"
    },
    {
      "code": 6031,
      "name": "claimWindowOpen",
      "msg": "The Daily prize claim window is still open"
    },
    {
      "code": 6032,
      "name": "boardCapacityExceeded",
      "msg": "The payout board exceeds the protocol safety ceiling"
    },
    {
      "code": 6033,
      "name": "boardIncomplete",
      "msg": "The payout board is incomplete or unsealed"
    },
    {
      "code": 6034,
      "name": "boardEntryMismatch",
      "msg": "A submitted payout row does not match its ArenaPlayer source"
    },
    {
      "code": 6035,
      "name": "boardEntryOutOfOrder",
      "msg": "Submitted payout rows are not in canonical order"
    },
    {
      "code": 6036,
      "name": "duplicateBoardPlayer",
      "msg": "A player appears more than once on a payout board"
    },
    {
      "code": 6037,
      "name": "accountingInvariant",
      "msg": "The financial accounting invariant does not balance"
    },
    {
      "code": 6038,
      "name": "priceChanged",
      "msg": "The Arena entry price changed; refresh the exact quote"
    },
    {
      "code": 6039,
      "name": "insufficientKredits",
      "msg": "The player does not have a Kredit available"
    },
    {
      "code": 6040,
      "name": "invalidKreditPurchase",
      "msg": "A Kredit purchase must contain a positive whole-number count at the exact unit price"
    },
    {
      "code": 6041,
      "name": "dailyNotScheduled",
      "msg": "No paid Daily is scheduled for this day"
    },
    {
      "code": 6042,
      "name": "invalidSession",
      "msg": "The scoped player session is invalid"
    },
    {
      "code": 6043,
      "name": "sessionExpired",
      "msg": "The scoped player session has expired"
    },
    {
      "code": 6044,
      "name": "invalidPlayerLabel",
      "msg": "The player label is invalid"
    },
    {
      "code": 6045,
      "name": "invalidEmblem",
      "msg": "The featured emblem is invalid or not unlocked"
    },
    {
      "code": 6046,
      "name": "invalidPeriod",
      "msg": "The provided period is not the canonical current or successor period"
    },
    {
      "code": 6047,
      "name": "alreadySeeded",
      "msg": "The first Daily pool was already seeded"
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
            "name": "dailyChallenge",
            "type": "pubkey"
          },
          {
            "name": "runId",
            "type": "u64"
          },
          {
            "name": "mode",
            "type": {
              "defined": {
                "name": "runMode"
              }
            }
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
              "Ranked actions and VRF callbacks are rejected at this immutable cutoff.",
              "Campaign runs use zero (no cadence deadline)."
            ],
            "type": "i64"
          },
          {
            "name": "mapId",
            "type": "u8"
          },
          {
            "name": "level",
            "type": "u8"
          },
          {
            "name": "rules",
            "type": {
              "defined": {
                "name": "levelRuleSnapshot"
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
              "Arena leaderboard score: engine score plus pressure-scaled challenge bonus."
            ],
            "type": "u32"
          },
          {
            "name": "objectiveTotal",
            "docs": [
              "Pressure-scaled points attributable only to the Daily objective."
            ],
            "type": "u64"
          },
          {
            "name": "dailyBonusTriggers",
            "docs": [
              "Number of actions that earned nonzero Daily challenge bonus credit."
            ],
            "type": "u16"
          },
          {
            "name": "pressureScore",
            "type": "u32"
          },
          {
            "name": "dailyScoringRule",
            "type": {
              "defined": {
                "name": "dailyScoringRule"
              }
            }
          },
          {
            "name": "dailyPressure",
            "type": {
              "defined": {
                "name": "dailyPressureProfile"
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
            "type": "u8"
          },
          {
            "name": "maxCombo",
            "type": "u8"
          },
          {
            "name": "arcadeMetrics",
            "docs": [
              "Canonical, full-width run metrics retained for deterministic scoring."
            ],
            "type": {
              "defined": {
                "name": "runMetrics"
              }
            }
          },
          {
            "name": "primaryProgress",
            "type": "u8"
          },
          {
            "name": "secondaryProgress",
            "type": "u8"
          },
          {
            "name": "levelLinesCleared",
            "type": "u16"
          },
          {
            "name": "totalLinesCleared",
            "type": "u16"
          },
          {
            "name": "bonusUses",
            "type": "u16"
          },
          {
            "name": "combo2Hits",
            "type": "u16"
          },
          {
            "name": "combo3Hits",
            "type": "u16"
          },
          {
            "name": "combo4Hits",
            "type": "u16"
          },
          {
            "name": "highComboHits",
            "type": "u16"
          },
          {
            "name": "blocksDestroyedBySize",
            "type": {
              "array": [
                "u16",
                4
              ]
            }
          },
          {
            "name": "bonusType",
            "type": "u8"
          },
          {
            "name": "bonusCharges",
            "type": "u8"
          },
          {
            "name": "perfectTriggerAvailable",
            "docs": [
              "Perfect-clear trigger may award at most once between player moves."
            ],
            "type": "bool"
          },
          {
            "name": "perfectClears",
            "docs": [
              "Number of actual empty-board clears produced during this run."
            ],
            "type": "u16"
          },
          {
            "name": "startingHeightTarget",
            "type": "u8"
          },
          {
            "name": "currentDifficulty",
            "type": "u8"
          },
          {
            "name": "vrfRequestCounter",
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
      "name": "arcadeArchive",
      "docs": [
        "Small, permanent commitment accumulator for recyclable cadence accounts.",
        "",
        "The root is an append-only hash chain. `last_daily_id` advances by exactly",
        "one for every archived result, beginning at the launch cadence.",
        "Operational synchronization and rollup counters deliberately do not enter",
        "the canonical result hashes, so those one-way cleanup steps cannot mutate",
        "an already committed competition result."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "arcadeConfig",
            "type": "pubkey"
          },
          {
            "name": "firstDailyId",
            "type": "u32"
          },
          {
            "name": "lastDailyId",
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
      "name": "arcadeConfig",
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
            "name": "rulesCatalog",
            "type": "pubkey"
          },
          {
            "name": "entryLamports",
            "type": "u64"
          },
          {
            "name": "dailyLamports",
            "type": "u64"
          },
          {
            "name": "operatorLamports",
            "type": "u64"
          },
          {
            "name": "launchSeeded",
            "type": "bool"
          },
          {
            "name": "launchDayId",
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
      "name": "arenaBoard",
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
            "name": "cursor",
            "docs": [
              "Number of verified rows already appended."
            ],
            "type": "u32"
          },
          {
            "name": "sealed",
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
            "name": "profileSyncCount",
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
            "name": "arcadeConfig",
            "type": "pubkey"
          },
          {
            "name": "rulesVersion",
            "type": "u32"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "periodStatus"
              }
            }
          },
          {
            "name": "predecessorRolloverApplied",
            "type": "bool"
          },
          {
            "name": "contentVersion",
            "type": "u32"
          },
          {
            "name": "catalogHash",
            "type": {
              "array": [
                "u8",
                32
              ]
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
            "name": "mapId",
            "type": "u8"
          },
          {
            "name": "passiveMapId",
            "type": "u8"
          },
          {
            "name": "scoringRule",
            "type": {
              "defined": {
                "name": "dailyScoringRule"
              }
            }
          },
          {
            "name": "rules",
            "type": {
              "defined": {
                "name": "levelRuleSnapshot"
              }
            }
          },
          {
            "name": "pressure",
            "type": {
              "defined": {
                "name": "dailyPressureProfile"
              }
            }
          },
          {
            "name": "opensAt",
            "type": "i64"
          },
          {
            "name": "entriesCloseAt",
            "type": "i64"
          },
          {
            "name": "runsCloseAt",
            "type": "i64"
          },
          {
            "name": "recoveryDeadlineAt",
            "type": "i64"
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
            "name": "claimsExpired",
            "docs": [
              "Set exactly once after the claim window and unclaimed transfer."
            ],
            "type": "bool"
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
            "name": "hasScoreBest",
            "type": "bool"
          },
          {
            "name": "scoreBestEntry",
            "type": {
              "defined": {
                "name": "arenaBoardEntry"
              }
            }
          },
          {
            "name": "scoreBestRunId",
            "docs": [
              "Retained outside the payout row for client replay/result identity."
            ],
            "type": "u64"
          },
          {
            "name": "hasThemeBest",
            "type": "bool"
          },
          {
            "name": "themeBestEntry",
            "type": {
              "defined": {
                "name": "arenaBoardEntry"
              }
            }
          },
          {
            "name": "themeBestRunId",
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
      "name": "cadenceArchived",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "periodId",
            "type": "u32"
          },
          {
            "name": "resultHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "root",
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
      "name": "campaignLevelRewarded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "runId",
            "type": "u64"
          },
          {
            "name": "mapId",
            "type": "u8"
          },
          {
            "name": "level",
            "type": "u8"
          },
          {
            "name": "achievedStars",
            "type": "u8"
          },
          {
            "name": "newlyEarnedStars",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "campaignLevelSnapshot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "level",
            "type": "u8"
          },
          {
            "name": "pointsRequired",
            "type": "u32"
          },
          {
            "name": "maxMoves",
            "type": "u16"
          },
          {
            "name": "difficulty",
            "type": "u8"
          },
          {
            "name": "primary",
            "type": {
              "defined": {
                "name": "constraintSnapshot"
              }
            }
          },
          {
            "name": "secondary",
            "type": {
              "defined": {
                "name": "constraintSnapshot"
              }
            }
          },
          {
            "name": "blockWeights",
            "type": {
              "array": [
                "u16",
                5
              ]
            }
          }
        ]
      }
    },
    {
      "name": "campaignMapRuleSnapshot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "activeMutatorId",
            "type": "u8"
          },
          {
            "name": "passiveMutatorId",
            "type": "u8"
          },
          {
            "name": "bossId",
            "type": "u8"
          },
          {
            "name": "scoreMultiplierX100",
            "type": "u16"
          },
          {
            "name": "comboMultiplierX100",
            "type": "u16"
          },
          {
            "name": "lineClearBonus",
            "type": "u16"
          },
          {
            "name": "perfectClearBonus",
            "type": "u16"
          },
          {
            "name": "starThresholdModifier",
            "type": "u8"
          },
          {
            "name": "bonusType",
            "type": "u8"
          },
          {
            "name": "bonusTriggerType",
            "type": "u8"
          },
          {
            "name": "bonusThreshold",
            "type": "u16"
          },
          {
            "name": "startingCharges",
            "type": "u8"
          },
          {
            "name": "startingRows",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "competitionProfileSynced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
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
            "name": "rank",
            "type": "u16"
          },
          {
            "name": "rewardLamports",
            "type": "u64"
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
            "name": "podiums",
            "type": "u32"
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
      "name": "constraintSnapshot",
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
          },
          {
            "name": "requiredCount",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "contentReleaseActivated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "contentVersion",
            "type": "u32"
          },
          {
            "name": "dailyRulesVersion",
            "type": "u32"
          },
          {
            "name": "campaignMapCount",
            "type": "u8"
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
            "name": "purchasedPrizeLamports",
            "docs": [
              "Exact 9,000,000-lamport prize deposits made by Kredit purchases."
            ],
            "type": "u64"
          },
          {
            "name": "spentPrizeLamports",
            "docs": [
              "Exact prize deposits already routed by spent Kredits."
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
      "name": "dailyClaimsExpired",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dayId",
            "type": "u32"
          },
          {
            "name": "claimedLamports",
            "type": "u64"
          },
          {
            "name": "expiredLamports",
            "type": "u64"
          },
          {
            "name": "rolloverLamports",
            "type": "u64"
          },
          {
            "name": "followingDayId",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "dailyPoolEntry",
      "docs": [
        "One complete authored Daily in the published pool.",
        "",
        "Map identifiers bind the entry back to the Campaign catalogs. The copied",
        "active and passive fields make the selected Daily independently immutable;",
        "preparation verifies them against those catalogs so a guardian's mutator",
        "can never be re-paired with another realm."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u8"
          },
          {
            "name": "realmMapId",
            "docs": [
              "Zero is allowed for a standalone wildcard entry with no guardian realm."
            ],
            "type": "u8"
          },
          {
            "name": "passiveMapId",
            "type": "u8"
          },
          {
            "name": "activeMutatorId",
            "type": "u8"
          },
          {
            "name": "passiveMutatorId",
            "type": "u8"
          },
          {
            "name": "scoringRule",
            "type": {
              "defined": {
                "name": "dailyScoringRule"
              }
            }
          },
          {
            "name": "scoreMultiplierX100",
            "type": "u16"
          },
          {
            "name": "comboMultiplierX100",
            "type": "u16"
          },
          {
            "name": "lineClearBonus",
            "type": "u16"
          },
          {
            "name": "perfectClearBonus",
            "type": "u16"
          },
          {
            "name": "bonusType",
            "type": "u8"
          },
          {
            "name": "bonusTriggerType",
            "type": "u8"
          },
          {
            "name": "bonusThreshold",
            "type": "u16"
          },
          {
            "name": "startingCharges",
            "type": "u8"
          },
          {
            "name": "startingRows",
            "type": "u8"
          },
          {
            "name": "difficultyBand",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "dailyPressureProfile",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "thresholds",
            "type": {
              "array": [
                "u32",
                7
              ]
            }
          },
          {
            "name": "scoreMultipliersX100",
            "type": {
              "array": [
                "u16",
                8
              ]
            }
          },
          {
            "name": "blockWeights",
            "type": {
              "array": [
                {
                  "array": [
                    "u16",
                    5
                  ]
                },
                8
              ]
            }
          },
          {
            "name": "startingHeight",
            "type": "u8"
          },
          {
            "name": "maxMoves",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "dailyPrizeClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
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
            "name": "rank",
            "type": "u16"
          },
          {
            "name": "rewardLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "dailyRulesCatalog",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "rulesVersion",
            "type": "u32"
          },
          {
            "name": "protocol",
            "type": "pubkey"
          },
          {
            "name": "contentVersion",
            "type": "u32"
          },
          {
            "name": "catalogHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "poolRevision",
            "type": "u32"
          },
          {
            "name": "startsDay",
            "type": "u32"
          },
          {
            "name": "selectionSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "poolEntryCount",
            "type": "u8"
          },
          {
            "name": "poolEntries",
            "type": {
              "vec": {
                "defined": {
                  "name": "dailyPoolEntry"
                }
              }
            }
          },
          {
            "name": "difficultyBandCount",
            "type": "u8"
          },
          {
            "name": "difficultyBands",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "dailyPressureProfile"
                  }
                },
                4
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
      "name": "dailyScoringRule",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u8"
          },
          {
            "name": "family",
            "type": "u8"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "parameter",
            "type": "u8"
          },
          {
            "name": "bonusMultiplierX100",
            "docs": [
              "Raw objective points are scaled by this value before pressure."
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "featuredEmblemSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "emblemId",
            "type": "u8"
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
            "name": "contentVersion",
            "type": "u32"
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
      "name": "kreditsPurchased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "kreditCount",
            "type": "u32"
          },
          {
            "name": "prizeLamports",
            "type": "u64"
          },
          {
            "name": "operatorLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "levelRuleSnapshot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "level",
            "type": "u8"
          },
          {
            "name": "pointsRequired",
            "type": "u32"
          },
          {
            "name": "maxMoves",
            "type": "u16"
          },
          {
            "name": "difficulty",
            "type": "u8"
          },
          {
            "name": "primary",
            "type": {
              "defined": {
                "name": "constraintSnapshot"
              }
            }
          },
          {
            "name": "secondary",
            "type": {
              "defined": {
                "name": "constraintSnapshot"
              }
            }
          },
          {
            "name": "activeMutatorId",
            "type": "u8"
          },
          {
            "name": "passiveMutatorId",
            "type": "u8"
          },
          {
            "name": "bossId",
            "type": "u8"
          },
          {
            "name": "blockWeights",
            "type": {
              "array": [
                "u16",
                5
              ]
            }
          },
          {
            "name": "scoreMultiplierX100",
            "type": "u16"
          },
          {
            "name": "comboMultiplierX100",
            "type": "u16"
          },
          {
            "name": "lineClearBonus",
            "type": "u16"
          },
          {
            "name": "perfectClearBonus",
            "type": "u16"
          },
          {
            "name": "starThresholdModifier",
            "type": "u8"
          },
          {
            "name": "bonusType",
            "type": "u8"
          },
          {
            "name": "bonusTriggerType",
            "type": "u8"
          },
          {
            "name": "bonusThreshold",
            "type": "u16"
          },
          {
            "name": "startingCharges",
            "type": "u8"
          },
          {
            "name": "startingRows",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "mapCatalog",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "contentVersion",
            "type": "u32"
          },
          {
            "name": "mapId",
            "type": "u8"
          },
          {
            "name": "themeId",
            "type": "u8"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "mapRules",
            "docs": [
              "Rules that define one consistent identity across the whole map."
            ],
            "type": {
              "defined": {
                "name": "campaignMapRuleSnapshot"
              }
            }
          },
          {
            "name": "levels",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "campaignLevelSnapshot"
                  }
                },
                10
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
      "name": "operatorRevenueVault",
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
            "name": "grossOperatorShare",
            "type": "u64"
          },
          {
            "name": "withdrawn",
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
      "name": "periodStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "funding"
          },
          {
            "name": "open"
          },
          {
            "name": "finalized"
          }
        ]
      }
    },
    {
      "name": "playerLabel",
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
            "name": "displayName",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "nameLen",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "playerLabelArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "display",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "playerLabelSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "playerLabel",
            "type": "pubkey"
          },
          {
            "name": "display",
            "type": "string"
          },
          {
            "name": "created",
            "type": "bool"
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
            "name": "activeRunMode",
            "type": {
              "defined": {
                "name": "runMode"
              }
            }
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
            "name": "lifetimePaidEntries",
            "docs": [
              "Incremented exactly once when one prepaid Kredit starts a ranked run."
            ],
            "type": "u64"
          },
          {
            "name": "dailyRecord",
            "type": {
              "defined": {
                "name": "competitionRecord"
              }
            }
          },
          {
            "name": "campaignActiveRunId",
            "docs": [
              "Zero when the Campaign slot is idle."
            ],
            "type": "u64"
          },
          {
            "name": "kreditBalance",
            "docs": [
              "One-way prepaid entries owned by this wallet identity."
            ],
            "type": "u64"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for later versioned profile fields such as the ladder. Readers",
              "reject nonzero bytes until an explicitly versioned schema consumes them."
            ],
            "type": {
              "array": [
                "u8",
                56
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
          }
        ]
      }
    },
    {
      "name": "prizePoolFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "periodId",
            "type": "u32"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "protocolAuthorityAccepted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previousAuthority",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "protocolAuthorityProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "pendingAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "protocolConfig",
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
            "name": "pendingAuthority",
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
            "name": "contentVersion",
            "type": "u32"
          },
          {
            "name": "dailyRulesVersion",
            "type": "u32"
          },
          {
            "name": "playerFundingTargetLamports",
            "type": "u64"
          },
          {
            "name": "campaignMapCount",
            "docs": [
              "Number of contiguous, authority-activated Campaign maps."
            ],
            "type": "u8"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "protocolPauseChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "publishArenaRulesArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "contentVersion",
            "type": "u32"
          },
          {
            "name": "rulesVersion",
            "type": "u32"
          },
          {
            "name": "poolRevision",
            "type": "u32"
          },
          {
            "name": "startsDay",
            "type": "u32"
          },
          {
            "name": "poolEntryCount",
            "type": "u8"
          },
          {
            "name": "poolEntries",
            "type": {
              "vec": {
                "defined": {
                  "name": "dailyPoolEntry"
                }
              }
            }
          },
          {
            "name": "difficultyBandCount",
            "type": "u8"
          },
          {
            "name": "difficultyBands",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "dailyPressureProfile"
                  }
                },
                4
              ]
            }
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
            "name": "levelComplete"
          },
          {
            "name": "finished"
          }
        ]
      }
    },
    {
      "name": "runMetrics",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maxCombo",
            "type": "u32"
          },
          {
            "name": "comboScoringActions",
            "type": "u32"
          },
          {
            "name": "comboDerivedScore",
            "type": "u64"
          },
          {
            "name": "highestActionScore",
            "type": "u64"
          },
          {
            "name": "mostLinesSingleAction",
            "type": "u32"
          },
          {
            "name": "mostBlocksSingleAction",
            "type": "u32"
          },
          {
            "name": "totalLines",
            "type": "u64"
          },
          {
            "name": "totalBlocks",
            "type": "u64"
          },
          {
            "name": "perfectClears",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "runMode",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "campaign"
          },
          {
            "name": "daily"
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
    },
    {
      "name": "submittedBoardEntry",
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
      "name": "teamDestinationChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previousTeamDestination",
            "type": "pubkey"
          },
          {
            "name": "teamDestination",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "writeMapCatalogArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "contentVersion",
            "type": "u32"
          },
          {
            "name": "mapId",
            "type": "u8"
          },
          {
            "name": "themeId",
            "type": "u8"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "mapRules",
            "type": {
              "defined": {
                "name": "campaignMapRuleSnapshot"
              }
            }
          },
          {
            "name": "levels",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "campaignLevelSnapshot"
                  }
                },
                10
              ]
            }
          }
        ]
      }
    }
  ]
};
