import type { Database } from 'bun:sqlite';
import type { PaymentOutcome } from '@htn/chain';
import {
  atomicToUsd,
  QUEST_STEPS,
  QuestProof,
  type QuestStep,
  type QuestSubmission,
  type QuestSubmitRequest,
  type Session,
} from '@htn/shared';
import { one, run, toQuestSubmission } from '../db/index.ts';
import type { QuestSubmissionRow } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import type { ServiceContext } from './context.ts';
import { nowIso } from './context.ts';
import { buildSessionView, getSession } from './sessions.ts';

export function getQuestSubmission(db: Database, badgeId: string): QuestSubmission | null {
  const row = one<QuestSubmissionRow>(
    db,
    'SELECT * FROM quest_submissions WHERE badge_id = ?',
    badgeId,
  );
  return row ? toQuestSubmission(row) : null;
}

function requireSubmission(db: Database, badgeId: string): QuestSubmission {
  const submission = getQuestSubmission(db, badgeId);
  if (!submission) throw new Error(`quest submission for ${badgeId} vanished`);
  return submission;
}

function paymentFailure(outcome: PaymentOutcome): string {
  return outcome.error ?? `endpoint payment failed with HTTP ${outcome.httpStatus}`;
}

/** Owns the per-process run guard and the asynchronous verification pipeline. */
export class QuestService {
  private readonly running = new Set<string>();

  constructor(private readonly ctx: ServiceContext) {}

  submit(request: QuestSubmitRequest): QuestSubmission {
    const session = getSession(this.ctx.db, request.pairingCode);
    if (!session) {
      throw new HttpError(404, 'session_not_found', 'no session for that pairing code');
    }
    if (!session.active) {
      throw new HttpError(409, 'session_ended', 'the pairing session has ended');
    }

    const existing = getQuestSubmission(this.ctx.db, session.badgeId);
    if (existing?.status === 'completed') {
      throw new HttpError(409, 'quest_already_completed', 'this badge completed the quest');
    }
    if (existing?.status === 'verifying') {
      throw new HttpError(409, 'quest_verifying', 'this badge is already being verified');
    }
    if (existing?.paid) {
      throw new HttpError(409, 'quest_already_paid', 'this badge has already been paid');
    }
    if (this.running.has(session.badgeId)) {
      throw new HttpError(409, 'quest_verifying', 'this badge is already being verified');
    }

    const submittedAt = nowIso();
    run(
      this.ctx.db,
      `INSERT INTO quest_submissions
         (badge_id, endpoint_url, program_id, status, step, error, message,
          amount_paid_atomic, payment_signature, network, paid, submitted_at, completed_at)
       VALUES (?, ?, ?, 'verifying', NULL, NULL, NULL, NULL, NULL, NULL, 0, ?, NULL)
       ON CONFLICT(badge_id) DO UPDATE SET
         endpoint_url = excluded.endpoint_url,
         program_id = excluded.program_id,
         status = 'verifying',
         step = NULL,
         error = NULL,
         message = NULL,
         amount_paid_atomic = NULL,
         payment_signature = NULL,
         network = NULL,
         paid = 0,
         submitted_at = excluded.submitted_at,
         completed_at = NULL`,
      session.badgeId,
      request.endpointUrl,
      request.programId,
      submittedAt,
    );

    const submission = requireSubmission(this.ctx.db, session.badgeId);
    this.start(session, submission);
    return submission;
  }

  private start(session: Session, submission: QuestSubmission): void {
    if (this.running.has(submission.badgeId)) {
      throw new Error(`quest verification for ${submission.badgeId} is already running`);
    }
    this.running.add(submission.badgeId);

    void this.verify(session, submission)
      .catch((error: unknown) => this.failInternal(session, submission.badgeId, error))
      .finally(() => this.running.delete(submission.badgeId));
  }

  private progress(
    session: Session,
    badgeId: string,
    step: QuestStep,
    status: 'running' | 'ok' | 'fail',
    detail?: string,
  ): void {
    this.ctx.live.publish(session.pairingCode, {
      type: 'quest-progress',
      badgeId,
      step,
      status,
      ...(detail === undefined ? {} : { detail }),
    });
  }

  private beginStep(session: Session, badgeId: string, step: QuestStep): void {
    run(
      this.ctx.db,
      `UPDATE quest_submissions SET step = ?
       WHERE badge_id = ? AND status = 'verifying'`,
      step,
      badgeId,
    );
    this.progress(session, badgeId, step, 'running');
  }

  private publishResult(session: Session, submission: QuestSubmission): void {
    this.ctx.live.publish(session.pairingCode, { type: 'quest-result', submission });
    const view = buildSessionView(this.ctx, session);
    if (view) this.ctx.live.publish(session.pairingCode, { type: 'state', view });
  }

  private failStep(session: Session, step: QuestStep, detail: string): void {
    run(
      this.ctx.db,
      `UPDATE quest_submissions
          SET status = 'failed', step = ?, error = ?, completed_at = NULL
        WHERE badge_id = ?`,
      step,
      detail,
      session.badgeId,
    );
    const submission = requireSubmission(this.ctx.db, session.badgeId);
    this.progress(session, session.badgeId, step, 'fail', detail);
    this.publishResult(session, submission);
  }

  private failInternal(session: Session, badgeId: string, error: unknown): void {
    console.error('[quest] verification failed unexpectedly', error);
    const current = getQuestSubmission(this.ctx.db, badgeId);
    if (!current || current.status !== 'verifying') return;

    run(
      this.ctx.db,
      `UPDATE quest_submissions
          SET status = 'failed', error = 'internal_error', completed_at = NULL
        WHERE badge_id = ?`,
      badgeId,
    );
    const submission = requireSubmission(this.ctx.db, badgeId);
    if (submission.step) {
      this.progress(session, badgeId, submission.step, 'fail', 'internal_error');
    }
    this.publishResult(session, submission);
  }

  private persistPayment(badgeId: string, outcome: PaymentOutcome, paid: boolean): void {
    run(
      this.ctx.db,
      `UPDATE quest_submissions
          SET amount_paid_atomic = ?, payment_signature = ?, network = ?, paid = ?
        WHERE badge_id = ?`,
      outcome.amountAtomic,
      outcome.signature,
      outcome.network,
      paid ? 1 : 0,
      badgeId,
    );
  }

  private async verify(session: Session, submission: QuestSubmission): Promise<void> {
    let message: string | null = null;
    let payment: PaymentOutcome | null = null;

    for (const step of QUEST_STEPS) {
      this.beginStep(session, submission.badgeId, step);

      if (step === 'program') {
        const result = await this.ctx.chain.checkProgram(submission.programId);
        if (!result.skipped && (!result.deployed || !result.executable)) {
          this.failStep(
            session,
            step,
            result.error ??
              `program not found/executable on ${this.ctx.config.solanaCluster}`,
          );
          return;
        }
        this.progress(session, submission.badgeId, step, 'ok');
        continue;
      }

      if (step === 'state') {
        const result = await this.ctx.chain.readQuestMessage(submission.programId);
        if (!result.skipped && result.message === null) {
          this.failStep(
            session,
            step,
            result.error ?? `quest message not found on ${this.ctx.config.solanaCluster}`,
          );
          return;
        }
        message = result.message;
        if (message !== null) {
          run(
            this.ctx.db,
            'UPDATE quest_submissions SET message = ? WHERE badge_id = ?',
            message,
            submission.badgeId,
          );
        }
        this.progress(session, submission.badgeId, step, 'ok');
        continue;
      }

      if (step === 'challenge') {
        const result = await this.ctx.chain.probeChallenge(submission.endpointUrl);
        if (!result.ok || !result.requirement) {
          this.failStep(
            session,
            step,
            result.error ?? 'endpoint returned no valid payment requirement',
          );
          return;
        }
        this.progress(
          session,
          submission.badgeId,
          step,
          'ok',
          `${atomicToUsd(result.requirement.amountAtomic)} to ${result.requirement.payTo}`,
        );
        continue;
      }

      if (step === 'payment') {
        if (requireSubmission(this.ctx.db, submission.badgeId).paid) {
          this.failStep(session, step, 'already paid');
          return;
        }
        payment = await this.ctx.chain.payEndpoint(submission.endpointUrl);
        if (!payment.ok) {
          if (payment.signature !== null) {
            this.persistPayment(submission.badgeId, payment, true);
          } else if (payment.amountAtomic !== null || payment.network !== null) {
            this.persistPayment(submission.badgeId, payment, false);
          }
          this.failStep(session, step, paymentFailure(payment));
          return;
        }

        // Settlement state lands before proof evaluation: this is the durable
        // pay-once boundary if the process exits between these two steps.
        this.persistPayment(submission.badgeId, payment, !payment.simulated);
        this.progress(session, submission.badgeId, step, 'ok');
        continue;
      }

      if (!payment) throw new Error('proof step reached without a payment outcome');
      const proof = QuestProof.safeParse(payment.body);
      if (!proof.success) {
        this.failStep(session, step, 'endpoint returned an invalid quest proof');
        return;
      }
      if (message !== null && proof.data.message !== message) {
        this.failStep(session, step, 'endpoint returned a different message than the chain');
        return;
      }
      this.progress(session, submission.badgeId, step, 'ok');
    }

    run(
      this.ctx.db,
      `UPDATE quest_submissions
          SET status = 'completed', completed_at = ?, step = NULL, error = NULL
        WHERE badge_id = ?`,
      nowIso(),
      submission.badgeId,
    );
    this.publishResult(session, requireSubmission(this.ctx.db, submission.badgeId));
  }
}
