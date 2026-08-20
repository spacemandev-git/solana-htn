//! End-to-end tests for the badge escrow lifecycle, run in-process on LiteSVM.
//!
//! Covers the happy path a hacker actually walks (first sync -> vault, new
//! station -> item, connect wallet -> claim, withdraw) plus the authorization
//! boundaries that keep the server from touching claimed assets and keep
//! hackers from touching each other's.

use {
    anchor_lang::{
        accounts::Account, bytemuck, programs::System,
        solana_program::instruction::Instruction, Id, InstructionData, Space, ToAccountMetas,
    },
    anchor_v2_testing::{Keypair, LiteSVM, Message, Signer, VersionedMessage, VersionedTransaction},
    badge_escrow::state::{ItemRecord, Registry, Vault},
    sha2::{Digest, Sha256},
    solana_clock::Clock,
    solana_pubkey::Pubkey,
};

/// LiteSVM starts with a zeroed clock sysvar. Pinning a real wall-clock value
/// lets the tests assert that timestamps are actually stamped rather than
/// silently passing against 0.
const TEST_UNIX_TIMESTAMP: i64 = 1_760_000_000;

const UNCLAIMED: Pubkey = Pubkey::new_from_array([0u8; 32]);

/// Mirrors what the server does: badge ids never hit the chain in the clear.
fn hash_id(id: &str) -> [u8; 32] {
    Sha256::digest(id.as_bytes()).into()
}

fn program_id() -> Pubkey {
    Pubkey::new_from_array(badge_escrow::ID.to_bytes())
}

fn registry_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"registry"], &program_id()).0
}

fn vault_pda(badge_hash: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", badge_hash], &program_id()).0
}

fn item_pda(vault: &Pubkey, index: u32) -> Pubkey {
    Pubkey::find_program_address(
        &[b"item", vault.as_ref(), &index.to_le_bytes()],
        &program_id(),
    )
    .0
}

struct Harness {
    svm: LiteSVM,
    /// Stands in for the badge server's hot key: pays rent and mints.
    authority: Keypair,
}

impl Harness {
    fn new() -> Self {
        let mut svm = anchor_v2_testing::svm();
        svm.add_program(
            program_id(),
            include_bytes!("../../../target/deploy/badge_escrow.so"),
        )
        .expect("deploy badge_escrow");

        svm.set_sysvar(&Clock {
            unix_timestamp: TEST_UNIX_TIMESTAMP,
            ..Default::default()
        });

        let authority = Keypair::new();
        svm.airdrop(&authority.pubkey(), 100_000_000_000).unwrap();
        Self { svm, authority }
    }

    fn funded_keypair(&mut self) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        kp
    }

    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<(), String> {
        let payer = signers[0].pubkey();
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&payer), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
            .map_err(|e| format!("sign: {e:?}"))?;
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| format!("{:?}", e.err))
    }

    fn read<T: bytemuck::Pod>(&self, address: &Pubkey) -> T {
        let account = self.svm.get_account(address).expect("account exists");
        *bytemuck::from_bytes::<T>(&account.data[8..])
    }

    // -- instruction builders ------------------------------------------------

    fn init_registry(&mut self) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(
            program_id(),
            &badge_escrow::instruction::InitializeRegistry {}.data(),
            badge_escrow::accounts::InitializeRegistry {
                payer: self.authority.pubkey(),
                registry: registry_pda(),
                system_program: System::id(),
            }
            .to_account_metas(None),
        );
        let authority = self.authority.insecure_clone();
        self.send(ix, &[&authority])
    }

    fn create_vault(
        &mut self,
        badge_hash: [u8; 32],
        animal_code: u32,
        authority: &Keypair,
    ) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(
            program_id(),
            &badge_escrow::instruction::CreateVault {
                badge_hash,
                animal_code,
            }
            .data(),
            badge_escrow::accounts::CreateVault {
                registry: registry_pda(),
                authority: authority.pubkey(),
                vault: vault_pda(&badge_hash),
                system_program: System::id(),
            }
            .to_account_metas(None),
        );
        self.send(ix, &[authority])
    }

    fn mint_item(
        &mut self,
        badge_hash: [u8; 32],
        index: u32,
        code: u32,
        station: &str,
        authority: &Keypair,
    ) -> Result<(), String> {
        let vault = vault_pda(&badge_hash);
        let ix = Instruction::new_with_bytes(
            program_id(),
            &badge_escrow::instruction::MintItem {
                index,
                code,
                station_hash: hash_id(station),
            }
            .data(),
            badge_escrow::accounts::MintItem {
                registry: registry_pda(),
                authority: authority.pubkey(),
                vault,
                item: item_pda(&vault, index),
                system_program: System::id(),
            }
            .to_account_metas(None),
        );
        self.send(ix, &[authority])
    }

    fn claim_vault(&mut self, badge_hash: [u8; 32], owner: &Keypair) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(
            program_id(),
            &badge_escrow::instruction::ClaimVault {}.data(),
            badge_escrow::accounts::ClaimVault {
                owner: owner.pubkey(),
                vault: vault_pda(&badge_hash),
            }
            .to_account_metas(None),
        );
        self.send(ix, &[owner])
    }

    fn withdraw_item(
        &mut self,
        badge_hash: [u8; 32],
        index: u32,
        owner: &Keypair,
    ) -> Result<(), String> {
        let vault = vault_pda(&badge_hash);
        let ix = Instruction::new_with_bytes(
            program_id(),
            &badge_escrow::instruction::WithdrawItem {}.data(),
            badge_escrow::accounts::WithdrawItem {
                owner: owner.pubkey(),
                vault,
                item: item_pda(&vault, index),
            }
            .to_account_metas(None),
        );
        self.send(ix, &[owner])
    }
}

/// Sets up a registry plus one badge vault, the state every test starts from.
fn with_vault(badge: &str, animal_code: u32) -> (Harness, [u8; 32]) {
    let mut h = Harness::new();
    h.init_registry().expect("init registry");
    let badge_hash = hash_id(badge);
    let authority = h.authority.insecure_clone();
    h.create_vault(badge_hash, animal_code, &authority)
        .expect("create vault");
    (h, badge_hash)
}

#[test]
fn registry_pins_the_server_authority() {
    let mut h = Harness::new();
    h.init_registry().expect("init registry");

    let registry: Registry = h.read(&registry_pda());
    assert_eq!(registry.authority, h.authority.pubkey());
    assert_eq!(registry.vault_count, 0);
}

#[test]
fn registry_cannot_be_initialized_twice() {
    let mut h = Harness::new();
    h.init_registry().expect("init registry");
    assert!(
        h.init_registry().is_err(),
        "re-initializing the registry must fail"
    );
}

#[test]
fn first_sync_opens_an_escrowed_vault() {
    let (h, badge_hash) = with_vault("seal-lynx-meteor-bronze", 3);

    let vault: Vault = h.read(&vault_pda(&badge_hash));
    assert_eq!(vault.badge_hash, badge_hash);
    assert_eq!(vault.animal_code, 3);
    assert_eq!(vault.item_count, 0);
    assert_eq!(vault.claimed_at, 0);
    assert_eq!(
        vault.owner, UNCLAIMED,
        "a fresh vault must be owned by nobody"
    );

    let registry: Registry = h.read(&registry_pda());
    assert_eq!(registry.vault_count, 1);
}

#[test]
fn only_the_registry_authority_may_open_vaults() {
    let mut h = Harness::new();
    h.init_registry().expect("init registry");
    let impostor = h.funded_keypair();

    assert!(
        h.create_vault(hash_id("badge-x"), 1, &impostor).is_err(),
        "a non-authority signer must not be able to open a vault"
    );
}

#[test]
fn visiting_stations_mints_items_into_escrow() {
    let (mut h, badge_hash) = with_vault("badge-a", 1);
    let authority = h.authority.insecure_clone();
    let vault_address = vault_pda(&badge_hash);

    h.mint_item(badge_hash, 0, 0xAB01, "e7-foundry", &authority)
        .expect("first item");
    h.mint_item(badge_hash, 1, 0xCD02, "mc-great-hall", &authority)
        .expect("second item");

    let vault: Vault = h.read(&vault_address);
    assert_eq!(vault.item_count, 2);

    let first: ItemRecord = h.read(&item_pda(&vault_address, 0));
    assert_eq!(first.code, 0xAB01);
    assert_eq!(first.index, 0);
    assert_eq!(first.vault, vault_address);
    assert_eq!(first.station_hash, hash_id("e7-foundry"));
    assert_eq!(first.withdrawn, 0);
    assert_eq!(
        first.owner, UNCLAIMED,
        "items start in escrow, owned by nobody"
    );
    assert_eq!(first.minted_at, TEST_UNIX_TIMESTAMP);

    let second: ItemRecord = h.read(&item_pda(&vault_address, 1));
    assert_eq!(second.code, 0xCD02);
    assert_eq!(second.index, 1);
}

#[test]
fn minting_out_of_order_is_rejected() {
    let (mut h, badge_hash) = with_vault("badge-b", 1);
    let authority = h.authority.insecure_clone();

    assert!(
        h.mint_item(badge_hash, 1, 0x01, "skipped", &authority)
            .is_err(),
        "index must match the vault's item_count"
    );
    // And the correct index still works afterwards, so nothing was corrupted.
    h.mint_item(badge_hash, 0, 0x01, "dc-library", &authority)
        .expect("in-order mint");
}

#[test]
fn replaying_a_mint_cannot_inflate_inventory() {
    let (mut h, badge_hash) = with_vault("badge-c", 1);
    let authority = h.authority.insecure_clone();

    h.mint_item(badge_hash, 0, 0x11, "slc-hub", &authority)
        .expect("first mint");
    assert!(
        h.mint_item(badge_hash, 0, 0x11, "slc-hub", &authority)
            .is_err(),
        "replaying the same mint must fail"
    );

    let vault: Vault = h.read(&vault_pda(&badge_hash));
    assert_eq!(vault.item_count, 1);
}

#[test]
fn only_the_registry_authority_may_mint() {
    let (mut h, badge_hash) = with_vault("badge-d", 1);
    let impostor = h.funded_keypair();

    assert!(
        h.mint_item(badge_hash, 0, 0x22, "qnc-atrium", &impostor)
            .is_err(),
        "a non-authority signer must not be able to mint items"
    );
}

#[test]
fn a_wallet_can_claim_its_vault() {
    let (mut h, badge_hash) = with_vault("badge-e", 7);
    let wallet = h.funded_keypair();

    h.claim_vault(badge_hash, &wallet).expect("claim");

    let vault: Vault = h.read(&vault_pda(&badge_hash));
    assert_eq!(vault.owner, wallet.pubkey());
    assert_eq!(vault.claimed_at, TEST_UNIX_TIMESTAMP, "claimed_at must be stamped");
}

#[test]
fn a_vault_can_only_be_claimed_once() {
    let (mut h, badge_hash) = with_vault("badge-f", 1);
    let first = h.funded_keypair();
    let second = h.funded_keypair();

    h.claim_vault(badge_hash, &first).expect("first claim");
    assert!(
        h.claim_vault(badge_hash, &second).is_err(),
        "a second wallet must not be able to steal a claimed vault"
    );

    let vault: Vault = h.read(&vault_pda(&badge_hash));
    assert_eq!(vault.owner, first.pubkey());
}

#[test]
fn items_cannot_leave_escrow_before_the_vault_is_claimed() {
    let (mut h, badge_hash) = with_vault("badge-g", 1);
    let authority = h.authority.insecure_clone();
    h.mint_item(badge_hash, 0, 0x33, "grand-river", &authority)
        .expect("mint");
    let wallet = h.funded_keypair();

    assert!(
        h.withdraw_item(badge_hash, 0, &wallet).is_err(),
        "withdrawing from an unclaimed vault must fail"
    );
}

#[test]
fn the_claiming_wallet_can_withdraw_its_items() {
    let (mut h, badge_hash) = with_vault("badge-h", 2);
    let authority = h.authority.insecure_clone();
    let vault_address = vault_pda(&badge_hash);
    h.mint_item(badge_hash, 0, 0x44, "e7-foundry", &authority)
        .expect("mint");

    let wallet = h.funded_keypair();
    h.claim_vault(badge_hash, &wallet).expect("claim");
    h.withdraw_item(badge_hash, 0, &wallet).expect("withdraw");

    let item: ItemRecord = h.read(&item_pda(&vault_address, 0));
    assert_eq!(item.withdrawn, 1);
    assert_eq!(item.owner, wallet.pubkey());
}

#[test]
fn an_item_cannot_be_withdrawn_twice() {
    let (mut h, badge_hash) = with_vault("badge-i", 1);
    let authority = h.authority.insecure_clone();
    h.mint_item(badge_hash, 0, 0x55, "mc-great-hall", &authority)
        .expect("mint");
    let wallet = h.funded_keypair();
    h.claim_vault(badge_hash, &wallet).expect("claim");
    h.withdraw_item(badge_hash, 0, &wallet).expect("withdraw");

    assert!(
        h.withdraw_item(badge_hash, 0, &wallet).is_err(),
        "double withdrawal must fail"
    );
}

#[test]
fn another_hacker_cannot_withdraw_your_items() {
    let (mut h, badge_hash) = with_vault("badge-j", 1);
    let authority = h.authority.insecure_clone();
    h.mint_item(badge_hash, 0, 0x66, "dc-library", &authority)
        .expect("mint");

    let owner = h.funded_keypair();
    let thief = h.funded_keypair();
    h.claim_vault(badge_hash, &owner).expect("claim");

    assert!(
        h.withdraw_item(badge_hash, 0, &thief).is_err(),
        "only the vault owner may withdraw"
    );
}

#[test]
fn the_server_cannot_move_assets_after_a_claim() {
    let (mut h, badge_hash) = with_vault("badge-k", 1);
    let authority = h.authority.insecure_clone();
    h.mint_item(badge_hash, 0, 0x77, "slc-hub", &authority)
        .expect("mint");
    let wallet = h.funded_keypair();
    h.claim_vault(badge_hash, &wallet).expect("claim");

    // The server key is still the registry authority, but withdrawal is gated
    // on vault ownership rather than on the mint authority.
    assert!(
        h.withdraw_item(badge_hash, 0, &authority).is_err(),
        "the minting authority must not be able to withdraw a claimed hacker's items"
    );
}

#[test]
fn vaults_are_isolated_per_badge() {
    let (mut h, badge_a) = with_vault("badge-l", 1);
    let authority = h.authority.insecure_clone();
    let badge_b = hash_id("badge-m");
    h.create_vault(badge_b, 2, &authority)
        .expect("second vault");

    h.mint_item(badge_a, 0, 0x88, "e7-foundry", &authority)
        .expect("mint a");

    let vault_a: Vault = h.read(&vault_pda(&badge_a));
    let vault_b: Vault = h.read(&vault_pda(&badge_b));
    assert_eq!(vault_a.item_count, 1);
    assert_eq!(vault_b.item_count, 0, "badge B must not see badge A's loot");
    assert_ne!(vault_pda(&badge_a), vault_pda(&badge_b));

    let registry: Registry = h.read(&registry_pda());
    assert_eq!(registry.vault_count, 2);
}

#[test]
fn account_layouts_match_their_declared_space() {
    // Guards against a Pod padding regression silently changing account size.
    assert_eq!(<Account<Registry> as Space>::INIT_SPACE, 8 + 48);
    assert_eq!(<Account<Vault> as Space>::INIT_SPACE, 8 + 88);
    assert_eq!(<Account<ItemRecord> as Space>::INIT_SPACE, 8 + 120);
}
