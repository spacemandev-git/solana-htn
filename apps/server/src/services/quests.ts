import type { Database } from 'bun:sqlite';
import type { PaymentOutcome } from '@htn/chain';
import {
  atomicToUsd,
  QUEST_STEPS,
  QuestProof,
  type Badge,
  type QuestStep,
  type QuestSubmission,
  type QuestSubmitRequest,
} from '@htn/shared';
import { one, run, toQuestSubmission } from '../db/index.ts';
import type { QuestSubmissionRow } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import { getBadgeByPairingCode } from './badges.ts';
import type { ServiceContext } from './context.ts';
import { nowIso } from './context.ts';
import { buildBadgeView } from './views.ts';

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
    const badge = getBadgeByPairingCode(this.ctx.db, request.pairingCode);
    if (!badge) {
      throw new HttpError(404, 'badge_not_found', 'no badge with that pairing code');
    }

    const existing = getQuestSubmission(this.ctx.db, badge.badgeId);
    if (existing?.status === 'completed') {
      throw new HttpError(409, 'quest_already_completed', 'this badge completed the quest');
    }
    if (existing?.status === 'verifying') {
      throw new HttpError(409, 'quest_verifying', 'this badge is already being verified');
    }
    if (existing?.paid) {
      throw new HttpError(409, 'quest_already_paid', 'this badge has already been paid');
    }
    if (this.running.has(badge.badgeId)) {
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
      badge.badgeId,
      request.endpointUrl,
      request.programId,
      submittedAt,
    );

    const submission = requireSubmission(this.ctx.db, badge.badgeId);
    this.start(badge, submission);
    return submission;
  }

  private start(badge: Badge, submission: QuestSubmission): void {
    if (this.running.has(submission.badgeId)) {
      throw new Error(`quest verification for ${submission.badgeId} is already running`);
    }
    this.running.add(submission.badgeId);

    void this.verify(badge, submission)
      .catch((error: unknown) => this.failInternal(badge, submission.badgeId, error))
      .finally(() => this.running.delete(submission.badgeId));
  }

  private progress(
    badge: Badge,
    badgeId: string,
    step: QuestStep,
    status: 'running' | 'ok' | 'fail',
    detail?: string,
  ): void {
    this.ctx.live.publish(badge.pairingCode, {
      type: 'quest-progress',
      badgeId,
      step,
      status,
      ...(detail === undefined ? {} : { detail }),
    });
  }

  private beginStep(badge: Badge, badgeId: string, step: QuestStep): void {
    run(
      this.ctx.db,
      `UPDATE quest_submissions SET step = ?
       WHERE badge_id = ? AND status = 'verifying'`,
      step,
      badgeId,
    );
    this.progress(badge, badgeId, step, 'running');
  }

  private publishResult(badge: Badge, submission: QuestSubmission): void {
    this.ctx.live.publish(badge.pairingCode, { type: 'quest-result', submission });
    this.ctx.live.publish(badge.pairingCode, {
      type: 'state',
      view: buildBadgeView(this.ctx, badge),
    });
  }

  private failStep(badge: Badge, step: QuestStep, detail: string): void {
    run(
      this.ctx.db,
      `UPDATE quest_submissions
          SET status = 'failed', step = ?, error = ?, completed_at = NULL
        WHERE badge_id = ?`,
      step,
      detail,
      badge.badgeId,
    );
    const submission = requireSubmission(this.ctx.db, badge.badgeId);
    this.progress(badge, badge.badgeId, step, 'fail', detail);
    this.publishResult(badge, submission);
  }

  private failInternal(badge: Badge, badgeId: string, error: unknown): void {
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
      this.progress(badge, badgeId, submission.step, 'fail', 'internal_error');
    }
    this.publishResult(badge, submission);
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

  private async verify(badge: Badge, submission: QuestSubmission): Promise<void> {
    let message: string | null = null;
    let payment: PaymentOutcome | null = null;

    for (const step of QUEST_STEPS) {
      this.beginStep(badge, submission.badgeId, step);

      if (step === 'program') {
        const result = await this.ctx.chain.checkProgram(submission.programId);
        if (!result.skipped && (!result.deployed || !result.executable)) {
          this.failStep(
            badge,
            step,
            result.error ??
              `program not found/executable on ${this.ctx.config.solanaCluster}`,
          );
          return;
        }
        this.progress(badge, submission.badgeId, step, 'ok');
        continue;
      }

      if (step === 'state') {
        const result = await this.ctx.chain.readQuestMessage(submission.programId);
        if (!result.skipped && result.message === null) {
          this.failStep(
            badge,
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
        this.progress(badge, submission.badgeId, step, 'ok');
        continue;
      }

      if (step === 'challenge') {
        const result = await this.ctx.chain.probeChallenge(submission.endpointUrl);
        if (!result.ok || !result.requirement) {
          this.failStep(
            badge,
            step,
            result.error ?? 'endpoint returned no valid payment requirement',
          );
          return;
        }
        this.progress(
          badge,
          submission.badgeId,
          step,
          'ok',
          `${atomicToUsd(result.requirement.amountAtomic)} to ${result.requirement.payTo}`,
        );
        continue;
      }

      if (step === 'payment') {
        if (requireSubmission(this.ctx.db, submission.badgeId).paid) {
          this.failStep(badge, step, 'already paid');
          return;
        }
        payment = await this.ctx.chain.payEndpoint(submission.endpointUrl);
        if (!payment.ok) {
          if (payment.signature !== null) {
            this.persistPayment(submission.badgeId, payment, true);
          } else if (payment.amountAtomic !== null || payment.network !== null) {
            this.persistPayment(submission.badgeId, payment, false);
          }
          this.failStep(badge, step, paymentFailure(payment));
          return;
        }

        // Settlement state lands before proof evaluation: this is the durable
        // pay-once boundary if the process exits between these two steps.
        this.persistPayment(submission.badgeId, payment, !payment.simulated);
        this.progress(badge, submission.badgeId, step, 'ok');
        continue;
      }

      if (!payment) throw new Error('proof step reached without a payment outcome');
      const proof = QuestProof.safeParse(payment.body);
      if (!proof.success) {
        this.failStep(badge, step, 'endpoint returned an invalid quest proof');
        return;
      }
      if (message !== null && proof.data.message !== message) {
        this.failStep(badge, step, 'endpoint returned a different message than the chain');
        return;
      }
      this.progress(badge, submission.badgeId, step, 'ok');
    }

    run(
      this.ctx.db,
      `UPDATE quest_submissions
          SET status = 'completed', completed_at = ?, step = NULL, error = NULL
        WHERE badge_id = ?`,
      nowIso(),
      submission.badgeId,
    );
    this.publishResult(badge, requireSubmission(this.ctx.db, submission.badgeId));
  }
}
