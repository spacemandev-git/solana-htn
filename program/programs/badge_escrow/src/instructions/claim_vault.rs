use anchor_lang::prelude::*;

use crate::{
    constants::UNCLAIMED,
    error::EscrowError,
    state::Vault,
};

/// A hacker connects their wallet and takes ownership of their escrow vault.
///
/// Only the wallet itself can do this — the server cannot claim on a hacker's
/// behalf, and a vault can only ever be claimed once.
#[derive(Accounts)]
pub struct ClaimVault {
    #[account(mut)]
    pub owner: Signer,
    #[account(
        mut,
        seeds = [b"vault", vault.badge_hash.as_ref()],
        bump = vault.bump,
        constraint = vault.owner == UNCLAIMED @ EscrowError::VaultAlreadyClaimed,
    )]
    pub vault: Account<Vault>,
}

pub fn handler(ctx: &mut Context<ClaimVault>) -> Result<()> {
    let owner = *ctx.accounts.owner.address();
    let now = Clock::get()?.unix_timestamp;
    let vault = &mut ctx.accounts.vault;
    vault.owner = owner;
    vault.claimed_at = now;
    Ok(())
}
