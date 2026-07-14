/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/solana.json`.
 */
export type Solana = {
  "address": "5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA",
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
          "signer": true
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
        }
      ]
    },
    {
      "name": "cancelDailyChallenge",
      "discriminator": [
        89,
        102,
        168,
        19,
        70,
        100,
        19,
        198
      ],
      "accounts": [
        {
          "name": "protocol"
        },
        {
          "name": "dailyChallenge",
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
                  121
                ]
              },
              {
                "kind": "account",
                "path": "daily_challenge.day_id",
                "account": "dailyChallenge"
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
      "name": "cancelSale",
      "discriminator": [
        82,
        137,
        56,
        136,
        94,
        9,
        205,
        10
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
          "name": "economyConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
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
      "args": []
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
          "name": "playerProfile",
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
          "name": "campaignProgress",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
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
          "signer": true,
          "relations": [
            "playerProfile",
            "campaignProgress"
          ]
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
      "name": "claimLevelMilestone",
      "discriminator": [
        212,
        186,
        244,
        141,
        11,
        8,
        204,
        154
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
          "name": "economyConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "playerProfile",
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
          "name": "levelMilestones",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  118,
                  101,
                  108,
                  95,
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101,
                  115
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
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "playerProfile"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "milestoneIndex",
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
          "name": "playerProfile",
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
          "name": "questClaims",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  101,
                  115,
                  116,
                  95,
                  99,
                  108,
                  97,
                  105,
                  109,
                  115
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
          "name": "weeklyStipend",
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
                  115,
                  116,
                  105,
                  112,
                  101,
                  110,
                  100
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
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "playerProfile"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
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
      "name": "claimWeeklyCash",
      "discriminator": [
        60,
        227,
        120,
        57,
        125,
        67,
        55,
        176
      ],
      "accounts": [
        {
          "name": "weeklyChallenge",
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
                  121
                ]
              },
              {
                "kind": "account",
                "path": "weekly_challenge.week_id",
                "account": "weeklyChallenge"
              }
            ]
          }
        },
        {
          "name": "leaderboard",
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
                "path": "weeklyChallenge"
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
                "path": "weeklyChallenge"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "paymentMint"
        },
        {
          "name": "paymentVault",
          "writable": true
        },
        {
          "name": "playerPaymentAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "paymentMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claimWeeklyStars",
      "discriminator": [
        136,
        218,
        136,
        233,
        28,
        37,
        249,
        118
      ],
      "accounts": [
        {
          "name": "weeklyChallenge",
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
                  121
                ]
              },
              {
                "kind": "account",
                "path": "weekly_challenge.week_id",
                "account": "weeklyChallenge"
              }
            ]
          }
        },
        {
          "name": "leaderboard",
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
                "path": "weeklyChallenge"
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
                "path": "weeklyChallenge"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "playerProfile",
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
          "signer": true,
          "relations": [
            "playerProfile"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "closeSettledActiveRun",
      "discriminator": [
        156,
        85,
        34,
        175,
        240,
        226,
        191,
        171
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "The player still consents to cleanup: closing erases the on-chain",
            "receipt, so a third party must not be able to grief-close a run."
          ],
          "signer": true,
          "relations": [
            "runShell",
            "runReceipt",
            "activeRun"
          ]
        },
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
          "name": "rentRecipient",
          "docs": [
            "identity that fronted every run rent at prepare gets it back."
          ],
          "writable": true
        },
        {
          "name": "runShell",
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
          "name": "runReceipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
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
      "name": "commitDailyRun",
      "discriminator": [
        33,
        225,
        208,
        26,
        49,
        106,
        74,
        199
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
          "name": "runShell"
        },
        {
          "name": "runReceipt",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
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
          "name": "playerProfile",
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
          "name": "dailyChallenge"
        },
        {
          "name": "dailyPlayer",
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
                "path": "dailyChallenge"
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
          "name": "leaderboard",
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
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "dailyChallenge"
              }
            ]
          }
        },
        {
          "name": "weeklyStipend",
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
                  115,
                  116,
                  105,
                  112,
                  101,
                  110,
                  100
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
          "name": "owner"
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
          "name": "runShell"
        },
        {
          "name": "runReceipt",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
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
          "name": "playerProfile",
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
          "name": "campaignProgress",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
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
          "name": "owner"
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
      "name": "consumeDailyReceipt",
      "discriminator": [
        50,
        99,
        137,
        88,
        226,
        117,
        6,
        58
      ],
      "accounts": [
        {
          "name": "activeRun",
          "writable": true
        },
        {
          "name": "runShell",
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
          "name": "runReceipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
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
          "name": "playerProfile",
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
          "name": "dailyChallenge",
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
                  121
                ]
              },
              {
                "kind": "account",
                "path": "daily_challenge.day_id",
                "account": "dailyChallenge"
              }
            ]
          }
        },
        {
          "name": "dailyPlayer",
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
                "path": "dailyChallenge"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "leaderboard",
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
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "dailyChallenge"
              }
            ]
          }
        },
        {
          "name": "weeklyStipend",
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
                  115,
                  116,
                  105,
                  112,
                  101,
                  110,
                  100
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
            "runShell",
            "runReceipt",
            "playerProfile"
          ]
        },
        {
          "name": "escrowAuth"
        },
        {
          "name": "escrow"
        }
      ],
      "args": []
    },
    {
      "name": "consumeRunReceipt",
      "discriminator": [
        219,
        125,
        28,
        198,
        150,
        131,
        196,
        252
      ],
      "accounts": [
        {
          "name": "activeRun",
          "writable": true
        },
        {
          "name": "runShell",
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
          "name": "runReceipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
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
          "name": "playerProfile",
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
          "name": "campaignProgress",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
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
            "runShell",
            "runReceipt",
            "playerProfile",
            "campaignProgress"
          ]
        },
        {
          "name": "escrowAuth"
        },
        {
          "name": "escrow"
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
          "name": "owner",
          "signer": true,
          "relations": [
            "runShell"
          ]
        },
        {
          "name": "runShell",
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
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "run_shell.run_id",
                "account": "runShell"
              }
            ]
          }
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
                64,
                251,
                111,
                12,
                166,
                107,
                14,
                237,
                123,
                134,
                40,
                121,
                177,
                73,
                152,
                143,
                130,
                82,
                225,
                233,
                116,
                14,
                169,
                93,
                234,
                219,
                219,
                218,
                250,
                137,
                225,
                129
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
          "address": "5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA"
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
      "name": "enterDaily",
      "discriminator": [
        4,
        177,
        119,
        10,
        43,
        9,
        107,
        53
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
          "name": "economyConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "playerProfile",
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
          "name": "dailyChallenge",
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
                  121
                ]
              },
              {
                "kind": "account",
                "path": "daily_challenge.day_id",
                "account": "dailyChallenge"
              }
            ]
          }
        },
        {
          "name": "dailyPlayer",
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
                "path": "dailyChallenge"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "weeklyStipend",
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
                  115,
                  116,
                  105,
                  112,
                  101,
                  110,
                  100
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
          "name": "runShell",
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
          "name": "runReceipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
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
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "playerProfile"
          ]
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
          "name": "actionAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "finalizeDailyChallenge",
      "discriminator": [
        213,
        202,
        238,
        85,
        233,
        17,
        152,
        216
      ],
      "accounts": [
        {
          "name": "dailyChallenge",
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
                  121
                ]
              },
              {
                "kind": "account",
                "path": "daily_challenge.day_id",
                "account": "dailyChallenge"
              }
            ]
          }
        },
        {
          "name": "leaderboard",
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
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "dailyChallenge"
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
      "name": "finalizeWeeklyChallenge",
      "discriminator": [
        123,
        8,
        78,
        174,
        14,
        229,
        14,
        58
      ],
      "accounts": [
        {
          "name": "weeklyChallenge",
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
                  121
                ]
              },
              {
                "kind": "account",
                "path": "weekly_challenge.week_id",
                "account": "weeklyChallenge"
              }
            ]
          }
        },
        {
          "name": "leaderboard",
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
                "path": "weeklyChallenge"
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
      "name": "forfeitWeeklyCash",
      "discriminator": [
        157,
        42,
        209,
        253,
        222,
        210,
        175,
        77
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
          "name": "weeklyChallenge",
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
                  121
                ]
              },
              {
                "kind": "account",
                "path": "weekly_challenge.week_id",
                "account": "weeklyChallenge"
              }
            ]
          }
        },
        {
          "name": "paymentMint"
        },
        {
          "name": "paymentVault",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
        }
      ]
    },
    {
      "name": "initializeEconomy",
      "discriminator": [
        180,
        172,
        91,
        234,
        105,
        180,
        23,
        236
      ],
      "accounts": [
        {
          "name": "protocol"
        },
        {
          "name": "economyConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "starSalesLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  114,
                  95,
                  115,
                  97,
                  108,
                  101,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "paymentMint"
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
              "name": "initializeEconomyArgs"
            }
          }
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
          "name": "playerProfile",
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
          "name": "campaignProgress",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
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
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
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
          "name": "paymentMint"
        },
        {
          "name": "teamDestination"
        },
        {
          "name": "treasuryDestination"
        },
        {
          "name": "rewardVault"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
      "name": "openDailyChallenge",
      "discriminator": [
        109,
        163,
        247,
        10,
        101,
        164,
        13,
        157
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
          "name": "economyConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
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
                "kind": "account",
                "path": "economy_config.daily_rules_version",
                "account": "economyConfig"
              }
            ]
          }
        },
        {
          "name": "dailyChallenge",
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
          "name": "leaderboard",
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
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "dailyChallenge"
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
      "name": "openWeeklyChallenge",
      "discriminator": [
        95,
        148,
        167,
        122,
        7,
        205,
        68,
        192
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
          "name": "economyConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "weeklyChallenge",
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
                  121
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
          "name": "leaderboard",
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
                "path": "weeklyChallenge"
              }
            ]
          }
        },
        {
          "name": "paymentMint"
        },
        {
          "name": "rewardVault",
          "writable": true
        },
        {
          "name": "paymentVault",
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
                  118,
                  97,
                  117,
                  108,
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
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
          "signer": true
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
          "name": "playerProfile",
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
          "name": "campaignProgress",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
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
          "name": "mapCatalog"
        },
        {
          "name": "runShell",
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
          "name": "runReceipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
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
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "playerProfile",
            "campaignProgress"
          ]
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
        },
        {
          "name": "actionAuthority",
          "type": "pubkey"
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
      "name": "publishDailyRules",
      "discriminator": [
        213,
        34,
        144,
        182,
        3,
        11,
        141,
        251
      ],
      "accounts": [
        {
          "name": "protocol"
        },
        {
          "name": "economyConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
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
              "name": "publishDailyRulesArgs"
            }
          }
        }
      ]
    },
    {
      "name": "purchaseStars",
      "discriminator": [
        161,
        75,
        221,
        133,
        179,
        252,
        180,
        141
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
          "name": "economyConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "starSalesLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  114,
                  95,
                  115,
                  97,
                  108,
                  101,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "playerProfile",
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
          "name": "paymentMint"
        },
        {
          "name": "playerPaymentAccount",
          "writable": true
        },
        {
          "name": "teamDestination",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true
        },
        {
          "name": "treasuryDestination",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "playerProfile"
          ]
        }
      ],
      "args": [
        {
          "name": "packIndex",
          "type": "u8"
        },
        {
          "name": "expectedStars",
          "type": "u64"
        },
        {
          "name": "maxUsdcAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "refundDailyStars",
      "discriminator": [
        40,
        40,
        190,
        173,
        41,
        249,
        98,
        211
      ],
      "accounts": [
        {
          "name": "dailyChallenge",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  105,
                  108,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "daily_challenge.day_id",
                "account": "dailyChallenge"
              }
            ]
          }
        },
        {
          "name": "dailyPlayer",
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
                "path": "dailyChallenge"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "playerProfile",
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
          "signer": true,
          "relations": [
            "playerProfile"
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
      "name": "rollupDailyToWeekly",
      "discriminator": [
        129,
        76,
        32,
        146,
        86,
        220,
        255,
        198
      ],
      "accounts": [
        {
          "name": "dailyChallenge",
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
                  121
                ]
              },
              {
                "kind": "account",
                "path": "daily_challenge.day_id",
                "account": "dailyChallenge"
              }
            ]
          }
        },
        {
          "name": "dailyLeaderboard",
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
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "dailyChallenge"
              }
            ]
          }
        },
        {
          "name": "dailyPlayer",
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
                "path": "dailyChallenge"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "weeklyChallenge",
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
                  121
                ]
              },
              {
                "kind": "account",
                "path": "weekly_challenge.week_id",
                "account": "weeklyChallenge"
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
                "path": "weeklyChallenge"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "weeklyLeaderboard",
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
                "path": "weeklyChallenge"
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
      "name": "rotateActiveRunAuthority",
      "discriminator": [
        219,
        166,
        35,
        208,
        238,
        104,
        124,
        16
      ],
      "accounts": [
        {
          "name": "activeRun",
          "writable": true
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "activeRun"
          ]
        }
      ],
      "args": [
        {
          "name": "newActionAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "rotateRunShellAuthority",
      "discriminator": [
        101,
        234,
        115,
        157,
        0,
        246,
        19,
        255
      ],
      "accounts": [
        {
          "name": "runShell",
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
          "signer": true,
          "relations": [
            "runShell"
          ]
        }
      ],
      "args": [
        {
          "name": "runId",
          "type": "u64"
        },
        {
          "name": "newActionAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "scheduleSale",
      "discriminator": [
        131,
        70,
        93,
        183,
        0,
        168,
        86,
        123
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
          "name": "economyConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
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
              "name": "scheduleSaleArgs"
            }
          }
        }
      ]
    },
    {
      "name": "sealRun",
      "discriminator": [
        213,
        187,
        245,
        33,
        201,
        15,
        74,
        234
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
      "name": "unlockZone",
      "discriminator": [
        53,
        23,
        251,
        131,
        76,
        21,
        202,
        35
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
          "name": "economyConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "playerProfile",
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
          "name": "campaignProgress",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
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
          "name": "mapCatalog"
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "playerProfile",
            "campaignProgress"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "updateRegularPrices",
      "discriminator": [
        57,
        202,
        139,
        5,
        248,
        227,
        218,
        215
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
          "name": "economyConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
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
              "name": "updateRegularPricesArgs"
            }
          }
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
          "name": "paymentMint"
        },
        {
          "name": "teamDestination"
        },
        {
          "name": "treasuryDestination"
        },
        {
          "name": "rewardVault"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
      "name": "campaignProgress",
      "discriminator": [
        113,
        253,
        6,
        60,
        161,
        124,
        158,
        147
      ]
    },
    {
      "name": "dailyChallenge",
      "discriminator": [
        217,
        74,
        215,
        176,
        49,
        63,
        217,
        226
      ]
    },
    {
      "name": "dailyLeaderboard",
      "discriminator": [
        120,
        44,
        245,
        55,
        117,
        240,
        244,
        9
      ]
    },
    {
      "name": "dailyPlayer",
      "discriminator": [
        2,
        123,
        72,
        37,
        246,
        127,
        78,
        33
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
      "name": "economyConfig",
      "discriminator": [
        217,
        204,
        127,
        47,
        151,
        223,
        164,
        182
      ]
    },
    {
      "name": "levelMilestones",
      "discriminator": [
        82,
        166,
        107,
        159,
        231,
        26,
        138,
        56
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
      "name": "playerProfile",
      "discriminator": [
        82,
        226,
        99,
        87,
        164,
        130,
        181,
        80
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
      "name": "questClaims",
      "discriminator": [
        142,
        16,
        157,
        235,
        54,
        117,
        4,
        212
      ]
    },
    {
      "name": "runReceipt",
      "discriminator": [
        48,
        216,
        255,
        36,
        103,
        169,
        66,
        46
      ]
    },
    {
      "name": "runShell",
      "discriminator": [
        31,
        110,
        221,
        66,
        84,
        140,
        196,
        213
      ]
    },
    {
      "name": "starSalesLedger",
      "discriminator": [
        218,
        13,
        154,
        83,
        51,
        23,
        184,
        221
      ]
    },
    {
      "name": "weeklyChallenge",
      "discriminator": [
        137,
        122,
        18,
        161,
        253,
        148,
        134,
        25
      ]
    },
    {
      "name": "weeklyLeaderboard",
      "discriminator": [
        112,
        136,
        1,
        92,
        43,
        158,
        221,
        13
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
    },
    {
      "name": "weeklyStipend",
      "discriminator": [
        130,
        244,
        57,
        210,
        130,
        131,
        44,
        180
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
      "name": "dailyEntered",
      "discriminator": [
        168,
        81,
        159,
        214,
        63,
        165,
        201,
        143
      ]
    },
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
      "name": "dailyOpened",
      "discriminator": [
        233,
        66,
        33,
        204,
        131,
        32,
        132,
        253
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
      "name": "dailyRolledUp",
      "discriminator": [
        170,
        124,
        86,
        37,
        245,
        111,
        29,
        34
      ]
    },
    {
      "name": "dailyRulesPublished",
      "discriminator": [
        209,
        106,
        192,
        137,
        241,
        183,
        26,
        224
      ]
    },
    {
      "name": "economyConfigured",
      "discriminator": [
        137,
        227,
        154,
        105,
        230,
        253,
        97,
        14
      ]
    },
    {
      "name": "economyPricesUpdated",
      "discriminator": [
        249,
        201,
        138,
        186,
        235,
        103,
        13,
        212
      ]
    },
    {
      "name": "economySaleCancelled",
      "discriminator": [
        226,
        91,
        38,
        31,
        40,
        98,
        51,
        113
      ]
    },
    {
      "name": "economySaleScheduled",
      "discriminator": [
        127,
        86,
        88,
        244,
        238,
        76,
        12,
        122
      ]
    },
    {
      "name": "levelMilestoneClaimed",
      "discriminator": [
        238,
        107,
        62,
        138,
        99,
        71,
        232,
        83
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
      "name": "starsPurchased",
      "discriminator": [
        141,
        12,
        59,
        215,
        32,
        245,
        78,
        252
      ]
    },
    {
      "name": "weeklyCashClaimed",
      "discriminator": [
        181,
        23,
        18,
        165,
        171,
        25,
        184,
        37
      ]
    },
    {
      "name": "weeklyCashForfeited",
      "discriminator": [
        178,
        222,
        80,
        211,
        139,
        213,
        28,
        239
      ]
    },
    {
      "name": "weeklyFinalized",
      "discriminator": [
        55,
        77,
        237,
        144,
        33,
        24,
        69,
        3
      ]
    },
    {
      "name": "weeklyOpened",
      "discriminator": [
        111,
        39,
        219,
        141,
        35,
        201,
        62,
        61
      ]
    },
    {
      "name": "weeklyQuestStarsClaimed",
      "discriminator": [
        7,
        131,
        183,
        184,
        33,
        202,
        237,
        58
      ]
    },
    {
      "name": "weeklyStarsClaimed",
      "discriminator": [
        105,
        28,
        155,
        134,
        9,
        133,
        210,
        208
      ]
    },
    {
      "name": "weeklyStipendAwarded",
      "discriminator": [
        231,
        190,
        47,
        38,
        123,
        42,
        225,
        176
      ]
    },
    {
      "name": "zoneUnlocked",
      "discriminator": [
        115,
        182,
        73,
        219,
        1,
        151,
        142,
        14
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notGameOwner",
      "msg": "The signer is not authorized for this run"
    },
    {
      "code": 6001,
      "name": "gameOver",
      "msg": "The run is already terminal"
    },
    {
      "code": 6002,
      "name": "invalidMove",
      "msg": "The move coordinates are invalid"
    },
    {
      "code": 6003,
      "name": "unauthorized",
      "msg": "Only the configured authority may perform this action"
    },
    {
      "code": 6004,
      "name": "insufficientFunds",
      "msg": "The source account has insufficient funds"
    },
    {
      "code": 6005,
      "name": "notDelegated",
      "msg": "The active run is not delegated to the ephemeral rollup"
    },
    {
      "code": 6006,
      "name": "invalidState",
      "msg": "The account is in an invalid state for this instruction"
    },
    {
      "code": 6007,
      "name": "invalidOwner",
      "msg": "The account owner or relationship is invalid"
    },
    {
      "code": 6008,
      "name": "invalidMoveOrder",
      "msg": "The expected move or action counter does not match"
    },
    {
      "code": 6009,
      "name": "invalidMagicProgram",
      "msg": "The MagicBlock program is invalid"
    },
    {
      "code": 6010,
      "name": "gameNotFinished",
      "msg": "The run is not ready to finish"
    },
    {
      "code": 6011,
      "name": "challengeNotStarted",
      "msg": "The Daily challenge has not started"
    },
    {
      "code": 6012,
      "name": "challengeEnded",
      "msg": "The Daily challenge entry or play window has ended"
    },
    {
      "code": 6013,
      "name": "challengeNotEnded",
      "msg": "The Daily challenge has not ended"
    },
    {
      "code": 6014,
      "name": "alreadySubmitted",
      "msg": "This Daily attempt has already been submitted"
    },
    {
      "code": 6015,
      "name": "arithmeticOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6016,
      "name": "insufficientStars",
      "msg": "Insufficient Stars"
    },
    {
      "code": 6017,
      "name": "invalidMap",
      "msg": "Invalid map"
    },
    {
      "code": 6018,
      "name": "invalidLevel",
      "msg": "Invalid level"
    },
    {
      "code": 6019,
      "name": "invalidStars",
      "msg": "Invalid star rating"
    },
    {
      "code": 6020,
      "name": "protocolPaused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6021,
      "name": "invalidVersion",
      "msg": "Unsupported account version"
    },
    {
      "code": 6022,
      "name": "invalidRunId",
      "msg": "Invalid run id"
    },
    {
      "code": 6023,
      "name": "mapLocked",
      "msg": "Map is locked"
    },
    {
      "code": 6024,
      "name": "mapDisabled",
      "msg": "Map is disabled"
    },
    {
      "code": 6025,
      "name": "mapAlreadyUnlocked",
      "msg": "Map is already unlocked"
    },
    {
      "code": 6026,
      "name": "contentVersionMismatch",
      "msg": "Content version mismatch"
    },
    {
      "code": 6027,
      "name": "invalidBlockWeights",
      "msg": "Invalid block weights"
    },
    {
      "code": 6028,
      "name": "vrfRequestPending",
      "msg": "A VRF request is already pending"
    },
    {
      "code": 6029,
      "name": "noVrfRequestPending",
      "msg": "No VRF request is pending"
    },
    {
      "code": 6030,
      "name": "receiptMismatch",
      "msg": "The run receipt does not match the committed run"
    },
    {
      "code": 6031,
      "name": "noPrize",
      "msg": "The player has no Daily prize"
    },
    {
      "code": 6032,
      "name": "prizeAlreadyClaimed",
      "msg": "The Daily prize has already been claimed"
    },
    {
      "code": 6033,
      "name": "prizeClaimWindowOpen",
      "msg": "The Daily prize claim window is still open"
    },
    {
      "code": 6034,
      "name": "refundAlreadyClaimed",
      "msg": "The refund has already been claimed"
    },
    {
      "code": 6035,
      "name": "invalidProgressRule",
      "msg": "The progression rule is invalid"
    },
    {
      "code": 6036,
      "name": "rewardAlreadyClaimed",
      "msg": "This progress reward has already been claimed"
    },
    {
      "code": 6037,
      "name": "rewardNotEarned",
      "msg": "The progress requirement has not been met"
    },
    {
      "code": 6038,
      "name": "questNotActive",
      "msg": "This quest is not active in the current cadence"
    },
    {
      "code": 6039,
      "name": "accountingInvariant",
      "msg": "The financial accounting invariant does not balance"
    },
    {
      "code": 6040,
      "name": "invalidPack",
      "msg": "The selected Star pack does not exist"
    },
    {
      "code": 6041,
      "name": "priceChanged",
      "msg": "The Star pack price changed; refresh the quote"
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
            "name": "runShell",
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
            "name": "actionAuthority",
            "type": "pubkey"
          },
          {
            "name": "contentVersion",
            "type": "u32"
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
            "name": "featuredScore",
            "type": "u32"
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
            "name": "vrfRequestedAt",
            "type": "i64"
          },
          {
            "name": "actionHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "vrfHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "startedAt",
            "type": "i64"
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
      "name": "campaignProgress",
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
            "name": "unlockedMaps",
            "docs": [
              "Bit `map_id - 1`; Map 1 is set on initialization."
            ],
            "type": "u32"
          },
          {
            "name": "purchasedMaps",
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
              "Two bits per level, ten levels per map."
            ],
            "type": {
              "array": [
                "u32",
                32
              ]
            }
          },
          {
            "name": "lastConsumedRunId",
            "docs": [
              "Prevents replayed receipts from changing progress twice."
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
      "name": "dailyChallenge",
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
            "name": "economyConfig",
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
            "name": "seasonId",
            "type": "u32"
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
            "name": "settlementGraceCloseAt",
            "type": "i64"
          },
          {
            "name": "finalizedAt",
            "type": "i64"
          },
          {
            "name": "entryStars",
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
            "name": "attemptsStarted",
            "type": "u64"
          },
          {
            "name": "runsFinalized",
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
      "name": "dailyEntered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "challenge",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "runId",
            "type": "u64"
          },
          {
            "name": "attempt",
            "type": "u32"
          },
          {
            "name": "starsSpent",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "dailyFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "challenge",
            "type": "pubkey"
          },
          {
            "name": "dayId",
            "type": "u32"
          },
          {
            "name": "participants",
            "type": "u32"
          },
          {
            "name": "finalizedRuns",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "dailyLeaderboard",
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
                  "name": "dailyLeaderboardEntry"
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
      "name": "dailyLeaderboardEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "runId",
            "type": "u64"
          },
          {
            "name": "featuredScore",
            "type": "u32"
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
            "name": "submittedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "dailyOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "challenge",
            "type": "pubkey"
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
            "name": "seasonId",
            "type": "u32"
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
            "name": "rulesHash",
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
      "name": "dailyPlayer",
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
            "name": "attempts",
            "type": "u32"
          },
          {
            "name": "finalizedAttempts",
            "type": "u32"
          },
          {
            "name": "bestRunId",
            "type": "u64"
          },
          {
            "name": "bestReceipt",
            "type": "pubkey"
          },
          {
            "name": "bestFeaturedScore",
            "type": "u32"
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
            "name": "dailyXpAwarded",
            "type": "bool"
          },
          {
            "name": "weeklyRolledUp",
            "type": "bool"
          },
          {
            "name": "starRefunded",
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
      "name": "dailyRolledUp",
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
            "name": "weekId",
            "type": "u32"
          },
          {
            "name": "points",
            "type": "u16"
          },
          {
            "name": "weeklyScore",
            "type": "u16"
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
            "name": "economyConfig",
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
            "name": "seasonId",
            "type": "u32"
          },
          {
            "name": "startsDay",
            "type": "u32"
          },
          {
            "name": "seasonSeed",
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
      "name": "dailyRulesPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "catalog",
            "type": "pubkey"
          },
          {
            "name": "rulesVersion",
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
      "name": "economyConfig",
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
            "name": "paymentMint",
            "type": "pubkey"
          },
          {
            "name": "paymentTokenProgram",
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
            "name": "revision",
            "type": "u64"
          },
          {
            "name": "dailyEntryStars",
            "type": "u64"
          },
          {
            "name": "zoneUnlockStars",
            "type": "u64"
          },
          {
            "name": "starPackStars",
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          },
          {
            "name": "starPackPrices",
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          },
          {
            "name": "starPackEnabled",
            "type": {
              "array": [
                "bool",
                5
              ]
            }
          },
          {
            "name": "saleEnabled",
            "type": "bool"
          },
          {
            "name": "saleStartsAt",
            "type": "i64"
          },
          {
            "name": "saleEndsAt",
            "type": "i64"
          },
          {
            "name": "salePrices",
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          },
          {
            "name": "weeklyMinCashPool",
            "type": "u64"
          },
          {
            "name": "weeklyMaxCashPool",
            "type": "u64"
          },
          {
            "name": "active",
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
      "name": "economyConfigured",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "economyConfig",
            "type": "pubkey"
          },
          {
            "name": "contentVersion",
            "type": "u32"
          },
          {
            "name": "dailyRulesVersion",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "economyPricesUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "revision",
            "type": "u64"
          },
          {
            "name": "prices",
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          },
          {
            "name": "enabled",
            "type": {
              "array": [
                "bool",
                5
              ]
            }
          }
        ]
      }
    },
    {
      "name": "economySaleCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "revision",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "economySaleScheduled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "revision",
            "type": "u64"
          },
          {
            "name": "startsAt",
            "type": "i64"
          },
          {
            "name": "endsAt",
            "type": "i64"
          },
          {
            "name": "prices",
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          }
        ]
      }
    },
    {
      "name": "initializeEconomyArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dailyRulesVersion",
            "type": "u32"
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
            "name": "paymaster",
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
            "name": "paymentMint",
            "type": "pubkey"
          },
          {
            "name": "paymentTokenProgram",
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
      "name": "levelMilestoneClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "level",
            "type": "u8"
          },
          {
            "name": "stars",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "levelMilestones",
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
            "name": "claimed",
            "docs": [
              "Bits 0..9 represent levels 10, 20, ... 100."
            ],
            "type": "u16"
          },
          {
            "name": "totalStarsClaimed",
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
      "name": "playerProfile",
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
            "name": "starsBalance",
            "type": "u64"
          },
          {
            "name": "lifetimeStarsEarned",
            "type": "u64"
          },
          {
            "name": "lifetimeStarsSpent",
            "type": "u64"
          },
          {
            "name": "nextRunId",
            "type": "u64"
          },
          {
            "name": "dailyEligible",
            "type": "bool"
          },
          {
            "name": "achievementFlags",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "achievementXp",
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
            "name": "paymaster",
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
            "name": "paymentMint",
            "type": "pubkey"
          },
          {
            "name": "paymentTokenProgram",
            "type": "pubkey"
          },
          {
            "name": "contentVersion",
            "type": "u32"
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
      "name": "publishDailyRulesArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "rulesVersion",
            "type": "u32"
          },
          {
            "name": "seasonId",
            "type": "u32"
          },
          {
            "name": "startsDay",
            "type": "u32"
          },
          {
            "name": "seasonSeed",
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
      "name": "questClaims",
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
            "name": "dailyCadenceId",
            "type": "u32"
          },
          {
            "name": "weeklyCadenceId",
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
            "name": "bump",
            "type": "u8"
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
          },
          {
            "name": "committing"
          },
          {
            "name": "settled"
          },
          {
            "name": "cancelled"
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
      "name": "runReceipt",
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
            "name": "runShell",
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
            "name": "settlementTarget",
            "type": {
              "defined": {
                "name": "settlementTarget"
              }
            }
          },
          {
            "name": "contentVersion",
            "type": "u32"
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
            "name": "score",
            "type": "u32"
          },
          {
            "name": "featuredScore",
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
            "name": "moves",
            "type": "u16"
          },
          {
            "name": "levelStars",
            "type": "u8"
          },
          {
            "name": "linesCleared",
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
            "name": "maxCombo",
            "type": "u8"
          },
          {
            "name": "completed",
            "type": "bool"
          },
          {
            "name": "actionHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "vrfHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "startedAt",
            "type": "i64"
          },
          {
            "name": "finishedAt",
            "type": "i64"
          },
          {
            "name": "consumedAt",
            "type": "i64"
          },
          {
            "name": "consumed",
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
      "name": "runShell",
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
            "name": "settlementTarget",
            "type": {
              "defined": {
                "name": "settlementTarget"
              }
            }
          },
          {
            "name": "contentVersion",
            "type": "u32"
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
            "name": "mapCatalog",
            "type": "pubkey"
          },
          {
            "name": "dailyChallenge",
            "type": "pubkey"
          },
          {
            "name": "actionAuthority",
            "type": "pubkey"
          },
          {
            "name": "delegatedValidator",
            "type": "pubkey"
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
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "settledAt",
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
      "name": "scheduleSaleArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "startsAt",
            "type": "i64"
          },
          {
            "name": "endsAt",
            "type": "i64"
          },
          {
            "name": "prices",
            "type": {
              "array": [
                "u64",
                5
              ]
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
    },
    {
      "name": "settlementTarget",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "campaignProgress"
          },
          {
            "name": "dailyLeaderboard"
          }
        ]
      }
    },
    {
      "name": "starSalesLedger",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "economyConfig",
            "type": "pubkey"
          },
          {
            "name": "paymentMint",
            "type": "pubkey"
          },
          {
            "name": "lifetimeGrossSales",
            "type": "u64"
          },
          {
            "name": "lifetimeTeamShare",
            "type": "u64"
          },
          {
            "name": "lifetimeRewardShare",
            "type": "u64"
          },
          {
            "name": "lifetimeTreasuryShare",
            "type": "u64"
          },
          {
            "name": "lifetimeStarsSold",
            "type": "u64"
          },
          {
            "name": "purchaseCount",
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
      "name": "starsPurchased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "packIndex",
            "type": "u8"
          },
          {
            "name": "configRevision",
            "type": "u64"
          },
          {
            "name": "stars",
            "type": "u64"
          },
          {
            "name": "gross",
            "type": "u64"
          },
          {
            "name": "team",
            "type": "u64"
          },
          {
            "name": "reward",
            "type": "u64"
          },
          {
            "name": "treasury",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "updateRegularPricesArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "prices",
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          },
          {
            "name": "enabled",
            "type": {
              "array": [
                "bool",
                5
              ]
            }
          }
        ]
      }
    },
    {
      "name": "weeklyCashClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "weekId",
            "type": "u32"
          },
          {
            "name": "rank",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "weeklyCashForfeited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "weekId",
            "type": "u32"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "weeklyChallenge",
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
            "name": "economyConfig",
            "type": "pubkey"
          },
          {
            "name": "paymentMint",
            "type": "pubkey"
          },
          {
            "name": "paymentTokenProgram",
            "type": "pubkey"
          },
          {
            "name": "paymentVault",
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
            "name": "finalizesAt",
            "type": "i64"
          },
          {
            "name": "finalizedAt",
            "type": "i64"
          },
          {
            "name": "claimsCloseAt",
            "type": "i64"
          },
          {
            "name": "committedCashPool",
            "type": "u64"
          },
          {
            "name": "cashClaimed",
            "type": "u64"
          },
          {
            "name": "cashForfeited",
            "type": "u64"
          },
          {
            "name": "participants",
            "type": "u32"
          },
          {
            "name": "cashWinnerCount",
            "type": "u8"
          },
          {
            "name": "starWinnerCount",
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
      "name": "weeklyDailyResult",
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
      "name": "weeklyFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "challenge",
            "type": "pubkey"
          },
          {
            "name": "weekId",
            "type": "u32"
          },
          {
            "name": "participants",
            "type": "u32"
          },
          {
            "name": "cashWinnerCount",
            "type": "u8"
          },
          {
            "name": "starWinnerCount",
            "type": "u8"
          },
          {
            "name": "cashPool",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "weeklyLeaderboard",
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
                  "name": "weeklyLeaderboardEntry"
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
      "name": "weeklyLeaderboardEntry",
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
            "name": "updatedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "weeklyOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "challenge",
            "type": "pubkey"
          },
          {
            "name": "weekId",
            "type": "u32"
          },
          {
            "name": "cashPool",
            "type": "u64"
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
            "name": "challenge",
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
                    "name": "weeklyDailyResult"
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
            "name": "cashClaimed",
            "type": "bool"
          },
          {
            "name": "starsClaimed",
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
      "name": "weeklyQuestStarsClaimed",
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
            "name": "stars",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "weeklyStarsClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "weekId",
            "type": "u32"
          },
          {
            "name": "rank",
            "type": "u8"
          },
          {
            "name": "stars",
            "type": "u64"
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
            "name": "claimable"
          },
          {
            "name": "closed"
          }
        ]
      }
    },
    {
      "name": "weeklyStipend",
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
            "name": "weekId",
            "type": "u32"
          },
          {
            "name": "recurringXp",
            "type": "u32"
          },
          {
            "name": "starsAwarded",
            "type": "bool"
          },
          {
            "name": "lifetimeStarsAwarded",
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
      "name": "weeklyStipendAwarded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "weekId",
            "type": "u32"
          },
          {
            "name": "recurringXp",
            "type": "u32"
          },
          {
            "name": "stars",
            "type": "u64"
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
    },
    {
      "name": "zoneUnlocked",
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
            "name": "starsSpent",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
