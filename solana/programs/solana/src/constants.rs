// ─────────────────────────────────────────────────────────────────────────────
// zKube — Constantes on-chain centralisées
//
// Pour modifier une adresse : changer uniquement ce fichier, puis rebuilder
// et redéployer (`anchor build && anchor deploy --provider.cluster devnet`).
//
// Les valeurs de déploiement sont aussi documentées dans solana/.env
// ─────────────────────────────────────────────────────────────────────────────

/// Oracle queue VRF MagicBlock (devnet)
/// Programme VRF associé : Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz
pub const ORACLE_QUEUE: &str = "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh";

/// Validator Ephemeral Rollup MagicBlock EU (devnet)
/// Endpoint ER associé : https://devnet-eu.magicblock.app
pub const ER_VALIDATOR: &str = "MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e";
