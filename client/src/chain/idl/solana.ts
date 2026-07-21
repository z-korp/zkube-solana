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
      "name": "claimAchievement",
      "discriminator": [
        107,
        181,
        102,
        247,
        207,
        212,
        251,
        24
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
          "name": "achievementIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "claimQuest",
      "discriminator": [
        38,
        197,
        33,
        123,
        0,
        108,
        206,
        161
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
          "name": "questIndex",
          "type": "u8"
        }
      ]
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
      "name": "consumePracticeRun",
      "discriminator": [
        195,
        120,
        23,
        114,
        110,
        43,
        40,
        150
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
          "name": "arenaDaily"
        },
        {
          "name": "arenaPlayer",
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
      "name": "enterArenaV1",
      "discriminator": [
        235,
        201,
        188,
        225,
        15,
        95,
        4,
        92
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
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "weeklyJackpot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  101,
                  101,
                  107,
                  108,
                  121,
                  95,
                  106,
                  97,
                  99,
                  107,
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "arena_daily.week_id",
                "account": "arenaDaily"
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
                "kind": "arg",
                "path": "runId"
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
          "name": "arenaBoard",
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
              }
            ]
          }
        },
        {
          "name": "weeklyJackpot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  101,
                  101,
                  107,
                  108,
                  121,
                  95,
                  106,
                  97,
                  99,
                  107,
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "arena_daily.week_id",
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
      "name": "finalizeWeeklyJackpot",
      "discriminator": [
        52,
        20,
        111,
        67,
        132,
        26,
        239,
        132
      ],
      "accounts": [
        {
          "name": "weeklyJackpot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  101,
                  101,
                  107,
                  108,
                  121,
                  95,
                  106,
                  97,
                  99,
                  107,
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "weekly_jackpot.week_id",
                "account": "weeklyJackpot"
              }
            ]
          }
        },
        {
          "name": "weeklyBoard",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  101,
                  101,
                  107,
                  108,
                  121,
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
                "path": "weeklyJackpot"
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
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
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
          "name": "treasuryDestination"
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
      "name": "openArenaDaily",
      "discriminator": [
        126,
        235,
        216,
        49,
        255,
        202,
        213,
        196
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
      "name": "openWeeklyJackpot",
      "discriminator": [
        39,
        219,
        229,
        84,
        121,
        50,
        60,
        75
      ],
      "accounts": [
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
          "name": "weeklyJackpot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  101,
                  101,
                  107,
                  108,
                  121,
                  95,
                  106,
                  97,
                  99,
                  107,
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "weekId"
              }
            ]
          }
        },
        {
          "name": "weeklyBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  101,
                  101,
                  107,
                  108,
                  121,
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
                "path": "weeklyJackpot"
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
          "name": "weekId",
          "type": "u32"
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
      "name": "preparePracticeRunV1",
      "discriminator": [
        208,
        70,
        215,
        3,
        3,
        38,
        237,
        220
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
          "name": "buffer"
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram"
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
      "name": "refundStuckArenaEntry",
      "discriminator": [
        135,
        4,
        164,
        2,
        240,
        197,
        184,
        41
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
                "path": "owner"
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
          "writable": true
        },
        {
          "name": "activeRun"
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
      "name": "rollupArenaToWeekly",
      "discriminator": [
        54,
        250,
        200,
        246,
        132,
        112,
        116,
        115
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
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "weeklyJackpot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  101,
                  101,
                  107,
                  108,
                  121,
                  95,
                  106,
                  97,
                  99,
                  107,
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "arena_daily.week_id",
                "account": "arenaDaily"
              }
            ]
          }
        },
        {
          "name": "weeklyPlayer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  101,
                  101,
                  107,
                  108,
                  121,
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
                "path": "weeklyJackpot"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "weeklyBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  101,
                  101,
                  107,
                  108,
                  121,
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
                "path": "weeklyJackpot"
              }
            ]
          }
        },
        {
          "name": "owner"
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
      "args": []
    },
    {
      "name": "scheduleArcadeTerms",
      "discriminator": [
        70,
        199,
        10,
        4,
        247,
        48,
        46,
        223
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
          "name": "pricingOperator",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "scheduleArcadeTermsArgs"
            }
          }
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
      "name": "setPricingOperator",
      "discriminator": [
        18,
        46,
        110,
        140,
        137,
        198,
        215,
        186
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
          "name": "pricingOperator",
          "type": "pubkey"
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
      "name": "updateRevenueDestinations",
      "discriminator": [
        18,
        11,
        92,
        195,
        90,
        37,
        172,
        36
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
          "name": "treasuryDestination"
        },
        {
          "name": "rewardVault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
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
    },
    {
      "name": "rewardVault",
      "discriminator": [
        201,
        22,
        221,
        167,
        208,
        16,
        210,
        33
      ]
    },
    {
      "name": "weeklyBoard",
      "discriminator": [
        10,
        113,
        115,
        26,
        243,
        61,
        74,
        163
      ]
    },
    {
      "name": "weeklyJackpot",
      "discriminator": [
        156,
        232,
        229,
        144,
        56,
        25,
        231,
        217
      ]
    },
    {
      "name": "weeklyPlayer",
      "discriminator": [
        100,
        131,
        37,
        75,
        219,
        152,
        210,
        240
      ]
    }
  ],
  "events": [
    {
      "name": "achievementClaimed",
      "discriminator": [
        14,
        49,
        71,
        199,
        214,
        248,
        116,
        232
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
      "name": "dailyQuestXpClaimed",
      "discriminator": [
        115,
        183,
        136,
        7,
        170,
        204,
        92,
        25
      ]
    },
    {
      "name": "mapPerfected",
      "discriminator": [
        49,
        192,
        204,
        18,
        33,
        218,
        88,
        122
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
      "name": "pricingOperatorChanged",
      "discriminator": [
        67,
        56,
        124,
        168,
        106,
        70,
        21,
        191
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
      "name": "revenueDestinationsChanged",
      "discriminator": [
        116,
        165,
        4,
        121,
        143,
        242,
        48,
        173
      ]
    },
    {
      "name": "weeklyQuestXpClaimed",
      "discriminator": [
        116,
        94,
        123,
        6,
        201,
        161,
        211,
        104
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
      "name": "insufficientCubes",
      "msg": "Insufficient Cubes"
    },
    {
      "code": 6015,
      "name": "invalidMap",
      "msg": "Invalid map"
    },
    {
      "code": 6016,
      "name": "invalidLevel",
      "msg": "Invalid level"
    },
    {
      "code": 6017,
      "name": "invalidStars",
      "msg": "Invalid star rating"
    },
    {
      "code": 6018,
      "name": "protocolPaused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6019,
      "name": "invalidVersion",
      "msg": "Unsupported account version"
    },
    {
      "code": 6020,
      "name": "invalidRunId",
      "msg": "Invalid run id"
    },
    {
      "code": 6021,
      "name": "activeRunExists",
      "msg": "Finish or abandon the active run before starting another"
    },
    {
      "code": 6022,
      "name": "mapLocked",
      "msg": "Map is locked"
    },
    {
      "code": 6023,
      "name": "mapDisabled",
      "msg": "Map is disabled"
    },
    {
      "code": 6024,
      "name": "mapAlreadyUnlocked",
      "msg": "Map is already unlocked"
    },
    {
      "code": 6025,
      "name": "contentVersionMismatch",
      "msg": "Content version mismatch"
    },
    {
      "code": 6026,
      "name": "invalidBlockWeights",
      "msg": "Invalid block weights"
    },
    {
      "code": 6027,
      "name": "vrfRequestPending",
      "msg": "A VRF request is already pending"
    },
    {
      "code": 6028,
      "name": "noVrfRequestPending",
      "msg": "No VRF request is pending"
    },
    {
      "code": 6029,
      "name": "vrfRequestMismatch",
      "msg": "The VRF callback does not match the pending request"
    },
    {
      "code": 6030,
      "name": "noPrize",
      "msg": "The player has no Daily prize"
    },
    {
      "code": 6031,
      "name": "prizeAlreadyClaimed",
      "msg": "The Daily prize has already been claimed"
    },
    {
      "code": 6032,
      "name": "prizeClaimWindowOpen",
      "msg": "The Daily prize claim window is still open"
    },
    {
      "code": 6033,
      "name": "refundAlreadyClaimed",
      "msg": "The refund has already been claimed"
    },
    {
      "code": 6034,
      "name": "invalidProgressRule",
      "msg": "The progression rule is invalid"
    },
    {
      "code": 6035,
      "name": "rewardAlreadyClaimed",
      "msg": "This progress reward has already been claimed"
    },
    {
      "code": 6036,
      "name": "rewardNotEarned",
      "msg": "The progress requirement has not been met"
    },
    {
      "code": 6037,
      "name": "questNotActive",
      "msg": "This quest is not active in the current cadence"
    },
    {
      "code": 6038,
      "name": "accountingInvariant",
      "msg": "The financial accounting invariant does not balance"
    },
    {
      "code": 6039,
      "name": "invalidPack",
      "msg": "The selected Cube pack does not exist"
    },
    {
      "code": 6040,
      "name": "priceChanged",
      "msg": "The Cube pack price changed; refresh the exact quote"
    },
    {
      "code": 6041,
      "name": "invalidSession",
      "msg": "The scoped player session is invalid"
    },
    {
      "code": 6042,
      "name": "sessionExpired",
      "msg": "The scoped player session has expired"
    },
    {
      "code": 6043,
      "name": "invalidPlayerLabel",
      "msg": "The player label is invalid"
    }
  ],
  "types": [
    {
      "name": "achievementClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "achievementIndex",
            "type": "u8"
          },
          {
            "name": "xpReward",
            "type": "u32"
          }
        ]
      }
    },
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
            "name": "dailyPotBps",
            "type": "u16"
          },
          {
            "name": "operatorBps",
            "type": "u16"
          },
          {
            "name": "weeklyJackpotBps",
            "type": "u16"
          },
          {
            "name": "pendingEntryLamports",
            "type": "u64"
          },
          {
            "name": "entryActivatesDay",
            "type": "u32"
          },
          {
            "name": "pendingDailyPotBps",
            "type": "u16"
          },
          {
            "name": "pendingOperatorBps",
            "type": "u16"
          },
          {
            "name": "pendingWeeklyJackpotBps",
            "type": "u16"
          },
          {
            "name": "splitActivatesWeek",
            "type": "u32"
          },
          {
            "name": "operatorWithdrawReserveLamports",
            "type": "u64"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for the deferred credit instruction version and bounty schema."
            ],
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
      "name": "arenaBoard",
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
            "name": "entries",
            "type": {
              "vec": {
                "defined": {
                  "name": "arenaBoardEntry"
                }
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
      "name": "arenaBoardEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "runId",
            "type": "u64"
          },
          {
            "name": "score",
            "type": "u32"
          },
          {
            "name": "bonusTriggers",
            "type": "u16"
          },
          {
            "name": "engineScore",
            "type": "u32"
          },
          {
            "name": "moves",
            "type": "u16"
          },
          {
            "name": "attempts",
            "type": "u32"
          },
          {
            "name": "submittedAt",
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
            "name": "weekId",
            "type": "u32"
          },
          {
            "name": "arcadeConfig",
            "type": "pubkey"
          },
          {
            "name": "rentRecipient",
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
                "name": "dailyStatus"
              }
            }
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
            "name": "terms",
            "type": {
              "defined": {
                "name": "arenaTerms"
              }
            }
          },
          {
            "name": "potLamports",
            "type": "u64"
          },
          {
            "name": "entriesPaid",
            "type": "u64"
          },
          {
            "name": "runsFinalized",
            "type": "u64"
          },
          {
            "name": "entriesRefunded",
            "type": "u64"
          },
          {
            "name": "uniquePlayers",
            "type": "u32"
          },
          {
            "name": "weeklyEligiblePlayers",
            "type": "u32"
          },
          {
            "name": "weeklyRollups",
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
            "name": "paidEntries",
            "type": "u32"
          },
          {
            "name": "finalizedEntries",
            "type": "u32"
          },
          {
            "name": "refundedEntries",
            "type": "u32"
          },
          {
            "name": "activePaidRunId",
            "type": "u64"
          },
          {
            "name": "bestRunId",
            "type": "u64"
          },
          {
            "name": "bestScore",
            "type": "u32"
          },
          {
            "name": "bestBonusTriggers",
            "type": "u16"
          },
          {
            "name": "bestEngineScore",
            "type": "u32"
          },
          {
            "name": "bestMoves",
            "type": "u16"
          },
          {
            "name": "bestSubmittedAt",
            "type": "i64"
          },
          {
            "name": "bestReplayHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "weeklyRolledUp",
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
      "name": "arenaTerms",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entryLamports",
            "type": "u64"
          },
          {
            "name": "dailyPotBps",
            "type": "u16"
          },
          {
            "name": "operatorBps",
            "type": "u16"
          },
          {
            "name": "weeklyJackpotBps",
            "type": "u16"
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
          },
          {
            "name": "xp",
            "type": "u32"
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
      "name": "dailyQuestXpClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "questIndex",
            "type": "u8"
          },
          {
            "name": "cadenceId",
            "type": "u32"
          },
          {
            "name": "xpReward",
            "type": "u32"
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
            "name": "weeklyId",
            "type": "u32"
          },
          {
            "name": "startsDay",
            "type": "u32"
          },
          {
            "name": "weeklySeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "scoringRuleCount",
            "type": "u8"
          },
          {
            "name": "scoringRules",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "dailyScoringRule"
                  }
                },
                16
              ]
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
      "name": "dailyStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "draft"
          },
          {
            "name": "open"
          },
          {
            "name": "entriesClosed"
          },
          {
            "name": "finalizing"
          },
          {
            "name": "claimable"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "closed"
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
            "name": "pricingOperator",
            "type": "pubkey"
          },
          {
            "name": "teamDestination",
            "type": "pubkey"
          },
          {
            "name": "treasuryDestination",
            "type": "pubkey"
          },
          {
            "name": "contentVersion",
            "type": "u32"
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
      "name": "mapPerfected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "mapId",
            "type": "u8"
          },
          {
            "name": "cubes",
            "type": "u64"
          },
          {
            "name": "xp",
            "type": "u32"
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
            "name": "stuckRunRefunds",
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
              "Zero when idle; otherwise the only run that may exist for this owner.",
              "This durable pointer makes resume deterministic across devices and",
              "prevents two valid device sessions from opening concurrent runs."
            ],
            "type": "u64"
          },
          {
            "name": "dailyEligible",
            "type": "bool"
          },
          {
            "name": "achievementFlags",
            "docs": [
              "Bit per canonical achievement; the catalog is bounded to 24 entries."
            ],
            "type": "u32"
          },
          {
            "name": "lifetimeXp",
            "docs": [
              "All progression XP, regardless of whether it came from achievements,",
              "quests, Daily play, or finite Campaign rewards."
            ],
            "type": "u64"
          },
          {
            "name": "questCadenceDay",
            "type": "u32"
          },
          {
            "name": "questCadenceWeek",
            "type": "u32"
          },
          {
            "name": "questCounters",
            "type": {
              "array": [
                "u32",
                16
              ]
            }
          },
          {
            "name": "lifetimeRunsStarted",
            "type": "u64"
          },
          {
            "name": "lifetimeLinesCleared",
            "type": "u64"
          },
          {
            "name": "lifetimeBossesCleared",
            "type": "u64"
          },
          {
            "name": "lifetimePerfectLevels",
            "type": "u64"
          },
          {
            "name": "lifetimeDailyChallenges",
            "type": "u64"
          },
          {
            "name": "lifetimeBonusUses",
            "type": "u64"
          },
          {
            "name": "lifetimeMaxCombo",
            "type": "u8"
          },
          {
            "name": "lastDailyChallengeDay",
            "type": "u32"
          },
          {
            "name": "unlockedMaps",
            "docs": [
              "Bit `map_id - 1`; Map 1 is unlocked on initialization."
            ],
            "type": "u32"
          },
          {
            "name": "clearedMaps",
            "type": "u32"
          },
          {
            "name": "perfectedMaps",
            "type": "u32"
          },
          {
            "name": "levelStars",
            "docs": [
              "Two bits per Campaign level across all maps."
            ],
            "type": {
              "array": [
                "u8",
                80
              ]
            }
          },
          {
            "name": "dailyClaimCadenceId",
            "type": "u32"
          },
          {
            "name": "weeklyClaimCadenceId",
            "type": "u32"
          },
          {
            "name": "dailyClaimed",
            "type": "u16"
          },
          {
            "name": "weeklyClaimed",
            "type": "u16"
          },
          {
            "name": "bestDailyFinish",
            "type": "u16"
          },
          {
            "name": "bestWeeklyFinish",
            "type": "u16"
          },
          {
            "name": "crestStreak",
            "type": "u16"
          },
          {
            "name": "lastCrestWeek",
            "type": "u32"
          },
          {
            "name": "weeklyAttendanceMask",
            "docs": [
              "One bit per weekday with a free Practice or paid Arena completion."
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for the deferred five-run credit schema. It has no v1 meaning."
            ],
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
      "name": "pricingOperatorChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previousOperator",
            "type": "pubkey"
          },
          {
            "name": "pricingOperator",
            "type": "pubkey"
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
            "name": "pricingOperator",
            "type": "pubkey"
          },
          {
            "name": "teamDestination",
            "type": "pubkey"
          },
          {
            "name": "treasuryDestination",
            "type": "pubkey"
          },
          {
            "name": "rewardVault",
            "type": "pubkey"
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
            "name": "rotationId",
            "type": "u32"
          },
          {
            "name": "startsDay",
            "type": "u32"
          },
          {
            "name": "rotationSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "scoringRuleCount",
            "type": "u8"
          },
          {
            "name": "scoringRules",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "dailyScoringRule"
                  }
                },
                16
              ]
            }
          },
          {
            "name": "pressure",
            "type": {
              "defined": {
                "name": "dailyPressureProfile"
              }
            }
          }
        ]
      }
    },
    {
      "name": "revenueDestinationsChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previousTeamDestination",
            "type": "pubkey"
          },
          {
            "name": "previousTreasuryDestination",
            "type": "pubkey"
          },
          {
            "name": "teamDestination",
            "type": "pubkey"
          },
          {
            "name": "treasuryDestination",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "rewardVault",
      "docs": [
        "Program-owned native-SOL reserve used only for pre-funded Weekly prizes."
      ],
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
            "name": "bump",
            "type": "u8"
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
      "name": "runMode",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "campaign"
          },
          {
            "name": "daily"
          },
          {
            "name": "practice"
          }
        ]
      }
    },
    {
      "name": "scheduleArcadeTermsArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entryLamports",
            "type": "u64"
          },
          {
            "name": "entryActivatesDay",
            "type": "u32"
          },
          {
            "name": "dailyPotBps",
            "type": "u16"
          },
          {
            "name": "operatorBps",
            "type": "u16"
          },
          {
            "name": "weeklyJackpotBps",
            "type": "u16"
          },
          {
            "name": "splitActivatesWeek",
            "type": "u32"
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
      "name": "weeklyBoard",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "jackpot",
            "type": "pubkey"
          },
          {
            "name": "entries",
            "type": {
              "vec": {
                "defined": {
                  "name": "weeklyBoardEntry"
                }
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
      "name": "weeklyBoardEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "score",
            "type": "u16"
          },
          {
            "name": "totalBonusTriggers",
            "type": "u32"
          },
          {
            "name": "earliestFinalSubmission",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "weeklyJackpot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "weekId",
            "type": "u32"
          },
          {
            "name": "arcadeConfig",
            "type": "pubkey"
          },
          {
            "name": "rentRecipient",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "weeklyStatus"
              }
            }
          },
          {
            "name": "opensAt",
            "type": "i64"
          },
          {
            "name": "closesAt",
            "type": "i64"
          },
          {
            "name": "finalizedAt",
            "type": "i64"
          },
          {
            "name": "potLamports",
            "type": "u64"
          },
          {
            "name": "participants",
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
      "name": "weeklyPlayer",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "jackpot",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "results",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "weeklyResult"
                  }
                },
                7
              ]
            }
          },
          {
            "name": "resultCount",
            "type": "u8"
          },
          {
            "name": "score",
            "type": "u16"
          },
          {
            "name": "totalBonusTriggers",
            "type": "u32"
          },
          {
            "name": "earliestFinalSubmission",
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
      "name": "weeklyQuestXpClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "questIndex",
            "type": "u8"
          },
          {
            "name": "cadenceId",
            "type": "u32"
          },
          {
            "name": "xpReward",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "weeklyResult",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dayId",
            "type": "u32"
          },
          {
            "name": "points",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "weeklyStatus",
      "type": {
        "kind": "enum",
        "variants": [
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
