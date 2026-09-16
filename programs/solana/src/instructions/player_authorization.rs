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
    require!(session.valid_until > now, ErrorCode::InvalidSession);

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
    fn generated_arena_entry_metas_allow_a_scoped_device_without_owner_signature() {
        let owner = Pubkey::new_unique();
        let actor = Pubkey::new_unique();
        let entry = crate::accounts::EnterArena {
            protocol: Pubkey::new_unique(),
            player_state: Pubkey::new_unique(),
            current_daily: Pubkey::new_unique(),
            arena_player: Pubkey::new_unique(),
            following_daily: Pubkey::new_unique(),
            credit_vault: Pubkey::new_unique(),
            active_run: Pubkey::new_unique(),
            payer: actor,
            owner_authority: owner,
            session_token: Some(token_address(owner, actor)),
            actor,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None);
        assert_eq!(entry.len(), 12);
        assert_eq!(entry[8].pubkey, owner);
        assert!(entry[8].is_writable);
        assert!(!entry[8].is_signer);
        assert_eq!(entry[10].pubkey, actor);
        assert!(entry[10].is_signer);
    }

    #[test]
    fn generated_kredit_purchase_metas_require_the_owner_signature() {
        let owner = Pubkey::new_unique();
        let purchase = crate::accounts::PurchaseKredits {
            protocol: Pubkey::new_unique(),
            player_state: Pubkey::new_unique(),
            credit_vault: Pubkey::new_unique(),
            team_destination: Pubkey::new_unique(),
            owner,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None);
        assert_eq!(purchase[4].pubkey, owner);
        assert!(purchase[4].is_signer);
    }
    #[test]
    fn sbf_featured_emblem_accepts_owner_and_only_unlocked_campaign_badges() {
        use crate::state::*;
        let owner = Pubkey::new_unique();
        require_authorization_fields(owner, owner, None, 0).unwrap();
        assert!(require_authorization_fields(owner, Pubkey::new_unique(), None, 0).is_err());
        let mut player = PlayerState::initialize(owner, 1);
        assert!(player.emblem_unlocked(EMBLEM_AUTO));
        assert!(!player.emblem_unlocked(EMBLEM_FIRST_GUARDIAN));
        assert!(!player.emblem_unlocked(EMBLEM_REALM_CONQUEROR));
        assert!(!player.emblem_unlocked(EMBLEM_WORLD_PERFECT));
        player.merge_campaign_stars([u8::MAX; CAMPAIGN_STAR_BYTES]);
        assert!(player.emblem_unlocked(10));
        assert!(player.emblem_unlocked(EMBLEM_REALM_CONQUEROR));
        assert!(player.emblem_unlocked(EMBLEM_WORLD_PERFECT));
        assert!(!player.emblem_unlocked(13));
    }
}
