pub mod initialize;
pub mod set_message;

use {alloc::string::String, anchor_lang::prelude::*};

use crate::error::QuestError;

#[allow(ambiguous_glob_reexports)]
pub use {initialize::*, set_message::*};

pub(crate) const QUEST_MESSAGE_MAX: usize = 256;

pub(crate) fn validate_message(message: &String) -> Result<()> {
    require!(!message.is_empty(), QuestError::MessageEmpty);
    require!(
        message.len() <= QUEST_MESSAGE_MAX,
        QuestError::MessageTooLong
    );
    Ok(())
}
