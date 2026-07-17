//! Optional cosmetic labels keyed exclusively by the durable wallet owner.

use anchor_lang::prelude::*;

pub const PLAYER_LABEL_ACCOUNT_VERSION: u8 = 1;
pub const PLAYER_LABEL_SEED: &[u8] = b"label";
pub const PLAYER_LABEL_MIN_LEN: usize = 3;
pub const PLAYER_LABEL_MAX_LEN: usize = 16;

#[account]
#[derive(InitSpace)]
pub struct PlayerLabel {
    pub version: u8,
    pub owner: Pubkey,
    pub display_name: [u8; PLAYER_LABEL_MAX_LEN],
    pub name_len: u8,
    pub bump: u8,
}

impl PlayerLabel {
    pub fn display_name(&self) -> Option<&[u8]> {
        self.display_name.get(..usize::from(self.name_len))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_label_is_one_small_fixed_width_account() {
        assert_eq!(8 + PlayerLabel::INIT_SPACE, 59);
    }
}
