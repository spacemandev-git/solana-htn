use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("signer is not the registry authority")]
    NotAuthority,
    #[msg("vault has already been claimed by a wallet")]
    VaultAlreadyClaimed,
    #[msg("vault has not been claimed by a wallet yet")]
    VaultNotClaimed,
    #[msg("signer is not the owner of this vault")]
    NotVaultOwner,
    #[msg("item index must equal the vault's current item count")]
    ItemIndexMismatch,
    #[msg("item has already been withdrawn from escrow")]
    ItemAlreadyWithdrawn,
    #[msg("item does not belong to this vault")]
    ItemVaultMismatch,
}
