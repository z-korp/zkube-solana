use anchor_lang::prelude::*;
use session_keys::SessionTokenV2;

use crate::error::ErrorCode;
use crate::state::PLAYER_FUNDING_SEED;

/// The common authorization boundary for owner-controlled, non-custodial
/// player actions. The owner address remains the durable identity; `actor`
/// may be that owner or a locally generated device session signer.
pub fn require_player_authorization(
    owner_authority: Pubkey,
    actor: Pubkey,
    session_token: Option<&Account<'_, SessionTokenV2>>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_authorization_fields(
        owner_authority,
        actor,
        session_token.map(|token| SessionFields {
            address: token.key(),
            authority: token.authority,
            actor: token.session_signer,
            target: token.target_program,
            fee_payer: token.fee_payer,
            valid_until: token.valid_until,
        }),
        now,
    )
}

/// Rent may be paid directly by the owner/actor or by the owner's canonical
/// zero-data System PDA. No unrelated signer may be substituted as a sponsor.
pub fn require_player_rent_payer(owner: Pubkey, actor: Pubkey, payer: Pubkey) -> Result<()> {
    let funding =
        Pubkey::find_program_address(&[PLAYER_FUNDING_SEED, owner.as_ref()], &crate::ID).0;
    require!(
        payer == owner || payer == actor || payer == funding,
        ErrorCode::InvalidOwner
    );
    Ok(())
}

#[derive(Clone, Copy)]
struct SessionFields {
    address: Pubkey,
    authority: Pubkey,
    actor: Pubkey,
    target: Pubkey,
    fee_payer: Pubkey,
    valid_until: i64,
}

fn require_authorization_fields(
    owner_authority: Pubkey,
    actor: Pubkey,
    session: Option<SessionFields>,
    now: i64,
) -> Result<()> {
    if actor == owner_authority {
        require!(session.is_none(), ErrorCode::InvalidSession);
        return Ok(());
    }

    let session = session.ok_or(ErrorCode::InvalidSession)?;
    require!(
        session.authority == owner_authority
            && session.actor == actor
            && session.target == crate::ID
            && session.fee_payer == owner_authority,
        ErrorCode::InvalidSession
    );
    require!(session.valid_until > now, ErrorCode::SessionExpired);

    let expected = Pubkey::find_program_address(
        &[
            SessionTokenV2::SEED_PREFIX.as_bytes(),
            crate::ID.as_ref(),
            actor.as_ref(),
            owner_authority.as_ref(),
        ],
        &session_keys::ID,
    )
    .0;
    require!(session.address == expected, ErrorCode::InvalidSession);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::ToAccountMetas;

    fn token_address(owner: Pubkey, actor: Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[
                SessionTokenV2::SEED_PREFIX.as_bytes(),
                crate::ID.as_ref(),
                actor.as_ref(),
                owner.as_ref(),
            ],
            &session_keys::ID,
        )
        .0
    }

    fn fields(owner: Pubkey, actor: Pubkey) -> SessionFields {
        SessionFields {
            address: token_address(owner, actor),
            authority: owner,
            actor,
            target: crate::ID,
            fee_payer: owner,
            valid_until: 11,
        }
    }

    #[test]
    fn direct_owner_authorization_succeeds_without_a_token() {
        let owner = Pubkey::new_unique();
        assert!(require_authorization_fields(owner, owner, None, 10).is_ok());
        assert!(
            require_authorization_fields(owner, owner, Some(fields(owner, owner)), 10).is_err()
        );
    }

    #[test]
    fn valid_session_authorization_succeeds() {
        let owner = Pubkey::new_unique();
        let actor = Pubkey::new_unique();
        assert!(require_authorization_fields(owner, actor, Some(fields(owner, actor)), 10).is_ok());
    }

    #[test]
    fn invalid_session_relationships_fail() {
        let owner = Pubkey::new_unique();
        let actor = Pubkey::new_unique();
        let attacker = Pubkey::new_unique();
        let valid = fields(owner, actor);
        let cases = [
            SessionFields {
                authority: attacker,
                ..valid
            },
            SessionFields {
                actor: attacker,
                ..valid
            },
            SessionFields {
                target: Pubkey::new_unique(),
                ..valid
            },
            SessionFields {
                valid_until: 10,
                ..valid
            },
            SessionFields {
                address: Pubkey::new_unique(),
                ..valid
            },
        ];
        for session in cases {
            assert!(require_authorization_fields(owner, actor, Some(session), 10).is_err());
        }
    }

    #[test]
    fn cross_payer_session_authorization_fails() {
        let owner = Pubkey::new_unique();
        let actor = Pubkey::new_unique();
        let third_party_payer = Pubkey::new_unique();
        assert!(require_authorization_fields(
            owner,
            actor,
            Some(SessionFields {
                fee_payer: third_party_payer,
                ..fields(owner, actor)
            }),
            10,
        )
        .is_err());
    }

    #[test]
    fn rent_payer_is_owner_actor_or_canonical_funding_only() {
        let owner = Pubkey::new_unique();
        let actor = Pubkey::new_unique();
        let funding =
            Pubkey::find_program_address(&[PLAYER_FUNDING_SEED, owner.as_ref()], &crate::ID).0;
        assert!(require_player_rent_payer(owner, actor, owner).is_ok());
        assert!(require_player_rent_payer(owner, actor, actor).is_ok());
        assert!(require_player_rent_payer(owner, actor, funding).is_ok());
        assert!(require_player_rent_payer(owner, actor, Pubkey::new_unique()).is_err());
    }

    #[test]
    fn funded_delegate_outer_metas_never_make_the_funding_pda_a_signer() {
        let owner = Pubkey::new_unique();
        let actor = Pubkey::new_unique();
        let funding =
            Pubkey::find_program_address(&[PLAYER_FUNDING_SEED, owner.as_ref()], &crate::ID).0;
        let metas = crate::accounts::FundedDelegateActiveRun {
            buffer_pda: Pubkey::new_unique(),
            delegation_record_pda: Pubkey::new_unique(),
            delegation_metadata_pda: Pubkey::new_unique(),
            pda: Pubkey::new_unique(),
            player_funding: funding,
            owner_authority: owner,
            session_token: token_address(owner, actor),
            actor,
            owner_program: crate::ID,
            delegation_program: ephemeral_rollups_sdk::id().to_bytes().into(),
            system_program: system_program::ID,
        }
        .to_account_metas(None);

        assert_eq!(metas.len(), 11);
        assert_eq!(metas[4].pubkey, funding);
        assert!(metas[4].is_writable);
        assert!(!metas[4].is_signer);
        assert_eq!(metas[7].pubkey, actor);
        assert!(metas[7].is_signer);
        assert_eq!(metas[8].pubkey, crate::ID);
        assert!(!metas[8].is_signer);
    }

    #[test]
    fn generated_arena_entry_metas_keep_sol_spending_owner_signed() {
        let owner = Pubkey::new_unique();
        let entry = crate::accounts::EnterArena {
            protocol: Pubkey::new_unique(),
            arcade_config: Pubkey::new_unique(),
            player_state: Pubkey::new_unique(),
            current_daily: Pubkey::new_unique(),
            arena_player: Pubkey::new_unique(),
            current_weekly: Pubkey::new_unique(),
            current_season: Pubkey::new_unique(),
            following_daily: Pubkey::new_unique(),
            following_weekly: Pubkey::new_unique(),
            following_season: Pubkey::new_unique(),
            operator_revenue_vault: Pubkey::new_unique(),
            active_run: Pubkey::new_unique(),
            payer: owner,
            owner,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None);
        assert_eq!(entry.len(), 15);
        assert_eq!(entry[13].pubkey, owner);
        assert!(entry[13].is_signer);
    }
}
