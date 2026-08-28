//! End-to-end LiteSVM tests for the singleton quest PDA.

use {
    anchor_lang::{
        programs::System, solana_program::instruction::Instruction, Id, InstructionData, Space,
        ToAccountMetas,
    },
    anchor_v2_testing::{
        Keypair, LiteSVM, Message, Signer, VersionedMessage, VersionedTransaction,
    },
    htn_quest::state::Quest,
    solana_pubkey::Pubkey,
};

const QUEST_MESSAGE_OFFSET: usize = 40;
const NOT_AUTHORITY: u32 = 6000;
const MESSAGE_TOO_LONG: u32 = 6001;
const MESSAGE_EMPTY: u32 = 6002;

fn program_id() -> Pubkey {
    Pubkey::new_from_array(htn_quest::ID.to_bytes())
}

fn quest_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"quest"], &program_id()).0
}

struct Harness {
    svm: LiteSVM,
    authority: Keypair,
}

impl Harness {
    fn new() -> Self {
        let mut svm = anchor_v2_testing::svm();
        svm.add_program(
            program_id(),
            include_bytes!("../../../target/deploy/htn_quest.so"),
        )
        .expect("deploy htn_quest");

        let authority = Keypair::new();
        svm.airdrop(&authority.pubkey(), 100_000_000_000)
            .expect("fund authority");
        Self { svm, authority }
    }

    fn funded_keypair(&mut self) -> Keypair {
        let keypair = Keypair::new();
        self.svm
            .airdrop(&keypair.pubkey(), 10_000_000_000)
            .expect("fund keypair");
        keypair
    }

    fn send(&mut self, ix: Instruction, signer: &Keypair) -> Result<(), String> {
        let blockhash = self.svm.latest_blockhash();
        let message = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &blockhash);
        let transaction =
            VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[signer])
                .map_err(|error| format!("sign: {error:?}"))?;

        self.svm
            .send_transaction(transaction)
            .map(|_| ())
            .map_err(|error| format!("{:?}", error.err))
    }

    fn initialize_as(&mut self, message: &str, authority: &Keypair) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(
            program_id(),
            &htn_quest::instruction::Initialize {
                message: message.into(),
            }
            .data(),
            htn_quest::accounts::Initialize {
                quest: quest_pda(),
                authority: authority.pubkey(),
                system_program: System::id(),
            }
            .to_account_metas(None),
        );
        self.send(ix, authority)
    }

    fn initialize(&mut self, message: &str) -> Result<(), String> {
        let authority = self.authority.insecure_clone();
        self.initialize_as(message, &authority)
    }

    fn set_message(&mut self, message: &str, authority: &Keypair) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(
            program_id(),
            &htn_quest::instruction::SetMessage {
                message: message.into(),
            }
            .data(),
            htn_quest::accounts::SetMessage {
                quest: quest_pda(),
                authority: authority.pubkey(),
            }
            .to_account_metas(None),
        );
        self.send(ix, authority)
    }

    fn account_data(&self) -> Vec<u8> {
        self.svm
            .get_account(&quest_pda())
            .expect("quest account exists")
            .data
    }

    fn message(&self) -> String {
        let data = self.account_data();
        let length = u32::from_le_bytes(
            data[QUEST_MESSAGE_OFFSET..QUEST_MESSAGE_OFFSET + 4]
                .try_into()
                .expect("message length bytes"),
        ) as usize;
        String::from_utf8(
            data[QUEST_MESSAGE_OFFSET + 4..QUEST_MESSAGE_OFFSET + 4 + length].to_vec(),
        )
        .expect("valid utf-8 message")
    }
}

fn assert_custom_error(result: Result<(), String>, code: u32) {
    let error = result.expect_err("instruction must fail");
    assert!(
        error.contains(&format!("Custom({code})")),
        "expected Custom({code}), got {error}"
    );
}

#[test]
fn initialize_stores_authority_and_message() {
    let mut harness = Harness::new();
    harness.initialize("ship something delightful").unwrap();

    let data = harness.account_data();
    assert_eq!(&data[8..40], harness.authority.pubkey().as_ref());
    assert_eq!(harness.message(), "ship something delightful");
}

#[test]
fn raw_account_layout_places_the_borsh_string_at_offset_40() {
    let mut harness = Harness::new();
    let message = "quest bytes: \u{1f680}";
    harness.initialize(message).unwrap();

    let data = harness.account_data();
    assert_eq!(
        data.len(),
        <anchor_lang::accounts::BorshAccount<Quest> as Space>::INIT_SPACE
    );
    assert_eq!(&data[8..40], harness.authority.pubkey().as_ref());
    assert_eq!(
        u32::from_le_bytes(data[40..44].try_into().unwrap()) as usize,
        message.len()
    );
    assert_eq!(&data[44..44 + message.len()], message.as_bytes());
}

#[test]
fn authority_can_set_message() {
    let mut harness = Harness::new();
    harness.initialize("first").unwrap();
    let authority = harness.authority.insecure_clone();

    harness.set_message("updated", &authority).unwrap();
    assert_eq!(harness.message(), "updated");
}

#[test]
fn different_signer_cannot_set_message() {
    let mut harness = Harness::new();
    harness.initialize("original").unwrap();
    let impostor = harness.funded_keypair();

    assert_custom_error(harness.set_message("stolen", &impostor), NOT_AUTHORITY);
    assert_eq!(harness.message(), "original");
}

#[test]
fn initialize_rejects_messages_over_256_bytes() {
    let mut harness = Harness::new();
    let message = "x".repeat(257);

    assert_custom_error(harness.initialize(&message), MESSAGE_TOO_LONG);
    assert!(harness.svm.get_account(&quest_pda()).is_none());
}

#[test]
fn set_message_rejects_messages_over_256_bytes() {
    let mut harness = Harness::new();
    harness.initialize("original").unwrap();
    let authority = harness.authority.insecure_clone();
    let message = "x".repeat(257);

    assert_custom_error(harness.set_message(&message, &authority), MESSAGE_TOO_LONG);
    assert_eq!(harness.message(), "original");
}

#[test]
fn empty_messages_are_rejected_by_both_instructions() {
    let mut initialize_harness = Harness::new();
    assert_custom_error(initialize_harness.initialize(""), MESSAGE_EMPTY);

    let mut update_harness = Harness::new();
    update_harness.initialize("original").unwrap();
    let authority = update_harness.authority.insecure_clone();
    assert_custom_error(update_harness.set_message("", &authority), MESSAGE_EMPTY);
    assert_eq!(update_harness.message(), "original");
}

#[test]
fn existing_quest_pda_cannot_be_initialized_twice() {
    let mut harness = Harness::new();
    harness.initialize("first").unwrap();

    assert!(
        harness.initialize("second").is_err(),
        "re-initializing the singleton PDA must fail"
    );
    assert_eq!(harness.message(), "first");
}
