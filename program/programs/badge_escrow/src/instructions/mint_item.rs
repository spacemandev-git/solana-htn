use anchor_lang::prelude::*;

use crate::{
    error::EscrowError,
    state::{ItemRecord, Registry, Vault},
};

/// Mints one piece of clothing into a badge's vault, held in escrow.
///
/// `index` must equal the vault's current `item_count`, which makes the call
/// safe to retry: replaying a mint either lands on an already-initialized PDA
/// or trips this check, so a retry storm can never inflate an inventory.
#[derive(Accounts)]
#[instruction(index: u32, code: u32, station_hash: [u8; 32])]
pub struct MintItem {
    #[account(seeds = [b"registry"], bump = registry.bump)]
    pub registry: Account<Registry>,
    #[account(mut, address = registry.authority @ EscrowError::NotAuthority)]
    pub authority: Signer,
    #[account(
        mut,
        seeds = [b"vault", vault.badge_hash.as_ref()],
        bump = vault.bump,
        constraint = vault.item_count == index @ EscrowError::ItemIndexMismatch,
    )]
    pub vault: Account<Vault>,
    #[account(
        init,
        payer = authority,
        seeds = [b"item", vault.address().as_ref(), u32::from(index).to_le_bytes()],
        bump,
    )]
    pub item: Account<ItemRecord>,
    pub system_program: Program<System>,
}

pub fn handler(
    ctx: &mut Context<MintItem>,
    index: u32,
    code: u32,
    station_hash: [u8; 32],
) -> Result<()> {
    let bump = ctx.bumps.item;
    let vault_address = *ctx.accounts.vault.address();
    let now = Clock::get()?.unix_timestamp;

    let item = &mut ctx.accounts.item;
    item.vault = vault_address;
    item.owner = crate::constants::UNCLAIMED;
    item.station_hash = station_hash;
    item.code = code;
    item.index = index;
    item.minted_at = now;
    item.withdrawn = 0;
    item.bump = bump;

    ctx.accounts.vault.item_count += 1;
    Ok(())
}
