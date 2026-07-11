use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::ErrorCode;
use crate::state::v2::*;

#[derive(Accounts)]
pub struct UnlockMapWithStarsV1<'info> {
    #[account(
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner.key().as_ref()],
        bump = player_profile.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        mut,
        seeds = [CAMPAIGN_PROGRESS_SEED, owner.key().as_ref()],
        bump = campaign_progress.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub campaign_progress: Box<Account<'info, CampaignProgress>>,
    #[account(
        seeds = [
            MAP_CATALOG_SEED,
            protocol.content_version.to_le_bytes().as_ref(),
            &[map_catalog.map_id]
        ],
        bump = map_catalog.bump,
        constraint = map_catalog.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = map_catalog.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch,
        constraint = map_catalog.enabled @ ErrorCode::MapDisabled
    )]
    pub map_catalog: Box<Account<'info, MapCatalog>>,
    pub owner: Signer<'info>,
}

pub fn handler_unlock_map_with_stars_v1(ctx: Context<UnlockMapWithStarsV1>) -> Result<()> {
    let map_id = ctx.accounts.map_catalog.map_id;
    let cost = ctx.accounts.map_catalog.star_unlock_cost;
    validate_map_unlock(&ctx.accounts.campaign_progress, map_id, cost)?;
    ctx.accounts.player_profile.spend_stars(cost)?;
    ctx.accounts.campaign_progress.unlock_map(map_id, false)
}

#[derive(Accounts)]
pub struct PurchaseMapWithUsdcV1<'info> {
    #[account(
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        address = protocol.treasury_ledger,
        seeds = [TREASURY_LEDGER_SEED],
        bump = treasury_ledger.bump,
        constraint = treasury_ledger.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = treasury_ledger.payment_mint == protocol.payment_mint @ ErrorCode::InvalidOwner
    )]
    pub treasury_ledger: Box<Account<'info, TreasuryLedger>>,
    #[account(
        mut,
        seeds = [CAMPAIGN_PROGRESS_SEED, owner.key().as_ref()],
        bump = campaign_progress.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub campaign_progress: Box<Account<'info, CampaignProgress>>,
    #[account(
        seeds = [
            MAP_CATALOG_SEED,
            protocol.content_version.to_le_bytes().as_ref(),
            &[map_catalog.map_id]
        ],
        bump = map_catalog.bump,
        constraint = map_catalog.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = map_catalog.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch,
        constraint = map_catalog.enabled @ ErrorCode::MapDisabled
    )]
    pub map_catalog: Box<Account<'info, MapCatalog>>,
    #[account(address = protocol.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = owner,
        token::token_program = payment_token_program
    )]
    pub player_payment_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = protocol.payment_vault,
        token::mint = payment_mint,
        token::authority = protocol,
        token::token_program = payment_token_program
    )]
    pub payment_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = protocol.payment_token_program)]
    pub payment_token_program: Interface<'info, TokenInterface>,
    pub owner: Signer<'info>,
}

pub fn handler_purchase_map_with_usdc_v1(ctx: Context<PurchaseMapWithUsdcV1>) -> Result<()> {
    let map_id = ctx.accounts.map_catalog.map_id;
    let amount = ctx.accounts.map_catalog.usdc_unlock_cost;
    validate_map_unlock(&ctx.accounts.campaign_progress, map_id, amount)?;
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.payment_token_program.key(),
            TransferChecked {
                from: ctx.accounts.player_payment_account.to_account_info(),
                mint: ctx.accounts.payment_mint.to_account_info(),
                to: ctx.accounts.payment_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.payment_mint.decimals,
    )?;
    ctx.accounts.treasury_ledger.record_map_sale(amount)?;
    ctx.accounts.campaign_progress.unlock_map(map_id, true)
}

fn validate_map_unlock(progress: &CampaignProgress, map_id: u8, cost: u64) -> Result<()> {
    require!(map_id > 1, ErrorCode::InvalidMap);
    require!(
        !progress.is_map_unlocked(map_id),
        ErrorCode::MapAlreadyUnlocked
    );
    require!(cost > 0, ErrorCode::InvalidMap);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_unlock_payment_paths_reject_free_duplicate_or_map_one_unlocks() {
        let owner = Pubkey::new_unique();
        let mut progress = CampaignProgress::initialize(owner, 1);
        assert!(validate_map_unlock(&progress, 2, 40).is_ok());
        assert!(validate_map_unlock(&progress, 1, 40).is_err());
        assert!(validate_map_unlock(&progress, 2, 0).is_err());
        progress.unlock_map(2, false).unwrap();
        assert!(validate_map_unlock(&progress, 2, 40).is_err());
    }
}
