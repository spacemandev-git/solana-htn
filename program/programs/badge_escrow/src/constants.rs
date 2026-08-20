use anchor_lang::prelude::*;

/// Seed for the singleton registry PDA that names the trusted server authority.
#[constant]
pub const REGISTRY_SEED: &[u8] = b"registry";

/// Seed prefix for a badge's escrow vault: `[VAULT_SEED, badge_hash]`.
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

/// Seed prefix for an item record: `[ITEM_SEED, vault, index_le]`.
#[constant]
pub const ITEM_SEED: &[u8] = b"item";

/// Sentinel meaning "nobody owns this yet" — the vault is still in escrow.
pub const UNCLAIMED: Address = Address::new_from_array([0u8; 32]);
