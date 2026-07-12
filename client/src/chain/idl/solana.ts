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
      "name": "abandonRunV1",
      "discriminator": [
        125,
        40,
        244,
        230,
        253,
        139,
        171,
        92
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
      "name": "acceptProtocolAuthorityV1",
      "discriminator": [
        230,
        20,
        160,
        57,
        193,
        16,
        25,
        43
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
      "name": "allocateRealizedYieldV1",
      "discriminator": [
        120,
        83,
        85,
        144,
        119,
        17,
        122,
        168
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
          "name": "yieldPolicy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  105,
                  101,
                  108,
                  100,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "paymentMint"
        },
        {
          "name": "treasuryVault",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true
        },
        {
          "name": "paymentTokenProgram"
        },
        {
          "name": "caller",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "applyBonusV1",
      "discriminator": [
        123,
        100,
        81,
        18,
        173,
        205,
        227,
        10
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
      "name": "cancelDailyChallengeV1",
      "discriminator": [
        200,
        44,
        130,
        97,
        182,
        81,
        72,
        100
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
          "name": "authority",
          "signer": true,
          "relations": [
            "dailyChallenge"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "cancelGovernanceV1",
      "discriminator": [
        204,
        215,
        10,
        6,
        105,
        92,
        244,
        57
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
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "proposal.proposal_id",
                "account": "governanceProposal"
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
      "name": "claimAchievementV1",
      "discriminator": [
        89,
        171,
        8,
        91,
        40,
        109,
        245,
        208
      ],
      "accounts": [
        {
          "name": "protocol"
        },
        {
          "name": "progressCatalog",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  103,
                  114,
                  101,
                  115,
                  115,
                  95,
                  99,
                  97,
                  116,
                  97,
                  108,
                  111,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "protocol.progress_version",
                "account": "protocolConfig"
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
      "name": "claimDailyPrizeV1",
      "discriminator": [
        176,
        233,
        126,
        177,
        41,
        111,
        81,
        233
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
          "name": "paymentMint"
        },
        {
          "name": "paymentVault",
          "writable": true
        },
        {
          "name": "playerPaymentAccount",
          "writable": true
        },
        {
          "name": "paymentTokenProgram"
        },
        {
          "name": "owner",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "claimQuestV1",
      "discriminator": [
        61,
        90,
        44,
        10,
        13,
        189,
        4,
        3
      ],
      "accounts": [
        {
          "name": "protocol"
        },
        {
          "name": "progressCatalog",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  103,
                  114,
                  101,
                  115,
                  115,
                  95,
                  99,
                  97,
                  116,
                  97,
                  108,
                  111,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "protocol.progress_version",
                "account": "protocolConfig"
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
              },
              {
                "kind": "account",
                "path": "protocol.progress_version",
                "account": "protocolConfig"
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
      "name": "closeSettledActiveRunV1",
      "discriminator": [
        15,
        185,
        11,
        182,
        7,
        135,
        180,
        159
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "runShell",
            "runReceipt",
            "activeRun"
          ]
        },
        {
          "name": "runShell",
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
      "name": "commitDailyRunV1",
      "discriminator": [
        35,
        6,
        133,
        24,
        232,
        174,
        233,
        50
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
      "name": "commitRunV1",
      "discriminator": [
        32,
        249,
        212,
        79,
        64,
        130,
        66,
        164
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
      "name": "consumeDailyReceiptV1",
      "discriminator": [
        167,
        133,
        90,
        4,
        83,
        62,
        112,
        143
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
      "name": "consumeRunReceiptV1",
      "discriminator": [
        153,
        5,
        99,
        189,
        42,
        139,
        168,
        22
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
      "name": "consumeSponsorshipV1",
      "discriminator": [
        59,
        233,
        232,
        90,
        10,
        245,
        139,
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
          "name": "sponsorAllowance",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  110,
                  115,
                  111,
                  114,
                  95,
                  97,
                  108,
                  108,
                  111,
                  119,
                  97,
                  110,
                  99,
                  101
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
          "name": "paymaster",
          "writable": true,
          "signer": true,
          "relations": [
            "protocol"
          ]
        },
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createDailyChallengeV1",
      "discriminator": [
        62,
        180,
        151,
        232,
        65,
        59,
        205,
        246
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
                "kind": "arg",
                "path": "args.day_id"
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
          "name": "paymentMint"
        },
        {
          "name": "paymentVault",
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
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "args.day_id"
              }
            ]
          }
        },
        {
          "name": "paymentTokenProgram"
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
              "name": "createDailyChallengeArgs"
            }
          }
        }
      ]
    },
    {
      "name": "delegateActiveRunV1",
      "discriminator": [
        197,
        109,
        88,
        188,
        239,
        118,
        146,
        107
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
      "name": "distributeDailyRakeV1",
      "discriminator": [
        84,
        98,
        217,
        178,
        155,
        92,
        0,
        18
      ],
      "accounts": [
        {
          "name": "protocol"
        },
        {
          "name": "treasuryLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
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
          "name": "paymentMint"
        },
        {
          "name": "paymentVault",
          "writable": true
        },
        {
          "name": "teamVault",
          "writable": true
        },
        {
          "name": "paymasterVault",
          "writable": true
        },
        {
          "name": "treasuryVault",
          "writable": true
        },
        {
          "name": "paymentTokenProgram"
        },
        {
          "name": "caller",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "enterDailyPaidV1",
      "discriminator": [
        243,
        167,
        161,
        133,
        50,
        97,
        189,
        39
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
          "name": "paymentMint"
        },
        {
          "name": "playerPaymentAccount",
          "writable": true
        },
        {
          "name": "paymentVault",
          "writable": true
        },
        {
          "name": "paymentTokenProgram"
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
      "name": "enterDailyWithStarsV1",
      "discriminator": [
        35,
        6,
        113,
        106,
        140,
        138,
        65,
        187
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
      "name": "executeGovernanceV1",
      "discriminator": [
        76,
        254,
        48,
        154,
        135,
        104,
        119,
        176
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
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "proposal.proposal_id",
                "account": "governanceProposal"
              }
            ]
          }
        },
        {
          "name": "yieldPolicy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  105,
                  101,
                  108,
                  100,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryLedger",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
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
      "name": "finalizeDailyChallengeV1",
      "discriminator": [
        108,
        239,
        202,
        81,
        138,
        190,
        37,
        55
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
      "name": "forfeitUnclaimedDailyPrizesV1",
      "discriminator": [
        222,
        177,
        123,
        58,
        77,
        13,
        156,
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
          "name": "treasuryLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
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
          "name": "paymentTokenProgram"
        },
        {
          "name": "caller",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "fulfillRowVrfV1",
      "discriminator": [
        177,
        243,
        9,
        224,
        164,
        186,
        92,
        147
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
      "name": "fundDailyChallengeV1",
      "discriminator": [
        22,
        38,
        53,
        81,
        0,
        82,
        220,
        235
      ],
      "accounts": [
        {
          "name": "dailyChallenge",
          "writable": true
        },
        {
          "name": "paymentMint"
        },
        {
          "name": "sponsorPaymentAccount",
          "writable": true
        },
        {
          "name": "paymentVault",
          "writable": true,
          "relations": [
            "dailyChallenge"
          ]
        },
        {
          "name": "paymentTokenProgram"
        },
        {
          "name": "sponsor",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializePlayerV1",
      "discriminator": [
        99,
        199,
        152,
        251,
        221,
        241,
        157,
        188
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
      "name": "initializeProtocolV1",
      "discriminator": [
        225,
        154,
        250,
        233,
        88,
        199,
        7,
        153
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
          "name": "treasuryLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "yieldPolicy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  105,
                  101,
                  108,
                  100,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "paymentMint"
        },
        {
          "name": "teamVault"
        },
        {
          "name": "paymasterVault"
        },
        {
          "name": "treasuryVault"
        },
        {
          "name": "rewardVault"
        },
        {
          "name": "paymentVault"
        },
        {
          "name": "paymentTokenProgram"
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
      "name": "pauseProtocolV1",
      "discriminator": [
        233,
        141,
        57,
        69,
        255,
        1,
        162,
        200
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
      "args": []
    },
    {
      "name": "pauseYieldStrategyV1",
      "discriminator": [
        48,
        146,
        31,
        239,
        51,
        215,
        88,
        106
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
          "name": "yieldPolicy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  105,
                  101,
                  108,
                  100,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
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
      "name": "playMoveV1",
      "discriminator": [
        138,
        15,
        30,
        249,
        151,
        184,
        48,
        7
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
      "name": "prepareCampaignRunV1",
      "discriminator": [
        119,
        10,
        2,
        12,
        124,
        82,
        222,
        248
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
      "name": "proposeGovernanceV1",
      "discriminator": [
        219,
        39,
        76,
        35,
        135,
        217,
        72,
        124
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
          "name": "yieldPolicy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  105,
                  101,
                  108,
                  100,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryLedger",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "proposalId"
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
          "name": "proposalId",
          "type": "u64"
        },
        {
          "name": "action",
          "type": {
            "defined": {
              "name": "governanceAction"
            }
          }
        }
      ]
    },
    {
      "name": "purchaseMapWithUsdcV1",
      "discriminator": [
        4,
        155,
        216,
        148,
        66,
        187,
        242,
        232
      ],
      "accounts": [
        {
          "name": "protocol"
        },
        {
          "name": "treasuryLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
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
          "name": "paymentMint"
        },
        {
          "name": "playerPaymentAccount",
          "writable": true
        },
        {
          "name": "paymentVault",
          "writable": true
        },
        {
          "name": "paymentTokenProgram"
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "campaignProgress"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "reclaimCancelledSponsorV1",
      "discriminator": [
        25,
        143,
        186,
        3,
        251,
        159,
        175,
        130
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
          "name": "paymentMint"
        },
        {
          "name": "paymentVault",
          "writable": true
        },
        {
          "name": "authorityPaymentAccount",
          "writable": true
        },
        {
          "name": "paymentTokenProgram"
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "dailyChallenge"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "refundDailyEntryV1",
      "discriminator": [
        116,
        103,
        39,
        233,
        230,
        94,
        180,
        217
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
          "name": "paymentMint"
        },
        {
          "name": "paymentVault",
          "writable": true
        },
        {
          "name": "playerPaymentAccount",
          "writable": true
        },
        {
          "name": "paymentTokenProgram"
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
      "name": "requestRowVrfV1",
      "discriminator": [
        205,
        54,
        3,
        63,
        228,
        108,
        244,
        56
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
      "name": "rotateActiveRunAuthorityV1",
      "discriminator": [
        235,
        157,
        41,
        148,
        59,
        12,
        255,
        199
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
      "name": "rotateRunShellAuthorityV1",
      "discriminator": [
        223,
        191,
        8,
        214,
        182,
        95,
        10,
        124
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
      "name": "sealRunV1",
      "discriminator": [
        220,
        204,
        227,
        245,
        127,
        248,
        154,
        207
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
      "name": "sweepProtocolRevenueV1",
      "discriminator": [
        20,
        39,
        134,
        62,
        87,
        144,
        10,
        172
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
          "name": "treasuryLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
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
          "name": "treasuryVault",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true
        },
        {
          "name": "paymentTokenProgram"
        },
        {
          "name": "caller",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "unlockMapWithStarsV1",
      "discriminator": [
        217,
        210,
        254,
        241,
        119,
        234,
        184,
        212
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
      "name": "writeCanonicalMapCatalogV1",
      "discriminator": [
        111,
        70,
        28,
        15,
        40,
        41,
        106,
        71
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
          "name": "contentVersion",
          "type": "u32"
        },
        {
          "name": "mapId",
          "type": "u8"
        }
      ]
    },
    {
      "name": "writeMapCatalogV1",
      "discriminator": [
        87,
        197,
        80,
        60,
        193,
        188,
        25,
        36
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
    },
    {
      "name": "writeProgressCatalogV1",
      "discriminator": [
        65,
        231,
        150,
        15,
        193,
        90,
        112,
        179
      ],
      "accounts": [
        {
          "name": "protocol",
          "writable": true
        },
        {
          "name": "progressCatalog",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  103,
                  114,
                  101,
                  115,
                  115,
                  95,
                  99,
                  97,
                  116,
                  97,
                  108,
                  111,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "args.progress_version"
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
              "name": "writeProgressCatalogArgs"
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
      "name": "governanceProposal",
      "discriminator": [
        53,
        107,
        240,
        190,
        43,
        73,
        65,
        143
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
      "name": "progressCatalog",
      "discriminator": [
        106,
        73,
        253,
        113,
        111,
        22,
        9,
        200
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
      "name": "sponsorAllowance",
      "discriminator": [
        105,
        139,
        98,
        247,
        38,
        82,
        125,
        24
      ]
    },
    {
      "name": "treasuryLedger",
      "discriminator": [
        15,
        12,
        146,
        198,
        187,
        1,
        246,
        253
      ]
    },
    {
      "name": "yieldStrategyPolicy",
      "discriminator": [
        122,
        241,
        216,
        9,
        236,
        239,
        195,
        239
      ]
    }
  ],
  "events": [
    {
      "name": "achievementClaimedV1",
      "discriminator": [
        51,
        215,
        213,
        198,
        53,
        109,
        93,
        77
      ]
    },
    {
      "name": "dailyPrizeForfeited",
      "discriminator": [
        139,
        125,
        183,
        160,
        140,
        24,
        9,
        127
      ]
    },
    {
      "name": "governanceProposalCancelled",
      "discriminator": [
        207,
        157,
        168,
        55,
        124,
        179,
        247,
        244
      ]
    },
    {
      "name": "governanceProposalCreated",
      "discriminator": [
        149,
        102,
        52,
        29,
        155,
        69,
        219,
        208
      ]
    },
    {
      "name": "governanceProposalExecuted",
      "discriminator": [
        24,
        181,
        202,
        130,
        83,
        126,
        222,
        26
      ]
    },
    {
      "name": "progressCatalogPublishedV1",
      "discriminator": [
        166,
        119,
        51,
        113,
        229,
        21,
        0,
        153
      ]
    },
    {
      "name": "protocolRevenueSwept",
      "discriminator": [
        120,
        151,
        229,
        155,
        245,
        22,
        241,
        2
      ]
    },
    {
      "name": "questClaimedV1",
      "discriminator": [
        230,
        234,
        36,
        205,
        9,
        10,
        105,
        150
      ]
    },
    {
      "name": "realizedYieldAllocated",
      "discriminator": [
        198,
        86,
        164,
        104,
        228,
        124,
        122,
        50
      ]
    },
    {
      "name": "sponsorshipConsumed",
      "discriminator": [
        215,
        152,
        76,
        221,
        91,
        129,
        14,
        227
      ]
    },
    {
      "name": "yieldStrategyEmergencyPaused",
      "discriminator": [
        201,
        106,
        229,
        220,
        22,
        94,
        151,
        15
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
      "name": "invalidBasisPoints",
      "msg": "Prize and rake basis points must sum to 10,000"
    },
    {
      "code": 6021,
      "name": "protocolPaused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6022,
      "name": "invalidVersion",
      "msg": "Unsupported account version"
    },
    {
      "code": 6023,
      "name": "invalidRunId",
      "msg": "Invalid run id"
    },
    {
      "code": 6024,
      "name": "mapLocked",
      "msg": "Map is locked"
    },
    {
      "code": 6025,
      "name": "mapDisabled",
      "msg": "Map is disabled"
    },
    {
      "code": 6026,
      "name": "mapAlreadyUnlocked",
      "msg": "Map is already unlocked"
    },
    {
      "code": 6027,
      "name": "contentVersionMismatch",
      "msg": "Content version mismatch"
    },
    {
      "code": 6028,
      "name": "invalidBlockWeights",
      "msg": "Invalid block weights"
    },
    {
      "code": 6029,
      "name": "vrfRequestPending",
      "msg": "A VRF request is already pending"
    },
    {
      "code": 6030,
      "name": "noVrfRequestPending",
      "msg": "No VRF request is pending"
    },
    {
      "code": 6031,
      "name": "receiptMismatch",
      "msg": "The run receipt does not match the committed run"
    },
    {
      "code": 6032,
      "name": "noPrize",
      "msg": "The player has no Daily prize"
    },
    {
      "code": 6033,
      "name": "prizeAlreadyClaimed",
      "msg": "The Daily prize has already been claimed"
    },
    {
      "code": 6034,
      "name": "prizeClaimWindowOpen",
      "msg": "The Daily prize claim window is still open"
    },
    {
      "code": 6035,
      "name": "refundAlreadyClaimed",
      "msg": "The refund has already been claimed"
    },
    {
      "code": 6036,
      "name": "invalidProgressCatalog",
      "msg": "The progress catalog is invalid"
    },
    {
      "code": 6037,
      "name": "rewardAlreadyClaimed",
      "msg": "This progress reward has already been claimed"
    },
    {
      "code": 6038,
      "name": "rewardNotEarned",
      "msg": "The progress requirement has not been met"
    },
    {
      "code": 6039,
      "name": "questNotActive",
      "msg": "This quest is not active in the current cadence"
    },
    {
      "code": 6040,
      "name": "sponsorshipLimitExceeded",
      "msg": "The on-chain sponsorship allowance is exhausted"
    },
    {
      "code": 6041,
      "name": "invalidSponsoredTransaction",
      "msg": "The sponsored transaction payload is invalid"
    },
    {
      "code": 6042,
      "name": "accountingInvariant",
      "msg": "The financial accounting invariant does not balance"
    },
    {
      "code": 6043,
      "name": "invalidGovernanceProposal",
      "msg": "The governance proposal is invalid"
    },
    {
      "code": 6044,
      "name": "governanceTimelockActive",
      "msg": "The governance timelock has not elapsed"
    },
    {
      "code": 6045,
      "name": "governanceProposalExpired",
      "msg": "The governance proposal execution window has expired"
    }
  ],
  "types": [
    {
      "name": "achievementClaimedV1",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "progressVersion",
            "type": "u32"
          },
          {
            "name": "achievementIndex",
            "type": "u8"
          },
          {
            "name": "starReward",
            "type": "u64"
          },
          {
            "name": "xpReward",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "achievementRule",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "metric",
            "type": "u8"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "threshold",
            "type": "u64"
          },
          {
            "name": "starReward",
            "type": "u64"
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
            "name": "initialRowsRemaining",
            "type": "u8"
          },
          {
            "name": "currentDifficulty",
            "type": "u8"
          },
          {
            "name": "endlessThresholds",
            "type": {
              "array": [
                "u32",
                7
              ]
            }
          },
          {
            "name": "endlessScoreMultipliersX100",
            "type": {
              "array": [
                "u16",
                8
              ]
            }
          },
          {
            "name": "endlessRampMultiplierX100",
            "type": "u16"
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
            "type": "u16"
          },
          {
            "name": "purchasedMaps",
            "type": "u16"
          },
          {
            "name": "clearedMaps",
            "type": "u16"
          },
          {
            "name": "perfectedMaps",
            "type": "u16"
          },
          {
            "name": "levelStars",
            "docs": [
              "Two bits per level, ten levels per map."
            ],
            "type": {
              "array": [
                "u32",
                10
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
      "name": "createDailyChallengeArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dayId",
            "type": "u32"
          },
          {
            "name": "mapId",
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
            "name": "endlessThresholds",
            "type": {
              "array": [
                "u32",
                7
              ]
            }
          },
          {
            "name": "endlessScoreMultipliersX100",
            "type": {
              "array": [
                "u16",
                8
              ]
            }
          },
          {
            "name": "endlessRampMultiplierX100",
            "type": "u16"
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
            "name": "starEntryCost",
            "type": "u64"
          },
          {
            "name": "payoutBps",
            "type": {
              "array": [
                "u16",
                10
              ]
            }
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
            "name": "authority",
            "type": "pubkey"
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
            "name": "rules",
            "type": {
              "defined": {
                "name": "levelRuleSnapshot"
              }
            }
          },
          {
            "name": "endlessThresholds",
            "type": {
              "array": [
                "u32",
                7
              ]
            }
          },
          {
            "name": "endlessScoreMultipliersX100",
            "type": {
              "array": [
                "u16",
                8
              ]
            }
          },
          {
            "name": "endlessRampMultiplierX100",
            "type": "u16"
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
            "name": "claimsCloseAt",
            "type": "i64"
          },
          {
            "name": "entryPrice",
            "type": "u64"
          },
          {
            "name": "starEntryCost",
            "type": "u64"
          },
          {
            "name": "prizeBps",
            "type": "u16"
          },
          {
            "name": "rakeBps",
            "type": "u16"
          },
          {
            "name": "sponsorFunding",
            "type": "u64"
          },
          {
            "name": "paidEntryFunding",
            "type": "u64"
          },
          {
            "name": "prizeLiability",
            "type": "u64"
          },
          {
            "name": "rakeAccrued",
            "type": "u64"
          },
          {
            "name": "rakeDistributed",
            "type": "u64"
          },
          {
            "name": "refundsPaid",
            "type": "u64"
          },
          {
            "name": "prizeClaimed",
            "type": "u64"
          },
          {
            "name": "prizeForfeited",
            "type": "u64"
          },
          {
            "name": "settledPrizePool",
            "type": "u64"
          },
          {
            "name": "sponsorReclaimed",
            "type": "bool"
          },
          {
            "name": "payoutBps",
            "type": {
              "array": [
                "u16",
                10
              ]
            }
          },
          {
            "name": "totalPaidAttempts",
            "type": "u64"
          },
          {
            "name": "totalFreeAttempts",
            "type": "u64"
          },
          {
            "name": "runsStarted",
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
            "name": "score",
            "type": "u32"
          },
          {
            "name": "submittedAt",
            "type": "i64"
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
            "name": "freeAttemptUsed",
            "type": "bool"
          },
          {
            "name": "paidAttempts",
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
            "name": "bestScore",
            "type": "u32"
          },
          {
            "name": "bestSubmittedAt",
            "type": "i64"
          },
          {
            "name": "rank",
            "type": "u32"
          },
          {
            "name": "prizeAmount",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "refundedAmount",
            "type": "u64"
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
      "name": "dailyPrizeForfeited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dayId",
            "type": "u32"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "rewardVault",
            "type": "pubkey"
          },
          {
            "name": "closedAt",
            "type": "i64"
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
      "name": "governanceAction",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "setPendingAuthority",
            "fields": [
              {
                "name": "newAuthority",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "setPaymasterPolicy",
            "fields": [
              {
                "name": "paymaster",
                "type": "pubkey"
              },
              {
                "name": "dailyTransactionLimit",
                "type": "u16"
              },
              {
                "name": "dailyPaidAttemptLimit",
                "type": "u16"
              },
              {
                "name": "paymasterCap",
                "type": "u64"
              }
            ]
          },
          {
            "name": "configureYieldStrategy",
            "fields": [
              {
                "name": "strategyVersion",
                "type": "u32"
              },
              {
                "name": "adapterProgram",
                "type": "pubkey"
              },
              {
                "name": "market",
                "type": "pubkey"
              },
              {
                "name": "reserve",
                "type": "pubkey"
              },
              {
                "name": "receiptMint",
                "type": "pubkey"
              },
              {
                "name": "maxPrincipal",
                "type": "u64"
              },
              {
                "name": "maxExposureBps",
                "type": "u16"
              },
              {
                "name": "minLiquidReserveBps",
                "type": "u16"
              },
              {
                "name": "maxSlippageBps",
                "type": "u16"
              },
              {
                "name": "maxLossBps",
                "type": "u16"
              }
            ]
          },
          {
            "name": "setYieldStrategyStatus",
            "fields": [
              {
                "name": "depositsEnabled",
                "type": "bool"
              },
              {
                "name": "emergencyExit",
                "type": "bool"
              }
            ]
          },
          {
            "name": "setYieldAllocation",
            "fields": [
              {
                "name": "rewardBps",
                "type": "u16"
              }
            ]
          },
          {
            "name": "setRevenueAllocation",
            "fields": [
              {
                "name": "rewardBps",
                "type": "u16"
              }
            ]
          },
          {
            "name": "setContentVersion",
            "fields": [
              {
                "name": "contentVersion",
                "type": "u32"
              }
            ]
          },
          {
            "name": "setProgressVersion",
            "fields": [
              {
                "name": "progressVersion",
                "type": "u32"
              }
            ]
          },
          {
            "name": "setGovernanceTiming",
            "fields": [
              {
                "name": "delaySeconds",
                "type": "u32"
              },
              {
                "name": "executionWindowSeconds",
                "type": "u32"
              }
            ]
          },
          {
            "name": "unpause"
          }
        ]
      }
    },
    {
      "name": "governanceProposal",
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
            "name": "proposalId",
            "type": "u64"
          },
          {
            "name": "proposer",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": {
              "defined": {
                "name": "governanceAction"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "executeAfter",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "executedAt",
            "type": "i64"
          },
          {
            "name": "cancelledAt",
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
      "name": "governanceProposalCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "proposal",
            "type": "pubkey"
          },
          {
            "name": "proposalId",
            "type": "u64"
          },
          {
            "name": "cancelledAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "governanceProposalCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "proposal",
            "type": "pubkey"
          },
          {
            "name": "proposalId",
            "type": "u64"
          },
          {
            "name": "proposer",
            "type": "pubkey"
          },
          {
            "name": "executeAfter",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "governanceProposalExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "proposal",
            "type": "pubkey"
          },
          {
            "name": "proposalId",
            "type": "u64"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "executedAt",
            "type": "i64"
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
            "name": "teamVault",
            "type": "pubkey"
          },
          {
            "name": "paymasterVault",
            "type": "pubkey"
          },
          {
            "name": "treasuryVault",
            "type": "pubkey"
          },
          {
            "name": "rewardVault",
            "type": "pubkey"
          },
          {
            "name": "paymasterCap",
            "type": "u64"
          },
          {
            "name": "revenueRewardBps",
            "type": "u16"
          },
          {
            "name": "sponsorshipDailyTxLimit",
            "type": "u16"
          },
          {
            "name": "sponsorshipDailyPaidAttemptLimit",
            "type": "u16"
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
            "name": "contentVersion",
            "type": "u32"
          },
          {
            "name": "governanceDelaySeconds",
            "type": "u32"
          },
          {
            "name": "governanceExecutionWindowSeconds",
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
            "name": "starUnlockCost",
            "type": "u64"
          },
          {
            "name": "usdcUnlockCost",
            "type": "u64"
          },
          {
            "name": "levels",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "levelRuleSnapshot"
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
      "name": "progressCatalog",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "progressVersion",
            "type": "u32"
          },
          {
            "name": "achievementCount",
            "type": "u8"
          },
          {
            "name": "questCount",
            "type": "u8"
          },
          {
            "name": "achievements",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "achievementRule"
                  }
                },
                24
              ]
            }
          },
          {
            "name": "quests",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "questRule"
                  }
                },
                12
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
      "name": "progressCatalogPublishedV1",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "progressCatalog",
            "type": "pubkey"
          },
          {
            "name": "progressVersion",
            "type": "u32"
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "activated",
            "type": "bool"
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
            "name": "paymaster",
            "type": "pubkey"
          },
          {
            "name": "teamVault",
            "type": "pubkey"
          },
          {
            "name": "paymasterVault",
            "type": "pubkey"
          },
          {
            "name": "treasuryVault",
            "type": "pubkey"
          },
          {
            "name": "rewardVault",
            "type": "pubkey"
          },
          {
            "name": "paymasterCap",
            "type": "u64"
          },
          {
            "name": "revenueRewardBps",
            "type": "u16"
          },
          {
            "name": "sponsorshipDailyTxLimit",
            "type": "u16"
          },
          {
            "name": "sponsorshipDailyPaidAttemptLimit",
            "type": "u16"
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
            "name": "yieldPolicy",
            "type": "pubkey"
          },
          {
            "name": "treasuryLedger",
            "type": "pubkey"
          },
          {
            "name": "contentVersion",
            "type": "u32"
          },
          {
            "name": "progressVersion",
            "type": "u32"
          },
          {
            "name": "governanceDelaySeconds",
            "type": "u32"
          },
          {
            "name": "governanceExecutionWindowSeconds",
            "type": "u32"
          },
          {
            "name": "nextGovernanceProposalId",
            "type": "u64"
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
      "name": "protocolRevenueSwept",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "treasury",
            "type": "u64"
          },
          {
            "name": "rewards",
            "type": "u64"
          },
          {
            "name": "caller",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "questClaimedV1",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "progressVersion",
            "type": "u32"
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
            "name": "starReward",
            "type": "u64"
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
            "name": "progressVersion",
            "type": "u32"
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
      "name": "questRule",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "metric",
            "type": "u8"
          },
          {
            "name": "cadence",
            "docs": [
              "0=daily, 1=weekly."
            ],
            "type": "u8"
          },
          {
            "name": "rotationModulus",
            "type": "u8"
          },
          {
            "name": "rotationRemainder",
            "type": "u8"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "threshold",
            "type": "u32"
          },
          {
            "name": "starReward",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "realizedYieldAllocated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "treasury",
            "type": "u64"
          },
          {
            "name": "rewards",
            "type": "u64"
          },
          {
            "name": "caller",
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
      "name": "sponsorAllowance",
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
            "name": "cadenceDay",
            "type": "u32"
          },
          {
            "name": "sponsoredTransactions",
            "type": "u16"
          },
          {
            "name": "paidDailyAttempts",
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
      "name": "sponsorshipConsumed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "cadenceDay",
            "type": "u32"
          },
          {
            "name": "sponsoredTransactions",
            "type": "u16"
          },
          {
            "name": "paidDailyAttempts",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "treasuryLedger",
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
            "name": "lifetimeRakeReceived",
            "type": "u64"
          },
          {
            "name": "lifetimeTeamDistributed",
            "type": "u64"
          },
          {
            "name": "lifetimePaymasterDistributed",
            "type": "u64"
          },
          {
            "name": "lifetimeTreasuryDistributed",
            "type": "u64"
          },
          {
            "name": "lifetimePrizesForfeitedToRewards",
            "type": "u64"
          },
          {
            "name": "lifetimeMapSales",
            "type": "u64"
          },
          {
            "name": "lifetimeRevenueSwept",
            "type": "u64"
          },
          {
            "name": "lifetimeRevenueToTreasury",
            "type": "u64"
          },
          {
            "name": "lifetimeRevenueToRewards",
            "type": "u64"
          },
          {
            "name": "realizedYield",
            "type": "u64"
          },
          {
            "name": "yieldAllocatedToRewards",
            "type": "u64"
          },
          {
            "name": "yieldRetainedInTreasury",
            "type": "u64"
          },
          {
            "name": "lifetimeStrategyDeposited",
            "type": "u64"
          },
          {
            "name": "lifetimeStrategyPrincipalRepaid",
            "type": "u64"
          },
          {
            "name": "strategyPrincipal",
            "type": "u64"
          },
          {
            "name": "realizedStrategyLosses",
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
            "name": "starUnlockCost",
            "type": "u64"
          },
          {
            "name": "usdcUnlockCost",
            "type": "u64"
          },
          {
            "name": "levels",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "levelRuleSnapshot"
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
      "name": "writeProgressCatalogArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "progressVersion",
            "type": "u32"
          },
          {
            "name": "achievementCount",
            "type": "u8"
          },
          {
            "name": "questCount",
            "type": "u8"
          },
          {
            "name": "achievements",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "achievementRule"
                  }
                },
                24
              ]
            }
          },
          {
            "name": "quests",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "questRule"
                  }
                },
                12
              ]
            }
          }
        ]
      }
    },
    {
      "name": "yieldStrategyEmergencyPaused",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "yieldPolicy",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "yieldStrategyPolicy",
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
            "name": "strategyVersion",
            "type": "u32"
          },
          {
            "name": "adapterProgram",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "reserve",
            "type": "pubkey"
          },
          {
            "name": "receiptMint",
            "type": "pubkey"
          },
          {
            "name": "maxPrincipal",
            "type": "u64"
          },
          {
            "name": "maxExposureBps",
            "type": "u16"
          },
          {
            "name": "minLiquidReserveBps",
            "type": "u16"
          },
          {
            "name": "maxSlippageBps",
            "type": "u16"
          },
          {
            "name": "maxLossBps",
            "type": "u16"
          },
          {
            "name": "yieldRewardBps",
            "type": "u16"
          },
          {
            "name": "depositsEnabled",
            "type": "bool"
          },
          {
            "name": "emergencyExit",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
