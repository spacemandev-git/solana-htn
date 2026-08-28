use {alloc::string::String, anchor_lang::prelude::*};

/// The singleton quest state stored at the `[b"quest"]` PDA.
#[account(borsh)]
#[derive(InitSpace)]
pub struct Quest {
    /// The only signer allowed to replace `message`.
    pub authority: Address,
    /// UTF-8 quest message, encoded by Borsh as `u32` byte length + bytes.
    #[max_len(256)]
    pub message: String,
}
