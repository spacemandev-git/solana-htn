use {alloc::string::String, anchor_lang::prelude::*};

use crate::{error::QuestError, instructions::validate_message, state::Quest};

#[derive(Accounts)]
pub struct SetMessage {
    #[account(mut, seeds = [b"quest"], bump)]
    pub quest: BorshAccount<Quest>,
    #[account(address = quest.authority @ QuestError::NotAuthority)]
    pub authority: Signer,
}

pub fn handler(ctx: &mut Context<SetMessage>, message: String) -> Result<()> {
    validate_message(&message)?;
    ctx.accounts.quest.message = message;
    Ok(())
}
