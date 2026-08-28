use anchor_lang::prelude::*;

#[error_code]
pub enum QuestError {
    #[msg("signer is not the quest authority")]
    NotAuthority,
    #[msg("message exceeds 256 bytes")]
    MessageTooLong,
    #[msg("message must not be empty")]
    MessageEmpty,
}
