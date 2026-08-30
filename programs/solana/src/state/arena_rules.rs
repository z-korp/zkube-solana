//! Protocol-fixed Daily content and pressure snapshots.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::arcade::SolanaSha256;

pub const DAILY_MAX_MOVES: u16 = zkube_core::DAILY_MAX_MOVES;

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
                .ok_or(error!(ErrorCode::InvalidLevel))?,
            value: self.value,
        };
        require!(
            zkube_core::DAILY_THEMES.contains(&theme),
            ErrorCode::InvalidLevel
        );
        Ok(theme)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub struct DailyPressureProfile {
    pub max_moves: u16,
}

impl Default for DailyPressureProfile {
    fn default() -> Self {
        Self::canonical()
    }
}

impl DailyPressureProfile {
    pub const fn canonical() -> Self {
        Self {
            max_moves: DAILY_MAX_MOVES,
        }
    }

    pub fn validate(self) -> Result<()> {
        require!(self.max_moves == DAILY_MAX_MOVES, ErrorCode::InvalidLevel);
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailyContentSelection {
    pub realm_map_id: u8,
    pub objective: DailyThemeSnapshot,
    pub pressure: DailyPressureProfile,
}

#[must_use]
pub fn daily_content_for_day(day_id: u32) -> DailyContentSelection {
    let (realm_map_id, objective) = zkube_core::daily_pair_with::<SolanaSha256>(day_id);
    DailyContentSelection {
        realm_map_id,
        objective: DailyThemeSnapshot::from_core(objective),
        pressure: DailyPressureProfile::canonical(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_draw_is_reproducible_from_seed_and_day() {
        let first_day = 160 * 200;
        let selections = (first_day..first_day + 160)
            .map(daily_content_for_day)
            .collect::<std::vec::Vec<_>>();
        for realm in 1..=10 {
            for objective in zkube_core::DAILY_THEMES {
                let snapshot = DailyThemeSnapshot::from_core(objective);
                assert_eq!(
                    selections
                        .iter()
                        .filter(|selection| {
                            selection.realm_map_id == realm && selection.objective == snapshot
                        })
                        .count(),
                    1
                );
            }
        }
    }
}
