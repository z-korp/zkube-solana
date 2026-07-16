use anchor_lang::prelude::*;
use session_keys::SessionTokenV2;

use crate::error::ErrorCode;

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
    fn generated_account_metas_preserve_the_common_authorization_shape() {
        let owner = Pubkey::new_unique();
        let actor = Pubkey::new_unique();
        let session = token_address(owner, actor);
        let safe = crate::accounts::UnlockZone {
            protocol: Pubkey::new_unique(),
            economy_config: Pubkey::new_unique(),
            player_profile: Pubkey::new_unique(),
            campaign_progress: Pubkey::new_unique(),
            map_catalog: Pubkey::new_unique(),
            owner_authority: owner,
            session_token: Some(session),
            actor,
        }
        .to_account_metas(None);
        assert_eq!(safe.len(), 8);
        assert_eq!(safe[5].pubkey, owner);
        assert!(!safe[5].is_signer);
        assert_eq!(safe[6].pubkey, session);
        assert!(!safe[6].is_signer);
        assert_eq!(safe[7].pubkey, actor);
        assert!(safe[7].is_signer);

        let direct = crate::accounts::UnlockZone {
            protocol: Pubkey::new_unique(),
            economy_config: Pubkey::new_unique(),
            player_profile: Pubkey::new_unique(),
            campaign_progress: Pubkey::new_unique(),
            map_catalog: Pubkey::new_unique(),
            owner_authority: owner,
            session_token: None,
            actor: owner,
        }
        .to_account_metas(None);
        assert_eq!(direct[5].pubkey, owner);
        assert_eq!(direct[6].pubkey, crate::ID);
        assert_eq!(direct[7].pubkey, owner);
        assert!(direct[7].is_signer);
    }

    #[test]
    fn generated_purchase_metas_keep_sol_spending_owner_signed() {
        let owner = Pubkey::new_unique();
        let purchase = crate::accounts::PurchaseStars {
            protocol: Pubkey::new_unique(),
            economy_config: Pubkey::new_unique(),
            star_sales_ledger: Pubkey::new_unique(),
            player_profile: Pubkey::new_unique(),
            team_destination: Pubkey::new_unique(),
            reward_vault: Pubkey::new_unique(),
            treasury_destination: Pubkey::new_unique(),
            owner,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None);
        assert_eq!(purchase.len(), 9);
        assert_eq!(purchase[7].pubkey, owner);
        assert!(purchase[7].is_signer);
    }
}
