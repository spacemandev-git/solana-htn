//! badge_escrow — on-chain custody for Hack the North badge assets.
//!
//! The badge server mints a hacker's animal vault and their earned clothing
//! into program-owned accounts. Those assets sit in escrow, controlled by
//! nobody, until the hacker connects a wallet and claims the vault. From that
//! point the server can no longer move them: only the claiming wallet can.

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;

declare_id!("6kdZgrhS4FANagxKHiMoJzm2wEp2NRgNYTkjpYYRjtdD");

#[program]
pub mod badge_escrow {
    use super::*;

    /// One-time setup: pins the server key allowed to mint.
    pub fn initialize_registry(ctx: &mut Context<InitializeRegistry>) -> Result<()> {
        initialize_registry::handler(ctx)
    }

    /// Opens a badge's escrow vault on its first sync.
    pub fn create_vault(
        ctx: &mut Context<CreateVault>,
        badge_hash: [u8; 32],
        animal_code: u32,
    ) -> Result<()> {
        create_vault::handler(ctx, badge_hash, animal_code)
    }

    /// Grants one item for visiting a new sync station.
    pub fn mint_item(
        ctx: &mut Context<MintItem>,
        index: u32,
        code: u32,
        station_hash: [u8; 32],
    ) -> Result<()> {
        mint_item::handler(ctx, index, code, station_hash)
    }

    /// Hacker's wallet takes ownership of the vault.
    pub fn claim_vault(ctx: &mut Context<ClaimVault>) -> Result<()> {
        claim_vault::handler(ctx)
    }

    /// Hacker pulls one item out of escrow into their own custody.
    pub fn withdraw_item(ctx: &mut Context<WithdrawItem>) -> Result<()> {
        withdraw_item::handler(ctx)
    }
}
