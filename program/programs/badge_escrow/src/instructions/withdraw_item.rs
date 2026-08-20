use anchor_lang::prelude::*;

use crate::{
    constants::UNCLAIMED,
    error::EscrowError,
    state::{ItemRecord, Vault},
};

/// Moves one item out of program escrow and onto the claiming wallet.
///
/// Requires the vault to have been claimed first, and requires the claiming
/// wallet itself to sign — the server has no path to move a hacker's assets
/// once they have taken ownership.
#[derive(Accounts)]
pub struct WithdrawItem {
    #[account(mut)]
    pub owner: Signer,
    #[account(
        seeds = [b"vault", vault.badge_hash.as_ref()],
        bump = vault.bump,
        constraint = vault.owner != UNCLAIMED @ EscrowError::VaultNotClaimed,
        constraint = vault.owner == *owner.address() @ EscrowError::NotVaultOwner,
    )]
    pub vault: Account<Vault>,
    #[account(
        mut,
        seeds = [b"item", vault.address().as_ref(), u32::from(item.index).to_le_bytes()],
        bump = item.bump,
        constraint = item.vault == *vault.address() @ EscrowError::ItemVaultMismatch,
        constraint = item.withdrawn == 0 @ EscrowError::ItemAlreadyWithdrawn,
    )]
    pub item: Account<ItemRecord>,
}

pub fn handler(ctx: &mut Context<WithdrawItem>) -> Result<()> {
    let owner = *ctx.accounts.owner.address();
    let item = &mut ctx.accounts.item;
    item.owner = owner;
    item.withdrawn = 1;
    Ok(())
}
