use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::v2::PROTOCOL_CONFIG_SEED;

/// Exact size of the pre-Stars `ProtocolConfig`, including its discriminator.
/// The reset path deliberately becomes unreachable as soon as the lean protocol
/// is initialized because that account has a different size.
const LEGACY_PROTOCOL_ACCOUNT_BYTES: usize = 433;
const LEGACY_PROTOCOL_DISCRIMINATOR: [u8; 8] = [207, 91, 250, 28, 152, 179, 215, 209];
const LEGACY_AUTHORITY_OFFSET: usize = 9;
const LEGACY_PAYMASTER_OFFSET: usize = 73;
const MAX_RESET_ACCOUNTS_PER_CALL: usize = 16;

#[derive(Accounts)]
pub struct ResetLegacyDevnetState<'info> {
    /// CHECK: this is intentionally decoded as the exact legacy byte layout.
    #[account(mut, seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub legacy_protocol: UncheckedAccount<'info>,
    /// CHECK: constrained to the paymaster recorded in the legacy protocol.
    #[account(mut)]
    pub rent_recipient: UncheckedAccount<'info>,
    pub legacy_authority: Signer<'info>,
}

/// Removes one bounded batch of incompatible legacy Devnet accounts.
///
/// This is a one-release reset bridge, not a migration path. It is gated by
/// the exact 433-byte legacy protocol layout and its recorded authority and
/// paymaster. Every remaining account must be writable and owned by this
/// program. Closing the legacy protocol disables the instruction permanently.
pub fn handler_reset_legacy_devnet_state(
    ctx: Context<ResetLegacyDevnetState>,
    close_protocol: bool,
) -> Result<()> {
    let (authority, paymaster) =
        legacy_protocol_identities(&ctx.accounts.legacy_protocol.to_account_info())?;
    require_keys_eq!(
        authority,
        ctx.accounts.legacy_authority.key(),
        ErrorCode::Unauthorized
    );
    require_keys_eq!(
        paymaster,
        ctx.accounts.rent_recipient.key(),
        ErrorCode::InvalidOwner
    );
    require!(
        ctx.remaining_accounts.len() <= MAX_RESET_ACCOUNTS_PER_CALL,
        ErrorCode::InvalidState
    );
    require!(
        close_protocol || !ctx.remaining_accounts.is_empty(),
        ErrorCode::InvalidState
    );

    let protocol_key = ctx.accounts.legacy_protocol.key();
    let recipient_key = ctx.accounts.rent_recipient.key();
    let mut reclaimed_lamports = 0u64;
    for account in ctx.remaining_accounts {
        require_keys_neq!(account.key(), protocol_key, ErrorCode::InvalidOwner);
        require_keys_neq!(account.key(), recipient_key, ErrorCode::InvalidOwner);
        reclaimed_lamports = reclaimed_lamports
            .checked_add(close_program_account(
                account,
                &ctx.accounts.rent_recipient.to_account_info(),
            )?)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    if close_protocol {
        reclaimed_lamports = reclaimed_lamports
            .checked_add(close_program_account(
                &ctx.accounts.legacy_protocol.to_account_info(),
                &ctx.accounts.rent_recipient.to_account_info(),
            )?)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }

    emit!(LegacyDevnetStateReset {
        account_count: u16::try_from(ctx.remaining_accounts.len())
            .map_err(|_| ErrorCode::ArithmeticOverflow)?
            .checked_add(u16::from(close_protocol))
            .ok_or(ErrorCode::ArithmeticOverflow)?,
        reclaimed_lamports,
        protocol_closed: close_protocol,
    });
    Ok(())
}

fn legacy_protocol_identities(protocol: &AccountInfo<'_>) -> Result<(Pubkey, Pubkey)> {
    require_keys_eq!(*protocol.owner, crate::ID, ErrorCode::InvalidOwner);
    let data = protocol.try_borrow_data()?;
    require!(
        data.len() == LEGACY_PROTOCOL_ACCOUNT_BYTES,
        ErrorCode::InvalidVersion
    );
    require!(
        data[..8] == LEGACY_PROTOCOL_DISCRIMINATOR,
        ErrorCode::InvalidVersion
    );
    require!(data[8] == 1, ErrorCode::InvalidVersion);
    Ok((
        pubkey_at(&data, LEGACY_AUTHORITY_OFFSET)?,
        pubkey_at(&data, LEGACY_PAYMASTER_OFFSET)?,
    ))
}

fn pubkey_at(data: &[u8], offset: usize) -> Result<Pubkey> {
    let bytes: [u8; 32] = data
        .get(offset..offset + 32)
        .ok_or(ErrorCode::InvalidVersion)?
        .try_into()
        .map_err(|_| ErrorCode::InvalidVersion)?;
    Ok(Pubkey::new_from_array(bytes))
}

fn close_program_account(account: &AccountInfo<'_>, destination: &AccountInfo<'_>) -> Result<u64> {
    require!(account.is_writable, ErrorCode::InvalidState);
    require_keys_eq!(*account.owner, crate::ID, ErrorCode::InvalidOwner);
    let lamports = account.lamports();
    let destination_lamports = destination
        .lamports()
        .checked_add(lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    **destination.try_borrow_mut_lamports()? = destination_lamports;
    **account.try_borrow_mut_lamports()? = 0;
    account.assign(&anchor_lang::system_program::ID);
    account.resize(0)?;
    Ok(lamports)
}

#[event]
pub struct LegacyDevnetStateReset {
    pub account_count: u16,
    pub reclaimed_lamports: u64,
    pub protocol_closed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_offsets_decode_the_expected_identities() {
        let authority = Pubkey::new_unique();
        let paymaster = Pubkey::new_unique();
        let mut data = vec![0u8; LEGACY_PROTOCOL_ACCOUNT_BYTES];
        data[..8].copy_from_slice(&LEGACY_PROTOCOL_DISCRIMINATOR);
        data[8] = 1;
        data[LEGACY_AUTHORITY_OFFSET..LEGACY_AUTHORITY_OFFSET + 32]
            .copy_from_slice(authority.as_ref());
        data[LEGACY_PAYMASTER_OFFSET..LEGACY_PAYMASTER_OFFSET + 32]
            .copy_from_slice(paymaster.as_ref());
        assert_eq!(
            pubkey_at(&data, LEGACY_AUTHORITY_OFFSET).unwrap(),
            authority
        );
        assert_eq!(
            pubkey_at(&data, LEGACY_PAYMASTER_OFFSET).unwrap(),
            paymaster
        );
    }
}
