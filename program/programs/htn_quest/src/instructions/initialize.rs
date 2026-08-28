use {alloc::string::String, anchor_lang::prelude::*};

use crate::{instructions::validate_message, state::Quest};

#[derive(Accounts)]
pub struct Initialize {
    #[account(init, payer = authority, seeds = [b"quest"], bump)]
    pub quest: BorshAccount<Quest>,
    #[account(mut)]
    pub authority: Signer,
    pub system_program: Program<System>,
}

pub fn handler(ctx: &mut Context<Initialize>, message: String) -> Result<()> {
    validate_message(&message)?;

    let quest = &mut ctx.accounts.quest;
    quest.authority = *ctx.accounts.authority.address();
    quest.message = message;
    Ok(())
}
