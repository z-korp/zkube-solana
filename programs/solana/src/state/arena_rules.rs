//! Protocol-fixed Daily content selection and active-run objective snapshots.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
#[cfg(test)]
use crate::state::arcade::SolanaSha256;

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct DailyThemeSnapshot {
    pub kind: u8,
    pub value: u8,
}

impl DailyThemeSnapshot {
    #[must_use]
    pub const fn from_core(theme: zkube_core::DailyTheme) -> Self {
        Self {
            kind: theme.kind.tag(),
            value: theme.value,
        }
    }

    pub fn to_core(self) -> Result<zkube_core::DailyTheme> {
        let theme = zkube_core::DailyTheme {
            kind: zkube_core::ConstraintKind::from_tag(self.kind)
                .ok_or(error!(ErrorCode::InvalidState))?,
            value: self.value,
        };
        require!(
            zkube_core::DAILY_THEMES.contains(&theme),
            ErrorCode::InvalidState
        );
        Ok(theme)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_draw_is_reproducible_from_seed_and_day() {
        let first_day = 160 * 200;
        let selections = (first_day..first_day + 160)
            .map(zkube_core::daily_pair_with::<SolanaSha256>)
            .collect::<std::vec::Vec<_>>();
        for realm in 1..=10 {
            for objective in zkube_core::DAILY_THEMES {
                let snapshot = objective;
                assert_eq!(
                    selections
                        .iter()
                        .filter(|selection| { selection.0 == realm && selection.1 == snapshot })
                        .count(),
                    1
                );
            }
        }
    }
}
