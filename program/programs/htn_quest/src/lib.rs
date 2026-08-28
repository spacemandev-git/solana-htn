//! `htn_quest` — the minimal on-chain half of the Hack the North quest.

#![cfg_attr(target_os = "solana", no_std)]

extern crate alloc;

pub mod error;
pub mod instructions;
pub mod state;

use {alloc::string::String, anchor_lang::prelude::*};

pub use instructions::*;

declare_id!("9UkH8LeXw8jpQFZVNS3yk9LmkzsFAh54MK7SGP8jTsfY");

#[program]
pub mod htn_quest {
    use super::*;

    /// Creates the singleton quest PDA and stores its initial message.
    pub fn initialize(ctx: &mut Context<Initialize>, message: String) -> Result<()> {
        initialize::handler(ctx, message)
    }

    /// Replaces the quest message. Only the authority recorded at initialize may call it.
    pub fn set_message(ctx: &mut Context<SetMessage>, message: String) -> Result<()> {
        set_message::handler(ctx, message)
    }
}
