use anchor_lang::prelude::*;

use crate::state::Registry;

/// Creates the singleton registry, pinning the server key that is allowed to
/// create vaults and mint items. Whoever calls this first owns the activation.
#[derive(Accounts)]
pub struct InitializeRegistry {
    #[account(mut)]
    pub payer: Signer,
    #[account(init, payer = payer, seeds = [b"registry"], bump)]
    pub registry: Account<Registry>,
    pub system_program: Program<System>,
}

pub fn handler(ctx: &mut Context<InitializeRegistry>) -> Result<()> {
    let bump = ctx.bumps.registry;
    let authority = *ctx.accounts.payer.address();
    let registry = &mut ctx.accounts.registry;
    registry.authority = authority;
    registry.vault_count = 0;
    registry.bump = bump;
    Ok(())
}
