use anchor_lang::prelude::*;

use crate::{
    error::EscrowError,
    state::{Registry, Vault},
};

/// Opens a badge's escrow vault. Called by the server the first time a badge
/// announces itself at any sync station.
///
/// The registry authority is also the rent payer: the badge server is the only
/// party that opens vaults, so a separate payer account would just be the same
/// key passed twice.
#[derive(Accounts)]
#[instruction(badge_hash: [u8; 32], animal_code: u32)]
pub struct CreateVault {
    #[account(mut, seeds = [b"registry"], bump = registry.bump)]
    pub registry: Account<Registry>,
    #[account(mut, address = registry.authority @ EscrowError::NotAuthority)]
    pub authority: Signer,
    #[account(init, payer = authority, seeds = [b"vault", badge_hash.as_ref()], bump)]
    pub vault: Account<Vault>,
    pub system_program: Program<System>,
}

pub fn handler(
    ctx: &mut Context<CreateVault>,
    badge_hash: [u8; 32],
    animal_code: u32,
) -> Result<()> {
    let bump = ctx.bumps.vault;
    let vault = &mut ctx.accounts.vault;
    vault.badge_hash = badge_hash;
    vault.owner = crate::constants::UNCLAIMED;
    vault.animal_code = animal_code;
    vault.item_count = 0;
    vault.claimed_at = 0;
    vault.bump = bump;

    ctx.accounts.registry.vault_count += 1;
    Ok(())
}
