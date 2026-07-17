//! Optional public player names and their global uniqueness claims.

use anchor_lang::prelude::*;

pub const IDENTITY_ACCOUNT_VERSION: u8 = 1;
pub const PLAYER_IDENTITY_SEED: &[u8] = b"identity";
pub const USERNAME_CLAIM_SEED: &[u8] = b"username";
pub const USERNAME_MIN_LEN: usize = 3;
pub const USERNAME_MAX_LEN: usize = 16;
pub const USERNAME_RENAME_COOLDOWN_SECONDS: i64 = 30 * 86_400;
pub const USERNAME_RENAME_STARS: u64 = 100;
pub const USERNAME_STATUS_ACTIVE: u8 = 0;
pub const USERNAME_STATUS_BLOCKED: u8 = 1;

#[account]
#[derive(InitSpace)]
pub struct PlayerIdentity {
    pub version: u8,
    pub owner: Pubkey,
    pub display_name: [u8; USERNAME_MAX_LEN],
    pub normalized_name: [u8; USERNAME_MAX_LEN],
    pub name_len: u8,
    pub rename_count: u16,
    pub registered_at: i64,
    pub last_renamed_at: i64,
    pub moderated: bool,
    pub moderation_reason: u8,
    pub bump: u8,
}

impl PlayerIdentity {
    pub fn normalized(&self) -> Option<&[u8]> {
        self.normalized_name.get(..usize::from(self.name_len))
    }
}

#[account]
#[derive(InitSpace)]
pub struct UsernameClaim {
    pub version: u8,
    pub owner: Pubkey,
    pub player_identity: Pubkey,
    pub normalized_name: [u8; USERNAME_MAX_LEN],
    pub name_len: u8,
    pub status: u8,
    pub bump: u8,
}

impl UsernameClaim {
    pub fn normalized(&self) -> Option<&[u8]> {
        self.normalized_name.get(..usize::from(self.name_len))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_accounts_remain_small_and_fixed_width() {
        assert_eq!(8 + PlayerIdentity::INIT_SPACE, 95);
        assert_eq!(8 + UsernameClaim::INIT_SPACE, 92);
    }
}
