use anchor_lang::prelude::*;

/// Singleton naming the server key allowed to create vaults and mint items.
///
/// Field order in every account here is largest-alignment-first with explicit
/// tail padding, because Anchor v2 accounts are `Pod` (zero-copy) and must have
/// no implicit padding holes.
#[account]
pub struct Registry {
    pub vault_count: u64,
    /// The badge server's hot key. Only it may create vaults and mint items.
    pub authority: Address,
    pub bump: u8,
    pub _pad: [u8; 7],
}

/// A single badge's escrow vault.
///
/// Created by the server the first time a badge syncs, and holds the hacker's
/// assets until they connect a wallet. `owner` stays at [`crate::constants::UNCLAIMED`]
/// (the zero address) for as long as the vault is escrowed.
#[account]
pub struct Vault {
    /// Unix seconds when a wallet claimed this vault; 0 while unclaimed.
    pub claimed_at: i64,
    /// sha256 of the badge id. Keeps attendee ids off-chain while still
    /// giving every badge a stable, collision-resistant PDA.
    pub badge_hash: [u8; 32],
    /// Wallet that claimed the vault, or the zero address while in escrow.
    pub owner: Address,
    /// Which animal the hacker was assigned. Content decoding lives off-chain.
    pub animal_code: u32,
    /// Number of items minted so far; doubles as the next item index.
    pub item_count: u32,
    pub bump: u8,
    pub _pad: [u8; 7],
}

/// One earned piece of clothing.
///
/// While escrowed, `owner` is the zero address and the record is custodied by
/// the program. `withdraw_item` hands it to the wallet that claimed the vault.
#[account]
pub struct ItemRecord {
    pub minted_at: i64,
    /// The vault this item was minted into.
    pub vault: Address,
    /// Wallet holding the item, or the zero address while still in escrow.
    pub owner: Address,
    /// sha256 of the sync station id that granted it.
    pub station_hash: [u8; 32],
    /// Packed slot/rarity/content encoding produced by the shared catalog.
    pub code: u32,
    pub index: u32,
    /// 1 once withdrawn from escrow. `u8` rather than `bool` to stay `Pod`.
    pub withdrawn: u8,
    pub bump: u8,
    pub _pad: [u8; 6],
}
