use bolt_lang::prelude::*;

declare_id!("GQgt5epvsXjGhAXk9KHTh7hPNoZtKRmdrQsf1T7wfDzJ");

#[program]
pub mod zkube_solana {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
